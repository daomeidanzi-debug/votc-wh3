# VOTC for Total War: WARHAMMER III

把十字军之王3的 Voices of the Court（VOTC 2.0.4）移植到《全面战争：战锤3》：在战役地图上选中任何领主、英雄或定居点，按快捷键就能和他（或该派系领袖）用 AI 对话；对话内容会让 AI 在游戏里真的执行动作——付钱、宣战、议和、结盟、割地、送兵、授予特质、负伤、处决……

> 基于 VOTC 开源代码（GPL-3.0），保留了原版的对话界面、LLM 提供商配置、提示词系统、动作审批和对话记忆，只替换了和游戏打交道的部分。

## 组成

| 部分 | 位置 | 作用 |
|---|---|---|
| 游戏模组 | `wh3_mod/script/campaign/mod/votc_wh3.lua` → 打包成 `wh3_mod/votc_wh3.pack` | 在战役中运行：记录你选中的角色/定居点，导出角色与派系数据，按白名单执行 VOTC 发来的指令 |
| 桌面程序 | `src/`（VOTC 改造） | 对话界面 + LLM；通过游戏目录里的文件和模组通信 |
| 动作 | `default_userdata/actions/standard/z_wh3_*.js` | 17 个战锤动作（见下表），可以像原版一样自己加 |
| 提示词 | `default_userdata/prompts/` | 战锤世界观的系统提示词、中英文角色描述（含 29 个种族的说话风格）、示例对话 |

## 安装

