/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Attila: a character gains a personality trait because of what happened in the conversation.
// The traits come from the game's own files (and the player's mods) at runtime.

const traitsOf = (gameData) => (gameData.wh3 && gameData.wh3.grantableTraits) || [];

module.exports = {
  signature: "attGainsTrait",
  games: ["attila"],
  title: {
    en: "Gains a Trait",
    zh: "获得特质"
  },

  args: ({ gameData, sourceCharacter }) => {
    const traits = traitsOf(gameData);
    return [
      {
        name: "who",
        type: "enum",
        description: `Who gains the trait: "npc" = ${sourceCharacter.shortName}, "player" = ${gameData.playerName}.`,
        required: true,
        options: ["npc", "player"]
      },
      {
        name: "trait",
        type: "enum",
        description: `The trait gained: ${traits.map((t) => `${t.key} = ${t.name}`).join("; ")}`,
        required: true,
        options: traits.length ? traits.map((t) => t.key) : ["none"]
      }
    ];
  },

  description: ({ gameData, sourceCharacter }) =>
    `Execute rarely, only when the conversation leaves a lasting mark on ${sourceCharacter.shortName} or ${gameData.playerName} that matches one of the traits (a vow, a humiliation, a change of heart). Do not use for passing moods.`,

  check: ({ gameData, sourceCharacter }) => {
    return { canExecute: !!sourceCharacter.wh3 && traitsOf(gameData).length > 0 && !!gameData.characters.get(gameData.playerID) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const trait = traitsOf(gameData).find((t) => t.key === args.trait);
    if (!trait) {
      return { message: { en: `Failed: unknown trait ${args.trait}`, zh: `失败：未知特质 ${args.trait}` }, sentiment: "negative" };
    }
    const who = args.who === "player" ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!who || !who.wh3) {
      return { message: { en: "Failed: character not found", zh: "失败：找不到角色" }, sentiment: "negative" };
    }
    if (Array.isArray(who.wh3.character.traits) && who.wh3.character.traits.includes(trait.key)) {
      return { message: { en: `${who.shortName} already has the trait ${trait.name}`, zh: `${who.shortName}已经拥有特质「${trait.name}」` }, sentiment: "neutral" };
    }
    if (dryRun) {
      return { message: { en: `${who.shortName} will gain the trait ${trait.name}`, zh: `${who.shortName}将获得特质「${trait.name}」` }, sentiment: "neutral" };
    }

    runGameEffect({ op: "add_trait", cqi: who.id, trait: trait.key });

    who.wh3.character.traits = (who.wh3.character.traits || []).concat([trait.key]);
    who.traits = (who.traits || []).concat([{ category: "trait", name: trait.name, desc: "" }]);

    return { message: { en: `${who.shortName} gained the trait ${trait.name}`, zh: `${who.shortName}获得了特质「${trait.name}」` }, sentiment: "neutral" };
  },
};
