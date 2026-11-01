// Three Kingdoms example exchange: one short greeting in the manner of the late Han.
// Returns an array of chat messages.

/**@typedef {import('../../../../gamedata_typedefs').GameData} GameData */
/**@param {GameData} gameData */
module.exports = (gameData, id) => {
    const ai = gameData.characters.get(id || gameData.aiID);
    const player = gameData.characters.get(gameData.playerID);
    if (!ai || !player || !ai.wh3) return [];
    const own = gameData.wh3 && gameData.wh3.sameFaction;
    const line = own
        ? `*cups fist in palm and bows* My lord ${player.shortName}. Your servant awaits your command - speak, and it shall be done.`
        : `*inclines head with measured courtesy* Lord ${player.shortName}. The realm is in turmoil and every warlord counts his friends and enemies. Which are you, I wonder?`;
    return [
        { role: "user", name: player.shortName, content: "Greetings." },
        { role: "assistant", name: ai.shortName, content: line },
    ];
};
