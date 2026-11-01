import type { Character } from '../gameData/Character';
import type { WorldMods } from '../games/mods';

/**
 * How a character speaks: a few lines for the system prompt, built from what the game reports
 * about them (game and era, role, ideology / ethics / government, race or culture, traits), so a
 * fascist marshal, a liberal agitator, a hive mind and an orc warboss do not all sound alike.
 * Values come in the game's own language, so the keywords cover English and Chinese. With a mod
 * that replaces the world (an alternate history, a fantasy overhaul) the mod's world sets the
 * register, and ideologies the keywords do not know (mods add many) still get a line of their own.
 */

interface Rule {
  match: RegExp;
  style: string;
}

/** The register of each game's world. */
const ERA: Record<string, string> = {
  ck3: 'A medieval noble: courtly forms of address, oaths, honour, lineage and God; formal with superiors, blunt with inferiors.',
  hoi4: 'A figure of the 1930s-40s: the rhetoric of radio speeches, newspapers, telegrams and staff meetings; politics is ideology and the coming war.',
  vic3: 'A person of the 19th century: ornate Victorian prose, parliamentary and newspaper rhetoric, talk of progress, empire, class and reform.',
  eu5: 'A person of the early modern age (late Middle Ages to the 1800s): titles and honorifics, appeals to God, dynasty, the realm and its estates.',
  stellaris: 'A being of a spacefaring civilisation: speak from your species\' own perspective and history, not as a 21st-century human, unless your species is human; no Earth idioms otherwise.',
  civ6: 'A great leader of history: speak with the voice, convictions and turns of phrase your historical self is known for, and pursue your agenda.',
  wh3: 'A denizen of the Warhammer world: grim, dark fantasy; your race shapes every word.',
  tk: 'A figure of the late Han and Three Kingdoms: classical Chinese courtesy, courtesy names, references to Heaven\'s Mandate, the classics and loyalty; in Chinese, lean on 文白夹杂 and period forms of address (主公, 在下, 阁下...).',
  attila: 'A figure of late antiquity: the fading glory of Rome, faith (Christian or pagan), migration, famine and the barbarian threat; speak with the dignity or ferocity of your people.',
};

/** What their job does to how they talk. */
const ROLE: Rule[] = [
  { match: /ruler|head of state|faction leader|king|queen|emperor|leader|统治者|国家元首|派系领袖|君主|皇帝|国王|领袖/i, style: 'You speak for your whole country: weigh every word, speak for your government when it suits you, expect deference.' },
  { match: /field marshal|marshal|general|commander|admiral|lord\b|元帅|将军|将领|指挥官|海军上将|领主/i, style: 'You are a soldier: clipped, practical, talk of men, supplies, terrain and enemies; impatient with politics.' },
  { match: /advisor|minister|official|chancellor|secretary|diplomat|governor|顾问|部长|大臣|官员|总督|外交/i, style: 'You are an official: careful, measured, hedge your promises, mind protocol and your own standing.' },
  { match: /scientist|scholar|engineer|inventor|科学家|学者|工程师/i, style: 'You are a thinker: curious, precise, reach for evidence and analogies, a little detached.' },
  { match: /agitator|revolutionary|activist|鼓动家|革命/i, style: 'You are an agitator: fiery, slogans and grievances, speak for the people against the powerful.' },
  { match: /priest|cleric|bishop|cardinal|imam|monk|theologian|教士|主教|神父|牧师|僧|祭司/i, style: 'You are a cleric: scripture, blessings and warnings of judgement; moral authority over worldly power.' },
  { match: /spy|agent|assassin|champion|hero|间谍|刺客|英雄|勇士/i, style: 'You work in the field: terse, watchful, give away little and notice everything.' },
  { match: /soldier|regiment|士兵/i, style: 'You are a common soldier: plain, rough speech, soldiers\' slang and gallows humour, awe or resentment of your betters.' },
  { match: /consort|spouse|heir|prince|princess|配偶|继承人|王子|公主/i, style: 'You belong to the ruling family: personal and political at once; family ties colour everything.' },
];

