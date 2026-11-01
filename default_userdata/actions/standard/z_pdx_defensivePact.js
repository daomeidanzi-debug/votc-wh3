/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris): the two countries sign a defensive pact (Victoria 3).
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
  signature: "pdxDefensivePact",
  games: ["hoi4", "vic3", "eu5", "stellaris"],
  title: { en: "Defensive Pact", zh: "防御条约" },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} and ${gameData.playerName} clearly agree to defend each other if attacked.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, game } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && game === "vic3" && ops.includes("treaty") && !!rel && !rel.atWar && !rel.allied };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pc, nc } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} and ${pc.name} will sign a defensive pact`, zh: `${nc.name}将与${pc.name}签订防御条约` }, sentiment: "positive" };
    runGameEffect({ op: "treaty", a: nc.tag, b: pc.tag, article: "defensive_pact", years: 10 });
    return { message: { en: `${nc.name} and ${pc.name} signed a defensive pact`, zh: `${nc.name}与${pc.name}签订了防御条约` }, sentiment: "positive" };
  },
};
