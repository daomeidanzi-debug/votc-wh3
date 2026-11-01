import fs from 'fs';
import path from 'path';
import type { GameData } from '../gameData/GameData';
import { findSteamGame, paradoxUserDir } from './steam';
import { readModLore, yearOf } from './modLore';
import type { GameId } from './types';

/**
 * Which mods the player runs, and what they change about the world the characters live in.
 *
 * Total conversions and alternate-history mods (The New Order, Kaiserreich, Elder Kings...)
 * replace the game's setting: characters must not talk about real history that never
 * happened in their world. Other gameplay mods are listed so characters can know what
 * their world contains (gigastructures, extra events...).
 */

export interface ModInfo {
  name: string;
  tags: string[];
  /** the mod's folder (Paradox games), for reading what it adds */
  dir?: string;
  /** the mod defines its own start scenarios (HOI4 / CK3 bookmarks): it is its own world */
  hasBookmarks?: boolean;
  /** the mod's own short description (Victoria 3 / EU5 metadata) */
  description?: string;
}

export interface WorldMods {
  /** the total conversion / alternate world, if one is active; `dir` holds its own lore */
  conversion?: { name: string; setting: string; alternate: boolean; dir?: string };
  /** other gameplay mods worth knowing about (names only) */
  others: string[];
}

interface KnownWorld {
  match: RegExp;
  games: GameId[];
  name: string;
  /** replaces the game's setting line */
  setting: string;
  /** true when its history departs from the real one */
  alternate: boolean;
}

/**
 * Well-known total conversions. Settings are short and only describe the starting premise,
 * so they stay right as the campaign moves on; everything else comes from the game state.
 */
