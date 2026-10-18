# 2048

V1 首发四款游戏之一，单文件自包含 HTML，零第三方依赖、零网络请求。

> **视觉方向：Number Ledger / 数字账簿。** 深墨底、黄铜细线、暖矿物色阶的瓷砖，数字用高对比衬线体排印。
> 2 → 4 → 8 … 从骨白、琥珀、朱砂走到金箔，4096 之后变成带金字的“黑卡”，让每一次升级都像把一枚筹码压进账簿。
> 浅色主题对应同一套材质的“羊皮纸”版本。

## 玩法

4×4 棋盘。向一个方向滑动，所有瓷砖压向该方向，相同的数字合并一次并累加分数；每次有效移动后生成一个 2（90%）或 4（10%）的新瓷砖。

- 得分：合并出的数字即得分（2+2→4 得 4 分）。
- 结束：棋盘无空格且横竖都没有相邻同值时结束；结束时提交一次分数。
- 2048：第一次出现 2048 时提示“达成 2048”，可继续冲 4096、8192……
- 撤销：**每局仅一次**，按钮明确显示“剩 1 次 / 已用完”；撤销恢复棋盘、分数、步数，不会生成新瓷砖。
- 最高分：`score.getBest` 展示 Personal Best；局内超过纪录显示 `NEW BEST`。
- 暂停：暂停时间不计入本局用时（`elapsed` 只在 playing 且页面可见、未失焦时累加）。
- 自动保存：移动后 450ms 合并保存；`before-save`、暂停、页面隐藏、离开时立即保存。读档后停在“继续这一局”，不会自动走一步。

### 操作

| 操作 | 按键 |
|---|---|
| 滑动 / 合并 | `↑` `←` `↓` `→` 或 `W` `A` `S` `D` |
| 开始 / 继续 / 重开 | `Enter` 或 `Space` |
| 暂停 / 继续 | `P` |
| 撤销（每局一次） | `U` 或点击“撤销” |
| 滑动（可选） | 鼠标拖拽 / 触摸滑动棋盘 |
| 返回 / 退出 | `Esc` 交给平台处理（游戏不拦截） |

纯键盘可完成开始、游玩、暂停、恢复、撤销、重开；焦点在棋盘上，`tabindex` 与可见焦点环由 CSS 提供。

## 文件结构

```text
games/2048/
├── game.json              # 构建期 manifest 源（manifest v1，无 entry/cover/screenshots）
├── build.mjs              # 零依赖构建：内联 SDK/游戏/CSS/manifest，确定性输出
├── src/
│   ├── logic.js           # 纯函数：移动/合并/生成/撤销/判负/计分/存档编解码
│   ├── render.js          # DOM 渲染：瓷砖、滑动/合并动画、HUD、覆盖层、ARIA
│   ├── game.js            # 输入/状态机/生命周期/SDK/存档/最高分
│   └── index.html.tpl     # 单文件模板（CSS + DOM）
├── test/
│   ├── logic.test.js      # 28 项中的 22 项纯逻辑测试
│   └── build.test.js      # 构建确定性、manifest 契约、产物一致性
├── dist/index.html        # 构建产物（提交；Registry 包可另存为 2048-1.0.0.html）
└── README.md
```

## 构建

```bash
node games/2048/build.mjs
```

输出 `games/2048/dist/index.html`，并打印 manifest 摘要、字节数与 `sha256`。构建是**确定性**的：同一份源码连续构建两次逐字节一致。

```text
[build:2048] 2048@1.0.0 · puzzle · storage+score · viewport 720x720
[build:2048] wrote games/2048/dist/index.html (176346 bytes)
[build:2048] sha256 5ed5bc7bd4d59c3761147446a64e41cec89b2a1f914b0751896a9a0872ed0565
```

构建脚本复用根仓库的 `scripts/bundle-lib.mjs`（受限 ESM bundler）与
`packages/shared/src/manifest.js` 的 `validateManifest` / `validatePackageHtml` / `checkSelfContained`，
所以“构建通过”等价于“包格式、manifest、自包含检查通过”。

