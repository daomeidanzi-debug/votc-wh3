/*
 * Prompt and action audit: for every game, builds a conversation from a realistic game
 * state, renders the full prompt through the app's own PromptBuilder (with the shipped
 * prompt settings for that game and the player's real mod list) and lists the actions the
 * AI would be offered. Writes one file per game, and fails when a prompt misses what the
 * character must know or leaks what it must not.
 *
 *   python tests/make_tw_fixtures.py <dir>
 *   (cd wh3_mod/tests && python test_bridge.py --fixtures <dir>)
 *   node tests/prompt_audit.cjs <dir> <out_dir>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'src', 'main');
const ACTIONS_DIR = path.join(REPO, 'default_userdata', 'actions', 'standard');
const [fixtures, outDir] = process.argv.slice(2);
if (!fixtures || !outDir) { console.error('usage: node tests/prompt_audit.cjs <fixtures_dir> <out_dir>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ', msg);
  else { failures++; console.log('  FAIL', msg); }
}

// ---------------------------------------------------------------- transpile + stubs
const ts = require(process.env.VOTC_TS || path.join(REPO, 'node_modules', 'typescript'));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'votc_audit_ts_'));
(function transpile(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { transpile(full); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    const rel = path.relative(SRC, full).replace(/\.ts$/, '.js');
    const result = ts.transpileModule(fs.readFileSync(full, 'utf-8'), {
      fileName: full,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), result.outputText);
  }
})(SRC);
const STUBS = path.join(OUT, '__stubs');
fs.mkdirSync(STUBS);
fs.writeFileSync(path.join(STUBS, 'electron.js'), `
  module.exports = {
    app: { getPath: () => ${JSON.stringify(OUT)}, getAppPath: () => ${JSON.stringify(REPO)}, isPackaged: false, getName: () => 'test' },
    shell: {}, ipcMain: { handle() {}, on() {} }, clipboard: { readText: () => '', writeText() {} },
  };`);
// prompt settings exactly as a fresh install has them, per game
fs.writeFileSync(path.join(STUBS, 'settings.js'), `
  let game = 'wh3';
  const load = (rel) => require(${JSON.stringify(OUT)} + '/' + rel);
  module.exports = { settingsRepository: {
    getCK3UserFolderPath: () => null, getActiveGame: () => game, setActiveGame: (g) => { game = g; }, getLanguage: () => 'zh',
    getPromptSettings: (g) => {
      const { promptConfigManager } = load('conversation/PromptConfigManager.js');
      const { promptVariantsFor } = load('games/types.js');
      const s = promptConfigManager.normalizeSettings({}, { defaultBlocks: promptConfigManager.getDefaultBlocks() });
      return { ...s, game: g, mainTemplate: promptConfigManager.mainTemplateForGame(s.mainTemplate, promptVariantsFor(g || game)) };
    },
    getSummaryPromptSettings: () => ({ rollingPrompt: '', finalPrompt: '', letterSummaryPrompt: '', maxPastSummaries: 5 }),
    getAppSettings: () => ({ language: 'zh' }), getAutoSwitchPromptLocale: () => true,
  } };`);
fs.writeFileSync(path.join(STUBS, 'uuid.js'), `module.exports = { v4: () => require('crypto').randomUUID() };`);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return path.join(STUBS, 'electron.js');
  if (request === 'uuid') return path.join(STUBS, 'uuid.js');
  if (/(^|\/)SettingsRepository$/.test(request)) return path.join(STUBS, 'settings.js');
  try {
    return origResolve.call(this, request, parent, ...rest);
  } catch (error) {
    // the transpiled files live in a temp folder: packages come from the repo
    if (!request.startsWith('.')) return require.resolve(request, { paths: [REPO] });
    throw error;
  }
};
const load = (rel) => require(path.join(OUT, rel));

const { promptConfigManager } = load('conversation/PromptConfigManager.js');
promptConfigManager.seedDefaults();
const { PromptBuilder } = load('conversation/PromptBuilder.js');
const { SnapshotParser } = load('games/paradox/snapshot.js');
const { buildGameDataFromPdx, personTargetId } = load('games/paradox/buildGameData.js');
const { PDX_PROFILES } = load('games/paradox/profiles.js');
const { buildGameDataFromWh3, WH3_PROFILE } = load('games/totalwar/buildGameData.js');
const { TK_PROFILE } = load('games/index.js');
const { ATTILA_LOCALIZATION } = load('games/totalwar/attila.js');
const { applyWorldMods } = load('games/mods.js');
const { compileCommand } = load('games/paradox/commands.js');
const { ActionSandbox } = load('actions/ActionSandbox.js');
const { getAdapter } = load('games/index.js');

const actions = fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith('.js')).map((f) => {
  const sandbox = { module: { exports: {} }, exports: {}, console };
  vm.runInContext(fs.readFileSync(path.join(ACTIONS_DIR, f), 'utf-8'), vm.createContext(sandbox));
  return { file: path.join(ACTIONS_DIR, f), def: sandbox.module.exports };
});

function snapshot(lines) {
  let snap = null;
  const p = new SnapshotParser({ onSnapshot: (s) => { snap = s; } });
  for (const l of lines) p.feed(l);
  return snap;
}

// realistic snapshots, in the format each mod writes
const PDX = {
  hoi4: [
    'VOTC|BEGIN|hoi4|2|talk', 'VOTC|META|campaign|482913', 'VOTC|META|date|1962.3.1',
    'VOTC|P|tag|GER', 'VOTC|P|name|德意志国', 'VOTC|P|leader|阿尔伯特·施佩尔', 'VOTC|P|ideology|改革派', 'VOTC|P|stability|41', 'VOTC|P|political_power|233', 'VOTC|P|war_with|苏联残余',
    'VOTC|C|ITA|name|意大利帝国', 'VOTC|C|ITA|leader|伊塔洛·巴尔博', 'VOTC|C|ITA|government|法西斯主义', 'VOTC|C|ITA|stability|62', 'VOTC|C|ITA|faction|罗马条约组织', 'VOTC|C|ITA|major|yes',
    'VOTC|R|ITA|opinion|-20', 'VOTC|C|USA|name|美利坚合众国', 'VOTC|C|USA|leader|理查德·尼克松', 'VOTC|C|USA|major|yes', 'VOTC|R|USA|opinion|-60',
    'VOTC|CH|ITA|伊塔洛·巴尔博|ruler|yes', 'VOTC|CH|ITA|伊塔洛·巴尔博|trait|空军元帅', 'VOTC|CH|GER|赖因哈德·海德里希|title|勃艮第骑士团国领袖',
    'VOTC|META|talk|country', 'VOTC|META|talk_tag|ITA', 'VOTC|END',
  ],
  vic3: [
    'VOTC|BEGIN|vic3|2|talk', 'VOTC|META|campaign|123456', 'VOTC|META|date|1848年3月1日',
    'VOTC|P|tag|GBR', 'VOTC|P|name|大不列颠', 'VOTC|P|leader|维多利亚', 'VOTC|P|gdp|512000', 'VOTC|P|treasury|90000', 'VOTC|P|rank|列强',
    'VOTC|C|FRA|name|法国', 'VOTC|C|FRA|leader|路易-菲利普', 'VOTC|C|FRA|gdp|300000', 'VOTC|C|FRA|rank|列强', 'VOTC|C|FRA|allies|西班牙', 'VOTC|R|FRA|opinion|10',
    'VOTC|CH|FRA|托马·比若|title|将军', 'VOTC|CH|FRA|托马·比若|age|63', 'VOTC|CH|FRA|托马·比若|trait|鲁莽', 'VOTC|CH|FRA|托马·比若|location|阿尔及利亚',
    'VOTC|CH|FRA|托马·比若|spouse|伊丽莎白', 'VOTC|CH|FRA|托马·比若|children|莱奥妮', 'VOTC|CH|FRA|路易-菲利普|ruler|yes', 'VOTC|CH|FRA|基佐|title|首相',
    'VOTC|META|talk|character', 'VOTC|META|talk_tag|FRA', 'VOTC|META|talk_name|托马·比若', 'VOTC|END',
  ],
  eu5: [
    'VOTC|BEGIN|eu5|2|talk', 'VOTC|META|campaign|777', 'VOTC|META|date|1444年11月11日',
    'VOTC|P|tag|CAS', 'VOTC|P|name|卡斯蒂利亚', 'VOTC|P|leader|胡安二世', 'VOTC|P|gold|412', 'VOTC|P|stability|1',
    'VOTC|C|POR|name|葡萄牙', 'VOTC|C|POR|leader|阿方索五世', 'VOTC|C|POR|gold|200', 'VOTC|C|POR|great_power|no', 'VOTC|R|POR|opinion|30',
    'VOTC|CH|POR|阿方索五世|ruler|yes', 'VOTC|CH|POR|阿方索五世|age|12', 'VOTC|CH|POR|阿方索五世|mother|阿拉贡的莱昂诺尔', 'VOTC|CH|POR|佩德罗|title|摄政',
    'VOTC|META|talk|character', 'VOTC|META|talk_tag|POR', 'VOTC|META|talk_name|阿方索五世', 'VOTC|END',
  ],
  stellaris: [
    'VOTC|BEGIN|stellaris|2|talk', 'VOTC|META|campaign|0', 'VOTC|META|date|2250.01.01',
    'VOTC|P|tag|E0', 'VOTC|P|name|地球联合国', 'VOTC|P|leader|总统 史密斯', 'VOTC|P|government|民主制', 'VOTC|P|energy|5000',
    'VOTC|C|E1|name|塔祖兰帝国', 'VOTC|C|E1|leader|女皇 克伊', 'VOTC|C|E1|government|帝制', 'VOTC|C|E1|species|塔祖兰人', 'VOTC|R|E1|opinion|-40',
    'VOTC|CH|E0|海军上将 罗|title|Commander', 'VOTC|META|talk|pick', 'VOTC|END',
  ],
  civ6: [
    'VOTC|BEGIN|civ6|1|talk', 'VOTC|META|date|公元1500年', 'VOTC|META|campaign|4711', 'VOTC|META|mods|更好的平衡',
    'VOTC|P|tag|P0', 'VOTC|P|name|中国', 'VOTC|P|leader|秦始皇', 'VOTC|P|government|君主制', 'VOTC|P|gold|812', 'VOTC|P|era|中世纪',
    'VOTC|C|P1|name|罗马', 'VOTC|C|P1|leader|图拉真', 'VOTC|C|P1|government|寡头政治', 'VOTC|C|P1|era|中世纪', 'VOTC|R|P1|war|yes', 'VOTC|R|P1|opinion|-100', 'VOTC|R|P1|grievances|25',
    'VOTC|C|P20|name|喀布尔', 'VOTC|C|P20|leader|喀布尔', 'VOTC|C|P20|leader_title|City-state', 'VOTC|C|P20|kind|city-state',
    'VOTC|CH|P1|图拉真|ruler|yes', 'VOTC|CH|P1|图拉真|title|罗马领袖', 'VOTC|CH|P0|马格努斯|title|总督，管家', 'VOTC|CH|P0|马格努斯|location|西安', 'VOTC|END',
  ],
};

/** target id per game, and what the prompt must and must not contain */
const CASES = {
  // the player's treasury (5000 / 9000) must not reach a foreign character
  wh3: { must: ['卡尔·弗兰茨', '外人不知道'], mustNot: ['treasury 5000', '国库 5000'] },
  tk: { must: ['刘备', '刘备的角色信息', '外人不知道'], mustNot: ['WARHAMMER', 'treasury 5000', '国库 5000', '[备的角色信息'] },
  attila: { must: ['阿提拉', '395 AD', '外人不知道'], mustNot: ['WARHAMMER', 'Warhammer', '{{', 'treasury 9000', '国库 9000', 'undefined'] },
  // world*: only checked while the player has the alternate-history mod enabled (it is read from their game)
  hoi4: { target: 'ITA', must: ['巴尔博', '1962', '罗马条约组织', 'Government of your country: 法西斯主义', 'Your traits: 空军元帅'], mustNot: ['233', '41%', 'countrys', '&#x27;'],
    worldMust: ['NOT real history', 'triumph of the Axis', '在这个世界里的历史'], worldMustNot: ['Second World War era'] },
  vic3: { target: () => personTargetId({ tag: 'FRA', name: '托马·比若' }), must: ['托马·比若', '鲁莽', '阿尔及利亚', '莱奥妮', '路易-菲利普', '基佐'], mustNot: ['512000', '90000'] },
  eu5: { target: 'POR', must: ['阿方索五世', '阿拉贡的莱昂诺尔', '1444'], mustNot: ['412'] },
  stellaris: { target: 'E1', must: ['克伊', '塔祖兰'], mustNot: ['5000'] },
  civ6: { target: 'P1', must: ['图拉真', '罗马', '中国', 'grievances', '更好的平衡', "Sid Meier's", '罗马: led by 图拉真; 寡头政治; at war with 中国'], mustNot: ['812', 'Hearts of Iron', '&#x27;', 'a game of'] },
};