const KNOWN_WORLDS: KnownWorld[] = [
  {
    match: /the new order|\btno\b/i, games: ['hoi4'], name: 'The New Order: Last Days of Europe', alternate: true,
    setting: 'the alternate 1960s of The New Order, where the Axis won the Second World War: a Nazi German Reich rules Europe, Imperial Japan its Co-Prosperity Sphere, an isolated United States faces them in a cold war, and the ruins of Russia are split among warlords',
  },
  {
    match: /kaiserredux/i, games: ['hoi4'], name: 'Kaiserredux', alternate: true,
    setting: 'the alternate 1930s of Kaiserredux, a wilder version of the Kaiserreich world: the German Empire won the Great War, syndicalist revolutions took France and Britain, and countless radical movements fight over the world',
  },
  {
    match: /kaiserreich/i, games: ['hoi4'], name: 'Kaiserreich', alternate: true,
    setting: 'the alternate 1930s of Kaiserreich, where the German Empire won the Great War: syndicalist revolutions took France and Britain, their old governments fled to the colonies, America slides toward civil war and China is split among rival cliques',
  },
  {
    match: /millennium dawn/i, games: ['hoi4'], name: 'Millennium Dawn', alternate: false,
    setting: 'the modern world of the 21st century, from the year 2000 onward, in the Millennium Dawn mod',
  },
  {
    match: /the fire rises|\btfr\b/i, games: ['hoi4'], name: 'The Fire Rises', alternate: true,
    setting: 'the alternate world of The Fire Rises, whose 20th-century history went differently from ours',
  },
  {
    match: /old world blues/i, games: ['hoi4'], name: 'Old World Blues', alternate: true,
    setting: 'the post-nuclear wasteland of Fallout, in the Old World Blues mod: the old world ended in atomic fire and new factions fight over its ruins',
  },
  {
    match: /equestria at war/i, games: ['hoi4'], name: 'Equestria at War', alternate: true,
    setting: 'the world of Equestria at War, a land of ponies, griffons and other creatures on the brink of a great war',
  },
  {
    match: /magna europa/i, games: ['hoi4'], name: 'Magna Europa', alternate: true,
    setting: 'the alternate world of Magna Europa, whose history went differently from ours',
  },
  {
    match: /elder kings/i, games: ['ck3'], name: 'Elder Kings', alternate: true,
    setting: 'Tamriel, the continent of the Elder Scrolls, in the Elder Kings mod',
  },
  {
    match: /game of thrones|\bagot\b/i, games: ['ck3'], name: 'A Game of Thrones', alternate: true,
    setting: 'Westeros and Essos of A Song of Ice and Fire, in the A Game of Thrones mod',
  },
  {
    match: /realms in exile|lotr|lord of the rings/i, games: ['ck3'], name: 'Realms in Exile', alternate: true,
    setting: 'Middle-earth of the Third Age, in the Realms in Exile mod',
  },
  {
    match: /anbennar/i, games: ['eu5', 'ck3'], name: 'Anbennar', alternate: true,
    setting: 'the high-fantasy world of Anbennar, with elves, dwarves, magic and its own history',
  },
  {
    match: /star wars|fallen republic/i, games: ['stellaris'], name: 'Star Wars', alternate: true,
    setting: 'the Star Wars galaxy, far, far away',
  },
  {
    match: /star trek|new horizons/i, games: ['stellaris'], name: 'Star Trek: New Horizons', alternate: true,
    setting: 'the Star Trek galaxy of the Federation, the Klingons, the Romulans and other powers',
  },
  // more HOI4 worlds (any other mod with its own bookmarks is recognised by them)
  {
    match: /red flood/i, games: ['hoi4'], name: 'Red Flood', alternate: true,
    setting: 'the alternate 1930s of Red Flood, a world remade by a different Great War, where radical and avant-garde movements fight over the ruins of the old order',
  },
  {
    match: /thousand week reich/i, games: ['hoi4'], name: 'Thousand Week Reich', alternate: true,
    setting: 'the alternate late 1930s of Thousand Week Reich, where the Nazi regime collapsed before it could start the Second World War',
  },
  {
    match: /f[uü]hrerreich/i, games: ['hoi4'], name: 'Führerreich', alternate: true,
    setting: 'the alternate 1930s of Führerreich, whose Great War and its aftermath went differently from ours',
  },
  {
    match: /great war redux|\bthe great war\b/i, games: ['hoi4'], name: 'The Great War Redux', alternate: false,
    setting: 'the years of the First World War, from 1910 onward, in The Great War Redux mod',
  },
  {
    match: /cold war iron curtain|iron curtain/i, games: ['hoi4'], name: 'Cold War Iron Curtain', alternate: false,
    setting: 'the early Cold War from 1950 onward, in the Cold War Iron Curtain mod',
  },
  {
    match: /pax britannica/i, games: ['hoi4'], name: 'Pax Britannica', alternate: true,
    setting: 'the alternate world of Pax Britannica, whose history went differently from ours',
  },
  // more CK3 worlds
  {
    match: /after the end/i, games: ['ck3'], name: 'After the End', alternate: true,
    setting: 'North America centuries after the fall of our civilisation, in the After the End mod: new peoples, faiths and realms have risen among the ruins',
  },
  {
    match: /godherja/i, games: ['ck3'], name: 'Godherja: The Dying World', alternate: true,
    setting: 'the dark fantasy Dying World of Godherja, with its own gods, peoples and history',
  },
  {
    match: /fallen eagle/i, games: ['ck3'], name: 'The Fallen Eagle', alternate: false,
    setting: 'late antiquity from the fall of the Western Roman Empire in 476 AD, in The Fallen Eagle mod',
  },
  {
    match: /warhammer/i, games: ['ck3', 'hoi4', 'eu5', 'vic3'], name: 'Warhammer', alternate: true,
    setting: 'the grim fantasy world of Warhammer, in a total conversion mod',
  },
  {
    match: /medieval kingdoms 1212|\bmk1212\b|1212ad|1212 ad/i, games: ['attila'], name: 'Medieval Kingdoms 1212 AD', alternate: false,
    setting: 'Europe and the Near East around 1212 AD, the age of crusades, kingdoms and the coming Mongols, in the Medieval Kingdoms 1212 AD mod',
  },
];

