import type { TraitInfo, TotalWarProfile } from './buildGameData';
import { gameLoc, localizeDeep, LocTable, tidyText } from './packLoc';
import type { Wh3State } from './types';

/**
 * Total War: ATTILA. Its campaign scripts cannot read localised text, so the bridge sends
 * {{loc_key}} tokens and the trait keys come from the loc files too; both are resolved
 * here from the game's language packs and the player's mod packs.
 */

const CAMPAIGN_SETTINGS: Record<string, string> = {
  main_attila: 'the last century of the Western Roman Empire, from 395 AD: the Huns drive the Goths and other peoples into a divided, failing Roman world while a colder climate ruins the north',
  bel_attila: 'the age of Justinian, from 527 AD: the Eastern Roman Empire under Belisarius tries to win back the lost West from the Vandals, Goths and Franks',
  cha_attila: 'the age of Charlemagne, from 769 AD: the Franks under Charles and his brother Carloman fight Lombards, Saxons, Moors and Avars for mastery of Europe',
  pro_attila: 'the prologue of Attila, around 376 AD: the Goths flee the coming Huns',
};

export const ATTILA_PROFILE: TotalWarProfile = {
  id: 'attila',
  gameName: 'Total War: ATTILA',
  setting: CAMPAIGN_SETTINGS.main_attila,
  traits: {},
  typeLabels: {
    general: 'General',
    family: 'Member of the ruling family',
    champion: 'Champion',
    spy: 'Spy',
    dignitary: 'Priest',
  },
  pickHint: {
    en: 'Pick someone first: click a general, agent or settlement on the campaign map, then press the hotkey.',
    zh: '请先在战役地图上点选一位将领、特工或一座城市，再按快捷键。',
  },
  currency: { en: 'gold', zh: '金钱' },
};

const TRAIT_KEY = /^character_trait_levels_onscreen_name_(.+)_(\d+)$/;
const MAX_TRAITS = 400;
const MAX_GRANTABLE = 40;

/** Trait keys and their level-1 names from the loc table. */
export function traitsFromLoc(loc: LocTable): Record<string, TraitInfo> {
  const best = new Map<string, { level: number; name: string }>();
  for (const [key, text] of loc) {
    const m = TRAIT_KEY.exec(key);
    if (!m) continue;
    const name = tidyText(text);
    if (!name) continue;
    const level = Number(m[2]);
    const seen = best.get(m[1]);
    if (!seen || level < seen.level) best.set(m[1], { level, name });
  }
  const traits: Record<string, TraitInfo> = {};
  for (const [key, { name }] of [...best.entries()].slice(0, MAX_TRAITS)) {
    traits[key] = { en: name, zh: name, desc: '' };
  }
  return traits;
}

/** Personality traits the "gains a trait" action may grant (not skills, offices or battle feats). */
export function grantableTraits(traits: Record<string, TraitInfo>): Array<{ key: string; name: string }> {
  return Object.entries(traits)
    .filter(([key]) => /_personality_/.test(key))
    .slice(0, MAX_GRANTABLE)
    .map(([key, t]) => ({ key, name: t.en }));
}

function profileFor(loc: LocTable, campaign: string): TotalWarProfile {
  const traits = traitsFromLoc(loc);
  return {
    ...ATTILA_PROFILE,
    setting: CAMPAIGN_SETTINGS[campaign] ?? ATTILA_PROFILE.setting,
    traits,
    grantableTraits: grantableTraits(traits),
  };
}

export const ATTILA_LOCALIZATION = {
  exportFields(dir: string): Record<string, string> {
    const traits = traitsFromLoc(gameLoc(dir));
    return { traits: Object.keys(traits).join(',') };
  },
  localize(state: Wh3State, dir: string): { state: Wh3State; profile: TotalWarProfile } {
    const loc = gameLoc(dir);
    const localized = localizeDeep(state, loc);
    // the scripts cannot tell a nameless character apart; keep something to call them
    for (const c of [localized.player, localized.target]) {
      if (c && !c.name.trim()) c.name = c.forename?.trim() || (c.isMale ? 'a nameless man' : 'a nameless woman');
      if (c && !c.forename?.trim()) c.forename = c.name;
    }
    return { state: localized, profile: profileFor(loc, state.campaign ?? '') };
  },
};
