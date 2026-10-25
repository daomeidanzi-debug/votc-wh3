import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { v4 } from 'uuid';
import { settingsRepository } from '../SettingsRepository';
import { buildCommandFile, LuaValue } from './luaSerialize';
import { WH3_FILES, Wh3Ack, Wh3Command, Wh3CommandResult, Wh3State } from './types';

// generous: the game only runs script timers while it has focus
const EXPORT_TIMEOUT_MS = 20000;
const POLL_MS = 150;
const ACK_POLL_MS = 400;
/**
 * Unacknowledged commands are dropped after this. Actions chosen while the chat window has
 * focus only run once the player returns to the game, which can take a long conversation.
 * Keep in sync with STALE_COMMAND_SECONDS in votc_wh3.lua.
 */
const PENDING_TTL_MS = 60 * 60 * 1000;
/** How long an export may wait while the game is not the foreground window. */
const MAX_BACKGROUND_WAIT_MS = 3 * 60 * 1000;
const DIAGNOSTIC_MAX_BYTES = 256 * 1024;

type PendingCommand = Record<string, LuaValue> & { id: number; ts: number; op: string };

export class Wh3BridgeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'Wh3BridgeError';
  }
}

/**
 * File-based link to the votc_wh3 Lua mod running inside Warhammer III.
 *
 * The app owns votc_commands.lua and rewrites it with every unacknowledged
 * command; the game owns votc_state.json and votc_ack.json. All three live in
 * the game install folder, which is the Lua side's working directory.
 */
export class Wh3Bridge extends EventEmitter {
  private pending: Array<{ cmd: PendingCommand; queuedAt: number }> = [];
  private lastId = 0;
  private ackTimer: NodeJS.Timeout | null = null;

  getGameDir(): string | null {
    const dir = settingsRepository.getCK3UserFolderPath();
    return dir ? dir : null;
  }

  private filePath(name: string): string {
    const dir = this.getGameDir();
    if (!dir) {
      throw new Wh3BridgeError('no_game_dir', 'Warhammer III folder is not configured');
    }
    return path.join(dir, name);
  }

  isAvailable(): boolean {
    const dir = this.getGameDir();
    return !!dir && fs.existsSync(dir);
  }

  /** Ids only ever grow, also across app restarts, so the bridge never replays old commands. */
  private nextId(): number {
    this.lastId = Math.max(Date.now() * 1000, this.lastId + 1);
    return this.lastId;
  }

