/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: a character gains ranks (levels) from training, counsel or a revelation.

module.exports = {
  signature: "gainsExperience",
  title: {
    en: "Gains Experience",
    zh: "获得经验"
  },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "who",
      type: "enum",
      description: `Who gains experience: "npc" = ${sourceCharacter.shortName}, "player" = ${gameData.playerName}.`,
      required: true,
      options: ["npc", "player"]
    },
    {
      name: "levels",
      type: "number",
      description: "Number of ranks gained, 1 for useful advice or training, up to 3 for a life-changing lesson.",
      required: true,
      min: 1,
      max: 3,
      step: 1
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} or ${gameData.playerName} genuinely learns something valuable in the conversation: war counsel, sparring, forbidden lore, a hard lesson.`,

  check: ({ gameData, sourceCharacter }) => {
    return { canExecute: !!sourceCharacter.wh3 && !!gameData.characters.get(gameData.playerID) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const who = args.who === "player" ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!who) {
      return { message: { en: "Failed: character not found", zh: "失败：找不到角色" }, sentiment: "negative" };
    }
    const levels = Math.round(Number(args.levels));
    if (!Number.isFinite(levels) || levels < 1 || levels > 3) {
      return { message: { en: "Failed: levels must be 1 to 3", zh: "失败：等级必须为 1 到 3" }, sentiment: "negative" };
    }
    if (dryRun) {
      return { message: { en: `${who.shortName} will gain ${levels} rank(s)`, zh: `${who.shortName}将提升 ${levels} 级` }, sentiment: "positive" };
    }

    runGameEffect({ op: "add_xp", cqi: who.id, levels });

    who.prowess += levels;
    if (who.wh3) who.wh3.character.rank += levels;

    return { message: { en: `${who.shortName} gained ${levels} rank(s)`, zh: `${who.shortName}提升了 ${levels} 级` }, sentiment: "positive" };
  },
};
