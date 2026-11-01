/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris) and Civilization VI: the player's country pays the speaker's country.
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

// What changes hands in each game: money where the game has a treasury, political power in
// HOI4, energy credits in Stellaris.
const PAYMENT = {
  hoi4: { op: "political_power", en: "political power", zh: "政治点数", max: 300 },
  vic3: { op: "money", en: "pounds", zh: "英镑", max: 10000000 },
  eu5: { op: "money", en: "ducats", zh: "杜卡特", max: 100000 },
  stellaris: { op: "resource", en: "energy credits", zh: "能量币", max: 100000 },
  civ6: { op: "money", en: "gold", zh: "金币", max: 20000 },
};
const payment = (game) => PAYMENT[game] || null;
const paymentCommand = (game, from, to, amount) => {
  const p = payment(game);
  return p.op === "resource" ? { op: "resource", from, to, amount, resource: "energy" } : { op: p.op, from, to, amount };
};

module.exports = {
  signature: "pdxPlayerPays",
  games: ["hoi4", "vic3", "eu5", "stellaris", "civ6"],
  title: { en: "The Player Pays", zh: "玩家付款" },
  isDestructive: true,

  args: ({ gameData }) => {
    const p = payment(gameData.game);
    return [
      {
        name: "amount",
        type: "number",
        description: `How much ${p ? p.en : "money"} ${gameData.playerName}'s country hands over now.`,
        required: true,
        min: 1,
        max: p ? p.max : 1
      }
    ];
  },

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${gameData.playerName} explicitly offers and hands over payment to ${sourceCharacter.shortName} now, and ${sourceCharacter.shortName} accepts it.`,

  check: ({ gameData, sourceCharacter }) => {
    const { ops, foreign, game } = ctx(gameData, sourceCharacter);
    const p = payment(game);
    return { canExecute: foreign && !!p && ops.includes(p.op) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, game } = ctx(gameData, sourceCharacter);
    const p = payment(game);
    const amount = Math.round(Number(args.amount));
    if (!(amount >= 1)) return { message: { en: "Failed: invalid amount", zh: "失败：数额无效" }, sentiment: "negative" };
    if (dryRun) return { message: { en: `${pc.name} will pay ${amount} ${p.en} to ${nc.name}`, zh: `${pc.name}将向${nc.name}支付 ${amount} ${p.zh}` }, sentiment: "neutral" };
    runGameEffect(paymentCommand(game, pc.tag, nc.tag, amount));
    return { message: { en: `${pc.name} paid ${amount} ${p.en} to ${nc.name}`, zh: `${pc.name}向${nc.name}支付了 ${amount} ${p.zh}` }, sentiment: "neutral" };
  },
};
