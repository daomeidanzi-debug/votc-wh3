/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Victoria 3 / EU5: the speaker's country declares the player's its rival.
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
  signature: "pdxRivalry",
  games: ["vic3", "eu5"],
  title: { en: "Declares Rivalry", zh: "宣布为对手" },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName}, for their country, openly declares ${gameData.playerName}'s country its rival in the conversation.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && rel && (ops.includes("rivalry") || ops.includes("rival"))) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} will name ${pc.name} its rival`, zh: `${nc.name}将把${pc.name}列为对手` }, sentiment: "negative" };
    runGameEffect(game === "vic3" ? { op: "rivalry", a: nc.tag, b: pc.tag } : { op: "rival", a: nc.tag, b: pc.tag });
    return { message: { en: `${nc.name} named ${pc.name} its rival`, zh: `${nc.name}把${pc.name}列为了对手` }, sentiment: "negative" };
  },
};
