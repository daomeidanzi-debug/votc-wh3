# VOTC 多游戏版 / VOTC Multi

同一个程序支持九个游戏：

| 游戏 | 怎么开始对话 | 能和谁对话 | 谈妥的动作怎么生效 | 需要的模组 |
|---|---|---|---|---|
| 十字军之王3 | 对角色用“交谈”互动 | 任何角色 | 自动（模组执行），程序确认每个动作是否成功 | 创意工坊原版 **Voices of the Court**（`-debug_mode` 启动） |
| 全面战争：战锤3 | 选中角色/定居点/外交对象，按 **Ctrl+Alt+T** | 领主、英雄、外交对象、部队 | 自动（Lua 模组） | `votc_wh3.pack` |
| 全面战争：三国 | 选中武将或城池，按 **Ctrl+Alt+T** | 武将、城池的主人 | 自动（Lua 模组） | `votc_3k.pack` |
| 全面战争：阿提拉 | 选中将领、特工或城市，按 **Ctrl+Alt+T** | 将领、特工、城市的主人 | 自动（Lua 模组） | `votc_attila.pack` |
| 钢铁雄心4 | 国家外交界面的 **“交谈（VOTC）”** 按钮，或顶栏下的 **“VOTC”** 按钮 | 各国领袖、顾问、将领、海军将领 | 自动：回到游戏时程序替你在控制台输入 `run votc.txt` | `votc_hoi4` |
| 维多利亚3 | 本国人物：**右键 →“交谈（VOTC）”**；外国人物：该国**外交行动**里的 **“交谈（VOTC）”**（游戏只给本国人物和流亡者显示人物互动） | 任何人物（本国、外国、流亡者） | 自动：模组每 2 秒自己执行（需 `-debug_mode`） | `votc_vic3` |
| 欧陆风云5 | **右键任意人物 →“交谈（VOTC）”** | 任何人物（本国、外国） | 自动：模组每 2 秒自己执行（需 `-debug_mode`） | `votc_eu5` |
| 群星 | 首都星球“决议”里的 **“开启通讯（VOTC）”** | 本国领袖、其他帝国统治者 | 自动：回到游戏时程序替你输入 `run votc.txt` | `votc_stellaris` |
| 文明6 | 领袖外交界面里的 **“交谈（VOTC）”** 按钮，或游戏中按 **Ctrl+Alt+T** 在列表里选人 | 见过的各文明领袖、城邦、本国总督和伟人 | 自动：程序通过 FireTuner 直接执行（需 `EnableTuner 1`） | `VOTC_Bridge` |

所有游戏也都可以按 **Ctrl+Alt+T**，在程序里的列表中选人（分“本国人物 / 各国领袖 / 其他人物”三组）。

在设置最上面选择游戏。每个游戏的文件夹、动作、提示词和对话记忆分开保存。程序从 VOTC-WH3 改名为 **VOTC 多游戏版（VOTC Multi）**，第一次启动时会自动把旧版的设置、API 密钥和对话记忆复制过来（旧文件夹不动）。

## 安装

模组在程序安装目录的 `resources\mods` 里：

- **战锤3 / 三国**：把 `.pack` 复制到游戏安装目录的 `data` 文件夹，在启动器的模组管理里勾选。设置里选**游戏安装目录**。
- **钢铁雄心4 / 群星**：把 `mods\paradox\votc_hoi4`（或 `votc_stellaris`）文件夹和同名 `.mod` 文件复制到 `文档\Paradox Interactive\<游戏>\mod`，在启动器的播放集里启用。
- **维多利亚3 / 欧陆风云5**：把 `votc_vic3`（或 `votc_eu5`）文件夹复制到 `文档\Paradox Interactive\<游戏>\mod`，在启动器里启用；Steam 启动选项里加 `-debug_mode`（模组靠它执行动作）。
- 这四个 Paradox 游戏在设置里选 **文档\Paradox Interactive\<游戏>**（程序一般能自动找到）。
- **十字军之王3**：订阅创意工坊的 Voices of the Court，用 `-debug_mode` 启动。
- **阿提拉**：把 `mods\attila\votc_attila.pack` 复制到游戏的 `data` 文件夹，在启动器的模组管理里勾选。它扩展游戏自带的 `lua_scripts\campaign_scripted.lua`（每个战役都会加载），不碰 `scripting.lua`，所以和改了 `scripting.lua` 的模组（例如 BloodHost）不冲突。设置里选游戏安装目录。
- **文明6**：把 `mods\civ6\VOTC_Bridge` 文件夹复制到 `AppData\Local\Firaxis Games\Sid Meier's Civilization VI\Mods`，在“额外内容”里启用。再把同一文件夹里 `AppOptions.txt` 的 `EnableTuner 0` 改成 `EnableTuner 1`，然后重启游戏。**注意：开着 Tuner 时游戏不给 Steam 成就。**

