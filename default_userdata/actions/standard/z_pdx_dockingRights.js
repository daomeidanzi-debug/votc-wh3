/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// HOI4: the speaker's country lets the player's fleets use its ports.
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
  signature: "pdxDockingRights",
  games: ["hoi4"],
  title: { en: "Grants Docking Rights", zh: "给予停靠权" },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} clearly agrees to let ${gameData.playerName}'s navy use their country's ports now.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && ops.includes("docking_rights") && rel && !rel.atWar) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} will open its ports to ${pc.name}`, zh: `${nc.name}将向${pc.name}开放港口` }, sentiment: "positive" };
    runGameEffect({ op: "docking_rights", a: nc.tag, b: pc.tag });
    return { message: { en: `${nc.name} opened its ports to ${pc.name}'s navy`, zh: `${nc.name}向${pc.name}的海军开放了港口` }, sentiment: "positive" };
  },
};