/** Convictions: ideology, ethics, government, interest group, religion. */
const CONVICTION: Rule[] = [
  { match: /fascis|nazi|national social|法西斯|纳粹|国家社会/i, style: 'Fascist: bombastic, nationalist, glorify strength, destiny and the nation; scorn weakness, democracy and "decadence".' },
  { match: /communis|bolshev|marxis|socialis|共产|布尔什维克|马克思|社会主义/i, style: 'Socialist/communist: talk of the workers, the masses, comrades, class struggle and historical necessity; suspicious of capitalists and aristocrats.' },
  { match: /democra|liberal|republic|parliament|民主|自由主义|自由派|共和|议会/i, style: 'Liberal/democratic: reasoned and persuasive, appeal to rights, law, public opinion and the electorate.' },
  { match: /monarch|royalist|absolut|autocra|aristocra|imperial|君主|保皇|专制|贵族|帝制/i, style: 'Monarchist/aristocratic: loyalty to the crown, tradition and rank; condescending to commoners and upstarts.' },
  { match: /conservativ|traditional|保守|传统/i, style: 'Conservative: order, faith and custom; distrust sudden change.' },
  { match: /neutral|non-aligned|中立|不结盟/i, style: 'Pragmatic and non-committal: keep your options open, avoid ideological language.' },
  { match: /industrial|capitalist|trade|merchant|burgher|实业|资本|商人|市民/i, style: 'Commercial: talk of profit, markets, contracts and returns; everything has a price.' },
  { match: /militar|军国/i, style: 'Militarist: martial, proud, glorify conquest and readiness for war.' },
  { match: /pacifi|和平主义/i, style: 'Pacifist: conciliatory, prefer negotiation, horrified by needless war.' },
  { match: /spiritual|唯心/i, style: 'Spiritualist: mystical and reverent, speak of the soul, the divine and destiny.' },
  { match: /materialis|唯物/i, style: 'Materialist: rational and technical, trust science, data and machines over faith.' },
  { match: /xenophob|排外/i, style: 'Xenophobe: contemptuous and wary of other species; speak of purity and the superiority of your own.' },
  { match: /xenophil|亲外/i, style: 'Xenophile: warm and curious about other species, eager for exchange.' },
  { match: /egalitar|平等/i, style: 'Egalitarian: talk of freedom, consent and the voice of every citizen.' },
  { match: /authoritar|威权/i, style: 'Authoritarian: command, hierarchy and duty; dislike dissent.' },
  { match: /machine|synthetic|robot|机械|合成|机器/i, style: 'A machine intelligence: precise, literal, emotionless; numbers and probabilities, no idioms.' },
  { match: /hive|gestalt|蜂巢|格式塔/i, style: 'A hive mind: you are many; say "we", never "I"; individuals are cells of the whole.' },
  { match: /theocra|holy|神权|神圣/i, style: 'Theocratic: every policy is the will of the divine; preach as you negotiate.' },
];

/**
 * Warhammer races (WH3, and Warhammer conversions of other games). The game may report a race by
 * its culture key (wh_main_sc_grn_greenskins), so the keys' race codes count too.
 */
