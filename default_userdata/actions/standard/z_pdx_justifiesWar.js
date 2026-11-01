/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// HOI4 / EU5: the speaker's country prepares a war against the player (a war goal / casus belli).
// Effects are command objects; the app checks every field and compiles them for the active game.

const ctx = (gameData, npc) => {
  const info = gameData.pdx;
  const pc = info ? info.playerCountry : null;
  const nc = npc && npc.pdx ? npc.pdx.country : null;
  const rel = npc && npc.pdx && npc.pdx.relation ? npc.pdx.relation : null;
  const ops = info ? info.ops : [];
  const content = (info && info.content) || {};
  // only a foreign head of state can commit their country (not a general, not the player's own people)
  return { info, pc, nc, rel, ops, content, game: gameData.game, foreign: !!(pc && nc && pc.tag !== nc.tag && npc.isRuler) };
};

// HOI4 war goal types of the running game and its mods (TNO, Kaiserreich... bring their own)
const wargoalsOf = (content) => (content.wargoals && content.wargoals.length ? content.wargoals : ["annex_everything", "take_state", "topple_government", "puppet_wargoal_focus"]);

module.exports = {
  signature: "pdxJustifiesWar",
  games: ["hoi4", "eu5"],
  title: { en: "Prepares War on the Player", zh: "准备对玩家开战" },
  isDestructive: true,

  args: ({ gameData, sourceCharacter }) => (gameData.game === "hoi4" ? [{
    name: "type",
    type: "enum",
    description: `What ${sourceCharacter.shortName}'s country means to take from ${gameData.playerName}'s.`,
    required: true,
    options: wargoalsOf(ctx(gameData, sourceCharacter).content)
  }] : []),

  description: ({ gameData, sourceCharacter }) =>
    `Execute only when ${sourceCharacter.shortName} unmistakably decides, for their country, to prepare war against ${gameData.playerName}'s country (a grievance they mean to settle by force). Not for a bluff or a passing threat.`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && rel && !rel.atWar && (ops.includes("wargoal") || ops.includes("casus_belli"))) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    const type = wargoalsOf(content).includes(args.type) ? args.type : wargoalsOf(content)[0];
    if (dryRun) return { message: { en: `${nc.name} will prepare war against ${pc.name}`, zh: `${nc.name}将准备对${pc.name}开战` }, sentiment: "negative" };
    runGameEffect(game === "hoi4" ? { op: "wargoal", a: nc.tag, b: pc.tag, type } : { op: "casus_belli", a: nc.tag, b: pc.tag });
    return { message: { en: `${nc.name} is preparing war against ${pc.name}`, zh: `${nc.name}开始准备对${pc.name}开战` }, sentiment: "negative" };
  },
};
