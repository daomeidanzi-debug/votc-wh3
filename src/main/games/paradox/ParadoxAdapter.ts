import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { settingsRepository } from '../../SettingsRepository';
import type { GameCommand } from '../../actions/types';
import { findSteamGame, paradoxUserDir, exists, testWritable } from '../steam';
import type {
  FolderDetection, GameAdapter, GameSetupWarning, LoadOptions, LoadResult, TalkTarget, WindowInfo,
} from '../types';
import { buildRunFile, compileCommand, PdxCommand, QueuedCommand, runFileEncoding } from './commands';
import { buildGameDataFromPdx, personTargetId, talkTargets } from './buildGameData';
import type { PdxProfile } from './profiles';
import { personKey, SnapshotParser } from './snapshot';
import { gameContent } from './gameContent';
import type { PdxPerson, PdxSnapshot } from './types';
import { typeConsoleCommand } from '../consoleInput';

const POLL_MS = 700;
/** Unacknowledged commands are dropped after this (the player never ran them). */
const PENDING_TTL_MS = 3 * 60 * 60 * 1000;
/** Only read this much of an existing log when the app starts. */
const INITIAL_READ_BYTES = 8 * 1024 * 1024;
const DIAGNOSTIC_FILE = 'votc_app_log.txt';
const DIAGNOSTIC_MAX_BYTES = 256 * 1024;
/** Sequence numbers start at minutes since 2026-01-01, so they keep growing across app restarts. */
const SEQ_EPOCH = Date.UTC(2026, 0, 1);
/** Characters remembered from earlier snapshots (the newest data wins). */
const MAX_PEOPLE = 3000;
/** 'gui' games: type the run command only when the mod's own timer has not answered by then. */
const GUI_FALLBACK_MS = 12000;
/** The game must have been in front this long before the app types into it. */
const FOCUS_SETTLE_MS = 1200;
const TYPE_RETRY_MS = 10000;
const MAX_TYPE_ATTEMPTS = 3;

/** Older copies the game keeps when a log fills up: debug.log -> debug.1.log, debug.2.log... */
const MAX_ROTATED_LOGS = 9;

/**
 * Follows one log file: reads appended bytes. The game starts a new log when one fills up
 * (Victoria 3 keeps debug.1.log ... debug.5.log of 512 KB; with mods that report many errors
 * that happens several times a second). The file's identity tells a new log from the old one;
 * the rest of the old log is read from its rotated copy first, so no line is lost.
 */
export class LogFollower {
  private offset = 0;
  private remainder = '';
  private started = false;
  private id: bigint | null = null;

  /** backlog: the line was already in the log when the app started following it */
  constructor(private file: string, private onLine: (line: string, backlog: boolean) => void) {}

  private rotated(n: number): string {
    const ext = path.extname(this.file);
    return path.join(path.dirname(this.file), `${path.basename(this.file, ext)}.${n}${ext}`);
  }

  poll(): void {
    let stat: fs.BigIntStats;
    try {
      stat = fs.statSync(this.file, { bigint: true });
    } catch {
      return;
    }
    const size = Number(stat.size);
    const backlog = !this.started;
    if (!this.started) {
      this.started = true;
      this.id = stat.ino;
      this.offset = Math.max(0, size - INITIAL_READ_BYTES);
    }
    if (this.id !== null && stat.ino !== BigInt(0) && stat.ino !== this.id) {
      this.catchUpRotated(this.id);
      this.id = stat.ino;
      this.offset = 0;
    } else if (size < this.offset) {
      // the game started a new log (and the file system reports no identity)
      this.offset = 0;
      this.remainder = '';
    }
    this.readFrom(this.file, size, backlog);
  }

  /** The log was replaced: finish the old one (now debug.N.log), then the newer copies. */
  private catchUpRotated(oldId: bigint): void {
    let found = 0;
    for (let n = 1; n <= MAX_ROTATED_LOGS && !found; n++) {
      try {
        if (fs.statSync(this.rotated(n), { bigint: true }).ino === oldId) found = n;
      } catch {
        break;
      }
    }
    if (!found) {
      // the old log is gone: start over with the new one
      this.remainder = '';
      return;
    }
    for (let n = found; n >= 1; n--) {
      const file = this.rotated(n);
      let size: number;
      try {
        size = fs.statSync(file).size;
      } catch {
        continue;
      }
      this.readFrom(file, size);
      this.offset = 0;
    }
  }

