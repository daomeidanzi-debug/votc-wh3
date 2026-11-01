import fs from 'fs';
import os from 'os';
import path from 'path';
import type { GameCommand } from '../../actions/types';
import { exists, testWritable } from '../steam';
import type { FolderDetection, GameSetupWarning, LoadOptions, LoadResult, TalkTarget } from '../types';
import { ParadoxAdapter } from '../paradox/ParadoxAdapter';
import { compileCommand, PdxCommand } from '../paradox/commands';
import { PDX_PROFILES } from '../paradox/profiles';
import { FireTuner, TunerError } from './FireTuner';

/** Lua states: the InGame UI context (shares ExposedMembers with the VOTC context) and the gameplay tuner state. */
const UI_STATES = ['InGame'];
const GAMEPLAY_STATES = ['GameCore_Tuner'];
const POLL_MS = 15000;
const OFFLINE_POLL_MS = 30000;
const RETRY_MS = 5000;
const PENDING_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_CHUNKS = 200;
/** how often the in-game Talk button is checked while the game is reachable */
const TALK_POLL_MS = 1500;

interface CivCommand { op: string; effect: string; queuedAt: number; tries: number }

/** The Civilization VI user folder (settings, Mods, Logs): AppData\Local or Documents\My Games. */
export function civ6UserDirs(): string[] {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [
    path.join(local, 'Firaxis Games', "Sid Meier's Civilization VI"),
    path.join(home, 'Documents', 'My Games', "Sid Meier's Civilization VI"),
    path.join(home, 'OneDrive', 'Documents', 'My Games', "Sid Meier's Civilization VI"),
  ];
}

/** EnableTuner value of AppOptions.txt (null when the file or key is missing). */
export function tunerEnabled(userDir: string): boolean | null {
  try {
    const text = fs.readFileSync(path.join(userDir, 'AppOptions.txt'), 'utf-8');
    const m = /^\s*EnableTuner\s+(\d+)/m.exec(text);
    return m ? m[1] !== '0' : null;
  } catch {
    return null;
  }
}

/**
 * Civilization VI. Same snapshot lines and prompts as the Paradox games; the transport is
 * FireTuner: the app asks the VOTC_Bridge mod (through the InGame state) for its snapshot,
 * and evaluates the compiled commands in the GameCore_Tuner state.
 */
export class Civ6Adapter extends ParadoxAdapter {
  private tuner: FireTuner;
  private pollTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private queue: CivCommand[] = [];
  private online = false;
  private pulling: Promise<boolean> | null = null;
  private talkTimer: NodeJS.Timeout | null = null;
  /** clicks of the in-game Talk button seen so far (null: not read yet) */
  private talkSeq: number | null = null;

  /** @param tuner the link to the game (tests pass one for a fake game) */
  constructor(tuner: FireTuner = new FireTuner()) {
    super(PDX_PROFILES.civ6);
    this.tuner = tuner;
  }

  get folderExample() { return "C:\\Users\\<you>\\AppData\\Local\\Firaxis Games\\Sid Meier's Civilization VI"; }
  get talkHint() { return this.profile.talkInGame; }
  get autoApplies(): boolean { return true; }
  get runCommand(): string { return ''; }

  isValidFolder(dir: string | null | undefined): boolean {
    if (!dir) return false;
    return exists(path.join(dir, 'AppOptions.txt')) || exists(path.join(dir, 'Logs'));
  }

  detectFolder(configured: string | null | undefined): FolderDetection {
    if (configured && this.isValidFolder(configured)) return { path: configured, source: 'configured' };
    const found = civ6UserDirs().find((d) => this.isValidFolder(d));
    if (found) return { path: found, source: 'documents' };
    return {
      path: null,
      source: 'not_found',
      error: "The Civilization VI user folder (AppData\\Local\\Firaxis Games\\Sid Meier's Civilization VI) was not found. Start the game once, then select that folder.",
    };
  }

