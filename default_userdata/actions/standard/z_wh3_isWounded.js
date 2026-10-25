/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: a character is wounded (e.g. in a duel or an assassination attempt) and recovers for some turns.

module.exports = {
  signature: "isWounded",
  title: {
    en: "Is Wounded",
    zh: "负伤"
  },
  isDestructive: true,

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "who",
      type: "enum",
      description: `Who is wounded: "npc" = ${sourceCharacter.shortName}, "player" = ${gameData.playerName}.`,
      required: true,
      options: ["npc", "player"]
    },
    {
      name: "turns",
      type: "number",
      description: "Turns needed to recover: 1-2 for a light wound, up to 5 for a grievous one.",
      required: true,
      min: 1,
      max: 5,
      step: 1
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when the conversation turns violent and ${sourceCharacter.shortName} or ${gameData.playerName} is actually hurt (a duel, a blow, poison, a failed assassination). The character is taken out of action while recovering.`,

  check: ({ gameData, sourceCharacter }) => {
    return { canExecute: !!sourceCharacter.wh3 && !!gameData.characters.get(gameData.playerID) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const who = args.who === "player" ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!who) {
      return { message: { en: "Failed: character not found", zh: "失败：找不到角色" }, sentiment: "negative" };
    }
    const turns = Math.round(Number(args.turns));
    if (!Number.isFinite(turns) || turns < 1 || turns > 5) {
      return { message: { en: "Failed: turns must be 1 to 5", zh: "失败：回合数必须为 1 到 5" }, sentiment: "negative" };
    }
    if (dryRun) {
      return { message: { en: `${who.shortName} will be wounded for ${turns} turn(s)`, zh: `${who.shortName}将负伤 ${turns} 回合` }, sentiment: "negative" };
    }

    runGameEffect({ op: "wound", cqi: who.id, turns });

    if (who.wh3) who.wh3.character.isWounded = true;

    return { message: { en: `${who.shortName} was wounded and needs ${turns} turn(s) to recover`, zh: `${who.shortName}负伤了，需要 ${turns} 回合恢复` }, sentiment: "negative" };
  },
};
