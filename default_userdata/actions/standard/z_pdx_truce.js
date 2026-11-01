/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris): the two countries agree on a truce (EU5).
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
  signature: "pdxTruce",
  games: ["hoi4", "vic3", "eu5", "stellaris"],
  title: { en: "Truce", zh: "停战协定" },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} and ${gameData.playerName} clearly agree that their countries will not attack each other for a while.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && ops.includes("truce") && !!rel && !rel.truce && !rel.atWar };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pc, nc, rel } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} and ${pc.name} will agree on a truce`, zh: `${nc.name}将与${pc.name}达成停战协定` }, sentiment: "positive" };
    runGameEffect({ op: "truce", a: nc.tag, b: pc.tag });
    rel.truce = true;
    return { message: { en: `${nc.name} and ${pc.name} agreed on a truce`, zh: `${nc.name}与${pc.name}达成了停战协定` }, sentiment: "positive" };
  },
};
