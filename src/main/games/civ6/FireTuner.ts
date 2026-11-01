import net from 'net';

/**
 * Client for Civilization VI's FireTuner link (the developer tuner, enabled with
 * `EnableTuner 1` in AppOptions.txt; the game listens on port 4318).
 *
 * Wire format, as the game's Tuner2Listener reads and writes it:
 *   u32 payload length | u32 tag (echoed in the reply) | payload
 * A request payload is one NUL-terminated string "<COMMAND>:<args>"; a reply payload is a
 * sequence of NUL-terminated strings.
 *   LSQ:                 -> "<index>", "<state name>", ... for every Lua state
 *   CMD:<index>:<code>   -> the value of `_cmdr = {<code>}` as text, or "ERR:<message>"
 * The game wraps CMD code in a table constructor, so code must be an expression (a call of
 * an anonymous function works everywhere). Replies are capped at about 2 KB.
 */

export const TUNER_PORT = 4318;
const CONNECT_TIMEOUT_MS = 1500;
const REPLY_TIMEOUT_MS = 8000;

export class TunerError extends Error {
  constructor(public code: 'offline' | 'timeout' | 'no_state' | 'lua', message: string) {
    super(message);
    this.name = 'TunerError';
  }
}

export function encodeFrame(tag: number, text: string): Buffer {
  const payload = Buffer.concat([Buffer.from(text, 'utf-8'), Buffer.from([0])]);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(payload.length, 0);
  header.writeUInt32LE(tag >>> 0, 4);
  return Buffer.concat([header, payload]);
}

/** Splits a stream into frames; returns the complete ones and keeps the rest. */
export class FrameReader {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer): Array<{ tag: number; strings: string[] }> {
    this.buf = Buffer.concat([this.buf, chunk]);
    const frames: Array<{ tag: number; strings: string[] }> = [];
    while (this.buf.length >= 8) {
      const len = this.buf.readUInt32LE(0);
      if (this.buf.length < 8 + len) break;
      const tag = this.buf.readUInt32LE(4);
      const payload = this.buf.subarray(8, 8 + len);
      this.buf = this.buf.subarray(8 + len);
      const strings = payload.toString('utf-8').split('\0');
      if (strings.length && strings[strings.length - 1] === '') strings.pop();
      frames.push({ tag, strings });
    }
    return frames;
  }
}

/** "0","Main State","1","InGame" -> Map name -> index */
export function parseStates(strings: string[]): Map<string, number> {
  const states = new Map<string, number>();
  for (let i = 0; i + 1 < strings.length; i += 2) {
    const index = Number(strings[i]);
    if (Number.isInteger(index)) states.set(strings[i + 1], index);
  }
  return states;
}

/**
 * One request at a time over a short-lived connection (the game drops idle tuner clients
 * when a game is loaded or quit, so nothing is kept open).
 */
export class FireTuner {
  private nextTag = 1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private host = '127.0.0.1', private port = TUNER_PORT) {}

  private exchange(requests: string[]): Promise<string[][]> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const reader = new FrameReader();
      const tags = requests.map(() => this.nextTag++ % 0x7fffffff);
      const replies = new Map<number, string[]>();
      let timer = setTimeout(() => fail(new TunerError('offline', 'Civilization VI is not answering on the FireTuner port (is the game running with EnableTuner 1?)')), CONNECT_TIMEOUT_MS);
      const fail = (error: Error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      };
      socket.on('connect', () => {
        clearTimeout(timer);
        timer = setTimeout(() => fail(new TunerError('timeout', 'Civilization VI did not reply in time')), REPLY_TIMEOUT_MS);
        for (let i = 0; i < requests.length; i++) socket.write(encodeFrame(tags[i], requests[i]));
      });
      socket.on('data', (chunk: Buffer) => {
        for (const f of reader.push(chunk)) {
          if (tags.includes(f.tag) && !replies.has(f.tag)) replies.set(f.tag, f.strings);
        }
        if (replies.size === tags.length) {
          clearTimeout(timer);
          socket.end();
          resolve(tags.map((t) => replies.get(t)!));
        }
      });
      socket.on('error', (error) => fail(new TunerError('offline', `FireTuner connection failed: ${error.message}`)));
    });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Lua state name -> index. */
  listStates(): Promise<Map<string, number>> {
    return this.serial(async () => parseStates((await this.exchange(['LSQ:']))[0]));
  }

  /**
   * Evaluate a Lua expression in the first state of `stateNames` the game has; resolves with
   * its text. Lua errors reject with TunerError('lua').
   */
  evaluate(stateNames: string[], expression: string): Promise<string> {
    return this.serial(async () => {
      const states = parseStates((await this.exchange(['LSQ:']))[0]);
      const name = stateNames.find((n) => states.has(n));
      if (name === undefined) {
        throw new TunerError('no_state', `Lua state ${stateNames.join(' / ')} not found (is a game loaded?); the game has: ${[...states.keys()].slice(0, 12).join(', ')}`);
      }
      const reply = (await this.exchange([`CMD:${states.get(name)}:${expression}`]))[0].join('\n');
      if (reply.startsWith('ERR:')) throw new TunerError('lua', reply.slice(4).trim());
      return reply;
    });
  }

  /** Evaluate several expressions in one state over one connection (same order). */
  evaluateMany(stateNames: string[], expressions: string[]): Promise<string[]> {
    return this.serial(async () => {
      const states = parseStates((await this.exchange(['LSQ:']))[0]);
      const name = stateNames.find((n) => states.has(n));
      if (name === undefined) throw new TunerError('no_state', `Lua state ${stateNames.join(' / ')} not found`);
      const index = states.get(name);
      const replies = await this.exchange(expressions.map((e) => `CMD:${index}:${e}`));
      return replies.map((r) => r.join('\n'));
    });
  }
}