  checkSetup(dir: string): GameSetupWarning[] {
    const warnings: GameSetupWarning[] = [];
    if (!exists(path.join(dir, 'Mods', 'VOTC_Bridge', 'VOTC_Bridge.modinfo'))) {
      warnings.push({
        type: 'mod_missing',
        message: `The VOTC_Bridge mod was not found in ${path.join(dir, 'Mods')}`,
        suggestion: `Copy the VOTC_Bridge folder (from the app's mods folder) into ${path.join(dir, 'Mods')} and enable "VOTC Bridge - Civilization VI" under Additional Content.`,
      });
    }
    if (tunerEnabled(dir) !== true) {
      warnings.push({
        type: 'debug_mode',
        message: 'Civilization VI only accepts commands from the app with FireTuner enabled',
        suggestion: `In ${path.join(dir, 'AppOptions.txt')} set "EnableTuner 1" (it is 0 by default), then restart the game. Note: the game does not award Steam achievements while the tuner is on.`,
      });
    }
    const err = testWritable(dir);
    if (err) warnings.push({ type: 'permission', message: `Cannot write to ${dir}: ${err}`, suggestion: 'Check the folder permissions.' });
    return warnings;
  }

  // ------------------------------------------------------------ lifecycle

  start(): void {
    this.stop();
    const tick = async () => {
      await this.pull('poll');
      this.pollTimer = setTimeout(tick, this.online ? POLL_MS : OFFLINE_POLL_MS);
    };
    void tick();
    const talk = async () => {
      if (this.online) await this.checkTalkButton();
      this.talkTimer = setTimeout(talk, TALK_POLL_MS);
    };
    this.talkTimer = setTimeout(talk, TALK_POLL_MS);
  }