## 测试

```bash
node --test games/2048/test/*.test.js
npm run verify        # 根目录全量（构建 + check + node --test，含本目录测试）
```

覆盖点（纯逻辑，不依赖 DOM/网络/真实时钟）：

1. 初始两枚瓷砖、种子可复现；同 seed + 同方向序列完全重放。
2. 四方向移动、压缩、同一瓷砖只合并一次、合并后不二次合并。
3. 每次有效移动恰好生成一个 2/4；无效移动不生成、不涨分、不涨步数。
4. 生成位置/数值由 `rngState` 决定；固定 seed 的 spawn 结果有精确断言。
5. 撤销：恢复棋盘/分数/步数、不生成新瓷砖、一次用完后永久锁定（含读档后）。
6. 判负：满盘且无相邻同值；从满盘前一格到 game over 的完整移动用例。
7. 计分：多组合并累加、0 分、整数、`SCORE_MAX` 截断。
8. 2048：首次达成进入 `won`，可继续，不会重复提示。
9. 存档：`{version, board, score, moves, undo, rngState, elapsed, status, reached2048, undoUsed}` 往返等价；损坏/越界返回 `null` 不崩溃；单局存档 < 4 KiB。
10. 构建：两次 sha256 一致、manifest 与 `game.json` 一致、通过共享校验器、提交的 `dist/index.html` 与当前源码一致。

## Manifest（manifest v1）

`game.json` 是构建期源，构建时以内嵌 `<script type="application/json" id="dsh-game-manifest">` 写入单文件 HTML（全文恰好一处）。**不含** `entry` / `cover` / `screenshots`。

| 字段 | 值 |
|---|---|
| `manifestVersion` | `1` |
| `id` / `name` / `version` | `2048` / `2048` / `1.0.0` |
| `author` | `{ "name": "DSH Game Market" }` |
| `categories` | `["puzzle"]` |
| `capabilities` | `["storage", "score"]` |
| `sdkVersion` / `runtimeVersion` | `^1.0.0` / `^1.0.0` |
| `viewport` | `720 × 720`，`fit: "contain"` |
| `preferredTheme` | `game-defined` |
| `score` | `higher-better`，`0 – 1,000,000,000`，整数 |
| `save.schemaVersion` | `1` |
| `tags` / `license` | `numbers, keyboard, single-player, short-run` / `MIT` |

说明：

- 棋盘是正方形，`720×720` 能让 Runtime 在任意内容区里按 `contain` 居中；游戏自身 CSS 仍会按实际 iframe 尺寸自适应（1440 宽、680 宽、720 方窗均验证）。
- `score.max` 取 `1,000,000,000`（任务给定的契约值）；`docs/V1-GAME-ACCEPTANCE.md §4.4` 表格写的是 `1,000,000`，二者存在文档差异，实现以 manifest 为准并在交付报告里请 Lead 对齐文档。
- 存档 `version` 即 manifest 的 `save.schemaVersion`（1）；`deserialize` 同时兼容字段名 `schemaVersion`。

## 存档 schema

key：`current`（唯一 key）；`schemaVersion`：`1`；大小通常 **< 400 B**，远小于 4 KiB 目标与 256 KiB 单值上限。

```json
{
  "version": 1,
  "board": [2, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "score": 12,
  "moves": 3,
  "undo": { "board": [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "score": 4, "moves": 2, "rngState": 123456 },
  "rngState": 123456,
  "elapsed": 4321,
  "status": "playing",
  "reached2048": false,
  "undoUsed": false
}
```

恢复规则：`board` 必须 16 格，值为 0 或 2 的幂；`score` 为 `0..SCORE_MAX` 整数；`undo` 为 `null` 或一次完整快照；`rngState` 为 32 位无符号整数；`status ∈ ready|playing|won|over`。任何非法/损坏/版本不符的存档返回 `null`，按新局处理，绝不崩溃。

