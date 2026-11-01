import { GameData } from '../../gameData/GameData';
import { Character } from '../../gameData/Character';
import { supportedOps } from './commands';
import type { PdxProfile } from './profiles';
import { personKey, traitWord } from './snapshot';
import type { PdxCountry, PdxPerson, PdxRelation, PdxSnapshot, PdxTalkTarget } from './types';

/** Stable numeric id per country tag (summaries are stored under it). */
export function countryId(tag: string): number {
  const n = parseInt(tag, 36);
  return Number.isFinite(n) ? n : 0;
}

/** Stable numeric id per character, kept apart from the country ids (summaries are stored under it). */
export function personId(tag: string, name: string): number {
  // FNV-1a over "<tag>|<name>"; country ids stay below 36^4
  let h = 0x811c9dc5;
  for (const ch of personKey(tag, name)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 2_000_000 + h;
}

export const PERSON_PREFIX = 'p:';

/** Talk target id of a logged character. */
export function personTargetId(p: { tag: string; name: string }): string {
  return `${PERSON_PREFIX}${personKey(p.tag, p.name)}`;
}

/** Campaign ids become folder names, so only keep filesystem-safe characters. */
export function campaignFolder(game: string, raw: string | undefined, player: { tag: string; name: string }): string | null {
  // "123456" or "123456.000" depending on how the game prints numbers
  const id = (raw || '').split('.')[0].replace(/[^0-9]/g, '');
  if (id && Number(id) > 0) return `${game}_${id}`;
  // no id in the save (Stellaris, or an old save): the player's country identifies the campaign
  const name = player.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40);
  return player.tag ? `${game}_${player.tag}${name ? `_${name}` : ''}` : null;
}

/**
 * Who the player can talk to: the leader of every logged country, and every character the
 * game logged (the player's own people first, then the leaders, then foreign characters).
 * @param people characters from every snapshot so far (newest data per character)
 */
