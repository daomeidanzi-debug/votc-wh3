// Paradox games example exchange: one short diplomatic greeting from a head of state.
// Returns an array of chat messages.

/**@typedef {import('../../../../gamedata_typedefs').GameData} GameData */
/**@param {GameData} gameData */
module.exports = (gameData, id) => {
    const ai = gameData.characters.get(id || gameData.aiID);
    const player = gameData.characters.get(gameData.playerID);
    if (!ai || !player || !ai.pdx) return [];
    const r = ai.pdx.relation;
    const line = r && r.atWar
        ? `*does not offer a hand* So ${player.pdx ? player.pdx.country.name : "your country"} wants to talk while our soldiers die. Say what you came to say, ${player.shortName}, and say it plainly.`
        : `*rises to greet you* ${player.shortName}. ${ai.pdx.country.name} is always ready to hear a proposal - provided it serves our people as well as yours.`;
    return [
        { role: "user", name: player.shortName, content: "Thank you for receiving me." },
        { role: "assistant", name: ai.shortName, content: line },
    ];
};