> **撤销与读档**：本实现把撤销快照写入存档并在恢复后保留（`undoUsed` 记录是否已用），因此刷新/Continue 不会重新获得一次撤销。
> 验收文档 §4.1 的“读档后不恢复撤销栈”与 §4.3 的存档示例（含 `undo`）存在自相矛盾；本实现按任务要求与 §4.3 保留快照，并在交付报告中标注。

## SDK 调用（契约 §8 / §10）

| SDK | 使用方式 |
|---|---|
| `game.ready()` | 启动握手；失败显示错误覆盖层（含 `GM-*` 码）与“重新加载” |
| `game.runtime` | 主题 `theme`、`reducedMotion`、`locale`（zh-first UI）；每 1.8s 轻量同步主题变化 |
| `lifecycle.on('pause'/'resume')` | 冻结/恢复计时与输入；平台暂停显示“平台暂停中”，恢复后回到原局面并立即保存 |
| `lifecycle.on('hidden'/'visible')` | 隐藏前强制保存；可见时重置计时基准，不自动恢复局面 |
| `lifecycle.on('before-save')` | `syncElapsed()` 后立即 `storage.save('current', state)`，在 1.5s 窗口内完成 |
| `game.storage.load/save` | key 固定 `current`；读档非法则新局；保存失败红色“重试保存”+ `GM-*` 码 |
| `game.session.start/end` | `ready` 后启动一次；首次操作复用/创建；Game Over `end({outcome:'completed', score})` |
| `game.score.submit/getBest` | Game Over 提交一次；启动读取并展示 Personal Best；`won` 不提交，继续冲分 |

Game Over 的 SDK 顺序：先 `score.submit(score)`，再 `session.end({outcome:'completed', score})`；`won` 只提示继续，不结算。
暂停、离开、崩溃恢复都不丢 `board/score/moves/elapsed/rngState`；`elapsed` 不包含暂停/失焦/隐藏时间。

## 主题、动效与无障碍

- **暗色 / 浅色**：读取 `game.runtime.theme`；两套配色都用 CSS 变量定义，文字与背景对比度按 WCAG AA 检查（小字号标签 ≥4.5:1，大号数字更高）。
- **减少动效**：读取 `game.runtime.reducedMotion` 与 `prefers-reduced-motion`；关闭滑动/合并/生成/得分漂浮/边框闪烁，但保留即时状态变化与分数更新。
- **键盘**：方向键/WASD/P/U/Enter/Space；`Esc` 不拦截交给平台；棋盘 `tabindex=0` 与 `aria-keyshortcuts`；覆盖层把焦点移到主按钮/标题，关闭后交还棋盘。
- **读屏**：棋盘是 `role=grid`（4 行 × 4 列，每个 `gridcell` 播报“第 R 行第 C 列：值/空”），棋盘的 `aria-label` 同步最高瓷砖与得分；合并/撤销/结束通过 `aria-live` 区域播报。
- **颜色不是唯一信息**：每块瓷砖都显示数字；`NEW BEST`、保存失败、暂停等状态都有文字。
- **触摸**：撤销按钮 ≥44px 高；棋盘 `touch-action: none` 支持滑动且不引起页面滚动。

## 本地预览（无平台时）

直接把 `dist/index.html` 在浏览器打开即可游玩。检测到不在 iframe 中（或 SDK 握手不可用）时，游戏使用一个**只用于本地预览**的内存/localStorage 版 SDK：存档、最高分仍可跨刷新保留，但不会写平台数据。

预览参数（仅离线模式生效）：

| 参数 | 作用 |
|---|---|
| `?theme=dark` / `?theme=light` | 固定主题 |
| `?motion=reduced` / `?motion=full` | 固定减少动效 |
| `?fresh=1` | 清空预览存档与预览最高分 |
| `?failSave=1` | 让存档写入返回 `GM-4131`，用于验证保存失败提示与“重试保存” |
| `?failLoad=1` | 让读档返回 `GM-5022`，用于验证读档失败提示与新局回退 |
| `?embed=1` | 模拟平台内嵌布局（顶部悬浮控件安全带、右下小鲸鱼避让），本地预览默认为关 |