/** Tags of mods that do not change what the world contains. */
const COSMETIC_TAGS = /^(translation|localisation|localization|graphics|interface|ui|sound|music|font|fonts|loading screen|utilities|fixes|compatibility|map|portraits|icons|performance)$/i;
const SKIP_NAME = /cheat|修改器|汉化|translation|\bui\b|interface|loading screen|patch|compat|fps|performance|camera|icons?\b|font|color|colour/i;

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

function readJson<T>(file: string): T | null {
  const text = readText(file);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** The mod defines start scenarios of its own (common/bookmarks). */
function hasBookmarks(dir: string | undefined): boolean {
  if (!dir) return false;
  try {
    return fs.readdirSync(path.join(dir, 'common', 'bookmarks')).length > 0;
  } catch {
    return false;
  }
}

/** name + tags from a Paradox descriptor.mod (CK3, HOI4, Stellaris). */
export function parseDescriptor(text: string): ModInfo {
  const name = /^\s*name\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? '';
  const tags: string[] = [];
  const block = /^\s*tags\s*=\s*\{([^}]*)\}/m.exec(text);
  if (block) for (const m of block[1].matchAll(/"([^"]*)"/g)) tags.push(m[1]);
  return { name: name.trim(), tags };
}

/** Enabled mods of a Paradox game that writes dlc_load.json (CK3, HOI4, Stellaris). */
function dlcLoadMods(userDir: string): ModInfo[] {
  const data = readJson<{ enabled_mods?: string[] }>(path.join(userDir, 'dlc_load.json'));
  const result: ModInfo[] = [];
  for (const rel of data?.enabled_mods ?? []) {
    const outer = readText(path.join(userDir, rel));
    if (!outer) continue;
    const info = parseDescriptor(outer);
    // the copy inside the mod folder carries the full tag list
    const modPath = /^\s*path\s*=\s*"([^"]*)"/m.exec(outer)?.[1];
    const dir = modPath ? (path.isAbsolute(modPath) ? modPath : path.join(userDir, modPath)) : undefined;
    const inner = dir ? readText(path.join(dir, 'descriptor.mod')) : null;
    const full = inner ? parseDescriptor(inner) : info;
    result.push({ name: info.name || full.name, tags: full.tags.length ? full.tags : info.tags, dir, hasBookmarks: hasBookmarks(dir) });
  }
  return result;
}

/** Victoria 3 / EU5 mods carry .metadata/metadata.json with name and tags. */
function metadataMod(dir: string): ModInfo | null {
  const meta = readJson<{ name?: string; tags?: string[]; short_description?: string }>(path.join(dir, '.metadata', 'metadata.json'));
  if (!meta?.name) return null;
  return { name: meta.name, tags: Array.isArray(meta.tags) ? meta.tags : [], dir, description: meta.short_description, hasBookmarks: hasBookmarks(dir) };
}

function vic3Mods(userDir: string): ModInfo[] {
  const data = readJson<{ enabledMods?: Array<{ path?: string }> }>(path.join(userDir, 'content_load.json'));
  return (data?.enabledMods ?? []).map((m) => (m.path ? metadataMod(m.path) : null)).filter((m): m is ModInfo => !!m);
}

function eu5Mods(userDir: string): ModInfo[] {
  const data = readJson<{ playsets?: Array<{ isActive?: boolean; orderedListMods?: Array<{ path?: string; isEnabled?: boolean }> }> }>(path.join(userDir, 'playsets.json'));
  const active = data?.playsets?.find((p) => p.isActive) ?? data?.playsets?.[0];
  return (active?.orderedListMods ?? [])
    .filter((m) => m.isEnabled !== false && m.path)
    .map((m) => metadataMod(m.path!))
    .filter((m): m is ModInfo => !!m);
}

