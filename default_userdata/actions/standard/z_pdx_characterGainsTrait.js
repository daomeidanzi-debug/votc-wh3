/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Victoria 3 / EU5: the character the player talks to gains a personality trait (after an
// experience in the conversation that plausibly changes them). Acts on the character the
// player chose "Talk (VOTC)" on in game.

const TRAITS = {
  vic3: ["ambitious", "arrogant", "bigoted", "brave", "cautious", "charismatic", "compliant", "cruel", "direct", "hedonist",
    "honorable", "imperious", "imposing", "innovative", "meticulous", "persistent", "pious", "reckless", "reserved",
    "romantic", "ruthless", "tactful", "wrathful", "aesthete"],
  eu5: ["righteous", "cruel", "tolerant", "kind_hearted", "free_thinker", "well_connected", "worldly", "calm", "careful",
    "secretive", "benevolent", "zealot", "pious", "lawgiver", "incorruptible", "scholar", "entrepreneur", "industrious",
    "expansionist", "charismatic_negotiator", "silver_tongue", "conqueror", "strict", "inspiring_leader",
    "fierce_negotiator", "embezzler", "drunkard", "sinner", "greedy", "naive", "craven", "loose_lips", "malevolent"],
};

// the personality traits of the running game with its mods; the list above if unknown
const traitsOf = (gameData) => {
  const list = gameData.pdx && gameData.pdx.content && gameData.pdx.content.traits;
  return list && list.length ? list : TRAITS[gameData.game] || [];
};

const canTarget = (gameData) => {
  const info = gameData.pdx;
  return !!(info && info.talkerInGame && info.ops.includes("char_trait") && traitsOf(gameData).length);
};

module.exports = {
  signature: "pdxCharacterGainsTrait",
  games: ["vic3", "eu5"],
  title: { en: "Gains a Trait", zh: "获得特质" },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "trait",
      type: "enum",
      description: `The personality trait ${sourceCharacter.shortName} gains.`,
      required: true,
      options: traitsOf(gameData).length ? traitsOf(gameData) : ["none"]
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when something in the conversation clearly and lastingly changes ${sourceCharacter.shortName}'s character (a conversion, a humiliation, an inspiring vow, a corrupting bargain), so that they now have that trait. Not for passing moods.`,

  check: ({ gameData, sourceCharacter }) => {
    const p = sourceCharacter.pdx && sourceCharacter.pdx.person;
    return { canExecute: canTarget(gameData) && !!p };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const list = traitsOf(gameData);
    const trait = String(args.trait || "");
    if (!list.includes(trait)) return { message: { en: `Failed: unknown trait ${trait}`, zh: `失败：未知特质 ${trait}` }, sentiment: "negative" };
    const p = sourceCharacter.pdx.person;
    const word = trait.replace(/_/g, " ");
    if (p.traits.includes(trait)) return { message: { en: `${sourceCharacter.shortName} is already ${word}`, zh: `${sourceCharacter.shortName}已经有特质：${word}` }, sentiment: "neutral" };
    if (dryRun) return { message: { en: `${sourceCharacter.shortName} will become ${word}`, zh: `${sourceCharacter.shortName}将获得特质：${word}` }, sentiment: "neutral" };
    runGameEffect({ op: "char_trait", trait });
    p.traits.push(trait);
    return { message: { en: `${sourceCharacter.shortName} became ${word}`, zh: `${sourceCharacter.shortName}获得了特质：${word}` }, sentiment: "neutral" };
  },
};
