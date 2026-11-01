/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Victoria 3: one of the player's own characters is sent into exile. Acts on the character
// the player chose "Talk (VOTC)" on in game.

module.exports = {
  signature: "pdxCharacterExiled",
  games: ["vic3"],
  title: { en: "Exiled", zh: "被流放" },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${gameData.playerName} clearly orders ${sourceCharacter.shortName} into exile, or ${sourceCharacter.shortName} flees the country for good, in the conversation.`,

  check: ({ gameData, sourceCharacter }) => {
    const info = gameData.pdx;
    const p = sourceCharacter.pdx && sourceCharacter.pdx.person;
    return { canExecute: !!(info && info.talkerInGame && info.sameCountry && info.ops.includes("char_exile") && p && !p.ruler) };
  },

  run: ({ sourceCharacter, runGameEffect, dryRun }) => {
    if (dryRun) return { message: { en: `${sourceCharacter.shortName} will go into exile`, zh: `${sourceCharacter.shortName}将被流放` }, sentiment: "negative" };
    runGameEffect({ op: "char_exile" });
    return { message: { en: `${sourceCharacter.shortName} went into exile`, zh: `${sourceCharacter.shortName}被流放了` }, sentiment: "negative" };
  },
};
