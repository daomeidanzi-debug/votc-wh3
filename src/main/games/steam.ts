import fs from 'fs';
import os from 'os';
import path from 'path';

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

let cachedLibraries: string[] | null = null;

/** Every Steam library folder on this machine (cached; reading the vdf files is cheap but noisy). */
export function steamLibraries(): string[] {
  if (cachedLibraries) return cachedLibraries;
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
      console.warn(`steam: could not read ${vdf}:`, error);
    }
  }
  cachedLibraries = [...libraries];
  return cachedLibraries;
}

/** `<library>/steamapps/common/<folder>` for the first library where `accept` holds. */
export function findSteamGame(folder: string, accept: (dir: string) => boolean): string | null {
  for (const lib of steamLibraries()) {
    const candidate = path.join(lib, 'steamapps', 'common', folder);
    if (accept(candidate)) return candidate;
  }
  return null;
}

/** `<library>/steamapps/workshop/content/<appId>` folders that exist. */
export function steamWorkshopDirs(appId: string): string[] {
  return steamLibraries()
    .map((lib) => path.join(lib, 'steamapps', 'workshop', 'content', appId))
    .filter((dir) => {
      try { return fs.existsSync(dir); } catch { return false; }
    });
}

/** Documents\Paradox Interactive\<game> (also checks the OneDrive-redirected Documents). */
export function paradoxUserDir(gameFolder: string): string[] {
  const home = os.homedir();
  const docs = [
    path.join(home, 'Documents'),
    path.join(home, 'OneDrive', 'Documents'),
    path.join(home, 'OneDrive', '文档'),
  ];
  return docs.map((d) => path.join(d, 'Paradox Interactive', gameFolder));
}

export function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Write and delete a probe file; returns an error message, or null when writing works. */
export function testWritable(dir: string): string | null {
  const probe = path.join(dir, 'votc_permission_test.tmp');
  try {
    fs.writeFileSync(probe, 'test', 'utf-8');
    fs.rmSync(probe, { force: true });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