function gameDataFor(game) {
  if (game === 'wh3') return buildGameDataFromWh3(JSON.parse(fs.readFileSync(path.join(fixtures, 'state_foreign.json'), 'utf-8')), 'zh', WH3_PROFILE);
  if (game === 'tk') return buildGameDataFromWh3(JSON.parse(fs.readFileSync(path.join(fixtures, 'tk_foreign.json'), 'utf-8')), 'zh', TK_PROFILE);
  if (game === 'attila') {
    const install = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War Attila';
    const raw = JSON.parse(fs.readFileSync(path.join(fixtures, 'attila_foreign.json'), 'utf-8'));
    const { state, profile } = ATTILA_LOCALIZATION.localize(raw, install);
    return buildGameDataFromWh3(state, 'zh', profile);
  }
  const snap = snapshot(PDX[game]);
  const people = new Map(snap.characters.map((p) => [`${p.tag}|${p.name}`, p]));
  const c = CASES[game];
  const gd = buildGameDataFromPdx(snap, typeof c.target === 'function' ? c.target() : c.target, PDX_PROFILES[game], 'zh', people);
  if (game === 'civ6') gd.reportedMods = (snap.meta.mods || '').split(';').filter(Boolean);
  if (game === 'vic3' && gd.pdx) gd.pdx.talkerInGame = true;
  return gd;
}

