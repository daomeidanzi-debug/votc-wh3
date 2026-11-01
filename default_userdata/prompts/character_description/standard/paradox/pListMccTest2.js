// Paradox games (HOI4, Victoria 3, EU5, Stellaris) persona builder.
// Exports a function (gameData, currentCharacterId?) => string
//
// What each person knows: their own country in full; another country only through its
// public face (the app already strips the player's internal figures for foreign partners).

/**@typedef {import('../../../../gamedata_typedefs').GameData} GameData */
/**@param {GameData} gameData */
module.exports = (gameData, currentCharacterId) => {
    const current = gameData.characters.get(currentCharacterId || gameData.aiID);
    if (!current) return "";
    const info = gameData.pdx;

    let output = "";
    output += `[${current.shortName}'s Persona: ${buildItems(current, gameData).join("; ")}]\n`;
    output += buildLore(current);
    gameData.characters.forEach((char) => {
        if (char.id !== current.id) {
            output += `[${char.shortName}'s Persona: ${buildItems(char, gameData).join("; ")}]\n`;
            output += buildLore(char);
        }
    });

    if (info && info.knownPeople && info.knownPeople.length && current.pdx) {
        output += `[Other people of ${current.pdx.country.name} that ${current.shortName} knows: ${info.knownPeople.join("; ")}]\n`;
    }
    if (info && info.world && info.world.length) {
        output += `[The world as everyone knows it: ${info.world.join(" | ")}]\n`;
    }
    output += `[Setting: ${gameData.gameName}, ${gameData.gameSetting}; date(${gameData.date}); scene(${gameData.scene})`;
    if (gameData.location) output += `; place of the meeting(${gameData.location})`;
    output += `]`;
    if (info && info.snapshotAgeMinutes > 60) {
        output += `\n[Note: the figures above are from the game's last report, ${info.snapshotAgeMinutes} minutes of real time ago; small details may have changed.]`;
    }
    return output;
};

// Longest piece of lore put into the prompt per character
const MAX_LORE_CHARS = 2000;

function clip(text) {
    return text.length > MAX_LORE_CHARS ? text.slice(0, MAX_LORE_CHARS) + "…" : text;
}

function buildLore(char) {
    const p = char.pdx;
    if (!p) return "";
    let out = "";
    if (p.person && p.person.description) out += `[${char.shortName} as the game describes them: ${clip(p.person.description)}]\n`;
    if (p.backstory) out += `[${char.shortName}'s backstory (written by the player; this is true and overrides other lore): ${clip(p.backstory)}]\n`;
    if (p.countryModLore) out += `[History of ${p.country.name} in this world (from the mod's own scenario): ${clip(p.countryModLore)}]\n`;
    if (p.factionBackstory) out += `[Lore of ${p.country.name} (written by the player): ${clip(p.factionBackstory)}]\n`;
    return out;
}

function label(gameData, key) {
    const labels = (gameData.pdx && gameData.pdx.factLabels) || {};
    return labels[key] || key.replace(/_/g, " ");
}

function words(key) {
    return key.replace(/^trait_/, "").replace(/_/g, " ");
}

const PERSON_LABELS = { spouse: "spouse", children: "children", father: "father", mother: "mother", interest_group: "interest group" };

function personItems(person) {
    const items = [];
    if (person.age) items.push(`age(${person.age})`);
    items.push(person.female ? "woman" : "man");
    if (person.traits && person.traits.length) items.push(`traits(${person.traits.map(words).join(", ")})`);
    if (person.location) items.push(`currently at(${person.location})`);
    for (const [key, value] of Object.entries(person.facts || {})) {
        items.push(`${PERSON_LABELS[key] || key.replace(/_/g, " ")}(${value})`);
    }
    return items;
}

function buildItems(char, gameData) {
    const p = char.pdx;
    const items = [`id(${char.id})`, `name(${char.fullName})`];
    if (!p) {
        items.push(char.primaryTitle);
        return items;
    }
    const c = p.country;
    const word = (gameData.pdx && gameData.pdx.countryWord) || "country";
    const person = p.person;
    if (person && !person.ruler) {
        items.push(`role(${person.title ? `${person.title} of ${c.name}` : `a notable of ${c.name}`}, not its head)`);
        if (c.leader) items.push(`head of ${c.name}(${c.leader})`);
    } else {
        items.push(`role(${c.leaderTitle ? `${c.leaderTitle} of ${c.name}` : `leader of ${c.name}`})`);
    }
    if (person) items.push(...personItems(person));
    if (c.government) items.push(`government of ${c.name}(${c.government})`);
    if (c.capital) items.push(`capital(${c.capital})`);
    for (const [key, value] of Object.entries(c.facts || {})) {
        items.push(`${label(gameData, key)}(${value})`);
    }
    if (p.isPlayer) {
        items.push(gameData.pdx && gameData.pdx.sameCountry
            ? `the player, head of the ${word} you serve`
            : `the player, leader of the player's ${word} (you only know what is public about it)`);
        return items;
    }
    const r = p.relation;
    if (r) {
        const rel = [];
        if (r.atWar) rel.push("AT WAR with the player");
        if (r.allied) rel.push("allied with the player");
        if (r.subject) rel.push("subject of the player");
        if (r.overlord) rel.push("overlord of the player");
        if (r.truce) rel.push("truce with the player");
        for (const [key, value] of Object.entries(r.facts || {})) rel.push(`${label(gameData, key)}: ${value}`);
        if (rel.length === 0) rel.push("no treaty with the player");
        items.push(`relations(${rel.join(", ")})`);
        if (r.opinion !== null && r.opinion !== undefined) items.push(`opinion of the player's ${word}(${r.opinion}, ${opinionWord(r.opinion)})`);
    }
    return items;
}

function opinionWord(n) {
    if (n > 60) return "very friendly";
    if (n > 20) return "friendly";
    if (n > -20) return "indifferent";
    if (n > -60) return "unfriendly";
    return "hostile";
}
