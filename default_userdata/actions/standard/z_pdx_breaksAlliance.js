/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// EU5: the speaker's country breaks its alliance with the player's.
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
  signature: "pdxBreaksAlliance",
  games: ["eu5"],
  title: { en: "Breaks the Alliance", zh: "解除同盟" },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName}, for their country, unmistakably ends the alliance with ${gameData.playerName}'s country in the conversation.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && ops.includes("break_alliance") && rel && rel.allied) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} will end its alliance with ${pc.name}`, zh: `${nc.name}将解除与${pc.name}的同盟` }, sentiment: "negative" };
    runGameEffect({ op: "break_alliance", a: nc.tag, b: pc.tag });
    rel.allied = false;
    return { message: { en: `${nc.name} ended its alliance with ${pc.name}`, zh: `${nc.name}解除了与${pc.name}的同盟` }, sentiment: "negative" };
  },
};
