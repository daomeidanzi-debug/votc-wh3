/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: the AI character's faction pays gold to the player's faction.

const ctx = (gameData, npc) => {
  const player = gameData.characters.get(gameData.playerID);
  const pf = player && player.wh3 ? player.wh3.faction : null;
  const nf = npc && npc.wh3 ? npc.wh3.faction : null;
  return { player, pf, nf, foreign: !!(pf && nf && pf.key !== nf.key) };
};

module.exports = {
  signature: "paysGoldToPlayer",
  title: {
    en: "Pays Gold to the Player",
    zh: "向玩家支付金币"
  },

  args: ({ sourceCharacter }) => [
    {
      name: "amount",
      type: "number",
      description: `How much gold ${sourceCharacter.shortName}'s faction pays. Their treasury holds ${sourceCharacter.gold} gold.`,
      required: true,
      min: 1,
      max: Math.max(1, Math.floor(sourceCharacter.gold)),
      step: 1
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} actually hands over gold to ${gameData.playerName} (tribute, bribe, payment, gift) and it is clear in the conversation that the payment happens now.`,

  check: ({ gameData, sourceCharacter }) => {
    const { foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && sourceCharacter.gold >= 1 };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { player, pf, nf, foreign } = ctx(gameData, sourceCharacter);
    if (!foreign || !player) {
      return { message: { en: "Failed: the two characters belong to the same faction", zh: "失败：双方属于同一派系" }, sentiment: "negative" };
    }
    const amount = Math.floor(Number(args.amount));
    if (!Number.isFinite(amount) || amount < 1) {
      return { message: { en: "Failed: invalid gold amount", zh: "失败：金币数量无效" }, sentiment: "negative" };
    }
    if (amount > sourceCharacter.gold) {
      return {
        message: {
          en: `Failed: ${nf.name} only has ${sourceCharacter.gold} gold`,
          zh: `失败：${nf.name}只有 ${sourceCharacter.gold} 金币`
        },
        sentiment: "negative"
      };
    }
    if (dryRun) {
      return { message: { en: `${nf.name} will pay ${amount} gold to ${pf.name}`, zh: `${nf.name}将向${pf.name}支付 ${amount} 金币` }, sentiment: "neutral" };
    }

    runGameEffect({ op: "transfer_gold", from: nf.key, to: pf.key, amount });

    sourceCharacter.gold -= amount;
    nf.treasury -= amount;
    player.gold += amount;
    pf.treasury += amount;

    return {
      message: { en: `${nf.name} paid ${amount} gold to ${pf.name}`, zh: `${nf.name}向${pf.name}支付了 ${amount} 金币` },
      sentiment: "positive"
    };
  },
};
