/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: the AI character's faction submits as a vassal of the player's faction.

const ctx = (gameData, npc) => {
  const player = gameData.characters.get(gameData.playerID);
  const pf = player && player.wh3 ? player.wh3.faction : null;
  const nf = npc && npc.wh3 ? npc.wh3.faction : null;
  return { player, pf, nf, foreign: !!(pf && nf && pf.key !== nf.key) };
};

module.exports = {
  signature: "becomesVassalOfPlayer",
  title: {
    en: "Becomes the Player's Vassal",
    zh: "成为玩家的附庸"
  },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName}, as ruler of their faction, explicitly submits to ${gameData.playerName} and accepts becoming a vassal. Extremely rare: only after crushing defeat, overwhelming threat or deep loyalty.`,

  check: ({ gameData, sourceCharacter }) => {
    const { nf, foreign } = ctx(gameData, sourceCharacter);
    return {
      canExecute: foreign && sourceCharacter.isRuler && !nf.isVassalOfPlayer && !nf.isMasterOfPlayer && !nf.isHuman
    };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pf, nf, foreign } = ctx(gameData, sourceCharacter);
    if (!foreign || nf.isHuman) {
      return { message: { en: "Failed: this faction cannot become your vassal", zh: "失败：该派系无法成为你的附庸" }, sentiment: "negative" };
    }
    if (nf.isVassalOfPlayer) {
      return { message: { en: `${nf.name} is already a vassal of ${pf.name}`, zh: `${nf.name}已经是${pf.name}的附庸` }, sentiment: "neutral" };
    }
    if (dryRun) {
      return { message: { en: `${nf.name} will become a vassal of ${pf.name}`, zh: `${nf.name}将成为${pf.name}的附庸` }, sentiment: "positive" };
    }

    runGameEffect({ op: "vassal", master: pf.key, vassal: nf.key });

    nf.isVassalOfPlayer = true;
    nf.atWarWithPlayer = false;
    sourceCharacter.isIndependentRuler = false;
    sourceCharacter.relationsToPlayer = (sourceCharacter.relationsToPlayer || [])
      .filter((r) => !/at war/i.test(r))
      .concat(["Vassal of the player"]);

    return { message: { en: `${nf.name} bent the knee and became a vassal of ${pf.name}`, zh: `${nf.name}俯首称臣，成为${pf.name}的附庸` }, sentiment: "positive" };
  },
};
