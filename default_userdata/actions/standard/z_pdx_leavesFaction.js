/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// HOI4: the speaker's country leaves its faction (talked into it, or breaking with the player).
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
  signature: "pdxLeavesFaction",
  games: ["hoi4"],
  title: { en: "Leaves Its Faction", zh: "退出阵营" },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName} clearly decides, for their country, to leave its faction now (persuaded to abandon its allies, or breaking with ${gameData.playerName}).`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && ops.includes("leave_faction") && nc.facts && nc.facts.faction) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} will leave its faction`, zh: `${nc.name}将退出所在阵营` }, sentiment: "neutral" };
    runGameEffect({ op: "leave_faction", tag: nc.tag });
    delete nc.facts.faction;
    if (rel) rel.allied = false;
    return { message: { en: `${nc.name} left its faction`, zh: `${nc.name}退出了所在阵营` }, sentiment: "neutral" };
  },
};