## 角色知道什么

- 每个角色知道自己的情况：身份、年龄、特质、所在地、游戏自带的介绍（三国名将的传记、战锤的角色类型介绍和传奇领主传记），以及你写的背景故事（`votc_data\backstories`，写法见那里的 README）。
- 自己国家的情况全都知道；**别国只知道公开的东西**（元首、政体、战争、同盟、大国地位）。外国人物看不到你的国库、稳定度、人力这类内部数字，只有你本国的人物知道。
- 对话发生在哪里会告诉 AI（人物所在地或你的首都）。
- 只有外国元首能代表国家做决定（宣战、议和、结盟、付款……）；将领、大臣、你自己国家的人只能对话，不会替国家签约。
- 十字军之王3：角色知道自己的秘密和人物资料里列出的已知秘密，不知道别人藏着的秘密。
- **模组**：程序读取每个游戏已启用的模组。架空/全面改造模组会替换游戏背景，并明确告诉 AI **这不是真实历史，不要提这个世界没发生过的真实事件、人物和结局**。
  - **任何架空模组都支持**：钢铁雄心4和十字军之王3里，自带开局剧本（bookmark）的模组就被认作一个独立的世界，程序会读取模组自己写的剧本介绍作为世界背景；钢铁雄心4还会读取剧本里每个国家的介绍，让该国人物知道本国在这个世界里的历史（例如新秩序里意大利、德国、美国各自的经历）。维多利亚3、欧陆风云5用模组自己的简介。
  - **常见模组有写好的简介**：新秩序 TNO、凯撒帝国 Kaiserreich/Kaiserredux、Red Flood、Thousand Week Reich、Führerreich、The Fire Rises、Old World Blues、Equestria at War、Pax Britannica、Elder Kings、权力的游戏、中土、After the End、Godherja、Anbennar、星战、星际迷航、战锤等。
  - **历史模组只换时代**：千年黎明、The Great War Redux、Cold War Iron Curtain、The Fallen Eagle、中世纪王国 1212，以及标了“历史（Historical）”的模组，保留真实历史。
  - 其他玩法模组（例如巨构、更多事件）的名字会列给 AI；汉化、界面、作弊、补丁类模组不算。

## 比原版 VOTC 好在哪（十字军之王3）

- 每个动作都会在 debug.log 里留下确认；模组执行后程序会检查，没执行的动作、以及 error.log 里关于这些动作的脚本错误会显示在聊天里，不再悄悄失败。
- 支持自定义背景故事（按人物全名或 `ck3_<人物 ID>.txt`）。
- 提示词明确角色的“已知信息”边界。
- 诊断记录写在 `文档\Paradox Interactive\Crusader Kings III\votc_app_log.txt`。

## 有哪些动作

能谈成的事都会变成游戏里的动作。外国的事只有元首能拍板；人物类动作只作用于你在游戏里点了“交谈”的那个人。