1. **装模组**：把 `wh3_mod/votc_wh3.pack` 复制到
   `C:\Program Files (x86)\Steam\steamapps\common\Total War WARHAMMER III\data\`，
   然后在战锤3启动器的“模组管理器”里勾选 **votc_wh3**。
2. **编译桌面程序**（需要 Node.js）：
   ```bash
   npm run setup
   npm run build:win
   ```
   安装包在 `dist/` 里。开发调试用 `npm run dev`。

   - `npm run setup` 代替 `npm install`：先跳过安装脚本装好依赖，再分别安装 Electron、esbuild 和 active-win。active-win 的预编译文件从 GitHub 下载失败时（常见于代理环境），会自动改用本机已装的原版 VOTC 里同版本的文件。
   - `npm run build:win` 遇到 electron-builder 签名工具包的符号链接报错（非管理员、未开开发者模式时必现）会自动修复缓存并重试。
   - 项目文件夹的路径里不要有 UUID 样式的名字（如 `2ea27abe-e436-…`）：npm 会把它们当成密钥打码成 `***`，导致 electron-builder 找不到依赖。
3. 启动 **VOTC-WH3**，按 `Ctrl+Shift+H` 打开设置，配置 LLM（DeepSeek、OpenRouter、Ollama 等，和原版一样）。
   战锤3 安装目录会从 Steam 库里自动识别；识别不到时在设置里手动选择**包含 Warhammer3.exe 的文件夹**。

## 人物背景

AI 对话时会参考三种背景资料，**原版和其他模组新增的角色都适用**：

1. **你写的背景**（优先级最高，和其他资料冲突时以它为准）：放在 `%APPDATA%\VOTC-WH3\votc_data\backstories\` 下的 UTF-8 `.txt` 文件。托盘菜单 “Open Backstories Folder” 可直接打开，里面的 README.txt 有说明。
   - `<战役 ID>\<角色 ID>.txt`：只对某局战役里的某个角色生效；
   - `<角色全名>.txt`（如 `卡尔·弗兰茨.txt`）或 `<角色类型 key>.txt`（如 `wh_main_emp_karl_franz.txt`）；
   - `<派系 key>.txt`：该派系所有角色共享的背景。
   改完文件后，下一次对话立刻生效。
2. **传奇领主传记**：游戏里单位介绍页的那段生平。
3. **角色类型介绍**：游戏对这类领主或英雄的描述。

2、3 由模组在游戏里实时读取（`cco` 上下文接口，和游戏界面读的是同一份数据），所以会自动跟随游戏语言，也能读到其他模组添加的文本；项目里不复制任何游戏文本。

## 对话历史（按战役分开）

每局战役第一次运行模组时会生成一个战役 ID（如 `wh_main_emp_empire_1792904083_0012`），存进存档（`cm:set_saved_value`）。

- 同一局战役的所有存档共享对话历史，读档后角色仍记得之前聊过什么；
- 新开一局是新的 ID、全新的历史，不会和别的战役里碰巧同编号的角色混在一起；
- 历史保存在 `%APPDATA%\VOTC-WH3\votc_data\conversation_summaries\<战役 ID>\`，设置里的总结管理会显示成“玩家名 - 派系 (turn N)”。

> 装模组之前的老存档：第一次运行时会分配 ID，但要**存一次档**才会写进存档；不存档就重新读那个旧存档，会得到另一个新 ID。

> 这个移植版的程序名是 VOTC-WH3，数据存在 `%APPDATA%\VOTC-WH3`，不会影响你已安装的十字军之王3版 VOTC。自动更新已关闭（原版更新源会把它换回 CK3 版本）。

## 使用

1. 游戏设置为**无边框窗口**（独占全屏时对话窗口无法显示在游戏上方）。
2. 进入单人战役，然后任选一种方式指定对话对象：
   - 在地图上**点选一个角色**（你自己的领主/英雄，或其他派系的角色都行）；
   - **点选一个定居点** → 和该定居点所属派系的领袖对话；
   - **打开外交界面**并选中一个派系 → 和该派系领袖对话。
3. 按 **`Ctrl+Alt+T`**（被占用时依次尝试 `Ctrl+Shift+T`、`Ctrl+Alt+Y`；也可以从托盘菜单点“Talk to selected character”）。
4. 正常聊天。AI 认为对话中真的发生了什么事时会执行动作，界面里会显示结果；危险动作按你在设置里选的审批模式先征求同意。
5. `Ctrl+H` 最小化对话窗口，`Ctrl+Shift+H` 打开设置。

### 动作一览

| 动作 | 效果 | 条件 | 需审批* |
|---|---|---|---|
| paysGoldToPlayer | 对方派系付金币给你 | 不同派系 | |
| playerPaysGold | 你付金币给对方 | 不同派系 | ✔ |
| changeAttitudeTowardsPlayer | 双方外交态度 ±1~6 | 不同派系 | |
| declaresWarOnPlayer | 对方向你宣战 | 对方是派系领袖、未交战 | ✔ |
| makesPeaceWithPlayer | 议和 | 正在交战 | |
| formsAllianceWithPlayer | 军事同盟（自动停战） | 未结盟 | ✔ |
| signsTradeAgreement | 贸易协定 | 未交战、未贸易 | |
| becomesVassalOfPlayer | 对方成为你的附庸 | AI 派系 | ✔ |
| joinsPlayerFaction | 对方派系并入你（邦联） | 同文化 AI 派系 | ✔ |
| cedesRegionToPlayer | 割让指定定居点 | AI 派系 | ✔ |
| gainsTrait | 你或对方获得特质（勇敢、蒙羞、好运等 11 种全种族通用特质） | — | |
| gainsExperience | 你或对方提升 1~3 级 | — | |
| isWounded | 你或对方负伤 1~5 回合 | — | ✔ |
| isKilled | 对方死亡（玩家派系领袖不会被杀） | — | ✔ |
| givesUnitToPlayer | 对方把一支部队调给你的军队 | 双方都率军，你的军队未满 | |
| receivesUnitFromPlayer | 你把一支部队调给对方 | 双方都率军，对方军队未满 | ✔ |
| noOp | 无动作 | — | |

\* 审批模式为“自动接受安全操作”时。所有动作在游戏里还会再校验一次（金币够不够、地区是不是对方的、军队满没满……），失败会显示在对话里。

## 工作原理

VOTC 和模组通过战锤3安装目录里的三个文件通信（Lua 的工作目录就是游戏目录，其他模组的日志也写在这里）：

| 文件 | 方向 | 内容 |
|---|---|---|
| `votc_commands.lua` | 程序 → 游戏 | 只含数据的 Lua 表：`return { cmds = { {id=…, op="war", a=…, b=…}, … } }` |
| `votc_state.json` | 游戏 → 程序 | 按快捷键时导出的玩家、对话对象、双方派系（名字已本地化成游戏语言） |
| `votc_ack.json` | 游戏 → 程序 | 已处理到的指令 id 和每条指令的执行结果 |

- 模组每 0.4 秒读一次指令文件；指令文件用空环境加载，只能携带数据，不能执行代码；只执行白名单里的 `op`。
- 指令 id 单调递增并记录在 ack 文件里，读档、重启程序都不会重复执行旧指令；超过 2 分钟的指令直接丢弃。
- 多人战役中模组自动停用（避免不同步）。

## 排错

| 现象 | 处理 |
|---|---|
| “Warhammer III is not responding” | 确认模组已在启动器中启用、已进入战役地图。打开游戏目录的 `lua_mod_log.txt`，应能看到 `[VOTC] bridge 1.2.0 started`。 |
| “请先在战役地图上点选一个角色……” | 先点选角色/定居点或打开外交界面，再按快捷键。 |
| 外交界面里对话对象不对 | 外交面板的派系识别依赖游戏 UI，如果失效会退回到“上一次点选的角色”。先在地图上点选该派系的角色即可。 |
| Permission Denied | 程序需要写游戏目录。以管理员身份运行 VOTC-WH3，或把游戏装到普通文件夹。 |
| 快捷键没反应 | 看托盘图标的提示文字是哪个快捷键注册成功；或右键托盘图标点 “Talk to selected character”。 |

设置里的“收集日志”按钮会一并打包 `lua_mod_log.txt` 和三个通信文件。

## 发布到 Steam 创意工坊

见 [wh3_mod/WORKSHOP.md](wh3_mod/WORKSHOP.md)：把 `votc_wh3.pack` 和同名的 `votc_wh3.png` 封面放进游戏 data 文件夹，在启动器的模组管理器里上传；里面附有中英文描述模板。注意创意工坊只发布模组，桌面程序需要另外提供下载。

## 测试

```bash
pip install lupa
npm run test:wh3
```

- `wh3_mod/tests/test_bridge.py`：在真实的 Lua 5.1 虚拟机里，用模拟的战锤3脚本接口运行模组，覆盖导出、16 种指令、非法输入、重放保护、读档恢复、JSON 编码。
- `wh3_mod/tests/node/pipeline.test.cjs`：把主进程 TypeScript 转译后在 Node 里运行：用 Lua 真实导出的数据构建 GameData，逐个执行全部动作，检查提示词脚本、文件通信协议、目录检测；生成的指令再交给 Lua 模组执行，确认全部成功。

用到的每个游戏脚本接口（`cm:force_declare_war`、`cm:treasury_mod`、`cm:force_add_trait`、`common.get_localised_string` 等）、本地化键前缀和特质键都已对照游戏自带的 `data_script.pack`、`local_en.pack`、`db.pack` 核实过；但**还没有在运行中的游戏里实测**，首次使用时请留意 `lua_mod_log.txt`。

## 修改动作 / 指令

- 新动作：在 `%APPDATA%\VOTC-WH3\votc_data\actions\custom\` 放一个 JS 文件（格式参考 `z_wh3_*.js`），在 `run` 里调用 `runGameEffect({ op: "…", … })`。
- 可用的 `op` 见 `src/main/wh3/types.ts` 的 `Wh3Command`；要加新的游戏效果，在 `votc_wh3.lua` 的 `EXECUTORS` 里加一个函数、在 `ActionEffectWriter.ts` 的 `KNOWN_OPS` 里登记，然后 `npm run pack:mod` 重新打包模组。
