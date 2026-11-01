/*
 * Multi-game tests: the Paradox bridge (HOI4, Victoria 3, EU5, Stellaris), the game registry,
 * per-game action filtering and prompt variants. Runs the TypeScript sources directly.
 *
 *   node tests/games.test.cjs
 *
 * TypeScript is taken from node_modules/typescript, or from $VOTC_TS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'src', 'main');
const ACTIONS_DIR = path.join(REPO, 'default_userdata', 'actions', 'standard');
const PROMPTS_DIR = path.join(REPO, 'default_userdata', 'prompts');

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ', msg);
  else { failures++; console.log('  FAIL', msg); }
}
async function section(name, fn) {
  console.log(name);
  try { await fn(); } catch (e) { failures++; console.log('  FAIL threw:', (e && e.stack) || e); }
}

// ---------------------------------------------------------------- transpile + stubs
const ts = require(process.env.VOTC_TS || path.join(REPO, 'node_modules', 'typescript'));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'votc_games_ts_'));
const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'votc_pdx_user_'));
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
fs.writeFileSync(path.join(STUBS, 'settings.js'), `
  let game = 'hoi4';
  const folders = { hoi4: ${JSON.stringify(USER_DIR)} };
  module.exports = { settingsRepository: {
    getCK3UserFolderPath: () => folders[game] || null, setCK3UserFolderPath: (d) => { folders[game] = d; },
    getActiveGame: () => game, setActiveGame: (g) => { game = g; }, getLanguage: () => 'en',
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
const settings = require(path.join(STUBS, 'settings.js')).settingsRepository;

const { SnapshotParser, TAG_RE } = load('games/paradox/snapshot.js');
const { compileCommand, buildRunFile, supportedOps } = load('games/paradox/commands.js');
const { buildGameDataFromPdx, campaignFolder, talkTargets, personTargetId, publicView } = load('games/paradox/buildGameData.js');
const { PDX_PROFILES } = load('games/paradox/profiles.js');
const { getAdapter, listGames } = load('games/index.js');
const { promptVariantsFor, GAME_IDS } = load('games/types.js');
const { ActionSandbox } = load('actions/ActionSandbox.js');

// A snapshot as HOI4 writes it to game.log (prefixes as in a real log)
const HOI4_LOG = [
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|BEGIN|hoi4|1|snapshot',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|META|campaign|482913',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|META|seq|0',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|META|date|1 March 1939',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|P|tag|ENG',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|P|name|United Kingdom',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|P|leader|Neville Chamberlain',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|P|stability|62',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|C|GER|name|German Reich',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|C|GER|leader|Adolf Hitler',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|C|GER|government|Fascism',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|C|GER|stability|[?votc_v|0]',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|C|GER|major|yes',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|R|GER|opinion|-40',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|C|FRA|name|France',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|C|FRA|leader|Albert Lebrun',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|R|FRA|ally|yes',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|R|FRA|opinion|75',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|C|bad tag|name|x',
  '[00:01:02][effectimplementation.cpp:21460]: VOTC|END',
];

function parse(lines) {
  const snaps = [];
  const acks = [];
  const p = new SnapshotParser({ onSnapshot: (s) => snaps.push(s), onAck: (n) => acks.push(n) });
  for (const l of lines) p.feed(l);
  return { snaps, acks };
}

(async () => {
  await section('EU5 names and log', () => {
    const { stripTextCodes } = load('games/paradox/snapshot.js');
    const X = String.fromCharCode(0x15);
    check(stripTextCodes(`VOTC|P|leader|${X}TOOLTIP:CHARACTER,512 ${X}L; Philippe VI${X}!${X}!`) === 'VOTC|P|leader|Philippe VI', 'tooltip codes are stripped from names');
    check(stripTextCodes(`VOTC|P|name|${X}TOOLTIP:COUNTRY,4294967295 ${X}L; Country${X}!${X}!`) === 'VOTC|P|name|', 'an empty object counts as missing');
    check(stripTextCodes(`VOTC|CH|FRA|Jeanne|title|${X}e; ${X}TOOLTIP:GAME_CONCEPT,courtier ${X}L; Courtier${X}!${X}!`) === 'VOTC|CH|FRA|Jeanne|title|Courtier', 'styled text keeps its words');
    // EU5 resolves saved scopes by name in log text; SCOPE.sCountry(...) gave empty objects
    const dir = path.join(REPO, 'paradox_mods', 'votc_eu5', 'in_game', 'common');
    const all = ['scripted_effects', 'on_action', 'scripted_triggers'].flatMap((d) => fs.readdirSync(path.join(dir, d)).map((f) => fs.readFileSync(path.join(dir, d, f), 'utf-8'))).join('\n');
    check(!all.includes('SCOPE.s') && all.includes('[votc_p.GetTag]') && !/\.GetName\]/.test(all), 'eu5: log text uses saved scopes and names without tooltips');
    check(!all.includes('debug_log') && all.includes('error_log = "VOTC|BEGIN'), 'eu5: logs with error_log (debug.log is written late)');
    check(PDX_PROFILES.eu5.logFiles.join() === 'logs/error.log', 'eu5: the app reads error.log');
  });

  await section('snapshot parser', () => {
    const { snaps } = parse(HOI4_LOG);
    check(snaps.length === 1, 'one snapshot from BEGIN..END');
    const s = snaps[0];
    check(s.game === 'hoi4' && s.meta.campaign === '482913' && s.meta.date === '1 March 1939', 'meta fields');
    check(s.player.tag === 'ENG' && s.player.name === 'United Kingdom' && s.player.facts.stability === '62', 'player country');
    check(s.countries.length === 2 && s.countries.every((c) => TAG_RE.test(c.tag)), 'bad tags dropped');
    const ger = s.countries.find((c) => c.tag === 'GER');
    check(ger.leader === 'Adolf Hitler' && ger.government === 'Fascism', 'country fields');
    check(ger.facts.stability === undefined, 'unresolved localisation ([?var]) is ignored');
    check(ger.relation.opinion === -40 && !ger.relation.atWar, 'relation fields');
    const { snaps: none } = parse(HOI4_LOG.slice(0, -1));
    check(none.length === 0, 'unfinished snapshot is not reported');
    const vic = parse([
      '[20:45:27][jomini_effect_impl.cpp:454]: common/scripted_effects/votc_scripted_effects.txt:42: VOTC|BEGIN|vic3|1|monthly',
      '[20:45:27][jomini_effect_impl.cpp:454]: common/scripted_effects/votc_scripted_effects.txt:43: VOTC|P|tag|GBR',
      '[20:45:27][jomini_effect_impl.cpp:454]: common/scripted_effects/votc_scripted_effects.txt:44: VOTC|C|FRA|name|#bold France#!',
      '[20:45:27][jomini_effect_impl.cpp:454]: common/scripted_effects/votc_scripted_effects.txt:45: VOTC|END',
      '[20:45:28][jomini_effect_impl.cpp:454]: run/votc.txt:3: VOTC|ACK|4242',
    ]);
    check(vic.snaps[0].player.tag === 'GBR' && vic.snaps[0].countries[0].name === 'France', 'Jomini prefixes and #formatting removed');
    check(vic.acks[0] === 4242, 'ACK lines reported');
  });

  await section('command compiler', () => {
    for (const game of ['hoi4', 'vic3', 'eu5', 'stellaris']) {
      check(supportedOps(game).includes('opinion') && supportedOps(game).includes('refresh'), `${game}: opinion + refresh supported`);
    }
    const war = compileCommand('hoi4', { op: 'war', a: 'GER', b: 'POL' });
    check(war.effect.includes('declare_war_on = { target = POL type = annex_everything }') && war.check === 'GER = { has_war_with = POL }', 'hoi4 war');
    check(compileCommand('vic3', { op: 'treaty', a: 'GBR', b: 'FRA', article: 'alliance', years: 10 }).effect.includes('articles_to_create = { { article = alliance } }'), 'vic3 treaty');
    check(compileCommand('eu5', { op: 'money', from: 'CAS', to: 'ARA', amount: 50 }).effect === 'c:CAS = { add_gold = -50 } c:ARA = { add_gold = 50 }', 'eu5 money');
    check(compileCommand('stellaris', { op: 'war', a: 'E3', b: 'E0' }).effect.startsWith('event_target:votc_e3 = { declare_war'), 'stellaris addresses empires by slot');
    const bad = [
      ['hoi4', { op: 'war', a: 'GER } every_country = { annex_country = { target = ROOT } } {', b: 'POL' }],
      ['hoi4', { op: 'war', a: 'GER', b: 'GER' }],
      ['hoi4', { op: 'political_power', from: 'GER', to: 'POL', amount: 1e9 }],
      ['hoi4', { op: 'equipment', from: 'GER', to: 'POL', type: 'nuke', amount: 1 }],
      ['vic3', { op: 'puppet', master: 'GBR', subject: 'FRA' }],
      ['vic3', { op: 'treaty', a: 'GBR', b: 'FRA', article: 'annex', years: 1 }],
      ['stellaris', { op: 'opinion', a: 'GER', b: 'E1', amount: 5 }],
      ['eu5', { op: 'run_script', script: 'x' }],
    ];
    for (const [game, cmd] of bad) {
      let threw = false; try { compileCommand(game, cmd); } catch { threw = true; }
      check(threw, `${game}: rejects ${JSON.stringify(cmd).slice(0, 70)}`);
    }
  });

  await section('run files', () => {
    const q = [{ seq: 101, op: 'war', compiled: compileCommand('hoi4', { op: 'war', a: 'GER', b: 'POL' }) }];
    // HOI4 and Stellaris: no console either; a hidden event of the mod (Clausewitz syntax)
    const hoi4 = buildRunFile('hoi4', q);
    check(/^add_namespace = votc_cmd$/m.test(hoi4) && /country_event = \{\n\tid = votc_cmd\.1\n\thidden = yes\n\tis_triggered_only = yes\n\ttrigger = \{\n\t\tis_ai = no\n\t\tNOT = \{ check_variable = \{ global\.votc_seq > 100 \} \}/.test(hoi4), 'hoi4: a hidden event that fires only for the player while something has not run');
    check(hoi4.includes('set_variable = { global.votc_seq = 101 }') && !hoi4.includes('eval_effect'), 'hoi4: guarded by the sequence variable, no console');
    check(hoi4.includes('log = "VOTC|RES|101|ok|war"') && hoi4.includes('log = "VOTC|RES|101|fail|war"'), 'hoi4: result checked in game');
    check(hoi4.includes('\t\tlog = "VOTC|ACK|101"') && /option = \{ name = votc_cmd\.1\.a \}/.test(hoi4), 'hoi4: ack line');
    const stel = buildRunFile('stellaris', [{ seq: 3, op: 'refresh', compiled: compileCommand('stellaris', { op: 'refresh' }) }]);
    check(/^namespace = votc_cmd$/m.test(stel) && /\thide_window = yes\n\tis_triggered_only = yes/.test(stel) && !/^effect /m.test(stel), 'stellaris: a hidden event, no console');
    for (const [game, dir] of [['hoi4', 'votc_hoi4'], ['stellaris', 'votc_stellaris']]) {
      check(fs.readFileSync(path.join(REPO, 'paradox_mods', dir, 'events', 'votc_commands.txt'), 'utf-8').replace(/\r/g, '') === '\uFEFF' + buildRunFile(game, []), `${game}: the shipped event file equals an empty queue`);
      check(PDX_PROFILES[game].consoleTyping === false && PDX_PROFILES[game].autoRun === 'gui' && PDX_PROFILES[game].needsDebugMode && PDX_PROFILES[game].runFiles.user[0].replace(/\\/g, '/') === `mod/${dir}/events/votc_commands.txt`, `${game}: the app writes the mod event, never the console`);
    }
    const hoiOn = fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_hoi4', 'common', 'on_actions', 'votc_on_actions.txt'), 'utf-8');
    const hoiGui = fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_hoi4', 'common', 'scripted_guis', 'votc_scripted_guis.txt'), 'utf-8');
    check(/on_daily = \{[\s\S]*country_event = votc_cmd\.1/.test(hoiOn) && (hoiGui.match(/votc_apply_actions = yes/g) || []).length === 2, 'hoi4: the daily pulse and both buttons fire the command event');
    const stelOn = fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_stellaris', 'common', 'on_actions', 'votc_on_actions.txt'), 'utf-8');
    const stelDec = fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_stellaris', 'common', 'decisions', 'votc_decisions.txt'), 'utf-8');
    // Stellaris runs scripted effects through its macro preprocessor: "[This.GetName]" there
    // became "Invalid macro entry" and empty names. The log lines live in events.
    const stelFx = fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_stellaris', 'common', 'scripted_effects', 'votc_scripted_effects.txt'), 'utf-8');
    const stelEv = fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_stellaris', 'events', 'votc_events.txt'), 'utf-8');
    check(!/\[/.test(stelFx.replace(/^#.*$/gm, '')) && stelEv.includes('log = "VOTC|P|name|[This.GetName]"') && /id = votc\.2[\s\S]*VOTC\|META\|talk\|pick/.test(stelEv), 'stellaris: no brackets in scripted effects, names logged from events');
    check((stelEv.match(/\{/g) || []).length === (stelEv.match(/\}/g) || []).length, 'stellaris: the events file is balanced');
    check(/on_monthly_pulse_country = \{[\s\S]*votc_cmd\.1/.test(stelOn) && /country_event = \{ id = votc_cmd\.1 \}/.test(stelDec), 'stellaris: the monthly pulse and the talk decision fire the command event');
    const vic3 = buildRunFile('vic3', [{ seq: 7, op: 'opinion', compiled: compileCommand('vic3', { op: 'opinion', a: 'GBR', b: 'FRA', amount: 10 }) }]);
    check(vic3.includes('global_var:votc_seq < 7') && vic3.includes('debug_log = "VOTC|ACK|7"') && !vic3.includes('eval_effect'), 'vic3: script file with debug_log');
    // Victoria 3 has no `run` command: a hidden event of the mod, reloaded and fired by the mod's timer
    check(/^namespace = votc_cmd$/m.test(vic3) && /votc_cmd\.1 = \{\n\ttype = country_event\n\thidden = yes\n\ttrigger = \{\n\t\tOR = \{ NOT = \{ has_global_variable = votc_seq \} global_var:votc_seq < 7 \}\n\t\}\n\timmediate = \{/.test(vic3), 'vic3: commands are a hidden event that fires only while something has not run');
    const vic3Empty = buildRunFile('vic3', []);
    check(/votc_cmd\.1 = \{/.test(vic3Empty) && /trigger = \{\n\t\talways = no\n\t\}/.test(vic3Empty) && !vic3Empty.includes('VOTC|ACK'), 'vic3: the event exists even with nothing queued, and never fires then');
    check(PDX_PROFILES.vic3.runCommand === 'event votc_cmd.1' && PDX_PROFILES.vic3.runFiles.user[0].replace(/\\/g, '/') === 'mod/votc_vic3/events/votc_commands.txt', 'vic3: the event file lives in the mod');
    const runner = fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_vic3', 'gui', 'votc_runner.gui'), 'utf-8');
    // a console event crashes Victoria 3 whenever another game thread holds the random
    // generator ("Random is blocked by thread"), paused or not: no console at all. The runner
    // executes a scripted GUI (run in the game thread like a click).
    check(!runner.includes('ExecuteConsoleCommand'), 'vic3: the runner uses no console command');
    check(runner.includes("GetScriptedGui('votc_apply_sgui').Execute(GuiScope.SetRoot(GetPlayer.MakeScope).End)") && runner.includes('visible = "[GetPlayer.IsValid]"'), 'vic3: the runner executes the scripted GUI');
    const sgui = fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_vic3', 'common', 'scripted_guis', 'votc_sguis.txt'), 'utf-8');
    check(/votc_apply_sgui = \{[\s\S]*scope = country[\s\S]*is_player = yes[\s\S]*trigger_event = \{ id = votc_cmd\.1 \}/.test(sgui), 'vic3: the scripted GUI fires the command event');
    // EU5 "Talk (VOTC)": only the clicked character is a candidate, a click runs it, and the
    // effect is hidden (its hover tooltip described the whole snapshot and made the game stutter)
    {
      const talk = fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_eu5', 'in_game', 'common', 'character_interactions', 'votc_interactions.txt'), 'utf-8');
      check(/source = recipient/.test(talk) && /context_menu_click_mode = click/.test(talk) && /effect = \{\s*hidden_effect = \{\s*scope:recipient = \{ votc_talk_to_character = yes \}/.test(talk), 'eu5: the talk interaction is cheap to hover and runs on click');
      // each of these flags is a requirement: with both, no character qualified
      check(!/^\s*on_(own|other)_nation\s*=/m.test(talk), 'eu5: the talk interaction works on own and foreign characters');
      const eu5Script = ['scripted_effects', 'scripted_triggers'].map((d) => fs.readdirSync(path.join(REPO, 'paradox_mods', 'votc_eu5', 'in_game', 'common', d)).map((f) => fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_eu5', 'in_game', 'common', d, f), 'utf-8')).join('\n')).join('\n');
      check(!/is_allied_with = [^{]/.test(eu5Script) && !/is_allied_with = c:/.test(compileCommand('eu5', { op: 'alliance', a: 'CAS', b: 'ARA' }).check), 'eu5: is_allied_with takes { target = ... }');
    }
    // rewriting a scripted trigger made the file watcher reload all of them: "Pure Virtual
    // Function Call". The app rewrites only the event file, and nothing refers to a trigger file.
    for (const mod of [['votc_vic3'], ['votc_eu5', 'in_game']]) {
      const trig = path.join(REPO, 'paradox_mods', ...mod, 'common', 'scripted_triggers');
      check(!fs.existsSync(path.join(trig, 'votc_pending_triggers.txt')) && !fs.readdirSync(trig).some((f) => fs.readFileSync(path.join(trig, f), 'utf-8').includes('votc_has_pending')), `${mod[0]}: no app-written scripted trigger`);
    }
    check(!fs.readFileSync(path.join(REPO, 'src', 'main', 'games', 'paradox', 'ParadoxAdapter.ts'), 'utf-8').includes('extraRunFiles'), 'the app writes the run file only');
    const onActions = fs.readdirSync(path.join(REPO, 'paradox_mods', 'votc_vic3', 'common', 'on_actions')).map((f) => fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_vic3', 'common', 'on_actions', f), 'utf-8')).join('\n');
    check(/trigger_event = \{ id = votc_cmd\.1 \}/.test(onActions), 'vic3: the monthly pulse applies the actions in the game thread');
    check(['vic3', 'eu5', 'hoi4', 'stellaris'].every((g) => PDX_PROFILES[g].consoleTyping === false), 'the app never types into the console');
    const { runFileEncoding } = load('games/paradox/commands.js');
    check(['vic3', 'eu5', 'hoi4', 'stellaris'].every((g) => runFileEncoding(g).bom) && !runFileEncoding('civ6').bom, 'the event file is written with a byte order mark');
    const vic3Shipped = fs.readFileSync(path.join(REPO, 'paradox_mods', 'votc_vic3', 'events', 'votc_commands.txt'), 'utf-8').replace(/\r/g, '');
    check(vic3Shipped === '\uFEFF' + vic3Empty, 'vic3: the shipped event file equals an empty queue');
    check(buildRunFile('civ6', []) === '', 'Civilization VI writes no file');
    // EU5 (same engine as Victoria 3): the same scripted GUI runner, no console
    {
      const EU5 = path.join(REPO, 'paradox_mods', 'votc_eu5', 'in_game');
      const read = (...p) => fs.readFileSync(path.join(EU5, ...p), 'utf-8').replace(/\r/g, '');
      const eu5Runner = read('gui', 'votc_runner.gui');
      check(!eu5Runner.includes('ExecuteConsoleCommand') && eu5Runner.includes("GetScriptedGui('votc_apply_sgui').Execute(GuiScope.SetRoot(GetPlayer.MakeScope).End)")
        && eu5Runner.includes('visible = "[GetPlayer.IsValid]"'), 'eu5: the runner executes the scripted GUI, no console');
      check(/votc_apply_sgui = \{[\s\S]*scope = country[\s\S]*is_ai = no[\s\S]*trigger_event_silently = \{ id = votc_cmd\.1 \}/.test(read('common', 'scripted_guis', 'votc_sguis.txt')), 'eu5: the scripted GUI fires the command event');
      check(/trigger_event_silently = \{ id = votc_cmd\.1 \}/.test(read('common', 'on_action', 'votc_on_actions.txt')), 'eu5: the monthly pulse fires the command event');
      const eu5Empty = buildRunFile('eu5', []);
      check(read('events', 'votc_commands.txt') === '\uFEFF' + eu5Empty && /outcome = neutral[\s\S]*hidden = yes[\s\S]*always = no[\s\S]*immediate = \{\n\t\}/.test(eu5Empty), 'eu5: the shipped event file equals an empty queue');
      const eu5One = buildRunFile('eu5', [{ seq: 7, op: 'money', compiled: compileCommand('eu5', { op: 'money', from: 'CAS', to: 'ARA', amount: 50 }) }]);
      check(/trigger = \{\n\t\tOR = \{ NOT = \{ has_global_variable = votc_seq \} global_var:votc_seq < 7 \}/.test(eu5One) && eu5One.includes('add_gold = 50') && eu5One.includes('error_log = "VOTC|ACK|7"'), 'eu5: queued commands go into the event');
      check(PDX_PROFILES.eu5.runFiles.user.join() === path.join('mod', 'votc_eu5', 'in_game', 'events', 'votc_commands.txt') && !PDX_PROFILES.eu5.runFiles.install, 'eu5: the app writes the mod event');
    }
    // braces must balance or the game rejects the whole line
    for (const text of [hoi4, vic3]) {
      check((text.match(/\{/g) || []).length === (text.match(/\}/g) || []).length, 'braces balanced');
    }
  });

  await section('log rotation (Victoria 3 debug.log fills up several times a second with mods)', () => {
    const { LogFollower } = load('games/paradox/ParadoxAdapter.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'votc_rot_'));
    const log = path.join(dir, 'debug.log');
    const got = [];
    const f = new LogFollower(log, (l) => got.push(l));
    fs.writeFileSync(log, 'a1\n');
    f.poll();
    // the rest of a snapshot lands in the old log, then it is renamed twice before the next poll
    fs.appendFileSync(log, 'VOTC|BEGIN|vic3|2talk\nVOTC|C|GBR\n');
    fs.renameSync(log, path.join(dir, 'debug.1.log'));
    fs.writeFileSync(log, 'VOTC|P|x\n' + 'y'.repeat(200) + '\n');
    fs.renameSync(path.join(dir, 'debug.1.log'), path.join(dir, 'debug.2.log'));
    fs.renameSync(log, path.join(dir, 'debug.1.log'));
    fs.writeFileSync(log, 'VOTC|END\n');
    f.poll();
    check(got.join('|') === ['a1', 'VOTC|BEGIN|vic3|2talk', 'VOTC|C|GBR', 'VOTC|P|x', 'y'.repeat(200), 'VOTC|END'].join('|'), 'no line is lost when the log rotates between polls');
    fs.appendFileSync(log, 'z\n');
    f.poll();
    check(got[got.length - 1] === 'z' && got.length === 7, 'keeps following the new log');
    // the lines already there at the start are the backlog (old talk requests are not replayed)
    const flags = [];
    const g = new LogFollower(log, (l, backlog) => flags.push(backlog));
    g.poll();
    fs.appendFileSync(log, 'new\n');
    g.poll();
    check(flags.length === 3 && flags[0] && flags[1] && !flags[2], 'old lines are marked as backlog');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await section('adapter end to end (HOI4 with a fake game log)', async () => {
    settings.setActiveGame('hoi4');
    fs.mkdirSync(path.join(USER_DIR, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(USER_DIR, 'mod'), { recursive: true });
    fs.writeFileSync(path.join(USER_DIR, 'logs', 'game.log'), 'old line\n');
    const hoi4 = getAdapter('hoi4');
    check(hoi4.isValidFolder(USER_DIR), 'documents folder recognised');
    check(hoi4.checkSetup(USER_DIR).some((w) => w.type === 'mod_missing'), 'missing mod reported');
    hoi4.start();
    let r = await hoi4.loadGameData({ lang: 'en', gameInBackground: () => false, targetId: 'GER' });
    check(!r.ok && /No data/.test(r.title), 'clear message before the first snapshot');
    fs.appendFileSync(path.join(USER_DIR, 'logs', 'game.log'), HOI4_LOG.join('\n') + '\n');
    await new Promise((res) => setTimeout(res, 1000));
    const targets = hoi4.listTalkTargets();
    check(targets.length === 2 && targets[0].id === 'FRA' && /ally/.test(targets[0].status), 'picker lists allies first');
    r = await hoi4.loadGameData({ lang: 'en', gameInBackground: () => false, targetId: 'GER' });
    check(r.ok && r.gameData.game === 'hoi4' && r.gameData.aiName === 'Adolf Hitler', 'conversation data for the picked country');
    check(r.ok && r.gameData.pdx.campaignId === 'hoi4_482913' && r.gameData.getSummariesKey() === 'hoi4_482913', 'summaries are kept per campaign');
    const pending = [];
    hoi4.on('commands-pending', (n) => pending.push(n));
    hoi4.runGameEffect({ op: 'opinion', a: 'GER', b: 'ENG', amount: 20 });
    let threw = false; try { hoi4.runGameEffect('GER = { annex_country = { target = ENG } }'); } catch { threw = true; }
    check(threw, 'raw script is refused');
    const runFile = path.join(USER_DIR, 'mod', 'votc_hoi4', 'events', 'votc_commands.txt');
    const content = fs.readFileSync(runFile, 'utf-8');
    check(content.startsWith('\uFEFF') && content.includes('votc_opinion_good'), 'the command event is written into the mod');
    check(pending[pending.length - 1] === 1, 'pending count reported');
    const seq = Number(/VOTC\|ACK\|(\d+)/.exec(content)[1]);
    const failed = [];
    hoi4.on('command-failed', (f) => failed.push(f));
    fs.appendFileSync(path.join(USER_DIR, 'logs', 'game.log'), `[x][y]: VOTC|RES|${seq}|fail|opinion\n[x][y]: VOTC|ACK|${seq}\n`);
    await new Promise((res) => setTimeout(res, 1000));
    check(fs.readFileSync(runFile, 'utf-8') === '\uFEFF' + buildRunFile('hoi4', []) && pending[pending.length - 1] === 0, 'acknowledged commands leave the file');
    check(failed.length === 1 && failed[0].op === 'opinion', 'failed outcome reported');
    // game restarted: a new, shorter log
    fs.writeFileSync(path.join(USER_DIR, 'logs', 'game.log'), HOI4_LOG.join('\n').replace('482913', '111111') + '\n');
    await new Promise((res) => setTimeout(res, 1000));
    r = await hoi4.loadGameData({ lang: 'en', gameInBackground: () => false, targetId: 'FRA' });
    check(r.ok && r.gameData.pdx.campaignId === 'hoi4_111111', 'a recreated log is followed from the start');
    hoi4.stop();
  });

  // Right-click "Talk (VOTC)" on a foreign general in Victoria 3 (lines as debug.log has them)
  const J = '[20:45:27][jomini_effect_impl.cpp:454]: common/scripted_effects/votc_scripted_effects.txt:42: ';
  const VIC3_TALK = [
    'VOTC|BEGIN|vic3|2|talk', 'VOTC|META|campaign|123456', 'VOTC|META|date|1 March 1848',
    'VOTC|P|tag|GBR', 'VOTC|P|name|Great Britain', 'VOTC|P|leader|Victoria', 'VOTC|P|gdp|512000', 'VOTC|P|rank|Great Power',
    'VOTC|C|FRA|name|France', 'VOTC|C|FRA|leader|Louis Philippe', 'VOTC|C|FRA|gdp|300000',
    'VOTC|META|talk|character', 'VOTC|META|talk_tag|FRA', 'VOTC|META|talk_name|Thomas Bugeaud',
    'VOTC|CH|FRA|Thomas Bugeaud|title|General', 'VOTC|CH|FRA|Thomas Bugeaud|age|63',
    'VOTC|CH|FRA|Thomas Bugeaud|ideology|Royalist', 'VOTC|CH|FRA|Thomas Bugeaud|trait|reckless',
    'VOTC|CH|FRA|Thomas Bugeaud|trait|cruel', 'VOTC|CH|FRA|Thomas Bugeaud|location|Algeria',
    'VOTC|CH|FRA|Thomas Bugeaud|gender|male', 'VOTC|CH|FRA|Thomas Bugeaud|popularity|[THIS.GetCharacter.GetPopularity]',
    'VOTC|END',
  ].map((l) => J + l);

  await section('characters and talk requests', () => {
    const s = parse(VIC3_TALK).snaps[0];
    check(s.talk && s.talk.mode === 'character' && s.talk.tag === 'FRA' && s.talk.name === 'Thomas Bugeaud', 'talk request parsed');
    const p = s.characters[0];
    check(s.characters.length === 1 && p.title === 'General' && p.age === 63 && p.traits.join() === 'reckless,cruel' && p.location === 'Algeria', 'character fields');
    check(p.facts.ideology === 'Royalist' && p.facts.popularity === undefined && !p.ruler, 'facts kept, unresolved dropped');
    const people = new Map([[`FRA|Thomas Bugeaud`, p]]);
    const minister = { tag: 'GBR', name: 'Lord Palmerston', title: 'Foreign Secretary', age: 63, female: false, ruler: false, traits: ['cunning'], description: '', location: 'London', facts: {} };
    people.set('GBR|Lord Palmerston', minister);
    const targets = talkTargets(s, [...people.values()]);
    check(targets[0].id === personTargetId(minister) && targets.some((t) => t.id === 'FRA') && targets[targets.length - 1].leader === 'Thomas Bugeaud', 'own people, leaders, then foreign characters');

    const gd = buildGameDataFromPdx(s, personTargetId(p), PDX_PROFILES.vic3, 'en', people);
    const npc = gd.characters.get(gd.aiID);
    const player = gd.characters.get(gd.playerID);
    check(npc.fullName === 'Thomas Bugeaud' && !npc.isRuler && npc.pdx.country.tag === 'FRA' && npc.age === 63, 'conversation with a foreign general');
    check(gd.location === 'Algeria' && /notable figure/.test(gd.scene), 'scene and place of the meeting');
    check(player.pdx.country.facts.gdp === undefined && player.pdx.country.facts.rank === 'Great Power', "a foreigner only sees the player's public facts");
    check(npc.pdx.country.facts.gdp === '300000', 'but knows their own country');
    const own = buildGameDataFromPdx(s, personTargetId(minister), PDX_PROFILES.vic3, 'en', people);
    check(own.pdx.sameCountry && own.characters.get(own.playerID).pdx.country.facts.gdp === '512000', "the player's own people know its figures");
    check(publicView({ tag: 'X', name: 'X', leader: '', leaderTitle: '', government: '', capital: '', facts: { wars: 'Y', treasury: '5' } }, PDX_PROFILES.vic3).facts.treasury === undefined, 'publicView strips private facts');
    check(personTargetId(p) !== personTargetId(minister) && npc.id !== own.aiID && npc.id > 2000000, 'stable, separate character ids');
  });

  await section('adapter: in-game talk requests', async () => {
    settings.setActiveGame('hoi4');
    const hoi4 = getAdapter('hoi4');
    const requests = [];
    hoi4.on('talk-request', (r) => requests.push(r));
    hoi4.start();
    const log = path.join(USER_DIR, 'logs', 'game.log');
    const talk = HOI4_LOG.slice(0, -1).concat([
      '[x][y]: VOTC|META|talk|country', '[x][y]: VOTC|META|talk_tag|GER',
      '[x][y]: VOTC|CH|GER|Adolf Hitler|ruler|yes', '[x][y]: VOTC|CH|GER|Adolf Hitler|title|Head of State',
      '[x][y]: VOTC|CH|GER|Erwin Rommel|title|General', '[x][y]: VOTC|CH|GER|Erwin Rommel|command_skill|5+ (outstanding)',
      '[x][y]: VOTC|END',
    ]);
    fs.appendFileSync(log, talk.join('\n') + '\n');
    await new Promise((res) => setTimeout(res, 1000));
    check(requests.length === 1 && requests[0].pick && requests[0].tag === 'GER', 'diplomacy button opens the picker for that country');
    const ger = hoi4.listTalkTargets('GER');
    check(ger.length === 2 && ger.some((t) => t.leader === 'Erwin Rommel' && t.group === 'people') && ger.some((t) => t.id === 'GER' && t.group === 'leaders'), "that country's leader and commanders");
    const rommel = ger.find((t) => t.leader === 'Erwin Rommel');
    const r = await hoi4.loadGameData({ lang: 'en', gameInBackground: () => false, targetId: rommel.id });
    check(r.ok && r.gameData.aiName === 'Erwin Rommel' && r.gameData.pdx.person.facts.command_skill === '5+ (outstanding)', 'talk to a general');
    const leader = await hoi4.loadGameData({ lang: 'en', gameInBackground: () => false, targetId: 'GER' });
    check(leader.ok && leader.gameData.characters.get(leader.gameData.aiID).isRuler, 'the leader is still the head of state');
    const bad = await hoi4.loadGameData({ lang: 'en', gameInBackground: () => false, targetId: 'p:GER|Nobody' });
    check(!bad.ok, 'unknown character refused with a message');
    fs.appendFileSync(log, HOI4_LOG.slice(0, -1).concat(['[x][y]: VOTC|META|talk|character', '[x][y]: VOTC|META|talk_tag|GER', '[x][y]: VOTC|META|talk_name|Erwin Rommel', '[x][y]: VOTC|END']).join('\n') + '\n');
    await new Promise((res) => setTimeout(res, 1000));
    check(requests.length === 2 && requests[1].targetId === rommel.id, 'a character request starts that conversation');
    check(PDX_PROFILES.vic3.autoRun === 'gui' && PDX_PROFILES.hoi4.autoRun === 'gui', 'every game applies the actions itself');
    hoi4.stop();

    // Victoria 3 only lists character interactions for the player's own characters and exiles:
    // foreign people are reached through a diplomatic action on their country
    const V3 = path.join(REPO, 'paradox_mods', 'votc_vic3');
    const action = fs.readFileSync(path.join(V3, 'common', 'diplomatic_actions', 'votc_diplomatic_actions.txt'), 'utf-8');
    const effects = fs.readFileSync(path.join(V3, 'common', 'scripted_effects', 'votc_scripted_effects.txt'), 'utf-8');
    check(/votc_talk_country = \{[\s\S]*requires_approval = no[\s\S]*accept_effect = \{\s*votc_talk_to_country = yes/.test(action), 'Vic3: Talk (VOTC) diplomatic action');
    check(/^votc_talk_to_country = \{[\s\S]*VOTC\|META\|talk\|country[\s\S]*every_scope_character = \{[\s\S]*votc_log_character = yes/m.test(effects), 'Vic3: it logs a country talk request with every character of that country');
    for (const lang of ['english', 'simp_chinese']) {
      const dir = path.join(V3, 'localization', lang);
      const loc = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf-8')).join('\n');
      check(/votc_talk_country:0 /.test(loc) && /votc_talk_country_desc:0 /.test(loc), `Vic3: ${lang} text for the diplomatic action`);
    }
    check(/diplomatic actions/.test(PDX_PROFILES.vic3.talkInGame.en), 'Vic3 talk hint names the diplomatic action');
  });

  await section('only a foreign head of state commits a country', async () => {
    const s = parse(VIC3_TALK).snaps[0];
    const people = new Map([[`FRA|Thomas Bugeaud`, s.characters[0]]]);
    const gd = buildGameDataFromPdx(s, personTargetId(s.characters[0]), PDX_PROFILES.vic3, 'en', people);
    const npc = gd.characters.get(gd.aiID);
    const leaderGd = buildGameDataFromPdx(s, 'FRA', PDX_PROFILES.vic3, 'en', people);
    const leader = leaderGd.characters.get(leaderGd.aiID);
    const file = path.join(ACTIONS_DIR, 'z_pdx_changeOpinion.js');
    const sandbox = { module: { exports: {} }, exports: {}, console };
    vm.runInContext(fs.readFileSync(file, 'utf-8'), vm.createContext(sandbox));
    const def = sandbox.module.exports;
    check(!(await def.check({ gameData: gd, sourceCharacter: npc })).canExecute, 'a general cannot change relations between countries');
    check((await def.check({ gameData: leaderGd, sourceCharacter: leader })).canExecute, 'the head of state can');
  });

  await section('CK3: actions are confirmed', async () => {
    const CK3_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'votc_ck3_user_'));
    fs.mkdirSync(path.join(CK3_DIR, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(CK3_DIR, 'logs', 'debug.log'), 'start\n');
    fs.writeFileSync(path.join(CK3_DIR, 'logs', 'error.log'), 'old error\n');
    settings.setActiveGame('ck3');
    settings.setCK3UserFolderPath(CK3_DIR);
    const ck3 = getAdapter('ck3');
    const failed = [];
    ck3.on('command-failed', (f) => failed.push(f));
    const gd = { characters: new Map([[1, {}], [2, {}]]), playerID: 1 };
    ck3.runGameEffect('global_var:votc_action_source = { add_gold = 10 }', { gameData: gd, sourceCharacterId: 2, targetCharacterId: 1, label: 'Gives gold' });
    ck3.runGameEffect('global_var:votc_action_source = { add_prestige = 5 }', { gameData: gd, sourceCharacterId: 2, label: 'Gains prestige' });
    const runFile = path.join(CK3_DIR, 'run', 'votc.txt');
    const text = fs.readFileSync(runFile, 'utf-8');
    const seqs = [...text.matchAll(/VOTC\|RES\|(\d+)\|ok/g)].map((m) => m[1]);
    check(seqs.length === 2 && /mcc_event_v2\.9003/.test(text), 'every effect carries a confirmation, the mod event stays');
    // the mod ran the file: only the first effect logged its line, and CK3 reported an error
    fs.appendFileSync(path.join(CK3_DIR, 'logs', 'debug.log'), `[12:00:00][jomini_effect.cpp:1]: run/votc.txt:9: VOTC|RES|${seqs.find((s) => text.indexOf(s) > text.indexOf('add_gold'))}|ok|ck3\n`);
    ck3.onEffectsRan();
    fs.appendFileSync(path.join(CK3_DIR, 'logs', 'error.log'), '[12:00:00][jomini_script_system.cpp:283]: Script system error! Error: add_prestige effect [ Wrong scope ] file: run/votc.txt line: 14\n');
    check(fs.readFileSync(runFile, 'utf-8') === '', 'run file emptied once the mod ran it');
    await new Promise((res) => setTimeout(res, 3200));
    check(failed.some((f) => f.op === 'Gains prestige' && /did not confirm/.test(f.message)), 'the unconfirmed action is reported');
    check(!failed.some((f) => f.op === 'Gives gold' && /did not confirm/.test(f.message)), 'the confirmed one is not');
    check(failed.some((f) => /Wrong scope/.test(f.message)) && !failed.some((f) => /old error/.test(f.message)), 'new script errors in the run file are reported');
    check(fs.readFileSync(path.join(CK3_DIR, 'votc_app_log.txt'), 'utf-8').includes('confirmed'), 'diagnostic log written');
    ck3.stop();
    settings.setActiveGame('hoi4');
  });

  await section('prompt templates compile', () => {
    let hb;
    try { hb = require(path.join(REPO, 'node_modules', 'handlebars')); } catch { hb = null; }
    check(!!hb, 'handlebars available');
    if (!hb) return;
    for (const rel of ['system/paradox/default.hbs', 'system/ck3/default.hbs', 'system/tk/default.hbs', 'system/default.hbs']) {
      let ok = true; try { hb.precompile(fs.readFileSync(path.join(PROMPTS_DIR, rel), 'utf-8')); } catch (e) { ok = false; console.log(e.message); }
      check(ok, `${rel} compiles`);
    }
  });

  await section('world situation, family and new actions', async () => {
    const lines = VIC3_TALK.slice(0, -1).concat([
      'VOTC|P|war_with|Russia', 'VOTC|C|FRA|war_with|Prussia', 'VOTC|C|FRA|allies|Spain', 'VOTC|C|FRA|rank|Great Power',
      'VOTC|C|RUS|name|Russia', 'VOTC|C|RUS|leader|Nicholas I', 'VOTC|R|RUS|war|yes',
      'VOTC|CH|FRA|Thomas Bugeaud|children|Léonie', 'VOTC|CH|FRA|Thomas Bugeaud|spouse|Élisabeth',
      'VOTC|CH|FRA|Louis Philippe|ruler|yes', 'VOTC|CH|FRA|François Guizot|title|Prime Minister', 'VOTC|END',
    ].map((l) => J + l));
    const s = parse(lines).snaps[0];
    const people = new Map(s.characters.map((p) => [`${p.tag}|${p.name}`, p]));
    const bugeaud = s.characters.find((p) => p.name === 'Thomas Bugeaud');
    const gd = buildGameDataFromPdx(s, personTargetId(bugeaud), PDX_PROFILES.vic3, 'en', people);
    const world = gd.pdx.world.join('\n');
    check(/France: led by Louis Philippe; a great power; allied with Spain; at war with Prussia/.test(world), 'world line for a country: ' + gd.pdx.world[0]);
    check(/Great Britain: .*at war with Russia/.test(world) && !/512000/.test(world), "the player's wars are public, its figures are not");
    check(gd.pdx.knownPeople.join() === 'Louis Philippe,François Guizot (Prime Minister)', 'people of the same country: ' + gd.pdx.knownPeople.join());
    check(bugeaud.facts.children === 'Léonie' && bugeaud.facts.spouse === 'Élisabeth', 'family logged');
    check(gd.pdx.enemiesOfPlayer.length === 1 && gd.pdx.enemiesOfPlayer[0].tag === 'RUS', "the player's enemies");
    const sandbox = { module: { exports: {} }, exports: {}, console };
    vm.runInContext(fs.readFileSync(path.join(PROMPTS_DIR, 'character_description/standard/paradox/pListMccTest2.js'), 'utf-8'), vm.createContext(sandbox));
    const text = sandbox.module.exports(gd, gd.aiID);
    check(/The world as everyone knows it/.test(text) && /children\(Léonie\)/.test(text) && /François Guizot/.test(text), 'persona shows world, family and acquaintances');

    // compilers
    check(compileCommand('vic3', { op: 'char_trait', trait: 'brave' }).effect.includes('global_var:votc_talker ?= {'), 'vic3 character trait acts on the in-game talker');
    check(compileCommand('eu5', { op: 'char_trait', trait: 'pious' }).effect.includes('add_trait = trait:pious'), 'eu5 trait syntax');
    check(compileCommand('eu5', { op: 'char_kill', by: 'FRA', reason: 'execution' }).effect === 'c:FRA = { kill_character = { target = global_var:votc_talker reason = execution } }', 'eu5 death');
    check(compileCommand('hoi4', { op: 'join_war', country: 'FRA', ally: 'ENG', enemy: 'GER' }).effect.includes('add_to_war = { targeted_alliance = ENG enemy = GER'), 'hoi4 join war');
    for (const [game, cmd] of [['vic3', { op: 'char_trait', trait: 'immortal' }], ['eu5', { op: 'char_kill', by: 'FRA', reason: 'old_age_bug' }], ['hoi4', { op: 'manpower', from: 'GER', to: 'ENG', amount: 1e9 }]]) {
      let threw = false; try { compileCommand(game, cmd); } catch { threw = true; }
      check(threw, `${game}: rejects ${JSON.stringify(cmd)}`);
    }

    // character actions only for the character chosen in game
    const load1 = (f) => { const sb = { module: { exports: {} }, exports: {}, console }; vm.runInContext(fs.readFileSync(path.join(ACTIONS_DIR, f), 'utf-8'), vm.createContext(sb)); return sb.module.exports; };
    const trait = load1('z_pdx_characterGainsTrait.js');
    const npc = gd.characters.get(gd.aiID);
    check(!(await trait.check({ gameData: gd, sourceCharacter: npc })).canExecute, 'no character action for someone picked in the app');
    gd.pdx.talkerInGame = true;
    check((await trait.check({ gameData: gd, sourceCharacter: npc })).canExecute, 'available for the right-clicked character');
    const sent = [];
    const res = await ActionSandbox.executeAction(path.join(ACTIONS_DIR, 'z_pdx_characterGainsTrait.js'), {
      gameData: gd, sourceCharacter: npc, args: { trait: 'brave' }, lang: 'en', dryRun: false, runGameEffect: (c) => sent.push(compileCommand('vic3', c)),
    });
    check(sent.length === 1 && /became brave/.test(res.message.en), 'trait action compiles');
    const exile = load1('z_pdx_characterExiled.js');
    check(!(await exile.check({ gameData: gd, sourceCharacter: npc })).canExecute, 'a foreign general cannot be exiled by the player');
    const hoiGd = buildGameDataFromPdx(parse(HOI4_LOG).snaps[0], 'FRA', PDX_PROFILES.hoi4, 'en');
    hoiGd.pdx.enemiesOfPlayer = [{ tag: 'GER', name: 'German Reich' }];
    const join = load1('z_pdx_joinsWar.js');
    const fra = hoiGd.characters.get(hoiGd.aiID);
    check((await join.check({ gameData: hoiGd, sourceCharacter: fra })).canExecute, 'an ally can join the war');
    const sentJ = [];
    await ActionSandbox.executeAction(path.join(ACTIONS_DIR, 'z_pdx_joinsWar.js'), {
      gameData: hoiGd, sourceCharacter: fra, args: { enemy: 'GER' }, lang: 'en', dryRun: false, runGameEffect: (c) => sentJ.push(compileCommand('hoi4', c)),
    });
    check(sentJ.length === 1 && sentJ[0].check === 'FRA = { has_war_with = GER }', 'join war compiles with an outcome check');
  });

  await section('campaign folders', () => {
    check(campaignFolder('hoi4', '482913.000', { tag: 'ENG', name: 'UK' }) === 'hoi4_482913', 'decimals ignored');
    check(campaignFolder('stellaris', '0', { tag: 'E0', name: 'United Nations of Earth' }) === 'stellaris_E0_United_Nations_of_Earth', 'falls back to the player country');
    check(!/[\\/:.]/.test(campaignFolder('stellaris', '', { tag: 'E0', name: '../../evil' })), 'unsafe names sanitized');
  });

  await section('registry', () => {
    const games = listGames('zh');
    check(games.length === 9 && games.map((g) => g.id).join() === GAME_IDS.join(), 'all nine games listed');
    check(games.find((g) => g.id === 'attila').name === '全面战争：阿提拉' && games.find((g) => g.id === 'civ6').name === '文明6', 'Attila and Civilization VI listed');
    check(games.find((g) => g.id === 'tk').name === '全面战争：三国', 'localized names');
    for (const id of GAME_IDS) {
      const a = getAdapter(id);
      check(a.id === id && typeof a.loadGameData === 'function' && a.folderExample.length > 10, `${id}: adapter`);
    }
    check(getAdapter('tk').isGameWindow({ name: 'Three Kingdoms', path: 'C:\\Games\\Three_Kingdoms.exe' }), 'tk window detected');
    check(!getAdapter('wh3').isGameWindow({ name: 'Three Kingdoms', path: 'C:\\Games\\Three_Kingdoms.exe' }), 'wh3 ignores the 3K window');
    check(getAdapter('ck3').isGameWindow({ name: 'Crusader Kings III', path: 'D:\\CK3\\binaries\\ck3.exe' }), 'ck3 window detected');
    check(promptVariantsFor('tk').join() === 'tk,totalwar' && promptVariantsFor('eu5').join() === 'eu5,paradox', 'prompt variants');
  });

  // ---------------------------------------------------------------- actions per game
  function loadAction(file) {
    const sandbox = { module: { exports: {} }, exports: {}, console };
    vm.runInContext(fs.readFileSync(file, 'utf-8'), vm.createContext(sandbox), { filename: file });
    return sandbox.module.exports;
  }
  const actionFiles = fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith('.js'));
  const actions = actionFiles.map((f) => ({ file: path.join(ACTIONS_DIR, f), def: loadAction(path.join(ACTIONS_DIR, f)) }));

  await section('every action names its games', () => {
    const sigs = new Set();
    for (const { def, file } of actions) {
      check(def.signature === 'noOp' || (Array.isArray(def.games) && def.games.every((g) => GAME_IDS.includes(g))), `${path.basename(file)}: games ${JSON.stringify(def.games)}`);
      check(!sigs.has(def.signature), `${def.signature}: unique signature`);
      sigs.add(def.signature);
    }
  });

  function pickArgs(argDefs) {
    const args = {};
    for (const a of argDefs) {
      if (a.type === 'enum') args[a.name] = a.options[0];
      else if (a.type === 'number') args[a.name] = Math.max(a.min ?? 1, 1);
      else args[a.name] = 'x';
    }
    return args;
  }

  for (const game of ['hoi4', 'vic3', 'eu5', 'stellaris', 'civ6']) {
    await section(`${game}: Paradox actions compile for the game`, async () => {
      const profile = PDX_PROFILES[game];
      const ids = { stellaris: { ENG: 'E0', GER: 'E1', FRA: 'E2' }, civ6: { ENG: 'P0', GER: 'P1', FRA: 'P2' } };
      const tag = (t) => (ids[game] ? ids[game][t] : t);
      const lines = HOI4_LOG.map((l) => l.replace('|hoi4|', `|${game}|`).replace(/\|(ENG|GER|FRA)(?=\||$)/g, (_, t) => `|${tag(t)}`));
      const snap = parse(lines).snaps[0];
      let available = 0;
      for (const { def, file } of actions.filter((a) => a.def.games && a.def.games.includes(game))) {
        // a fresh conversation per action, with the enemy (GER) or the ally (FRA)
        for (const target of [tag('GER'), tag('FRA')]) {
          const gd = buildGameDataFromPdx(snap, target, profile, 'en');
          const npc = gd.characters.get(gd.aiID);
          const res = await def.check({ gameData: gd, sourceCharacter: npc });
          if (!res.canExecute) continue;
          available++;
          const argDefs = typeof def.args === 'function' ? def.args({ gameData: gd, sourceCharacter: npc }) : def.args;
          const sent = [];
          const result = await ActionSandbox.executeAction(file, {
            gameData: gd, sourceCharacter: npc, args: pickArgs(argDefs), lang: 'en', dryRun: false,
            runGameEffect: (c) => sent.push(compileCommand(game, c)),
          });
          const msg = result && result.message ? result.message.en : '';
          check(sent.length === 1 && !/Failed/.test(msg), `${def.signature} -> ${target}: ${msg}`);
        }
      }
      check(available >= 4, `${game}: ${available} action uses available`);
    });
  }

  await section('prompt scripts for Paradox games', () => {
    const snap = parse(HOI4_LOG).snaps[0];
    for (const rel of ['character_description/standard/paradox/pListMccTest2.js', 'character_description/standard/paradox/pListMccTest2_ZH.js',
      'example_messages/standard/paradox/mccAliChat.js', 'example_messages/standard/paradox/mccAliChat_ZH.js']) {
      const sandbox = { module: { exports: {} }, exports: {}, console };
      vm.runInContext(fs.readFileSync(path.join(PROMPTS_DIR, rel), 'utf-8'), vm.createContext(sandbox));
      const gd = buildGameDataFromPdx(snap, 'GER', PDX_PROFILES.hoi4, 'en');
      const out = sandbox.module.exports(gd, gd.aiID);
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      check(text && !/undefined|NaN|\[object Object\]/.test(text) && /Hitler/.test(text), `${rel} renders`);
      // a character who is not the head of state, with traits and a place
      const vs = parse(VIC3_TALK).snaps[0];
      const people = new Map([[`FRA|Thomas Bugeaud`, vs.characters[0]]]);
      const pg = buildGameDataFromPdx(vs, personTargetId(vs.characters[0]), PDX_PROFILES.vic3, 'en', people);
      const pout = sandbox.module.exports(pg, pg.aiID);
      const ptext = typeof pout === 'string' ? pout : JSON.stringify(pout);
      check(ptext && !/undefined|NaN|\[object Object\]/.test(ptext) && /Bugeaud/.test(ptext), `${rel} renders a general`);
      if (rel.includes('pList')) {
        check(/reckless/.test(ptext) && /Algeria/.test(ptext) && !/512000/.test(ptext), `${rel}: traits and place shown, the player's private figures not`);
      }
    }
    for (const v of ['tk', 'paradox', 'ck3', 'wh3', 'attila']) {
      check(fs.existsSync(path.join(PROMPTS_DIR, 'system', v, 'default.hbs')), `system/${v}/default.hbs exists`);
    }
    // the old Warhammer III default (what users of VOTC-WH3 have saved) becomes each game's own prompt
    const { promptConfigManager } = load('conversation/PromptConfigManager.js');
    const wh3Text = fs.readFileSync(path.join(PROMPTS_DIR, 'system', 'wh3', 'default.hbs'), 'utf-8');
    const expect = { ck3: 'system/ck3', wh3: 'system/wh3', tk: 'system/tk', attila: 'system/attila', hoi4: 'system/paradox', vic3: 'system/paradox', eu5: 'system/paradox', stellaris: 'system/paradox', civ6: 'system/paradox' };
    for (const game of GAME_IDS) {
      const got = promptConfigManager.mainTemplateForGame(wh3Text, promptVariantsFor(game));
      const want = fs.readFileSync(path.join(PROMPTS_DIR, expect[game], 'default.hbs'), 'utf-8');
      check(got === want, `${game}: unedited main prompt switches to ${expect[game]}`);
    }
    check(promptConfigManager.mainTemplateForGame('My own prompt', promptVariantsFor('hoi4')) === 'My own prompt', 'an edited main prompt is kept');
    check(!/WARHAMMER/.test(fs.readFileSync(path.join(PROMPTS_DIR, 'system', 'default.hbs'), 'utf-8')), 'the generic fallback names no game');
  });

  await section('mods shape the world', () => {
    const { describeWorld, settingWithMods, parseDescriptor, listEnabledMods } = load('games/mods.js');
    const tno = describeWorld('hoi4', [
      { name: 'The New Order: Last Days of Europe', tags: ['Gameplay', 'Map', 'Alternative History'] },
      { name: 'The New Order: Last Days of Europe(CN.Ver)', tags: ['Translation'] },
      { name: 'Precise Buffs - Cheat Ideas', tags: ['Gameplay'] },
      { name: 'Orbital Bombardment', tags: ['Events', 'Military'] },
      { name: 'VOTC Bridge - Hearts of Iron IV', tags: ['Utilities'] },
      { name: 'some local mod', tags: [] },
    ]);
    check(tno.conversion && tno.conversion.name === 'The New Order: Last Days of Europe' && tno.conversion.alternate, 'TNO recognised as an alternate world');
    check(tno.others.join() === 'Orbital Bombardment', 'gameplay mods listed; cheats, translations, untagged and our own left out: ' + tno.others.join());
    const setting = settingWithMods(PDX_PROFILES.hoi4.setting, tno);
    check(/1960s/.test(setting) && /NOT real history/.test(setting) && !/Second World War era/.test(setting), 'setting replaced, real history ruled out');
    const kr = describeWorld('hoi4', [{ name: 'Kaiserreich', tags: ['Alternative History', 'Map'] }]);
    check(/German Empire won the Great War/.test(kr.conversion.setting), 'Kaiserreich setting');
    const md = describeWorld('hoi4', [{ name: 'Millennium Dawn: A Modern Day Mod', tags: [] }]);
    check(md.conversion && !md.conversion.alternate && !/NOT real history/.test(settingWithMods('x', md)), 'Millennium Dawn is modern but real history');
    const unknown = describeWorld('ck3', [{ name: 'Immersive Mercs', tags: ['Alternative History', 'Events'] }, { name: 'Middle Kingdom', tags: ['Total Conversion', 'Map'] }]);
    check(unknown.conversion && unknown.conversion.name === 'Middle Kingdom', 'unknown total conversions need a map tag');
    check(describeWorld('stellaris', [{ name: 'Gigastructural Engineering & More (4.4)', tags: ['Gameplay'] }]).others.length === 1 && !describeWorld('stellaris', []).conversion, 'Stellaris content mods listed, no conversion');
    // any mod with its own start scenarios is a world of its own, whatever its name
    const red = describeWorld('hoi4', [{ name: 'Some Unknown World', tags: ['Gameplay'], hasBookmarks: true, dir: 'X' }]);
    check(red.conversion && red.conversion.name === 'Some Unknown World' && red.conversion.alternate && red.conversion.dir === 'X', 'an unknown HOI4 mod with bookmarks is its own world');
    check(!describeWorld('hoi4', [{ name: 'Road to 56', tags: ['Historical', 'Gameplay'], hasBookmarks: true }]).conversion, 'a historical mod with bookmarks keeps real history');
    check(!describeWorld('hoi4', [{ name: 'Kaiserreich汉化', tags: ['Translation'], hasBookmarks: true }]).conversion
      || describeWorld('hoi4', [{ name: 'Kaiserreich汉化', tags: ['Translation'], hasBookmarks: true }]).conversion.name === 'Kaiserreich', 'a translation is not a world of its own (a known one still names its world)');
    const order = describeWorld('hoi4', [{ name: 'Balance Tweaks', tags: ['Gameplay'], hasBookmarks: true, dir: 'A' }, { name: 'The New Order: Last Days of Europe', tags: ['Map'], hasBookmarks: true, dir: 'B' }]);
    check(order.conversion.name === 'The New Order: Last Days of Europe' && order.conversion.dir === 'B', 'a known world wins over an unknown one in any load order, and its own folder carries the lore');
    check(!describeWorld('vic3', [{ name: 'Tech & Res', tags: ['Total Conversion', 'Map', 'Historical'] }]).conversion, 'a historical total conversion keeps real history');
    const vicWorld = describeWorld('vic3', [{ name: 'Pax Imaginaria', tags: ['Total Conversion', 'Map'], description: 'A world of floating islands.' }]);
    check(vicWorld.conversion && /floating islands/.test(vicWorld.conversion.setting), "an unknown Victoria 3 / EU5 conversion is described by its own text");
    // the mod's own account of its world, read from its files
    const { readModLore, yearOf, cleanLoc } = load('games/modLore.js');
    const modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'votc_lore_mod_'));
    fs.mkdirSync(path.join(modDir, 'common', 'bookmarks'), { recursive: true });
    fs.writeFileSync(path.join(modDir, 'common', 'bookmarks', 'a.txt'), 'bookmarks = {\n bookmark = {\n  name = "EARLY_NAME"\n  desc = "EARLY_DESC"\n  date = 1936.1.1.12\n }\n bookmark = {\n  name = "LATE_NAME"\n  desc = "LATE_DESC"\n  date = 1950.1.1.12\n }\n}\n');
    fs.mkdirSync(path.join(modDir, 'localisation', 'english'), { recursive: true });
    fs.writeFileSync(path.join(modDir, 'localisation', 'english', 'bookmarks_l_english.yml'), '﻿l_english:\n EARLY_DESC:0 "The early world."\n LATE_DESC:0 "§YThe Reich§! rules [GER.GetName] and $VAR$ Europe.\\nA cold war."\n GER_LATE_DESC:0 "Germany won."\n');
    const lore = readModLore(modDir, yearOf('1962.3.1'), ['GER', 'USA']);
    check(lore && lore.world === 'The Reich rules and Europe. A cold war.' && lore.countries.get('GER') === 'Germany won.' && !lore.countries.has('USA'), 'scenario and country lore for the campaign year, formatting stripped: ' + JSON.stringify(lore && lore.world));
    check(readModLore(modDir, 1940, ['GER']).world === 'The early world.', 'the bookmark that fits the year');
    check(yearOf('1962年3月1日') === 1962 && cleanLoc('#bold Hi#!') === 'Hi', 'dates and formatting');
    const d = parseDescriptor('version="1"\ntags={\n\t"Alternative History"\n\t"Map"\n}\nname="The Fire Rises"\n');
    check(d.name === 'The Fire Rises' && d.tags.join() === 'Alternative History,Map', 'descriptor.mod parsed');
    // the real mod lists on this machine, when the games are installed (never throws)
    for (const game of ['hoi4', 'ck3', 'stellaris', 'vic3', 'eu5', 'attila']) {
      const mods = listEnabledMods(game);
      const w = describeWorld(game, mods);
      console.log(`    ${game}: ${mods.length} mods enabled; world: ${w.conversion ? w.conversion.name : '(the game itself)'}; others: ${w.others.slice(0, 6).join(', ')}`);
    }
    check(true, 'reads the installed mod lists without errors');
  });

  await section('Attila localisation', () => {
    const { parseLoc, localizeDeep, tidyText, keyFallback, gameLoc } = load('games/totalwar/packLoc.js');
    const { traitsFromLoc, grantableTraits, ATTILA_LOCALIZATION } = load('games/totalwar/attila.js');
    // a .loc file: BOM, LOC, version, count, (key, text, tooltip)
    const str = (s) => { const b = Buffer.alloc(2 + s.length * 2); b.writeUInt16LE(s.length, 0); b.write(s, 2, 'utf16le'); return b; };
    const entries = [['names_name_1', '阿提拉'], ['factions_screen_name_att_fact_huns', '匈 人'], ['character_trait_levels_onscreen_name_att_trait_all_personality_all_sober_2', '适 当 节 制'],
      ['character_trait_levels_onscreen_name_att_trait_all_personality_all_sober_1', '头 脑 清 醒'], ['character_trait_levels_onscreen_name_att_trait_general_ability_all_power_1', '速 桨']];
    const head = Buffer.alloc(14); head.writeUInt16LE(0xfeff, 0); head.write('LOC\0', 2, 'ascii'); head.writeUInt32LE(1, 6); head.writeUInt32LE(entries.length, 10);
    const loc = parseLoc(Buffer.concat([head, ...entries.flatMap(([k, v]) => [str(k), str(v), Buffer.from([0])])]));
    check(loc.get('names_name_1') === '阿提拉' && loc.size === 5, '.loc parsed');
    check(tidyText('西 哥 特 分 离 势 力') === '西哥特分离势力' && tidyText('Western Roman Empire') === 'Western Roman Empire', 'spaced-out Chinese text joined, Latin kept');
    const state = localizeDeep({ name: '{{names_name_1}} {{names_name_999}}', f: { name: '{{factions_screen_name_att_fact_huns}}' }, list: ['{{regions_onscreen_att_reg_italia_roma}}'], n: 3 }, loc);
    check(state.name === '阿提拉' && state.f.name === '匈人' && state.n === 3, 'tokens replaced, unknown name keys dropped: ' + JSON.stringify(state));
    check(state.list[0] === 'italia roma' && keyFallback('factions_screen_name_att_fact_franci') === 'franci', 'readable fallback for missing keys');
    const traits = traitsFromLoc(loc);
    check(traits.att_trait_all_personality_all_sober.en === '头脑清醒', 'trait keys and level-1 names from the loc table');
    check(grantableTraits(traits).map((t) => t.key).join() === 'att_trait_all_personality_all_sober', 'only personality traits can be granted');
    // the real game, when installed: names come from the language pack and the player's mods
    const install = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War Attila';
    if (fs.existsSync(path.join(install, 'data', 'local_en.pack'))) {
      const real = gameLoc(install);
      const attila = real.get('names_name_2147343873');
      check(!!attila && real.size > 10000, `real loc: ${real.size} keys, Attila is called "${attila}"`);
      const huns = localizeDeep('{{factions_screen_name_att_fact_huns}}', real);
      console.log(`    att_fact_huns -> ${huns}`);
      const fields = ATTILA_LOCALIZATION.exportFields(install);
      check(fields.traits.split(',').length > 50, `trait keys for the export: ${fields.traits.split(',').length}`);
    }
  });

  await section('Attila adapter', async () => {
    const att = getAdapter('attila');
    check(att.isGameWindow({ name: 'Total War: ATTILA', path: 'D:\\Steam\\Attila.exe' }), 'Attila window detected');
    check(att.parseCommand({ op: 'peace', a: 'x', b: 'y' }).op === 'peace', 'known op accepted');
    let threw = false; try { att.parseCommand({ op: 'alliance', a: 'x', b: 'y' }); } catch { threw = true; }
    check(threw, 'alliance is not an Attila command');
    const trait = actions.find((a) => a.def.signature === 'attGainsTrait');
    check(trait && trait.def.games.join() === 'attila', 'Attila trait action');
    check(actions.filter((a) => a.def.games && a.def.games.includes('attila')).length >= 9, 'Total War actions offered in Attila');
  });

  await section('Civilization VI', async () => {
    const { encodeFrame, FrameReader, parseStates } = load('games/civ6/FireTuner.js');
    const f = encodeFrame(7, 'CMD:3:(function() return "ok" end)()');
    check(f.readUInt32LE(0) === f.length - 8 && f.readUInt32LE(4) === 7 && f[f.length - 1] === 0, 'frame: payload length, tag, NUL-terminated text');
    const r = new FrameReader();
    const reply = Buffer.concat([encodeFrame(9, '0'), encodeFrame(10, 'ok')]);
    const half = r.push(reply.subarray(0, 5));
    const rest = r.push(reply.subarray(5));
    check(half.length === 0 && rest.length === 2 && rest[1].tag === 10 && rest[1].strings[0] === 'ok', 'frames reassembled from a stream');
    const lsq = Buffer.concat([Buffer.alloc(8), Buffer.from('0\0Main State\x001\0InGame\x002\0GameCore_Tuner\0')]);
    lsq.writeUInt32LE(lsq.length - 8, 0);
    const states = parseStates(new FrameReader().push(lsq)[0].strings);
    check(states.get('InGame') === 1 && states.get('GameCore_Tuner') === 2, 'LSQ state list parsed');
    const war = compileCommand('civ6', { op: 'war', a: 'P1', b: 'P0' }).effect;
    check(/^\(function\(\) .*DeclareWarOn\(0, WarTypes\.FORMAL_WAR, true\).* end\)\(\)$/.test(war), 'war compiles to a Lua expression');
    check(/ChangeGoldBalance\(-250\)/.test(compileCommand('civ6', { op: 'money', from: 'P1', to: 'P0', amount: 250 }).effect), 'gold transfer');
    for (const bad of [{ op: 'money', from: 'P1', to: 'P1', amount: 5 }, { op: 'war', a: 'GER', b: 'P0' }, { op: 'money', from: 'P1', to: 'P0', amount: 1e9 }, { op: 'peace', a: 'P1); os.exit(', b: 'P0' }]) {
      let threw = false; try { compileCommand('civ6', bad); } catch { threw = true; }
      check(threw, `rejects ${JSON.stringify(bad)}`);
    }
    const civ = getAdapter('civ6');
    check(civ.family === 'paradox' && civ.autoApplies && civ.folderExample.includes('Firaxis'), 'Civ6 adapter');
    // a snapshot as the mod builds it
    const lines = ['VOTC|BEGIN|civ6|1|talk', 'VOTC|META|date|1500 AD', 'VOTC|META|mods|Better Balanced Game;VOTC Bridge - Civilization VI',
      'VOTC|P|tag|P0', 'VOTC|P|name|China', 'VOTC|P|leader|Qin Shi Huang', 'VOTC|P|gold|812',
      'VOTC|C|P1|name|Rome', 'VOTC|C|P1|leader|Trajan', 'VOTC|C|P1|government|Monarchy', 'VOTC|R|P1|opinion|-40', 'VOTC|R|P1|war|yes',
      'VOTC|CH|P1|Trajan|ruler|yes', 'VOTC|CH|P0|Magnus|title|Governor, The Steward', 'VOTC|END'];
    const s = parse(lines).snaps[0];
    const gd = buildGameDataFromPdx(s, 'P1', PDX_PROFILES.civ6, 'en');
    check(gd.aiName === 'Trajan' && gd.pdx.countryWord === 'civilization', 'talk to a leader');
    check(!JSON.stringify(gd.characters.get(gd.aiID).pdx).includes('812'), "the player's gold stays private");
    const peace = actions.find((a) => a.def.signature === 'pdxMakePeace');
    const npc = gd.characters.get(gd.aiID);
    check(peace && (await peace.def.check({ gameData: gd, sourceCharacter: npc })).canExecute, 'peace with an enemy leader offered');

    // the client against a fake game: LSQ, then CMD in the named state
    const net = require('net');
    const { FireTuner } = load('games/civ6/FireTuner.js');
    const seen = [];
    const server = net.createServer((sock) => {
      const reader = new FrameReader();
      sock.on('data', (chunk) => {
        for (const fr of reader.push(chunk)) {
          const text = fr.strings[0];
          seen.push(text);
          const answer = (strings) => {
            const payload = Buffer.from(strings.map((x) => x + '\0').join(''), 'utf-8');
            const h = Buffer.alloc(8); h.writeUInt32LE(payload.length, 0); h.writeUInt32LE(fr.tag, 4);
            sock.write(Buffer.concat([h, payload]));
          };
          if (text === 'LSQ:') answer(['0', 'Main State', '1', 'InGame', '2', 'GameCore_Tuner']);
          else if (text.startsWith('CMD:2:')) answer([text.includes('boom') ? 'ERR:[string "_cmdr = {...}"]:1: boom' : 'ok']);
          else if (text.startsWith('CMD:1:')) answer(['中文 chunk ' + text.slice(6)]);
        }
      });
    });
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const tuner = new FireTuner('127.0.0.1', server.address().port);
    const ok = await tuner.evaluate(['GameCore_Tuner'], war);
    check(ok === 'ok' && seen[1].startsWith('CMD:2:(function()'), 'command sent to GameCore_Tuner by index');
    const many = await tuner.evaluateMany(['InGame'], ['ExposedMembers.VOTC_Chunk(1)', 'ExposedMembers.VOTC_Chunk(2)']);
    check(many.length === 2 && many[1].includes('VOTC_Chunk(2)') && many[0].startsWith('中文'), 'chunks fetched in order over one connection');
    let luaErr = null; try { await tuner.evaluate(['GameCore_Tuner'], 'boom'); } catch (e) { luaErr = e; }
    check(luaErr && luaErr.code === 'lua' && /boom/.test(luaErr.message), 'Lua errors reported');
    let missing = null; try { await tuner.evaluate(['NoSuchState'], '1'); } catch (e) { missing = e; }
    check(missing && missing.code === 'no_state', 'unknown state reported');
    server.close();
    let offline = null; try { await new FireTuner('127.0.0.1', 1).evaluate(['InGame'], '1'); } catch (e) { offline = e; }
    check(offline && offline.code === 'offline', 'game not running: offline');

    // the in-game "Talk (VOTC)" button: a fake game with the mod loaded and a leader screen open
    const game = { seq: 0, player: 1, diplomacyState: true, selected: 2 };
    const snapshotText = lines.join('\n').replace('VOTC|END', 'VOTC|C|P2|name|Egypt\nVOTC|C|P2|leader|Cleopatra\nVOTC|END');
    const fake = net.createServer((sock) => {
      const reader = new FrameReader();
      sock.on('data', (chunk) => {
        for (const fr of reader.push(chunk)) {
          const text = fr.strings[0];
          const answer = (str) => {
            const payload = Buffer.from(str + '\0', 'utf-8');
            const h = Buffer.alloc(8); h.writeUInt32LE(payload.length, 0); h.writeUInt32LE(fr.tag, 4);
            sock.write(Buffer.concat([h, payload]));
          };
          if (text === 'LSQ:') {
            const states = ['0', 'Main State', '1', 'InGame', '2', 'GameCore_Tuner'];
            if (game.diplomacyState) states.push('3', 'DiplomacyActionView');
            const payload = Buffer.from(states.map((x) => x + '\0').join(''), 'utf-8');
            const h = Buffer.alloc(8); h.writeUInt32LE(payload.length, 0); h.writeUInt32LE(fr.tag, 4);
            sock.write(Buffer.concat([h, payload]));
          } else if (text.startsWith('CMD:3:')) answer(String(game.selected));
          else if (text.includes('VOTC_TalkSeq')) answer(`${game.seq}|${game.player}`);
          else if (text.includes('VOTC_Build')) answer('1');
          else if (text.includes('VOTC_Chunk(1)')) answer(snapshotText);
          else answer('');
        }
      });
    });
    await new Promise((res) => fake.listen(0, '127.0.0.1', res));
    const { Civ6Adapter } = load('games/civ6/Civ6Adapter.js');
    const civAdapter = new Civ6Adapter(new FireTuner('127.0.0.1', fake.address().port));
    const talks = [];
    civAdapter.on('talk-request', (r) => talks.push(r));
    await civAdapter.checkTalkButton();
    check(talks.length === 0, 'the first reading is only a baseline (no old click replayed)');
    game.seq = 1;
    await civAdapter.checkTalkButton();
    check(talks.length === 1 && talks[0].targetId === 'P2', "a click opens the leader the diplomacy screen shows (its own selection): " + JSON.stringify(talks[0]));
    game.diplomacyState = false; game.player = 1; game.seq = 2;
    await civAdapter.checkTalkButton();
    check(talks.length === 2 && talks[1].targetId === 'P1', "without the screen's state, the leader the mod tracked");
    game.player = 0; game.seq = 3;
    await civAdapter.checkTalkButton();
    check(talks.length === 3 && talks[2].pick, 'the player\'s own entry opens the list instead');
    await civAdapter.checkTalkButton();
    check(talks.length === 3, 'no new click, nothing happens');
    civAdapter.stop();
    fake.close();
  });

  console.log();
  console.log('FAILURES:', failures);
  process.exit(failures ? 1 : 0);
})();
