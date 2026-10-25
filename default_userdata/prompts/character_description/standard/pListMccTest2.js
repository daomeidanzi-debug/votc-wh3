// Total War: WARHAMMER III persona builder.
// Exports a function (gameData, currentCharacterId?) => string

/**@typedef {import('../../../gamedata_typedefs').GameData} GameData */
/**@param {GameData} gameData */
module.exports = (gameData, currentCharacterId) => {
    const current = gameData.characters.get(currentCharacterId || gameData.aiID);
    if (!current) return "";

    let output = "";
    output += `[${current.shortName}'s Persona: ${buildCharacterItems(current, gameData).join("; ")}]\n`;
    gameData.characters.forEach((char) => {
        if (char.id !== current.id) {
            output += `[${char.shortName}'s Persona: ${buildCharacterItems(char, gameData).join("; ")}]\n`;
        }
    });

    const info = gameData.wh3;
    const scene = [
        `date(${gameData.date})`,
        `scene(${gameData.scene})`,
        gameData.location ? `location(${gameData.location}${gameData.locationController ? `, held by ${gameData.locationController}` : ""})` : null,
    ].filter(Boolean);
    output += `[Setting: Total War: WARHAMMER III campaign; ${scene.join("; ")}]`;
    if (info && !info.sameFaction) {
        output += `\n[Diplomacy between ${info.playerFaction.name} and ${info.targetFaction.name}: ${describeRelation(info.targetFaction)}]`;
    }
    return output;
};

const TYPE_LABELS = {
    general: "lord",
    colonel: "captain",
    champion: "champion (hero)",
    wizard: "wizard (hero)",
    spy: "spy (hero)",
    dignitary: "dignitary (hero)",
    engineer: "engineer (hero)",
    runesmith: "runesmith (hero)",
};

// How each race talks; used to give the AI a recognisable voice.
const VOICES = {
    wh_main_sc_emp_empire: "proud man of the Empire, swears by Sigmar, values duty, order and the Elector Counts' politics",
    wh_main_sc_dwf_dwarfs: "gruff dwarf, holds grudges written in the Book of Grudges, distrusts elves, respects gold, ale and old oaths; uses words like 'umgi', 'zaki', 'grobi'",
    wh_main_sc_grn_greenskins: "brutal orc or goblin, speaks crude broken orkish slang ('WAAAGH!', 'da boyz', 'humies', 'stunties'), respects only strength and a good fight",
    wh_main_sc_grn_savage_orcs: "savage orc, even cruder orkish slang, trusts warpaint and Gork and Mork, loves fighting more than anything",
    wh_main_sc_vmp_vampire_counts: "aristocratic undead noble of Sylvania, cold, patient and condescending to the living, thinks in centuries",
    wh_main_sc_brt_bretonnia: "chivalrous Bretonnian, devoted to the Lady of the Lake and the code of chivalry, looks down on peasants",
    wh_main_sc_chs_chaos: "Chaos warrior seeking the favour of the Dark Gods, menacing, contemptuous of weakness, speaks of glory and the End Times",
    wh_dlc08_sc_nor_norsca: "Norscan raider, boastful, worships the Dark Gods, loves plunder, monsters and glory in battle",
    wh_dlc03_sc_bst_beastmen: "bestial Beastman, hateful of civilisation, short savage sentences, speaks of herdstones and ruin",
    wh_dlc05_sc_wef_wood_elves: "aloof Asrai of Athel Loren, guardian of the forest, distant and dangerous towards trespassers",
    wh2_main_sc_hef_high_elves: "proud Asur of Ulthuan, refined and arrogant, sees younger races as children, loathes the Druchii",
    wh2_main_sc_def_dark_elves: "cruel Druchii of Naggaroth, cunning, sadistic, treats others as future slaves, hates the Asur",
    wh2_main_sc_lzd_lizardmen: "cold servant of the Old Ones' Great Plan, speaks of prophecy and order, uninterested in petty mammal politics",
    wh2_main_sc_skv_skaven: "treacherous Skaven, speaks fast and fawning with repeated words ('yes-yes', 'quick-quick', 'man-things'), always plotting to stab rivals in the back, worships the Horned Rat",
    wh2_dlc09_sc_tmb_tomb_kings: "ancient Tomb King of Nehekhara, imperious, speaks of eternity, dynasties and stolen grave goods",
    wh2_dlc11_sc_cst_vampire_coast: "undead pirate of the Vampire Coast, nautical slang, greedy for treasure, theatrical",
    wh3_main_sc_ksl_kislev: "hardy Kislevite, stern and loyal to the Ice Queen or the Motherland, values bravery against the northern hordes",
    wh3_main_pro_sc_ksl_kislev: "hardy Kislevite, stern and loyal to the Motherland, values bravery against the northern hordes",
    wh3_main_sc_cth_cathay: "honourable noble of Grand Cathay, formal and courteous, speaks of harmony, the Celestial Dragon Emperor and the Great Bastion",
    wh3_main_sc_ogr_ogre_kingdoms: "hungry ogre, cares about food, meat and mercenary pay, blunt and loud, measures worth by the size of the belly",
    wh3_main_sc_kho_khorne: "Khornate warrior, obsessed with blood and skulls for the Blood God, despises magic and cowardice ('BLOOD FOR THE BLOOD GOD!')",
    wh3_main_pro_sc_kho_khorne: "Khornate warrior, obsessed with blood and skulls for the Blood God",
    wh3_main_sc_nur_nurgle: "jovial follower of Grandfather Nurgle, speaks warmly of plagues, rot and the gift of decay",
    wh3_main_sc_sla_slaanesh: "seductive servant of Slaanesh, obsessed with excess, perfection and sensation, manipulative and flattering",
    wh3_main_sc_tze_tzeentch: "scheming servant of Tzeentch, riddles and plots within plots, delights in change and deception",
    wh3_main_pro_sc_tze_tzeentch: "scheming servant of Tzeentch, riddles and plots within plots",
    wh3_main_sc_dae_daemons: "Daemon Prince of undivided Chaos, arrogant, speaks of the Realm of Chaos and the Dark Gods",
    wh3_dlc23_sc_chd_chaos_dwarfs: "cruel Chaos Dwarf of the Dawi Zharr, worships Hashut, industrious, enslaves others, scorns their western kin",
    wh3_dlc29_sc_nag_undead_legions: "servant of Nagash, cold, ancient and absolute, speaks of the Great Necromancer's will",
    wh_main_sc_teb_teb: "mercenary-minded noble of the Southern Realms (Tilea/Estalia), pragmatic and fond of gold and intrigue",
};

