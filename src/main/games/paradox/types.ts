/**
 * Data shapes of the Paradox bridge (HOI4, Victoria 3, EU5, Stellaris).
 *
 * The game mods write a snapshot of the player's country and the countries that matter to
 * it into the game log, one line per field:
 *
 *   VOTC|BEGIN|<game>|<bridge version>|<reason>
 *   VOTC|META|<key>|<value>                 date, campaign
 *   VOTC|P|<key>|<value>                    a field of the player's country
 *   VOTC|C|<tag>|<key>|<value>              a field of another country
 *   VOTC|R|<tag>|<key>|<value>              how that country stands with the player
 *   VOTC|CH|<tag>|<name>|<key>|<value>      a character of country <tag> (title, age, trait...)
 *   VOTC|END
 *   VOTC|ACK|<sequence>                     the game ran every command up to <sequence>
 *
 * A snapshot the player asked for in game (right-click Talk, the in-game talk button) carries
 *   VOTC|META|talk|character|country|pick  and  VOTC|META|talk_tag|<tag>, VOTC|META|talk_name|<name>
 *
 * Keys are free-form so each game logs what it has; the app knows the common ones
 * (name, leader, war, ally...) and shows the rest as facts in the prompt.
 */

export interface PdxCountry {
  tag: string;
  name: string;
  /** head of state / ruler / leader, the person the player talks to */
  leader: string;
  leaderTitle: string;
  /** government, ideology, ethics... in the game's words */
  government: string;
  capital: string;
  /** every other logged field, label -> value (labels are the raw keys) */
  facts: Record<string, string>;
}

/** How a country stands with the player (absent fields: unknown / no). */
export interface PdxRelation {
  atWar: boolean;
  allied: boolean;
  /** the country is the player's subject (puppet, vassal, dominion...) */
  subject: boolean;
  /** the country is the player's overlord */
  overlord: boolean;
  /** -100..100 when the game reports opinion / relations */
  opinion: number | null;
  truce: boolean;
  /** other relation keys the game logged, e.g. trade agreement, rival, guarantee */
  facts: Record<string, string>;
}

/** A character the game logged (CH lines). */
export interface PdxPerson {
  /** country the character belongs to ('' when none, e.g. an exile) */
  tag: string;
  name: string;
  /** office or role in the game's words, e.g. "General", "Chief of Army", "Ruler" */
  title: string;
  age: number | null;
  female: boolean;
  /** the ruler / head of state / country leader of their country */
  ruler: boolean;
  traits: string[];
  /** the game's own description of the character */
  description: string;
  /** where the character is (home state, location, planet...) */
  location: string;
  /** every other logged field (ideology, interest_group, skill...) */
  facts: Record<string, string>;
}

export type PdxTalkMode = 'character' | 'country' | 'pick';

/** The player asked to talk from inside the game. */
export interface PdxTalkRequest {
  mode: PdxTalkMode;
  tag: string;
  name: string;
}

export interface PdxSnapshot {
  game: string;
  version: string;
  reason: string;
  /** when the app read the END line */
  receivedAt: number;
  meta: Record<string, string>;
  player: PdxCountry;
  countries: Array<PdxCountry & { relation: PdxRelation }>;
  characters: PdxPerson[];
  talk: PdxTalkRequest | null;
}

/** Campaign context on GameData.pdx */
export interface PdxGameInfo {
  campaignId: string | null;
  date: string;
  playerCountry: PdxCountry;
  targetCountry: PdxCountry & { relation: PdxRelation };
  /** ops the active game understands, so shared actions can check what they may do */
  ops: string[];
  /** how old the snapshot is, in minutes of real time */
  snapshotAgeMinutes: number;
  /** readable labels for the fact keys the mod logs */
  factLabels: Record<string, string>;
  /** "country" or "empire" */
  countryWord: string;
  /** "countries", "empires", "civilizations" */
  countryWordPlural: string;
  /** the partner belongs to the player's own country */
  sameCountry: boolean;
  /** the character the player talks to, as the game logged it */
  person?: PdxPerson;
  /** the world situation everyone knows: one line per country (public facts only) */
  world: string[];
  /** other people of the partner's country the game reported, "name (title)" */
  knownPeople: string[];
  /** countries at war with the player (allies may be asked to join those wars) */
  enemiesOfPlayer: Array<{ tag: string; name: string }>;
  /** equipment, traits, resources, treaty articles of the game with its enabled mods (empty lists: use the defaults) */
  content?: { equipment: string[]; resources: string[]; traits: string[]; treatyArticles: string[]; wargoals: string[]; ideologies: string[] };
  /**
   * the partner is the character the player last chose "Talk (VOTC)" on in game, which the
   * mod keeps for character commands (Victoria 3, EU5)
   */
  talkerInGame?: boolean;
}

/** Per-character data on Character.pdx */
export interface PdxCharacterInfo {
  country: PdxCountry;
  /** the character as the game logged it (absent for a country's leader known only by name) */
  person?: PdxPerson;
  relation?: PdxRelation;
  isPlayer: boolean;
  /** user-written backstory for this person (from the backstories folder) */
  backstory?: string;
  /** the total conversion's own description of this character's country (HOI4 bookmarks) */
  countryModLore?: string;
  /** user-written lore for the whole country */
  factionBackstory?: string;
}

/** A conversation partner the player can pick in the app. */
export interface PdxTalkTarget {
  /** the country's tag, or "p:<tag>|<name>" for a logged character */
  id: string;
  tag: string;
  /** the country's name */
  name: string;
  leader: string;
  leaderTitle: string;
  atWar: boolean;
  allied: boolean;
  subject: boolean;
  overlord: boolean;
  opinion: number | null;
  /** a logged character rather than the country's leader */
  person?: PdxPerson;
}
