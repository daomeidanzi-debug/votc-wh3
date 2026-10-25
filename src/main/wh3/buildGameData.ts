import { GameData } from '../gameData/GameData';
import { Character } from '../gameData/Character';
import type { Wh3Character, Wh3Faction, Wh3State } from './types';

/** Traits the bridge can read and grant (ALLOWED_TRAITS in votc_wh3.lua). */
export const WH3_TRAITS: Record<string, { en: string; zh: string; desc: string }> = {
  wh2_main_trait_fighter: { en: 'Courageous', zh: '勇敢', desc: 'Fearless in battle, leads from the front.' },
  wh2_main_trait_pacifist: { en: 'Peacemaker', zh: '和平使者', desc: 'Prefers negotiation to bloodshed.' },
  wh2_main_trait_wins: { en: 'Renowned', zh: '声名远扬', desc: 'Famous for a string of victories.' },
  wh2_main_trait_defeats: { en: 'Dishonoured', zh: '蒙羞', desc: 'Shamed by defeats and lost honour.' },
  wh2_main_trait_routed: { en: 'Timid', zh: '胆怯', desc: 'Known to flee when the battle turns.' },
  wh2_main_trait_lazy: { en: 'Slothful', zh: '懒惰', desc: 'Idle and slow to act.' },
  wh2_main_trait_public_order: { en: 'Disciplinarian', zh: '铁腕', desc: 'Keeps order with a heavy hand.' },
  wh2_main_trait_builder: { en: 'Master Mason', zh: '建设者', desc: 'Devoted to building and fortification.' },
  wh2_main_trait_lone_wolf: { en: 'Lone Wolf', zh: '独狼', desc: 'Works best alone, distrusts company.' },
  wh2_main_trait_agent_target_fail: { en: 'Providential', zh: '好运', desc: 'Assassins and spies keep failing against them.' },
  wh2_main_trait_agent_target_success: { en: 'Luckless', zh: '厄运', desc: 'Enemy agents always seem to find them.' },
};

const TYPE_LABELS: Record<string, string> = {
  general: 'Lord',
  colonel: 'Captain',
  champion: 'Champion hero',
  wizard: 'Wizard hero',
  spy: 'Spy hero',
  dignitary: 'Dignitary hero',
  engineer: 'Engineer hero',
  runesmith: 'Runesmith hero',
  unit: 'Soldier',
};

export function characterTypeLabel(typeKey: string): string {
  return TYPE_LABELS[typeKey] ?? (typeKey ? typeKey : 'Character');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Campaign ids become folder names, so only keep filesystem-safe characters. */
export function sanitizeCampaignId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
  return /[A-Za-z0-9]/.test(safe) ? safe : null;
}

