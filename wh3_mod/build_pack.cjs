/*
 * Builds votc_wh3.pack (PFH5 mod pack, uncompressed) from the files under wh3_mod/script/.
 *
 *   node wh3_mod/build_pack.cjs [output.pack]
 *
 * Layout matches packs produced by RPFM for Warhammer III script mods:
 *   header : "PFH5", type=3 (mod), pack-ref count/size = 0, file count, file index size, timestamp = 0
 *   index  : per file -> u32 size, u8 compressed (0), backslash path, NUL
 *   data   : file contents in index order
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SOURCE_DIRS = ['script'];

function collect() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ rel: path.relative(HERE, full).split(path.sep).join('\\').toLowerCase(), full });
    }
  };
  for (const d of SOURCE_DIRS) walk(path.join(HERE, d));
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function build(outPath) {
  const files = collect();
  const indexParts = [];
  const dataParts = [];
  for (const f of files) {
    const content = fs.readFileSync(f.full);
    const head = Buffer.alloc(5);
    head.writeUInt32LE(content.length, 0);
    head.writeUInt8(0, 4);
    indexParts.push(head, Buffer.from(f.rel, 'utf-8'), Buffer.from([0]));
    dataParts.push(content);
  }
  const index = Buffer.concat(indexParts);
  const header = Buffer.alloc(28);
  header.write('PFH5', 0, 'ascii');
  header.writeUInt32LE(3, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(files.length, 16);
  header.writeUInt32LE(index.length, 20);
  header.writeUInt32LE(0, 24);
  fs.writeFileSync(outPath, Buffer.concat([header, index, ...dataParts]));
  for (const f of files) console.log('  packed', f.rel);
  console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
}

build(process.argv[2] || path.join(HERE, 'votc_wh3.pack'));
