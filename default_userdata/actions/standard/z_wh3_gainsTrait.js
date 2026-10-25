/** @import { GameData, Character } from '../../gamedata_typedefs.js' */
// Warhammer III: a character gains a trait because of what happened in the conversation.
// Keys must stay in sync with ALLOWED_TRAITS in wh3_mod/script/campaign/mod/votc_wh3.lua.

const TRAITS = {
  wh2_main_trait_fighter: { en: "Courageous", zh: "勇敢", when: "was emboldened, inspired to fight bravely" },
  wh2_main_trait_pacifist: { en: "Peacemaker", zh: "和平使者", when: "was persuaded that peace and negotiation are better than war" },
  wh2_main_trait_wins: { en: "Renowned", zh: "声名远扬", when: "earned great renown or praise" },
  wh2_main_trait_defeats: { en: "Dishonoured", zh: "蒙羞", when: "was publicly humiliated or shamed" },
  wh2_main_trait_routed: { en: "Timid", zh: "胆怯", when: "was terrified or lost their nerve" },
  wh2_main_trait_lazy: { en: "Slothful", zh: "懒惰", when: "was talked into idleness or indulgence" },
  wh2_main_trait_public_order: { en: "Disciplinarian", zh: "铁腕", when: "resolved to rule with an iron fist" },
  wh2_main_trait_builder: { en: "Master Mason", zh: "建设者", when: "became devoted to building and fortifying" },
  wh2_main_trait_lone_wolf: { en: "Lone Wolf", zh: "独狼", when: "decided to trust no one and act alone" },
  wh2_main_trait_agent_target_fail: { en: "Providential", zh: "好运", when: "received a blessing or lucky charm" },
  wh2_main_trait_agent_target_success: { en: "Luckless", zh: "厄运", when: "was cursed" },
};

module.exports = {
  signature: "gainsTrait",
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
