/**
 * Turns whitelisted action commands into game script for the Paradox games.
 *
 * Actions never write script themselves: they pass `{ op, ...fields }`, every field is
 * validated here (country tags against TAG_RE, numbers clamped to a range, enums against a
 * fixed list) and only then interpolated into a template. A command the active game does
 * not support is rejected before anything is queued.
 *
 * Every command carries a sequence number and is guarded by a variable in the save, so a
 * command file that runs twice (the player typed `run` again, or loaded an older file)
 * never applies an effect twice. Commands with a checkable outcome log a result line that
 * the app reads back; the file ends with `VOTC|ACK|<last sequence>`.
 *
 * Kept free of electron/fs imports so it can be exercised directly with `node`.
 */
import { TAG_RE } from './snapshot';

export type PdxGame = 'hoi4' | 'vic3' | 'eu5' | 'stellaris' | 'civ6';

export type PdxCommand = { op: string } & Record<string, string | number | boolean | undefined>;

type Fields = Record<string, string | number | boolean | undefined>;

class CommandError extends Error {}

function tag(cmd: Fields, key: string): string {
  const v = cmd[key];
  if (typeof v !== 'string' || !TAG_RE.test(v)) {
    throw new CommandError(`"${key}" must be a country tag, got ${JSON.stringify(v)}`);
  }
  return v;
}

function int(cmd: Fields, key: string, lo: number, hi: number): number {
  const v = Number(cmd[key]);
  if (!Number.isFinite(v)) throw new CommandError(`"${key}" must be a number`);
  const n = Math.round(v);
  if (n < lo || n > hi) throw new CommandError(`"${key}" must be between ${lo} and ${hi}, got ${n}`);
  return n;
}

function oneOf<T extends string>(cmd: Fields, key: string, options: readonly T[]): T {
  const v = cmd[key];
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) {
    throw new CommandError(`"${key}" must be one of ${options.join(', ')}`);
  }
  return v as T;
}

function differ(a: string, b: string): void {
  if (a === b) throw new CommandError('the two countries must differ');
}

/** Script for one command: the effect, plus an optional trigger that confirms it worked. */
interface Compiled {
  effect: string;
  check?: string;
}

/**
 * Database entries of the running game with its mods (see gameContent.ts). Each list replaces
 * the built-in one when the game files could be read; otherwise the built-in list applies.
 */
export type ContentLists = Partial<Record<'equipment' | 'resources' | 'traits' | 'treatyArticles' | 'wargoals' | 'ideologies', string[]>>;

let content: ContentLists = {};

/** The game's list when known, else the built-in one. */
function listOf(kind: keyof ContentLists, fallback: readonly string[]): readonly string[] {
  const list = content[kind];
  return list && list.length ? list : fallback;
}

type Compiler = (cmd: Fields) => Compiled;

// ---------------------------------------------------------------- per game
// Opinion modifiers below are defined by the VOTC mod of each game.

const OPINION_STEPS = [
  { min: 35, key: 'votc_opinion_great' },
  { min: 1, key: 'votc_opinion_good' },
  { min: -34, key: 'votc_opinion_bad' },
  { min: -100, key: 'votc_opinion_terrible' },
];

function opinionModifier(amount: number): string {
  for (const s of OPINION_STEPS) if (amount >= s.min) return s.key;
  return 'votc_opinion_terrible';
}

/**
 * Victoria 3 / EU5: the character the player last chose "Talk (VOTC)" on is kept in the
 * global variable votc_talker by the mod; character commands act on it.
 */
const TALKER = 'global_var:votc_talker';

const HOI4_STATS = ['stability', 'war_support'] as const;
/** equipment archetypes of common/units/equipment (keep in sync with z_pdx_sendsEquipment.js) */
const HOI4_EQUIPMENT = ['infantry_equipment', 'support_equipment', 'artillery_equipment', 'motorized_equipment', 'anti_tank_equipment',
  'anti_air_equipment', 'mechanized_equipment', 'armored_car_equipment', 'small_plane_airframe', 'medium_plane_airframe', 'convoy', 'train_equipment'] as const;

