import fs from 'fs';
import path from 'path';
import { clipboard } from 'electron';
import { EventEmitter } from 'events';
import { settingsRepository } from '../../SettingsRepository';
import type { GameCommand } from '../../actions/types';
import type { GameData } from '../../gameData/GameData';
import { parseLog } from '../../gameData/parseLog';
import { paradoxUserDir, steamWorkshopDirs, exists, testWritable } from '../steam';
import type {
  EffectContext, FolderDetection, GameAdapter, GameSetupWarning, LoadOptions, LoadResult, WindowInfo,
} from '../types';

const CK3_FOLDER = 'Crusader Kings III';
const CK3_APP_ID = '1158310';
/** A file of the Voices of the Court mod, to recognise it in the workshop or mod folder. */
const MOD_MARKER = path.join('events', 'mcc_events_v2.txt');
const CLIPBOARD_POLL_MS = 100;

/**
 * The CK3 mod copies "VOTC:<command>" to the clipboard (CK3 GUI scripts cannot write files);
 * the app restores the player's clipboard right after reading it.
 */
class ClipboardListener extends EventEmitter {
  private previous: string;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    const text = clipboard.readText();
    if (text.startsWith('VOTC:')) {
      clipboard.writeText('');
      this.previous = '';
    } else {
      this.previous = text;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.read(), CLIPBOARD_POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private read(): void {
    const current = clipboard.readText();
    if (current === this.previous) return;
    if (current.startsWith('VOTC:')) {
      this.emit(current.split(':')[1]);
      clipboard.writeText(this.previous);
    } else {
      this.previous = current;
    }
  }
}

/** How long after the mod ran the effects the app looks for their confirmations. */
const CONFIRM_DELAY_MS = 2500;
/** Only the end of the logs can hold the confirmations of the last run. */
const LOG_TAIL_BYTES = 1024 * 1024;
const DIAGNOSTIC_FILE = 'votc_app_log.txt';
const DIAGNOSTIC_MAX_BYTES = 256 * 1024;

/** Reads the last `bytes` of a file ('' when it does not exist). */
function readTail(file: string, bytes: number): string {
  let fd: number | null = null;
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - bytes);
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf-8');
  } catch {
    return '';
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Crusader Kings III through the original Voices of the Court mod (Steam Workshop 3346777360):
 * the mod logs the scene into debug.log and signals through the clipboard, the app answers
 * with effects in run\votc.txt which the mod runs with `run votc.txt`.
 *
 * Beyond the original app, every effect ends with a confirmation line (VOTC|RES|<seq>) in
 * debug.log; after the mod ran the file the app checks the confirmations and error.log, and
 * reports actions that did not run or raised script errors instead of failing silently.
 *
 * Events: 'talk' (VOTC:IN), 'letter' (VOTC:LETTER), 'letter-accepted' (VOTC:LETTER_ACCEPTED),
 * 'command-failed'.
 */
export class Ck3Adapter extends EventEmitter implements GameAdapter {
  readonly id = 'ck3' as const;
  readonly family = 'ck3' as const;
  readonly name = { en: 'Crusader Kings III', zh: '十字军之王3' };
  readonly folderKind = 'documents' as const;
  readonly folderExample = 'C:\\Users\\<you>\\Documents\\Paradox Interactive\\Crusader Kings III';
  readonly talkHint = {
    en: 'Use the "Talk" interaction on a character in CK3 (launch CK3 with -debug_mode).',
    zh: '在十字军之王3里对角色使用“交谈”互动（需用 -debug_mode 启动游戏）。',
  };
  readonly promptVariants = ['ck3'];

  private clipboardListener: ClipboardListener | null = null;
  /** effects written to the run file and not yet confirmed */
  private unconfirmed: Array<{ seq: number; label: string }> = [];
  private seq = Math.floor(Date.now() / 1000);
  private confirmTimer: NodeJS.Timeout | null = null;

  private userDir(): string | null {
    const dir = settingsRepository.getCK3UserFolderPath();
    return dir ? dir : null;
  }

  private runFile(): string | null {
    const dir = this.userDir();
    return dir ? path.join(dir, 'run', 'votc.txt') : null;
  }

  isValidFolder(dir: string | null | undefined): boolean {
    if (!dir) return false;
    return exists(path.join(dir, 'logs')) || exists(path.join(dir, 'save games')) || exists(path.join(dir, 'mod'));
  }

  normalizeFolder(dir: string): string {
    if (!this.isValidFolder(dir) && this.isValidFolder(path.dirname(dir))) return path.dirname(dir);
    return dir;
  }

  detectFolder(configured: string | null | undefined): FolderDetection {
    if (configured && this.isValidFolder(configured)) return { path: configured, source: 'configured' };
    // several Documents folders can exist (OneDrive); the one CK3 wrote to last wins
    const candidates = paradoxUserDir(CK3_FOLDER)
      .filter((d) => this.isValidFolder(d))
      .map((d) => {
        let mtime = 0;
        try { mtime = fs.statSync(path.join(d, 'logs', 'debug.log')).mtimeMs; } catch { /* no log yet */ }
        return { d, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    if (candidates.length) return { path: candidates[0].d, source: 'documents' };
    return { path: null, source: 'not_found', error: 'Documents\\Paradox Interactive\\Crusader Kings III was not found. Start CK3 once, then select that folder.' };
  }

  checkSetup(dir: string): GameSetupWarning[] {
    const warnings: GameSetupWarning[] = [];
    const debugLog = path.join(dir, 'logs', 'debug.log');
    if (!exists(debugLog)) {
      warnings.push({
        type: 'debug_mode',
        message: `debug.log was not found in ${path.join(dir, 'logs')}`,
        suggestion: 'Launch CK3 with the -debug_mode launch option (Steam > Properties > Launch options) at least once.',
      });
    }
    const modDir = path.join(dir, 'mod');
    const localMod = (() => {
      try {
        return fs.readdirSync(modDir).some((m) => exists(path.join(modDir, m, MOD_MARKER)));
      } catch {
        return false;
      }
    })();
    const workshopMod = steamWorkshopDirs(CK3_APP_ID).some((ws) => {
      try {
        return fs.readdirSync(ws).some((item) => exists(path.join(ws, item, MOD_MARKER)));
      } catch {
        return false;
      }
    });
    if (!localMod && !workshopMod) {
      warnings.push({
        type: 'mod_missing',
        message: 'The Voices of the Court CK3 mod was not found',
        suggestion: 'Subscribe to "Voices of the Court" on the Steam Workshop and enable it in the CK3 launcher.',
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
    return name.includes('ck3') || name.includes('crusader kings') || p.endsWith('ck3.exe') || p.includes('crusader kings iii');
  }

  start(): void {
    this.stop();
    const listener = new ClipboardListener();
    listener.on('IN', () => this.emit('talk'));
    // the mod ran the effects: empty the run file so they never run twice, then check them
    listener.on('EFFECT_ACCEPTED', () => this.onEffectsRan());
    listener.on('LETTER', () => this.emit('letter'));
    listener.on('LETTER_ACCEPTED', () => this.emit('letter-accepted'));
    listener.start();
    this.clipboardListener = listener;
  }

  stop(): void {
    this.clipboardListener?.stop();
    this.clipboardListener = null;
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
  }

  private onEffectsRan(): void {
    const ran = this.unconfirmed;
    this.unconfirmed = [];
    const dir = this.userDir();
    const errorLogStart = dir ? this.fileSize(path.join(dir, 'logs', 'error.log')) : 0;
    this.writeRunFile('');
    if (!ran.length || !dir) return;
    this.diagnostic(`the mod ran ${ran.length} effect(s): ${ran.map((r) => `#${r.seq}`).join(' ')}`);
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = setTimeout(() => {
      this.confirmTimer = null;
      this.checkConfirmations(dir, ran, errorLogStart);
    }, CONFIRM_DELAY_MS);
  }

  private fileSize(file: string): number {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  /** Did every effect log its confirmation, and did CK3 report script errors in the run file? */
  private checkConfirmations(dir: string, ran: Array<{ seq: number; label: string }>, errorLogStart: number): void {
    const debugTail = readTail(path.join(dir, 'logs', 'debug.log'), LOG_TAIL_BYTES);
    const errorLog = path.join(dir, 'logs', 'error.log');
    const errorSize = this.fileSize(errorLog);
    // the effects' errors were written after the run started (a new log restarts at 0)
    const errors = readTail(errorLog, Math.min(LOG_TAIL_BYTES, errorSize >= errorLogStart ? errorSize - errorLogStart : errorSize))
      .split('\n')
      .filter((l) => /votc\.txt/i.test(l))
      // "[12:00:00][jomini_script_system.cpp:283]: Script system error! Error: ..." -> "Error: ..."
      .map((l) => l.replace(/^(\[[^\]]*\]\s*)+:?\s*/, '').replace(/^Script system error!\s*/i, '').trim())
      .filter(Boolean);
    for (const r of ran) {
      if (!debugTail.includes(`VOTC|RES|${r.seq}|`)) {
        this.diagnostic(`effect #${r.seq} (${r.label}) was not confirmed`);
        this.emit('command-failed', { op: r.label, message: 'CK3 did not confirm this action; it may not have happened (see error.log).' });
      } else {
        this.diagnostic(`effect #${r.seq} (${r.label}) confirmed`);
      }
    }
    if (errors.length) {
      const unique = [...new Set(errors)].slice(0, 3);
      this.diagnostic(`script errors in the run file: ${unique.join(' | ')}`);
      this.emit('command-failed', { op: ran.map((r) => r.label).join(', '), message: `CK3 reported script errors: ${unique.join('; ')}` });
    }
  }

  clear(): void {
    this.unconfirmed = [];
    this.writeRunFile('');
  }

  private writeRunFile(content: string): void {
    const file = this.runFile();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf-8');
    } catch (error) {
      console.warn('Ck3Adapter: could not write the run file:', error);
    }
  }

  async loadGameData(options: LoadOptions): Promise<LoadResult> {
    const zh = options.lang === 'zh';
    const dir = this.userDir();
    if (!dir) {
      return { ok: false, title: zh ? '未设置十字军之王3文件夹' : 'CK3 folder is not configured', details: zh ? '请在设置中选择 文档\\Paradox Interactive\\Crusader Kings III。' : 'Select Documents\\Paradox Interactive\\Crusader Kings III in the settings.' };
    }
    const debugLog = path.join(dir, 'logs', 'debug.log');
    if (!exists(debugLog)) {
      return { ok: false, title: zh ? '找不到 debug.log' : 'Debug Log Not Found', details: zh ? '请用 -debug_mode 启动十字军之王3。' : 'Launch CK3 with the -debug_mode launch option.' };
    }
    this.clear();
    try {
      const gameData = await parseLog(debugLog);
      gameData.game = 'ck3';
      return { ok: true, gameData };
    } catch (error) {
      return { ok: false, title: zh ? '读取游戏数据失败' : 'Failed to read the game data', details: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * CK3 actions pass effect script (the original VOTC action format). Source and target are
   * scoped through the mod's ordered character list, exactly like the original app.
   */
  runGameEffect(command: GameCommand, context?: EffectContext): void {
    if (typeof command !== 'string') {
      throw new Error('CK3 effects are script text');
    }
    const file = this.runFile();
    if (!file) throw new Error('CK3 folder is not configured');
    const seq = ++this.seq;
    const label = context?.label || 'game effect';
    // the confirmation runs after the effect, in the same scope as the console
    const confirm = `debug_log = "VOTC|RES|${seq}|ok|ck3"`;
    const effect = context
      ? `${scopePrelude(context.gameData, context.sourceCharacterId, context.targetCharacterId)}\n${command}\n${confirm}\n`
      : `${command}\n${confirm}\n`;
    this.unconfirmed.push({ seq, label });
    this.diagnostic(`queued effect #${seq} (${label})`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const current = exists(file) ? fs.readFileSync(file, 'utf-8') : '';
    // the trailing event tells the mod's GUI that effects are waiting (it answers VOTC:EFFECT_ACCEPTED)
    const content = current.trim() === ''
      ? `${effect}\nroot = {trigger_event = mcc_event_v2.9003}`
      : `${effect}\n${current}`;
    fs.writeFileSync(file, content, 'utf-8');
  }

  diagnosticFiles(dir: string): string[] {
    return [...['debug.log', 'game.log', 'error.log'].map((n) => path.join(dir, 'logs', n)), path.join(dir, 'run', 'votc.txt'), path.join(dir, DIAGNOSTIC_FILE)];
  }

  diagnostic(message: string): void {
    console.log(`[ck3] ${message}`);
    try {
      const dir = this.userDir();
      if (!dir) return;
      const file = path.join(dir, DIAGNOSTIC_FILE);
      if (this.fileSize(file) > DIAGNOSTIC_MAX_BYTES) {
        const text = fs.readFileSync(file, 'utf-8');
        fs.writeFileSync(file, text.slice(text.length / 2), 'utf-8');
      }
      fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf-8');
    } catch { /* diagnostics must never break the app */ }
  }
}

/** 0-based position of a character in the mod's mcc_characters_list_v2 (the GameData order). */
function characterIndex(gameData: GameData, characterId: number): number {
  const idx = Array.from(gameData.characters.keys()).indexOf(characterId);
  if (idx === -1) throw new Error(`Character id ${characterId} not found in GameData.characters`);
  return idx;
}

function scopePrelude(gameData: GameData, sourceId: number, targetId: number | null | undefined): string {
  let prelude = `
ordered_in_global_list = {
    variable = mcc_characters_list_v2
    position = ${characterIndex(gameData, sourceId)}
    set_global_variable = {
        name = votc_action_source
        value = this
    }
}
`;
  if (targetId == null) return prelude;
  if (targetId === gameData.playerID) {
    prelude += `
root = {
    set_global_variable = {
        name = votc_action_target
        value = root
    }
}
`;
  } else {
    prelude += `
ordered_in_global_list = {
    variable = mcc_characters_list_v2
    position = ${characterIndex(gameData, targetId)}
    set_global_variable = {
        name = votc_action_target
        value = this
    }
}
`;
  }
  return prelude;
}