function pickArgs(argDefs) {
  const args = {};
  for (const a of argDefs || []) {
    if (a.type === 'enum') args[a.name] = a.options[0];
    else if (a.type === 'number') args[a.name] = Math.max(a.min ?? 1, 1);
    else args[a.name] = 'x';
  }
  return args;
}

(async () => {
  for (const game of Object.keys(CASES)) {
    console.log(game);
    const gd = gameDataFor(game);
    gd.game = game;
    applyWorldMods(gd);
    const npc = gd.characters.get(gd.aiID);
    const built = PromptBuilder.buildMessages([], npc, gd, undefined, undefined, { throwOnError: false });
    const text = built.messages.map((m) => `### ${m.role}\n${m.content}`).join('\n\n');
    check(built.errors.length === 0, `${game}: every prompt block renders${built.errors.length ? ': ' + built.errors.join('; ') : ''}`);

    // the actions the AI is offered, and whether each one compiles for the game
    const offered = [];
    const adapter = getAdapter(game);
    for (const { def, file } of actions.filter((a) => !a.def.games || a.def.games.includes(game))) {
      // a fresh conversation per action: running one changes the state the next one sees
      const agd = gameDataFor(game);
      agd.game = game;
      const anpc = agd.characters.get(agd.aiID);
      let res;
      try { res = await def.check({ gameData: agd, sourceCharacter: anpc }); } catch (e) { res = { canExecute: false, error: e.message }; }
      if (!res.canExecute) continue;
      const argDefs = typeof def.args === 'function' ? def.args({ gameData: agd, sourceCharacter: anpc }) : def.args;
      const sent = [];
      let error = '';
      try {
        await ActionSandbox.executeAction(file, {
          gameData: agd, sourceCharacter: anpc, args: pickArgs(argDefs), lang: 'zh', dryRun: false,
          runGameEffect: (c) => sent.push(game in PDX_PROFILES ? compileCommand(game, c) : adapter.parseCommand(c)),
        });
      } catch (e) { error = e.message; }
      offered.push(`${def.signature}${sent.length ? '' : ' (no effect sent)'}${error ? ' ERROR ' + error : ''}`);
      check(!error, `${game}: ${def.signature} runs and its command is valid${error ? ': ' + error : ''}`);
    }
    fs.writeFileSync(path.join(outDir, `${game}.txt`), `${text}\n\n### actions offered\n${offered.join('\n')}\n`, 'utf-8');

    const c = CASES[game];
    for (const m of c.must) check(text.includes(m), `${game}: prompt knows "${m}"`);
    for (const m of c.mustNot) check(!text.includes(m), `${game}: prompt does not contain "${m}"`);
    if (c.worldMust || c.worldMustNot) {
      if (gd.worldMods?.conversion) {
        for (const m of c.worldMust || []) check(text.includes(m), `${game}: prompt knows "${m}"`);
        for (const m of c.worldMustNot || []) check(!text.includes(m), `${game}: prompt does not contain "${m}"`);
      } else {
        console.log(`  skip ${game}: no alternate-world mod enabled in the game, its checks need one`);
      }
    }
    // every character gets a speaking style
    check(text.includes('## How You Speak') && !text.includes('{{speechStyle'), `${game}: prompt has a speaking style`);
    check(!/undefined|NaN|\[object Object\]/.test(text), `${game}: no undefined / NaN in the prompt`);
    check(text.trimEnd().endsWith('都译成那种语言。]') && text.includes("reply entirely in the language of the player's latest message"), `${game}: the language rule (the player's language) comes last`);
    check(offered.length > 0, `${game}: ${offered.length} actions offered: ${offered.join(', ')}`);
  }
  console.log('\nFAILURES:', failures);
  process.exit(failures ? 1 : 0);
})();
