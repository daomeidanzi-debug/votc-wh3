// Paradox 游戏示例对话：国家领导人的一句外交寒暄（中文）
// Returns an array of chat messages.

/**@typedef {import('../../../../gamedata_typedefs').GameData} GameData */
/**@param {GameData} gameData */
module.exports = (gameData, id) => {
    const ai = gameData.characters.get(id || gameData.aiID);
    const player = gameData.characters.get(gameData.playerID);
    if (!ai || !player || !ai.pdx) return [];
    const r = ai.pdx.relation;
    const line = r && r.atWar
        ? `*没有伸手* 我们的士兵还在前线流血，${player.shortName}却想谈谈。有话就直说吧。`
        : `*起身相迎* ${player.shortName}，欢迎。${ai.pdx.country.name}向来愿意听取提议——只要它对我们的人民同样有利。`;
    return [
        { role: "user", name: player.shortName, content: "感谢您的接见。" },
        { role: "assistant", name: ai.shortName, content: line },
    ];
};
