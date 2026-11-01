/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Civilization VI: the speaker's civilization and the player's declare friendship.

const ctx = (gameData, npc) => {
  const info = gameData.pdx;
  const pc = info ? info.playerCountry : null;
  const nc = npc && npc.pdx ? npc.pdx.country : null;
  const rel = npc && npc.pdx && npc.pdx.relation ? npc.pdx.relation : null;
  const ops = info ? info.ops : [];
  // only the leader of a major civilization can declare friendship
  const major = !!(nc && nc.facts && nc.facts.kind !== "city-state");
  return { pc, nc, rel, ops, foreign: !!(pc && nc && pc.tag !== nc.tag && npc.isRuler && major) };
};

module.exports = {
  signature: "civ6DeclareFriendship",
  games: ["civ6"],
  title: { en: "Declares Friendship", zh: "宣布友谊" },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} and ${gameData.playerName} clearly agree to declare friendship between their civilizations now.`,

  check: ({ gameData, sourceCharacter }) => {
    const { ops, foreign, rel } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && ops.includes("friendship") && !!rel && !rel.atWar && !(rel.facts && /friend/i.test(rel.facts.diplomatic_state || "")) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pc, nc, rel } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} and ${pc.name} will declare friendship`, zh: `${nc.name}与${pc.name}将宣布友谊` }, sentiment: "positive" };
    runGameEffect({ op: "friendship", a: nc.tag, b: pc.tag });
    if (rel) rel.opinion = Math.max(rel.opinion || 0, 70);
    return { message: { en: `${nc.name} and ${pc.name} declared friendship`, zh: `${nc.name}与${pc.name}宣布了友谊` }, sentiment: "positive" };
  },
};