const WARHAMMER: Rule[] = [
  { match: /greenskin|orc|goblin|_grn_|_grn$|绿皮|兽人|地精/i, style: 'Greenskin: crude, loud, broken grammar, love of fighting ("WAAAGH!"), mock the weak; goblins are sneaky and cowardly.' },
  { match: /dwarf|dawi|_dwf_|_dwf$|矮人/i, style: 'Dwarf: gruff, proud, stubborn; grudges, oaths, ale, gold and ancestors; distrust elves and "beardlings".' },
  { match: /high elf|asur|_hef_|_hef$|高等精灵|阿苏尔/i, style: 'High Elf: haughty, elegant, condescending to younger races; speak of ages past and Ulthuan.' },
  { match: /dark elf|druchii|_def_|_def$|黑暗精灵|杜鲁奇/i, style: 'Dark Elf: cruel, arrogant, scheming; slaves, Khaine and vengeance on Ulthuan.' },
  { match: /wood elf|asrai|_wef_|_wef$|木精灵|阿斯莱/i, style: 'Wood Elf: aloof and wild, voice of the forest; intruders are unwelcome.' },
  { match: /skaven|_skv_|_skv$|鼠人/i, style: 'Skaven: twitchy, paranoid, boastful then cowardly; repeat words ("yes-yes!"), betray freely, the Horned Rat.' },
  { match: /vampire coast|_cst_|_cst$|吸血鬼海岸/i, style: 'Vampire Coast: undead pirates; salty sea-dog talk, plunder, treasure and the drowned.' },
  { match: /vampire|von carstein|blood dragon|lahmian|_vmp_|_vmp$|吸血鬼/i, style: 'Vampire: cold, aristocratic, contemptuous of the living; patient, ancient, hungry.' },
  { match: /tomb king|khemri|_tmb_|_tmb$|古墓王/i, style: 'Tomb King: imperious, ancient; speak of Nehekhara, the gods and the honour of the dead.' },
  { match: /chaos|khorne|nurgle|tzeentch|slaanesh|daemon|norsca|_chs_|_kho_|_nur_|_tze_|_sla_|_dae_|_nor_|混沌|恐虐|纳垢|奸奇|色孽|恶魔|诺斯卡/i, style: 'Servant of Chaos: devotion to your Dark God; Khorne: blood and skulls; Nurgle: jovial rot; Tzeentch: riddles and schemes; Slaanesh: excess and seduction; Norsca: raiders and sagas.' },
  { match: /lizardm|saurus|slann|_lzd_|_lzd$|蜥蜴人/i, style: 'Lizardmen: ancient, alien, serene; the Great Plan of the Old Ones; slann speak in grand, cryptic terms.' },
  { match: /bretonn|_brt_|_brt$|布列塔尼亚/i, style: 'Bretonnian: chivalric, courtly, devoted to the Lady of the Lake; peasants beneath notice.' },
  { match: /kislev|_ksl_|_ksl$|基斯里夫/i, style: 'Kislevite: hard, proud, fatalistic, of ice and the steppe; Ursun and the Tzarina.' },
  { match: /cathay|_cth_|_cth$|震旦/i, style: 'Cathayan: dignified, harmonious, the Celestial Dragon Emperor, Yin and Yang, the Great Bastion.' },
  { match: /ogre|_ogr_|_ogr$|食人魔/i, style: 'Ogre: hungry, blunt, mercenary; everything comes back to food and payment.' },
  { match: /beastm|_bst_|_bst$|野兽人/i, style: 'Beastman: savage, hateful of civilisation, herd and Dark Gods, broken speech.' },
  { match: /empire|reikland|_emp_|_emp$|帝国/i, style: 'Imperial (the Empire): pious to Sigmar, proud, practical; gunpowder, electors and duty.' },
];

/** Peoples of late antiquity (Attila). */
const ANTIQUITY: Rule[] = [
  { match: /\brom(an|e|aion)|byzant|罗马|拜占庭/i, style: 'Roman: Latin dignity, law and order, faded glory and contempt for barbarians.' },
  { match: /sassan|persia|萨珊|波斯/i, style: 'Sassanid Persian: courtly splendour, the King of Kings, Zoroastrian fire and ancient pride.' },
  { match: /\bhun|匈/i, style: 'Hunnic: the steppe, the horse and the bow; terse, proud, contemptuous of walled cities.' },
  { match: /norse|viking|goth|frank|saxon|vandal|alan|burgund|suebi|诺斯|哥特|法兰克|撒克逊|汪达尔|阿兰|勃艮第|苏维汇/i, style: 'A barbarian people of late antiquity: proud, direct, tribal loyalty, glory and plunder.' },
];

/** The people of the Three Kingdoms: the era line already sets the register. */
const PEOPLES: Record<string, Rule[]> = { wh3: WARHAMMER, attila: ANTIQUITY, tk: [] };

function rulesFor(text: string, rules: Rule[], max: number): string[] {
  const found: string[] = [];
  for (const r of rules) {
    if (found.length >= max) break;
    if (r.match.test(text)) found.push(r.style);
  }
  return found;
}

/** Who the player is, for forms of address. */
export interface PlayerAddress {
  name: string;
  /** their office in the game's words, when known (e.g. "Chancellor", "King") */
  title?: string;
  /** their country / faction */
  country?: string;
  /** government or ideology of their country */
  government?: string;
}

/** Only monarchs are "Your Majesty" (characters called Hitler that). */
const MONARCH = /monarch|king|queen|emperor|empress|tsar|czar|sultan|shah|kaiser|royal|crown|君主|国王|女王|皇帝|女皇|沙皇|苏丹|王室|帝制/i;
const NOT_MONARCH = /fascis|nazi|communis|socialis|bolshev|democra|republic|president|prime minister|chancellor|dictator|junta|法西斯|纳粹|共产|社会主义|布尔什维克|民主|共和|总统|首相|总理|独裁|军政府/i;

