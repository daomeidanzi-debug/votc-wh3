/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: the AI character dies (executed, slain in a duel, sacrificed...). The player is never killed.

module.exports = {
  signature: "isKilled",
  title: {
    en: "Character Is Killed",
    zh: "角色被杀"
  },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName} unmistakably dies in the conversation: executed on ${gameData.playerName}'s order, slain in a duel, takes their own life, is sacrificed. Never for threats.`,

  check: ({ gameData, sourceCharacter }) => {
    // the bridge refuses to kill human faction leaders; only offer it for the AI side
    return { canExecute: !!sourceCharacter.wh3 && sourceCharacter.id !== gameData.playerID };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    if (sourceCharacter.id === gameData.playerID) {
      return { message: { en: "Failed: the player cannot be killed by this action", zh: "失败：此操作不能杀死玩家" }, sentiment: "negative" };
    }
    if (dryRun) {
      return { message: { en: `${sourceCharacter.shortName} will die`, zh: `${sourceCharacter.shortName}将会死去` }, sentiment: "negative" };
    }

    runGameEffect({ op: "kill", cqi: sourceCharacter.id });

    return { message: { en: `${sourceCharacter.shortName} has died`, zh: `${sourceCharacter.shortName}死了` }, sentiment: "negative" };
  },
};
