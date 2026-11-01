import fs from 'fs';
import path from 'path';
import { findSteamGame } from '../steam';
import { listEnabledMods } from '../mods';
import type { PdxGame } from './commands';

/**
 * Database entries the actions may use (equipment, traits, resources, treaty articles), read
 * from the game's own files and every enabled mod, so content a mod adds (TNO's equipment,
 * a trait mod's traits) can be used, and content a total conversion removes is not offered.
 */
export interface PdxContent {
  /** HOI4: equipment archetypes that can be sent */
  equipment: string[];
  /** HOI4: strategic resources; Stellaris: resources that can change hands */
  resources: string[];
  /** Victoria 3 / EU5: personality traits a character can gain */
  traits: string[];
  /** Victoria 3: treaty articles that need no extra input */
  treatyArticles: string[];
  /** HOI4: war goal types */
  wargoals: string[];
  /** HOI4: ideologies (total conversions bring their own) */
  ideologies: string[];
}

const EMPTY: PdxContent = { equipment: [], resources: [], traits: [], treatyArticles: [], wargoals: [], ideologies: [] };

/** Top-level `key = { body }` blocks of a Paradox script file (comments stripped). */
export function topLevelBlocks(text: string): Array<{ key: string; body: string }> {
  const src = text.replace(/^\uFEFF/, '').replace(/#[^\n]*/g, '');
  const out: Array<{ key: string; body: string }> = [];
  const re = /([A-Za-z0-9_.:@-]+)\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((re.lastIndex = i), (m = re.exec(src))) {
    let depth = 1;
    let j = re.lastIndex;
    for (; j < src.length && depth > 0; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
    }
    out.push({ key: m[1], body: src.slice(re.lastIndex, j - 1) });
    i = j;
  }
  return out;
}

function scriptFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Files of one database folder: vanilla first, then mods in load order. A mod file with the
 * same name replaces the vanilla file (the engine's rule); other files add entries.
 */
function databaseFiles(roots: string[], rel: string): string[] {
  const byName = new Map<string, string>();
  for (const root of roots) {
    for (const file of scriptFiles(path.join(root, rel))) byName.set(path.basename(file), file);
  }
  return [...byName.values()];
}

function read(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

const KEY = /^[a-z][a-z0-9_]*$/;

function collect(roots: string[], rel: string, accept: (body: string, key: string) => boolean, unwrap?: string): string[] {
  const keys = new Set<string>();
  for (const file of databaseFiles(roots, rel)) {
    let blocks = topLevelBlocks(read(file));
    // some databases sit inside one wrapper block (HOI4 `equipments = { ... }`, `resources = { ... }`)
    if (unwrap) blocks = blocks.flatMap((b) => (b.key === unwrap ? topLevelBlocks(b.body) : [b]));
    for (const b of blocks) if (KEY.test(b.key) && accept(b.body, b.key)) keys.add(b.key);
  }
  return [...keys].sort();
}

const INSTALL: Record<PdxGame, { steam: string; sub: string } | null> = {
  hoi4: { steam: 'Hearts of Iron IV', sub: '' },
  vic3: { steam: 'Victoria 3', sub: 'game' },
  eu5: { steam: 'Europa Universalis V', sub: 'game' },
  stellaris: { steam: 'Stellaris', sub: '' },
  civ6: null,
};

/** The game's script root and the enabled mods' folders, in load order. */
export function contentRoots(game: PdxGame): string[] {
  const inst = INSTALL[game];
  if (!inst) return [];
  const install = findSteamGame(inst.steam, (d) => fs.existsSync(path.join(d, inst.sub, 'common')) || fs.existsSync(path.join(d, inst.sub, 'in_game', 'common')));
  const roots = install ? [path.join(install, inst.sub)] : [];
  for (const mod of listEnabledMods(game)) if (mod.dir) roots.push(mod.dir);
  return roots;
}

/** Read the content of one game from the given roots (vanilla first, then mods). */
export function readContent(game: PdxGame, roots: string[]): PdxContent {
  const c: PdxContent = { equipment: [], resources: [], traits: [], treatyArticles: [], wargoals: [], ideologies: [] };
  if (game === 'hoi4') {
    c.equipment = collect(roots, 'common/units/equipment', (b) => /\bis_archetype\s*=\s*yes/.test(b), 'equipments');
    c.resources = collect(roots, 'common/resources', () => true, 'resources');
    c.wargoals = collect(roots, 'common/wargoals', () => true, 'wargoal_types');
    c.ideologies = collect(roots, 'common/ideologies', () => true, 'ideologies');
  } else if (game === 'vic3') {
    // trait_child is the placeholder personality of children
    c.traits = collect(roots, 'common/character_traits', (b, key) => /\btype\s*=\s*personality\b/.test(b) && !/child/.test(key));
    // articles that ask for a state, an amount, goods... cannot be made from a conversation
    c.treatyArticles = collect(roots, 'common/treaty_articles', (b) => !/\brequired_inputs\s*=|\binput_[a-z_]+|_input_/.test(b));
  } else if (game === 'eu5') {
    c.traits = collect(roots, 'in_game/common/traits', (b) => /\bcategory\s*=\s*ruler\b/.test(b) && /\bflavor\s*=\s*personality\b/.test(b));
  } else if (game === 'stellaris') {
    // research points are not handed over
    c.resources = collect(roots, 'common/strategic_resources', (b, key) => !/\btradable\s*=\s*no\b/.test(b) && !/\bis_global\s*=\s*yes/.test(b) && !/_research$/.test(key));
  }
  return c;
}

const cache = new Map<PdxGame, { at: number; content: PdxContent }>();
const CACHE_MS = 5 * 60 * 1000;

/** The game's content with the enabled mods; empty lists when the game is not installed. Never throws. */
export function gameContent(game: PdxGame): PdxContent {
  const hit = cache.get(game);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.content;
  let content = EMPTY;
  try {
    content = readContent(game, contentRoots(game));
  } catch (error) {
    console.warn(`gameContent(${game}): could not read the game files:`, error);
  }
  cache.set(game, { at: Date.now(), content });
  return content;
}
