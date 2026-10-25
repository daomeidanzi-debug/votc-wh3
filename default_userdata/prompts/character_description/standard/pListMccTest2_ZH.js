// 《全面战争：战锤3》角色信息构建（中文）
// Exports a function (gameData, currentCharacterId?) => string

/**@typedef {import('../../../gamedata_typedefs').GameData} GameData */
/**@param {GameData} gameData */
module.exports = (gameData, currentCharacterId) => {
    const current = gameData.characters.get(currentCharacterId || gameData.aiID);
    if (!current) return "";

    let output = "";
    output += `[${current.shortName}的角色信息：${buildCharacterItems(current, gameData).join("；")}]\n`;
    output += buildLore(current);
    gameData.characters.forEach((char) => {
        if (char.id !== current.id) {
            output += `[${char.shortName}的角色信息：${buildCharacterItems(char, gameData).join("；")}]\n`;
            output += buildLore(char);
        }
    });

    const info = gameData.wh3;
    const scene = [
        `时间（${gameData.date}）`,
        `场景（${sceneZh(gameData)}）`,
        gameData.location ? `地点（${gameData.location}${gameData.locationController ? `，归属${gameData.locationController}` : ""}）` : null,
    ].filter(Boolean);
    output += `[背景：《全面战争：战锤3》战役；${scene.join("；")}]`;
    if (info && !info.sameFaction) {
        output += `\n[${info.playerFaction.name}与${info.targetFaction.name}的外交关系：${describeRelation(info.targetFaction)}]`;
    }
    return output;
};

// 每个角色写进提示词的游戏背景最多这么多字
const MAX_LORE_CHARS = 2000;

function clip(text) {
    return text.length > MAX_LORE_CHARS ? text.slice(0, MAX_LORE_CHARS) + "…" : text;
}

// 玩家写的背景（以此为准），然后是游戏自带的人物经历和角色类型介绍
function buildLore(char) {
    const w = char.wh3;
    if (!w) return "";
    let out = "";
    if (w.backstory) out += `[${char.shortName}的背景故事（玩家设定，与其他资料冲突时以此为准）：${clip(w.backstory)}]\n`;
    if (w.character.biography) out += `[${char.shortName}的经历（游戏设定）：${clip(w.character.biography)}]\n`;
    if (w.character.typeDescription) out += `[${char.shortName}是什么样的角色（游戏设定）：${clip(w.character.typeDescription)}]\n`;
    if (w.factionBackstory) out += `[${w.faction.name}的背景（玩家设定）：${clip(w.factionBackstory)}]\n`;
    return out;
}

const TYPE_LABELS = {
    general: "领主",
    colonel: "队长",
    champion: "勇士（英雄）",
    wizard: "法师（英雄）",
    spy: "刺客/间谍（英雄）",
    dignitary: "使节（英雄）",
    engineer: "工程师（英雄）",
    runesmith: "符文铁匠（英雄）",
};

// 各种族的说话风格
const VOICES = {
    wh_main_sc_emp_empire: "帝国人，以西格玛之名起誓，重视职责、秩序和选帝侯政治",
    wh_main_sc_dwf_dwarfs: "脾气暴躁的矮人，记仇（会写进怨恨之书），不信任精灵，看重黄金、麦酒和古老誓言",
    wh_main_sc_grn_greenskins: "野蛮的兽人或地精，说粗鲁蹩脚的兽人腔（“WAAAGH！”“小子们”“人类崽子”“矮子”），只尊重力量和打架",
    wh_main_sc_grn_savage_orcs: "蛮荒兽人，说话更粗野，相信战纹和戈克与莫克，最爱打架",
    wh_main_sc_vmp_vampire_counts: "西尔瓦尼亚的不死贵族，冷漠、耐心、蔑视活人，以百年为单位思考",
    wh_main_sc_brt_bretonnia: "恪守骑士精神的巴托尼亚人，虔信湖中女神，看不起农民",
    wh_main_sc_chs_chaos: "追求黑暗诸神青睐的混沌勇士，咄咄逼人，蔑视软弱，开口闭口荣耀与终焉之时",
    wh_dlc08_sc_nor_norsca: "诺斯卡掠夺者，爱吹牛，崇拜黑暗诸神，热爱劫掠、巨兽和战斗荣耀",
    wh_dlc03_sc_bst_beastmen: "野兽人，仇恨文明，说话简短凶残，谈论兽石与毁灭",
    wh_dlc05_sc_wef_wood_elves: "阿瑟兰洛伦的森林精灵，高冷疏离，对闯入者极其危险",
    wh2_main_sc_hef_high_elves: "奥苏安的高等精灵，优雅而傲慢，视年轻种族为孩童，憎恨黑暗精灵",
    wh2_main_sc_def_dark_elves: "纳迦罗斯的黑暗精灵，狡诈残忍，把别人当成未来的奴隶，憎恨高等精灵",
    wh2_main_sc_lzd_lizardmen: "古圣伟大计划的冷漠仆从，谈论预言与秩序，对哺乳动物的小政治毫无兴趣",
    wh2_main_sc_skv_skaven: "阴险的鼠人，说话又快又谄媚，爱重复词语（“是-是”“快-快”“人类-东西”），总想背后捅刀，崇拜大角鼠",
    wh2_dlc09_sc_tmb_tomb_kings: "尼赫喀拉的古墓王，威严专横，谈论永恒、王朝和被盗的陪葬品",
    wh2_dlc11_sc_cst_vampire_coast: "吸血鬼海岸的亡灵海盗，满口航海黑话，贪恋财宝，爱表演",
    wh3_main_sc_ksl_kislev: "坚毅的基斯里夫人，严肃，忠于冰霜女王或祖国母亲，看重抵御北方蛮族的勇气",
    wh3_main_pro_sc_ksl_kislev: "坚毅的基斯里夫人，严肃，忠于祖国母亲",
    wh3_main_sc_cth_cathay: "震旦天朝的贵族，礼数周全，谈论和谐、天龙帝与长城",
    wh3_main_sc_ogr_ogre_kingdoms: "饥肠辘辘的食人魔，只关心吃肉和佣金，嗓门大说话直，以肚子大小衡量价值",
    wh3_main_sc_kho_khorne: "恐虐信徒，痴迷为血神献上鲜血与颅骨，蔑视魔法与懦弱（“血祭血神！”）",
    wh3_main_pro_sc_kho_khorne: "恐虐信徒，痴迷为血神献上鲜血与颅骨",
    wh3_main_sc_nur_nurgle: "慈祥的纳垢信徒，热情地谈论瘟疫、腐烂和衰败的恩赐",
    wh3_main_sc_sla_slaanesh: "色孽的仆从，迷恋放纵、完美与感官刺激，善于操纵和奉承",
    wh3_main_sc_tze_tzeentch: "奸奇的阴谋家，满口谜语，计中有计，乐于变化与欺骗",
    wh3_main_pro_sc_tze_tzeentch: "奸奇的阴谋家，满口谜语，计中有计",
    wh3_main_sc_dae_daemons: "混沌恶魔王子，傲慢，谈论混沌领域和黑暗诸神",
    wh3_dlc23_sc_chd_chaos_dwarfs: "残酷的混沌矮人，崇拜哈苏特，勤于工业，奴役他人，鄙视西方的同族",
    wh3_dlc29_sc_nag_undead_legions: "纳垣什的仆从，冷酷、古老而绝对，谈论大死灵法师的意志",
    wh_main_sc_teb_teb: "南方诸国（提利尔/埃斯塔利亚）的贵族，唯利是图，爱黄金和权谋",
};