| 游戏 | 动作 |
|---|---|
| 钢铁雄心4 | 宣战、议和、结盟（拉入阵营）、担保、军事通行、互不侵犯条约、停靠权、成为傀儡、给予独立、退出阵营、并入玩家国家、准备战争（战争目标）、意识形态支持度变化、援助装备、派遣兵员、参战、政治点数、改变关系 |
| 维多利亚3 | 宣战（外交博弈）、签订条约（所有不需额外输入的条约条款，含模组添加的）、结盟、防御协定、担保、军事通行、成为附庸（保护国）、宣布为对手、禁运、欠玩家人情、付款、改变关系、恶名；人物：获得性格特质、死亡、流放 |
| 欧陆风云5 | 宣战、结盟、解除同盟、停战、成为附庸、宣战理由、宣布为对手、分享情报（间谍网）、派遣兵员、付款、改变关系；人物：获得特质、死亡 |
| 群星 | 宣战、成为附庸、分享情报、付款（资源）、改变关系 |
| 文明6 | 宣战、议和、结盟、宣布友谊、给钱、给予外交支持 |
| 全面战争三作 | 宣战、议和、结盟、附庸、合并、割让城市、贸易协定、付款、获得特质、经验、处死等（阿提拉没有结盟与合并） |

**模组内容**：装备（钢铁雄心4）、意识形态和战争目标（钢铁雄心4）、性格特质（维多利亚3、欧陆风云5）、条约条款（维多利亚3）、资源（群星）都从游戏文件**加上你启用的模组**里读取，所以新秩序、千年黎明等模组自己的装备和意识形态也能用，被大改模组删掉的不会出现。

**校验**：`npm test` 会把每个游戏能生成的所有命令，逐一对照游戏原版脚本和你启用的模组脚本，确认用到的每个效果、条件和取值都存在。

**语言**：人物用玩家最后一句话的语言回复（你写中文就回中文，写英文就回英文）。提示词最后固定要求整段只用这一种语言，人物资料里其他语言的名字和术语也要译过来，避免混杂。程序语言是中文时，人物资料和示例会自动用中文版本。

## 动作是怎么执行的（Paradox 游戏）

1. 模组每个游戏月、以及你在游戏里点“交谈”时，把相关国家和人物的情况写进游戏日志。
2. 谈妥的事写进 `votc.txt`：
   - **维多利亚3 / 欧陆风云5**：模组里有个看不见的界面计时器，每 2 秒执行一次 `run votc.txt`（需要 `-debug_mode`）。如果 12 秒内没执行，程序会替你在控制台输入。
   - **钢铁雄心4 / 群星**：游戏界面没法执行控制台命令，所以你回到游戏窗口约 1 秒后，程序替你按控制台键（Esc 下面那个键），输入 `run votc.txt`，回车，再关掉控制台。这时请不要正开着控制台。
3. 游戏回报每个动作成功没有；失败的会在聊天里显示。

安全设计：AI 只能从固定的动作列表里选，程序检查过每个参数才生成游戏脚本，不会执行 AI 写的文本。每条命令带序号，`votc.txt` 执行多少次都只生效一次。

## 尚未在游戏里实测的部分

以下都还没有在真实游戏里跑过，第一次用时请看游戏日志里的 `VOTC|` 行和 `votc_app_log.txt`：

- 三国的 Lua 模组（在 Lua 5.1 模拟环境里测过）。
- 维多利亚3 / 欧陆风云5 的右键互动和自动执行计时器（写法对照了游戏自带文件）。
- 钢铁雄心4 的两个按钮：位置是估计的，可能和别的界面重叠；国家外交界面里按钮作用于哪个国家，两种情况都处理了。
- 群星：已对照本机 4.5.2 的原版文件检查（修正了一个不存在的本地化函数，给决议加了图标）。
- 阿提拉：所有用到的脚本函数都在游戏程序里找到了名字，加载入口也在游戏程序里确认过；Lua 部分在模拟环境里测过。名字由程序从游戏和模组的 `.loc` 文件里查（Lua 读不到本地化文本）。
- 文明6：FireTuner 的消息格式、端口 4318、命令格式（`CMD:<状态编号>:<表达式>`）都是从游戏程序里反汇编确认的；用到的游戏函数都在游戏自带脚本里出现过。但还没有和真游戏连过。
- 程序替你输入控制台命令（钢铁雄心4 / 群星）。

---

## English

The app is now **VOTC Multi** (formerly VOTC-WH3); settings, API keys and conversation memory are copied from the old folder on first start.

