# Steam 创意工坊发布说明

## 上传步骤

1. 打包模组：`npm run pack:mod`（`npm run build:win` 也会自动打包）。
2. 把 `wh3_mod/votc_wh3.pack` 和 `wh3_mod/votc_wh3.png` 一起复制到
   `…\steamapps\common\Total War WARHAMMER III\data\`。
   PNG 必须和 pack **同名**、小于 1 MB，它就是创意工坊的封面。
3. 打开战锤3启动器 → 模组管理器，找到 votc_wh3（本地模组），用启动器的上传功能发布。
   第一次上传后在 Steam 网页上编辑标题、描述（可直接用下面的文本）、标签，并把可见性改成“公开”。
4. 以后更新：重新打包、覆盖 data 里的 pack，再在启动器里对同一个模组执行上传（会更新原条目，不会新建）。

> 订阅者会从 `workshop\content\1142710\<条目 ID>\` 加载 pack；VOTC-WH3 也会在那里检测模组，不会再提示“模组未安装”。

## 一定要说明的事

- 这个模组**单独不能用**，必须配合桌面程序 VOTC-WH3。安装包发布在 https://github.com/daomeidanzi-debug/votc-wh3/releases （发新版本：`gh release create <版本号> dist\votc-wh3-<版本>-setup.exe wh3_mod\votc_wh3.pack`）。
- VOTC 是 GPL-3.0 许可：源代码公开在 https://github.com/daomeidanzi-debug/votc-wh3 （默认分支 `wh3-port`，保留了原版完整提交历史、原作者署名和 LICENSE）。
- 模组只修改战役脚本，不改数据库表，和绝大多数模组兼容；多人战役中自动停用。

---

## 描述模板（中文）

**Voices of the Court：战锤3版 —— 和战役里的任何角色用 AI 对话，并让对话真正影响战局**

移植自十字军之王3的著名模组 Voices of the Court。在战役地图上点选任何领主、英雄或定居点（或打开外交界面），按 Ctrl+Alt+T，就能和他对话。

- 角色会按自己的种族口吻说话（兽人粗野、高等精灵傲慢、鼠人阴险……），并了解自己的军队、派系、战况和你们之间的关系
- 自动读取游戏里的人物背景和传奇领主传记（**其他模组新增的角色同样支持**），也可以给任何角色写自己的背景设定
- 谈判有真实后果：付钱、议和、宣战、结盟、贸易、附庸、割让定居点、调拨部队、授予特质、负伤、处决……危险操作会先征求你的同意
- 每局战役独立记忆：同一局战役读档后角色仍记得你们聊过什么

**需要：** 桌面程序 VOTC-WH3（下载：https://github.com/daomeidanzi-debug/votc-wh3/releases/latest ）和一个 LLM（DeepSeek、OpenRouter、本地 Ollama 等）。
源代码（GPL-3.0）：https://github.com/daomeidanzi-debug/votc-wh3 ，基于 Voices of the Court：https://github.com/Voices-of-the-Court/VOTC
游戏请使用无边框窗口模式。仅支持单人战役。

## Description template (English)

**Voices of the Court for Warhammer III — talk to any character in your campaign with an AI, and let the talk change the war**

A port of the famous Crusader Kings III mod. Select any lord, hero or settlement on the campaign map (or open diplomacy), press Ctrl+Alt+T and talk.

- Characters speak in their race's voice and know their army, faction, wars and their relations with you
- Uses the game's own character lore and legendary lord biographies (**characters from other mods included**), plus your own custom backstories
- Real consequences: gold, peace, war, alliances, trade, vassals, ceded settlements, units, traits, wounds, executions — risky actions ask for your approval
- Separate memory per campaign

**Requires** the VOTC-WH3 desktop app (download: https://github.com/daomeidanzi-debug/votc-wh3/releases/latest ) and an LLM (DeepSeek, OpenRouter, local Ollama…). Use borderless window mode. Single-player only.
Source code (GPL-3.0): https://github.com/daomeidanzi-debug/votc-wh3 — based on Voices of the Court: https://github.com/Voices-of-the-Court/VOTC
