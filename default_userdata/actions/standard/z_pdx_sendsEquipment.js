/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris): the speaker's country ships equipment to the player (HOI4).
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

const EQUIPMENT = {
  infantry_equipment: { en: "infantry equipment", zh: "步兵装备" },
  support_equipment: { en: "support equipment", zh: "辅助装备" },
  artillery_equipment: { en: "artillery", zh: "火炮" },
  motorized_equipment: { en: "trucks", zh: "卡车" },
  anti_tank_equipment: { en: "anti-tank guns", zh: "反坦克炮" },
  anti_air_equipment: { en: "anti-air guns", zh: "防空炮" },
  mechanized_equipment: { en: "mechanized vehicles", zh: "机械化装备" },
  armored_car_equipment: { en: "armored cars", zh: "装甲车" },
  // aircraft archetypes (common/units/equipment/plane_airframes.txt)
  small_plane_airframe: { en: "fighters and light aircraft", zh: "战斗机等轻型飞机" },
  medium_plane_airframe: { en: "medium aircraft", zh: "中型飞机" },
  convoy: { en: "convoys", zh: "运输船" },
  train_equipment: { en: "trains", zh: "火车" },
};

// The equipment of the running game with its mods (TNO, Millennium Dawn... add their own);
// the list above names the common ones, others are shown by their key.
const equipmentOf = (gameData) => {
  const list = gameData.pdx && gameData.pdx.content && gameData.pdx.content.equipment;
  return list && list.length ? list : Object.keys(EQUIPMENT);
};
const label = (key) => EQUIPMENT[key] || { en: key.replace(/_/g, " "), zh: key.replace(/_/g, " ") };

module.exports = {
  signature: "pdxSendsEquipment",
  games: ["hoi4", "vic3", "eu5", "stellaris"],
  title: { en: "Sends Equipment", zh: "援助装备" },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "type",
      type: "enum",
      description: `What ${sourceCharacter.shortName}'s country sends: ${equipmentOf(gameData).map((k) => `${k} = ${label(k).en}`).join(", ")}.`,
      required: true,
      options: equipmentOf(gameData)
    },
    {
      name: "amount",
      type: "number",
      description: "How many pieces (a division needs about 1000 infantry equipment).",
      required: true,
      min: 1,
      max: 20000
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} clearly agrees to ship weapons or equipment to ${gameData.playerName} now (aid, lend-lease, a deal).`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && ops.includes("equipment") && !!rel && !rel.atWar };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc } = ctx(gameData, sourceCharacter);
    const item = equipmentOf(gameData).includes(args.type) ? label(args.type) : null;
    const amount = Math.round(Number(args.amount));
    if (!item || !(amount >= 1)) return { message: { en: "Failed: invalid equipment", zh: "失败：装备无效" }, sentiment: "negative" };
    if (dryRun) return { message: { en: `${nc.name} will send ${amount} ${item.en} to ${pc.name}`, zh: `${nc.name}将向${pc.name}送出 ${amount} ${item.zh}` }, sentiment: "positive" };
    runGameEffect({ op: "equipment", from: nc.tag, to: pc.tag, type: args.type, amount });
    return { message: { en: `${nc.name} sent ${amount} ${item.en} to ${pc.name}`, zh: `${nc.name}向${pc.name}送出了 ${amount} ${item.zh}` }, sentiment: "positive" };
  },
};