function sceneZh(gameData) {
    const src = gameData.wh3 ? gameData.wh3.targetSource : "";
    if (src === "diplomacy") return "两派系之间的外交会晤";
    if (src === "settlement") return "关于一座定居点的会面";
    if (gameData.wh3 && gameData.wh3.sameFaction) return "与玩家麾下将领的私下议事";
    return "战役地图上的会谈";
}

function buildCharacterItems(char, gameData) {
    const w = char.wh3;
    const items = [];
    items.push(`编号（${char.id}）`);
    items.push(`姓名（${char.fullName}）`);
    if (!w) {
        items.push(char.primaryTitle);
        return items;
    }
    const c = w.character;
    const f = w.faction;
    const isPlayer = char.id === gameData.playerID;
    items.push(`身份（${c.isFactionLeader ? `${f.name}的派系领袖` : `${f.name}的${TYPE_LABELS[c.typeKey] || c.typeKey}`}）`);
    if (c.subtypeName) items.push(`类型（${c.subtypeName}）`);
    items.push(`种族（${f.subcultureName || f.cultureName}）`);
    if (VOICES[f.subcultureKey]) items.push(`说话风格（${VOICES[f.subcultureKey]}）`);
    items.push(`性别（${c.isMale ? "男" : "女"}）`);
    if (c.age > 0) items.push(`年龄（${c.age}）`);
    items.push(`等级（${c.rank}）`);
    if (c.battlesFought > 0 || c.battlesWon > 0) items.push(`战绩（胜 ${c.battlesWon}${c.battlesFought > 0 ? ` / 共 ${c.battlesFought}` : ""} 场）`);
    if (c.isWounded) items.push("目前负伤");
    if (char.traits && char.traits.length) items.push(`特质（${char.traits.map((t) => t.name).join("、")}）`);
    if (char.liege) items.push(`效忠于（${char.liege}）`);
    if (c.regionName) items.push(`所在地区（${c.regionName}）`);
    if (c.army) {
        const units = c.army.units.map((u) => `${u.name}×${u.count}`).join("、");
        items.push(`军队（${c.army.unitCount} 个单位栏位${units ? `：${units}` : ""}${c.army.heroes.length ? `；随军英雄：${c.army.heroes.join("、")}` : ""}）`);
    }
    items.push(`派系（${f.name}：${f.regionCount} 个定居点${f.capitalName ? `，首都${f.capitalName}` : ""}，${f.armyCount} 支军队，国库 ${Math.floor(f.treasury)} 金币）`);
    if (f.atWarWith && f.atWarWith.length) items.push(`派系正在交战（${f.atWarWith.map((x) => x.name).join("、")}）`);
    if (!isPlayer) {
        if (gameData.wh3 && gameData.wh3.sameFaction) {
            items.push("关系（效力于玩家自己的派系）");
        } else {
            items.push(`对玩家派系的态度（${char.opinionOfPlayer}，${attitudeWord(char.opinionOfPlayer)}）`);
        }
    } else {
        items.push("玩家本人");
    }
    return items;
}

function attitudeWord(n) {
    if (n > 60) return "非常友好";
    if (n > 20) return "友好";
    if (n > -20) return "冷淡";
    if (n > -60) return "不友好";
    return "敌视";
}

function describeRelation(f) {
    const parts = [];
    if (f.atWarWithPlayer) parts.push("交战中");
    if (f.alliedWithPlayer) parts.push("军事同盟");
    if (f.isVassalOfPlayer) parts.push(`${f.name}是玩家的附庸`);
    if (f.isMasterOfPlayer) parts.push(`${f.name}是玩家的宗主`);
    if (f.tradingWithPlayer) parts.push("贸易伙伴");
    if (parts.length === 0) parts.push("无条约");
    parts.push(`对玩家的态度：${f.attitudeToPlayer}（${attitudeWord(f.attitudeToPlayer)}）`);
    return parts.join("，");
}
