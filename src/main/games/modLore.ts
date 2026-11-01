import fs from 'fs';
import path from 'path';

/**
 * A total conversion's own account of its world, read from its files: the description of
 * its start scenario (bookmark) and, in HOI4, the description of each country in it.
 * TNO, Kaiserreich, Red Flood, Elder Kings... all describe their worlds this way, so even a
 * mod nobody listed gets its lore into the prompt.
 */

export interface Bookmark {
  /** loc key of the scenario description */
  descKey: string;
  /** start year, when the file gives one */
  year: number | null;
}

function read(file: string, maxBytes = 30 * 1024 * 1024): string {
  try {
    if (fs.statSync(file).size > maxBytes) return '';
    return fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

function list(dir: string): string[] {
  try {
    return fs.readdirSync(dir).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 4) return out;
  for (const f of list(dir)) {
    let st: fs.Stats;
    try { st = fs.statSync(f); } catch { continue; }
    if (st.isDirectory()) walk(f, out, depth + 1);
    else out.push(f);
  }
  return out;
}

/** Start scenarios a mod defines (HOI4: bookmark = { desc = KEY date = ... }; CK3: bm_x = { start_date = ... } with bm_x_desc). */
export function readBookmarks(modDir: string): Bookmark[] {
  const files = walk(path.join(modDir, 'common', 'bookmarks')).filter((f) => f.endsWith('.txt'));
  const result: Bookmark[] = [];
  for (const file of files) {
    const text = read(file).replace(/#[^\n]*/g, '');
    // HOI4
    for (const m of text.matchAll(/\bdesc\s*=\s*"?([A-Za-z0-9_.-]+)"?[\s\S]{0,400}?\bdate\s*=\s*(\d{3,4})\./g)) {
      result.push({ descKey: m[1], year: Number(m[2]) });
    }
    // CK3: top-level bm_* blocks
    for (const m of text.matchAll(/^([a-z][a-z0-9_]*)\s*=\s*\{[\s\S]{0,300}?\bstart_date\s*=\s*(\d{3,4})\./gm)) {
      result.push({ descKey: `${m[1]}_desc`, year: Number(m[2]) });
    }
  }
  return result;
}

/** Strip Paradox text formatting: §Y, #bold ...#!, $VAR$, [Scope.Function], \n. */
export function cleanLoc(text: string): string {
  return text
    .replace(/\\n/g, ' ')
    .replace(/§[A-Za-z!]/g, '')
    .replace(/#[a-z_]+;?\s?|#!/gi, '')
    .replace(/\$[^$]*\$/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/£[a-z_]+£?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const LANG_ORDER = ['english', 'simp_chinese', 'chinese'];

/**
 * Text of the given loc keys in a mod (english first, then Chinese, then any language).
 * Files about bookmarks are read first, so TNO's 75 MB of text costs one small file.
 */
export function lookupLoc(modDir: string, keys: string[]): Map<string, string> {
  const wanted = new Set(keys);
  const found = new Map<string, { text: string; rank: number }>();
  const dirs = ['localisation', 'localization', path.join('main_menu', 'localization'), path.join('in_game', 'localization')];
  let files: string[] = [];
  for (const d of dirs) files.push(...walk(path.join(modDir, d)).filter((f) => f.endsWith('.yml')));
  const langRank = (f: string) => {
    const lower = f.toLowerCase();
    const i = LANG_ORDER.findIndex((l) => lower.includes(l));
    return i < 0 ? LANG_ORDER.length : i;
  };
  // bookmark files first, then by language
  files = files.sort((a, b) => Number(!/bookmark/i.test(a)) - Number(!/bookmark/i.test(b)) || langRank(a) - langRank(b));
  const re = /^\s*([A-Za-z0-9_.-]+):\d*\s*"(.*)"\s*$/gm;
  let scanned = 0;
  for (const file of files) {
    const rank = langRank(file);
    // stop once every key has text in the best language seen so far
    if ([...wanted].every((k) => found.has(k) && found.get(k)!.rank <= rank)) break;
    const text = read(file);
    scanned += text.length;
    for (const m of text.matchAll(re)) {
      if (!wanted.has(m[1])) continue;
      const value = cleanLoc(m[2]);
      if (!value) continue;
      const prev = found.get(m[1]);
      if (!prev || rank < prev.rank) found.set(m[1], { text: value, rank });
    }
    if (scanned > 200 * 1024 * 1024) break;
  }
  return new Map([...found].map(([k, v]) => [k, v.text]));
}

/** The bookmark that fits the campaign's year: the latest one that starts no later, else the first. */
export function pickBookmark(bookmarks: Bookmark[], year: number | null): Bookmark | null {
  if (!bookmarks.length) return null;
  if (year === null) return bookmarks[0];
  const before = bookmarks.filter((b) => b.year !== null && b.year <= year).sort((a, b) => (b.year! - a.year!));
  return before[0] ?? bookmarks[0];
}

/** A year in a game date ("1962.3.1", "1 March 1962", "1962年3月1日"). */
export function yearOf(date: string | undefined): number | null {
  const m = /(?:^|\D)(\d{3,4})(?:\D|$)/.exec(date ?? '');
  return m ? Number(m[1]) : null;
}

export interface ModLore {
  /** the scenario's description of the world */
  world: string;
  /** HOI4: the scenario's description of each country, by tag */
  countries: Map<string, string>;
}

const cache = new Map<string, ModLore | null>();

/** World (and country) lore of a total conversion, for the tags given. Never throws. */
export function readModLore(modDir: string, year: number | null, tags: string[]): ModLore | null {
  const key = `${modDir}|${year}|${tags.join(',')}`;
  if (cache.has(key)) return cache.get(key)!;
  let lore: ModLore | null = null;
  try {
    const bm = pickBookmark(readBookmarks(modDir), year);
    if (bm) {
      const countryKeys = tags.map((t) => `${t}_${bm.descKey}`);
      const loc = lookupLoc(modDir, [bm.descKey, ...countryKeys]);
      const countries = new Map<string, string>();
      tags.forEach((t, i) => {
        const text = loc.get(countryKeys[i]);
        if (text) countries.set(t, text);
      });
      const world = loc.get(bm.descKey) ?? '';
      if (world || countries.size) lore = { world, countries };
    }
  } catch (error) {
    console.warn(`modLore: could not read ${modDir}:`, error);
  }
  cache.set(key, lore);
  return lore;
}