function finite(n: unknown, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function toCharacter(
  info: Wh3Character,
  faction: Wh3Faction,
  playerInfo: Wh3Character,
  isPlayer: boolean,
  lang: string
): Character {
  const c = Character.blank();
  const typeLabel = characterTypeLabel(info.typeKey);
  const subtype = info.subtypeName ? ` (${info.subtypeName})` : '';

  c.id = info.cqi;
  c.fullName = info.name;
  c.shortName = info.forename || info.name;
  c.firstName = info.forename || info.name;
  if (info.isUnit) {
    // one soldier speaking for the regiment; the unit name is all the game knows about them
    const soldier = lang === 'zh' ? `${info.name}的一名士兵` : `a soldier of the ${info.name}`;
    c.fullName = soldier;
    c.shortName = soldier;
    c.firstName = soldier;
    c.primaryTitle = info.commanderName
      ? `Soldier of the ${info.name} regiment in ${info.commanderName}'s army (${faction.name})`
      : `Soldier of the ${info.name} regiment (${faction.name})`;
  } else {
    c.primaryTitle = info.isFactionLeader
      ? `Faction leader of ${faction.name}${subtype}`
      : `${typeLabel} of ${faction.name}${subtype}`;
  }
  c.titleRankConcept = typeLabel;
  c.sheHe = info.isMale ? 'he' : 'she';
  c.age = finite(info.age);
  c.gold = Math.floor(finite(faction.treasury));
  c.prowess = finite(info.rank);
  c.culture = faction.subcultureName || faction.cultureName;
  c.faith = faction.cultureName;
  c.house = faction.name;
  c.isRuler = info.isFactionLeader;
  c.isLandedRuler = info.isFactionLeader && faction.regionCount > 0;
  c.isIndependentRuler = info.isFactionLeader && !faction.isMasterOfPlayer;
  c.isKnight = false;
  c.capitalLocation = faction.capitalName ?? '';
  c.liege = info.isUnit && info.commanderName
    ? info.commanderName
    : !info.isFactionLeader && faction.leaderName ? faction.leaderName : '';
  c.topLiege = c.liege;

  if (isPlayer) {
    c.opinionOfPlayer = 100;
  } else if (info.factionKey === playerInfo.factionKey) {
    // subordinates of the player have no diplomatic attitude; assume ordinary loyalty
    c.opinionOfPlayer = 50;
  } else {
    c.opinionOfPlayer = clamp(Math.round(finite(faction.attitudeToPlayer)), -100, 100);
  }

  c.traits = (info.traits || []).map((key) => {
    const t = WH3_TRAITS[key];
    return {
      category: 'trait',
      name: t ? (lang === 'zh' ? t.zh : t.en) : key,
      desc: t ? t.desc : '',
    };
  });
  c.personality = c.traits.map((t) => t.name).join(', ');

  if (!isPlayer && info.factionKey !== playerInfo.factionKey) {
    const rel: string[] = [];
    if (faction.atWarWithPlayer) rel.push('At war with the player');
    if (faction.alliedWithPlayer) rel.push('Allied with the player');
    if (faction.isVassalOfPlayer) rel.push('Vassal of the player');
    if (faction.isMasterOfPlayer) rel.push('Overlord of the player');
    if (faction.tradingWithPlayer) rel.push('Trading partner of the player');
    c.relationsToPlayer = rel;
  } else if (!isPlayer) {
    c.relationsToPlayer = ['Serves in the player\'s own faction'];
  }

  c.wh3 = { character: info, faction };
  return c;
}

export function describeScene(state: Wh3State): string {
  switch (state.targetSource) {
    case 'diplomacy':
      return 'a diplomatic audience between the two factions';
    case 'settlement':
      if (state.sceneRegionName) {
        const owner = state.sceneRegionOwnerName ? `, held by ${state.sceneRegionOwnerName}` : '';
        const capital = state.sceneIsCapital ? ' (their capital)' : '';
        return `an audience in the settlement of ${state.sceneRegionName}${capital}${owner}`;
      }
      return 'a meeting about a settlement';
    case 'unit':
      return 'a word with a common soldier in the ranks';
    default:
      if (state.target && state.player && state.target.factionKey === state.player.factionKey) {
        return 'a private council with one of the player\'s own commanders';
      }
      return 'a parley on the campaign map';
  }
}

/** Build VOTC's GameData from a successful bridge export. */
export function buildGameDataFromWh3(state: Wh3State, lang: string): GameData {
  if (!state.ok || !state.player || !state.target || !state.playerFaction) {
    throw new Error(`Invalid Warhammer III state: ${state.error ?? 'missing fields'}`);
  }
  const playerFaction = state.playerFaction;
  const targetFaction = state.targetFaction ?? playerFaction;

  const gd = GameData.blank();
  const turn = Math.max(1, Math.floor(finite(state.turn, 1)));
  gd.playerID = state.player.cqi;
  gd.playerName = state.player.name;
  gd.aiID = state.target.cqi;
  gd.aiName = state.target.name;
  gd.date = lang === 'zh' ? `第 ${turn} 回合` : `Turn ${turn}`;
  gd.totalDays = turn;
  gd.scene = describeScene(state);
  // a settlement conversation happens in that settlement; otherwise where the target stands
  gd.location = state.sceneRegionName ?? state.target.regionName ?? '';
  gd.locationController = state.sceneRegionName
    ? state.sceneRegionOwnerName ?? ''
    : state.target.regionOwnerName ?? '';

  const player = toCharacter(state.player, playerFaction, state.player, true, lang);
  const target = toCharacter(state.target, targetFaction, state.player, false, lang);
  gd.characters.set(player.id, player);
  gd.characters.set(target.id, target);

  gd.wh3 = {
    turn,
    campaign: state.campaign ?? '',
    campaignId: sanitizeCampaignId(state.campaignId),
    targetSource: state.targetSource ?? 'selection',
    playerFaction,
    targetFaction,
    sameFaction: !state.targetFaction,
  };
  return gd;
}

/** Human readable explanation for a failed export. */
export function describeExportError(error: string | undefined, lang: string): string {
  const zh = lang === 'zh';
  switch (error) {
    case 'nothing_selected':
      return zh ? '请先点选一个对话对象再按快捷键：地图上的领主、英雄或定居点，军队面板里的英雄或部队卡片，打开的人物详情，或外交界面里的派系。'
        : 'Pick someone first: a lord, hero or settlement on the map, a hero or unit card in an army, an open character details panel, or a faction in the diplomacy screen.';
    case 'target_is_player':
      return zh ? '你选中的是自己的派系领袖。请选中另一个角色。'
        : 'You selected your own faction leader. Select another character.';
    case 'diplomacy_pick_faction':
      return zh ? '外交界面已打开，但不确定你想和哪个派系对话。请在外交界面里点一下对方派系（或它的领袖头像），再按快捷键。'
        : 'The diplomacy screen is open but it is unclear which faction you mean. Click the other faction (or its leader) in the diplomacy screen, then press the hotkey.';
    case 'target_not_found':
      return zh ? '选中的角色已不存在（可能已阵亡）。请重新选择。'
        : 'The selected character no longer exists. Select someone else.';
    case 'faction_has_no_leader':
      return zh ? '该派系目前没有领袖，无法对话。' : 'That faction has no leader to talk to.';
    case 'settlement_unowned':
      return zh ? '该定居点无人占领。' : 'That settlement has no owner.';
    case 'player_has_no_leader':
      return zh ? '你的派系目前没有领袖。' : 'Your faction currently has no leader.';
    case 'no_local_faction':
      return zh ? '没有找到玩家派系（是否在多人模式？多人模式不受支持）。'
        : 'No local player faction found (multiplayer is not supported).';
    default:
      return error ?? 'unknown error';
  }
}
