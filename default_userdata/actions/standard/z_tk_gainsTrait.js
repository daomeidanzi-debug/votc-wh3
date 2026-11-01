/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Three Kingdoms: a character gains a personality trait because of what happened in the conversation.
// Keys must stay in sync with ALLOWED_TRAITS in tk_mod/script/campaign/mod/votc_3k.lua.

const TRAITS = {
  "3k_main_ceo_trait_personality_brave": { en: "Brave", zh: "勇敢", when: "was emboldened, resolved to face any foe" },
  "3k_main_ceo_trait_personality_cowardly": { en: "Cowardly", zh: "怯懦", when: "was terrified or lost their nerve" },
  "3k_main_ceo_trait_personality_honourable": { en: "Honourable", zh: "守信", when: "swore to keep faith and act with honour" },
  "3k_main_ceo_trait_personality_deceitful": { en: "Deceitful", zh: "狡诈", when: "learned that lies and schemes serve better than honesty" },
  "3k_main_ceo_trait_personality_cruel": { en: "Cruel", zh: "残暴", when: "hardened their heart and turned to cruelty" },
  "3k_main_ceo_trait_personality_kind": { en: "Kind", zh: "仁慈", when: "was moved to mercy and benevolence" },
  "3k_main_ceo_trait_personality_ambitious": { en: "Ambitious", zh: "野心勃勃", when: "was stirred to seek greater power" },
  "3k_main_ceo_trait_personality_humble": { en: "Humble", zh: "谦逊", when: "was humbled and gave up pride" },
  "3k_main_ceo_trait_personality_loyal": { en: "Loyal", zh: "忠诚", when: "pledged unshakeable loyalty to their lord" },
  "3k_main_ceo_trait_personality_disloyal": { en: "Disloyal", zh: "不忠", when: "began to doubt their lord and think of betrayal" },
  "3k_main_ceo_trait_personality_greedy": { en: "Greedy", zh: "贪婪", when: "was tempted by wealth" },
  "3k_main_ceo_trait_personality_charitable": { en: "Charitable", zh: "慷慨", when: "resolved to share their wealth with the people" },
  "3k_main_ceo_trait_personality_cautious": { en: "Cautious", zh: "谨慎", when: "learned to weigh every risk" },
  "3k_main_ceo_trait_personality_fiery": { en: "Fiery", zh: "暴躁", when: "was provoked into lasting anger" },
  "3k_main_ceo_trait_personality_cunning": { en: "Cunning", zh: "机智", when: "grasped the art of stratagem" },
  "3k_main_ceo_trait_personality_pacifist": { en: "Pacifist", zh: "厌战", when: "was sickened by war and bloodshed" },
};

module.exports = {
  signature: "tkGainsTrait",
  games: ["tk"],
  title: {
    en: "Gains a Trait",
    zh: "获得特质"
  },

  args: ({ gameData, sourceCharacter }) => [
    {
      name: "who",
      type: "enum",
      description: `Who gains the trait: "npc" = ${sourceCharacter.shortName}, "player" = ${gameData.playerName}.`,
      required: true,
      options: ["npc", "player"]
    },
    {
      name: "trait",
      type: "enum",
      description: `The trait gained. ${Object.entries(TRAITS).map(([k, t]) => `${k} = ${t.en} (when the character ${t.when})`).join("; ")}`,
      required: true,
      options: Object.keys(TRAITS)
    }
  ],

  description: ({ gameData, sourceCharacter }) =>
    `Execute rarely, only when the conversation leaves a lasting mark on ${sourceCharacter.shortName} or ${gameData.playerName} that matches one of the traits (a blessing, a curse, a humiliation, a change of heart). Do not use for passing moods.`,

  check: ({ gameData, sourceCharacter }) => {
    return { canExecute: !!sourceCharacter.wh3 && !!gameData.characters.get(gameData.playerID) };
  },

  run: ({ gameData, sourceCharacter, runGameEffect, args, dryRun, lang }) => {
    const trait = TRAITS[args.trait];
    if (!trait) {
      return { message: { en: `Failed: unknown trait ${args.trait}`, zh: `失败：未知特质 ${args.trait}` }, sentiment: "negative" };
    }
    const who = args.who === "player" ? gameData.characters.get(gameData.playerID) : sourceCharacter;
    if (!who) {
      return { message: { en: "Failed: character not found", zh: "失败：找不到角色" }, sentiment: "negative" };
    }
    const name = lang === "zh" ? trait.zh : trait.en;
    if (who.wh3 && Array.isArray(who.wh3.character.traits) && who.wh3.character.traits.includes(args.trait)) {
      return { message: { en: `${who.shortName} already has the trait ${trait.en}`, zh: `${who.shortName}已经拥有特质「${trait.zh}」` }, sentiment: "neutral" };
    }
    if (dryRun) {
      return { message: { en: `${who.shortName} will gain the trait ${trait.en}`, zh: `${who.shortName}将获得特质「${trait.zh}」` }, sentiment: "neutral" };
    }

    runGameEffect({ op: "add_trait", cqi: who.id, trait: args.trait });

    if (who.wh3) who.wh3.character.traits = (who.wh3.character.traits || []).concat([args.trait]);
    who.traits = (who.traits || []).concat([{ category: "trait", name, desc: trait.when }]);

    return { message: { en: `${who.shortName} gained the trait ${trait.en}`, zh: `${who.shortName}获得了特质「${trait.zh}」` }, sentiment: "neutral" };
  },
};
