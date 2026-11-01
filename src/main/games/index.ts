import { settingsRepository } from '../SettingsRepository';
import { Ck3Adapter } from './ck3/Ck3Adapter';
import { Civ6Adapter } from './civ6/Civ6Adapter';
import { ParadoxAdapter } from './paradox/ParadoxAdapter';
import { PDX_PROFILES } from './paradox/profiles';
import { TotalWarAdapter } from './totalwar/TotalWarAdapter';
import { ATTILA_LOCALIZATION, ATTILA_PROFILE } from './totalwar/attila';
import { TraitInfo, TotalWarProfile, WH3_PROFILE } from './totalwar/buildGameData';
import { GAME_IDS, GameAdapter, GameId, isGameId } from './types';

/** Personality traits the Three Kingdoms bridge reads and grants (ALLOWED_TRAITS in votc_3k.lua). */
export const TK_TRAITS: Record<string, TraitInfo> = {
  '3k_main_ceo_trait_personality_brave': { en: 'Brave', zh: '勇敢', desc: 'Fearless, leads from the front.' },
  '3k_main_ceo_trait_personality_cowardly': { en: 'Cowardly', zh: '怯懦', desc: 'Avoids danger, quick to flee.' },
  '3k_main_ceo_trait_personality_honourable': { en: 'Honourable', zh: '守信', desc: 'Keeps their word and expects others to.' },
  '3k_main_ceo_trait_personality_deceitful': { en: 'Deceitful', zh: '狡诈', desc: 'Lies easily, schemes behind smiles.' },
  '3k_main_ceo_trait_personality_cruel': { en: 'Cruel', zh: '残暴', desc: 'Harsh with enemies and servants alike.' },
  '3k_main_ceo_trait_personality_kind': { en: 'Kind', zh: '仁慈', desc: 'Merciful, cares for the common people.' },
  '3k_main_ceo_trait_personality_ambitious': { en: 'Ambitious', zh: '野心勃勃', desc: 'Wants more power and rank.' },
  '3k_main_ceo_trait_personality_humble': { en: 'Humble', zh: '谦逊', desc: 'Modest, does not seek glory.' },
  '3k_main_ceo_trait_personality_loyal': { en: 'Loyal', zh: '忠诚', desc: 'Devoted to their lord.' },
  '3k_main_ceo_trait_personality_disloyal': { en: 'Disloyal', zh: '不忠', desc: 'Serves only while it pays.' },
  '3k_main_ceo_trait_personality_greedy': { en: 'Greedy', zh: '贪婪', desc: 'Covets wealth.' },
  '3k_main_ceo_trait_personality_charitable': { en: 'Charitable', zh: '慷慨', desc: 'Generous with their wealth.' },
  '3k_main_ceo_trait_personality_cautious': { en: 'Cautious', zh: '谨慎', desc: 'Weighs every risk.' },
  '3k_main_ceo_trait_personality_fiery': { en: 'Fiery', zh: '暴躁', desc: 'Hot-tempered and rash.' },
  '3k_main_ceo_trait_personality_cunning': { en: 'Cunning', zh: '机智', desc: 'Clever with stratagems.' },
  '3k_main_ceo_trait_personality_pacifist': { en: 'Pacifist', zh: '厌战', desc: 'Hates war and bloodshed.' },
};

export const TK_PROFILE: TotalWarProfile = {
  id: 'tk',
  gameName: 'Total War: THREE KINGDOMS',
  setting: 'late Han dynasty China at the start of the Three Kingdoms era, where warlords fight for the Mandate of Heaven',
  traits: TK_TRAITS,
  typeLabels: {
    general: 'General',
    minister: 'Minister',
    spy: 'Spy',
    castellan: 'Castellan',
    champion: 'Champion',
    dignitary: 'Envoy',
  },
  pickHint: {
    en: 'Pick someone first: click a general or a settlement on the campaign map, then press the hotkey.',
    zh: '请先在战役地图上点选一位武将或一座城池，再按快捷键。',
  },
  currency: { en: 'coins', zh: '钱' },
};

