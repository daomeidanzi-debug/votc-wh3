/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: the player's faction pays gold to the AI character's faction.

const ctx = (gameData, npc) => {
  const player = gameData.characters.get(gameData.playerID);
  const pf = player && player.wh3 ? player.wh3.faction : null;
  const nf = npc && npc.wh3 ? npc.wh3.faction : null;
  return { player, pf, nf, foreign: !!(pf && nf && pf.key !== nf.key) };
};

module.exports = {
  signature: "playerPaysGold",
  title: {
    en: "Player Pays Gold",
    zh: "玩家支付金币"
  },
  isDestructive: true,

  args: ({ gameData }) => {
    const player = gameData.characters.get(gameData.playerID);
    const gold = player ? Math.floor(player.gold) : 0;
    return [
      {
        name: "amount",
        type: "number",
        description: `How much gold ${gameData.playerName}'s faction pays. Their treasury holds ${gold} gold.`,
        required: true,
        min: 1,
        max: Math.max(1, gold),
        step: 1
      }
    ];
  },

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${gameData.playerName} explicitly agrees to pay gold to ${sourceCharacter.shortName} (a bribe, tribute or purchase) in the conversation. Never execute on a mere demand.`,

  check: ({ gameData, sourceCharacter }) => {
    const { player, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && !!player && player.gold >= 1 };
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
    if (amount > player.gold) {
      return { message: { en: `Failed: ${pf.name} only has ${player.gold} gold`, zh: `失败：${pf.name}只有 ${player.gold} 金币` }, sentiment: "negative" };
    }
    if (dryRun) {
      return { message: { en: `${pf.name} will pay ${amount} gold to ${nf.name}`, zh: `${pf.name}将向${nf.name}支付 ${amount} 金币` }, sentiment: "neutral" };
    }

    runGameEffect({ op: "transfer_gold", from: pf.key, to: nf.key, amount });

    player.gold -= amount;
    pf.treasury -= amount;
    sourceCharacter.gold += amount;
    nf.treasury += amount;

    return {
      message: { en: `${pf.name} paid ${amount} gold to ${nf.name}`, zh: `${pf.name}向${nf.name}支付了 ${amount} 金币` },
      sentiment: "neutral"
    };
  },
};
