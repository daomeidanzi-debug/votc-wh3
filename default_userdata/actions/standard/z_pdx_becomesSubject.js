/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris): the speaker's country submits to the player (HOI4: puppet, EU5: fiefdom).
// Effects are command objects; the app checks every field and compiles them for the active game.

const ctx = (gameData, npc) => {
  const info = gameData.pdx;
  const pc = info ? info.playerCountry : null;
  const nc = npc && npc.pdx ? npc.pdx.country : null;
  const rel = npc && npc.pdx && npc.pdx.relation ? npc.pdx.relation : null;
  const ops = info ? info.ops : [];
  // only a foreign head of state can commit their country (not a general, not the player's own people)
  return { info, pc, nc, rel, ops, game: gameData.game, foreign: !!(pc && nc && pc.tag !== nc.tag && npc.isRuler) };
};

// HOI4: puppet; Victoria 3: protectorate; EU5: fiefdom; Stellaris: subject
const subjectCommand = (game, master, subject) => {
  if (game === "hoi4") return { op: "puppet", master, subject };
  if (game === "vic3") return { op: "subject", master, subject, type: "protectorate" };
  if (game === "stellaris") return { op: "subject", master, subject };
  return { op: "subject", master, subject, type: "fiefdom" };
};

module.exports = {
  signature: "pdxBecomesSubject",
  games: ["hoi4", "vic3", "eu5", "stellaris"],
  title: { en: "Submits to the Player", zh: "臣服于玩家" },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName}, as ruler of their country, clearly agrees in the conversation to become the subject of ${gameData.playerName}'s country. Rulers rarely give up independence: only after defeat, desperate need or overwhelming persuasion.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && (ops.includes("puppet") || ops.includes("subject")) && !!rel && !rel.subject && !rel.overlord };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pc, nc, rel, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} will become a subject of ${pc.name}`, zh: `${nc.name}将成为${pc.name}的附庸` }, sentiment: "positive" };
    runGameEffect(subjectCommand(game, pc.tag, nc.tag));
    rel.subject = true;
    rel.atWar = false;
    return { message: { en: `${nc.name} became a subject of ${pc.name}`, zh: `${nc.name}成为了${pc.name}的附庸` }, sentiment: "positive" };
  },
};