const HOI4: Record<string, Compiler> = {
  refresh: (c) => ({ effect: `${tag(c, 'tag')} = { votc_snapshot_refresh = yes }` }),
  set_campaign: (c) => ({ effect: `set_variable = { global.votc_campaign = ${int(c, 'id', 1, 999999)} }` }),
  opinion: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    const m = opinionModifier(int(c, 'amount', -100, 100));
    // both sides change their view of each other
    return { effect: `${a} = { add_opinion_modifier = { target = ${b} modifier = ${m} } } ${b} = { add_opinion_modifier = { target = ${a} modifier = ${m} } }` };
  },
  political_power: (c) => {
    const from = tag(c, 'from'), to = tag(c, 'to'); differ(from, to);
    const n = int(c, 'amount', 1, 300);
    return { effect: `${from} = { add_political_power = -${n} } ${to} = { add_political_power = ${n} }` };
  },
  stat: (c) => {
    const t = tag(c, 'tag');
    const stat = oneOf(c, 'stat', HOI4_STATS);
    const n = int(c, 'amount', -15, 15);
    return { effect: `${t} = { add_${stat} = ${(n / 100).toFixed(2)} }` };
  },
  war: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return {
      effect: `${a} = { if = { limit = { NOT = { has_war_with = ${b} } } declare_war_on = { target = ${b} type = annex_everything } } }`,
      check: `${a} = { has_war_with = ${b} }`,
    };
  },
  peace: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return {
      effect: `${a} = { if = { limit = { has_war_with = ${b} } white_peace = ${b} } }`,
      check: `${a} = { NOT = { has_war_with = ${b} } }`,
    };
  },
  military_access: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `${a} = { give_military_access = ${b} }`, check: `${b} = { has_military_access_to = ${a} }` };
  },
  guarantee: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `${a} = { give_guarantee = ${b} }`, check: `${a} = { has_guaranteed = ${b} }` };
  },
  faction: (c) => {
    // the faction leader takes the other in; without a faction, the speaker founds one
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return {
      effect: `if = { limit = { ${a} = { is_faction_leader = yes } } ${a} = { add_to_faction = ${b} } } `
        + `else_if = { limit = { ${b} = { is_faction_leader = yes } } ${b} = { add_to_faction = ${a} } } `
        + `else_if = { limit = { ${a} = { is_in_faction = no } ${b} = { is_in_faction = no } } ${a} = { create_faction = votc_faction_name add_to_faction = ${b} } }`,
      check: `${a} = { is_in_faction_with = ${b} }`,
    };
  },
  puppet: (c) => {
    const master = tag(c, 'master'), subject = tag(c, 'subject'); differ(master, subject);
    return { effect: `${master} = { puppet = ${subject} }`, check: `${subject} = { is_subject_of = ${master} }` };
  },
  equipment: (c) => {
    const from = tag(c, 'from'), to = tag(c, 'to'); differ(from, to);
    const type = oneOf(c, 'type', listOf('equipment', HOI4_EQUIPMENT));
    const n = int(c, 'amount', 1, 20000);
    return { effect: `${from} = { send_equipment = { equipment = ${type} amount = ${n} target = ${to} } }` };
  },
  manpower: (c) => {
    const from = tag(c, 'from'), to = tag(c, 'to'); differ(from, to);
    const n = int(c, 'amount', 1000, 500000);
    return { effect: `${from} = { add_manpower = -${n} } ${to} = { add_manpower = ${n} }` };
  },
  // non-aggression pact / docking rights: both sides sign (diplomatic_relation as in the vanilla events)
  nap: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return {
      effect: `${a} = { diplomatic_relation = { country = ${b} relation = non_aggression_pact } }`,
      check: `${a} = { has_non_aggression_pact_with = ${b} }`,
    };
  },
  docking_rights: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `${a} = { diplomatic_relation = { country = ${b} relation = docking_rights } }` };
  },
  wargoal: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    const type = oneOf(c, 'type', listOf('wargoals', HOI4_WARGOALS));
    return {
      effect: `${a} = { create_wargoal = { type = ${type} target = ${b} } }`,
      check: `${a} = { has_wargoal_against = ${b} }`,
    };
  },
  release: (c) => {
    const master = tag(c, 'master'), subject = tag(c, 'subject'); differ(master, subject);
    return { effect: `${master} = { end_puppet = ${subject} }`, check: `${subject} = { NOT = { is_subject_of = ${master} } }` };
  },
  leave_faction: (c) => {
    const t = tag(c, 'tag');
    return { effect: `${t} = { if = { limit = { is_in_faction = yes } leave_faction = yes } }`, check: `${t} = { is_in_faction = no }` };
  },
  annex: (c) => {
    const absorber = tag(c, 'absorber'), absorbed = tag(c, 'absorbed'); differ(absorber, absorbed);
    return { effect: `${absorber} = { annex_country = { target = ${absorbed} transfer_troops = yes } }` };
  },
  popularity: (c) => {
    const t = tag(c, 'tag');
    const ideology = oneOf(c, 'ideology', listOf('ideologies', HOI4_IDEOLOGIES));
    const n = int(c, 'amount', -20, 20);
    return { effect: `${t} = { add_popularity = { ideology = ${ideology} popularity = ${(n / 100).toFixed(2)} } }` };
  },
  join_war: (c) => {
    // `country` joins the side of `ally` against `enemy`
    const country = tag(c, 'country'), ally = tag(c, 'ally'), enemy = tag(c, 'enemy');
    differ(country, ally); differ(country, enemy); differ(ally, enemy);
    return {
      effect: `${country} = { if = { limit = { NOT = { has_war_with = ${enemy} } } add_to_war = { targeted_alliance = ${ally} enemy = ${enemy} hostility_reason = asked_to_join } } }`,
      check: `${country} = { has_war_with = ${enemy} }`,
    };
  },
};