function buildCharacterItems(char, gameData) {
    const w = char.wh3;
    const items = [];
    items.push(`id(${char.id})`);
    items.push(`name(${char.fullName})`);
    if (!w) {
        items.push(char.primaryTitle);
        return items;
    }
    const c = w.character;
    const f = w.faction;
    const isPlayer = char.id === gameData.playerID;
    items.push(`role(${c.isFactionLeader ? `faction leader of ${f.name}` : `${TYPE_LABELS[c.typeKey] || c.typeKey} of ${f.name}`})`);
    if (c.subtypeName) items.push(`kind(${c.subtypeName})`);
    items.push(`race(${f.subcultureName || f.cultureName})`);
    if (VOICES[f.subcultureKey]) items.push(`voice(${VOICES[f.subcultureKey]})`);
    items.push(`gender(${c.isMale ? "male" : "female"})`);
    if (c.age > 0) items.push(`age(${c.age})`);
    items.push(`rank(${c.rank})`);
    if (c.battlesFought > 0 || c.battlesWon > 0) items.push(`battles(won ${c.battlesWon}${c.battlesFought > 0 ? ` of ${c.battlesFought}` : ""})`);
    if (c.isWounded) items.push("currently wounded");
    if (char.traits && char.traits.length) items.push(`traits(${char.traits.map((t) => t.name).join(", ")})`);
    if (char.liege) items.push(`serves(${char.liege})`);
    if (c.regionName) items.push(`currently in(${c.regionName})`);
    if (c.army) {
        const units = c.army.units.map((u) => `${u.name} x${u.count}`).join(", ");
        items.push(`army(${c.army.unitCount} unit slots${units ? `: ${units}` : ""}${c.army.heroes.length ? `; heroes: ${c.army.heroes.join(", ")}` : ""})`);
    }
    items.push(`faction(${f.name}: ${f.regionCount} settlements${f.capitalName ? `, capital ${f.capitalName}` : ""}, ${f.armyCount} armies, treasury ${Math.floor(f.treasury)} gold)`);
    if (f.atWarWith && f.atWarWith.length) items.push(`faction at war with(${f.atWarWith.map((x) => x.name).join(", ")})`);
    if (!isPlayer) {
        if (gameData.wh3 && gameData.wh3.sameFaction) {
            items.push(`relationship(serves the player's own faction)`);
        } else {
            items.push(`attitude towards player's faction(${char.opinionOfPlayer}, ${attitudeWord(char.opinionOfPlayer)})`);
        }
    } else {
        items.push("the player");
    }
    return items;
}

function attitudeWord(n) {
    if (n > 60) return "very friendly";
    if (n > 20) return "friendly";
    if (n > -20) return "indifferent";
    if (n > -60) return "unfriendly";
    return "hostile";
}

function describeRelation(f) {
    const parts = [];
    if (f.atWarWithPlayer) parts.push("AT WAR");
    if (f.alliedWithPlayer) parts.push("military allies");
    if (f.isVassalOfPlayer) parts.push(`${f.name} is the player's vassal`);
    if (f.isMasterOfPlayer) parts.push(`${f.name} is the player's overlord`);
    if (f.tradingWithPlayer) parts.push("trade partners");
    if (parts.length === 0) parts.push("no treaty");
    parts.push(`their attitude to the player: ${f.attitudeToPlayer} (${attitudeWord(f.attitudeToPlayer)})`);
    return parts.join(", ");
}
