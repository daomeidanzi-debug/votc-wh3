/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris) and Civilization VI: the two countries end their war (HOI4: white peace).
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
  signature: "pdxMakePeace",
  games: ["hoi4", "vic3", "eu5", "stellaris", "civ6"],
  title: { en: "Peace Is Made", zh: "议和" },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName} and ${gameData.playerName} clearly agree to end their war now (a white peace).`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && ops.includes("peace") && !!rel && rel.atWar };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pc, nc, rel } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} and ${pc.name} will make peace`, zh: `${nc.name}将与${pc.name}议和` }, sentiment: "positive" };
    runGameEffect({ op: "peace", a: nc.tag, b: pc.tag });
    rel.atWar = false;
    sourceCharacter.relationsToPlayer = (sourceCharacter.relationsToPlayer || []).filter((r) => !/at war/i.test(r));
    return { message: { en: `${nc.name} and ${pc.name} made peace`, zh: `${nc.name}与${pc.name}达成和平` }, sentiment: "positive" };
  },
};
