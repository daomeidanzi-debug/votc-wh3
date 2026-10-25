/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: the AI character's faction hands one of its settlements to the player's faction.

const ctx = (gameData, npc) => {
  const player = gameData.characters.get(gameData.playerID);
  const pf = player && player.wh3 ? player.wh3.faction : null;
  const nf = npc && npc.wh3 ? npc.wh3.faction : null;
  return { player, pf, nf, foreign: !!(pf && nf && pf.key !== nf.key) };
};

module.exports = {
  signature: "cedesRegionToPlayer",
  title: {
    en: "Cedes a Settlement to the Player",
    zh: "割让定居点给玩家"
  },
  isDestructive: true,

  args: ({ sourceCharacter }) => {
    const regions = (sourceCharacter.wh3 && sourceCharacter.wh3.faction.regions) || [];
    return [
      {
        name: "region",
        type: "enum",
        description: `The region key of the settlement handed over. Regions: ${regions.map((r) => `${r.key} = ${r.name}`).join("; ")}`,
        required: true,
        options: regions.map((r) => r.key)
      }
    ];
  },

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName}, as ruler of their faction, explicitly agrees to give a specific settlement to ${gameData.playerName} (as ransom, payment or peace term). Never execute for vague promises. Never cede the faction's capital unless explicitly stated.`,

  check: ({ gameData, sourceCharacter }) => {
    const { nf, foreign } = ctx(gameData, sourceCharacter);
    return {
      canExecute: foreign && sourceCharacter.isRuler && !nf.isHuman && Array.isArray(nf.regions) && nf.regions.length > 0
    };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pf, nf, foreign } = ctx(gameData, sourceCharacter);
    if (!foreign || nf.isHuman) {
      return { message: { en: "Failed: this faction cannot cede settlements to you", zh: "失败：该派系无法向你割让定居点" }, sentiment: "negative" };
    }
    const region = (nf.regions || []).find((r) => r.key === args.region);
    if (!region) {
      return { message: { en: `Failed: ${nf.name} does not own region ${args.region}`, zh: `失败：${nf.name}并不拥有地区 ${args.region}` }, sentiment: "negative" };
    }
    if (dryRun) {
      return { message: { en: `${nf.name} will cede ${region.name} to ${pf.name}`, zh: `${nf.name}将把${region.name}割让给${pf.name}` }, sentiment: "positive" };
    }

    runGameEffect({ op: "transfer_region", region: region.key, from: nf.key, to: pf.key });

    nf.regions = nf.regions.filter((r) => r.key !== region.key);
    nf.regionCount = Math.max(0, nf.regionCount - 1);
    pf.regions = (pf.regions || []).concat([region]);
    pf.regionCount = (pf.regionCount || 0) + 1;

    return { message: { en: `${nf.name} ceded ${region.name} to ${pf.name}`, zh: `${nf.name}将${region.name}割让给了${pf.name}` }, sentiment: "positive" };
  },
};
