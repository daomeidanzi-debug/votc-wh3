/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// HOI4: the speaker's country enters one of the player's wars on the player's side.

const ctx = (gameData, npc) => {
  const info = gameData.pdx;
  const pc = info ? info.playerCountry : null;
  const nc = npc && npc.pdx ? npc.pdx.country : null;
  const rel = npc && npc.pdx && npc.pdx.relation ? npc.pdx.relation : null;
  const ops = info ? info.ops : [];
  const enemies = info && info.enemiesOfPlayer ? info.enemiesOfPlayer.filter((e) => !nc || e.tag !== nc.tag) : [];
  // only a foreign head of state can commit their country (not a general, not the player's own people)
  return { pc, nc, rel, ops, enemies, foreign: !!(pc && nc && pc.tag !== nc.tag && npc.isRuler) };
};

module.exports = {
  signature: "pdxJoinsWar",
  games: ["hoi4"],
  title: { en: "Joins the War", zh: "参战" },
  isDestructive: true,

  args: ({ gameData, sourceCharacter }) => {
    const { enemies } = ctx(gameData, sourceCharacter);
    return [{
      name: "enemy",
      type: "enum",
      description: `Which enemy of ${gameData.playerName}'s country ${sourceCharacter.shortName}'s country goes to war with: ${enemies.map((e) => `${e.tag} = ${e.name}`).join(", ")}.`,
      required: true,
      options: enemies.length ? enemies.map((e) => e.tag) : ["none"]
    }];
  },

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName} unmistakably commits their country to enter ${gameData.playerName}'s war on ${gameData.playerName}'s side, as a decision taken now.`,

  check: ({ gameData, sourceCharacter }) => {
    const { ops, foreign, enemies, rel } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && ops.includes("join_war") && enemies.length > 0 && !!rel && !rel.atWar };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, enemies } = ctx(gameData, sourceCharacter);
    const enemy = enemies.find((e) => e.tag === args.enemy);
    if (!enemy) return { message: { en: "Failed: that country is not at war with the player", zh: "失败：该国没有与玩家交战" }, sentiment: "negative" };
    if (dryRun) return { message: { en: `${nc.name} will join ${pc.name}'s war against ${enemy.name}`, zh: `${nc.name}将加入${pc.name}对${enemy.name}的战争` }, sentiment: "positive" };
    runGameEffect({ op: "join_war", country: nc.tag, ally: pc.tag, enemy: enemy.tag });
    return { message: { en: `${nc.name} joined ${pc.name}'s war against ${enemy.name}!`, zh: `${nc.name}加入了${pc.name}对${enemy.name}的战争！` }, sentiment: "positive" };
  },
};
