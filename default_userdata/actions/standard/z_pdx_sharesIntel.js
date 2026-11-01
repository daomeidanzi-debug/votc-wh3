/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// EU5 / Stellaris: the speaker's country opens up to the player's (spies at court, shared intelligence).
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
  signature: "pdxSharesIntel",
  games: ["eu5", "stellaris"],
  title: { en: "Shares Intelligence", zh: "分享情报" },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} clearly agrees to share their country's secrets or intelligence with ${gameData.playerName}'s country now (an exchange of envoys, open archives, a spy network welcome).`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && rel && !rel.atWar && (ops.includes("spy_network") || ops.includes("intel"))) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} will share intelligence with ${pc.name}`, zh: `${nc.name}将与${pc.name}分享情报` }, sentiment: "positive" };
    runGameEffect(game === "eu5" ? { op: "spy_network", a: nc.tag, b: pc.tag, amount: 30 } : { op: "intel", a: nc.tag, b: pc.tag, amount: 30 });
    return { message: { en: `${nc.name} shared intelligence with ${pc.name}`, zh: `${nc.name}与${pc.name}分享了情报` }, sentiment: "positive" };
  },
};
