/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: the AI character's faction confederates into the player's faction.

const ctx = (gameData, npc) => {
  const player = gameData.characters.get(gameData.playerID);
  const pf = player && player.wh3 ? player.wh3.faction : null;
  const nf = npc && npc.wh3 ? npc.wh3.faction : null;
  return { player, pf, nf, foreign: !!(pf && nf && pf.key !== nf.key) };
};

module.exports = {
  signature: "joinsPlayerFaction",
  title: {
    en: "Confederates with the Player",
    zh: "并入玩家派系（邦联）"
  },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName}, as ruler of their faction, explicitly agrees to merge their whole faction into ${gameData.playerName}'s faction (confederation). Only possible between factions of the same culture. Extremely rare.`,

  check: ({ gameData, sourceCharacter }) => {
    const { pf, nf, foreign } = ctx(gameData, sourceCharacter);
    return {
      canExecute: foreign && sourceCharacter.isRuler && !nf.isHuman && nf.cultureKey === pf.cultureKey
    };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pf, nf, foreign } = ctx(gameData, sourceCharacter);
    if (!foreign || nf.isHuman || nf.cultureKey !== pf.cultureKey) {
      return { message: { en: "Failed: this faction cannot confederate with yours", zh: "失败：该派系无法与你邦联" }, sentiment: "negative" };
    }
    if (dryRun) {
      return { message: { en: `${nf.name} will be absorbed into ${pf.name}`, zh: `${nf.name}将并入${pf.name}` }, sentiment: "positive" };
    }

    runGameEffect({ op: "confederate", absorber: pf.key, absorbed: nf.key });

    nf.atWarWithPlayer = false;
    sourceCharacter.isIndependentRuler = false;
    sourceCharacter.relationsToPlayer = ["Has joined the player's faction"];

    return { message: { en: `${nf.name} has confederated with ${pf.name}`, zh: `${nf.name}已并入${pf.name}` }, sentiment: "positive" };
  },
};