  private readFrom(file: string, size: number, backlog = false): void {
    if (size <= this.offset) return;
    let fd: number | null = null;
    try {
      fd = fs.openSync(file, 'r');
      const length = size - this.offset;
      const buf = Buffer.alloc(length);
      const read = fs.readSync(fd, buf, 0, length, this.offset);
      this.offset += read;
      const text = this.remainder + buf.subarray(0, read).toString('utf-8');
      const lines = text.split('\n');
      this.remainder = lines.pop() ?? '';
      for (const line of lines) this.onLine(line, backlog);
    } catch (error) {
      console.warn(`ParadoxAdapter: could not read ${file}:`, error);
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }
}

/**
 * Hearts of Iron IV, Victoria 3, Europa Universalis V and Stellaris.
 *
 * Game -> app: the VOTC mod logs a snapshot of the player's country and the countries that
 * matter to it (monthly, on load, and when asked), see paradox/types.ts.
 * App -> game: whitelisted commands compiled to script (paradox/commands.ts) and written into
 * the mod's hidden command event, which the game's file watcher reloads (launch option
 * -debug / -debug_mode) and the mod fires by itself. No console is used. The game
 * acknowledges every command, so the event can fire any number of times.
 *
 * Talking: in-game buttons / right-click interactions log a snapshot with a talk request
 * (and the characters involved); the adapter emits 'talk-request'.
 */
/** The launch option that turns on the file watcher (HOI4 calls it -debug). */
function debugFlag(game: string): string {
  return game === 'hoi4' ? '-debug' : '-debug_mode';
}

export class ParadoxAdapter extends EventEmitter implements GameAdapter {
  readonly family = 'paradox' as const;
  readonly folderKind = 'documents' as const;
  readonly promptVariants: string[];

  private followers: LogFollower[] = [];
  /** true while lines that were in the log before the app started are parsed */
  private replaying = false;
  private timer: NodeJS.Timeout | null = null;
  private parser: SnapshotParser;
  protected snapshot: PdxSnapshot | null = null;
  private pending: Array<QueuedCommand & { queuedAt: number }> = [];
  private lastSeq = 0;
  protected people = new Map<string, PdxPerson>();
  private gameFocused: () => boolean = () => false;
  private focusedSince = 0;
  private typeAttempts = 0;
  private lastTypeAt = 0;
  /** the character of the last in-game "Talk" (the mod keeps it for character commands) */
  private lastTalker = '';

  constructor(protected profile: PdxProfile) {
    super();
    this.promptVariants = [profile.id, 'paradox'];
    this.parser = new SnapshotParser({
      onSnapshot: (s) => this.onSnapshot(s),
      onAck: (seq) => this.onAck(seq),
    });
  }

  get id() { return this.profile.id; }
  get name() { return this.profile.name; }
  get folderExample() { return `C:\\Users\\<you>\\Documents\\Paradox Interactive\\${this.profile.userFolder}`; }
  get talkHint() {
    return {
      en: `In game: ${this.profile.talkInGame.en}. Or press the talk hotkey and pick someone. Agreed actions are applied automatically.`,
      zh: `游戏里：${this.profile.talkInGame.zh}。也可以按对话快捷键选人。谈妥的动作会自动执行。`,
    };
  }

  /** main.ts tells the adapter whether the game window is in front (for typing into its console). */
  setGameFocusProbe(probe: () => boolean): void {
    this.gameFocused = probe;
  }

  protected userDir(): string | null {
    const dir = settingsRepository.getCK3UserFolderPath();
    return dir ? dir : null;
  }

  private installDir(): string | null {
    return findSteamGame(this.profile.steamFolder, (d) => this.profile.exeNames.some((e) => exists(path.join(d, e)) || exists(path.join(d, 'binaries', e))) || exists(path.join(d, 'game')));
  }

  // ------------------------------------------------------------ folders

  isValidFolder(dir: string | null | undefined): boolean {
    if (!dir) return false;
    // the Documents folder the game creates on first launch
    return exists(path.join(dir, 'logs')) || exists(path.join(dir, 'save games')) || exists(path.join(dir, 'mod'));
  }

  normalizeFolder(dir: string): string {
    if (!this.isValidFolder(dir) && this.isValidFolder(path.dirname(dir))) return path.dirname(dir);
    return dir;
  }

