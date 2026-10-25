/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: the AI character's faction declares war on the player's faction.

const ctx = (gameData, npc) => {
  const player = gameData.characters.get(gameData.playerID);
  const pf = player && player.wh3 ? player.wh3.faction : null;
  const nf = npc && npc.wh3 ? npc.wh3.faction : null;
  return { player, pf, nf, foreign: !!(pf && nf && pf.key !== nf.key) };
};

module.exports = {
  signature: "declaresWarOnPlayer",
  title: {
    en: "Declares War on the Player",
    zh: "向玩家宣战"
  },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName}, as ruler of their faction, unmistakably declares war on ${gameData.playerName} in the conversation (not a threat or a bluff).`,

  check: ({ gameData, sourceCharacter }) => {
    const { nf, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && !nf.atWarWithPlayer && sourceCharacter.isRuler };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pf, nf, foreign } = ctx(gameData, sourceCharacter);
    if (!foreign) {
      return { message: { en: "Failed: the two characters belong to the same faction", zh: "失败：双方属于同一派系" }, sentiment: "negative" };
    }
    if (nf.atWarWithPlayer) {
      return { message: { en: `${nf.name} is already at war with ${pf.name}`, zh: `${nf.name}已经与${pf.name}处于战争状态` }, sentiment: "neutral" };
    }
    if (dryRun) {
      return { message: { en: `${nf.name} will declare war on ${pf.name}`, zh: `${nf.name}将向${pf.name}宣战` }, sentiment: "negative" };
    }

    runGameEffect({ op: "war", a: nf.key, b: pf.key });

    nf.atWarWithPlayer = true;
    nf.alliedWithPlayer = false;
    nf.tradingWithPlayer = false;
    sourceCharacter.relationsToPlayer = (sourceCharacter.relationsToPlayer || [])
      .filter((r) => !/allied|trading/i.test(r))
      .concat(["At war with the player"]);

    return { message: { en: `${nf.name} declared war on ${pf.name}!`, zh: `${nf.name}向${pf.name}宣战了！` }, sentiment: "negative" };
  },
};
