/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: the AI character detaches one unit from their army to the player's army.

const MAX_UNITS = 20;

const armyOf = (c) => (c && c.wh3 && c.wh3.character.army) || null;

module.exports = {
  signature: "givesUnitToPlayer",
  title: {
    en: "Gives a Unit to the Player",
    zh: "赠予玩家一支部队"
  },

  args: ({ sourceCharacter }) => {
    const army = armyOf(sourceCharacter);
    const units = army ? army.units : [];
    return [
      {
        name: "unit",
        type: "enum",
        description: `Unit key of the unit ${sourceCharacter.shortName} sends. Their army: ${units.map((u) => `${u.key} = ${u.name} x${u.count}`).join("; ")}`,
        required: true,
        options: units.map((u) => u.key)
      }
    ];
  },

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} agrees to send one unit of their army to fight under ${gameData.playerName} (reinforcements, a gift, part of a deal). The unit leaves their army.`,

  check: ({ gameData, sourceCharacter }) => {
    const player = gameData.characters.get(gameData.playerID);
    const mine = armyOf(sourceCharacter);
    const theirs = armyOf(player);
    return {
      canExecute: !!mine && mine.units.length > 0 && !!theirs && theirs.unitCount < MAX_UNITS
    };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const player = gameData.characters.get(gameData.playerID);
    const mine = armyOf(sourceCharacter);
    const theirs = armyOf(player);
    if (!mine || !theirs) {
      return { message: { en: "Failed: both characters must lead an army", zh: "失败：双方都必须率领军队" }, sentiment: "negative" };
    }
    if (theirs.unitCount >= MAX_UNITS) {
      return { message: { en: `Failed: ${player.shortName}'s army is full`, zh: `失败：${player.shortName}的军队已满` }, sentiment: "negative" };
    }
    const unit = mine.units.find((u) => u.key === args.unit);
    if (!unit) {
      return { message: { en: `Failed: ${sourceCharacter.shortName} has no unit ${args.unit}`, zh: `失败：${sourceCharacter.shortName}没有部队 ${args.unit}` }, sentiment: "negative" };
    }
    if (dryRun) {
      return { message: { en: `${sourceCharacter.shortName} will send ${unit.name} to ${player.shortName}`, zh: `${sourceCharacter.shortName}将把${unit.name}派给${player.shortName}` }, sentiment: "positive" };
    }

    runGameEffect({ op: "give_unit", fromCqi: sourceCharacter.id, toCqi: player.id, unit: unit.key });

    unit.count -= 1;
    if (unit.count <= 0) mine.units = mine.units.filter((u) => u !== unit);
    mine.unitCount -= 1;
    const existing = theirs.units.find((u) => u.key === unit.key);
    if (existing) existing.count += 1;
    else theirs.units.push({ key: unit.key, name: unit.name, count: 1, strength: unit.strength });
    theirs.unitCount += 1;

    return { message: { en: `${sourceCharacter.shortName} sent ${unit.name} to ${player.shortName}`, zh: `${sourceCharacter.shortName}把${unit.name}派给了${player.shortName}` }, sentiment: "positive" };
  },
};