  detectFolder(configured: string | null | undefined): FolderDetection {
    if (configured && this.isValidFolder(configured)) return { path: configured, source: 'configured' };
    for (const candidate of paradoxUserDir(this.profile.userFolder)) {
      if (this.isValidFolder(candidate)) return { path: candidate, source: 'documents' };
    }
    return {
      path: null,
      source: 'not_found',
      error: `Documents\\Paradox Interactive\\${this.profile.userFolder} was not found. Start ${this.profile.name.en} once, then select that folder.`,
    };
  }

  checkSetup(dir: string): GameSetupWarning[] {
    const warnings: GameSetupWarning[] = [];
    const modDir = path.join(dir, 'mod', this.profile.modFolder);
    if (!exists(modDir) && !exists(path.join(dir, 'mod', `${this.profile.modFolder}.mod`))) {
      warnings.push({
        type: 'mod_missing',
        message: `The ${this.profile.modFolder} mod was not found in ${path.join(dir, 'mod')}`,
        suggestion: `Copy the ${this.profile.modFolder} folder and ${this.profile.modFolder}.mod (from the app's mods folder) into ${path.join(dir, 'mod')} and enable it in the launcher playset. (Ignore this if you subscribed to it on the Steam Workshop.)`,
      });
    }
    if (this.profile.needsDebugMode) {
      warnings.push({
        type: 'debug_mode',
        message: `${this.profile.name.en} applies agreed actions only with the ${debugFlag(this.profile.id)} launch option`,
        suggestion: `In Steam: right-click ${this.profile.name.en} > Properties > Launch options, enter ${debugFlag(this.profile.id)}. The game then reloads the mod's action file by itself; no console is used.`,
      });
    }
    const err = testWritable(dir);
    if (err) {
      warnings.push({ type: 'permission', message: `Cannot write to ${dir}: ${err}`, suggestion: 'Run the application as Administrator, or check the folder permissions.' });
    }
    return warnings;
  }

  isGameWindow(w: WindowInfo): boolean {
    const name = w.name.toLowerCase();
    const p = w.path.toLowerCase();
    return this.profile.exeNames.some((e) => p.endsWith(e)) || this.profile.windowMatch.some((m) => name.includes(m) || p.includes(m));
  }

  // ------------------------------------------------------------ lifecycle

  start(): void {
    this.stop();
    const dir = this.userDir();
    if (!dir) return;
    this.followers = this.profile.logFiles.map((rel) => new LogFollower(path.join(dir, rel), (line, backlog) => {
      // the old log only brings data: its talk requests were answered (or dropped) long ago
      this.replaying = backlog;
      this.feedLine(line);
      this.replaying = false;
    }));
    const tick = () => {
      for (const f of this.followers) f.poll();
      this.dropExpired();
      this.autoRun();
    };
    tick();
    this.timer = setInterval(tick, POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.followers = [];
  }

  clear(): void {
    this.pending = [];
    this.writeRunFiles();
  }

  // ------------------------------------------------------------ game -> app

  private onSnapshot(s: PdxSnapshot): void {
    if (s.game && s.game !== this.profile.id) return;
    this.snapshot = s;
    this.remember(s.characters);
    const seq = Number(s.meta.seq);
    if (Number.isFinite(seq)) this.lastSeq = Math.max(this.lastSeq, seq);
    console.log(`ParadoxAdapter(${this.profile.id}): snapshot (${s.reason}) with ${s.countries.length} countries, ${s.characters.length} characters, player ${s.player.tag}`);
    this.emit('snapshot', s);
    if (s.talk && !this.replaying) this.onTalkRequest(s);
  }

  /** Right-click Talk / the in-game talk button: start the conversation or open the picker. */
  private onTalkRequest(s: PdxSnapshot): void {
    const t = s.talk!;
    this.diagnostic(`talk request from the game: ${t.mode} ${t.tag} ${t.name}`);
    if (t.mode === 'character') {
      this.lastTalker = personKey(t.tag, t.name);
      if (this.people.has(personKey(t.tag, t.name))) {
        this.emit('talk-request', { targetId: personTargetId({ tag: t.tag, name: t.name }) });
        return;
      }
      // a ruler known only as a country's leader
      const c = s.countries.find((x) => x.tag === t.tag);
      if (c && c.leader === t.name) {
        this.emit('talk-request', { targetId: t.tag });
        return;
      }
    }
    this.emit('talk-request', { pick: true, tag: t.mode === 'country' ? t.tag : '' });
  }

  private remember(people: PdxPerson[]): void {
    for (const p of people) {
      const key = personKey(p.tag, p.name);
      this.people.delete(key); // re-insert so the newest stay
      this.people.set(key, p);
    }
    while (this.people.size > MAX_PEOPLE) {
      this.people.delete(this.people.keys().next().value as string);
    }
  }

  private onAck(seq: number): void {
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => p.seq > seq);
    if (this.pending.length !== before) {
      this.diagnostic(`game acknowledged commands up to #${seq}`);
      this.typeAttempts = 0;
      this.writeRunFiles();
      this.emit('commands-pending', this.pending.length);
    }
  }

