import path from 'path';
import type { Localized } from '../types';
import type { PdxGame } from './commands';

/** What differs between the Paradox games on the app side. */
export interface PdxProfile {
  id: PdxGame;
  name: Localized;
  /** folder under Documents\Paradox Interactive */
  userFolder: string;
  /** folder under steamapps\common */
  steamFolder: string;
  exeNames: string[];
  /** window title / path fragments that identify the game window */
  windowMatch: string[];
  /** where the mod's log lines land, relative to the user folder (first existing wins, all are read) */
  logFiles: string[];
  /** the mod folder name under <user folder>\mod */
  modFolder: string;
  /** installed copies of the command file, relative to the user folder and (optional) the install folder */
  runFiles: { user: string[]; install?: string[] };
  /** what the player types into the console to apply queued actions */
  runCommand: string;
  /** the console must be unlocked with the -debug_mode launch option */
  needsDebugMode: boolean;
  /** prompt setting line */
  setting: string;
  /** e.g. "country" / "empire" */
  countryWord: Localized;
  /** label for fact keys the mod logs */
  factLabels: Record<string, string>;
  /**
   * Country facts a foreigner may know (public face); the rest (treasury, stability, manpower...)
   * is only known to the country's own people. name, leader, government and capital are always public.
   */
  publicFacts: string[];
  /**
   * How queued actions reach the game without the player typing anything:
   * 'gui'  - the mod's hidden GUI timer applies the queued actions itself (a scripted GUI
   *          that fires the mod's command event)
   * 'keys' - the app types the run command into the game console when the game is in front
   *          (no game uses it any more)
   * 'tuner' - the app sends each command over FireTuner itself (Civilization VI)
   */
  autoRun: 'gui' | 'keys' | 'tuner';
  /**
   * false: never type the run command into the console (Victoria 3/EU5: a console command
   * can crash the game; the mod applies the actions itself)
   */
  consoleTyping?: boolean;
  /** where the player starts a conversation inside the game */
  talkInGame: Localized;
}