在 DSH Runtime 的 sandbox iframe 中运行时不会走预览分支：始终使用平台内联的 `DSH_GAME_SDK`。

平台内嵌布局会额外预留顶部 54px 左右的悬浮控件安全带，并把底部保存状态/提示左移，避开右下角的小鲸鱼；本地直接打开时使用紧凑布局。

## V1 验收对照（A-01 ～ A-18）

| 编号 | 实现 / 证据 |
|---|---|
| A-01 单文件自包含 | `build.mjs` 调 `checkSelfContained` + `validatePackageHtml`；无外部标签/URL/网络 API；模板与产物均由测试扫描 |
| A-02 ≤20 MiB + manifest 合法 | 176,346 B；构建期校验 manifest v1，`build.test.js` 复验 |
| A-03 启动 ≤1.5s | 单文件、无请求；本地 headless Chrome 从导航到可操作远低于 1.5s（平台冷启动以 Lead 真机为准） |
| A-04 键盘可玩 | 键盘用例：Enter 开始、方向键、P、U、Enter 重开；无鼠标必需步骤 |
| A-05 暂停 / 恢复 | `paused` 冻结计时与输入；resume 恢复同一局面（不重置、不重复计分） |
| A-06 离开自动保存 | 移动后 450ms 合并保存 + `before-save` / `hidden` / `pagehide` 强制保存；保存指示与失败重试 |
| A-07 分数 / 最高分 | Game Over 提交一次；`getBest` 展示；破纪录 `NEW BEST` |
| A-08 Continue | 读档后“继续这一局”，显示分数/步数/最高方块；平台确认后开始（游戏内无二次确认） |
| A-09 存档 ≤1 MiB | 单 key、约 0.3 KiB；逻辑测试断言 < 4 KiB |
| A-10 无外网 | 源码/产物均无网络 API 与外部资源；Node 测试与校验器扫描 |
| A-11 5 分钟无崩溃 | 本地 headless Chrome 连续 5 分钟随机操作（16 局、2028 次采样、0 未捕获异常、0 console error、0 非法棋盘）；平台真机 5 分钟以 Lead 验收为准 |
| A-12 1440 宽 | 1440×900 截图：棋盘居中、contain 缩放、无裁切 |
| A-13 窄窗 | 680×720 截图：无横向滚动，HUD/棋盘/撤销/保存指示完整 |
| A-14 暗色主题 | 暗/浅两套截图；`runtime.theme` 驱动 |
| A-15 纯键盘可达 | 焦点环、覆盖层焦点管理、Esc 不拦截；键盘用例覆盖主流程 |
| A-16 减少动效 | `runtime.reducedMotion` + 媒体查询；动画关闭、状态反馈保留 |
| A-17 错误可恢复 | 保存失败：红色“重试保存” + `GM-4131` 码 + 点击重试；启动失败覆盖层带码与“重新加载” |
| A-18 无第三方依赖 | 包内只有平台 SDK + 本仓库源码；无 `@font-face`/远程字体（系统字体栈） |

真机验收步骤（`docs/V1-GAME-ACCEPTANCE.md §4.7`）：

1. 从 Registry 安装 `2048` 并进入；方向键移动、合并、分数增长、动画正常。
2. 玩到一半按 P 暂停 → 离开 → Market 出现 Continue → 重新进入恢复棋盘/分数/步数。
3. 切后台 30s 再回来，确认暂停/自动保存/恢复正确，棋盘无错位。
4. 继续移动直到无合法移动 → Game Over，确认分数提交与 Personal Best。
5. 空格/回车重开，确认新棋盘、分数归零、旧局存档被覆盖。
6. 验证每局一次撤销的边界与恢复正确。
7. 暗色/浅色、1440/窄窗、减少动效各扫一遍；Network 0 外联；连续玩 5 分钟无崩溃。

