/*
 * Compiles every Paradox / Civilization VI command with sample fields and prints them as
 * JSON, for tests/check_commands.py (which checks every effect and trigger name against the
 * game's own script files).
 *
 *   node tests/dump_commands.cjs [commands.json]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const ts = require(path.join(__dirname, '..', 'node_modules', 'typescript'));

const SRC = path.join(__dirname, '..', 'src', 'main', 'games');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'votc_cmd_'));
(function transpile(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { transpile(full, path.join(out, e.name)); continue; }
    if (!e.name.endsWith('.ts')) continue;
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, e.name.replace(/\.ts$/, '.js')), ts.transpileModule(fs.readFileSync(full, 'utf-8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText);
  }
})(SRC, OUT);
const { compileCommand, supportedOps, VIC3_TRAITS, EU5_TRAITS } = require(path.join(OUT, 'paradox', 'commands.js'));
// the game files with the player's enabled mods: every entry they define is tried
const { contentRoots, readContent } = require(path.join(OUT, 'paradox', 'gameContent.js'));
const CONTENT = {};
const ROOTS = {};
for (const g of ['hoi4', 'vic3', 'eu5', 'stellaris']) { ROOTS[g] = contentRoots(g); CONTENT[g] = readContent(g, ROOTS[g]); }
const listOr = (g, kind, fallback) => (CONTENT[g] && CONTENT[g][kind] && CONTENT[g][kind].length ? CONTENT[g][kind] : fallback);

const T = { hoi4: ['GER', 'FRA', 'ENG'], vic3: ['GBR', 'FRA', 'PRU'], eu5: ['CAS', 'POR', 'ARA'], stellaris: ['E0', 'E1', 'E2'], civ6: ['P0', 'P1', 'P2'] };

/** sample fields per op (every enum value is tried) */
function samples(game, op) {
  const [a, b, c] = T[game];
  const two = { a, b };
  const out = [];
  const add = (fields) => out.push({ op, ...fields });
  switch (op) {
    case 'refresh': add({ tag: a }); break;
    case 'set_campaign': add({ id: 42 }); break;
    case 'opinion': add({ ...two, amount: 30 }); add({ ...two, amount: -60 }); break;
    case 'political_power': case 'money': case 'manpower': case 'favor':
      add({ from: a, to: b, amount: game === 'hoi4' && op === 'manpower' ? 5000 : 100 }); break;
    case 'stat':
      for (const stat of game === 'hoi4' ? ['stability', 'war_support'] : ['stability', 'prestige', 'legitimacy']) add({ tag: a, stat, amount: 5 });
      break;
    case 'equipment':
      for (const type of listOr(game, 'equipment', ['infantry_equipment'])) add({ from: a, to: b, type, amount: 100 });
      break;
    case 'wargoal': for (const type of listOr(game, 'wargoals', ['annex_everything'])) add({ ...two, type }); break;
    case 'popularity': for (const ideology of listOr(game, 'ideologies', ['democratic'])) add({ tag: a, ideology, amount: 5 }); break;
    case 'release': add({ master: a, subject: b }); break;
    case 'leave_faction': add({ tag: a }); break;
    case 'annex': add({ absorber: a, absorbed: b }); break;
    case 'obligation': add({ debtor: a, creditor: b }); break;
    case 'spy_network': case 'intel': add({ ...two, amount: 30 }); break;
    case 'puppet': add({ master: a, subject: b }); break;
    case 'subject':
      if (game === 'stellaris') add({ master: a, subject: b });
      else for (const type of game === 'vic3' ? ['protectorate', 'tributary', 'puppet', 'dominion', 'vassal'] : ['fiefdom', 'tributary']) add({ master: a, subject: b, type });
      break;
    case 'join_war': add({ country: a, ally: b, enemy: c }); break;
    case 'treaty':
      for (const article of listOr(game, 'treatyArticles', ['alliance'])) add({ ...two, article, years: 5 });
      break;
    case 'infamy': add({ tag: a, amount: 5 }); break;
    case 'char_trait': for (const trait of listOr(game, 'traits', game === 'vic3' ? VIC3_TRAITS : EU5_TRAITS)) add({ trait }); break;
    case 'char_exile': add({}); break;
    case 'char_kill': if (game === 'eu5') for (const reason of ['execution', 'assassination', 'beheading', 'poison_arrow', 'combat']) add({ by: a, reason }); else add({}); break;
    case 'resource': for (const resource of listOr(game, 'resources', ['energy'])) add({ from: a, to: b, resource, amount: 100 }); break;
    default: add(two);
  }
  return out;
}

const result = {};
for (const game of Object.keys(T)) {
  result[game] = [];
  for (const op of supportedOps(game)) {
    for (const cmd of samples(game, op)) {
      let compiled = null, error = null;
      try { compiled = compileCommand(game, cmd, CONTENT[game] || {}); } catch (e) { error = e.message; }
      result[game].push({ cmd, compiled, error });
    }
  }
}
result.roots = ROOTS;
const outFile = process.argv[2];
if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
} else {
  process.stdout.write(JSON.stringify(result, null, 1));
}
