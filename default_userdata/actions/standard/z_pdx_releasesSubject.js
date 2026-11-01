/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// HOI4: the player sets the speaker's country (a puppet of the player) free.
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
  signature: "pdxReleasesSubject",
  games: ["hoi4"],
  title: { en: "Player Grants Independence", zh: "玩家给予独立" },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${gameData.playerName} clearly agrees to give ${sourceCharacter.shortName}'s country, a subject of theirs, full independence now.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && ops.includes("release") && rel && rel.subject) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${pc.name} will release ${nc.name}`, zh: `${pc.name}将给予${nc.name}独立` }, sentiment: "neutral" };
    runGameEffect({ op: "release", master: pc.tag, subject: nc.tag });
    rel.subject = false;
    return { message: { en: `${nc.name} is independent of ${pc.name}`, zh: `${nc.name}脱离${pc.name}独立了` }, sentiment: "neutral" };
  },
};
