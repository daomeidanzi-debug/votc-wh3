/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Victoria 3: the speaker's country stops all trade with the player's.
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
  signature: "pdxEmbargo",
  games: ["vic3"],
  title: { en: "Imposes an Embargo", zh: "实施禁运" },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName}, for their country, decides to cut off all trade with ${gameData.playerName}'s country now.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && ops.includes("embargo") && rel) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} will embargo ${pc.name}`, zh: `${nc.name}将对${pc.name}实施禁运` }, sentiment: "negative" };
    runGameEffect({ op: "embargo", a: nc.tag, b: pc.tag });
    return { message: { en: `${nc.name} imposed an embargo on ${pc.name}`, zh: `${nc.name}对${pc.name}实施了禁运` }, sentiment: "negative" };
  },
};
