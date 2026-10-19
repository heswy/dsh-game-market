# DSH Game Market

在 DeepSeek Harness（DSH）里，把 Agent 执行长任务时的等待时间变成一局小游戏：游戏占满主工作区，右下角的小鲸鱼负责维持 Agent 的存在感，任务完成时提醒但不打断。

**当前发布：`v1.1.0`**。V1 首发能力（Game Market / My Games / 详情、静态 Registry、开发者 SDK/CLI/模板、首发四款游戏、默认随包 Registry）已通过 codex 验收；V1.1 进一步完成 Market 视觉交互收口、Runtime **全出血**舞台（移除黑边）、会话 Game tab 状态与中文宿主 locale 对齐，并补充第三方接入的呈现/安全区规范。

V1.1 验收：`npm run verify` **787/787**、`CHECK OK (23)`；真机与隔离宿主证据见 [`docs/V1-VERIFICATION.md`](./docs/V1-VERIFICATION.md)、[`docs/verification/v1/AUTOMATED-EVIDENCE.md`](./docs/verification/v1/AUTOMATED-EVIDENCE.md)、[`docs/verification/fullbleed-runtime/`](./docs/verification/fullbleed-runtime/)。

### V1.1 主要变化

- Market header/首页/详情/卡片视觉与交互优化；会话 Game tab 显示状态 pill（等你/完成/出错/已暂停），侧边栏不再带状态；
- Runtime 全出血：无黑边/舞台内边距/letterbox，游戏负责铺满视口；平台悬浮控件使用固定安全区；
- 开发者指南新增 §4.4「Runtime 呈现与安全区」，Vanilla/React 模板改为全出血参考实现；
- Game tab / Sidebar 文案跟随宿主 locale（中文宿主显示「游戏 / 游戏市场」）。

<details>
<summary>V0（核心体验验证版）历史</summary>

V0 已完成并验收，验证游戏是贪吃蛇（snake）。


- 权威规格：[`PRD｜DSH Game Market.md`](./PRD｜DSH%20Game%20Market.md)（第 8–12 章为实现权威来源）
- 项目记忆与协作/分支/验证规则：[`PROJECT_MEMORY.md`](./PROJECT_MEMORY.md)（**唯一项目记忆文件**）
- 基线：DSH Desktop `0.2.1-rc.2`，Node ≥ 20，**零第三方依赖**

## V0 包含什么

| 能力 | 状态 |
|---|---|
| Bundle 安装形态（Host 半 + `dsh.client` 半） | ✅ 已完成（可用/可停用清理） |
| `main` 面板 + Sidebar 入口；进入/返回不丢会话草稿 | ✅ 已完成 |
| 会话 tab 行的常驻「游戏 / Game」入口（点击进入 Game Market） | ✅ 已完成 |
| Agent Presence 小鲸鱼（running / waiting-user / completed / error） | ✅ 已完成 |
| sandbox iframe Runtime + 自动保存 + Continue | ✅ 已完成 |
| 需要用户：暂停存档 → 切回处理 → 一键回游戏 | ✅ 已完成 |
| 内置贪吃蛇（键盘、分数、Personal Best、Continue） | ✅ 已完成 |
| 真实安装 / Registry / Developer CLI / 排行榜 UI | **V0 不做** |

### V0 验证

- 自动化：`npm run build && npm run check && npm test` → **312 tests / 312 pass**，严格检查 13 项通过。
- 真机（同一版本 DSH 0.2.1-rc.2 的隔离 Web 宿主 + headless Chrome）：市场/等待入口/游戏运行/等待用户/完成提醒/继续游戏/跨重启恢复/多 Session/停用清理全部通过。
- 2026-10-18 V0.1 反馈迭代：修复从“继续游戏”返回时棋盘停在 ready、失去键盘焦点的卡住问题（315 tests 通过）。
- 2026-10-18 V0.2 反馈迭代：入口改为会话 tab 行常驻「游戏 / Game」tab（点击进入 Game Market）；返回游戏只保留平台一次确认并直接开玩（314 tests 通过）。
- 2026-10-18 V0.3 修复：Host 改为订阅 DSH 真实 `session/event`，修复「Agent 完成任务后游戏内没有任何完成提醒」；真机验证真实 `turn/end(error)` 可到达 Host（314 tests 通过）。**此修复需要重启 DSH 才生效。**
- 完整清单、截图与未覆盖项见 [`docs/V0-VERIFICATION.md`](./docs/V0-VERIFICATION.md)。

</details>

## V1 能力概览

