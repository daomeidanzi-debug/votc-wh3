# VOTC for Total War: WARHAMMER III（战锤3 AI 对话）

在《全面战争：战锤3》的战役里，和任何领主、英雄用 AI 自由对话——谈判、威胁、收买、结盟——而且谈成的事会**真的在游戏里发生**：付钱、议和、宣战、割让定居点、调拨部队……

移植自十字军之王3的模组 [Voices of the Court](https://github.com/Voices-of-the-Court/VOTC)。

*English summary: talk to any lord or hero in your Warhammer III campaign through an LLM; agreements are carried out in the game. See [English quick start](#english-quick-start) below.*

---

## 一分钟了解

- 点选地图上的任意角色（敌人、盟友、自己的部下都行）、定居点，或打开外交界面，按 **Ctrl+Alt+T** 就能开聊
- 每个种族说话风格不同：兽人粗野、矮人记仇、精灵傲慢、鼠人阴险……
- 角色知道自己的军队、派系、战况、和你的关系，还会参考游戏里的人物传记（**其他模组加的角色也行**），你也可以给角色写自己的背景设定
- 每局战役独立记忆，读档后角色还记得你们聊过什么
- 宣战、处决这类危险操作会先问你同不同意

需要两样东西：**桌面程序 VOTC-WH3** + **游戏模组 votc_wh3**，再加一个 AI 服务（下面教你选）。

---

## 下载（不会用 GitHub 也没关系）

直接点下面的链接就会开始下载，永远是最新版：

| 你要下载的 | 直接下载 | 说明 |
|---|---|---|
| 桌面程序（安装版，推荐） | [**VOTC-WH3-Setup.exe**](https://github.com/daomeidanzi-debug/votc-wh3/releases/latest/download/VOTC-WH3-Setup.exe) | 双击安装，桌面会出现图标 |
| 桌面程序（免安装版） | [**VOTC-WH3-Portable-win64.zip**](https://github.com/daomeidanzi-debug/votc-wh3/releases/latest/download/VOTC-WH3-Portable-win64.zip) | 解压到任意文件夹，运行里面的 `VOTC-WH3.exe` |
| 游戏模组 | Steam 创意工坊订阅 **votc_wh3**，或 [**votc_wh3.pack**](https://github.com/daomeidanzi-debug/votc-wh3/releases/latest/download/votc_wh3.pack) | 二选一，见下方安装第 2 步 |

> 链接打不开或很慢？打开 [下载页](https://github.com/daomeidanzi-debug/votc-wh3/releases/latest)，在页面下方 **Assets** 里点文件名下载；网络不好时可以多试几次或换个时间。
> 这个页面上绿色的 “Code” 按钮是给开发者下载源代码用的，**普通玩家不用点**。

Windows 可能提示“Windows 已保护你的电脑 / 未知发布者”（程序没有购买代码签名证书），点 **更多信息 → 仍要运行** 即可。

---

## 安装（3 步）

**第 1 步：装桌面程序**
运行 `VOTC-WH3-Setup.exe`（或解压免安装版）。

**第 2 步：装游戏模组（二选一）**
- **创意工坊**：在 Steam 创意工坊订阅 votc_wh3，然后在战锤3启动器的“模组管理器”里勾选它。
- **手动**：把 `votc_wh3.pack` 复制到游戏的 `data` 文件夹，然后同样在启动器里勾选。
  找不到游戏文件夹：Steam 库里右键《全面战争：战锤3》→ 管理 → 浏览本地文件 → 打开 `data`。

**第 3 步：选一个 AI 服务**
打开 VOTC-WH3，按 **Ctrl+Shift+H** 打开设置，选一种：

| 方式 | 适合谁 | 说明 |
|---|---|---|
| DeepSeek | 国内玩家首选 | 中文好、便宜；在 DeepSeek 开放平台注册、充值，创建 API Key 填进设置 |
| OpenRouter | 想用 Claude / GPT / Gemini 等多种模型 | 一个 Key 用很多模型，按用量付费 |
| 其他 OpenAI 兼容接口 | 已有其他服务（通义千问、Kimi、中转站等） | 填接口地址、Key、模型名 |
| Ollama（本地） | 不想付费、显卡够好 | 在自己电脑上跑模型，不联网、不花钱，但对显卡要求高、效果取决于模型 |

填好后点“测试连接”，显示成功就可以了。游戏文件夹会自动识别，一般不用设置。

---

## 使用

1. 游戏的图像设置里把显示模式改成 **无边框窗口**（全屏模式下对话窗口显示不出来）。
2. 先打开 VOTC-WH3（会缩到屏幕右下角的托盘里），再启动游戏，进入**单人**战役。
3. 点选一个角色或定居点（或打开外交界面选一个派系），按 **Ctrl+Alt+T**，开始聊天。
4. **Ctrl+H** 收起/展开对话窗口，**Ctrl+Shift+H** 打开设置。

小提示：
- 读的是装模组之前的老存档？先**存一次档**，这局的对话记忆才能保存。
- 想给角色加自己的设定：右键托盘图标 → **Open Backstories Folder**，按里面 README.txt 的说明放 `.txt` 文件，比如 `卡尔·弗兰茨.txt`。

### AI 能做的事

| 效果 | 会先征求你同意* |
|---|---|
| 对方付金币给你 / 你付金币给对方 | 你付钱时 ✔ |
| 改变两个派系的外交态度 | |
| 宣战 / 议和 / 结盟 / 贸易协定 | 宣战、结盟 ✔ |
| 对方成为你的附庸 / 并入你的派系（同文化） | ✔ |
| 对方割让定居点给你 | ✔ |
| 你或对方获得特质、提升等级 | |
| 你或对方负伤 / 对方死亡（你的派系领袖不会被杀） | ✔ |
| 双方互相调拨部队 | 你调出部队时 ✔ |

\* 默认设置下。可以在设置里改成“全部自动”或“全部都问”。

---

## 常见问题

| 问题 | 解决办法 |
|---|---|
| 提示 “Warhammer III is not responding” | 确认启动器里勾选了 votc_wh3、已经进入战役地图（不是主菜单），并且按快捷键时**游戏窗口在最前面**（游戏切到后台时会暂停脚本）；然后点错误旁边的重试按钮 |
| 谈成的事没有马上生效 | 正常：游戏在后台时不执行脚本，回到游戏画面后就会生效 |
| 提示“请先在战役地图上点选一个角色” | 先在地图上点一下角色或定居点，再按快捷键 |
| 按快捷键没反应 | 快捷键可能被别的软件占了：看托盘图标的提示文字是哪个键，或右键托盘图标点 “Talk to selected character” |
| 对话窗口看不到 | 游戏改成无边框窗口 |
| 提示 Permission Denied | 右键 VOTC-WH3 → 以管理员身份运行 |
| AI 不回复 / 报错 | 在设置里点“测试连接”，检查 Key、余额和网络 |
| 多人战役 | 不支持，模组在多人战役里会自动停用 |

还是不行？在设置里点 **收集日志**，把生成的文件附在 [问题反馈](https://github.com/daomeidanzi-debug/votc-wh3/issues) 里（需要注册 GitHub 账号），或者在创意工坊页面留言。

---

## 免责声明

- 本项目是**非官方**的玩家作品，与 Creative Assembly、SEGA、Games Workshop 及 Voices of the Court 原作者均无关联，也未获得其认可。“Total War”“Warhammer”等名称和商标归各自所有者。
- 软件和模组**按“现状”提供，不提供任何担保**（见 GPL-3.0 第 15、16 条）。模组会按对话结果修改你的战役（金币、外交、领土、部队、角色生死等），这些改动可能无法撤销。**使用前请备份存档**；因使用本项目造成的存档损坏、游戏问题或其他损失，作者不承担责任。
- 对话内容和角色、战役信息会发送给**你自己选择的 AI 服务**处理，适用该服务的隐私政策和收费规则；产生的费用由你自己承担。请不要在对话里输入个人隐私信息。使用本地模型（Ollama）时数据不会离开你的电脑。
- AI 生成的内容不代表作者观点，可能不准确、不符合设定或令人不适；请自行判断。
- 程序会在游戏安装目录里读写几个通信文件（`votc_*.json` / `votc_commands.lua`），不会修改游戏本体文件。
- 游戏更新可能导致模组暂时失效。

---

## English quick start

1. Download the app: [VOTC-WH3-Setup.exe](https://github.com/daomeidanzi-debug/votc-wh3/releases/latest/download/VOTC-WH3-Setup.exe) (or the [portable zip](https://github.com/daomeidanzi-debug/votc-wh3/releases/latest/download/VOTC-WH3-Portable-win64.zip)).
2. Get the mod: subscribe to **votc_wh3** on the Steam Workshop, or put [votc_wh3.pack](https://github.com/daomeidanzi-debug/votc-wh3/releases/latest/download/votc_wh3.pack) into the game's `data` folder; enable it in the launcher.
3. Open VOTC-WH3, press **Ctrl+Shift+H**, configure an LLM (DeepSeek, OpenRouter, any OpenAI-compatible API, or local Ollama).
4. Play in borderless window mode, single-player campaign. Select a character, settlement or diplomacy faction and press **Ctrl+Alt+T**.

**Disclaimer:** unofficial fan project, not affiliated with or endorsed by Creative Assembly, SEGA, Games Workshop or the original VOTC authors. Provided "as is" without warranty (GPL-3.0). The mod changes your campaign according to conversations and changes may be permanent — back up your saves. Conversations are sent to the AI provider you choose, under its terms and costs.

---

## 给开发者

### 从源码编译

需要 Windows、Node.js 22+、Git。

```bash
git clone https://github.com/daomeidanzi-debug/votc-wh3.git
cd votc-wh3
npm run setup
npm run build:win
```

产物在 `dist/`；`npm run dev` 启动开发模式。

- `npm run setup` 代替 `npm install`：依赖装好后再分别安装 Electron、esbuild 和 active-win；active-win 预编译文件下载失败时（常见于代理环境）会尝试使用本机已安装的原版 VOTC 中的同版本文件。
- `npm run build:win` 遇到 electron-builder 签名工具包的符号链接报错（非管理员、未开开发者模式时会出现）会自动修复缓存并重试。
- 项目路径里不要有 UUID 样式的文件夹名，npm 会把它们打码成 `***`，导致 electron-builder 找不到依赖。
- `npm run pack:mod` 单独打包游戏模组到 `wh3_mod/votc_wh3.pack`。

### 结构

| 部分 | 位置 |
|---|---|
| 游戏模组（Lua 战役脚本） | `wh3_mod/script/campaign/mod/votc_wh3.lua` |
| 游戏通信、数据转换 | `src/main/wh3/` |
| 动作（17 个） | `default_userdata/actions/standard/z_wh3_*.js` |
| 提示词（中/英） | `default_userdata/prompts/` |
| 测试 | `wh3_mod/tests/`（`pip install lupa` 后 `npm run test:wh3`） |

程序和模组通过游戏安装目录里的三个文件通信：`votc_commands.lua`（程序 → 游戏，只含数据的 Lua 表，模组只执行白名单指令）、`votc_state.json`（游戏导出的角色与派系数据）、`votc_ack.json`（执行结果）。指令 id 单调递增，读档或重启都不会重复执行；超过 2 分钟的指令会被丢弃。

人物背景由模组通过游戏的 `cco` 上下文接口实时读取（与游戏界面同一份数据），所以跟随游戏语言、支持其他模组添加的角色，仓库里不包含任何游戏文本。对话历史按存档里的战役 ID 分开保存。

### 自定义动作

在 `%APPDATA%\VOTC-WH3\votc_data\actions\custom\` 放 JS 文件（参考 `z_wh3_*.js`），在 `run` 里调用 `runGameEffect({ op: "…", … })`。可用的 `op` 见 `src/main/wh3/types.ts`；新增游戏效果需要在 `votc_wh3.lua` 的 `EXECUTORS` 和 `src/main/actions/ActionEffectWriter.ts` 的 `KNOWN_OPS` 中都登记。

---

## 致谢、修改声明与许可

- **原作**：[Voices of the Court](https://github.com/Voices-of-the-Court/VOTC)，Copyright (C) MrAndroPC 及所有 VOTC 贡献者。原版说明见 [docs/ORIGINAL_VOTC_README.md](docs/ORIGINAL_VOTC_README.md)；原版的全部提交历史和作者署名都保留在本仓库中。
- **修改声明**（GPL-3.0 第 5 条 a 款）：本项目是 VOTC 的**修改版**。自 2026-10-25 起，daomeidanzi-debug 将其从《十字军之王3》移植到《全面战争：战锤3》：用战锤3战役脚本 `votc_wh3` 和文件通信取代了 CK3 的接口，新增了战锤动作、提示词、人物背景和按战役保存的历史，并修改了构建脚本。具体改动见 `wh3-port` 分支的提交记录。
- **许可证**：[GNU GPL-3.0](LICENSE)。本修改版同样以 GPL-3.0 发布，**不提供任何担保**。你可以自由使用、修改和再发布；再发布（包括修改后的版本）时必须同样以 GPL-3.0 开源、提供完整源代码、保留版权与许可声明。
- **源代码**：每个下载都对应本仓库中的一个版本标签，下载页上的 “Source code” 就是该版本的完整源代码。安装包、免安装版和模组里都附带了 `LICENSE`（许可证全文）和 `NOTICE`（版权、修改声明与源码地址）。

---

*Credits & license (English): VOTC-WH3 is a modified version of [Voices of the Court](https://github.com/Voices-of-the-Court/VOTC) (Copyright (C) MrAndroPC and VOTC contributors), ported to Total War: WARHAMMER III by daomeidanzi-debug starting 2026-10-25. Licensed under the [GNU GPL v3.0](LICENSE) without any warranty. The complete corresponding source of every release is the tagged commit in this repository; every download includes LICENSE and NOTICE files.*
