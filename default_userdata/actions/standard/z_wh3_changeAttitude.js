/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: diplomatic attitude between the AI character's faction and the player's faction changes.

const ctx = (gameData, npc) => {
  const player = gameData.characters.get(gameData.playerID);
  const pf = player && player.wh3 ? player.wh3.faction : null;
  const nf = npc && npc.wh3 ? npc.wh3.faction : null;
  return { player, pf, nf, foreign: !!(pf && nf && pf.key !== nf.key) };
};

module.exports = {
  signature: "changeAttitudeTowardsPlayer",
  title: {
    en: "Diplomatic Attitude Changes",
    zh: "外交态度改变"
  },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "amount",
      type: "number",
      description: `Change of ${sourceCharacter.shortName}'s faction's attitude towards ${gameData.playerName}'s faction, from -6 (gravely insulted) to +6 (deeply impressed). Use -2..+2 for ordinary remarks; reserve large values for major gestures or insults.`,
      required: true,
      min: -6,
      max: 6,
      step: 1
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when what ${gameData.playerName} said or did noticeably pleased or offended ${sourceCharacter.shortName} as a ruler representing their faction. Current attitude: ${sourceCharacter.opinionOfPlayer}.`,

  check: ({ gameData, sourceCharacter }) => {
    const { foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pf, nf, foreign } = ctx(gameData, sourceCharacter);
    if (!foreign) {
      return { message: { en: "Failed: the two characters belong to the same faction", zh: "失败：双方属于同一派系" }, sentiment: "negative" };
    }
    const amount = Math.round(Number(args.amount));
    if (!Number.isFinite(amount) || amount < -6 || amount > 6) {
      return { message: { en: "Failed: attitude change must be between -6 and 6", zh: "失败：态度变化必须在 -6 到 6 之间" }, sentiment: "negative" };
    }
    if (amount === 0) {
      return;
    }
    const sign = amount > 0 ? `+${amount}` : `${amount}`;
    if (dryRun) {
      return { message: { en: `${nf.name}'s attitude towards ${pf.name} will change by ${sign}`, zh: `${nf.name}对${pf.name}的态度将变化 ${sign}` }, sentiment: amount > 0 ? "positive" : "negative" };
    }

    runGameEffect({ op: "attitude", a: pf.key, b: nf.key, amount });

    // The in-game attitude scale is roughly 5 points per bonus step
    sourceCharacter.opinionOfPlayer = Math.max(-100, Math.min(100, sourceCharacter.opinionOfPlayer + amount * 5));
    nf.attitudeToPlayer = sourceCharacter.opinionOfPlayer;

    return {
      message: { en: `${nf.name}'s attitude towards ${pf.name} changed by ${sign}`, zh: `${nf.name}对${pf.name}的态度变化 ${sign}` },
      sentiment: amount > 0 ? "positive" : "negative"
    };
  },
};