export const PDX_PROFILES: Record<PdxGame, PdxProfile> = {
  hoi4: {
    id: 'hoi4',
    name: { en: 'Hearts of Iron IV', zh: '钢铁雄心4' },
    userFolder: 'Hearts of Iron IV',
    steamFolder: 'Hearts of Iron IV',
    exeNames: ['hoi4.exe'],
    windowMatch: ['hoi4', 'hearts of iron'],
    logFiles: ['logs/game.log'],
    modFolder: 'votc_hoi4',
    // no console: the actions are a hidden event of the mod, reloaded by the -debug file
    // watcher and fired by the daily pulse (time running) or the mod's VOTC buttons
    runFiles: { user: [path.join('mod', 'votc_hoi4', 'events', 'votc_commands.txt')] },
    runCommand: 'event votc_cmd.1',
    consoleTyping: false,
    needsDebugMode: true,
    setting: 'the world of the Second World War era, in a Hearts of Iron IV campaign',
    countryWord: { en: 'country', zh: '国家' },
    factLabels: {
      ideology: 'ruling ideology',
      party: 'ruling party',
      stability: 'stability %',
      war_support: 'war support %',
      political_power: 'political power',
      divisions: 'divisions',
      factories_civ: 'civilian factories',
      factories_mil: 'military factories',
      manpower_k: 'available manpower (thousands)',
      faction: 'faction',
      war_with: 'at war with',
      allies: 'allied with',
      major: 'major power',
    },
    publicFacts: ['ideology', 'party', 'faction', 'war_with', 'major'],
    autoRun: 'gui',
    talkInGame: {
      en: `the "Talk" button in a country's diplomacy view (its leader, advisors and generals), or "VOTC" in the top bar (your own people)`,
      zh: '国家外交界面的“交谈”按钮（该国领袖、顾问和将领），或顶栏的“VOTC”按钮（本国人物）',
    },
  },
  vic3: {
    id: 'vic3',
    name: { en: 'Victoria 3', zh: '维多利亚3' },
    userFolder: 'Victoria 3',
    steamFolder: 'Victoria 3',
    exeNames: ['victoria3.exe'],
    windowMatch: ['victoria3', 'victoria 3'],
    logFiles: ['logs/debug.log'],
    modFolder: 'votc_vic3',
    // no `run` console command in Victoria 3: the actions are a hidden event of the mod,
    // reloaded by the -debug_mode file watcher and fired by the mod's timer
    runFiles: { user: [path.join('mod', 'votc_vic3', 'events', 'votc_commands.txt')] },
    runCommand: 'event votc_cmd.1',
    consoleTyping: false,
    needsDebugMode: true,
    setting: 'the world of the long nineteenth century, in a Victoria 3 campaign',
    countryWord: { en: 'country', zh: '国家' },
    factLabels: {
      rank: 'rank',
      gdp: 'GDP',
      treasury: 'treasury (£)',
      infamy: 'infamy',
      war_with: 'at war with',
      allies: 'allied with',
      rival: 'rival',
    },
    publicFacts: ['rank', 'war_with', 'allies', 'rival'],
    autoRun: 'gui',
    // Victoria 3 lists character interactions only for your own characters and exiles
    talkInGame: {
      en: `right-click one of your characters > Talk (VOTC); for foreign people, "Talk (VOTC)" in that country's diplomatic actions`,
      zh: '本国人物：右键 >“交谈（VOTC）”；外国人物：在该国的外交行动里点“交谈（VOTC）”',
    },
  },
  eu5: {
    id: 'eu5',
    name: { en: 'Europa Universalis V', zh: '欧陆风云5' },
    userFolder: 'Europa Universalis V',
    steamFolder: 'Europa Universalis V',
    exeNames: ['eu5.exe'],
    windowMatch: ['eu5', 'europa universalis v'],
    // the mod logs with error_log: EU5 buffers debug.log, error.log is written line by line
    logFiles: ['logs/error.log'],
    modFolder: 'votc_eu5',
    // like Victoria 3: no console (it can crash the game); the actions are a hidden event of
    // the mod, reloaded by the -debug_mode file watcher and fired by the mod's runner
    runFiles: { user: [path.join('mod', 'votc_eu5', 'in_game', 'events', 'votc_commands.txt')] },
    runCommand: 'event votc_cmd.1',
    consoleTyping: false,
    needsDebugMode: true,
    setting: 'the early modern world, in a Europa Universalis V campaign',
    countryWord: { en: 'country', zh: '国家' },
    factLabels: {
      gold: 'treasury (ducats)',
      stability: 'stability',
      prestige: 'prestige',
      great_power: 'great power',
      war_with: 'at war with',
      allies: 'allied with',
      rival: 'rival',
    },
    publicFacts: ['great_power', 'war_with', 'allies', 'rival'],
    autoRun: 'gui',
    talkInGame: { en: 'right-click any character > Talk (VOTC)', zh: '右键任意人物 >“交谈（VOTC）”' },
  },
  stellaris: {
    id: 'stellaris',
    name: { en: 'Stellaris', zh: '群星' },
    userFolder: 'Stellaris',
    steamFolder: 'Stellaris',
    exeNames: ['stellaris.exe'],
    windowMatch: ['stellaris'],
    logFiles: ['logs/game.log'],
    modFolder: 'votc_stellaris',
    // no console: the actions are a hidden event of the mod, reloaded by the file watcher of
    // -debug_mode and fired by the monthly pulse or the talk decision
    runFiles: { user: [path.join('mod', 'votc_stellaris', 'events', 'votc_commands.txt')] },
    runCommand: 'event votc_cmd.1',
    consoleTyping: false,
    needsDebugMode: true,
    setting: 'a galaxy of rival interstellar empires, in a Stellaris campaign',
    countryWord: { en: 'empire', zh: '帝国' },
    factLabels: {
      authority: 'authority',
      ethics: 'ethics',
      species: 'founder species',
      fleet_power: 'fleet power',
      planets: 'colonies',
      energy: 'energy credits',
      minerals: 'minerals',
      alloys: 'alloys',
      influence: 'influence',
      war_with: 'at war with',
      allies: 'allied with',
      federation: 'federation',
    },
    publicFacts: ['authority', 'ethics', 'species', 'war_with', 'federation'],
    autoRun: 'gui',
    talkInGame: {
      en: 'the "Open communications (VOTC)" decision on your capital planet',
      zh: '首都星球“决议”里的“开启通讯（VOTC）”',
    },
  },
  civ6: {
    id: 'civ6',
    name: { en: "Sid Meier's Civilization VI", zh: '文明6' },
    // not a Paradox game: the user folder is AppData\Local\Firaxis Games\... (see Civ6Adapter)
    userFolder: "Sid Meier's Civilization VI",
    steamFolder: "Sid Meier's Civilization VI",
    exeNames: ['civilizationvi.exe', 'civilizationvi_dx12.exe'],
    windowMatch: ['civilization vi', 'civilizationvi', '文明'],
    logFiles: [path.join('Logs', 'Lua.log')],
    modFolder: 'VOTC_Bridge',
    runFiles: { user: [] },
    runCommand: '',
    needsDebugMode: false,
    setting: 'the world of Civilization VI, where great civilizations led by famous leaders of history rise from the ancient era and compete through the ages in science, culture, faith, diplomacy and war',
    countryWord: { en: 'civilization', zh: '文明' },
    factLabels: {
      kind: 'kind',
      era: 'era',
      cities: 'cities',
      score: 'score',
      gold: 'treasury (gold)',
      favor: 'diplomatic favor',
      religion: 'majority religion',
      war_with: 'at war with',
      allies: 'allied with',
      diplomatic_state: 'diplomatic stance',
      grievances: 'grievances',
      suzerain: 'suzerain',
      alliance: 'alliance',
    },
    publicFacts: ['kind', 'era', 'religion', 'war_with', 'allies', 'cities'],
    autoRun: 'tuner',
    talkInGame: {
      en: `"Talk (VOTC)" in a leader's diplomacy screen, or the VOTC talk hotkey (the app lists the leaders you have met, your governors and great people)`,
      zh: '领袖外交界面里的“交谈（VOTC）”按钮，或游戏中按 VOTC 对话快捷键（程序会列出你见过的领袖、你的总督和伟人）',
    },
  },
};
