/** Shapes of the JSON written by wh3_mod/script/campaign/mod/votc_wh3.lua. */

export interface Wh3Unit {
  key: string;
  name: string;
  count: number;
  /** average remaining strength in percent */
  strength: number;
}

export interface Wh3Army {
  units: Wh3Unit[];
  heroes: string[];
  /** every unit slot including the lord and embedded heroes */
  unitCount: number;
}

export interface Wh3Character {
  cqi: number;
  name: string;
  forename: string;
  subtypeKey: string;
  subtypeName: string;
  /** general, champion, wizard, spy, dignitary, engineer, runesmith, ... */
  typeKey: string;
  rank: number;
  age: number;
  isMale: boolean;
  isFactionLeader: boolean;
  isWounded: boolean;
  isEmbedded: boolean;
  battlesWon: number;
  battlesFought: number;
  factionKey: string;
  regionKey?: string;
  regionName?: string;
  regionOwnerKey?: string;
  regionOwnerName?: string;
  /** keys from the bridge's ALLOWED_TRAITS that the character has */
  traits: string[];
  army?: Wh3Army;
  /** game text describing this kind of character (agent subtype), in the game's language */
  typeDescription?: string;
  /** historical description of the character's unit; a full biography for legendary lords */
  biography?: string;
  /**
   * Set when the conversation partner is a rank-and-file unit (one of its soldiers) rather
   * than a character. Its cqi is the negated unit cqi, so character commands never match it.
   */
  isUnit?: boolean;
  unitCqi?: number;
  unitKey?: string;
  /** remaining strength of the unit in percent */
  strength?: number;
  commanderCqi?: number;
  commanderName?: string;
}

export interface Wh3FactionRef {
  key: string;
  name: string;
}

export interface Wh3Faction {
  key: string;
  name: string;
  cultureKey: string;
  cultureName: string;
  subcultureKey: string;
  subcultureName: string;
  treasury: number;
  isHuman: boolean;
  isDead: boolean;
  regions: Wh3FactionRef[];
  regionCount: number;
  armyCount: number;
  capitalKey?: string;
  capitalName?: string;
  leaderCqi?: number;
  leaderName?: string;
  atWarWith: Wh3FactionRef[];
  // only present for the non-player faction
  atWarWithPlayer?: boolean;
  alliedWithPlayer?: boolean;
  isVassalOfPlayer?: boolean;
  isMasterOfPlayer?: boolean;
  attitudeToPlayer?: number;
  playerAttitudeToThem?: number;
  tradingWithPlayer?: boolean;
}

export type Wh3StateError =
  | 'no_local_faction'
  | 'player_has_no_leader'
  | 'nothing_selected'
  | 'target_not_found'
  | 'faction_has_no_leader'
  | 'settlement_unowned'
  | 'target_is_player'
  | 'diplomacy_pick_faction';

export interface Wh3State {
  version: string;
  reqId: string;
  ok: boolean;
  error?: Wh3StateError | string;
  time?: number;
  targetSource?: 'requested' | 'diplomacy' | 'details' | 'selection' | 'unit' | 'settlement' | 'none';
  turn?: number;
  campaign?: string;
  /** stable id of this playthrough, kept in the savegame (absent with bridge versions before 1.1) */
  campaignId?: string;
  player?: Wh3Character;
  target?: Wh3Character;
  playerFaction?: Wh3Faction;
  /** missing when the target belongs to the player's own faction */
  targetFaction?: Wh3Faction;
  /** set when the conversation was started from a settlement: where the meeting takes place */
  sceneRegionKey?: string;
  sceneRegionName?: string;
  sceneRegionOwnerName?: string;
  sceneIsCapital?: boolean;
}

export interface Wh3CommandResult {
  id: number;
  op: string;
  ok: boolean;
  message: string;
}

export interface Wh3Ack {
  version: string;
  lastId: number;
  results: Wh3CommandResult[];
  time?: number;
}

/** Ops understood by the bridge's EXECUTORS table. */
export type Wh3Command =
  | { op: 'export'; reqId: string; targetCqi?: number }
  | { op: 'transfer_gold'; from: string; to: string; amount: number }
  | { op: 'attitude'; a: string; b: string; amount: number }
  | { op: 'war'; a: string; b: string }
  | { op: 'peace'; a: string; b: string }
  | { op: 'alliance'; a: string; b: string }
  | { op: 'trade'; a: string; b: string }
  | { op: 'vassal'; master: string; vassal: string }
  | { op: 'confederate'; absorber: string; absorbed: string }
  | { op: 'transfer_region'; region: string; from: string; to: string }
  | { op: 'add_trait'; cqi: number; trait: string }
  | { op: 'add_xp'; cqi: number; levels: number }
  | { op: 'wound'; cqi: number; turns: number }
  | { op: 'kill'; cqi: number }
  | { op: 'replenish_ap'; cqi: number }
  | { op: 'give_unit'; fromCqi: number; toCqi: number; unit: string };

export const WH3_FILES = {
  state: 'votc_state.json',
  commands: 'votc_commands.lua',
  ack: 'votc_ack.json',
  /** app-side diagnostic log (the mod writes votc_log.txt) */
  appLog: 'votc_app_log.txt',
} as const;

export const WH3_EXE_NAME = 'Warhammer3.exe';
export const WH3_MOD_PACK_NAME = 'votc_wh3.pack';
