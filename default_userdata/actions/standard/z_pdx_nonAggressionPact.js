/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// HOI4: the speaker's country and the player's sign a non-aggression pact.
// Effects are command objects; the app checks every field and compiles them for the active game.

const ctx = (gameData, npc) => {
  const info = gameData.pdx;
  const pc = info ? info.playerCountry : null;
  const nc = npc && npc.pdx ? npc.pdx.country : null;
  const rel = npc && npc.pdx && npc.pdx.relation ? npc.pdx.relation : null;
  const ops = info ? info.ops : [];
  const content = (info && info.content) || {};
  // only a foreign head of state can commit their country (not a general, not the player's own people)
  return { info, pc, nc, rel, ops, content, game: gameData.game, foreign: !!(pc && nc && pc.tag !== nc.tag && npc.isRuler) };
};

module.exports = {
  signature: "pdxNonAggressionPact",
  games: ["hoi4"],
  title: { en: "Non-Aggression Pact", zh: "互不侵犯条约" },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} clearly agrees, for their country, to a non-aggression pact with ${gameData.playerName}'s country now.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && ops.includes("nap") && rel && !rel.atWar && !(rel.facts && rel.facts.non_aggression_pact)) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} and ${pc.name} will sign a non-aggression pact`, zh: `${nc.name}与${pc.name}将签订互不侵犯条约` }, sentiment: "positive" };
    runGameEffect({ op: "nap", a: nc.tag, b: pc.tag });
    if (rel) rel.facts = { ...(rel.facts || {}), non_aggression_pact: "yes" };
    return { message: { en: `${nc.name} and ${pc.name} signed a non-aggression pact`, zh: `${nc.name}与${pc.name}签订了互不侵犯条约` }, sentiment: "positive" };
  },
};
