/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// HOI4: an ideology gains or loses support in the speaker's country (persuaded, funded, scared).
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

// the ideologies of the running game and its mods (TNO has dozens)
const ideologiesOf = (content) => (content.ideologies && content.ideologies.length ? content.ideologies : ["democratic", "communism", "fascism", "neutrality"]);

module.exports = {
  signature: "pdxIdeologyPopularity",
  games: ["hoi4"],
  title: { en: "Ideology Gains Support", zh: "意识形态支持度变化" },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "ideology",
      type: "enum",
      description: `Which ideology changes in ${sourceCharacter.shortName}'s country.`,
      required: true,
      options: ideologiesOf(ctx(gameData, sourceCharacter).content)
    },
    {
      name: "amount",
      type: "number",
      description: "Change of its support in percentage points (-20 to 20; 5 is a noticeable shift).",
      required: true,
      min: -20,
      max: 20
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when ${sourceCharacter.shortName} clearly agrees to promote or suppress an ideology in their country because of the conversation (funding, propaganda, a crackdown, a change of heart).`,

  check: ({ gameData, sourceCharacter }) => {
    const { rel, ops, foreign, content, nc, game } = ctx(gameData, sourceCharacter);
    return { canExecute: !!(foreign && ops.includes("popularity")) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel, content, game } = ctx(gameData, sourceCharacter);
    const ideology = ideologiesOf(content).includes(args.ideology) ? args.ideology : null;
    const amount = Math.round(Number(args.amount));
    if (!ideology || !(amount >= -20 && amount <= 20) || amount === 0) return { message: { en: "Failed: invalid ideology or amount", zh: "失败：意识形态或数值无效" }, sentiment: "negative" };
    if (dryRun) return { message: { en: `${ideology} support in ${nc.name} will change by ${amount}%`, zh: `${nc.name}的${ideology}支持度将变化 ${amount}%` }, sentiment: "neutral" };
    runGameEffect({ op: "popularity", tag: nc.tag, ideology, amount });
    return { message: { en: `${ideology} support in ${nc.name} changed by ${amount}%`, zh: `${nc.name}的${ideology}支持度变化了 ${amount}%` }, sentiment: "neutral" };
  },
};