/** war goal types (common/wargoals) and ideologies (common/ideologies) of vanilla HOI4 */
const HOI4_WARGOALS = ['annex_everything', 'take_state', 'puppet_wargoal_focus', 'topple_government', 'take_claimed_state', 'take_core_state', 'liberate_wargoal'] as const;
const HOI4_IDEOLOGIES = ['democratic', 'communism', 'fascism', 'neutrality'] as const;

const VIC3_ARTICLES = ['alliance', 'defensive_pact', 'guarantee_independence', 'support_independence', 'transfer_money', 'foreign_investment_rights'] as const;
/** subject pacts of common/diplomatic_actions (19..24) */
const VIC3_SUBJECTS = ['protectorate', 'tributary', 'puppet', 'dominion', 'vassal'] as const;
/** personality traits of common/character_traits/personality_traits.txt */
export const VIC3_TRAITS = [
  'ambitious', 'arrogant', 'bigoted', 'brave', 'cautious', 'charismatic', 'compliant', 'cruel', 'direct', 'hedonist',
  'honorable', 'imperious', 'imposing', 'innovative', 'meticulous', 'persistent', 'pious', 'reckless', 'reserved',
  'romantic', 'ruthless', 'tactful', 'wrathful', 'aesthete',
] as const;

const VIC3: Record<string, Compiler> = {
  refresh: (c) => ({ effect: `c:${tag(c, 'tag')} = { votc_snapshot = { REASON = refresh } }` }),
  set_campaign: (c) => ({ effect: `set_global_variable = { name = votc_campaign value = ${int(c, 'id', 1, 999999)} }` }),
  opinion: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    const n = int(c, 'amount', -50, 50);
    return { effect: `c:${a} = { change_relations = { country = c:${b} value = ${n} } }` };
  },
  money: (c) => {
    const from = tag(c, 'from'), to = tag(c, 'to'); differ(from, to);
    const n = int(c, 'amount', 1, 10000000);
    return { effect: `c:${from} = { add_treasury = -${n} } c:${to} = { add_treasury = ${n} }` };
  },
  treaty: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    const article = oneOf(c, 'article', listOf('treatyArticles', VIC3_ARTICLES));
    const years = int(c, 'years', 1, 20);
    return {
      effect: `c:${a} = { create_treaty = { first_country = c:${a} second_country = c:${b} is_draft = no binding_period = { years = ${years} } articles_to_create = { { article = ${article} } } } }`,
    };
  },
  infamy: (c) => ({ effect: `c:${tag(c, 'tag')} = { change_infamy = ${int(c, 'amount', -25, 25)} }` }),
  // a war: a diplomatic play that escalates at once (as the vanilla events start wars)
  war: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return {
      // the play only becomes a war after the game resolves it: no immediate outcome to check
      effect: `c:${a} = { create_diplomatic_play = { target_country = c:${b} type = dp_humiliation escalation = 100 } }`,
    };
  },
  // rivalry / embargo / subject relations are diplomatic pacts the first country creates
  rivalry: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `c:${a} = { create_diplomatic_pact = { country = c:${b} type = rivalry } }` };
  },
  embargo: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `c:${a} = { create_diplomatic_pact = { country = c:${b} type = embargo } }` };
  },
  subject: (c) => {
    const master = tag(c, 'master'), subject = tag(c, 'subject'); differ(master, subject);
    const type = oneOf(c, 'type', VIC3_SUBJECTS);
    return {
      effect: `c:${master} = { create_diplomatic_pact = { country = c:${subject} type = ${type} } }`,
      check: `c:${subject} = { is_subject_of = c:${master} }`,
    };
  },
  // `debtor` owes `creditor` a favour (an obligation)
  obligation: (c) => {
    const debtor = tag(c, 'debtor'), creditor = tag(c, 'creditor'); differ(debtor, creditor);
    return { effect: `c:${debtor} = { set_owes_obligation_to = { country = c:${creditor} setting = yes } }`, check: `c:${debtor} = { owes_obligation_to = c:${creditor} }` };
  },
  military_access: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `c:${a} = { create_treaty = { first_country = c:${a} second_country = c:${b} is_draft = no binding_period = { years = 5 } articles_to_create = { { article = military_access } } } }` };
  },
  char_trait: (c) => {
    const trait = oneOf(c, 'trait', listOf('traits', VIC3_TRAITS));
    return { effect: `${TALKER} ?= { if = { limit = { NOT = { has_trait = ${trait} } } add_trait = ${trait} } }`, check: `${TALKER} ?= { has_trait = ${trait} }` };
  },
  char_exile: () => ({ effect: `${TALKER} ?= { exile_character = yes }`, check: `${TALKER} ?= { is_in_exile_pool = yes }` }),
  char_kill: () => ({ effect: `${TALKER} ?= { kill_character = yes }` }),
};

