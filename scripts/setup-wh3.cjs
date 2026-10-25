/*
 * Finishes `npm install --ignore-scripts` (run by `npm run setup`).
 *
 * A plain `npm install` aborts when active-win's prebuilt binary cannot be downloaded
 * from GitHub (common behind proxies) and no C++ toolchain is installed. Here each
 * install step runs on its own, and active-win falls back to the identical binary
 * shipped with an installed copy of the original VOTC.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
let problems = 0;

function runNode(script, cwd, args = []) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, stdio: 'inherit' });
  return r.status === 0;
}

function step(name, fn) {
  process.stdout.write(`\n== ${name}\n`);
  try {
    if (fn() === false) problems++;
  } catch (error) {
    problems++;
    console.error(`   failed: ${error.message}`);
  }
}

step('electron runtime', () => {
  if (fs.existsSync(path.join(NM, 'electron', 'dist', 'electron.exe'))) {
    console.log('   already installed');
    return true;
  }
  return runNode(path.join(NM, 'electron', 'install.js'), path.join(NM, 'electron'));
});

step('esbuild binary', () => {
  const install = path.join(NM, 'esbuild', 'install.js');
  if (!fs.existsSync(install)) return true;
  return runNode(install, path.join(NM, 'esbuild'));
});

step('active-win native binding', () => {
  const pkgDir = path.join(NM, 'active-win');
  const version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')).version;
  const rel = path.join('lib', 'binding', 'napi-6-win32-unknown-x64', 'node-active-win.node');
  const target = path.join(pkgDir, rel);
  if (fs.existsSync(target)) {
    console.log('   already present');
    return true;
  }
  const preGyp = path.join(NM, '@mapbox', 'node-pre-gyp', 'bin', 'node-pre-gyp');
  if (fs.existsSync(preGyp) && runNode(preGyp, pkgDir, ['install']) && fs.existsSync(target)) {
    return true;
  }
  console.log('   download failed, looking for an installed VOTC with the same binary...');
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'voices-of-the-court'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VOTC'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'votc-wh3'),
  ];
  for (const dir of candidates) {
    const src = path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', 'active-win');
    const srcBin = path.join(src, rel);
    if (!fs.existsSync(srcBin)) continue;
    const srcVersion = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf-8')).version;
    if (srcVersion !== version) {
      console.log(`   ${dir} has active-win ${srcVersion}, need ${version}`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(srcBin, target);
    console.log(`   copied from ${dir}`);
    return true;
  }
  console.error(`   could not get active-win ${version}. Download napi-6-win32-unknown-x64.tar.gz from`);
  console.error(`   https://github.com/sindresorhus/active-win/releases/tag/v${version} and extract it to ${path.dirname(target)}`);
  return false;
});

console.log(problems ? `\nsetup finished with ${problems} problem(s)` : '\nsetup complete');
process.exit(problems ? 1 : 0);