  /** Result lines are written by the guarded commands themselves. */
  private onResultLine(line: string): void {
    const m = /VOTC\|RES\|(\d+)\|(ok|fail)\|([a-z_]+)/.exec(line);
    if (!m) return;
    this.diagnostic(`result #${m[1]} ${m[3]}: ${m[2]}`);
    if (m[2] === 'fail') {
      this.emit('command-failed', { op: m[3], message: 'the game did not apply it (the outcome check failed)' });
    }
  }

  latestSnapshot(): PdxSnapshot | null {
    return this.snapshot;
  }

  /**
   * Leaders and characters the player can talk to, from the snapshots so far (empty before
   * the first one). `tag` limits the list to one country.
   */
  listTalkTargets(tag?: string): TalkTarget[] {
    if (!this.snapshot) return [];
    const own = this.snapshot.player.tag;
    return talkTargets(this.snapshot, [...this.people.values()]).filter((t) => !tag || t.tag === tag).map((t) => {
      const status = [
        t.atWar ? 'war' : '',
        t.allied ? 'ally' : '',
        t.subject ? 'subject' : '',
        t.overlord ? 'overlord' : '',
        t.opinion !== null ? `opinion ${t.opinion}` : '',
      ].filter(Boolean).join(', ');
      const group = t.tag === own ? 'own' : t.person ? 'people' : 'leaders';
      return { id: t.id, name: t.name, leader: t.leader, leaderTitle: t.leaderTitle, status, group };
    });
  }

  // ------------------------------------------------------------ conversation

  async loadGameData(options: LoadOptions): Promise<LoadResult> {
    const zh = options.lang === 'zh';
    const s = this.snapshot;
    if (!s) {
      return {
        ok: false,
        title: zh ? `还没有收到${this.profile.name.zh}的数据` : `No data from ${this.profile.name.en} yet`,
        details: zh
          ? `请确认已启用 ${this.profile.modFolder} 模组并载入存档，让游戏至少运行一个月（或在游戏里点一次 VOTC 交谈按钮），然后再试。`
          : `Make sure the ${this.profile.modFolder} mod is enabled and a save is loaded, let one in-game month pass (or use the VOTC talk button in the game once), then try again.`,
      };
    }
    const id = options.targetId;
    try {
      if (!id) throw new Error('no target');
      const gameData = buildGameDataFromPdx(s, id, this.profile, options.lang, this.people);
      // what the actions may offer: the game's equipment, traits... including the enabled mods'
      if (gameData.pdx) gameData.pdx.content = gameContent(this.profile.id);
      if (gameData.pdx) gameData.pdx.talkerInGame = !!this.lastTalker && id === personTargetId(this.people.get(this.lastTalker) ?? { tag: '', name: '' });
      return { ok: true, gameData };
    } catch (error) {
      console.warn(`ParadoxAdapter(${this.profile.id}): cannot talk to ${id}:`, error);
      return {
        ok: false,
        title: zh ? '请选择对话对象' : 'Pick someone to talk to',
        details: zh ? '游戏还没有报告这个人物。请在游戏里再点一次“交谈”，或重新选择。' : 'The game has not reported that character. Use Talk in the game again, or pick again.',
      };
    }
  }

  runGameEffect(command: GameCommand): void {
    let cmd: unknown = command;
    if (typeof command === 'string') {
      try {
        cmd = JSON.parse(command);
      } catch {
        throw new Error('Game effects must be command objects like { op: "war", a: "GER", b: "FRA" }; raw script is not accepted');
      }
    }
    if (!cmd || typeof cmd !== 'object' || typeof (cmd as { op?: unknown }).op !== 'string') {
      throw new Error('Game effect must be a command object with an op');
    }
    const compiled = compileCommand(this.profile.id, cmd as PdxCommand, gameContent(this.profile.id));
    const minutes = Math.floor((Date.now() - SEQ_EPOCH) / 60000);
    this.lastSeq = Math.max(this.lastSeq + 1, minutes);
    this.pending.push({ seq: this.lastSeq, op: (cmd as PdxCommand).op, compiled, queuedAt: Date.now() });
    this.typeAttempts = 0;
    this.writeRunFiles();
    this.diagnostic(`queued ${(cmd as PdxCommand).op} #${this.lastSeq} ${JSON.stringify(cmd)}`);
    this.emit('commands-pending', this.pending.length);
  }

