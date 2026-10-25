/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: trade agreement between the AI character's faction and the player's faction.

const ctx = (gameData, npc) => {
  const player = gameData.characters.get(gameData.playerID);
  const pf = player && player.wh3 ? player.wh3.faction : null;
  const nf = npc && npc.wh3 ? npc.wh3.faction : null;
  return { player, pf, nf, foreign: !!(pf && nf && pf.key !== nf.key) };
};

module.exports = {
  signature: "signsTradeAgreement",
  title: {
    en: "Signs a Trade Agreement",
    zh: "签订贸易协定"
  },

  args: [],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName}, as ruler of their faction, and ${gameData.playerName} agree to open trade between their factions.`,

  check: ({ gameData, sourceCharacter }) => {
    const { nf, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && !nf.atWarWithPlayer && !nf.tradingWithPlayer && sourceCharacter.isRuler };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, dryRun }) => {
    const { pf, nf, foreign } = ctx(gameData, sourceCharacter);
    if (!foreign) {
      return { message: { en: "Failed: the two characters belong to the same faction", zh: "失败：双方属于同一派系" }, sentiment: "negative" };
    }
    if (nf.atWarWithPlayer) {
      return { message: { en: "Failed: cannot trade while at war", zh: "失败：交战期间无法贸易" }, sentiment: "negative" };
    }
    if (dryRun) {
      return { message: { en: `${nf.name} will sign a trade agreement with ${pf.name}`, zh: `${nf.name}将与${pf.name}签订贸易协定` }, sentiment: "positive" };
    }

    runGameEffect({ op: "trade", a: nf.key, b: pf.key });

    nf.tradingWithPlayer = true;
    sourceCharacter.relationsToPlayer = (sourceCharacter.relationsToPlayer || []).concat(["Trading partner of the player"]);

    return { message: { en: `${nf.name} signed a trade agreement with ${pf.name}`, zh: `${nf.name}与${pf.name}签订了贸易协定` }, sentiment: "positive" };
  },
};
