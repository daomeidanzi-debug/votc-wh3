/*
 * End-to-end test of the Warhammer III port's main-process code, without Electron.
 *
 *   node pipeline.test.cjs <fixtures_dir> <commands_out.lua>
 *
 * <fixtures_dir> holds state_*.json written by `python test_bridge.py --fixtures`.
 * The serialized commands of every action are written to <commands_out.lua>, which
 * `python test_bridge.py <commands_out.lua>` then executes through the real Lua bridge.
 *
 * TypeScript is loaded from $VOTC_TS (path to the typescript package) or node_modules.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const assert = require('assert');

const REPO = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(REPO, 'src', 'main');
const ACTIONS_DIR = path.join(REPO, 'default_userdata', 'actions', 'standard');
const PROMPTS_DIR = path.join(REPO, 'default_userdata', 'prompts');
const [fixturesDir, commandsOut] = process.argv.slice(2);
if (!fixturesDir || !commandsOut) {
  console.error('usage: node pipeline.test.cjs <fixtures_dir> <commands_out.lua>');
  process.exit(2);
}

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ', msg);
  else { failures++; console.log('  FAIL', msg); }
}
async function section(name, fn) {
  console.log(name);
  try { await fn(); } catch (e) { failures++; console.log('  FAIL threw:', e && e.stack || e); }
}

// ---------------------------------------------------------------- transpile
const ts = require(process.env.VOTC_TS || 'typescript');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'votc_ts_'));
const GAME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'votc_game_'));
(function transpile(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { transpile(full); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    const rel = path.relative(SRC, full).replace(/\.ts$/, '.js');
    const result = ts.transpileModule(fs.readFileSync(full, 'utf-8'), {
      fileName: full,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    if (result.diagnostics && result.diagnostics.length) {
      for (const d of result.diagnostics) console.log('  TS', rel, ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      failures += result.diagnostics.length;
    }
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), result.outputText);
  }
})(SRC);

// ---------------------------------------------------------------- stubs
const STUBS = path.join(OUT, '__stubs');
fs.mkdirSync(STUBS);
fs.writeFileSync(path.join(STUBS, 'electron.js'), `
  module.exports = {
    app: { getPath: () => ${JSON.stringify(OUT)}, getAppPath: () => ${JSON.stringify(REPO)}, isPackaged: false, getName: () => 'test' },
    shell: {}, ipcMain: { handle() {}, on() {} },
  };`);
fs.writeFileSync(path.join(STUBS, 'settings.js'), `
  let dir = ${JSON.stringify(GAME_DIR)};
  module.exports = { settingsRepository: {
    getCK3UserFolderPath: () => dir, setCK3UserFolderPath: (d) => { dir = d; }, getLanguage: () => 'zh',
  } };`);
fs.writeFileSync(path.join(STUBS, 'uuid.js'), `module.exports = { v4: () => require('crypto').randomUUID() };`);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return path.join(STUBS, 'electron.js');
  if (request === 'uuid') return path.join(STUBS, 'uuid.js');
  if (/(^|\/)SettingsRepository$/.test(request)) return path.join(STUBS, 'settings.js');
  return origResolve.call(this, request, parent, ...rest);
};
const load = (rel) => require(path.join(OUT, rel));

const { toLua, luaString, buildCommandFile } = load('wh3/luaSerialize.js');
const { buildGameDataFromWh3, describeExportError, WH3_TRAITS } = load('wh3/buildGameData.js');
const { ActionEffectWriter } = load('actions/ActionEffectWriter.js');
const { ActionSandbox } = load('actions/ActionSandbox.js');
const { Wh3Bridge } = load('wh3/Wh3Bridge.js');
const { parseSteamLibraryFolders, Wh3PathDetector, isWh3GameDir } = load('wh3/Wh3PathDetector.js');
const { initializationService } = load('utils/InitializationService.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8'));
const foreignState = fixture('state_foreign.json');
const ownHeroState = fixture('state_own_hero.json');

// Same rules as ActionRegistry.loadActionDefinition / validateCandidate
function loadAction(file) {
  const sandbox = { module: { exports: {} }, exports: {}, console };
  vm.runInContext(fs.readFileSync(file, 'utf-8'), vm.createContext(sandbox), { filename: file });
  const def = sandbox.module.exports;
  assert(def && typeof def === 'object', 'exports an object');
  assert(typeof def.signature === 'string' && def.signature, 'signature');
  assert(typeof def.description === 'string' || typeof def.description === 'function', 'description');
  assert(Array.isArray(def.args) || typeof def.args === 'function', 'args');
  if (Array.isArray(def.args)) for (const a of def.args) assert(typeof a.name === 'string' && typeof a.description === 'string', 'arg fields');
  assert(typeof def.check === 'function' && typeof def.run === 'function', 'check/run');
  return def;
}

function pickArgs(argDefs) {
  const args = {};
  for (const a of argDefs) {
    if (a.type === 'enum') args[a.name] = a.options[0];
    else if (a.type === 'number') args[a.name] = a.min !== undefined ? Math.max(a.min, 1) : 1;
    else if (a.type === 'boolean') args[a.name] = false;
    else args[a.name] = 'x';
  }
  return args;
}

(async () => {
  await section('lua serializer', () => {
    check(luaString('a"b\\c\nd\te') === '"a\\"b\\\\c\\nd\\te"', 'quotes, backslashes and whitespace escaped');
    check(luaString('x\u0001y') === '"x\\001y"', 'control chars become 3-digit decimal escapes');
    check(luaString('卡尔·弗兰茨') === '"卡尔·弗兰茨"', 'UTF-8 passes through');
    check(toLua({ end: 1, ok: true, 'a-b': 'x', n: null }) === '{ ["end"] = 1, ok = true, ["a-b"] = "x" }', 'keywords/odd keys bracketed, nulls dropped');
    check(toLua(1761400000123000) === '1761400000123000', 'large integer ids printed in full');
    let threw = false; try { toLua(NaN); } catch { threw = true; }
    check(threw, 'NaN rejected');
    check(buildCommandFile([]) === 'return { cmds = {  } }\n', 'empty command file');
  });

  await section('game data from a real bridge export (foreign warboss)', () => {
    const gd = buildGameDataFromWh3(foreignState, 'zh');
    const npc = gd.characters.get(gd.aiID);
    const player = gd.characters.get(gd.playerID);
    check(gd.characters.size === 2 && gd.playerID === 1 && gd.aiID === 2, 'player and target present');
    check(npc.fullName === '格里姆格 铁皮' && npc.shortName === '格里姆格', 'names');
    check(npc.gold === 300 && player.gold === 5000, 'gold = faction treasury');
    check(npc.opinionOfPlayer === -40, 'opinion from diplomatic attitude');
    check(npc.isRuler === true && npc.sheHe === 'he', 'ruler flag and pronoun');
    check(gd.date === '第 42 回合' && gd.totalDays === 42, 'turn as date');
    check(gd.wh3 && gd.wh3.sameFaction === false && gd.wh3.targetFaction.key === 'wh_main_grn_greenskins', 'wh3 info');
    check(npc.wh3.character.army.units[0].key === 'wh_main_grn_inf_orc_boyz', 'army attached');
    check(typeof structuredClone(gd) === 'object', 'structuredClone works (prompt caching snapshot)');
  });

  await section('game data for own hero', () => {
    const gd = buildGameDataFromWh3(ownHeroState, 'en');
    const npc = gd.characters.get(gd.aiID);
    check(gd.wh3.sameFaction === true && npc.opinionOfPlayer === 50, 'own faction subordinate');
    check(npc.liege === '卡尔·弗兰茨', 'liege = faction leader');
    check(npc.primaryTitle.startsWith('Champion hero of'), 'title from character type: ' + npc.primaryTitle);
    let threw = false; try { buildGameDataFromWh3({ ...foreignState, ok: false, error: 'nothing_selected' }, 'en'); } catch { threw = true; }
    check(threw, 'failed export is rejected');
    check(/点选/.test(describeExportError('nothing_selected', 'zh')), 'readable zh error');
  });

  await section('conversation history per campaign', async () => {
    const { VOTC_SUMMARIES_DIR } = load('utils/paths.js');
    const { CAMPAIGN_INFO_FILE } = load('gameData/GameData.js');
    const { SummariesManager } = load('utils/SummariesManager.js');
    const cid = foreignState.campaignId;
    check(typeof cid === 'string' && cid.length > 5, 'fixture carries a campaign id: ' + cid);

    const gd = buildGameDataFromWh3(foreignState, 'zh');
    check(gd.getSummariesKey() === cid, 'summaries keyed by campaign id');
    gd.saveCharactersSummaries('我们谈成了一笔交易。');
    const dir = path.join(VOTC_SUMMARIES_DIR, cid);
    check(fs.existsSync(path.join(dir, '2.json')) && fs.existsSync(path.join(dir, '1.json')), 'summary saved for both participants');
    const info = JSON.parse(fs.readFileSync(path.join(dir, CAMPAIGN_INFO_FILE), 'utf-8'));
    check(info.campaignId === cid && info.playerFaction === '瑞克领' && info.lastTurn === 42, 'campaign info written');

    // same campaign later (e.g. after loading a save): history comes back
    const again = buildGameDataFromWh3(foreignState, 'zh');
    again.loadCharactersSummaries();
    check(again.characters.get(2).conversationSummaries.length === 1, 'same campaign sees its history');

    // another campaign whose characters happen to have the same ids
    const other = buildGameDataFromWh3({ ...foreignState, campaignId: 'wh_main_emp_empire_999_0001' }, 'zh');
    other.loadCharactersSummaries();
    check(other.characters.get(2).conversationSummaries.length === 0, 'other campaign does not see it');
    check((await other.checkForSummariesFromOtherPlayers()).length === 0, 'no cross-campaign import offered');

    // a bridge without campaign ids falls back to the player id
    const legacy = buildGameDataFromWh3({ ...foreignState, campaignId: undefined }, 'zh');
    check(legacy.getSummariesKey() === '1', 'fallback key is the player id');
    check(buildGameDataFromWh3({ ...foreignState, campaignId: '../../evil' }, 'zh').getSummariesKey() === '______evil', 'unsafe ids sanitized');

    const listed = await SummariesManager.listAllSummaries();
    const entry = (listed || []).find((s) => s.playerId === cid && s.characterId === '2');
    check(!!entry && entry.playerName === '卡尔·弗兰茨 - 瑞克领 (turn 42)', 'summaries manager labels the campaign: ' + (entry && entry.playerName));
    check(!(listed || []).some((s) => s.characterId === '_campaign'), 'campaign info file not listed as a character');
  });

  await section('backstories and game lore', () => {
    const { applyBackstories, ensureBackstoriesDir, MAX_BACKSTORY_CHARS } = load('wh3/backstories.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'votc_lore_'));
    ensureBackstoriesDir(dir);
    check(fs.existsSync(path.join(dir, 'README.txt')), 'README created');
    fs.writeFileSync(path.join(dir, 'README.txt'), 'my notes');
    ensureBackstoriesDir(dir);
    check(fs.readFileSync(path.join(dir, 'README.txt'), 'utf-8') === 'my notes', 'README never overwritten');

    const cid = foreignState.campaignId;
    // subtype file and name file both exist: the name file wins (checked first)
    fs.writeFileSync(path.join(dir, 'wh_main_grn_orc_warboss.txt'), '所有军阀都恨矮人。');
    fs.writeFileSync(path.join(dir, '格里姆格 铁皮.txt'), '﻿  格里姆格曾在黑火隘口惨败。 \n');
    fs.writeFileSync(path.join(dir, 'wh_main_grn_greenskins.txt'), '铁牙部落以黑岩堡为家。');
    let gd = buildGameDataFromWh3(foreignState, 'zh');
    applyBackstories(gd, dir);
    const grim = gd.characters.get(2).wh3;
    check(grim.backstory === '格里姆格曾在黑火隘口惨败。', 'name file used, BOM and whitespace trimmed: ' + grim.backstory);
    check(grim.factionBackstory === '铁牙部落以黑岩堡为家。', 'faction file attached');
    check(gd.characters.get(1).wh3.backstory === undefined, 'player without files has no backstory');

    // campaign-specific file beats everything
    fs.mkdirSync(path.join(dir, cid));
    fs.writeFileSync(path.join(dir, cid, '2.txt'), 'x'.repeat(MAX_BACKSTORY_CHARS + 50));
    gd = buildGameDataFromWh3(foreignState, 'zh');
    applyBackstories(gd, dir);
    const b = gd.characters.get(2).wh3.backstory;
    check(b.startsWith('xxx') && b.length === MAX_BACKSTORY_CHARS + 1, 'campaign file wins and is capped');

    // without name/campaign files the subtype file is used
    fs.rmSync(path.join(dir, cid), { recursive: true });
    // emptied rather than deleted: some sandboxes silently ignore deleting non-ASCII names
    fs.writeFileSync(path.join(dir, '格里姆格 铁皮.txt'), '   ');
    gd = buildGameDataFromWh3(foreignState, 'zh');
    applyBackstories(gd, dir);
    check(gd.characters.get(2).wh3.backstory === '所有军阀都恨矮人。', 'subtype file used as fallback');
    applyBackstories(gd, path.join(dir, 'missing'));
    check(true, 'missing folder is ignored');

    for (const [rel, words] of [
      ['character_description/standard/pListMccTest2.js', ['backstory (written by the player', 'history (game lore): 格里姆格·铁皮是最强大的黑兽人。', 'What 格里姆格 is (game lore): Orc Warbosses rule through brute force.', 'Lore of 格里姆格的"铁牙"部落']],
      ['character_description/standard/pListMccTest2_ZH.js', ['背景故事（玩家设定', '经历（游戏设定）：格里姆格·铁皮是最强大的黑兽人。', '是什么样的角色（游戏设定）', '的背景（玩家设定）：铁牙部落']],
    ]) {
      const sandbox = { module: { exports: {} }, exports: {}, console };
      vm.runInContext(fs.readFileSync(path.join(PROMPTS_DIR, rel), 'utf-8'), vm.createContext(sandbox));
      const text = sandbox.module.exports(gd, gd.aiID);
      check(words.every((w) => text.includes(w)), `${rel} includes backstory, biography, type and faction lore`);
      check(!/undefined|NaN/.test(text), `${rel} still renders cleanly`);
    }
    const hbs = fs.readFileSync(path.join(PROMPTS_DIR, 'system', 'default.hbs'), 'utf-8');
    check(/written by the player is true/.test(hbs), 'system prompt tells the AI to trust player backstories');
  });

  await section('trait tables in sync with the Lua bridge', () => {
    const lua = fs.readFileSync(path.join(REPO, 'wh3_mod', 'script', 'campaign', 'mod', 'votc_wh3.lua'), 'utf-8');
    const block = lua.slice(lua.indexOf('local ALLOWED_TRAITS'), lua.indexOf('}', lua.indexOf('local ALLOWED_TRAITS')));
    const luaKeys = [...block.matchAll(/(\w+) = true/g)].map((m) => m[1]).sort();
    const actionSrc = fs.readFileSync(path.join(ACTIONS_DIR, 'z_wh3_gainsTrait.js'), 'utf-8');
    const actionKeys = [...actionSrc.matchAll(/^\s+(wh\w+): \{/gm)].map((m) => m[1]).sort();
    check(JSON.stringify(luaKeys) === JSON.stringify(Object.keys(WH3_TRAITS).sort()), 'buildGameData WH3_TRAITS == ALLOWED_TRAITS');
    check(JSON.stringify(luaKeys) === JSON.stringify(actionKeys), 'gainsTrait action list == ALLOWED_TRAITS');
  });

  await section('command validation', () => {
    const bad = [{ op: 'rm_rf' }, { op: 'war', a: { nested: 1 } }, { op: 'transfer_gold', amount: NaN }, 'not json', '[1]'];
    for (const b of bad) {
      let threw = false; try { ActionEffectWriter.parseCommand(b); } catch { threw = true; }
      check(threw, 'rejects ' + JSON.stringify(String(typeof b === 'string' ? b : JSON.stringify(b))));
    }
    check(ActionEffectWriter.parseCommand('{"op":"peace","a":"x","b":"y"}').op === 'peace', 'accepts JSON text');
  });

  const files = fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith('.js'));
  const expectForeign = {
    noOp: true, paysGoldToPlayer: true, playerPaysGold: true, changeAttitudeTowardsPlayer: true,
    declaresWarOnPlayer: true, makesPeaceWithPlayer: false, formsAllianceWithPlayer: true, signsTradeAgreement: true,
    becomesVassalOfPlayer: true, joinsPlayerFaction: false, cedesRegionToPlayer: true, gainsTrait: true,
    gainsExperience: true, isWounded: true, isKilled: true, givesUnitToPlayer: true, receivesUnitFromPlayer: true,
  };
  const expectOwnHero = {
    noOp: true, paysGoldToPlayer: false, playerPaysGold: false, changeAttitudeTowardsPlayer: false,
    declaresWarOnPlayer: false, makesPeaceWithPlayer: false, formsAllianceWithPlayer: false, signsTradeAgreement: false,
    becomesVassalOfPlayer: false, joinsPlayerFaction: false, cedesRegionToPlayer: false, gainsTrait: true,
    gainsExperience: true, isWounded: true, isKilled: true, givesUnitToPlayer: false, receivesUnitFromPlayer: false,
  };
  // run order for the end-to-end command file (trade before war, kill last)
  const ORDER = ['paysGoldToPlayer', 'playerPaysGold', 'changeAttitudeTowardsPlayer', 'signsTradeAgreement',
    'formsAllianceWithPlayer', 'declaresWarOnPlayer', 'becomesVassalOfPlayer', 'cedesRegionToPlayer', 'gainsTrait',
    'gainsExperience', 'isWounded', 'givesUnitToPlayer', 'receivesUnitFromPlayer', 'isKilled', 'noOp'];
  const collected = [];

  await section('actions against the foreign warboss', async () => {
    const defs = Object.fromEntries(files.map((f) => { const d = loadAction(path.join(ACTIONS_DIR, f)); return [d.signature, { def: d, file: path.join(ACTIONS_DIR, f) }]; }));
    check(Object.keys(defs).sort().join() === Object.keys(expectForeign).sort().join(), 'all ' + Object.keys(expectForeign).length + ' actions load and validate');
    for (const sig of ORDER) {
      const { def, file } = defs[sig];
      const gd = buildGameDataFromWh3(foreignState, 'zh');
      const npc = gd.characters.get(gd.aiID);
      const res = await def.check({ gameData: gd, sourceCharacter: npc });
      check(!!res.canExecute === expectForeign[sig], `${sig}: available=${!!res.canExecute}`);
      if (!res.canExecute) continue;
      const argDefs = typeof def.args === 'function' ? def.args({ gameData: gd, sourceCharacter: npc }) : def.args;
      const desc = typeof def.description === 'function' ? def.description({ gameData: gd, sourceCharacter: npc }) : def.description;
      check(typeof desc === 'string' && desc.length > 10, `${sig}: description`);
      for (const a of argDefs) {
        if (a.type === 'enum') check(Array.isArray(a.options) && a.options.length > 0, `${sig}: enum ${a.name} has options`);
        if (a.type === 'number') check(a.min <= a.max, `${sig}: number ${a.name} range ${a.min}..${a.max}`);
      }
      const args = pickArgs(argDefs);
      const sent = [];
      const ctx = { gameData: gd, sourceCharacter: npc, targetCharacter: undefined, args, lang: 'zh' };
      const preview = await ActionSandbox.executeAction(file, { ...ctx, dryRun: true, runGameEffect: () => sent.push('DRY') });
      check(sent.length === 0, `${sig}: dry run sends nothing`);
      const result = await ActionSandbox.executeAction(file, { ...ctx, dryRun: false, runGameEffect: (c) => sent.push(ActionEffectWriter.parseCommand(c)) });
      const msg = result && result.message ? (result.message.zh || result.message.en) : '';
      check(sig === 'noOp' || (sent.length === 1 && !/失败|Failed/.test(msg)), `${sig}: ${msg || '(no message)'} ${sent.length ? JSON.stringify(sent[0]) : ''}`);
      if (preview && preview.message) check(!/失败|Failed/.test(preview.message.zh || preview.message.en), `${sig}: preview ok`);
      collected.push(...sent);
    }
  });

  await section('actions against own hero', async () => {
    for (const f of files) {
      const def = loadAction(path.join(ACTIONS_DIR, f));
      const gd = buildGameDataFromWh3(ownHeroState, 'en');
      const res = await def.check({ gameData: gd, sourceCharacter: gd.characters.get(gd.aiID) });
      check(!!res.canExecute === expectOwnHero[def.signature], `${def.signature}: available=${!!res.canExecute}`);
    }
  });

  await section('action edge cases', async () => {
    const run = async (file, args, state = foreignState) => {
      const gd = buildGameDataFromWh3(state, 'en');
      const sent = [];
      const r = await ActionSandbox.executeAction(path.join(ACTIONS_DIR, file), {
        gameData: gd, sourceCharacter: gd.characters.get(gd.aiID), args, lang: 'en', dryRun: false,
        runGameEffect: (c) => sent.push(ActionEffectWriter.parseCommand(c)),
      });
      return { r, sent, gd };
    };
    let x = await run('z_wh3_paysGold.js', { amount: 999999 });
    check(x.sent.length === 0 && /Failed/.test(x.r.message.en), 'cannot pay more than the treasury');
    x = await run('z_wh3_paysGold.js', {});
    check(x.sent.length === 0, 'missing amount rejected');
    x = await run('z_wh3_cedesRegion.js', { region: 'altdorf' });
    check(x.sent.length === 0, "cannot cede a region the faction doesn't own");
    x = await run('z_wh3_gainsTrait.js', { who: 'npc', trait: 'wh3_evil' });
    check(x.sent.length === 0, 'unknown trait rejected');
    x = await run('z_wh3_changeAttitude.js', { amount: 0 });
    check(x.sent.length === 0 && x.r === undefined, 'zero attitude change does nothing');
    x = await run('z_wh3_paysGold.js', { amount: 100 });
    check(x.gd.characters.get(2).gold === 200 && x.gd.characters.get(1).gold === 5100, 'local gold updated after payment');
    x = await run('z_wh3_isKilled.js', {}, ownHeroState);
    check(x.sent[0].op === 'kill' && x.sent[0].cqi === 3, 'kill targets the NPC');
  });

  await section('prompt scripts', () => {
    const scripts = [
      'character_description/standard/pListMccTest2.js', 'character_description/standard/pListMccTest2_ZH.js',
      'character_description/standard/pListSimple.js', 'example_messages/standard/mccAliChat.js',
      'example_messages/standard/mccAliChat_ZH.js',
    ];
    for (const rel of scripts) {
      for (const [label, state] of [['foreign', foreignState], ['own hero', ownHeroState]]) {
        const sandbox = { module: { exports: {} }, exports: {}, console };
        vm.runInContext(fs.readFileSync(path.join(PROMPTS_DIR, rel), 'utf-8'), vm.createContext(sandbox));
        const gd = buildGameDataFromWh3(state, 'zh');
        const out = sandbox.module.exports(gd, gd.aiID);
        const text = typeof out === 'string' ? out : JSON.stringify(out);
        check(text && !/undefined|NaN|\[object Object\]/.test(text), `${rel} (${label}) renders cleanly`);
        if (rel.includes('pListMccTest2') && label === 'foreign') {
          check(text.includes('格里姆格') && /兽人|orc/i.test(text), `${rel} mentions the warboss and the orc voice`);
        }
      }
    }
    const hbs = fs.readFileSync(path.join(PROMPTS_DIR, 'system', 'default.hbs'), 'utf-8');
    const opens = (hbs.match(/\{\{#(\w+)/g) || []).map((s) => s.slice(3));
    const closes = (hbs.match(/\{\{\/(\w+)\}\}/g) || []).map((s) => s.slice(3, -2));
    check(JSON.stringify(opens.sort()) === JSON.stringify(closes.sort()), 'default.hbs blocks balanced: ' + opens.join(','));
  });

  // write the command file exactly as Wh3Bridge would, plus an export for the e2e check
  const now = Math.floor(Date.now() / 1000);
  let nextId = Date.now() * 1000;
  const fileCmds = [{ op: 'export', reqId: 'e2e' }, ...collected].map((c) => ({ ...c, id: nextId++, ts: now }));
  fs.writeFileSync(commandsOut, buildCommandFile(fileCmds), 'utf-8');
  console.log(`wrote ${fileCmds.length} commands to ${commandsOut}`);

  await section('bridge file protocol with a fake game', async () => {
    fs.writeFileSync(path.join(GAME_DIR, 'Warhammer3.exe'), '');
    fs.mkdirSync(path.join(GAME_DIR, 'data'), { recursive: true });
    const bridge = new Wh3Bridge();
    // fake game: answer exports, ack everything, fail one op
    let lastId = 0;
    const game = setInterval(() => {
      let raw;
      try { raw = fs.readFileSync(path.join(GAME_DIR, 'votc_commands.lua'), 'utf-8'); } catch { return; }
      const results = [];
      for (const m of raw.matchAll(/\{ ([^{}]*) \}/g)) {
        const body = m[1];
        const id = Number((body.match(/id = (\d+)/) || [])[1]);
        const op = (body.match(/op = "(\w+)"/) || [])[1];
        if (!id || id <= lastId) continue;
        lastId = id;
        if (op === 'export') {
          const reqId = body.match(/reqId = "([^"]+)"/)[1];
          fs.writeFileSync(path.join(GAME_DIR, 'votc_state.json'), JSON.stringify({ ...foreignState, reqId }));
        }
        results.push({ id, op, ok: op !== 'kill', message: op === 'kill' ? 'nope' : 'ok' });
      }
      if (results.length) fs.writeFileSync(path.join(GAME_DIR, 'votc_ack.json'), JSON.stringify({ version: 't', lastId, results }));
    }, 50);
    try {
      const state = await bridge.requestExport(undefined, 3000);
      check(state.ok && state.target.cqi === 2, 'requestExport resolves with the game state');
      const failed = [];
      bridge.on('command-failed', (r) => failed.push(r));
      const a = bridge.queueCommand({ op: 'peace', a: 'x', b: 'y' });
      const b = bridge.queueCommand({ op: 'kill', cqi: 2 });
      check(b > a, 'command ids increase');
      await new Promise((r) => setTimeout(r, 1500));
      check(failed.length === 1 && failed[0].op === 'kill' && failed[0].message === 'nope', 'failed command reported once');
      const file = fs.readFileSync(path.join(GAME_DIR, 'votc_commands.lua'), 'utf-8');
      check(file === 'return { cmds = {  } }\n', 'acknowledged commands removed from the file');
      check(!fs.existsSync(path.join(GAME_DIR, 'votc_commands.lua.tmp')), 'no temp file left behind');
    } finally {
      clearInterval(game);
    }
    // nobody answers
    let timedOut = false;
    try { await bridge.requestExport(undefined, 400); } catch (e) { timedOut = e.code === 'timeout'; }
    check(timedOut, 'export times out with code "timeout" when the game is not running');
    bridge.dispose();
  });

  await section('folder detection and initialization checks', async () => {
    const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}';
    const libs = parseSteamLibraryFolders(vdf);
    check(libs.length === 2 && libs[0] === 'C:\\Program Files (x86)\\Steam' && libs[1] === 'D:\\SteamLibrary', 'parses libraryfolders.vdf');
    const detected = Wh3PathDetector.detect(null);
    check(detected.path === null || isWh3GameDir(detected.path), 'detect() returns a real game folder or null: ' + detected.path);
    check(isWh3GameDir(GAME_DIR) && !isWh3GameDir(os.tmpdir()), 'isWh3GameDir checks exe + data');
    let r = await initializationService.ensureRequiredFiles();
    check(r.success && r.warnings.length === 0, 'fake game dir passes the per-conversation check');
    const init = await initializationService.initialize();
    check(init.success && init.warnings.some((w) => w.type === 'mod_missing'), 'startup warns when votc_wh3.pack is missing');
    fs.writeFileSync(path.join(GAME_DIR, 'data', 'votc_wh3.pack'), '');
    const init2 = await initializationService.initialize();
    check(!init2.warnings.some((w) => w.type === 'mod_missing'), 'no warning once the pack is in data/');
    require(path.join(STUBS, 'settings.js')).settingsRepository.setCK3UserFolderPath(os.tmpdir());
    r = await initializationService.ensureRequiredFiles();
    check(!r.success && r.warnings[0].type === 'path_not_found', 'non-game folder rejected');
  });

  console.log();
  console.log('FAILURES:', failures);
  process.exit(failures ? 1 : 0);
})();