const EU5_SUBJECTS = ['fiefdom', 'tributary'] as const;
const EU5_STATS = ['stability', 'prestige', 'legitimacy'] as const;
/** personality traits of in_game/common/traits/00_ruler.txt */
export const EU5_TRAITS = [
  'righteous', 'cruel', 'tolerant', 'kind_hearted', 'free_thinker', 'well_connected', 'worldly', 'calm', 'careful',
  'secretive', 'benevolent', 'zealot', 'pious', 'lawgiver', 'incorruptible', 'scholar', 'entrepreneur', 'industrious',
  'expansionist', 'charismatic_negotiator', 'silver_tongue', 'conqueror', 'strict', 'inspiring_leader',
  'fierce_negotiator', 'embezzler', 'drunkard', 'sinner', 'greedy', 'naive', 'craven', 'loose_lips', 'malevolent',
] as const;
const EU5_DEATHS = ['execution', 'assassination', 'beheading', 'poison_arrow', 'combat'] as const;

const EU5: Record<string, Compiler> = {
  refresh: (c) => ({ effect: `c:${tag(c, 'tag')} = { votc_snapshot = { REASON = refresh } }` }),
  set_campaign: (c) => ({ effect: `set_global_variable = { name = votc_campaign value = ${int(c, 'id', 1, 999999)} }` }),
  opinion: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    const m = opinionModifier(int(c, 'amount', -100, 100));
    return { effect: `c:${a} = { add_opinion = { target = c:${b} modifier = ${m} } } c:${b} = { add_opinion = { target = c:${a} modifier = ${m} } }` };
  },
  money: (c) => {
    const from = tag(c, 'from'), to = tag(c, 'to'); differ(from, to);
    const n = int(c, 'amount', 1, 100000);
    return { effect: `c:${from} = { add_gold = -${n} } c:${to} = { add_gold = ${n} }` };
  },
  stat: (c) => {
    const t = tag(c, 'tag');
    const stat = oneOf(c, 'stat', EU5_STATS);
    const n = int(c, 'amount', -25, 25);
    return { effect: `c:${t} = { add_${stat} = ${n} }` };
  },
  war: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return {
      effect: `c:${a} = { if = { limit = { NOT = { is_at_war_with = c:${b} } } declare_war_with_cb = { target = c:${b} type = casus_belli:cb_war_from_event } } }`,
      check: `c:${a} = { is_at_war_with = c:${b} }`,
    };
  },
  alliance: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `c:${a} = { create_alliance = { target = c:${b} } }`, check: `c:${a} = { is_allied_with = { target = c:${b} } }` };
  },
  truce: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `c:${a} = { add_truce_with = { target = c:${b} } }`, check: `c:${a} = { has_truce_with = c:${b} }` };
  },
  subject: (c) => {
    const master = tag(c, 'master'), subject = tag(c, 'subject'); differ(master, subject);
    const type = oneOf(c, 'type', EU5_SUBJECTS);
    return {
      effect: `c:${subject} = { make_subject_of = { target = c:${master} type = subject_type:${type} } }`,
      check: `c:${subject} = { is_subject_of = c:${master} }`,
    };
  },
  casus_belli: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `c:${a} = { add_casus_belli = { target = c:${b} type = casus_belli:cb_border_war } }` };
  },
  rival: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `c:${a} = { add_rival = c:${b} }` };
  },
  break_alliance: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `c:${a} = { break_alliance = { target = c:${b} } }`, check: `c:${a} = { NOT = { is_allied_with = { target = c:${b} } } }` };
  },
  // `a` lets `b` build a spy network in it (shared secrets, an open court)
  spy_network: (c) => {
    const a = tag(c, 'a'), b = tag(c, 'b'); differ(a, b);
    return { effect: `c:${b} = { add_spy_network = { target = c:${a} value = ${int(c, 'amount', 1, 100)} } }` };
  },
  manpower: (c) => {
    const from = tag(c, 'from'), to = tag(c, 'to'); differ(from, to);
    const n = int(c, 'amount', 100, 100000);
    return { effect: `c:${from} = { add_manpower = -${n} } c:${to} = { add_manpower = ${n} }` };
  },
  char_trait: (c) => {
    const trait = oneOf(c, 'trait', listOf('traits', EU5_TRAITS));
    return { effect: `${TALKER} ?= { if = { limit = { NOT = { has_trait = ${trait} } } add_trait = trait:${trait} } }`, check: `${TALKER} ?= { has_trait = ${trait} }` };
  },
  char_kill: (c) => {
    // the killing is done by a country (the one that orders it)
    const by = tag(c, 'by');
    const reason = oneOf(c, 'reason', EU5_DEATHS);
    return { effect: `c:${by} = { kill_character = { target = ${TALKER} reason = ${reason} } }` };
  },
};