/** Total War: the launcher writes the enabled packs into used_mods.txt in the install folder. */
export function usedModPacks(installDir: string): string[] {
  const text = readText(path.join(installDir, 'used_mods.txt')) ?? '';
  return [...text.matchAll(/^\s*mod\s+"([^"]+)"/gm)].map((m) => m[1]);
}

/** Total War workshop items have no names on disk; the pack file name is the best we have. */
function packModName(pack: string): string {
  return pack.replace(/\.pack$/i, '').replace(/^[@!_\d]+/, '').replace(/[_-]+/g, ' ').trim();
}

const PDX_FOLDERS: Partial<Record<GameId, string>> = {
  ck3: 'Crusader Kings III',
  hoi4: 'Hearts of Iron IV',
  stellaris: 'Stellaris',
  vic3: 'Victoria 3',
  eu5: 'Europa Universalis V',
};

const TW_FOLDERS: Partial<Record<GameId, { folder: string; appId: string }>> = {
  wh3: { folder: 'Total War WARHAMMER III', appId: '1142710' },
  tk: { folder: 'Total War THREE KINGDOMS', appId: '779340' },
  attila: { folder: 'Total War Attila', appId: '325610' },
};

function firstExisting(dirs: string[]): string | null {
  return dirs.find((d) => {
    try { return fs.existsSync(d); } catch { return false; }
  }) ?? null;
}

/** Every enabled mod of a game, as far as the files on disk tell. Never throws. */
export function listEnabledMods(game: GameId, installDir?: string | null): ModInfo[] {
  try {
    const pdx = PDX_FOLDERS[game];
    if (pdx) {
      const dir = firstExisting(paradoxUserDir(pdx));
      if (!dir) return [];
      if (game === 'vic3') return vic3Mods(dir);
      if (game === 'eu5') return eu5Mods(dir);
      return dlcLoadMods(dir);
    }
    const tw = TW_FOLDERS[game];
    if (tw) {
      const dir = installDir ?? findSteamGame(tw.folder, (d) => fs.existsSync(path.join(d, 'data')));
      if (!dir) return [];
      // workshop items have no readable names on disk; the pack names are what we have
      return usedModPacks(dir).map((p) => ({ name: packModName(p), tags: [] }));
    }
  } catch (error) {
    console.warn(`mods: could not read the mod list of ${game}:`, error);
  }
  return [];
}

/** Our own bridge mods are never part of the world. */
function isOwnMod(name: string): boolean {
  return /votc|voices of the|voices of stellaris|voices_of/i.test(name);
}

/** Decide the world from a list of enabled mods (pure, for tests). */
export function describeWorld(game: GameId, mods: ModInfo[]): WorldMods {
  const world: WorldMods = { others: [] };
  // a known world wins over an unknown one, whatever the load order
  for (const mod of mods) {
    if (!mod.name || isOwnMod(mod.name)) continue;
    const known = KNOWN_WORLDS.find((k) => k.games.includes(game) && k.match.test(mod.name));
    if (!known) continue;
    // a sub-mod or translation of a known world (TNO CN.Ver, TNO: Sperne Tuta Limina) names the same world;
    // the copy with its own bookmarks carries the lore
    if (!world.conversion) world.conversion = { name: known.name, setting: known.setting, alternate: known.alternate };
    if (world.conversion.name === known.name && !world.conversion.dir && mod.hasBookmarks) world.conversion.dir = mod.dir;
  }
  for (const mod of mods) {
    if (!mod.name || isOwnMod(mod.name)) continue;
    const known = KNOWN_WORLDS.find((k) => k.games.includes(game) && k.match.test(mod.name));
    if (known) continue;
    const tags = mod.tags.map((t) => t.toLowerCase());
    // an unknown world: a mod with its own start scenarios (bookmarks), or one that calls itself
    // a total conversion and redraws the map ("Alternative History" alone is used by many small
    // event mods). Translations and tweaks of another mod are not worlds of their own.
    const ownScenario = !!mod.hasBookmarks && (game === 'hoi4' || game === 'ck3');
    const conversionTags = tags.includes('total conversion') && tags.includes('map');
    const helper = tags.includes('translation') || SKIP_NAME.test(mod.name);
    // a mod tagged "Historical" keeps real history: it shapes the world but does not replace it
    const historical = tags.includes('historical');
    if (!world.conversion && !helper && !historical && (ownScenario || conversionTags)) {
      const about = mod.description ? `: ${mod.description.replace(/\s+/g, ' ').slice(0, 300)}` : '';
      world.conversion = {
        name: mod.name,
        setting: `the world of the ${mod.name} mod, whose history differs from the real one${about}`,
        alternate: true,
        dir: mod.hasBookmarks ? mod.dir : undefined,
      };
      continue;
    }
    const cosmetic = mod.tags.length > 0 && mod.tags.every((t) => COSMETIC_TAGS.test(t.trim()) || /^v?\d|\*|\.png$|\.jpe?g$|^\d+$/i.test(t.trim()) || t === mod.name);
    // untagged mods (local mods, Total War packs) say nothing about themselves; only known worlds count
    if (cosmetic || mod.tags.length === 0 || SKIP_NAME.test(mod.name)) continue;
    if (world.others.length < 12 && !world.others.includes(mod.name)) world.others.push(mod.name);
  }
  return world;
}

