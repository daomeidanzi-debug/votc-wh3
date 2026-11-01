/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Victoria 3 / EU5: the character the player talks to dies (executed on the player's order,
// assassinated, killed in a duel...). Acts on the character the player chose "Talk (VOTC)" on.

const EU5_REASONS = ["execution", "assassination", "beheading", "poison_arrow", "combat"];

module.exports = {
  signature: "pdxCharacterDies",
  games: ["vic3", "eu5"],
  title: { en: "Dies", zh: "死亡" },
  isDestructive: true,

  args: ({ gameData, sourceCharacter }) => gameData.game === "eu5"
    ? [{
      name: "reason",
      type: "enum",
      description: `How ${sourceCharacter.shortName} dies.`,
      required: true,
      options: EU5_REASONS
    }]
    : [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName} unmistakably dies in the scene: executed on ${gameData.playerName}'s order (only the player's own subjects, or a prisoner), assassinated, or killed in a fight. Never for threats or for someone fleeing.`,

  check: ({ gameData, sourceCharacter }) => {
    const info = gameData.pdx;
    return { canExecute: !!(info && info.talkerInGame && info.ops.includes("char_kill") && sourceCharacter.pdx && sourceCharacter.pdx.person) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const reason = gameData.game === "eu5" ? (EU5_REASONS.includes(args.reason) ? args.reason : "execution") : null;
    if (dryRun) return { message: { en: `${sourceCharacter.shortName} will die`, zh: `${sourceCharacter.shortName}将死去` }, sentiment: "negative" };
    runGameEffect(reason ? { op: "char_kill", by: gameData.pdx.playerCountry.tag, reason } : { op: "char_kill" });
    return { message: { en: `${sourceCharacter.shortName} is dead`, zh: `${sourceCharacter.shortName}死了` }, sentiment: "negative" };
  },
};
