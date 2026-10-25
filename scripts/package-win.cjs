/*
 * Runs `electron-builder --win`, recovering from the winCodeSign extraction error.
 *
 * electron-builder unpacks winCodeSign-2.6.0.7z, which contains two macOS symlinks.
 * Creating symlinks on Windows needs admin rights or Developer Mode, so the unpack
 * "fails" even though every Windows tool was extracted. When that happens, the
 * extracted folder is promoted to the cache name electron-builder looks for and the
 * build is retried.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
const READY = path.join(CACHE, 'winCodeSign-2.6.0');

function build() {
  const cli = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
  return spawnSync(process.execPath, [cli, '--win', ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit' }).status;
}

function repairCache() {
  if (fs.existsSync(path.join(READY, 'rcedit-x64.exe'))) return false;
  if (!fs.existsSync(CACHE)) return false;
  const attempts = fs.readdirSync(CACHE).filter((n) => /^\d+$/.test(n));
  const good = attempts.find((n) => fs.existsSync(path.join(CACHE, n, 'rcedit-x64.exe')) && fs.existsSync(path.join(CACHE, n, 'windows-10')));
  if (!good) return false;
  fs.cpSync(path.join(CACHE, good), READY, { recursive: true });
  for (const n of fs.readdirSync(CACHE)) {
    if (/^\d+(\.7z)?$/.test(n)) fs.rmSync(path.join(CACHE, n), { recursive: true, force: true });
  }
  console.log(`\nwinCodeSign: used extracted tools from attempt ${good}, retrying the build`);
  return true;
}

let status = build();
if (status !== 0 && repairCache()) {
  status = build();
}
process.exit(status);
