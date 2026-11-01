/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris) and Civilization VI: the speaker's country and the player's country go to war.
// Effects are command objects; the app checks every field and compiles them for the active game.

const ctx = (gameData, npc) => {
  const info = gameData.pdx;
  const pc = info ? info.playerCountry : null;
  const nc = npc && npc.pdx ? npc.pdx.country : null;
  const rel = npc && npc.pdx && npc.pdx.relation ? npc.pdx.relation : null;
  const ops = info ? info.ops : [];
  // only a foreign head of state can commit their country (not a general, not the player's own people)
  return { info, pc, nc, rel, ops, game: gameData.game, foreign: !!(pc && nc && pc.tag !== nc.tag && npc.isRuler) };
};

module.exports = {
  signature: "pdxDeclareWar",
  games: ["hoi4", "vic3", "eu5", "stellaris", "civ6"],
  title: { en: "War Is Declared", zh: "宣战" },
  isDestructive: true,

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "attacker",
      type: "enum",
      description: `Who declares the war: "npc" = ${sourceCharacter.shortName}'s country, "player" = ${gameData.playerName}'s country.`,
      required: true,
      options: ["npc", "player"]
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName} or ${gameData.playerName} unmistakably declares war in the conversation, as a decision of their country (not a threat, bluff or hypothetical).`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && ops.includes("war") && !!rel && !rel.atWar };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, foreign } = ctx(gameData, sourceCharacter);
    if (!foreign) return { message: { en: "Failed: both speak for the same country", zh: "失败：双方属于同一国家" }, sentiment: "negative" };
    if (rel.atWar) return { message: { en: `${nc.name} and ${pc.name} are already at war`, zh: `${nc.name}与${pc.name}已经处于战争状态` }, sentiment: "neutral" };
    const attacker = args.attacker === "player" ? pc : nc;
    const defender = args.attacker === "player" ? nc : pc;
    if (dryRun) return { message: { en: `${attacker.name} will declare war on ${defender.name}`, zh: `${attacker.name}将向${defender.name}宣战` }, sentiment: "negative" };
    runGameEffect({ op: "war", a: attacker.tag, b: defender.tag });
    rel.atWar = true;
    rel.allied = false;
    sourceCharacter.relationsToPlayer = (sourceCharacter.relationsToPlayer || []).filter((r) => !/allied/i.test(r)).concat(["At war with the player"]);
    return { message: { en: `${attacker.name} declared war on ${defender.name}!`, zh: `${attacker.name}向${defender.name}宣战了！` }, sentiment: "negative" };
  },
};
