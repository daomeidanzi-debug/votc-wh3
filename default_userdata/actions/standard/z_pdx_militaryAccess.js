/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris): the speaker's country lets the player's troops pass (HOI4).
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
  signature: "pdxMilitaryAccess",
  games: ["hoi4", "vic3", "eu5", "stellaris"],
  title: { en: "Grants Military Access", zh: "给予军事通行权" },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} clearly agrees to let ${gameData.playerName}'s armies move through their country.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && ops.includes("military_access") && !!rel && !rel.atWar };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pc, nc } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} will grant military access to ${pc.name}`, zh: `${nc.name}将给予${pc.name}军事通行权` }, sentiment: "positive" };
    runGameEffect({ op: "military_access", a: nc.tag, b: pc.tag });
    return { message: { en: `${nc.name} granted military access to ${pc.name}`, zh: `${nc.name}给予了${pc.name}军事通行权` }, sentiment: "positive" };
  },
};