export function talkTargets(snapshot: PdxSnapshot, people: PdxPerson[] = []): PdxTalkTarget[] {
  const rank = (t: PdxTalkTarget) => (t.atWar ? 0 : t.allied || t.subject || t.overlord ? 1 : 2);
  const countries: PdxTalkTarget[] = snapshot.countries
    .map((c) => ({
      id: c.tag,
      tag: c.tag,
      name: c.name,
      leader: c.leader,
      leaderTitle: c.leaderTitle,
      atWar: c.relation.atWar,
      allied: c.relation.allied,
      subject: c.relation.subject,
      overlord: c.relation.overlord,
      opinion: c.relation.opinion,
    }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const byTag = new Map(countries.map((c) => [c.tag, c]));
  const player = snapshot.player;
  const persons: PdxTalkTarget[] = people
    // a foreign leader already has the country entry, and the player's own ruler is the player
    .filter((p) => !(p.ruler && (p.tag === player.tag || byTag.has(p.tag))))
    .map((p) => {
      const c = byTag.get(p.tag);
      return {
        id: personTargetId(p),
        tag: p.tag,
        name: p.tag === player.tag ? player.name : c?.name ?? p.tag,
        leader: p.name,
        leaderTitle: p.title,
        atWar: c?.atWar ?? false,
        allied: c?.allied ?? false,
        subject: c?.subject ?? false,
        overlord: c?.overlord ?? false,
        opinion: c?.opinion ?? null,
        person: p,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || Number(b.person!.ruler) - Number(a.person!.ruler) || a.leader.localeCompare(b.leader));
  return [
    ...persons.filter((p) => p.tag === player.tag),
    ...countries,
    ...persons.filter((p) => p.tag !== player.tag),
  ];
}

function relationLines(r: PdxRelation, profile: PdxProfile): string[] {
  const lines: string[] = [];
  if (r.atWar) lines.push('At war with the player');
  if (r.allied) lines.push('Allied with the player');
  if (r.subject) lines.push(`Subject of the player`);
  if (r.overlord) lines.push(`Overlord of the player`);
  if (r.truce) lines.push('Under a truce with the player');
  for (const [k, v] of Object.entries(r.facts)) {
    lines.push(`${profile.factLabels[k] ?? k.replace(/_/g, ' ')}: ${v}`);
  }
  return lines;
}

/**
 * What one country's people know about another: its public face (name, government, leader,
 * capital, rank, wars and blocs), not the figures only its own government sees (treasury,
 * stability, manpower...).
 */
export function publicView(country: PdxCountry, profile: PdxProfile): PdxCountry {
  const facts: Record<string, string> = {};
  for (const [k, v] of Object.entries(country.facts)) {
    if (profile.publicFacts.includes(k)) facts[k] = v;
  }
  return { ...country, facts };
}

function blankRelation(): PdxRelation {
  return { atWar: false, allied: false, subject: false, overlord: false, opinion: null, truce: false, facts: {} };
}

function toCharacter(
  country: PdxCountry,
  relation: PdxRelation | undefined,
  isPlayer: boolean,
  profile: PdxProfile,
  lang: string,
  person?: PdxPerson
): Character {
  const c = Character.blank();
  const zh = lang === 'zh';
  const leader = person?.name || country.leader || (zh ? `${country.name}的领袖` : `the leader of ${country.name}`);
  const isLeader = !person || person.ruler;
  const title = person?.title || (isLeader ? country.leaderTitle : '');
  c.id = person && !isPlayer ? personId(person.tag, person.name) : countryId(country.tag);
  c.fullName = leader;
  c.shortName = leader;
  c.firstName = leader.split(' ')[0] || leader;
  c.primaryTitle = title
    ? `${title} of ${country.name}`
    : isLeader ? `Leader of ${country.name}` : `a notable of ${country.name}`;
  c.titleRankConcept = title || (isLeader ? 'leader' : 'notable');
  c.sheHe = person ? (person.female ? 'she' : 'he') : 'they';
  if (person?.age) c.age = person.age;
  c.house = country.name;
  c.culture = person?.facts.culture || country.facts.culture || country.facts.species || '';
  c.faith = person?.facts.religion || country.facts.religion || country.facts.ethics || '';
  c.capitalLocation = country.capital;
  c.isRuler = isLeader;
  c.isLandedRuler = isLeader;
  c.isIndependentRuler = !(relation?.subject);
  c.gold = Math.floor(Number(country.facts.treasury || country.facts.gold || country.facts.energy || 0)) || 0;
  c.opinionOfPlayer = isPlayer ? 100 : relation?.opinion ?? 0;
  c.relationsToPlayer = relation ? relationLines(relation, profile) : [];
  c.personality = person?.traits.length ? person.traits.map(traitWord).join(', ') : country.government;
  c.pdx = { country, relation, isPlayer, person };
  return c;
}

/** How much of the world goes into the prompt. */
const MAX_WORLD_LINES = 30;
const MAX_KNOWN_PEOPLE = 15;

/** The country counts as a great power in its game's own terms. */
function isMajor(c: PdxCountry): boolean {
  return c.facts.major === 'yes' || c.facts.great_power === 'yes' || /great power|major power/i.test(c.facts.rank || '');
}

/**
 * The world situation everyone in the game world knows: who leads which country, the great
 * powers, who fights whom and who is allied, from the countries the game reported (public
 * facts only). The countries at war and the great powers come first.
 */
export function worldSituation(snapshot: PdxSnapshot, profile: PdxProfile): string[] {
  const all: PdxCountry[] = [publicView(snapshot.player, profile), ...snapshot.countries.map((c) => publicView(c, profile))];
  // a war with the player can be reported only as a relation; it is public on both sides
  const enemies = snapshot.countries.filter((c) => c.relation.atWar).map((c) => c.name);
  const wars = (c: PdxCountry): string[] => {
    const list = (c.facts.war_with ?? '').split(',').map((w) => w.trim()).filter(Boolean);
    if (c.tag === snapshot.player.tag) list.push(...enemies);
    else if (enemies.includes(c.name)) list.push(snapshot.player.name);
    return [...new Set(list)];
  };
  const score = (c: PdxCountry) => (wars(c).length ? 2 : 0) + (isMajor(c) ? 1 : 0);
  return all
    .filter((c) => c.name)
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))
    .slice(0, MAX_WORLD_LINES)
    .map((c) => {
      const parts: string[] = [];
      if (c.leader) parts.push(`led by ${c.leaderTitle ? `${c.leaderTitle} ` : ''}${c.leader}`);
      if (c.government) parts.push(c.government);
      if (isMajor(c)) parts.push('a great power');
      if (c.facts.faction) parts.push(`in the ${c.facts.faction}`);
      if (c.facts.federation) parts.push(`in the ${c.facts.federation}`);
      if (c.facts.allies) parts.push(`allied with ${c.facts.allies}`);
      const w = wars(c);
      parts.push(w.length ? `at war with ${w.join(', ')}` : 'at peace');
      return `${c.name}: ${parts.join('; ')}`;
    });
}

/** Other people of a country the game reported, as "name (title)". */
function knownPeople(people: Map<string, PdxPerson>, tag: string, except: string[]): string[] {
  return [...people.values()]
    .filter((p) => p.tag === tag && !except.includes(p.name))
    .sort((a, b) => Number(b.ruler) - Number(a.ruler))
    .slice(0, MAX_KNOWN_PEOPLE)
    .map((p) => (p.title ? `${p.name} (${p.title})` : p.name));
}

/** What kind of meeting it is and where it takes place. */
function sceneFor(target: PdxPerson | undefined, sameCountry: boolean, atWar: boolean, profile: PdxProfile, playerCapital: string): { scene: string; location: string } {
  const location = target?.location || playerCapital;
  const word = profile.countryWord.en;
  if (sameCountry) {
    return { scene: `a private audience with the head of your own ${word}`, location };
  }
  if (atWar) {
    return { scene: `a tense parley between two ${word === 'empire' ? 'empires' : 'nations'} at war`, location };
  }
  return {
    scene: target && !target.ruler
      ? `a meeting with a notable figure of a foreign ${word}`
      : 'a diplomatic meeting between the two heads of state',
    location,
  };
}

/**
 * Build VOTC's GameData for a conversation with a country's leader (`targetId` = its tag) or a
 * logged character (`targetId` = "p:<tag>|<name>", see personTargetId).
 *
 * Knowledge: a foreign partner sees the player's country only through its public face
 * (publicView); people of the player's own country know its internal figures.
 */
export function buildGameDataFromPdx(
  snapshot: PdxSnapshot,
  targetId: string,
  profile: PdxProfile,
  lang: string,
  people: Map<string, PdxPerson> = new Map()
): GameData {
  const player = snapshot.player;
  let person: PdxPerson | undefined;
  let targetTag = targetId;
  if (targetId.startsWith(PERSON_PREFIX)) {
    person = people.get(targetId.slice(PERSON_PREFIX.length));
    if (!person) throw new Error(`${targetId.slice(PERSON_PREFIX.length)} is not among the characters the game reported`);
    targetTag = person.tag;
  }
  const sameCountry = !!person && person.tag === player.tag;
  const logged = snapshot.countries.find((c) => c.tag === targetTag);
  if (!sameCountry && !logged && !person) throw new Error(`${targetTag} is not in the latest snapshot`);
  const target: PdxCountry & { relation: PdxRelation } = sameCountry
    ? { ...player, relation: blankRelation() }
    : logged ?? {
      tag: targetTag,
      name: targetTag || 'no country',
      leader: '', leaderTitle: '', government: '', capital: '', facts: {},
      relation: blankRelation(),
    };
  if (!person) {
    // the leader may have been logged as a character too (with traits, age...)
    person = [...people.values()].find((p) => p.tag === target.tag && p.ruler && (!target.leader || p.name === target.leader));
  }
  const playerPerson = [...people.values()].find((p) => p.tag === player.tag && p.ruler && (!player.leader || p.name === player.leader));
  const playerView = sameCountry ? player : publicView(player, profile);

  const gd = GameData.blank();
  gd.game = profile.id;
  gd.gameName = profile.name.en;
  gd.gameSetting = profile.setting;
  gd.playerID = countryId(player.tag);
  gd.playerName = player.leader || player.name;
  gd.date = snapshot.meta.date || '';
  gd.totalDays = Math.floor(Number(snapshot.meta.days) || 0);
  const where = sceneFor(person, sameCountry, target.relation.atWar, profile, player.capital);
  gd.scene = where.scene;
  gd.location = where.location;
  gd.locationController = player.name;

  const playerChar = toCharacter(playerView, undefined, true, profile, lang, playerPerson);
  const targetChar = toCharacter(target, sameCountry ? undefined : target.relation, false, profile, lang, person);
  if (sameCountry) targetChar.opinionOfPlayer = 50;
  gd.aiID = targetChar.id;
  gd.aiName = targetChar.fullName;
  gd.characters.set(playerChar.id, playerChar);
  gd.characters.set(targetChar.id, targetChar);

  gd.pdx = {
    campaignId: campaignFolder(profile.id, snapshot.meta.campaign, player),
    date: gd.date,
    playerCountry: playerView,
    targetCountry: target,
    ops: supportedOps(profile.id),
    snapshotAgeMinutes: Math.max(0, Math.round((Date.now() - snapshot.receivedAt) / 60000)),
    factLabels: profile.factLabels,
    countryWord: profile.countryWord.en,
    countryWordPlural: plural(profile.countryWord.en),
    sameCountry,
    person,
    world: worldSituation(snapshot, profile),
    enemiesOfPlayer: snapshot.countries.filter((c) => c.relation.atWar).map((c) => ({ tag: c.tag, name: c.name })),
    knownPeople: knownPeople(people, target.tag, [targetChar.fullName, gd.playerName]),
  };
  return gd;
}

/** country -> countries, empire -> empires */
export function plural(word: string): string {
  return /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;
}
