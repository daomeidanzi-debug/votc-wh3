/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Paradox games (HOI4, Victoria 3, EU5, Stellaris): the two countries think better or worse of each other after the conversation.
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

module.exports = {
  signature: "pdxChangeOpinion",
  games: ["hoi4", "vic3", "eu5", "stellaris"],
  title: { en: "Relations Change", zh: "关系变化" },

  args: ({ sourceCharacter }) => [
    {
      name: "amount",
      type: "number",
      description: `How much relations between ${sourceCharacter.shortName}'s country and the player's country change: -50 (deep insult, betrayal) .. 50 (great gesture of friendship). Do not use this action for small talk.`,
      required: true,
      min: -50,
      max: 50
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute when the conversation clearly leaves ${sourceCharacter.shortName} with a better or worse view of ${gameData.playerName}'s country (praise, gifts, promises kept, insults, threats). At most once per conversation.`,

  check: ({ gameData, sourceCharacter }) => {
    const { ops, foreign } = ctx(gameData, sourceCharacter);
    return { canExecute: foreign && ops.includes("opinion") };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun }) => {
    const { pc, nc, rel } = ctx(gameData, sourceCharacter);
    const amount = Math.round(Number(args.amount) || 0);
    if (!amount) return { message: { en: "Relations unchanged", zh: "关系未变化" }, sentiment: "neutral" };
    const better = amount > 0;
    const sentiment = better ? "positive" : "negative";
    if (dryRun) return { message: { en: `Relations between ${nc.name} and ${pc.name} will ${better ? "improve" : "worsen"}`, zh: `${nc.name}与${pc.name}的关系将${better ? "改善" : "恶化"}` }, sentiment };
    runGameEffect({ op: "opinion", a: nc.tag, b: pc.tag, amount });
    if (rel && rel.opinion !== null) rel.opinion = Math.max(-100, Math.min(100, rel.opinion + amount));
    sourceCharacter.opinionOfPlayer = Math.max(-100, Math.min(100, (sourceCharacter.opinionOfPlayer || 0) + amount));
    return { message: { en: `Relations between ${nc.name} and ${pc.name} ${better ? "improved" : "worsened"} (${amount > 0 ? "+" : ""}${amount})`, zh: `${nc.name}与${pc.name}的关系${better ? "改善" : "恶化"}了（${amount > 0 ? "+" : ""}${amount}）` }, sentiment };
  },
};
