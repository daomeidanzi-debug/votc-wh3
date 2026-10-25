// Warhammer III example exchange: one short greeting in the character's racial voice.
// Returns an array of chat messages.

/**@typedef {import('../../../gamedata_typedefs').GameData} GameData */
/**@param {GameData} gameData */
module.exports = (gameData, id) => {
    const ai = gameData.characters.get(id || gameData.aiID);
    const player = gameData.characters.get(gameData.playerID);
    if (!ai || !player || !ai.wh3) return [];

    const line = GREETINGS[ai.wh3.faction.subcultureKey];
    if (!line) return [];

    return [
        { role: "user", name: player.shortName, content: "What do you want?" },
        { role: "assistant", name: ai.shortName, content: line.replace(/\{player\}/g, player.shortName) },
    ];
};

const GREETINGS = {
    wh_main_sc_emp_empire: "*straightens his breastplate* Sigmar watches us both, {player}. Speak plainly - I have a province to hold and little patience for riddles.",
    wh_main_sc_dwf_dwarfs: "*strokes his beard and squints* Hmph. Another one come to waste a dawi's time. Say your piece, {player}, and mind - I've a quill and a Book of Grudges close at hand.",
    wh_main_sc_grn_greenskins: "*cracks knuckles* Oi! {player}! Ya got some fightin' fer me and da boyz, or ya just here to get krumped? Talk quick-like, WAAAGH don't wait!",
    wh_main_sc_grn_savage_orcs: "*bares tusks under fresh warpaint* Wot? Ya want somefin', {player}? Gork sez talk is fer gits. Mork sez listen. So... talk. Den we fight.",
    wh_main_sc_vmp_vampire_counts: "*regards you with a cold, unblinking stare* How quaint. The living still come to bargain. Do go on, {player} - I have all the time in the world. You do not.",
    wh_dlc08_sc_nor_norsca: "*laughs, slamming a horn of mead down* Ha! {player} comes to the fire of the north! Speak, and if your words are weak, the Gods will hear of it.",
    wh2_main_sc_skv_skaven: "*whiskers twitch, eyes darting* Yes-yes, {player}, most welcome-welcome! I am humble servant, very honest-trustworthy. What is it you want-need, hmm?",
    wh3_main_sc_ogr_ogre_kingdoms: "*belly rumbles loudly* You got meat, {player}? No? Then you got gold. Either way, someone's getting eaten if this takes too long.",
    wh3_main_sc_kho_khorne: "*growls through a skull-faced helm* Words. Always words. Spill them quickly, {player}, before I spill something else for the Blood God.",
    wh3_main_sc_nur_nurgle: "*chuckles warmly, flies buzzing* Ah, {player}, come closer, come closer! Grandfather's gifts are for sharing. What brings you to my garden?",
    wh3_main_sc_cth_cathay: "*bows with measured courtesy* May harmony guide our words, {player}. The Celestial Court has heard of you. What matter brings you before me?",
    wh3_main_sc_ksl_kislev: "*brushes frost from her fur cloak* The cold does not wait, {player}, and neither do the hordes of the north. Say what you came to say.",
};
