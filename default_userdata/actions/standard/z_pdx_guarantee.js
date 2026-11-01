/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris): one country guarantees the independence of the other (HOI4, Victoria 3).
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

const guaranteeCommand = (game, a, b) =>
  game === "vic3" ? { op: "treaty", a, b, article: "guarantee_independence", years: 10 } : { op: "guarantee", a, b };

module.exports = {
  signature: "pdxGuarantee",
  games: ["hoi4", "vic3", "eu5", "stellaris"],
  title: { en: "Guarantees Independence", zh: "保证独立" },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "guarantor",
      type: "enum",
      description: `Who gives the guarantee: "npc" = ${sourceCharacter.shortName}'s country protects the player's, "player" = ${gameData.playerName}'s country protects theirs.`,
      required: true,
      options: ["npc", "player"]
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} and ${gameData.playerName} clearly agree that one country will defend the other's independence.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && (ops.includes("guarantee") || ops.includes("treaty")) && !!rel && !rel.atWar };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, game } = ctx(gameData, sourceCharacter);
    const giver = args.guarantor === "player" ? pc : nc;
    const taker = args.guarantor === "player" ? nc : pc;
    if (dryRun) return { message: { en: `${giver.name} will guarantee the independence of ${taker.name}`, zh: `${giver.name}将保证${taker.name}的独立` }, sentiment: "positive" };
    runGameEffect(guaranteeCommand(game, giver.tag, taker.tag));
    return { message: { en: `${giver.name} guaranteed the independence of ${taker.name}`, zh: `${giver.name}保证了${taker.name}的独立` }, sentiment: "positive" };
  },
};
