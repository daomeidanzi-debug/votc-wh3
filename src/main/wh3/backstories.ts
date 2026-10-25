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

Put UTF-8 .txt files here. Character files: <campaign id>\\<character id>.txt,
<full name>.txt or <agent subtype key>.txt (first match wins). Faction files:
<faction key>.txt, added for every character of that faction.
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

/** Attach user-written backstories to every Warhammer III character in the conversation. */
export function applyBackstories(gameData: GameData, dir: string): void {
  if (!fs.existsSync(dir)) return;
  const campaignId = gameData.wh3?.campaignId;
  for (const character of gameData.characters.values()) {
    const w = character.wh3;
    if (!w) continue;
    const candidates = [
      campaignId ? path.join(dir, fileSafe(campaignId), `${character.id}.txt`) : null,
      character.fullName ? path.join(dir, `${fileSafe(character.fullName)}.txt`) : null,
      character.shortName && character.shortName !== character.fullName ? path.join(dir, `${fileSafe(character.shortName)}.txt`) : null,
      w.character.subtypeKey ? path.join(dir, `${fileSafe(w.character.subtypeKey)}.txt`) : null,
    ].filter((p): p is string => !!p);
    for (const file of candidates) {
      const text = readText(file);
      if (text) {
        w.backstory = text;
        console.log(`Backstories: ${character.fullName} <- ${path.basename(file)}`);
        break;
      }
    }
    if (w.faction?.key) {
      w.factionBackstory = readText(path.join(dir, `${fileSafe(w.faction.key)}.txt`));
    }
  }
}