const STELLARIS_RESOURCES = ['energy', 'minerals', 'food', 'alloys', 'consumer_goods', 'influence', 'unity'] as const;

/**
 * Stellaris has no country tags: each snapshot saves every listed empire as a global event
 * target votc_e<n> (the player is votc_e0) and logs "E<n>" as its tag.
 */
function empire(c: Fields, key: string): string {
  const v = c[key];
  if (typeof v !== 'string' || !/^E\d{1,3}$/.test(v)) {
    throw new CommandError(`"${key}" must be an empire id like E12, got ${JSON.stringify(v)}`);
  }
  return `event_target:votc_${v.toLowerCase()}`;
}

const STELLARIS: Record<string, Compiler> = {
  refresh: () => ({ effect: `votc_snapshot_refresh = yes` }),
  set_campaign: (c) => ({ effect: `set_variable = { which = votc_campaign value = ${int(c, 'id', 1, 999999)} }` }),
  opinion: (c) => {
    const a = empire(c, 'a'), b = empire(c, 'b');
    if (a === b) throw new CommandError('the two empires must differ');
    const m = opinionModifier(int(c, 'amount', -100, 100));
    return { effect: `${a} = { add_opinion_modifier = { who = ${b} modifier = ${m} } } ${b} = { add_opinion_modifier = { who = ${a} modifier = ${m} } }` };
  },
  resource: (c) => {
    const from = empire(c, 'from'), to = empire(c, 'to');
    if (from === to) throw new CommandError('the two empires must differ');
    const res = oneOf(c, 'resource', listOf('resources', STELLARIS_RESOURCES));
    const n = int(c, 'amount', 1, 100000);
    return { effect: `${from} = { add_resource = { ${res} = -${n} } } ${to} = { add_resource = { ${res} = ${n} } }` };
  },
  subject: (c) => {
    const master = empire(c, 'master'), subject = empire(c, 'subject');
    if (master === subject) throw new CommandError('the two empires must differ');
    return { effect: `${subject} = { set_subject_of = { who = ${master} } }`, check: `${subject} = { is_subject = yes }` };
  },
  // `a` shares intelligence about itself with `b`
  intel: (c) => {
    const a = empire(c, 'a'), b = empire(c, 'b');
    if (a === b) throw new CommandError('the two empires must differ');
    return { effect: `${b} = { add_intel = { amount = ${int(c, 'amount', 5, 100)} who = ${a} } }` };
  },
  war: (c) => {
    const a = empire(c, 'a'), b = empire(c, 'b');
    if (a === b) throw new CommandError('the two empires must differ');
    return {
      effect: `${a} = { declare_war = { target = ${b} name = "VOTC_WAR_NAME" attacker_war_goal = "wg_humiliation" } }`,
      check: `${a} = { is_at_war_with = ${b} }`,
    };
  },
};

