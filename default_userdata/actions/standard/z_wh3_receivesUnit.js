/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: the player detaches one unit from their army to the AI character's army.

const MAX_UNITS = 20;

const armyOf = (c) => (c && c.wh3 && c.wh3.character.army) || null;

module.exports = {
  signature: "receivesUnitFromPlayer",
  title: {
    en: "Receives a Unit from the Player",
    zh: "接收玩家的部队"
  },
  isDestructive: true,

  args: ({ gameData }) => {
    const player = gameData.characters.get(gameData.playerID);
    const army = armyOf(player);
    const units = army ? army.units : [];
    return [
      {
        name: "unit",
        type: "enum",
        description: `Unit key of the unit ${gameData.playerName} sends. Their army: ${units.map((u) => `${u.key} = ${u.name} x${u.count}`).join("; ")}`,
        required: true,
        options: units.map((u) => u.key)
      }
    ];
  },

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${gameData.playerName} explicitly agrees to hand one specific unit of their own army over to ${sourceCharacter.shortName}. The unit leaves the player's army.`,

  check: ({ gameData, sourceCharacter }) => {
    const player = gameData.characters.get(gameData.playerID);
    const mine = armyOf(sourceCharacter);
    const theirs = armyOf(player);
    return {
      canExecute: !!mine && mine.unitCount < MAX_UNITS && !!theirs && theirs.units.length > 0
    };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const player = gameData.characters.get(gameData.playerID);
    const mine = armyOf(sourceCharacter);
    const theirs = armyOf(player);
    if (!mine || !theirs) {
      return { message: { en: "Failed: both characters must lead an army", zh: "失败：双方都必须率领军队" }, sentiment: "negative" };
    }
    if (mine.unitCount >= MAX_UNITS) {
      return { message: { en: `Failed: ${sourceCharacter.shortName}'s army is full`, zh: `失败：${sourceCharacter.shortName}的军队已满` }, sentiment: "negative" };
    }
    const unit = theirs.units.find((u) => u.key === args.unit);
    if (!unit) {
      return { message: { en: `Failed: ${player.shortName} has no unit ${args.unit}`, zh: `失败：${player.shortName}没有部队 ${args.unit}` }, sentiment: "negative" };
    }
    if (dryRun) {
      return { message: { en: `${player.shortName} will send ${unit.name} to ${sourceCharacter.shortName}`, zh: `${player.shortName}将把${unit.name}派给${sourceCharacter.shortName}` }, sentiment: "neutral" };
    }

    runGameEffect({ op: "give_unit", fromCqi: player.id, toCqi: sourceCharacter.id, unit: unit.key });

    unit.count -= 1;
    if (unit.count <= 0) theirs.units = theirs.units.filter((u) => u !== unit);
    theirs.unitCount -= 1;
    const existing = mine.units.find((u) => u.key === unit.key);
    if (existing) existing.count += 1;
    else mine.units.push({ key: unit.key, name: unit.name, count: 1, strength: unit.strength });
    mine.unitCount += 1;

    return { message: { en: `${player.shortName} sent ${unit.name} to ${sourceCharacter.shortName}`, zh: `${player.shortName}把${unit.name}派给了${sourceCharacter.shortName}` }, sentiment: "neutral" };
  },
};
