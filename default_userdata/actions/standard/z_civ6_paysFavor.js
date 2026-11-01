/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Civilization VI: the speaker's civilization gives the player diplomatic favour.
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
  signature: "civ6PaysFavor",
  games: ["civ6"],
  title: { en: "Gives Diplomatic Favour", zh: "给予外交支持" },

  args: ({ sourceCharacter }) => [{
    name: "amount",
    type: "number",
    description: `How much diplomatic favour ${sourceCharacter.shortName}'s civilization gives (1-200).`,
    required: true,
    min: 1,
    max: 200
  }],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} clearly agrees to back ${gameData.playerName} in the World Congress or hand over diplomatic favour now.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && ops.includes("favor") && nc.facts && nc.facts.kind !== "city-state") };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    const amount = Math.round(Number(args.amount));
    if (!(amount >= 1 && amount <= 200)) return { message: { en: "Failed: invalid amount", zh: "失败：数值无效" }, sentiment: "negative" };
    if (dryRun) return { message: { en: `${nc.name} will give ${amount} diplomatic favour to ${pc.name}`, zh: `${nc.name}将给予${pc.name} ${amount} 点外交支持` }, sentiment: "positive" };
    runGameEffect({ op: "favor", from: nc.tag, to: pc.tag, amount });
    return { message: { en: `${nc.name} gave ${amount} diplomatic favour to ${pc.name}`, zh: `${nc.name}给予了${pc.name} ${amount} 点外交支持` }, sentiment: "positive" };
  },
};