// Civilization VI: tags are "P" + player id; the effect is a Lua expression the app evaluates
// over FireTuner in the GameCore_Tuner state. It returns "ok" or "fail:<reason>".

function civPlayer(c: Fields, key: string): number {
  const v = c[key];
  const m = typeof v === 'string' ? /^P(\d{1,2})$/.exec(v) : null;
  if (!m) throw new CommandError(`"${key}" must be a player id like P3, got ${JSON.stringify(v)}`);
  return Number(m[1]);
}

function civLua(body: string): string {
  return `(function() ${body} end)()`;
}

const CIV6: Record<string, Compiler> = {
  refresh: () => ({ effect: civLua('return "ok"') }),
  money: (c) => {
    const from = civPlayer(c, 'from'), to = civPlayer(c, 'to');
    if (from === to) throw new CommandError('the two players must differ');
    const n = int(c, 'amount', 1, 20000);
    return {
      effect: civLua(`local a, b = Players[${from}], Players[${to}]; if a == nil or b == nil then return "fail:player" end; ` +
        `if a:GetTreasury():GetGoldBalance() < ${n} then return "fail:not enough gold" end; ` +
        `a:GetTreasury():ChangeGoldBalance(-${n}); b:GetTreasury():ChangeGoldBalance(${n}); return "ok"`),
    };
  },
  favor: (c) => {
    const from = civPlayer(c, 'from'), to = civPlayer(c, 'to');
    if (from === to) throw new CommandError('the two players must differ');
    const n = int(c, 'amount', 1, 500);
    return {
      effect: civLua(`local a, b = Players[${from}], Players[${to}]; if a == nil or b == nil then return "fail:player" end; ` +
        `if a:GetFavor() < ${n} then return "fail:not enough favor" end; ` +
        `a:GetDiplomacy():ChangeFavor(-${n}); b:GetDiplomacy():ChangeFavor(${n}); return "ok"`),
    };
  },
  war: (c) => {
    const a = civPlayer(c, 'a'), b = civPlayer(c, 'b');
    if (a === b) throw new CommandError('the two players must differ');
    return {
      effect: civLua(`local d = Players[${a}]:GetDiplomacy(); if d:IsAtWarWith(${b}) then return "ok" end; ` +
        `d:DeclareWarOn(${b}, WarTypes.FORMAL_WAR, true); if d:IsAtWarWith(${b}) then return "ok" end; return "fail:the game refused the war"`),
    };
  },
  peace: (c) => {
    const a = civPlayer(c, 'a'), b = civPlayer(c, 'b');
    if (a === b) throw new CommandError('the two players must differ');
    return {
      effect: civLua(`local d = Players[${a}]:GetDiplomacy(); if not d:IsAtWarWith(${b}) then return "ok" end; ` +
        `d:MakePeaceWith(${b}); if d:IsAtWarWith(${b}) then return "fail:the game refused the peace" end; return "ok"`),
    };
  },
  friendship: (c) => {
    const a = civPlayer(c, 'a'), b = civPlayer(c, 'b');
    if (a === b) throw new CommandError('the two players must differ');
    return {
      effect: civLua(`if Players[${a}]:GetDiplomacy():IsAtWarWith(${b}) then return "fail:at war" end; ` +
        `Players[${a}]:GetDiplomacy():SetHasDeclaredFriendship(${b}, true); Players[${b}]:GetDiplomacy():SetHasDeclaredFriendship(${a}, true); return "ok"`),
    };
  },
  alliance: (c) => {
    const a = civPlayer(c, 'a'), b = civPlayer(c, 'b');
    if (a === b) throw new CommandError('the two players must differ');
    return {
      effect: civLua(`if Players[${a}]:GetDiplomacy():IsAtWarWith(${b}) then return "fail:at war" end; ` +
        `Players[${a}]:GetDiplomacy():SetHasAllied(${b}, true); Players[${b}]:GetDiplomacy():SetHasAllied(${a}, true); return "ok"`),
    };
  },
};

