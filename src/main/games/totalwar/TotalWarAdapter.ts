import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import type { GameCommand } from '../../actions/types';
import { findSteamGame, steamWorkshopDirs, exists, testWritable } from '../steam';
import type {
  FolderDetection, GameAdapter, GameId, GameSetupWarning, LoadOptions, LoadResult, Localized, WindowInfo,
} from '../types';
import { TotalWarBridge, TotalWarBridgeError, BridgeCommand } from './TotalWarBridge';
import { buildGameDataFromWh3, describeExportError, TotalWarProfile } from './buildGameData';
import { WH3_FILES, Wh3CommandResult, Wh3State } from './types';

/** Install-side facts about one Total War game. */
export interface TotalWarInstall {
  id: GameId;
  name: Localized;
  shortName: string;
  steamFolder: string;
  steamAppId: string;
  exeName: string;
  /** the mod pack the player enables in the launcher */
  packName: string;
  modName: string;
  /** window title / path fragments that identify the game window */
  windowMatch: string[];
  /** ops of the Lua bridge's EXECUTORS table (export is used by the app itself) */
  ops: string[];
  profile: TotalWarProfile;
  /**
   * Games whose scripts cannot localise (Attila): extra export fields, and a pass that fills
   * in the {{loc_key}} tokens of the answer and returns the profile to use for it.
   */
  localization?: {
    exportFields(dir: string): Record<string, string>;
    localize(state: Wh3State, dir: string): { state: Wh3State; profile: TotalWarProfile };
  };
}

/**
 * Warhammer III, Three Kingdoms and Attila: a Lua campaign mod polls votc_commands.lua in the
 * install folder and answers with votc_state.json / votc_ack.json (see TotalWarBridge).
 */
export class TotalWarAdapter extends EventEmitter implements GameAdapter {
  readonly family = 'totalwar' as const;
  readonly folderKind = 'install' as const;
  readonly promptVariants: string[];
  readonly bridge: TotalWarBridge;
  private knownOps: Set<string>;

  constructor(private install: TotalWarInstall) {
    super();
    this.promptVariants = [install.id, 'totalwar'];
    this.bridge = new TotalWarBridge(install.shortName, install.modName);
    this.knownOps = new Set(install.ops);
    this.bridge.on('command-failed', (r: Wh3CommandResult) => this.emit('command-failed', { op: r.op, message: r.message }));
  }

  get id() { return this.install.id; }
  get name() { return this.install.name; }
  get folderExample() { return `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${this.install.steamFolder}`; }
  get talkHint() {
    return {
      en: 'Select a character in the campaign, then press the talk hotkey.',
      zh: '在战役中选中一个角色，然后按对话快捷键。',
    };
  }

  isValidFolder(dir: string | null | undefined): boolean {
    if (!dir) return false;
    return exists(path.join(dir, this.install.exeName)) && exists(path.join(dir, 'data'));
  }

  normalizeFolder(dir: string): string {
    // accept the data/ subfolder by mistake too
    if (!this.isValidFolder(dir) && this.isValidFolder(path.dirname(dir))) return path.dirname(dir);
    return dir;
  }

  detectFolder(configured: string | null | undefined): FolderDetection {
    if (configured && this.isValidFolder(configured)) return { path: configured, source: 'configured' };
    const found = findSteamGame(this.install.steamFolder, (d) => this.isValidFolder(d));
    if (found) return { path: found, source: 'steam_library' };
    return {
      path: null,
      source: 'not_found',
      error: configured
        ? `The configured folder does not contain ${this.install.exeName}: ${configured}`
        : `${this.install.name.en} install folder was not found`,
    };
  }

