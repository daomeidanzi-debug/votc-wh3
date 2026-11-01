/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Victoria 3: the speaker's country owes the player's a favour (an obligation).
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
  signature: "pdxOwesFavor",
  games: ["vic3"],
  title: { en: "Owes the Player a Favour", zh: "欠玩家一个人情" },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} clearly acknowledges, for their country, a debt of gratitude to ${gameData.playerName}'s country and promises to repay it.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && ops.includes("obligation") && rel && !rel.atWar) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} will owe ${pc.name} a favour`, zh: `${nc.name}将欠${pc.name}一个人情` }, sentiment: "positive" };
    runGameEffect({ op: "obligation", debtor: nc.tag, creditor: pc.tag });
    return { message: { en: `${nc.name} owes ${pc.name} a favour`, zh: `${nc.name}欠了${pc.name}一个人情` }, sentiment: "positive" };
  },
};
