// 三国示例对话：以汉末的礼数打一声招呼（中文）
// Returns an array of chat messages.

/**@typedef {import('../../../../gamedata_typedefs').GameData} GameData */
/**@param {GameData} gameData */
module.exports = (gameData, id) => {
    const ai = gameData.characters.get(id || gameData.aiID);
    const player = gameData.characters.get(gameData.playerID);
    if (!ai || !player || !ai.wh3) return [];
    const own = gameData.wh3 && gameData.wh3.sameFaction;
    const line = own
        ? `*抱拳躬身* 主公。末将在此听候差遣，但有吩咐，万死不辞。`
        : `*拱手还礼，神色从容* ${player.shortName}大人。如今天下大乱，群雄并起，各家都在掂量谁是友、谁是敌。不知大人此来，是友是敌？`;
    return [
        { role: "user", name: player.shortName, content: "幸会。" },
        { role: "assistant", name: ai.shortName, content: line },
    ];
};
