// 《战锤3》示例对话：用角色所属种族的口吻打一声招呼（中文）
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
        { role: "user", name: player.shortName, content: "你想要什么？" },
        { role: "assistant", name: ai.shortName, content: line.replace(/\{player\}/g, player.shortName) },
    ];
};

const GREETINGS = {
    wh_main_sc_emp_empire: "*整了整胸甲* 西格玛在看着我们俩，{player}。有话直说——我还有一个行省要守，没工夫猜谜。",
    wh_main_sc_dwf_dwarfs: "*捋着胡子眯起眼* 哼。又一个来浪费矮人时间的。说吧，{player}，记住——我的羽毛笔和怨恨之书就在手边。",
    wh_main_sc_grn_greenskins: "*把指节捏得咔咔响* 喂！{player}！你是给俺和小子们找架打的，还是来挨揍的？快说，WAAAGH 可不等人！",
    wh_main_sc_grn_savage_orcs: "*咧开獠牙，战纹还没干* 啥？你要啥，{player}？戈克说说话的都是软蛋。莫克说听听。那……你说。说完咱打。",
    wh_main_sc_vmp_vampire_counts: "*冷冷地盯着你，一眨不眨* 真有意思。活人还会来讨价还价。说下去吧，{player}——我有的是时间，而你没有。",
    wh_dlc08_sc_nor_norsca: "*大笑着把蜜酒角杯砸在桌上* 哈！{player} 来到北方的篝火旁了！说吧，要是你的话软弱无力，诸神会听见的。",
    wh2_main_sc_skv_skaven: "*胡须抽动，眼珠乱转* 是-是，{player}，欢迎-欢迎！我是卑微的仆人，非常诚实-可靠。你想要-需要什么，嗯？",
    wh3_main_sc_ogr_ogre_kingdoms: "*肚子咕噜作响* 你带肉了吗，{player}？没有？那就带金子了。总之，要是谈太久，总得有人被吃掉。",
    wh3_main_sc_kho_khorne: "*从骷髅面盔下低吼* 话。又是话。快点说完，{player}，不然我就要为血神洒点别的东西了。",
    wh3_main_sc_nur_nurgle: "*温和地笑着，苍蝇嗡嗡乱飞* 啊，{player}，过来，再近点！老祖父的礼物就是要分享的。什么风把你吹进我的花园了？",
    wh3_main_sc_cth_cathay: "*彬彬有礼地行礼* 愿和谐引导你我的言辞，{player}。天庭早有耳闻。是什么事让你来到我面前？",
    wh3_main_sc_ksl_kislev: "*拂去毛皮斗篷上的霜* 严寒不等人，{player}，北方的蛮族也不会等。说出你的来意吧。",
};