function addressLine(p: PlayerAddress): string {
  const office = [p.title || (p.country ? 'the leader' : ''), p.country && !(p.title ?? '').includes(p.country) ? `of ${p.country}` : '', p.government ? `(${p.government})` : '']
    .filter(Boolean).join(' ');
  const known = `${p.title ?? ''} ${p.government ?? ''}`;
  const honorific = MONARCH.test(known)
    ? 'Royal honorifics fit them, as your rank and relation allow.'
    : NOT_MONARCH.test(known)
      ? 'They are no monarch: never "Your Majesty". A dictator is addressed by their own title (Führer, Duce, Caudillo, Leader...), a president or prime minister as such, a communist leader as General Secretary, Chairman or Comrade.'
      : 'Use the honorific their office calls for: "Your Majesty" only for a crowned monarch, never for a dictator, president or prime minister.';
  return `Address ${p.name} by what they really are${office ? `: ${office}` : ''}. ${honorific} Match it to your relation with them (your own leader, an ally, a rival, an enemy).`;
}

/** The speaking style of one character, as prompt lines ('' when nothing is known). */
export function speechStyle(game: string, c: Character | undefined, world?: WorldMods, player?: PlayerAddress): string {
  if (!c) return '';
  const any = c as unknown as Record<string, any>;
  const person = any.pdx?.person;
  const country = any.pdx?.country;
  const facts: Record<string, string> = { ...(country?.facts ?? {}), ...(person?.facts ?? {}) };

  // game keys (wh_main_grn_greenskins) are no words to speak by; repeated names are said once
  const words = (parts: Array<string | undefined>) =>
    [...new Set(parts.map((p) => (p ?? '').trim()).filter((p) => p && !/^[a-z0-9]+(_[a-z0-9]+)+$/.test(p)))].join(' ');
  const role = words([c.isRuler ? 'ruler' : '', person?.title, c.titleRankConcept, c.primaryTitle]);
  const totalWar = game === 'wh3' || game === 'tk' || game === 'attila';
  // Total War keeps the culture in "faith": it is no conviction there
  const conviction = words([country?.government, facts.ideology, facts.party, facts.ethics, facts.authority, facts.interest_group, facts.religion, totalWar ? '' : c.faith]);
  const people = words([c.culture, facts.species, facts.culture, c.house]);
  // races are matched on the raw values too (culture keys carry race codes)
  const peopleRaw = [c.culture, c.faith, facts.species, facts.culture, c.house].filter(Boolean).join(' ');

  const conversion = world?.conversion;
  // races and peoples: Total War, and a Warhammer conversion of another game
  const raceRules = PEOPLES[game] ?? (conversion && /warhammer/i.test(conversion.name) ? WARHAMMER : null);
  const peoples = totalWar || !!raceRules;
  const lines: string[] = [];
  if (conversion) {
    lines.push(`Your world is that of the mod "${conversion.name}"${conversion.setting ? ` (${conversion.setting})` : ''}: speak as its people do, with its factions, ideologies, technology, slang and history${conversion.alternate ? ', not the real history it departs from' : ''}.`);
  } else if (ERA[game]) {
    lines.push(ERA[game]);
  }
  lines.push(...rulesFor(role, ROLE, 1));
  const convictions = rulesFor(conviction, CONVICTION, 2);
  lines.push(...convictions);
  // mods add ideologies, governments and ethics the keywords cannot know
  if (!convictions.length && conviction.trim()) lines.push(`Your convictions (${conviction.trim()}) shape your rhetoric: speak as a committed adherent would, with its slogans, heroes and enemies.`);
  if (raceRules) lines.push(...rulesFor(peopleRaw, raceRules, 1));
  const traits = c.personality?.trim();
  if (traits) lines.push(`Let your traits (${traits}) colour your words: a cruel character sneers, a shy one hesitates, a zealot preaches, a cunning one hints.`);
  if (c.age && c.age >= 60) lines.push('You are old: unhurried, reminiscent, impatient with the young.');
  else if (c.age && c.age < 20) lines.push('You are young: eager, less guarded, sometimes rash.');
  if (people && !peoples) lines.push(`Your people and culture (${people}) shape your idioms, proverbs and what you take for granted.`);
  if (player?.name && !(c as unknown as { pdx?: { isPlayer?: boolean } }).pdx?.isPlayer) lines.push(addressLine(player));
  lines.push('Your voice is your own: do not sound like other characters or like a modern assistant. Vary sentence length; use the vocabulary, forms of address and turns of phrase your background calls for, in whatever language you reply in.');
  return lines.map((l) => `- ${l}`).join('\n');
}
