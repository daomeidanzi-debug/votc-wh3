/*
 * Builds votc_attila.pack (Total War: ATTILA mod pack) from the files under attila_mod/lua_scripts/.
 *
 *   node attila_mod/build_pack.cjs [output.pack]
 *
 * Attila reads PFH4 packs (Warhammer III uses PFH5, which adds a compression byte per file):
 *   header : "PFH4", type=3 (mod), pack-ref count/size = 0, file count, file index size, timestamp
 *   index  : per file -> u32 size, backslash path, NUL
 *   data   : file contents in index order
 */
const fs = require('fs');
const path = require('path');

function collect(modDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ rel: path.relative(modDir, full).split(path.sep).join('\\').toLowerCase(), full });
    }
  };
  walk(path.join(modDir, 'lua_scripts'));
  // GPL-3.0 §4: every copy of the mod carries the license text (the game ignores .txt here)
  files.push({ rel: 'lua_scripts\\votc_attila_license.txt', full: path.join(modDir, '..', 'LICENSE') });
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function build(outPath, modDir = __dirname) {
  const files = collect(modDir);
  const indexParts = [];
  const dataParts = [];
  for (const f of files) {
    const content = fs.readFileSync(f.full);
    const head = Buffer.alloc(4);
    head.writeUInt32LE(content.length, 0);
    indexParts.push(head, Buffer.from(f.rel, 'utf-8'), Buffer.from([0]));
    dataParts.push(content);
  }
  const index = Buffer.concat(indexParts);
  const header = Buffer.alloc(28);
  header.write('PFH4', 0, 'ascii');
  header.writeUInt32LE(3, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(files.length, 16);
  header.writeUInt32LE(index.length, 20);
  header.writeUInt32LE(Math.floor(Date.now() / 1000), 24);
  fs.writeFileSync(outPath, Buffer.concat([header, index, ...dataParts]));
  for (const f of files) console.log('  packed', f.rel);
  console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
}

module.exports = { build };

if (require.main === module) {
  build(process.argv[2] || path.join(__dirname, 'votc_attila.pack'));
}
