import fs from 'fs';
import path from 'path';
import { WH3_EXE_NAME } from './types';

const GAME_FOLDER = 'Total War WARHAMMER III';

export interface Wh3DetectionResult {
  path: string | null;
  source: 'configured' | 'steam_library' | 'default' | 'not_found';
  error?: string;
}

export function isWh3GameDir(dir: string | null | undefined): boolean {
  if (!dir) return false;
  try {
    return fs.existsSync(path.join(dir, WH3_EXE_NAME)) && fs.existsSync(path.join(dir, 'data'));
  } catch {
    return false;
  }
}

/** Extract every `"path" "..."` entry from Steam's libraryfolders.vdf. */
export function parseSteamLibraryFolders(vdf: string): string[] {
  const result: string[] = [];
  const re = /"path"\s+"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(vdf)) !== null) {
    result.push(m[1].replace(/\\\\/g, '\\'));
  }
  return result;
}

function steamRoots(): string[] {
  const roots = new Set<string>();
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  roots.add(path.join(pf86, 'Steam'));
  roots.add(path.join(pf, 'Steam'));
  for (const drive of ['C', 'D', 'E', 'F', 'G']) {
    roots.add(`${drive}:\\Steam`);
    roots.add(`${drive}:\\SteamLibrary`);
  }
  return [...roots];
}

export class Wh3PathDetector {
  static detect(configured?: string | null): Wh3DetectionResult {
    if (configured && isWh3GameDir(configured)) {
      return { path: configured, source: 'configured' };
    }

    const libraries = new Set<string>();
    for (const root of steamRoots()) {
      libraries.add(root);
      const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
      try {
        if (fs.existsSync(vdf)) {
          for (const lib of parseSteamLibraryFolders(fs.readFileSync(vdf, 'utf-8'))) {
            libraries.add(lib);
          }
        }
      } catch (error) {
        console.warn(`Wh3PathDetector: could not read ${vdf}:`, error);
      }
    }

    for (const lib of libraries) {
      const candidate = path.join(lib, 'steamapps', 'common', GAME_FOLDER);
      if (isWh3GameDir(candidate)) {
        return { path: candidate, source: 'steam_library' };
      }
    }

    return {
      path: null,
      source: 'not_found',
      error: configured
        ? `The configured folder does not contain ${WH3_EXE_NAME}: ${configured}`
        : 'Total War: WARHAMMER III install folder was not found',
    };
  }
}
