/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris) and Civilization VI: the two countries become allies (HOI4: same faction, Victoria 3: alliance treaty, EU5: alliance).
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

const allianceCommand = (game, a, b) => {
  if (game === "hoi4") return { op: "faction", a, b };
  if (game === "vic3") return { op: "treaty", a, b, article: "alliance", years: 10 };
  return { op: "alliance", a, b };
};
const canAlly = (ops) => ops.includes("faction") || ops.includes("alliance") || ops.includes("treaty");

module.exports = {
  signature: "pdxFormAlliance",
  games: ["hoi4", "vic3", "eu5", "stellaris", "civ6"],
  title: { en: "An Alliance Is Formed", zh: "结成同盟" },
  isDestructive: true,

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName} and ${gameData.playerName} clearly agree on a binding military alliance between their countries in this conversation.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && canAlly(ops) && !!rel && !rel.atWar && !rel.allied };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pc, nc, rel, game } = ctx(gameData, sourceCharacter);
    if (dryRun) return { message: { en: `${nc.name} and ${pc.name} will become allies`, zh: `${nc.name}将与${pc.name}结盟` }, sentiment: "positive" };
    runGameEffect(allianceCommand(game, nc.tag, pc.tag));
    rel.allied = true;
    sourceCharacter.relationsToPlayer = (sourceCharacter.relationsToPlayer || []).concat(["Allied with the player"]);
    return { message: { en: `${nc.name} and ${pc.name} are now allies`, zh: `${nc.name}与${pc.name}结成同盟` }, sentiment: "positive" };
  },
};