const WH3_OPS = ['export', 'transfer_gold', 'attitude', 'war', 'peace', 'alliance', 'trade', 'vassal', 'confederate',
  'transfer_region', 'add_trait', 'add_xp', 'wound', 'kill', 'replenish_ap', 'give_unit'];
const TK_OPS = ['export', 'transfer_gold', 'war', 'peace', 'alliance', 'trade', 'vassal', 'confederate',
  'transfer_region', 'add_trait', 'add_xp', 'kill', 'replenish_ap'];
/** EXECUTORS of votc_attila.lua: Attila's script interface has no alliance or confederation command */
const ATTILA_OPS = ['export', 'transfer_gold', 'war', 'peace', 'trade', 'vassal',
  'transfer_region', 'add_trait', 'add_xp', 'kill', 'replenish_ap'];

function create(id: GameId): GameAdapter {
  switch (id) {
    case 'ck3':
      return new Ck3Adapter();
    case 'wh3':
      return new TotalWarAdapter({
        id: 'wh3',
        name: { en: 'Total War: WARHAMMER III', zh: '全面战争：战锤3' },
        shortName: 'Warhammer III',
        steamFolder: 'Total War WARHAMMER III',
        steamAppId: '1142710',
        exeName: 'Warhammer3.exe',
        packName: 'votc_wh3.pack',
        modName: 'votc_wh3',
        windowMatch: ['warhammer3', 'warhammer iii'],
        ops: WH3_OPS,
        profile: WH3_PROFILE,
      });
    case 'tk':
      return new TotalWarAdapter({
        id: 'tk',
        name: { en: 'Total War: THREE KINGDOMS', zh: '全面战争：三国' },
        shortName: 'Three Kingdoms',
        steamFolder: 'Total War THREE KINGDOMS',
        steamAppId: '779340',
        exeName: 'Three_Kingdoms.exe',
        packName: 'votc_3k.pack',
        modName: 'votc_3k',
        windowMatch: ['three_kingdoms', 'three kingdoms', '三国'],
        ops: TK_OPS,
        profile: TK_PROFILE,
      });
    case 'attila':
      return new TotalWarAdapter({
        id: 'attila',
        name: { en: 'Total War: ATTILA', zh: '全面战争：阿提拉' },
        shortName: 'Attila',
        steamFolder: 'Total War Attila',
        steamAppId: '325610',
        exeName: 'Attila.exe',
        packName: 'votc_attila.pack',
        modName: 'votc_attila',
        windowMatch: ['attila'],
        ops: ATTILA_OPS,
        profile: ATTILA_PROFILE,
        localization: ATTILA_LOCALIZATION,
      });
    case 'civ6':
      return new Civ6Adapter();
    default:
      return new ParadoxAdapter(PDX_PROFILES[id]);
  }
}

const adapters = new Map<GameId, GameAdapter>();

export function getAdapter(id: GameId): GameAdapter {
  let a = adapters.get(id);
  if (!a) {
    a = create(id);
    adapters.set(id, a);
  }
  return a;
}

/** The adapter of the game picked in the settings. */
export function activeGame(): GameAdapter {
  const id = settingsRepository.getActiveGame();
  return getAdapter(isGameId(id) ? id : 'wh3');
}

/** For the settings UI: every supported game. */
export function listGames(lang: string): Array<{ id: GameId; name: string; folderKind: string; folderExample: string; talkHint: string; consoleOption: boolean; consoleRun: boolean }> {
  return GAME_IDS.map((id) => {
    const a = getAdapter(id);
    const consoleOption = id === 'hoi4' || id === 'stellaris';
    return {
      id,
      name: lang === 'zh' ? a.name.zh : a.name.en,
      folderKind: a.folderKind,
      folderExample: a.folderExample,
      talkHint: lang === 'zh' ? a.talkHint.zh : a.talkHint.en,
      consoleOption,
      consoleRun: consoleOption && settingsRepository.getConsoleRun(id),
    };
  });
}
