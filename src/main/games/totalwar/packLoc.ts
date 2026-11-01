import fs from 'fs';
import path from 'path';

/**
 * Localisation from Total War .pack files, for games whose scripts cannot localise (Attila).
 *
 * Packs are PFH4 (Attila) or PFH5 (newer games):
 *   header: id, flags, pack-ref count, pack-ref index size, file count, file index size, timestamp
 *   index : u32 size, [u32 timestamp if flags & 0x40], [u8 compressed (PFH5)], NUL-terminated path
 * .loc files: u16 BOM, "LOC\0", u32 version, u32 count, then count x (key, text, u8 tooltip)
 * with u16-length UTF-16 strings.
 */

export type LocTable = Map<string, string>;

interface PackEntry {
  name: string;
  offset: number;
  size: number;
  compressed: boolean;
}

export function readPackIndex(file: string): PackEntry[] {
  const fd = fs.openSync(file, 'r');
  try {
    const h = Buffer.alloc(28);
    fs.readSync(fd, h, 0, 28, 0);
    const id = h.toString('ascii', 0, 4);
    if (!/^PFH[45]$/.test(id)) return [];
    const flags = h.readUInt32LE(4);
    const refSize = h.readUInt32LE(12);
    const count = h.readUInt32LE(16);
    const indexSize = h.readUInt32LE(20);
    const headerSize = 28 + (flags & 0x100 ? 20 : 0);
    const idx = Buffer.alloc(refSize + indexSize);
    fs.readSync(fd, idx, 0, idx.length, headerSize);
    const timestamps = (flags & 0x40) !== 0;
    let p = refSize;
    let data = headerSize + refSize + indexSize;
    const entries: PackEntry[] = [];
    for (let i = 0; i < count && p < idx.length; i++) {
      const size = idx.readUInt32LE(p); p += 4;
      if (timestamps) p += 4;
      let compressed = false;
      if (id === 'PFH5') { compressed = idx[p] !== 0; p += 1; }
      const end = idx.indexOf(0, p);
      if (end < 0) break;
      entries.push({ name: idx.toString('utf-8', p, end).toLowerCase(), offset: data, size, compressed });
      p = end + 1;
      data += size;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

export function parseLoc(buf: Buffer, into: LocTable = new Map()): LocTable {
  if (buf.length < 14 || buf.toString('ascii', 2, 5) !== 'LOC') return into;
  let p = 10;
  const count = buf.readUInt32LE(p); p += 4;
  const str = (): string => {
    const len = buf.readUInt16LE(p); p += 2;
    const s = buf.toString('utf16le', p, p + len * 2); p += len * 2;
    return s;
  };
  for (let i = 0; i < count && p < buf.length; i++) {
    const key = str();
    const text = str();
    p += 1;
    into.set(key, text);
  }
  return into;
}

/** Text of the loc files in `pack` whose path matches `accept`, added to `into` (later packs win). */
export function loadPackLoc(pack: string, accept: (name: string) => boolean, into: LocTable): void {
  let entries: PackEntry[];
  try {
    entries = readPackIndex(pack);
  } catch (error) {
    console.warn(`packLoc: cannot read ${pack}:`, error);
    return;
  }
  const fd = fs.openSync(pack, 'r');
  try {
    for (const e of entries) {
      if (e.compressed || !e.name.endsWith('.loc') || !accept(e.name)) continue;
      const buf = Buffer.alloc(e.size);
      fs.readSync(fd, buf, 0, e.size, e.offset);
      parseLoc(buf, into);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Language packs of the install (local_en.pack, local_en_shared_rome2.pack...) for the language in data/language.txt. */
export function languagePacks(installDir: string): string[] {
  const dataDir = path.join(installDir, 'data');
  let lang = 'en';
  try {
    lang = fs.readFileSync(path.join(dataDir, 'language.txt'), 'utf-8').trim().toLowerCase() || 'en';
  } catch { /* default */ }
  let names: string[] = [];
  try {
    names = fs.readdirSync(dataDir);
  } catch {
    return [];
  }
  const packs = (l: string) => names.filter((n) => new RegExp(`^local_${l}(_.*)?\\.pack$`, 'i').test(n)).sort();
  const own = packs(lang);
  return (own.length ? own : packs('en')).map((n) => path.join(dataDir, n));
}

/** The mod packs of used_mods.txt, resolved against the data folder and its working directories. */
export function modPacks(installDir: string): string[] {
  let text = '';
  try {
    text = fs.readFileSync(path.join(installDir, 'used_mods.txt'), 'utf-8');
  } catch {
    return [];
  }
  const dirs = [path.join(installDir, 'data')];
  for (const m of text.matchAll(/^\s*add_working_directory\s+"([^"]+)"/gm)) dirs.push(m[1]);
  const result: string[] = [];
  for (const m of text.matchAll(/^\s*mod\s+"([^"]+)"/gm)) {
    const found = dirs.map((d) => path.join(d, m[1])).find((f) => fs.existsSync(f));
    if (found) result.push(found);
  }
  return result;
}

/**
 * Some Chinese patches space out every character (a font workaround): "西 哥 特" -> "西哥特".
 * Spaces between Latin words stay.
 */
export function tidyText(s: string): string {
  return s
    .replace(/(?<=[　-鿿＀-￯])\s+(?=[　-鿿＀-￯0-9])/g, '')
    .replace(/(?<=[0-9])\s+(?=[　-鿿])/g, '')
    .replace(/\[\[[^\]]*\]\]|\{\{[^}]*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TOKEN = /\{\{([A-Za-z0-9_]+)\}\}/g;

/** A readable fallback for a key the loc files do not have: names_name_123 -> "", att_fact_huns -> "huns". */
export function keyFallback(key: string): string {
  if (/^names_name_/.test(key)) return '';
  return key
    .replace(/^(factions_screen_name|regions_onscreen|land_units_onscreen_name|cultures_subcultures_name|cultures_name)_/, '')
    .replace(/^att_(fact|reg|cult|sub_cult|rel)_/, '')
    .replace(/_/g, ' ')
    .trim();
}

/** Replace {{key}} tokens in a string. */
export function localizeString(s: string, loc: LocTable): string {
  if (!s.includes('{{')) return s;
  return tidyText(s.replace(TOKEN, (_, key: string) => {
    const text = loc.get(key);
    return text !== undefined && text.trim() ? text : keyFallback(key);
  }));
}

/** Replace tokens in every string of a JSON-like value. */
export function localizeDeep<T>(value: T, loc: LocTable): T {
  if (typeof value === 'string') return localizeString(value, loc) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => localizeDeep(v, loc)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = localizeDeep(v, loc);
    return out as T;
  }
  return value;
}

const LOC_FILES = /(^|\\)text\\db\\(names|factions|regions|land_units|character_trait_levels|cultures|cultures_subcultures|start_pos_factions|start_pos_regions)[^\\]*\.loc$/;

const cache = new Map<string, { key: string; loc: LocTable }>();

/**
 * The game's localisation (language packs, then mod packs, so mods such as Chinese patches
 * win). Cached until the mod list or a pack changes.
 */
export function gameLoc(installDir: string): LocTable {
  const packs = [...languagePacks(installDir), ...modPacks(installDir).reverse()];
  const key = packs.map((p) => {
    try { return `${p}:${fs.statSync(p).mtimeMs}`; } catch { return p; }
  }).join('|');
  const hit = cache.get(installDir);
  if (hit && hit.key === key) return hit.loc;
  const loc: LocTable = new Map();
  // vanilla packs: only the tables we need; mod packs: every loc file (mods name theirs freely)
  const vanilla = new Set(languagePacks(installDir));
  for (const pack of packs) loadPackLoc(pack, (name) => !vanilla.has(pack) || LOC_FILES.test(name), loc);
  cache.set(installDir, { key, loc });
  return loc;
}