  stop(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.talkTimer) clearTimeout(this.talkTimer);
    this.pollTimer = null;
    this.retryTimer = null;
    this.talkTimer = null;
  }

  /**
   * The mod's "Talk (VOTC)" button in the leader screen counts clicks in VOTC_TalkSeq. A new
   * click opens the conversation with the leader the screen shows (its own selection, read
   * from the DiplomacyActionView state; the mod's tracked id when that state is not listed).
   */
  private async checkTalkButton(): Promise<void> {
    let reply: string;
    try {
      reply = await this.tuner.evaluate(UI_STATES,
        `(function() if ExposedMembers == nil then return "" end return tostring(ExposedMembers.VOTC_TalkSeq or 0) .. "|" .. tostring(ExposedMembers.VOTC_TalkPlayer or -1) end)()`);
    } catch {
      return;
    }
    const m = /^(\d+)\|(-?\d+)/.exec(reply.trim());
    if (!m) return;
    const seq = Number(m[1]);
    // the first reading (or a new game, which starts again at 0) is only a baseline
    if (this.talkSeq === null || seq < this.talkSeq) {
      this.talkSeq = seq;
      return;
    }
    if (seq === this.talkSeq) return;
    this.talkSeq = seq;
    let player = Number(m[2]);
    try {
      const selected = Number((await this.tuner.evaluate(['DiplomacyActionView'], 'ms_SelectedPlayerID')).trim());
      if (Number.isInteger(selected) && selected >= 0) player = selected;
    } catch { /* the screen's state is not listed: keep the mod's id */ }
    await this.pull('talk');
    const own = this.snapshot?.player.tag;
    const tag = `P${player}`;
    this.diagnostic(`Talk (VOTC) clicked in the diplomacy screen for ${tag}`);
    if (player < 0 || tag === own || !this.snapshot?.countries.some((c) => c.tag === tag)) {
      this.emit('talk-request', { pick: true, tag: '' });
    } else {
      this.emit('talk-request', { targetId: tag });
    }
  }

  clear(): void {
    this.queue = [];
    this.emit('commands-pending', 0);
  }

  /**
   * Fetch a fresh snapshot from the mod (feeds the Paradox snapshot parser). Resolves false
   * when the game is not reachable; concurrent calls share one request.
   */
  pull(reason: string): Promise<boolean> {
    if (this.pulling) return this.pulling;
    this.pulling = (async () => {
      try {
        const count = Number(await this.tuner.evaluate(UI_STATES,
          `(function() if ExposedMembers == nil or ExposedMembers.VOTC_Build == nil then return -2 end return ExposedMembers.VOTC_Build("${reason}") end)()`));
        if (count === -2) {
          if (this.online) this.diagnostic('the VOTC_Bridge mod is not loaded in this game');
          this.online = false;
          return false;
        }
        const n = Math.min(Math.max(0, count), MAX_CHUNKS);
        const exprs = Array.from({ length: Math.max(1, n) }, (_, i) => `ExposedMembers.VOTC_Chunk(${i + 1})`);
        const chunks = await this.tuner.evaluateMany(UI_STATES, exprs);
        const text = chunks.join('');
        for (const line of text.split('\n')) this.feedLine(line);
        if (count < 0) this.diagnostic(`snapshot failed in game: ${text.slice(0, 300)}`);
        if (!this.online) this.diagnostic('connected to Civilization VI over FireTuner');
        this.online = true;
        return count >= 0;
      } catch (error) {
        if (this.online) this.diagnostic(`FireTuner: ${error instanceof Error ? error.message : String(error)}`);
        this.online = false;
        return false;
      } finally {
        this.pulling = null;
      }
    })();
    return this.pulling;
  }

  listTalkTargets(tag?: string): TalkTarget[] {
    // the list shows the last snapshot; refresh in the background for the next look
    void this.pull('list');
    return super.listTalkTargets(tag);
  }

  async loadGameData(options: LoadOptions): Promise<LoadResult> {
    await this.pull('talk');
    const result = await super.loadGameData(options);
    if (result.ok) {
      const mods = (this.snapshot?.meta.mods ?? '').split(';').map((m) => m.trim()).filter(Boolean);
      result.gameData.reportedMods = mods;
    } else if (!this.snapshot) {
      const zh = options.lang === 'zh';
      result.details = zh
        ? '没有连上文明6。请确认：游戏正在运行并已载入存档；已启用“VOTC Bridge - Civilization VI”模组；AppOptions.txt 里 EnableTuner 为 1（改后需重启游戏）。'
        : 'Could not reach Civilization VI. Make sure a game is loaded, the "VOTC Bridge - Civilization VI" mod is enabled, and EnableTuner is 1 in AppOptions.txt (restart the game after changing it).';
    }
    return result;
  }

  // ------------------------------------------------------------ app -> game

  runGameEffect(command: GameCommand): void {
    let cmd: unknown = command;
    if (typeof command === 'string') {
      try {
        cmd = JSON.parse(command);
      } catch {
        throw new Error('Game effects must be command objects like { op: "war", a: "P1", b: "P0" }');
      }
    }
    if (!cmd || typeof cmd !== 'object' || typeof (cmd as { op?: unknown }).op !== 'string') {
      throw new Error('Game effect must be a command object with an op');
    }
    const compiled = compileCommand('civ6', cmd as PdxCommand);
    this.queue.push({ op: (cmd as PdxCommand).op, effect: compiled.effect, queuedAt: Date.now(), tries: 0 });
    this.diagnostic(`queued ${(cmd as PdxCommand).op} ${JSON.stringify(cmd)}`);
    this.emit('commands-pending', this.queue.length);
    void this.flush();
  }

  pendingCount(): number {
    return this.queue.length;
  }

  /** Send queued commands in order; a command that cannot be delivered is retried. */
  private async flush(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.queue = this.queue.filter((c) => Date.now() - c.queuedAt < PENDING_TTL_MS);
    let applied = false;
    while (this.queue.length) {
      const c = this.queue[0];
      try {
        const reply = (await this.tuner.evaluate(GAMEPLAY_STATES, c.effect)).trim();
        this.queue.shift();
        applied = true;
        this.diagnostic(`${c.op}: ${reply}`);
        if (!reply.startsWith('ok')) {
          this.emit('command-failed', { op: c.op, message: reply.replace(/^fail:/, '') || 'the game did not apply it' });
        }
      } catch (error) {
        if (error instanceof TunerError && error.code === 'lua') {
          // the game ran it and it failed: do not retry
          this.queue.shift();
          this.diagnostic(`${c.op}: Lua error ${error.message}`);
          this.emit('command-failed', { op: c.op, message: error.message });
          continue;
        }
        c.tries++;
        this.diagnostic(`${c.op}: not delivered (${error instanceof Error ? error.message : String(error)}), retrying`);
        this.retryTimer = setTimeout(() => void this.flush(), RETRY_MS);
        break;
      }
    }
    this.emit('commands-pending', this.queue.length);
    if (applied) void this.pull('after');
  }

  diagnosticFiles(dir: string): string[] {
    return [path.join(dir, 'Logs', 'Lua.log'), path.join(dir, 'votc_app_log.txt')];
  }
}