- **CK3**: the original Voices of the Court workshop mod. On top of the original app, every effect is confirmed through debug.log; actions that did not run, and script errors error.log reports for them, appear in the chat. Custom backstories work for CK3 characters (full name or `ck3_<id>.txt`).
- **Warhammer III / Three Kingdoms**: select a character and press **Ctrl+Alt+T**.
- **Victoria 3**: right-click one of your characters > **Talk (VOTC)**; foreign people through **Talk (VOTC)** in that country's diplomatic actions (the game lists character interactions only for your own characters and exiles). **EU5**: right-click any character > **Talk (VOTC)**. A hidden GUI timer of the mod runs `run votc.txt` every 2 seconds (needs `-debug_mode`), so agreed actions apply by themselves.
- **HOI4**: **Talk (VOTC)** in a country's diplomacy view (its leader, advisors and commanders), or **VOTC** under the top bar (your own people). **Stellaris**: the **Open Communications (VOTC)** decision of your capital. These two games cannot run console commands from their UI, so the app types `run votc.txt` into the console about a second after the game window is in front again.
- **Ctrl+Alt+T** opens a list of everyone the game has reported: your people, heads of state, other characters.
- **Attila**: select a general, agent or settlement and press **Ctrl+Alt+T**. The pack extends the game's own `lua_scripts/campaign_scripted.lua` (loaded for every campaign) instead of `scripting.lua`, so it does not clash with mods that replace `scripting.lua`. Attila's scripts cannot localise, so names travel as loc keys and the app looks them up in the game's and the enabled mods' `.loc` files.
- **Civilization VI**: press **Ctrl+Alt+T** in a game and pick a leader you have met, a city-state, one of your governors or great people. The app talks to the game over FireTuner (`EnableTuner 1` in AppOptions.txt; Steam achievements are off while it is on): it fetches the mod's snapshot from the InGame state and runs agreed actions in GameCore_Tuner.
- **Mods**: the app reads every game's enabled mods. Total conversions and alternate-history mods (The New Order, Kaiserreich, The Fire Rises, Elder Kings, ...) replace the setting and tell the AI not to bring up real history that never happened in that world.

What characters know: their own country in full; other countries only through their public face (no treasury, stability or manpower of the player's country for foreigners). Only a foreign head of state can commit their country to wars, treaties or payments.

**Not yet verified in game:** the Three Kingdoms and Attila bridges, the Victoria 3 / EU5 interactions and GUI timer, the HOI4 buttons (positions are estimates), the Civilization VI FireTuner link (protocol taken from the game executable), and the console typing. Stellaris was checked against the 4.5.2 game files.

## For developers

```
src/main/appIdentity.ts  app name, one-time copy of the previous user data folder
src/main/games/
  types.ts            GameAdapter interface, game ids, prompt variants
  index.ts            registry (activeGame(), getAdapter()), WH3 and Three Kingdoms definitions
  steam.ts            Steam library / Documents folder detection
  backstories.ts      user-written backstories for every game
  consoleInput.ts     types a console command into the game window (Windows SendInput)
  totalwar/           Lua file bridge shared by WH3, Three Kingdoms and Attila;
                      packLoc.ts reads .loc tables from .pack files, attila.ts profile + localisation
  civ6/               FireTuner client and the Civilization VI adapter (Paradox snapshot format)
  mods.ts             enabled mods per game; total conversions replace the setting
  ck3/Ck3Adapter.ts   original VOTC flow plus effect confirmations
  paradox/            snapshot parser (countries, characters, talk requests), command compiler,
                      adapter (auto-run) and per-game profiles (public facts, auto-run mode)
tk_mod/               Three Kingdoms Lua bridge + tests
attila_mod/           Attila Lua bridge (lua_scripts/), pack builder (PFH4) + tests
civ6_mod/             VOTC_Bridge mod for Civilization VI + tests
paradox_mods/         votc_hoi4, votc_vic3, votc_eu5, votc_stellaris
                      build_trait_logs.py regenerates the Victoria 3 / EU5 trait checks
tests/games.test.cjs  Paradox bridge, characters, knowledge, registry, actions, CK3 confirmations
```

Tests: `npm test` (needs Python with `lupa`).
