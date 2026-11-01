/**
 * Parses VOTC lines out of a Paradox game log (see types.ts for the format).
 * Kept free of electron/fs imports so it can be exercised directly with `node`.
 */
import type { PdxCountry, PdxPerson, PdxRelation, PdxSnapshot, PdxTalkRequest } from './types';

export const LINE_MARKER = 'VOTC|';

/**
 * Country references we pass back into scripts: HOI4/Vic3/EU5 tags (GER, D01) and the
 * Stellaris empire ids the mod assigns (E0..E999).
 */
export const TAG_RE = /^[A-Z][A-Z0-9]{1,3}$/;

function yes(value: string | undefined): boolean {
  return value === 'yes' || value === '1' || value === 'true';
}

/** Localised text can carry formatting codes (#bold, §Y, @icons); keep plain text only. */
export function cleanText(value: string): string {
  return value
    .replace(/§[A-Za-z!]/g, '')
    .replace(/#[a-z_]+\s|#!|#$/gi, '')
    .replace(/@[a-z_]+!/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * EU5 wraps names in text codes: "\x15TOOLTIP:CHARACTER,123 \x15L; Jeanne\x15!\x15!", styles as
 * "\x15e; ...". Keep the text; an empty object (id 4294967295, the scope did not resolve) is
 * dropped, so the value counts as missing.
 */
export function stripTextCodes(line: string): string {
  if (!line.includes('\x15')) return line;
  return line
    .replace(/\x15TOOLTIP:[A-Z_]+,4294967295 \x15L; [^\x15]*(\x15!)*/g, '')
    .replace(/\x15TOOLTIP:[^\x15]*\x15L; /g, '')
    .replace(/\x15[A-Za-z]; /g, '')
    .replace(/\x15!?/g, '');
}

/** The game could not resolve a localisation function: treat the value as missing. */
function unresolved(value: string): boolean {
  return /\[[^\]]*\]|^\s*$|Unknown|INVALID|NOT_FOUND/i.test(value);
}

function blankCountry(tag: string): PdxCountry {
  return { tag, name: tag, leader: '', leaderTitle: '', government: '', capital: '', facts: {} };
}

function blankRelation(): PdxRelation {
  return { atWar: false, allied: false, subject: false, overlord: false, opinion: null, truce: false, facts: {} };
}

function setCountryField(c: PdxCountry, key: string, raw: string): void {
  const value = cleanText(raw);
  if (unresolved(value)) return;
  switch (key) {
    case 'name': c.name = value; break;
    case 'leader': c.leader = value; break;
    case 'leader_title': c.leaderTitle = value; break;
    case 'government': c.government = value; break;
    case 'capital': c.capital = value; break;
    case 'tag': if (TAG_RE.test(value)) c.tag = value; break;
    default:
      // repeated keys (e.g. one line per war) are joined
      c.facts[key] = c.facts[key] ? `${c.facts[key]}, ${value}` : value;
  }
}

function setRelationField(r: PdxRelation, key: string, raw: string): void {
  const value = cleanText(raw);
  switch (key) {
    case 'war': r.atWar = yes(value); break;
    case 'ally': r.allied = yes(value); break;
    case 'subject': r.subject = yes(value); break;
    case 'overlord': r.overlord = yes(value); break;
    case 'truce': r.truce = yes(value); break;
    case 'opinion': {
      const n = Number(value);
      if (Number.isFinite(n)) r.opinion = Math.max(-100, Math.min(100, Math.round(n)));
      break;
    }
    default:
      if (!unresolved(value)) r.facts[key] = r.facts[key] ? `${r.facts[key]}, ${value}` : value;
  }
}

export function personKey(tag: string, name: string): string {
  return `${tag}|${name}`;
}

function blankPerson(tag: string, name: string): PdxPerson {
  return { tag, name, title: '', age: null, female: false, ruler: false, traits: [], description: '', location: '', facts: {} };
}

/** Trait keys arrive raw (cocaine_addiction); the app shows them as words. */
export function traitWord(key: string): string {
  return key.replace(/^trait_/, '').replace(/_/g, ' ').trim();
}

function setPersonField(p: PdxPerson, key: string, raw: string): void {
  const value = cleanText(raw);
  if (unresolved(value)) return;
  switch (key) {
    case 'title': p.title = value; break;
    case 'age': {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0 && n < 10000) p.age = Math.floor(n);
      break;
    }
    case 'gender': p.female = value === 'female'; break;
    case 'ruler': p.ruler = yes(value); break;
    case 'trait': if (!p.traits.includes(value)) p.traits.push(value); break;
    case 'desc': p.description = value; break;
    case 'location': p.location = value; break;
    default:
      p.facts[key] = p.facts[key] ? `${p.facts[key]}, ${value}` : value;
  }
}

function talkRequest(meta: Record<string, string>): PdxTalkRequest | null {
  const mode = meta.talk;
  if (mode !== 'character' && mode !== 'country' && mode !== 'pick') return null;
  const tag = cleanText(meta.talk_tag || '');
  const name = cleanText(meta.talk_name || '');
  if (mode === 'character' && !name) return null;
  if (mode === 'country' && !TAG_RE.test(tag)) return null;
  return { mode, tag: TAG_RE.test(tag) ? tag : '', name };
}

interface Building {
  game: string;
  version: string;
  reason: string;
  meta: Record<string, string>;
  player: PdxCountry;
  countries: Map<string, PdxCountry & { relation: PdxRelation }>;
  characters: Map<string, PdxPerson>;
}

export interface ParseEvents {
  onSnapshot?: (snapshot: PdxSnapshot) => void;
  onAck?: (sequence: number) => void;
}

/**
 * Feed log lines one by one. A snapshot is reported when its END line arrives; a BEGIN
 * without END (game crashed, log rotated) is dropped when the next BEGIN starts.
 */
export class SnapshotParser {
  private current: Building | null = null;

  constructor(private events: ParseEvents, private now: () => number = Date.now) {}

  feed(line: string): void {
    const at = line.indexOf(LINE_MARKER);
    if (at < 0) return;
    // EU5 (error.log) quotes a line it could not resolve: "Data error in loc string 'VOTC|...'"
    if (line.includes('Data error in loc string')) return;
    // Jomini prefixes every line with "[time][file:line]: script file:line: "
    const parts = stripTextCodes(line.slice(at + LINE_MARKER.length).replace(/\r$/, '')).split('|');
    const kind = parts[0];
    switch (kind) {
      case 'BEGIN':
        this.current = {
          game: parts[1] || '',
          version: parts[2] || '',
          reason: parts[3] || '',
          meta: {},
          player: blankCountry(''),
          countries: new Map(),
          characters: new Map(),
        };
        return;
      case 'ACK': {
        const seq = Number(parts[1]);
        if (Number.isFinite(seq)) this.events.onAck?.(seq);
        return;
      }
      case 'END': {
        const b = this.current;
        this.current = null;
        if (!b) return;
        this.events.onSnapshot?.({
          game: b.game,
          version: b.version,
          reason: b.reason,
          receivedAt: this.now(),
          meta: b.meta,
          player: b.player,
          countries: [...b.countries.values()].filter((c) => c.tag !== b.player.tag),
          characters: [...b.characters.values()],
          talk: talkRequest(b.meta),
        });
        return;
      }
    }
    const b = this.current;
    if (!b) return;
    // values may themselves contain '|' (unlikely in names); keep the rest of the line
    if (kind === 'META' && parts.length >= 3) {
      b.meta[parts[1]] = parts.slice(2).join('|').trim();
    } else if (kind === 'P' && parts.length >= 3) {
      setCountryField(b.player, parts[1], parts.slice(2).join('|'));
    } else if (kind === 'CH' && parts.length >= 5) {
      // CH|<tag>|<name>|<key>|<value>: characters without a country (exiles) log an empty tag
      const tag = TAG_RE.test(parts[1].trim()) ? parts[1].trim() : '';
      const name = cleanText(parts[2]);
      if (!name || unresolved(name)) return;
      const key = personKey(tag, name);
      let p = b.characters.get(key);
      if (!p) {
        p = blankPerson(tag, name);
        b.characters.set(key, p);
      }
      setPersonField(p, parts[3], parts.slice(4).join('|'));
    } else if ((kind === 'C' || kind === 'R') && parts.length >= 4) {
      const tag = parts[1].trim();
      if (!TAG_RE.test(tag)) return;
      let c = b.countries.get(tag);
      if (!c) {
        c = { ...blankCountry(tag), relation: blankRelation() };
        b.countries.set(tag, c);
      }
      if (kind === 'C') setCountryField(c, parts[2], parts.slice(3).join('|'));
      else setRelationField(c.relation, parts[2], parts.slice(3).join('|'));
    }
  }
}