  private writeCommandFile(): void {
    const target = this.filePath(WH3_FILES.commands);
    const content = buildCommandFile(this.pending.map((p) => p.cmd));
    const tmp = target + '.tmp';
    try {
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, target);
    } catch (error) {
      // rename can fail while the game holds the file open; a direct write is still safe
      // because the bridge ignores files that do not parse and retries next poll
      console.warn('Wh3Bridge: atomic write failed, writing directly:', error);
      fs.writeFileSync(target, content, 'utf-8');
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    }
  }

  /** Queue a command for the game. Returns its id. */
  queueCommand(command: Wh3Command): number {
    this.dropExpired();
    const cmd = { ...(command as Record<string, LuaValue>), id: this.nextId(), ts: Math.floor(Date.now() / 1000) } as PendingCommand;
    this.pending.push({ cmd, queuedAt: Date.now() });
    this.writeCommandFile();
    this.ensureAckWatcher();
    console.log(`Wh3Bridge: queued ${cmd.op} #${cmd.id}`);
    if (cmd.op !== 'export') this.diagnostic(`queued ${cmd.op} #${cmd.id} ${JSON.stringify(command)}`);
    return cmd.id;
  }

  /** Forget all queued commands and empty the command file. */
  clear(): void {
    this.pending = [];
    if (!this.isAvailable()) return;
    try {
      this.writeCommandFile();
    } catch (error) {
      console.warn('Wh3Bridge: failed to clear command file:', error);
    }
  }

  private dropExpired(): void {
    const now = Date.now();
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => now - p.queuedAt < PENDING_TTL_MS);
    if (this.pending.length !== before) {
      console.warn(`Wh3Bridge: dropped ${before - this.pending.length} command(s) the game never acknowledged`);
    }
  }

  private readJson<T>(name: string): T | null {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath(name), 'utf-8');
    } catch {
      return null;
    }
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    try {
      return JSON.parse(raw) as T;
    } catch {
      // the game may be mid-write
      return null;
    }
  }

  readAck(): Wh3Ack | null {
    return this.readJson<Wh3Ack>(WH3_FILES.ack);
  }

  private ensureAckWatcher(): void {
    if (this.ackTimer) return;
    this.ackTimer = setInterval(() => this.checkAck(), ACK_POLL_MS);
  }

  private checkAck(): void {
    const ack = this.readAck();
    if (ack && typeof ack.lastId === 'number') {
      const acked = this.pending.filter((p) => p.cmd.id <= ack.lastId);
      if (acked.length > 0) {
        this.pending = this.pending.filter((p) => p.cmd.id > ack.lastId);
        const results = Array.isArray(ack.results) ? ack.results : [];
        for (const p of acked) {
          const result: Wh3CommandResult = results.find((r) => r.id === p.cmd.id)
            ?? { id: p.cmd.id, op: p.cmd.op, ok: true, message: 'acknowledged' };
          this.emit('result', result);
          if (p.cmd.op !== 'export') this.diagnostic(`result ${result.op} #${result.id}: ${result.ok ? 'ok' : 'FAILED'} ${result.message}`);
          if (!result.ok) {
            console.warn(`Wh3Bridge: ${result.op} #${result.id} failed in game: ${result.message}`);
            if (p.cmd.op !== 'export') this.emit('command-failed', result);
          }
        }
        try { this.writeCommandFile(); } catch (error) { console.warn('Wh3Bridge: failed to rewrite command file:', error); }
      }
    }
    this.dropExpired();
    if (this.pending.length === 0 && this.ackTimer) {
      clearInterval(this.ackTimer);
      this.ackTimer = null;
    }
  }

  /**
   * Ask the game for a snapshot of the player and the current talk target.
   * Resolves with the state even when state.ok is false (caller decides how to report it).
   */
  /**
   * @param gameInBackground when it returns true the deadline is extended (up to
   *        MAX_BACKGROUND_WAIT_MS): the game only answers once it is in front again.
   */
  async requestExport(
    targetCqi?: number,
    timeoutMs = EXPORT_TIMEOUT_MS,
    gameInBackground: () => boolean = () => false
  ): Promise<Wh3State> {
    if (!this.isAvailable()) {
      throw new Wh3BridgeError('no_game_dir', 'Warhammer III folder is not configured or does not exist');
    }
    const reqId = v4();
    const command: Wh3Command = targetCqi != null ? { op: 'export', reqId, targetCqi } : { op: 'export', reqId };
    const id = this.queueCommand(command);
    const started = Date.now();
    let deadline = started + timeoutMs;
    this.diagnostic(`export #${id} requested`);

    return new Promise<Wh3State>((resolve, reject) => {
      const timer = setInterval(() => {
        const state = this.readJson<Wh3State>(WH3_FILES.state);
        if (state && state.reqId === reqId) {
          clearInterval(timer);
          this.diagnostic(`export #${id} answered after ${Date.now() - started} ms: ${state.ok ? 'ok' : 'error ' + state.error}`);
          resolve(state);
          return;
        }
        const now = Date.now();
        if (now > deadline && gameInBackground() && now - started < MAX_BACKGROUND_WAIT_MS) {
          // keep waiting while the player is outside the game
          deadline = now + POLL_MS * 4;
        }
        if (now > deadline) {
          clearInterval(timer);
          this.pending = this.pending.filter((p) => p.cmd.id !== id);
          try { this.writeCommandFile(); } catch { /* ignore */ }
          this.diagnostic(`export #${id} timed out after ${now - started} ms`);
          reject(new Wh3BridgeError(
            'timeout',
            'The game did not answer. Make sure Warhammer III is running a single-player campaign with the votc_wh3 mod enabled, the campaign map is loaded, and the game window is in front when you press the hotkey (the game pauses its scripts in the background). Click the retry button to try again.'
          ));
        }
      }, POLL_MS);
    });
  }

  /**
   * Append a line to votc_app_log.txt in the game folder (next to the mod's votc_log.txt),
   * so problems can be diagnosed from one place. Kept small; never throws.
   */
  diagnostic(message: string): void {
    try {
      const file = this.filePath(WH3_FILES.appLog);
      try {
        if (fs.statSync(file).size > DIAGNOSTIC_MAX_BYTES) {
          const text = fs.readFileSync(file, 'utf-8');
          fs.writeFileSync(file, text.slice(text.length / 2), 'utf-8');
        }
      } catch { /* missing file */ }
      fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf-8');
    } catch { /* diagnostics must never break the app */ }
  }

  dispose(): void {
    if (this.ackTimer) clearInterval(this.ackTimer);
    this.ackTimer = null;
  }
}

export const wh3Bridge = new Wh3Bridge();
