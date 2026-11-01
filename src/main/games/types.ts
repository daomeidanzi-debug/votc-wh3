import type { EventEmitter } from 'events';
import type { GameData } from '../gameData/GameData';
import type { GameCommand } from '../actions/types';

/**
 * Every game this app can talk to. One build supports all of them; the active game is
 * picked in the settings and decides which bridge, actions and prompts are used.
 */
export type GameId = 'ck3' | 'wh3' | 'tk' | 'attila' | 'hoi4' | 'vic3' | 'eu5' | 'stellaris' | 'civ6';

export const GAME_IDS: GameId[] = ['ck3', 'wh3', 'tk', 'attila', 'hoi4', 'vic3', 'eu5', 'stellaris', 'civ6'];

/**
 * Engine families share a bridge and default prompts:
 *  - totalwar: Lua campaign scripts, file bridge in the install folder (WH3, Three Kingdoms, Attila)
 *  - ck3:      the original Voices of the Court mod (debug.log + clipboard + run file)
 *  - paradox:  script mods that log a snapshot and run whitelisted commands (HOI4, Vic3, EU5, Stellaris);
 *              Civilization VI uses the same log format (Lua.log) and runs its commands over FireTuner
 */
export type GameFamily = 'totalwar' | 'ck3' | 'paradox';

const FAMILY: Record<GameId, GameFamily> = {
  ck3: 'ck3', wh3: 'totalwar', tk: 'totalwar', attila: 'totalwar',
  hoi4: 'paradox', vic3: 'paradox', eu5: 'paradox', stellaris: 'paradox', civ6: 'paradox',
};

export function gameFamily(game: GameId): GameFamily {
  return FAMILY[game];
}

/**
 * Folders searched for game-specific prompt files, most specific first: for
 * `character_description/standard/x.js` and Three Kingdoms, `standard/tk/x.js`, then
 * `standard/totalwar/x.js`, then the file itself.
 */
export function promptVariantsFor(game: GameId): string[] {
  return game === 'ck3' ? ['ck3'] : [game, FAMILY[game]];
}

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as string[]).includes(value);
}

export interface Localized {
  en: string;
  zh: string;
}

export function pick(text: Localized, lang: string): string {
  return lang === 'zh' ? text.zh : text.en;
}

export interface GameSetupWarning {
  type: 'permission' | 'path_not_found' | 'path_detection' | 'mod_missing' | 'debug_mode';
  message: string;
  suggestion?: string;
}

export interface FolderDetection {
  path: string | null;
  source: 'configured' | 'steam_library' | 'documents' | 'not_found';
  error?: string;
}

export type LoadResult =
  | { ok: true; gameData: GameData }
  | { ok: false; title: string; details: string };

export interface LoadOptions {
  lang: string;
  /** true while the game is not the foreground window (Total War pauses scripts then) */
  gameInBackground: () => boolean;
  /** the partner the player picked in the app (Paradox games: a country tag) */
  targetId?: string;
}

/** Who an action effect is about; CK3 needs it to scope its script. */
export interface EffectContext {
  gameData: GameData;
  sourceCharacterId: number;
  targetCharacterId?: number | null;
  /** the action that produced the effect, for failure reports */
  label?: string;
}

/** A command the game reported as failed, or one that could not be delivered. */
export interface CommandFailure {
  op: string;
  message: string;
}

/** A conversation partner offered in the app's picker. */
export interface TalkTarget {
  id: string;
  name: string;
  leader: string;
  leaderTitle: string;
  /** short relation summary, e.g. "at war", "ally", "opinion 40" */
  status: string;
  /** 'own' (the player's people), 'leaders' (heads of other countries), 'people' (other characters) */
  group?: 'own' | 'leaders' | 'people';
}

/** The player asked to talk from inside the game (a Paradox game's button or interaction). */
export interface TalkRequest {
  /** start this conversation directly */
  targetId?: string;
  /** or open the picker, limited to one country when tag is set */
  pick?: boolean;
  tag?: string;
}

/** Minimal description of the foreground window, as reported by the focus monitor. */
export interface WindowInfo {
  name: string;
  path: string;
}

/**
 * How the app talks to one game. Adapters are stateful (watchers, pending commands) and
 * are started when their game becomes active, stopped when the player switches games.
 *
 * Events:
 *  - 'talk'            the game asked for a conversation (in-game button / interaction)
 *  - 'command-failed'  (CommandFailure) the game rejected an action effect
 *  - 'commands-pending' (count: number) effects are queued and wait for the player to run them
 *  - 'snapshot'        Paradox games: fresh world data arrived
 *
 * The partner picker is optional: adapters whose talk targets are chosen in the app
 * (Paradox games) implement listTalkTargets.
 */
export interface GameAdapter extends EventEmitter {
  readonly id: GameId;
  readonly family: GameFamily;
  readonly name: Localized;
  /** Which folder the user configures: the install folder or the Documents user folder. */
  readonly folderKind: 'install' | 'documents';
  /** Example shown in the settings next to the folder picker. */
  readonly folderExample: string;
  /** How a conversation starts, shown in the UI. */
  readonly talkHint: Localized;
  /** Prompt variant folders, most specific first (e.g. ['hoi4', 'paradox']). */
  readonly promptVariants: string[];

  detectFolder(configured: string | null | undefined): FolderDetection;
  /** Accept a near miss (e.g. the data/ subfolder) and return the folder to store. */
  normalizeFolder(dir: string): string;
  isValidFolder(dir: string | null | undefined): boolean;
  /** Mod installed, write access, debug mode... Never throws. */
  checkSetup(dir: string): GameSetupWarning[];
  isGameWindow(window: WindowInfo): boolean;

  start(): void;
  stop(): void;
  /** Forget queued commands (start of a conversation, folder change). */
  clear(): void;

  loadGameData(options: LoadOptions): Promise<LoadResult>;
  /** Validate and queue one action effect; throws with a readable message when invalid. */
  runGameEffect(command: GameCommand, context?: EffectContext): void;

  /** Conversation partners to pick from in the app; undefined when the game itself picks. */
  listTalkTargets?(tag?: string): TalkTarget[];
  /** Effects waiting to be applied in game (Paradox games). */
  pendingCount?(): number;
  /** Console command that applies waiting effects, e.g. "run votc.txt". */
  readonly runCommand?: string;
  /** The app applies waiting effects itself; the player only needs the run command as a fallback. */
  readonly autoApplies?: boolean;
  /** Paradox games type into the console only while the game window is in front. */
  setGameFocusProbe?(probe: () => boolean): void;

  /** Bridge files worth copying when the user collects logs for a bug report. */
  diagnosticFiles(dir: string): string[];
  /** Append a line to the bridge's diagnostic log; never throws. */
  diagnostic(message: string): void;
}