  checkSetup(dir: string): GameSetupWarning[] {
    const warnings: GameSetupWarning[] = [];
    const pack = this.install.packName;
    const inData = exists(path.join(dir, 'data', pack));
    const inWorkshop = steamWorkshopDirs(this.install.steamAppId).some((ws) => {
      try {
        return fs.readdirSync(ws).some((item) => exists(path.join(ws, item, pack)));
      } catch {
        return false;
      }
    });
    if (!inData && !inWorkshop) {
      warnings.push({
        type: 'mod_missing',
        message: `${pack} was not found in ${path.join(dir, 'data')}`,
        suggestion: `Copy ${pack} into the game's data folder and enable it in the ${this.install.shortName} launcher's mod manager. (Ignore this if you installed it from the Steam Workshop.)`,
      });
    }
    const err = testWritable(dir);
    if (err) {
      warnings.push({
        type: 'permission',
        message: `Cannot write to the ${this.install.shortName} folder: ${err}`,
        suggestion: 'Run the application as Administrator, or move the game out of a protected folder.',
      });
    }
    return warnings;
  }

  isGameWindow(w: WindowInfo): boolean {
    const name = w.name.toLowerCase();
    const p = w.path.toLowerCase();
    return p.endsWith(this.install.exeName.toLowerCase()) || this.install.windowMatch.some((m) => name.includes(m) || p.includes(m));
  }

  start(): void { /* the bridge only polls while commands are pending */ }

  stop(): void {
    this.bridge.dispose();
  }

  clear(): void {
    this.bridge.clear();
  }

  async loadGameData(options: LoadOptions): Promise<LoadResult> {
    const zh = options.lang === 'zh';
    try {
      // drop anything left over from a previous conversation before asking for fresh state
      this.bridge.clear();
      const dir = this.bridge.getGameDir() ?? '';
      const l10n = this.install.localization;
      const raw = await this.bridge.requestExport(undefined, undefined, options.gameInBackground, l10n ? l10n.exportFields(dir) : {});
      if (!raw.ok) {
        return {
          ok: false,
          title: zh ? '无法开始对话' : 'Cannot start conversation',
          details: describeExportError(raw.error, options.lang, this.install.profile),
        };
      }
      const { state, profile } = l10n ? l10n.localize(raw, dir) : { state: raw, profile: this.install.profile };
      return { ok: true, gameData: buildGameDataFromWh3(state, options.lang, profile) };
    } catch (error) {
      return {
        ok: false,
        title: error instanceof TotalWarBridgeError && error.code === 'timeout'
          ? (zh ? `${this.install.name.zh}没有响应` : `${this.install.shortName} is not responding`)
          : (zh ? '无法开始对话' : 'Failed to initialize conversation'),
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  runGameEffect(command: GameCommand): void {
    this.bridge.queueCommand(this.parseCommand(command));
  }

  /** Validate an action effect against this game's ops; throws with a readable message. */
  parseCommand(command: GameCommand): BridgeCommand {
    let cmd: unknown = command;
    if (typeof command === 'string') {
      try {
        cmd = JSON.parse(command);
      } catch {
        throw new Error(`Game effect must be a command object, got text: ${command.slice(0, 80)}`);
      }
    }
    if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) {
      throw new Error('Game effect must be a command object');
    }
    const op = (cmd as { op?: unknown }).op;
    if (typeof op !== 'string' || !this.knownOps.has(op)) {
      throw new Error(`Unknown game command op for ${this.install.shortName}: ${String(op)}`);
    }
    for (const [key, value] of Object.entries(cmd as Record<string, unknown>)) {
      const t = typeof value;
      if (value !== null && value !== undefined && t !== 'string' && t !== 'number' && t !== 'boolean') {
        throw new Error(`Game command field "${key}" must be a string, number or boolean`);
      }
      if (t === 'number' && !Number.isFinite(value as number)) {
        throw new Error(`Game command field "${key}" is not a finite number`);
      }
    }
    return cmd as BridgeCommand;
  }

  diagnosticFiles(dir: string): string[] {
    return ['lua_mod_log.txt', 'votc_log.txt', WH3_FILES.appLog, WH3_FILES.state, WH3_FILES.ack, WH3_FILES.commands].map((n) => path.join(dir, n));
  }

  diagnostic(message: string): void {
    this.bridge.diagnostic(message);
  }
}