/** The setting line the prompts use, rewritten for the active mods. */
export function settingWithMods(baseSetting: string, world: WorldMods): string {
  let setting = baseSetting;
  if (world.conversion) {
    setting = world.conversion.setting;
    if (world.conversion.alternate) {
      setting += '. This is NOT real history: everything that happened in this world is its own. Never mention real-world events, people, countries or outcomes that did not happen here; know only this world\'s history and what the current state of the game shows';
    }
  }
  if (world.others.length) {
    setting += `. Mods shape this world too: ${world.others.join(', ')}`;
  }
  return setting;
}

const cache = new Map<string, { at: number; world: WorldMods }>();
const CACHE_MS = 60 * 1000;

/** Rewrite gameData.gameSetting for the player's mods (called once per conversation). */
export function applyWorldMods(gameData: GameData, installDir?: string | null): void {
  const game = gameData.game;
  try {
    const hit = cache.get(game);
    let world: WorldMods;
    if (hit && Date.now() - hit.at < CACHE_MS) {
      world = hit.world;
    } else {
      const mods = listEnabledMods(game, installDir);
      // games that report their own mod list (Civilization VI)
      for (const name of gameData.reportedMods ?? []) mods.push({ name, tags: ['Gameplay'] });
      world = describeWorld(game, mods);
      cache.set(game, { at: Date.now(), world });
    }
    gameData.worldMods = world;
    gameData.gameSetting = settingWithMods(gameData.gameSetting, world);
    applyModLore(gameData, world);
  } catch (error) {
    console.warn('mods: could not apply the mod list:', error);
  }
}

const MAX_WORLD_LORE = 900;

/**
 * The conversion's own account of the world (its scenario description) goes into the
 * setting, and in HOI4 each country's description reaches the characters of that country.
 */
function applyModLore(gameData: GameData, world: WorldMods): void {
  const dir = world.conversion?.dir;
  if (!dir) return;
  const tags = [...new Set([...gameData.characters.values()].map((c) => c.pdx?.country?.tag).filter((t): t is string => !!t))];
  const lore = readModLore(dir, yearOf(gameData.date), tags);
  if (!lore) return;
  if (lore.world) {
    const text = lore.world.length > MAX_WORLD_LORE ? `${lore.world.slice(0, MAX_WORLD_LORE)}…` : lore.world;
    gameData.gameSetting += `. How this world's own history tells it: "${text}"`;
  }
  for (const c of gameData.characters.values()) {
    const tag = c.pdx?.country?.tag;
    const text = tag ? lore.countries.get(tag) : undefined;
    if (text && c.pdx) c.pdx.countryModLore = text;
  }
}