| 能力 | 状态 |
|---|---|
| Game Market / My Games / 详情 / 搜索 / 分类 | ✅ |
| 静态 Registry 安装/更新/卸载；本地安装；默认随包 Registry | ✅ |
| 首发四款：`snake`（内置）/`jump`/`2048`/`breakout` | ✅ |
| 平台暂停/恢复、Continue、Game tab 直连恢复、Agent presence（含 AskUserQuestion 提醒） | ✅ |
| SDK v1 + Runtime Simulator + `dsh-game` CLI + `create-dsh-game` 模板 | ✅ |
| 存档契约（配额/CAS/真实删除）、运行实例心跳与按实例释放 | ✅ |

## 目录结构

```text
package.json            # DSH Bundle 根（dsh.bundle.patch + dsh.client）
cordis.patch.yml        # Bundle patch
index.js                # Host 入口（re-export packages/host/src/plugin.js）
client.js               # Client 构建产物（提交进仓库）
packages/shared/        # 跨模块契约（constants / errors / protocol / api-client / contracts）
packages/host/          # DSH Host：HTTP 路由、存储、Session/Score、Agent Adapter、内置游戏服务
packages/client/        # dsh.client：面板、Sidebar、等待 chip、Market/My Games、小鲸鱼
packages/runtime/       # Trusted Runtime：iframe、Bridge、自动保存、暂停/恢复
packages/sdk/           # 游戏内 SDK（构建时内联进游戏）
games/snake/            # 内置贪吃蛇（dist/index.html 为自包含单文件）
scripts/                # 零依赖构建/检查/开发态加载脚本
tests/                  # 跨模块集成测试
```

## 常用命令

```bash
npm run build      # 构建 client.js 与 games/snake/dist/index.html
npm run check      # 检查 bundle 元数据、JS 语法、产物是否自包含
npm test           # node --test（Host/Client/Runtime/SDK/游戏逻辑 + 集成测试）
```

代码格式/提交/分支规范见 [`PROJECT_MEMORY.md`](./PROJECT_MEMORY.md)。功能分支完成且检查通过后由 Lead 合并到 `main`。

## 在 DSH 中加载（开发态）

开发态通过修改当前 profile 的 `cordis.patch.yml` 加载本地插件；Host 代码改动需要重启 DSH，Client 改动刷新页面即可。

```bash
npm run build
npm run dev:enable -- --dry-run     # 预览将要写入的 patch
npm run dev:enable -- --yes         # 备份后写入托管块（默认 desktop profile）
# 重启 DSH（或停用/启用插件行），然后刷新 DSH 页面
```

隔离验证环境（可选，避免改动日常 profile）：

```bash
npm run dev:enable -- --profile-dir=/tmp/dsh-verify-home/profiles/web --yes
```

卸载开发行：

```bash
npm run dev:disable -- --yes
```

> 该脚本只改动 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中带 managed 标记的块，并自动备份；不会碰 profile 里的其它插件。

## V0 人工验收（贪吃蛇）

1. 侧栏出现 Game Market 图标；点击打开 Market（只有内置 Snake + Continue）。
2. 点开 Snake，方向键/WASD 可玩；暂停、返回、再进入后进度还在。
3. 打开任意会话：tab 行（对话 / 轨迹 / … / 游戏）最右侧有常驻「游戏」入口；点击进入 Game Market，返回时仍是该会话。
4. 游戏中 Agent 完成：右下角小鲸鱼提示“任务完成啦 / 查看结果”，游戏不被暂停或关闭。
5. 用 dev 模式模拟 `waiting-user`（见下）：小鲸鱼提示后点击 → 游戏暂停并存档 → 切回会话 → 出现“继续游戏” → 回到游戏并恢复棋盘。
6. 关闭 DSH 再打开：Snake 显示 Continue 与上一局分数，进入后继续。
7. 停用插件：侧栏与面板消失，无残留样式；重新启用后存档仍在。

没有真实 Agent 时可使用 dev-only 接口（需 Host `config.devMode: true`，`dev:enable` 默认开启）：

```bash
curl -s -X POST http://127.0.0.1:56891/api/game-market/dev/agent-state \
  -H 'content-type: application/json' \
  -d '{"sessionId":"dev-session","state":"waiting-user"}'
```

> 端口以当前 DSH Web GUI 为准（运行时注入）。该接口在 `devMode: false` 时不会注册。

## 已知限制（V0）

- 没有第三方游戏安装、Registry、开发者 CLI（V1 范围）。
- 贪吃蛇是自包含单文件；多文件游戏资源要等 V1.5。
- 平台提示音/静音、长期“少提醒”设置不在 V0。
- V0.3 起 Host 订阅真实 `session/event`（`turn/end`、`approval/*` 等），完成/等待提醒已在真机验证；审批/提问类真实事件与 question 投影仍需后续真机补测。
- 保存失败重试退避、saveGap 提示、Windows/深色主题完整视觉复测列入 V1 前清单。
- UI 自动化验证使用同版本 Web 宿主 + headless Chrome；桌面窗口视觉细节需在桌面端人工确认。
