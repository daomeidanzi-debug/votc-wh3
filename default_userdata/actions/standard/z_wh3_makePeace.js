/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: the AI character's faction makes peace with the player's faction.

const ctx = (gameData, npc) => {
  const player = gameData.characters.get(gameData.playerID);
  const pf = player && player.wh3 ? player.wh3.faction : null;
  const nf = npc && npc.wh3 ? npc.wh3.faction : null;
  return { player, pf, nf, foreign: !!(pf && nf && pf.key !== nf.key) };
};

module.exports = {
  signature: "makesPeaceWithPlayer",
  title: {
    en: "Makes Peace with the Player",
    zh: "与玩家议和"
  },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName}, as ruler of their faction, clearly agrees to end the war with ${gameData.playerName} in the conversation.`,

  check: ({ gameData, sourceCharacter }) => {
    const { nf, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && !!nf.atWarWithPlayer && sourceCharacter.isRuler };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pf, nf, foreign } = ctx(gameData, sourceCharacter);
    if (!foreign) {
      return { message: { en: "Failed: the two characters belong to the same faction", zh: "失败：双方属于同一派系" }, sentiment: "negative" };
    }
    if (!nf.atWarWithPlayer) {
      return { message: { en: `${nf.name} is not at war with ${pf.name}`, zh: `${nf.name}并未与${pf.name}交战` }, sentiment: "neutral" };
    }
    if (dryRun) {
      return { message: { en: `${nf.name} will make peace with ${pf.name}`, zh: `${nf.name}将与${pf.name}议和` }, sentiment: "positive" };
    }

    runGameEffect({ op: "peace", a: nf.key, b: pf.key });

    nf.atWarWithPlayer = false;
    sourceCharacter.relationsToPlayer = (sourceCharacter.relationsToPlayer || []).filter((r) => !/at war/i.test(r));

    return { message: { en: `${nf.name} made peace with ${pf.name}`, zh: `${nf.name}与${pf.name}达成了和平` }, sentiment: "positive" };
  },
};