const COMPILERS: Record<PdxGame, Record<string, Compiler>> = { hoi4: HOI4, vic3: VIC3, eu5: EU5, stellaris: STELLARIS, civ6: CIV6 };

export function supportedOps(game: PdxGame): string[] {
  return Object.keys(COMPILERS[game]);
}

/** Validate a command for the game; throws an Error with a readable message. */
/**
 * @param lists the game's database entries with its mods (equipment, traits...); the built-in
 *        lists are used for any that is missing
 */
export function compileCommand(game: PdxGame, cmd: PdxCommand, lists: ContentLists = {}): Compiled {
  const compiler = COMPILERS[game][cmd.op];
  if (!compiler) {
    throw new Error(`"${cmd.op}" is not supported in ${game}; supported: ${supportedOps(game).join(', ')}`);
  }
  try {
    content = lists;
    return compiler(cmd);
  } catch (error) {
    if (error instanceof CommandError) throw new Error(`${cmd.op}: ${error.message}`);
    throw error;
  } finally {
    content = {};
  }
}

// ---------------------------------------------------------------- command files

export interface QueuedCommand {
  seq: number;
  op: string;
  compiled: Compiled;
}

/**
 * Log statement of each engine: HOI4/Stellaris `log` (game.log), Victoria 3 `debug_log`
 * (debug.log), EU5 `error_log` (error.log: EU5 writes debug.log in buffered chunks, so a
 * talk request could wait 2-15 seconds there; error.log is written line by line).
 */
function logEffect(game: PdxGame, text: string): string {
  const key = game === 'vic3' ? 'debug_log' : game === 'eu5' ? 'error_log' : 'log';
  return `${key} = "${text}"`;
}

/** "the command has not run yet" for each engine's variable syntax */
function notDoneTrigger(game: PdxGame, seq: number): string {
  switch (game) {
    case 'hoi4':
      return `NOT = { check_variable = { global.votc_seq > ${seq - 1} } }`;
    case 'stellaris':
      return `NOT = { check_variable = { which = votc_seq value > ${seq - 1} } }`;
    default:
      return `OR = { NOT = { has_global_variable = votc_seq } global_var:votc_seq < ${seq} }`;
  }
}

function markDone(game: PdxGame, seq: number): string {
  switch (game) {
    case 'hoi4':
      return `set_variable = { global.votc_seq = ${seq} }`;
    case 'stellaris':
      return `set_variable = { which = votc_seq value = ${seq} }`;
    default:
      return `set_global_variable = { name = votc_seq value = ${seq} }`;
  }
}

/**
 * No game uses the console any more: a console command from the GUI races the game's threads
 * for the random generator ("Random is blocked by thread"), which crashes Victoria 3, and
 * players do not want the console opened over HOI4 or Stellaris.
 * The commands go into a hidden event of the mod (events/votc_commands.txt); the -debug_mode
 * file watcher reloads it when it changes. Victoria 3/EU5: the mod's runner fires
 * it through a scripted GUI every 2 seconds; HOI4 (no GUI timer): the daily pulse and the mod's
 * VOTC buttons fire it; Stellaris: the monthly pulse and the talk decision. The event's own trigger is false once the newest command has run, so
 * firing it then does nothing. Nothing else is rewritten while the game runs: reloading
 * scripted triggers makes the file watcher reload all of them, which crashed Victoria 3
 * ("Pure Virtual Function Call").
 */
export const VIC3_EVENT = 'votc_cmd.1';

type EventGame = 'vic3' | 'eu5' | 'hoi4' | 'stellaris';

function isEventGame(game: PdxGame): game is EventGame {
  return game === 'vic3' || game === 'eu5' || game === 'hoi4' || game === 'stellaris';
}

