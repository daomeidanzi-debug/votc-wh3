/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// HOI4 / EU5: the speaker's country sends manpower (volunteers, levies) to the player's country.

const ctx = (gameData, npc) => {
  const info = gameData.pdx;
  const pc = info ? info.playerCountry : null;
  const nc = npc && npc.pdx ? npc.pdx.country : null;
  const ops = info ? info.ops : [];
  // only a foreign head of state can commit their country (not a general, not the player's own people)
  return { pc, nc, ops, foreign: !!(pc && nc && pc.tag !== nc.tag && npc.isRuler) };
};

const LIMITS = { hoi4: { min: 1000, max: 500000 }, eu5: { min: 100, max: 100000 } };

module.exports = {
  signature: "pdxSendsManpower",
  games: ["hoi4", "eu5"],
  title: { en: "Sends Manpower", zh: "派遣兵员" },

  args: ({ gameData, sourceCharacter }) => {
    const l = LIMITS[gameData.game] || { min: 1, max: 1 };
    return [{
      name: "amount",
      type: "number",
      description: `How many men ${sourceCharacter.shortName}'s country sends (${l.min}-${l.max}).`,
      required: true,
      min: l.min,
      max: l.max
    }];
  },

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} agrees to send volunteers or levies to ${gameData.playerName}'s country now, clearly agreed in the conversation.`,

  check: ({ gameData, sourceCharacter }) => {
    const { ops, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && ops.includes("manpower") && !!LIMITS[gameData.game] };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc } = ctx(gameData, sourceCharacter);
    const l = LIMITS[gameData.game];
    const amount = Math.round(Number(args.amount));
    if (!(amount >= l.min && amount <= l.max)) return { message: { en: "Failed: invalid amount", zh: "失败：数量无效" }, sentiment: "negative" };
    if (dryRun) return { message: { en: `${nc.name} will send ${amount} men to ${pc.name}`, zh: `${nc.name}将向${pc.name}派遣 ${amount} 名兵员` }, sentiment: "positive" };
    runGameEffect({ op: "manpower", from: nc.tag, to: pc.tag, amount });
    return { message: { en: `${nc.name} sent ${amount} men to ${pc.name}`, zh: `${nc.name}向${pc.name}派遣了 ${amount} 名兵员` }, sentiment: "positive" };
  },
};