  pendingCount(): number {
    return this.pending.length;
  }

  get runCommand(): string {
    return this.profile.runCommand;
  }

  /** The app applies queued actions by itself (the player never has to type the command). */
  get autoApplies(): boolean {
    return this.profile.autoRun === 'gui' || process.platform === 'win32';
  }

  /**
   * Apply queued actions without the player: type the run command into the console once the
   * game has been in front for a moment ('keys' games), or when the mod's own GUI timer has
   * not answered in time ('gui' games, e.g. without the -debug_mode launch option).
   */
  private autoRun(): void {
    if (this.profile.consoleTyping === false) return;
    if (this.pending.length === 0 || !this.gameFocused()) {
      this.focusedSince = 0;
      return;
    }
    const now = Date.now();
    if (!this.focusedSince) this.focusedSince = now;
    if (now - this.focusedSince < FOCUS_SETTLE_MS) return;
    if (this.typeAttempts >= MAX_TYPE_ATTEMPTS || now - this.lastTypeAt < TYPE_RETRY_MS) return;
    if (this.profile.autoRun === 'gui' && now - this.pending[0].queuedAt < GUI_FALLBACK_MS) return;
    this.typeAttempts++;
    this.lastTypeAt = now;
    this.diagnostic(`typing "${this.profile.runCommand}" into the game console (attempt ${this.typeAttempts})`);
    void typeConsoleCommand(this.profile.runCommand).then((sent) => {
      if (!sent) this.diagnostic('could not type into the game console');
    });
  }

  private dropExpired(): void {
    const now = Date.now();
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => now - p.queuedAt < PENDING_TTL_MS);
    if (before !== this.pending.length) {
      this.diagnostic(`dropped ${before - this.pending.length} command(s) that were never run`);
      this.writeRunFiles();
      this.emit('commands-pending', this.pending.length);
    }
  }

  private runFilePaths(): string[] {
    const dir = this.userDir();
    const files: string[] = [];
    if (dir) files.push(...this.profile.runFiles.user.map((rel) => path.join(dir, rel)));
    const install = this.profile.runFiles.install ? this.installDir() : null;
    if (install) files.push(...this.profile.runFiles.install!.map((rel) => path.join(install, rel)));
    return files;
  }

  private writeRunFiles(): void {
    const content = (runFileEncoding(this.profile.id).bom ? '\uFEFF' : '') + buildRunFile(this.profile.id, this.pending);
    const dir = this.userDir();
    for (const file of this.runFilePaths()) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // write and rename, so the game (or its file watcher) never reads half a file; the
        // temporary file stays outside the mod folder, which the file watcher watches
        const tmp = dir && file.startsWith(dir) ? path.join(dir, `.votc_${path.basename(file)}.tmp`) : `${file}.tmp`;
        fs.writeFileSync(tmp, content, 'utf-8');
        fs.renameSync(tmp, file);
      } catch (error) {
        // the install folder may be read-only; the user folder copy is enough
        console.warn(`ParadoxAdapter: could not write ${file}:`, error);
      }
    }
  }

  // ------------------------------------------------------------ diagnostics

  diagnosticFiles(dir: string): string[] {
    return [...this.profile.logFiles.map((rel) => path.join(dir, rel)), ...this.runFilePaths(), path.join(dir, DIAGNOSTIC_FILE)];
  }

  diagnostic(message: string): void {
    try {
      const dir = this.userDir();
      if (!dir) return;
      const file = path.join(dir, DIAGNOSTIC_FILE);
      try {
        if (fs.statSync(file).size > DIAGNOSTIC_MAX_BYTES) {
          const text = fs.readFileSync(file, 'utf-8');
          fs.writeFileSync(file, text.slice(text.length / 2), 'utf-8');
        }
      } catch { /* missing file */ }
      fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf-8');
    } catch { /* diagnostics must never break the app */ }
  }

  /** Every VOTC line of the game log: snapshot parts, acknowledgements and command results. */
  feedLine(line: string): void {
    this.parser.feed(line);
    if (line.includes('VOTC|RES|')) this.onResultLine(line);
  }
}
