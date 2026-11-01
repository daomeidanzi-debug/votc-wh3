/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// HOI4: the speaker's country is peacefully united with the player's (annexed with its troops).
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
  signature: "pdxJoinsPlayerCountry",
  games: ["hoi4"],
  title: { en: "Unites with the Player's Country", zh: "并入玩家国家" },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName}, as head of state, unmistakably agrees to dissolve their country into ${gameData.playerName}'s (a union or a surrender of sovereignty). Almost never happens: only for a subject, a defeated or a desperate country.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && ops.includes("annex") && rel && !rel.atWar && (rel.subject || (typeof rel.opinion === "number" && rel.opinion >= 50))) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} will become part of ${pc.name}`, zh: `${nc.name}将并入${pc.name}` }, sentiment: "positive" };
    runGameEffect({ op: "annex", absorber: pc.tag, absorbed: nc.tag });
    return { message: { en: `${nc.name} became part of ${pc.name}`, zh: `${nc.name}并入了${pc.name}` }, sentiment: "positive" };
  },
};
