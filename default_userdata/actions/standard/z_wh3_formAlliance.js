/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: military alliance between the AI character's faction and the player's faction.

const ctx = (gameData, npc) => {
  const player = gameData.characters.get(gameData.playerID);
  const pf = player && player.wh3 ? player.wh3.faction : null;
  const nf = npc && npc.wh3 ? npc.wh3.faction : null;
  return { player, pf, nf, foreign: !!(pf && nf && pf.key !== nf.key) };
};

module.exports = {
  signature: "formsAllianceWithPlayer",
  title: {
    en: "Forms a Military Alliance",
    zh: "结成军事同盟"
  },
  // an alliance drags both factions into each other's wars
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName}, as ruler of their faction, and ${gameData.playerName} both explicitly agree to a military alliance. Ends any war between them.`,

  check: ({ gameData, sourceCharacter }) => {
    const { nf, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && !nf.alliedWithPlayer && sourceCharacter.isRuler };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pf, nf, foreign } = ctx(gameData, sourceCharacter);
    if (!foreign) {
      return { message: { en: "Failed: the two characters belong to the same faction", zh: "失败：双方属于同一派系" }, sentiment: "negative" };
    }
    if (nf.alliedWithPlayer) {
      return { message: { en: `${nf.name} is already allied with ${pf.name}`, zh: `${nf.name}已经是${pf.name}的盟友` }, sentiment: "neutral" };
    }
    if (dryRun) {
      return { message: { en: `${nf.name} will form a military alliance with ${pf.name}`, zh: `${nf.name}将与${pf.name}结成军事同盟` }, sentiment: "positive" };
    }

    runGameEffect({ op: "alliance", a: nf.key, b: pf.key });

    nf.atWarWithPlayer = false;
    nf.alliedWithPlayer = true;
    sourceCharacter.relationsToPlayer = (sourceCharacter.relationsToPlayer || [])
      .filter((r) => !/at war/i.test(r))
      .concat(["Allied with the player"]);

    return { message: { en: `${nf.name} and ${pf.name} are now allies`, zh: `${nf.name}与${pf.name}结为盟友` }, sentiment: "positive" };
  },
};
