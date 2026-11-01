import fs from 'fs';
import path from 'path';
import type { GameData } from '../gameData/GameData';

/** Longest backstory read from one file (characters); longer text is cut. */
export const MAX_BACKSTORY_CHARS = 4000;

const README_NAME = 'README.txt';
const README = `自定义背景故事 / Custom backstories
=====================================

在这个文件夹里放 UTF-8 编码的 .txt 文件，VOTC 会把内容作为角色的背景交给 AI。
你写的背景优先于游戏自带的介绍；文件改动后，下一次对话立即生效。

按角色（找到第一个就用）：
  <战役 ID>\\<角色 ID>.txt    只对某一局战役里的某个角色生效
                               （战役 ID 是 conversation_summaries 里的文件夹名，角色 ID 是那里的 .json 文件名）
  <角色全名>.txt              例如 卡尔·弗兰茨.txt（名字和游戏里显示的一致）
  <角色类型 key>.txt          例如 wh_main_emp_karl_franz.txt，同类型的所有角色都适用
                               （mod 加的角色同样可用它们的 key）

按派系（另外附加）：
  <派系 key>.txt              例如 wh_main_emp_empire.txt，该派系所有角色都会知道

全面战争：三国 用武将的生成模板 key，例如 3k_main_template_historical_cao_cao_hero_earth.txt。
钢铁雄心4 / 维多利亚3 / 欧陆风云5 / 群星：按人物全名（任何人物都可以，不只是领袖）；
  整个国家的背景放在 <游戏>_<国家代码>.txt，例如 hoi4_GER.txt、vic3_GBR.txt、eu5_FRA.txt。
十字军之王3：按人物全名，或 ck3_<人物 ID>.txt（ID 在 conversation_summaries 里）。

Put UTF-8 .txt files here. Character files: <campaign id>\\<character id>.txt,
<full name>.txt or <agent subtype key>.txt (Three Kingdoms: generation template key),
first match wins. Faction files: <faction key>.txt (Total War) or <game>_<TAG>.txt
(hoi4, vic3, eu5, stellaris), added for every character of that faction/country.
Crusader Kings III: <full name>.txt or ck3_<character id>.txt.
`;

/** Characters that cannot appear in a Windows file name. */
function fileSafe(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
}

function readText(file: string): string | undefined {
  try {
    if (!fs.existsSync(file)) return undefined;
    let text = fs.readFileSync(file, 'utf-8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.trim();
    if (!text) return undefined;
    return text.length > MAX_BACKSTORY_CHARS ? text.slice(0, MAX_BACKSTORY_CHARS) + '…' : text;
  } catch (error) {
    console.warn(`Backstories: could not read ${file}:`, error);
    return undefined;
  }
}

/** Create the folder with a README explaining the file names (never overwrites user files). */
export function ensureBackstoriesDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const readme = path.join(dir, README_NAME);
    if (!fs.existsSync(readme)) fs.writeFileSync(readme, README, 'utf-8');
  } catch (error) {
    console.warn('Backstories: could not prepare folder:', error);
  }
}

/** First readable file of the list. */
function firstText(files: Array<string | null>): { text: string; file: string } | undefined {
  for (const file of files) {
    if (!file) continue;
    const text = readText(file);
    if (text) return { text, file };
  }
  return undefined;
}

/**
 * Attach user-written backstories to every character in the conversation.
 * Total War: by campaign + id, name, or agent subtype / generation template; faction lore by faction key.
 * Paradox games: by campaign + id, character name, or country tag; country lore by tag.
 * CK3: by full name or ck3_<id>.txt (CK3 characters keep their ids across saves).
 */
export function applyBackstories(gameData: GameData, dir: string): void {
  if (!fs.existsSync(dir)) return;
  const campaignId = gameData.wh3?.campaignId || gameData.pdx?.campaignId;
  for (const character of gameData.characters.values()) {
    const byName = [
      campaignId ? path.join(dir, fileSafe(campaignId), `${character.id}.txt`) : null,
      character.fullName ? path.join(dir, `${fileSafe(character.fullName)}.txt`) : null,
      character.shortName && character.shortName !== character.fullName ? path.join(dir, `${fileSafe(character.shortName)}.txt`) : null,
    ];
    const w = character.wh3;
    if (w) {
      const found = firstText([...byName, w.character.subtypeKey ? path.join(dir, `${fileSafe(w.character.subtypeKey)}.txt`) : null]);
      if (found) {
        w.backstory = found.text;
        console.log(`Backstories: ${character.fullName} <- ${path.basename(found.file)}`);
      }
      if (w.faction?.key) {
        w.factionBackstory = readText(path.join(dir, `${fileSafe(w.faction.key)}.txt`));
      }
    }
    const p = character.pdx;
    if (p) {
      const found = firstText(byName);
      if (found) {
        p.backstory = found.text;
        console.log(`Backstories: ${character.fullName} <- ${path.basename(found.file)}`);
      }
      // country lore: <game>_<TAG>.txt, so tags of different games never clash
      p.factionBackstory = readText(path.join(dir, `${gameData.game}_${fileSafe(p.country.tag)}.txt`));
    }
    if (!w && !p && gameData.game === 'ck3') {
      const found = firstText([path.join(dir, `ck3_${character.id}.txt`), ...byName.slice(1)]);
      if (found) {
        character.backstory = found.text;
        console.log(`Backstories: ${character.fullName} <- ${path.basename(found.file)}`);
      }
    }
  }
}