function eventFile(game: EventGame, queue: QueuedCommand[]): string {
  const body = queue.map((q) => `\t\t${guardedScript(game, q)}`);
  const last = queue.length ? Math.max(...queue.map((q) => q.seq)) : 0;
  if (queue.length) body.push(`\t\t${logEffect(game, `VOTC|ACK|${last}`)}`);
  const trigger = queue.length ? [`\t\t${notDoneTrigger(game, last)}`] : ['\t\talways = no'];
  if (game === 'hoi4' || game === 'stellaris') {
    // fired by pulses that run for every country: only the player's applies the commands
    if (queue.length) trigger.unshift('\t\tis_ai = no');
    return [
      '# Written by the VOTC app: the actions agreed in conversations. Do not edit.',
      game === 'hoi4' ? 'add_namespace = votc_cmd' : 'namespace = votc_cmd',
      '',
      'country_event = {',
      `\tid = ${VIC3_EVENT}`,
      game === 'hoi4' ? '\thidden = yes' : '\thide_window = yes',
      '\tis_triggered_only = yes',
      '\ttrigger = {',
      ...trigger,
      '\t}',
      '\timmediate = {',
      ...body,
      '\t}',
      // hidden Stellaris events need no option (and its text key would be missing)
      ...(game === 'hoi4' ? [`\toption = { name = ${VIC3_EVENT}.a }`] : []),
      '}',
      '',
    ].join('\n');
  }
  // EU5 events, hidden ones too, carry an outcome, title and desc (see the game's own)
  const eu5Fields = game === 'eu5' ? ['\toutcome = neutral', '\ttitle = empty_text', '\tdesc = empty_text'] : [];
  return [
    '# Written by the VOTC app: the actions agreed in conversations. Do not edit.',
    'namespace = votc_cmd',
    '',
    `${VIC3_EVENT} = {`,
    '\ttype = country_event',
    ...eu5Fields,
    '\thidden = yes',
    '\ttrigger = {',
    ...trigger,
    '\t}',
    '\timmediate = {',
    ...body,
    '\t}',
    '}',
    '',
  ].join('\n');
}

/**
 * Victoria 3/EU5 want script files as UTF-8 with a byte order mark. HOI4/Stellaris must not get
 * one: Stellaris then misread the comment on the first line and rejected every event of the file.
 */
export function runFileEncoding(game: PdxGame): { bom: boolean } {
  return { bom: game === 'vic3' || game === 'eu5' };
}

/** One guarded command, as a single line of script. */
export function guardedScript(game: PdxGame, q: QueuedCommand): string {
  const result = q.compiled.check
    ? ` if = { limit = { ${q.compiled.check} } ${logEffect(game, `VOTC|RES|${q.seq}|ok|${q.op}`)} } else = { ${logEffect(game, `VOTC|RES|${q.seq}|fail|${q.op}`)} }`
    : ` ${logEffect(game, `VOTC|RES|${q.seq}|ok|${q.op}`)}`;
  return `if = { limit = { ${notDoneTrigger(game, q.seq)} } ${markDone(game, q.seq)} ${q.compiled.effect}${result} }`;
}

/**
 * The file the app writes: the mod's hidden command event (Victoria 3, EU5, HOI4, Stellaris).
 */
export function buildRunFile(game: PdxGame, queue: QueuedCommand[]): string {
  // Civilization VI gets its commands over FireTuner, not from a file
  return isEventGame(game) ? eventFile(game, queue) : '';
}

/**
 * The optional console way (HOI4, Stellaris): one console command per line for `run votc.txt`.
 * The same guarded commands as the event, so whichever runs first applies them once.
 */
export function buildConsoleFile(game: PdxGame, queue: QueuedCommand[]): string {
  if (queue.length === 0 || (game !== 'hoi4' && game !== 'stellaris')) return '';
  const last = Math.max(...queue.map((q) => q.seq));
  const statements = queue.map((q) => guardedScript(game, q));
  statements.push(logEffect(game, `VOTC|ACK|${last}`));
  // HOI4 eval_effect / Stellaris effect run inline script; every statement must fit on its line
  const prefix = game === 'hoi4' ? 'eval_effect' : 'effect';
  return statements.map((st) => `${prefix} ${st}`).join('\n') + '\n';
}