## 本地 headless Chrome 验证（非平台真机）

除纯逻辑测试外，本分支用 headless Chrome + CDP 对单文件产物做了交互回归（`dist/index.html` 直接打开时的预览 SDK；`?theme=` / `?motion=` / `?embed=` 参数）：

- **布局**：1440×900、720×720、680×720、420×700；无横向滚动，棋盘按可用区域缩放，窄窗 HUD/撤销/保存完整。
- **主题**：暗色、浅色启动/游玩/暂停/结束覆盖层；减少动效下动画为 `none`。
- **键盘**：Enter 开始；方向键与 WASD 均有效；P 暂停/恢复；U 撤销；Game Over 后 Enter 重开；焦点在覆盖层按钮与棋盘之间正确交接；覆盖层打开时背景 `inert`。
- **滑动**：pointer 拖拽左滑触发有效移动（步数递增）。
- **存档**：移动后保存指示为“已保存”；刷新后出现“继续这一局”，棋盘/分数/步数与撤销已用状态一致；存档损坏与读档失败（`GM-5022`）有可见提示并安全开新局；保存失败（`GM-4131`）显示“重试保存”，恢复后重试成功。
- **结局**：2048 达成覆盖层可继续；满盘无移动的 Game Over 覆盖层、分数提交与“再来一局”。
- **稳定性**：连续 5 分钟随机方向 + 周期暂停/恢复 + 自动重开（16 局、2028 次采样），0 未捕获异常、0 console error、0 非法棋盘状态，保存状态保持 `saved`。

**未在本分支执行**：DSH 0.2.1-rc.2 隔离宿主中的真实 Runtime 悬浮控件/小鲸鱼遮挡、Registry 安装、Host 的 `before-save`/`session`/`score` 落盘行为；这些需要 Lead 在 `docs/V1-VERIFICATION.md` 的真机环境复核。

## 已知边界 / 待 Lead 处理

1. **根构建接入**：本分支的写文件范围只有 `games/2048/**`，未修改根 `scripts/build.mjs` / `scripts/check.mjs` / `package.json`。接入方式（建议）：
   - `scripts/build.mjs` 的 `steps` 增加 `node games/2048/build.mjs`（或在集成分支统一遍历 `games/*/build.mjs`）；
   - `scripts/check.mjs` 增加 `games/2048/dist/index.html` 的自包含/大小检查；
   - 根 `npm run verify` 已经会通过 `node --test` 执行本目录测试（含构建产物一致性）。
2. **文档差异**：`score.max`（本实现 `1e9`，任务指定）与验收文档 §4.4 的 `1e6`；`viewport`（本实现 `720×720`）与契约 §10 表格默认 `960×540`；撤销读档语义（§4.1 vs §4.3）。
3. **平台真机验证未在本分支执行**：本地用 headless Chrome 验证了开始/移动/合并/暂停/撤销/Continue/胜利/Game Over/保存失败/暗色/浅色/窄窗/减少动效；Registry 安装、Runtime 生命周期事件（`before-save`/平台暂停）、`score`/`session` 的真实 Host 行为需在 DSH 0.2.1-rc.2 隔离宿主中按验收文档复核。
4. **5 分钟连续运行**：本地 headless Chrome 已跑满 5 分钟（16 局、2028 次采样、0 异常）；平台真机 5 分钟 soaking 由 Lead 在验收环境执行。
5. **i18n**：UI 以中文为主（与 V0/V1 平台文案一致），数字与 `SCORE/BEST/MOVES` 等标签跨语言可读；V1 manifest 未声明 `i18n`，运行时不切换文案。
6. **预览 SDK 仅用于本地单文件预览**：平台内不会启用；它不影响包格式与零依赖约束。

## 依赖

零第三方依赖；仅使用浏览器 DOM/CSS、Node 内置模块（构建/测试）与本仓库的平台 SDK/shared 校验器（只读引用）。无网络请求。
