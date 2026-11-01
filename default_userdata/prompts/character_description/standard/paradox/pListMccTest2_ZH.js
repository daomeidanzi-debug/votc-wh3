// Paradox 游戏（钢铁雄心4、维多利亚3、欧陆风云5、群星）角色信息构建（中文）
// Exports a function (gameData, currentCharacterId?) => string
//
// 每个人知道什么：自己的国家全部知道；别国只知道公开的情况（程序已经去掉了玩家国家对外人不公开的数据）。

/**@typedef {import('../../../../gamedata_typedefs').GameData} GameData */
/**@param {GameData} gameData */
module.exports = (gameData, currentCharacterId) => {
    const current = gameData.characters.get(currentCharacterId || gameData.aiID);
    if (!current) return "";
    const info = gameData.pdx;

    let output = "";
    output += `[${current.shortName}的人物设定：${buildItems(current, gameData).join("；")}]\n`;
    output += buildLore(current);
    gameData.characters.forEach((char) => {
        if (char.id !== current.id) {
            output += `[${char.shortName}的人物设定：${buildItems(char, gameData).join("；")}]\n`;
            output += buildLore(char);
        }
    });

    if (info && info.knownPeople && info.knownPeople.length && current.pdx) {
        output += `[${current.shortName}认识的${current.pdx.country.name}其他人物：${info.knownPeople.join("；")}]\n`;
    }
    if (info && info.world && info.world.length) {
        output += `[人人皆知的天下大势：${info.world.join(" | ")}]\n`;
    }
    output += `[背景：《${gameData.gameName}》战役（${gameData.gameSetting}）；日期（${gameData.date}）；场景（${gameData.scene}）`;
    if (gameData.location) output += `；会面地点（${gameData.location}）`;
    output += `]`;
    if (info && info.snapshotAgeMinutes > 60) {
        output += `\n[注意：以上数据来自游戏 ${info.snapshotAgeMinutes} 分钟前（现实时间）的报告，细节可能已有变化。]`;
    }
    return output;
};

const MAX_LORE_CHARS = 2000;

function clip(text) {
    return text.length > MAX_LORE_CHARS ? text.slice(0, MAX_LORE_CHARS) + "…" : text;
}

function buildLore(char) {
    const p = char.pdx;
    if (!p) return "";
    let out = "";
    if (p.person && p.person.description) out += `[游戏对${char.shortName}的介绍：${clip(p.person.description)}]\n`;
    if (p.backstory) out += `[${char.shortName}的背景故事（玩家撰写，内容为真，优先于其他设定）：${clip(p.backstory)}]\n`;
    if (p.countryModLore) out += `[${p.country.name}在这个世界里的历史（来自模组自己的剧本）：${clip(p.countryModLore)}]\n`;
    if (p.factionBackstory) out += `[${p.country.name}的背景（玩家撰写）：${clip(p.factionBackstory)}]\n`;
    return out;
}

function label(gameData, key) {
    const labels = (gameData.pdx && gameData.pdx.factLabels) || {};
    return labels[key] || key.replace(/_/g, " ");
}

function words(key) {
    return key.replace(/^trait_/, "").replace(/_/g, " ");
}

const PERSON_LABELS = {
    spouse: "配偶", children: "子女", father: "父亲", mother: "母亲", ideology: "意识形态", interest_group: "利益集团",
    culture: "文化", religion: "宗教", popularity: "声望", status: "状态", nickname: "绰号", species: "种族",
    adm_ability: "行政能力", dip_ability: "外交能力", mil_ability: "军事能力", command_skill: "指挥能力",
};

function personItems(person) {
    const items = [];
    if (person.age) items.push(`年龄（${person.age}）`);
    items.push(person.female ? "女性" : "男性");
    if (person.traits && person.traits.length) items.push(`特质（${person.traits.map(words).join("，")}）`);
    if (person.location) items.push(`现在所在（${person.location}）`);
    for (const [key, value] of Object.entries(person.facts || {})) {
        items.push(`${PERSON_LABELS[key] || key.replace(/_/g, " ")}（${value}）`);
    }
    return items;
}

function buildItems(char, gameData) {
    const p = char.pdx;
    const items = [`编号（${char.id}）`, `姓名（${char.fullName}）`];
    if (!p) {
        items.push(char.primaryTitle);
        return items;
    }
    const c = p.country;
    const word = gameData.pdx && gameData.pdx.countryWord === "empire" ? "帝国" : "国家";
    const person = p.person;
    if (person && !person.ruler) {
        items.push(`身份（${person.title ? `${c.name}的${person.title}` : `${c.name}的知名人物`}，不是该国元首）`);
        if (c.leader) items.push(`${c.name}的元首（${c.leader}）`);
    } else {
        items.push(`身份（${c.leaderTitle ? `${c.name}的${c.leaderTitle}` : `${c.name}的领导人`}）`);
    }
    if (person) items.push(...personItems(person));
    if (c.government) items.push(`${c.name}的政体（${c.government}）`);
    if (c.capital) items.push(`首都（${c.capital}）`);
    for (const [key, value] of Object.entries(c.facts || {})) {
        items.push(`${label(gameData, key)}（${value}）`);
    }
    if (p.isPlayer) {
        items.push(gameData.pdx && gameData.pdx.sameCountry
            ? `玩家本人，你所效力的${word}的元首`
            : `玩家本人，玩家${word}的领导人（你只知道该${word}公开的情况）`);
        return items;
    }
    const r = p.relation;
    if (r) {
        const rel = [];
        if (r.atWar) rel.push("与玩家处于战争状态");
        if (r.allied) rel.push("与玩家结盟");
        if (r.subject) rel.push("是玩家的附庸");
        if (r.overlord) rel.push("是玩家的宗主");
        if (r.truce) rel.push("与玩家处于停战期");
        for (const [key, value] of Object.entries(r.facts || {})) rel.push(`${label(gameData, key)}：${value}`);
        if (rel.length === 0) rel.push("与玩家没有条约");
        items.push(`关系（${rel.join("，")}）`);
        if (r.opinion !== null && r.opinion !== undefined) items.push(`对玩家${word}的看法（${r.opinion}，${opinionWord(r.opinion)}）`);
    }
    return items;
}

function opinionWord(n) {
    if (n > 60) return "非常友好";
    if (n > 20) return "友好";
    if (n > -20) return "冷淡";
    if (n > -60) return "不友好";
    return "敌对";
}
