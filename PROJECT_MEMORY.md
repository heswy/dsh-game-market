# DSH Game Market · 项目记忆

> **本文件是全项目唯一的项目记忆文件（Single Source of Project Memory）。**
> 任何项目级约定、状态、决策、交接信息都只记录在这里；其他文档（`PRD｜DSH Game Market.md`、`README.md` 等）是规格或说明，不是记忆。
> **只有 Team Lead 可以修改本文件。** 子智能体/协作者只读；需要变更时向 Lead 报告，由 Lead 统一写入。
> 本文件优先于口头约定；与 PRD 冲突时，实现以 PRD 第 8–12 章为准，本文件记录的是"我们怎么协作/做到哪了"。

- 项目：`dsh-game-market`（DSH 内的小游戏市场与运行平台）
- 线上仓库：<https://github.com/heswy/dsh-game-market>
- 本地工作区：`/Users/orange/Orange Field/Matterhorn/dsh-game-market`
- 当前目标：**V1 M1 已完成并合并 `main`**（merge `44cd7a8`，`npm run verify` 754/754；用户桌面端验收进行中，白屏 hotfix `b933fe4` 已推送）；四条主线全部落地：静态 Registry + 安装/卸载/更新、SDK v1 + CLI/模板/Simulator、Market/My Games/详情/安装 UX（用 `frontend-design`+`ui-ux-pro-max`）、首发四款 `snake`/`jump`/`2048`/`breakout`。**下一步 M3**：隔离 DSH 0.2.1-rc.2 真机验收 + `docs/V1-VERIFICATION.md` 归档 → 通过后打 `v1.0.0`。V0 已验收；PRD v2.2 与 M0 契约冻结。
- 权威规格：`PRD｜DSH Game Market.md`（**v2.2，2026-10-18 已按 V1 单文件包统一**；第 8–12 章为开发权威来源）
- 开始记录：2026-10-18

---

## 1. 项目规则（必须遵守）

### 1.1 Git 规则

1. 仓库已初始化：`main` 跟踪 `origin/main`（`origin = https://github.com/heswy/dsh-game-market`）。
2. **`main` 是集成分支，不允许直接开发功能。** 只有 Lead 做以下操作：初始化仓库、合并 feature 分支、打 tag、推送。
3. 所有开发在短生命周期分支上进行，命名：
   - `feat/<scope>-<topic>`：新功能，例如 `feat/host-core`、`feat/client-shell`、`feat/runtime-sdk-snake`
   - `fix/<scope>-<topic>`：缺陷修复
   - `chore/<topic>`：工具、构建、文档、仓库维护
   - `test/<topic>`：测试与验收
4. 并行开发使用 **git worktree**，每个任务一个独立工作树 + 独立分支；不同分支不共享未提交改动。工作树放在仓库外：`/Users/orange/Orange Field/Matterhorn/dsh-game-market-worktrees/<name>`。
5. 提交信息遵循 Conventional Commits：
   - 格式：`type(scope): subject`，subject ≤ 72 字符，英文、祈使句、不以句号结尾
   - type 使用 `feat|fix|chore|test|docs|refactor|perf|build|ci`
   - scope 示例：`host`、`client`、`runtime`、`sdk`、`snake`、`repo`、`scripts`
   - 正文用 `-` 列要点；必须写清"做了什么 + 怎么验证"；涉及 PRD 的注明章节（如 `PRD §8.5`）
   - 一个提交只做一件事；不提交生成缓存、`.DS_Store`、`.prd-draft/`
6. 合并：feature 分支先合入 Lead 的集成分支 `chore/<milestone>-integration`，全量验证后再由 Lead `git merge --no-ff` 到 `main`；禁止快进合并到 `main`；合并前必须跑通 `npm run verify`（build + check + test）。`main` 只保留可发布提交。
7. 禁止 `git push --force` 到 `main`；禁止改写已推送历史；不 `git reset`/`clean` 丢掉用户改动。
8. 推送：`main` 与 tag 由 Lead 推送；feature 分支默认只在本地，除非需要协作。推送失败（凭据/网络）不阻塞本地开发，但必须记录在"状态"里。
9. 版本 tag：V0 完成打 `v0.0.0`；之后按 `v<major>.<minor>.<patch>`。
10. 不把任何 token/凭据写进仓库、日志、记忆或测试夹具。

### 1.2 协作规则（子智能体）

1. 子智能体开工前必须阅读：本文件 + PRD 对应章节 + 所在分支的共享契约文件。
2. 子智能体只在自己的 worktree / 自己负责的目录内写文件；**禁止修改**：`PROJECT_MEMORY.md`、`PRD｜DSH Game Market.md`、`package.json`（根）、`cordis.patch.yml`、`scripts/`、`packages/shared/`，除非任务明确授权。
3. 共享契约（`packages/shared/`）由 Lead 维护；需要新增字段/接口时先在交付说明中提出，不擅自改动。
4. 子智能体在自己的分支提交（Conventional Commits），**不合并到 main、不推送**；完成后报告：分支名、commit hash、改动文件、测试命令与结果、未完成项/风险。
5. 子智能体不修改用户 DSH profile、不安装插件、不联网、不执行破坏性命令。
6. 零第三方依赖：Host/Client/Runtime/SDK 只用 Node 内置模块与 `react`（Client 只允许 `react`）。新增依赖必须先经 Lead 决策并写入记忆。

### 1.3 验证要求

- 每个分支交付前必须：`node scripts/check.mjs` 通过、`node --test` 通过、构建产物可复现（连续构建字节一致）。
- 不伪造截图/日志；没有真机验证就写"未验证"，并说明原因与复现步骤。
- V0 验收以 PRD §10.2 的 V0-01～V0-15 为准；自动化无法覆盖的 UI 项，必须给出人工验证步骤。

---

## 2. V0 范围（已完成，保留为历史基线）

**只证明核心链路**：Agent 工作 → 用户进入游戏（贪吃蛇）→ Agent 完成/需要用户 → 用户自主返回工作；游戏进度跨多次等待保留。

V0 必须包含（对应 PRD §7.1 / §11.2）：

1. Bundle 安装形态：`package.json` + `cordis.patch.yml` + Host 半 + `dsh.client` Client 半；可启用/停用且无残留。
2. 注册 `main` 面板 + `sidebar.panellist` 入口；`selectPanel` 进入/返回；Conversation 草稿与语义滚动位置由宿主恢复。
3. 等待入口：Agent 连续运行 ≥5s，在会话头标题右侧（`conversation.session.header.actions` list slot）显示动效「游戏 / Game」提示；点击打开菜单（继续/选择/忽略）；菜单以提示为锚点居中且视口内翻转；不自动打开游戏。
4. Agent 状态桥接：`running / waiting-user / completed / error`；进入游戏时绑定当前 Session，只跟随它；1s 快照轮询。
5. 小鲸鱼 Agent Presence：占位 SVG，四态 + 气泡 + 完成提醒不打断 + 需要用户入口 + 错误态。
6. Runtime：sandbox iframe 加载内置贪吃蛇（自包含单文件 entry）；Pause/Resume；退出；10s/20s 加载超时；错误覆盖层。
7. SDK 最小集：`ready`、`storage`、`session`、`score`、`lifecycle`、`agent`、`runtime`（V0 只实现实际用到的语义）。
8. 存档：30s 自动保存 + 暂停/隐藏/离开强制保存；单游戏 ≤1MB（32 key、单值 ≤256KB）；原子写 + `.bak`；Continue 判定 = 未结束 Session + Save。
9. 需要用户完整流程：暂停+保存 → `selectPanel(null)` → DSH 原生审批/提问处理 → “继续游戏” chip → 重载读档 + 暂停遮罩确认。
10. 贪吃蛇：键盘可玩、Game Over、分数、Local Personal Best、Continue；作为 Runtime/SDK 的基准游戏。
11. 自动化测试 + DSH 内人工验证步骤与证据。

**V0 明确不做**：真实安装/Registry/搜索/排行榜 UI/开发者 CLI/多游戏/多文件游戏资源/正式鲸鱼素材/平台静音/长期少提醒设置。

新增决策：V0 验证游戏用 snake 替代 PRD 示例中的 2048（用户指定，2026-10-18）。该决定仅影响 V0 示例游戏，不改变 Runtime/SDK 契约。

---

## 2.1 V1 范围与开发计划（2026-10-18 锁定）

> 用户决策已锁定：四条主线（Market 前端/体验、首发游戏、开发者、安装/Registry/卸载）全部做；**贪吃蛇计入“至少四个首发游戏”**；V1 游戏继续**单文件**，多文件资源推迟到 **V1.5**；Registry 采用**静态索引 + 本地/远程安装包**（不做服务端）；Market **视觉成品感与功能完整度都要**。
> 2026-10-18 二次确认：PRD 已升级 **v2.2** 并全篇统一到单文件包口径（包格式/Registry/安装/错误码/CLI/验收/首发名单），本节与 PRD 不再存在方向性冲突；契约细节以 M0 产出的 `docs/V1-CONTRACTS.md` + `packages/shared` 为准。

### 2.1.1 V1 目标

把 V0 的“内置单游戏 + 开发态加载”升级为可分发、可安装、可开发的小游戏市场：

1. **Market 产品化**：浏览/搜索/分类/详情/安装/更新/卸载/我的游戏，安装态与错误反馈完整；视觉打磨到可对外演示。
2. **首发四款游戏**：`snake`（内置，V1 打磨）、`jump`（跳跃）、`2048`、`breakout`（打砖块）；全部走 V1 SDK/契约，单文件自包含，具备分数/最高分/暂停/自动保存/Continue。
3. **开发者体系**：SDK v1（向后兼容 V0）、零依赖 CLI、模板、开发/打包/发布静态索引的文档与示例。
4. **安装/Registry/卸载**：Host 侧静态 Registry 客户端、安装包校验与落盘、版本管理、卸载清理；Client 侧安装流程；本地/远程两种来源。

### 2.1.2 首发游戏名单（4 款）

| id | 名称（zh/en） | 类型/核心玩法 | 输入 | V1 验收要点 |
|---|---|---|---|---|
| `snake` | 贪吃蛇 / Snake | 经典街机（已有） | 方向键 / WASD | 迁移到 V1 SDK；视觉/手感打磨；现有测试保持 |
| `jump` | 跳跃 / Jump | 纵向平台跳跃（Doodle Jump 类） | ←/→ + 空格（或自动弹跳+左右） | 程序化平台、无尽分数、失误结算、存档/Continue |
| `2048` | 2048 / 2048 | 数字拼图 | 方向键 / WASD（可加鼠标滑动） | 撤销一次？、分数/最高分、棋盘存档、动画反馈 |
| `breakout` | 打砖块 / Breakout | 街机弹球 | 鼠标 / 方向键 | 多关卡、砖块类型、生命/分数、球速变化 |

共同要求：自包含单文件 HTML（内联 SDK/样式/脚本/图标 data URI）；无第三方依赖、无外部网络；启动 ≤1.5s；键盘可玩；暂停/恢复/离开自动保存；个人最高分；同一游戏一个未结束 Session 可 Continue；save ≤1MB。

**V1 首发名单锁定**：只做上表四款；PRD §7.3 原「DSH-native Demo（Agent 联动）」**移出 V1 阻塞范围**，由用户亲自带人后续推进，不纳入 V1 验收与发布门槛（V1-12 / D-036）。

### 2.1.3 游戏包 / Registry / 安装模型（V1 设计决策，2026-10-18 v2.2 统一后）

- **包格式**：单文件自包含 `.html`（UTF-8 无 BOM，≤20 MiB；Registry 包名 `<id>-<version>.html`），内嵌 `<script type="application/json" id="dsh-game-manifest">`（manifest v1，≤64 KiB，全文件恰好一处）+ 内联 SDK/样式/脚本/图标 data URI；**不引入 zip/归档/解压**（多文件资源 V1.5）。
- **manifest v1**：必填 `manifestVersion/id/name/version/author/description/categories/capabilities/sdkVersion/runtimeVersion`；可选 `icon`(data URI ≤256 KiB)/`tags`/`preferredTheme`/`viewport`/`score`/`save`/`permissions`(仅省略或 `{}`)/`homepage`/`repository`/`license`/`i18n`。**无 `entry`/`cover`/`screenshots`**（后两者仅 Registry 条目字段）。V1 `capabilities` 仅 `storage`、`score`。
- **静态 Registry**：索引 `registry/games.json`，`{registryVersion:1, generatedAt, games:[{id, version, …, package:{url, sha256, size, releasedAt}}]}`；`url` 必须 https、路径末段 `<id>-<version>.html`，或（仅本地 file Registry）Registry 目录内相对路径。默认 allowlist = `github.com`/`raw.githubusercontent.com`/`objects.githubusercontent.com`，可配置 `allowedHosts`；包 host 必须在 allowlist 或与索引同 host；重定向 ≤5 且不降级 http；缓存 `registry-cache.json`（TTL 6h、陈旧上限 14 天、离线回退、≤500 条/≤2 MiB）。
- **安装**：Host 下载/读取包（连接 10s / 整体 120s / 无数据 20s，边下边算 sha256）→ 校验 sha256/大小 → 解析 HTML 内嵌 manifest → 校验 id/version/sdkVersion/runtimeVersion/自包含 → 原子写 `packages/<id>/<version>/entry.html` → 原子写 `installations.json`。安装目录与 `saves/` 分离，卸载不删存档。
- **更新 / 回滚**：Registry 版本更高 → Market 显示“更新”；保留 `current + 1 previousVersion` 供回滚，装第 3 个版本时删 previous；运行中禁止更新；新版本 `save.schemaVersion` 更高时需用户确认；不兼容版本不自动升级。
- **卸载**：仅删 package 目录与 installation 记录；内置游戏不可卸载；默认保留存档/成绩，`deleteData:true` 二次确认后删除；运行中先暂停保存再卸载。
- **本地安装**：Market 选择本地 `.html`（raw `text/html` POST，≤20 MiB，`source:'local'`，无 sha256，必须二次确认）；CLI 打包产物可直接导入；开发模式 `devGameRoots` 只校验 manifest、不复制目录。
- **安全**：sha256 强制；仅 HTML；大小/id/version 正则/文件名规则；目标目录由 id/version 构造、不接受包内路径；sandbox/CSP 沿用 V0；`frame-ancestors` 由 V0 的 `*` 收紧为可配置 allowlist（V0-06）。
- **内置游戏**：`snake` 仍以 `games/snake` 内置；Registry 示例可同时有 `snake` 包用于安装流程测试。

### 2.1.4 分支 / worktree / owner 计划

| 阶段 | 分支 | owner | write scope | 依赖 |
|---|---|---|---|---|
| M0 | `feat/v1-foundation` | Lead | `packages/shared`、契约文档、`scripts`、`tests/v1-*`、根配置；不写业务 UI | 无 |
| M1a | `feat/v1-install-registry` | 子智能体 A | `packages/host/src/*`、`packages/host/test/*`、Registry 夹具 | M0 |
| M1b | `feat/v1-developer` | 子智能体 B | `packages/sdk/*`、`scripts/cli/*`、`templates/*`、`docs/developer*` | M0；发布协议对 M1a 只依赖契约 |
| M1c | `feat/game-jump` / `feat/game-2048` / `feat/game-breakout` / `feat/game-snake-v1` | 子智能体 C/D（两两分） | `games/<id>/*` 各自目录 | M0（SDK v1 冻结） |
| M2 | `feat/v1-market-ux` | 子智能体 E | `packages/client/src/components|styles|locale`、安装/详情 UI；避免改 Host 契约 | M1a 安装 API 冻结；视觉可提前出方案 |
| M3 | `chore/v1-integration` | Lead | 集成、跨模块测试、文档、记忆 | 全部 feature |
| 发布 | `main` + tag `v1.0.0` | Lead | 只合并、验证、打 tag、推送 | M3 验收通过 |

- 并行上限：M1 同时 3～4 个工作树；每个分支一个 owner；共享文件（`shared`、根构建、`main`、记忆）由 Lead 独占。
- 合并顺序：`foundation → install/registry → market-ux → games（随时）→ developer → integration`；Market UX 必须在 install API 冻结后合并，避免反复改安装态。
- 禁止跨分支直接 cherry-pick 未合并提交；契约变更走 M0/Lead。

### 2.1.5 里程碑与验收

- **M0（地基）**：包格式/manifest v1/schema、Registry schema、安装数据模型、路由表、SDK v1 API、四游戏验收清单落文档 + 契约测试；`npm run verify` 绿。
- **M1（并行）**：安装/Registry Host 完成（含校验/卸载/版本）；CLI init/build/publish 可跑；四游戏 alpha 可玩且通过单游戏测试；Market 视觉方案评审。
- **M2（Market UX）**：搜索/分类/详情/安装态/更新/卸载/我的游戏完整；视觉与空态/错误态打磨；暗色主题与窄宽度可用。
- **M3（集成验收）**：全量测试 + 隔离 DSH 0.2.1-rc.2 真机验证 + 用户桌面验收；更新 README、验证文档、记忆；打 `v1.0.0`。

**V1 验收（必须全部满足）**：
1. 静态 Registry（本地 + HTTPS 各一次）能安装 `jump`/`2048`/`breakout`，Market 显示已安装/可更新/可卸载；卸载后入口消失且存档保留。
2. 四款首发游戏（含内置 snake）可玩 5 分钟无崩溃；分数/最高分/暂停/自动保存/Continue 全可用。
3. Market：搜索、分类、详情页（作者/版本/大小/预览）、安装进度/失败重试、我的游戏、空态/错误态、键盘焦点/暗色主题。
4. 开发者 CLI：在空目录 `init` → `build` → `publish` 更新本地 Registry → Market 可安装/运行模板游戏；文档步骤 executable。
5. 安全：sha256 不匹配拒绝；超大/非 HTML/非法 id 拒绝；卸载清理完整；`frame-ancestors` 收紧为配置 allowlist。
6. 全量 `npm run verify` 通过；真机验收记录进 `docs/V1-VERIFICATION.md`。

### 2.1.6 M0 契约冻结记录（2026-10-18，已完成）

- **PRD 已升级 v2.2**（commit `1f019a9`）：§4/§5/§7/§8/§10/§11/§12 中包格式、Registry、安装、错误码、CLI、验收、首发名单全部改为单文件口径；zip 相关规范在 §12.1 标注废弃（D-010/D-032 已被 D-034 取代）。
- **统一命名（D-035）**：安装目录 `packages/<id>/<version>/entry.html`；Registry `registry/games.json` + `registryVersion:1`；缓存 `registry-cache.json`；保留 current+1 回滚版本；Registry host allowlist（默认 GitHub 三家）+ 同 host 规则 + 可配置 `allowedHosts`。
- **首发名单（D-036）**：V1 只做 `snake`/`jump`/`2048`/`breakout`；DSH-native Demo 移出 V1 阻塞范围，由用户亲自带人后续推进。
- **M0 代码契约**（commit `7842abd`）：`packages/shared` 新增 `manifest.js`（内嵌 manifest v1 解析/校验/自包含）、`registry.js`（索引 schema、URL 准入、缓存）、`installation.js`（存储布局、installations.json、回滚窗口）；版本升 `SDK/Runtime 1.0.0`、`protocolVersion 1`；`errors.js` 补 V1 GM 码与 `E_*→GM-*` 映射；`contracts.js` 补 V1 路由；Host semver 接受 V0 `^0.1.x` legacy 窗口；运行时声明 `>=0.1.0 <2.0.0`。
- **文档**（commit `41191a0`）：`docs/V1-CONTRACTS.md`（约 1500 行实现级契约）、`docs/V1-GAME-ACCEPTANCE.md`（四款验收清单）、`docs/V1-VERIFICATION.md`（空证据骨架）。
- **TBD 裁决（V1-14～V1-18）**：Registry 预览仅 https + 整份严格校验；CSP `frame-ancestors` 配置键与默认值；安装全局锁 `staging/.install.lock`；内置游戏不写 installations.json；`/entry` 绑定 TTL 10 分钟。
- **验证**：全量 `npm run verify` 通过（**345 tests / 345 pass**、严格 check 16 项、构建字节可复现）；新增共享契约测试 `packages/shared/test/*.test.js`（29 个）与 `tests/v1-contracts.test.js`。
- **滚动项**：SDK 版本协商与 V0 遗留（保存失败退避、审批/question 真机补测、Windows/暗色复测）随 M1/M2 处理，不阻塞 M0。

### 2.1.7 M1 派发记录（2026-10-18，用户指令：Lead 只做总调度）

- **基础**：`chore/v1-integration` = `b84256b`（含 M0）；每个分支从该提交拉出，worktree 全部在仓库外 `dsh-game-market-worktrees/<name>`。
- **并行方式**：每个任务一个 worktree + 一个分支 + 一个子智能体（独立工作区，`cwd` 指向 worktree）；子智能体只在自己的 worktree/分支提交，禁止 merge/push/切分支、禁止改 `PROJECT_MEMORY`/PRD/根配置/`packages/shared`。

| 任务 | 分支 | worktree | 子智能体 | 写范围 | 要求 |
|---|---|---|---|---|---|
| M1a 安装/Registry | `feat/v1-install-registry` | `m1a-install-registry` | 子智能体 A | `packages/host/src,test` | Registry 客户端/安装器/卸载/更新/安装锁/安装 API、CSP allowlist |
| M1b 开发者 | `feat/v1-developer` | `m1b-developer` | 子智能体 B | `packages/sdk`、`scripts/cli`、`templates`、`docs/developer*` | SDK v1 定稿、`dsh-game` CLI、模板、Simulator、开发者文档 |
| M2 Market UX | `feat/v1-market-ux` | `m2-market-ux` | 子智能体 E | `packages/client`、`client.js`、`locale` | Market/My Games/详情/安装态/空错离线态/暗色/键盘；**必须用 `frontend-design` + `ui-ux-pro-max`** |
| snake 迁移 | `feat/game-snake-v1` | `game-snake-v1` | 子智能体 C1 | `games/snake`、`scripts/build-snake.mjs` | 内嵌 manifest、SDK 1.0.0、视觉打磨、保留测试；用 `ui-ux-pro-max` |
| jump | `feat/game-jump` | `game-jump` | 子智能体 C2 | `games/jump` | 纵向跳跃、程序化平台、无尽分数、存档/Continue；用 `ui-ux-pro-max` |
| 2048 | `feat/game-2048` | `game-2048` | 子智能体 C3 | `games/2048` | 4×4、一次撤销、分数/最高分、存档/Continue；**用 `frontend-design` + `ui-ux-pro-max`** |
| breakout | `feat/game-breakout` | `game-breakout` | 子智能体 C4 | `games/breakout` | 多关卡/砖块类型/生命/球速；用 `ui-ux-pro-max` |

- **集成规则（不变）**：各分支完成后先合入 `chore/v1-integration`，在集成分支全量 `npm run verify` + 冲突处理（构建产物 client.js/snake dist 可能冲突，需重新构建），全部通过后再 `--no-ff` 合 `main`；合并由 Lead 执行，子智能体不合并。
- **监控方式**：`git worktree list` / 各 worktree `git status,log` / 子智能体完成报告。

### 2.1.8 M1 集成期待办（滚动记录）

> 子智能体越界/契约缺口事项统一记在这里，由 Lead 在集成阶段处理；子智能体不要改这些文件。

- **snake 报备（2026-10-18，方案 A 已裁决）**：`scripts/check.mjs` 仍硬编码 V0 `game.json.entry === 'dist/index.html'`，snake 源 manifest 暂留 `entry` 仅作构建期兼容，**构建时剔除、dist 内嵌 manifest 无 entry**（dist 严格 V1）。集成期 Lead 处理：① `scripts/check.mjs` 改为 V1 校验（内嵌 manifest + 自包含 + 构建确定性）并纳入新游戏构建；② `packages/shared/constants.js#BUILTIN_GAMES.version` `0.1.0 → 1.0.0`（snake manifest 同步 `1.0.0`）；③ 删除 `games/snake/game.json` 源 `entry`；④ 对齐 host 测试中 `0.1.0` 断言（`cases/games.js`、`cases/health.js`、`harness.js` expected 等）。
- **M1c 验收与集成进度（2026-10-18）**：snake 分支 `b03a5b3`（5 commits，351/351，dist 127,975 B，manifest 614 B）与 breakout 分支 `370320e`（3 commits，374/374，dist 153,786 B，sha256 `5f1254…97c2`，两次构建一致）均已由 Lead 独立复跑 `npm run verify` + 范围检查，分别合入集成分支 `acdcd4c`（snake）、`f361374`（breakout）；集成分支 `npm run verify` **380/380 pass、CHECK OK (16)**，工作树干净；两款 headless 截图已抽查。
- **breakout 裁决**：① P 暂停暂由游戏内处理（Runtime 键盘暂停仅 Escape，Escape 不拦截、平台 pause/resume 正常），V1 接受，后续 Runtime 若加 P 再去重；② manifest `score.max` 以 `10000000` 为准，集成阶段把 `docs/V1-GAME-ACCEPTANCE.md` §5.4/§6 的 `1,000,000` 对齐；③ breakout/jump/2048 的根构建/检查接入由 Lead 在集成阶段做（`scripts/build.mjs`、`scripts/check.mjs`）。
- **2048 验收**：分支 `c797622`（373/373，dist 176,346 B，sha256 `5ed5bc7…0565`，两次构建一致，范围仅 `games/2048/**`）已合入集成分支 `93b3da6`；headless 截图已抽查。裁决/待办：`score.max` 以 manifest `1e9` 为准、`viewport` 720×720 为合法自定值（契约 §10 只是示例，需在文档注明）；撤销栈**持久化**（读档后恢复“剩 1 次/已用完”，`docs/V1-GAME-ACCEPTANCE §4.1` 的“不恢复撤销栈”按新裁决改）；save payload 用 `version` 字段（游戏私有数据，平台不约束，保留）。
- **M1b 验收**：分支 HEAD `2956b83`（5 commits，76 files，411/411，范围检查无越界文件）已合入 `cf022a1`；根 `npm run verify` 会用新 SDK 重建游戏 dist，已在集成提交 `e454027` 统一重建 snake/2048/breakout。待办：① 根 `package.json` 加 `bin`（`dsh-game`/`create-dsh-game`）并把 `packages/sdk/**`、`scripts/cli/**`、`templates/**` 加入 `files`；② shared `INTERNAL_TO_GM` 补 `E_COMPAT_SDK/E_COMPAT_RUNTIME`，并补登记 `GM-4230`–`GM-4248` 等 V1 包错误码常量；③ 文档对齐：lifecycle payload 含 `event`、`runtimeVersion` ready 前为 `null`；④ React 模板不做仓库内 `npm install`（无联网），定位为“说明性模板 + create 生成后可用”，M3 有依赖环境时补构建。
- **M2 验收**：分支 4 commits（`d152da9`/`46e0509`/`f84e171`/`8501624`，521/521，范围仅 `packages/client/**`+`client.js`）已合入 `6a031ab`；frontend-design 定为“安静的编辑式画廊”、ui-ux-pro-max 用于 UX 规则/焦点/空错态；client.js 约 595 KB（未见 DSH bundle 上限，记录风险）。待办/裁决：① 以 M1a 的 Host API 实现为准复核 `/games` 分页、`/game`、`/installed`、`/install(-local)`、`/uninstall`、`/registry-refresh`、`/scores`、`/preview` 形状；② 卡片元数据按 PRD §9.3.7 红线不展示大小/更新时间（保持）；③ delete-data-only / restart(clear-save) / 安装进度路由列为 M3 决策；④ 客户端用例重复计数（`packages/client/test/index.js` + 目录扫描，V0 既有现象，记录不阻塞）。
- **M1a 验收**：分支 `eeb3488`（31 个 host 文件，范围检查无越界；独立复跑 417/417；client/snake 构建字节一致）已合入 `b83abea`。实现完整：Registry https/file、ETag/TTL/离线、preview-cache、流式安装+sha256+自包含校验、原子落位、安装锁、`/install`/`/install-local`/`/uninstall`/`/registry-refresh`、`/games` 合并、`/launch` 完整性、CSP allowlist、启动清理。裁决：① file Registry 跳过远程预览抓取（离线优先，Market 用 icon/占位）；② 预览下载只做 https+公网 IP/SSRF 校验、不套 host allowlist（需同步文档）；③ 重定向只对初始 URL 校验文件名，逐跳只复验 scheme/凭据/host/长度（同步文档 U-08）；④ dev 游戏**不写** installations.json（修契约 §6.2 与 §6.7 矛盾）；⑤ API 形状变化：`author` 为对象、`/game` 顶层 `installed` 为 InstallationView|null、LaunchInfo 增 `protocolVersion/gameId/gameVersion/entrySha256`（同步 contracts 文档）。
- **集成现状（2026-10-18 23:0x）**：已合入 snake/breakout/2048/developer/market-ux/install-registry（`acdcd4c`/`f361374`/`93b3da6`/`cf022a1`/`e454027`/`6a031ab`/`b83abea`）；`npm run verify` **722/722 pass、CHECK OK (16)**，工作树干净。仅剩 jump 未完成/未合并。
- **集成收尾已执行（2026-10-18，jump 前）**：① shared `errors.js`：补 `GM-4228`/`GM-4230`–`GM-4248`/`GM-4035` 常量与默认文案、`E_COMPAT_*` 映射、`httpStatusFor` 修正（`995a1b3`）；② 根 `package.json` 加 `bin`（`dsh-game`/`create-dsh-game`）与 `files`（sdk/cli/templates），`scripts/build.mjs` 遍历 `games/*/build.mjs`，`scripts/check.mjs` 改为逐游戏 `validatePackageHtml` 校验（`38741b8`）；③ `BUILTIN_GAMES.version`→`1.0.0`、删除 snake 源 `entry`、重建 snake/2048/breakout dist 与 client.js（`7eed11d`）；④ 文档对齐（预览策略/重定向/dev 游戏/lifecycle event/runtimeVersion null/viewport/2048-1e9+撤销持久化/breakout-1e7，`56620d7`）。集成分支 `npm run verify` **722/722 pass、CHECK OK (20 checks)**，构建字节可复现、工作树干净。
- **jump 验收 + M1 收尾**：分支 `b5871ad`（10 files，仅 `games/jump/**`；375/375；dist 198,887 B→合并后用最终 SDK 重建为 210,614 B，sha256 `3bb24f6…81d1`，两次构建一致）已合入 `f480aca`；根构建/检查已自动纳入（CHECK 21 项）。jump viewport 裁决为 **540×960 竖屏**，文档 A-12/§3.1 已同步（`ec9bac3`）。**M1 全量验收**：`chore/v1-integration` 最终 `npm run verify` **752/752 pass、CHECK OK (21)**、构建可复现、工作树干净；`--no-ff` 合并入 `main` 为 `44cd7a8`（合并前后各验一次 752/752）。7 个 feature worktree/分支已清理（§2.1.7），`chore/v1-integration` 分支保留。
- **M1 遗留（M3 再做）**：真机隔离 DSH 0.2.1-rc.2 验收（U-01..U-15、DEV-01..07、FM/SEC、启动计时/真实 5 分钟/平台暂停遮挡）尚未执行，`docs/V1-VERIFICATION.md` 仍为空骨架；`v1.0.0` tag 待 M3 通过后再打。M2 UI 未在真实 DSH loader 下渲染过（静态 mock + bundle 测试替代）。
- **（其他子智能体的越界/契约缺口报告在此追加）**

**V1 不做 / 推迟 V1.5**：多文件游戏资源（图片/音效/zip）、服务端 Registry/账号/付费/云排行榜、游戏内多人、Windows 完整视觉验收（可做冒烟）、正式鲸鱼素材。

---

## 3. 架构与目录（V0）

```text
dsh-game-market/
├── package.json            # Bundle 根：dsh.bundle.patch + dsh.client；零依赖
├── cordis.patch.yml        # 正式安装时的 Bundle patch
├── index.js                # Host 入口，re-export packages/host/src/plugin.js
├── client.js               # Client 构建产物（scripts/build-client.mjs 生成，需提交）
├── icon.svg
├── locale/{zh,en}.json     # Bundle 显示元数据
├── packages/
│   ├── shared/             # 跨 Host/Client/Runtime/SDK 的纯 JS 契约（含 V1 manifest/registry/installation 校验器，无 Node/browser 全局依赖）
│   ├── host/               # DSH Host：路由、存储、Session/Score、Agent Adapter、内置游戏服务
│   ├── client/             # dsh.client：main 面板、Sidebar、等待 chip、Market/MyGames、小鲸鱼
│   ├── runtime/            # 可信 Runtime：iframe 加载、Bridge、自动保存、暂停恢复
│   └── sdk/                # 游戏内 SDK（构建时内联进游戏 entry）
├── games/
│   └── snake/              # 内置贪吃蛇：game.json + src + dist/index.html（自包含单文件）
├── scripts/                # 零依赖构建/检查/开发态加载脚本
└── tests/                  # 跨模块集成测试
```

关键契约（详见 `packages/shared/src/contracts.js`）：

- UI→Host：`ctx.connection.fetch.register` 注册 `/api/game-market/*`，Client 同源 `fetch('api/game-market/...')`；只允许 GET/HEAD/POST，精确 pathname。
- Host 持久化：`$DSH_HOME/storages/dsh-game-market/`（默认 `~/.dsh`），JSON + 原子写。
- 游戏加载：`sandbox="allow-scripts"` iframe，URL 由 `POST launch` 返回；V0 只服务 entry + preview 两类文件。
- Bridge：`postMessage`，`event.source + instance + nonce + 结构校验`；`targetOrigin='*'`（sandbox opaque origin）。
- Agent Presence 状态只由 Host 快照驱动，游戏不能伪造。

---

### 3.1 已核实的 Client 会话状态契约（2026-10-18，从本机 app.asar 源码核对）

- `ui-session` 通过 `ctx.slots.provideRoot` 提供 root hooks：`sessions = ctx.sessions.list`、`sessionStatus = service.sessionStatus`。
- Slot 组件标准 props 里：
  - `useSessions(selector)`：selector hook，state 形如 `{ ids, byId, phase }`；`byId[sessionId]` 含 `running`、`retainedBy` 等。
  - `useSessionStatus(selector)`：selector hook，state 是 `Map<sessionId, { running, pendingInteraction, completionUnread }>`。
  - 当前主视图会话：`useSessions((s) => Object.values(s.byId).find((x) => (x.retainedBy?.mainView ?? 0) > 0)?.id)`。
  - `pendingInteraction` 非空 → waiting-user；`completionUnread` → 完成未读；`running` → 运行中。
- `ui-layout` 通过 `ctx.slots.provideRoot({ hooks: { panelInfo } })` 提供 `usePanelInfo`（仅 `activePanelId`）。
- 因此 V0 的 chip / Sidebar 状态优先从这两个 hook 派生（即时、无轮询）；Host `agent-state` 快照用于 label 文案与游戏内鲸鱼，并保留 dev 模拟。轮询只作为降级路径。

## 4. 常用命令

```bash
# 构建（client bundle + snake 单文件 entry）
npm run build

# 语法/manifest/产物检查
npm run check

# 单元 + 集成测试（node --test）
npm test

# 开发态加载到 DSH（会备份并修改 profile 的 cordis.patch.yml；由用户执行）
npm run dev:enable
npm run dev:disable
```

- Node ≥ 20（本机 v24.14.0），零 npm 依赖，不需要 `npm install`。
- DSH 基线：Desktop **0.2.1-rc.2**。
- 开发态加载：改 Host 代码需重启 DSH 或停用/启用插件行；改 `client.js` 后页面约 0.5s 热更新（以实测为准）。

---

## 4.1 验证环境（本机，可复用）

V0 的真机 UI 验证不依赖用户日常 profile：

1. 从本机安装包（与用户桌面端一致的 DSH **0.2.1-rc.2**）只读解出运行时代码到 `/tmp/dsh-asar-extract`；
2. 用隔离 `DSH_HOME=/tmp/dsh-verify-home` 启动 `dsh web --no-open --port 57999 --host 127.0.0.1`；
3. 用 `npm run dev:enable -- --profile-dir=/tmp/dsh-verify-home/profiles/web --yes` 写入 dev 行，重启临时宿主；
4. 用 headless Chrome（CDP 9333）加载宿主 URL，通过 `Runtime.evaluate` / 截图验证 UI；Agent 状态用 dev-only `/api/game-market/dev/agent-state` 模拟；
5. 该流程**不修改** `~/.dsh/profiles/desktop`；验证记录与截图见 `docs/V0-VERIFICATION.md`。

> 注意：不要在未确认时对用户日常 profile 执行 `dev:enable`；如误写，脚本会先备份，可用备份恢复。dev 脚本支持 `--profile-dir` 以避免环境变量歧义。

## 5. 关键技术决策（增量，完整见 PRD §12.1）

- D-023：V1（含 V0）游戏 entry 必须是自包含单文件；V0 只服务 entry/preview。
- D-024：从“处理 Agent / 查看结果”返回游戏时停在暂停遮罩，用户确认后再继续。
- D-025：Market/My Games 浏览态遇到 waiting-user 显示 32px 顶部提示条。
- D-026/027：V0 不做平台静音、不做长期“少提醒”偏好。
- D-028：写接口一律 POST。
- D-030：对外错误码统一 `GM-*`，内部常量 `E_*` 映射。
- D-031：DSH 基线 0.2.1-rc.2。
- D-032（已被 D-034 取代）：原计划 V1 自研 zip 读取器（V0 不涉及）；V1 改为单文件包后不需要 zip，V1.5 评估多文件时再重新评估。
- D-033：多 profile 共享 `$DSH_HOME/storages/dsh-game-market/`，跨进程写锁。
- V0 本地新增：
  - V0-01：V0 不接真实 Registry/安装；内置游戏以 `games/snake` 目录 + `installations.json` 中的 builtin 记录呈现。
  - V0-02：Agent 状态 V0 以真实 DSH 事件为主，另提供 **dev-only** `POST /api/game-market/dev/agent-state` 便于无 Agent 时验证 UI（仅 `config.devMode === true` 时注册）。
  - V0-03：V0 label 先用中文固定模板（zh-first），labelKey 机制推迟到 V1；SDK 仍不解析 label。
  - V0-04：Client 构建使用零依赖自研 bundler（`scripts/bundle-lib.mjs`），只支持受限 ESM 子集；不支持动态 import/循环依赖。
  - V0-05：UI 验收通过隔离 DSH 宿主 + headless Chrome 完成；自动化覆盖 Host/API/Runtime 纯逻辑/SDK 协议/游戏逻辑。
  - V0-07（已被 V0-09 取代）：等待提示曾放在 `conversation.session.header.actions`；用户随后要求入口在会话 tab 行且常驻，已改为 conversation.view tab。
  - V0-08（已部分被 V0-10 取代）：`resume-paused` 竞态修复（记录提前 resume、focusBoard）；V0.2 起不再保留游戏内的第二个开始入口。
  - V0-09：游戏入口 = 官方 `conversation.view` tab（id `game`, order 100），label 随语言「游戏 / Game」，**常驻不隐藏**；点击 tab 打开 Game Market 主面板并把会话 view 重置为 chat，返回后仍是正常对话。原 header/composer chip 方案与 `chip.js` 已删除；Sidebar Game Market 入口保留。
  - V0-09（V1-19 更新）：同一 Session 内**首次**点该 tab 进 Market；玩过并返回工作后再次点 tab 直接**恢复该游戏**（平台暂停确认），不再回 Market；Market 改从 Sidebar 或游戏内「返回市场」进入。
  - V0-10：恢复游戏只保留平台一次「已恢复上一局」确认；平台确认后游戏直接开始（含 saved `ready`，`resume.js` 仅 IGNORE/PLAY），不再显示游戏内第二个遮罩，并 focusBoard。Agent 快照在页面可见且绑定 session 时轮询，不再依赖 chip surface。
  - V0-11：**真实 Agent 事件源必须是 `ctx.on('session/event', (session, event) => …)`**。`turn/end` / `tool/result` / `approval/*` / `assistant/message` 是 session log 事件，`ctx.on(type)` 在真实 DSH 中永不触发；Cordis 只有 `agent/pre-step` / `agent/disposed`。Host 映射：turn/end kind → completed/error/idle；approval/asked → waiting；approval/decided → running；tool/call → specific labels。V0.3 修复前“运行中”能显示而“完成/等待”永远不出现，就是此原因。
  - V0-06：entry 的 CSP `frame-ancestors` 在 V0 使用 `*`。原因：DSH Host 侧看到的请求 origin（`dsh.internal`）与嵌入页面实际 origin（loopback Web UI）可能不同，单一 origin 会阻止 iframe 加载；游戏是不可信静态内容且受 sandbox 隔离，V0 接受该放宽，V1 改为可配置 allowlist（PRD §8.10）。
- V1 用户锁定决策（2026-10-18）：
  - V1-01：首发游戏四款 = `snake`（内置，计入）+ `jump`（跳跃）+ `2048` + `breakout`（打砖块）。其中 `jump` 为用户指定，`2048`/`breakout` 由 Lead 按“好玩/吸引人/单文件可实现”选型锁定。
  - V1-02：V1 继续单文件自包含游戏；多文件资源（图片/音效/zip）放 V1.5。
  - V1-03：Registry = 静态索引 + 本地/远程安装包；不做服务端 Registry（用户无服务可托管）。
  - V1-04：Market 前端“视觉成品感”和“功能完整度”都要做，不二选一。
- V1-05：包格式 = 单文件 HTML 内嵌 manifest v1（`<script type="application/json" id="dsh-game-manifest">`）；Registry 仅存 URL/sha256/元数据；不引入 zip。
- V1-06：安装模型：`installed/<id>/<version>/entry.html` + `installations.json`；存档与安装分离；卸载不删存档；内置游戏不可卸载。
- V1-07：SDK v1 必须向后兼容 V0 游戏；`snake` 迁移到 v1 但保持契约兼容。
- V1-08：V1 分支计划见 §2.1.4；Lead 独占 `shared`/根配置/记忆，新增子智能体 A（install-registry）、B（developer）、C/D（games）、E（market-ux）。
- V1-09：V1 安全底线：sha256 强制、HTML-only、大小/路径/版本校验、下载超时/重定向限制、CSP frame-ancestors 收紧为 allowlist。
- V1-10：PRD 已升级 **v2.2** 并全篇统一到单文件包口径；后续契约以 PRD v2.2 + 本节 + `docs/V1-CONTRACTS.md` 为准，不再保留旧 zip 规范。
- V1-11：命名统一（D-035）：`packages/<id>/<version>/entry.html`、`registry/games.json`（`registryVersion:1`）、`registry-cache.json`、current+1 回滚版本、Registry allowlist（默认 GitHub 三家 + 可配置 `allowedHosts` + 同 host 规则）。
- V1-12：V1 首发只做锁定四款；DSH-native Demo 由用户亲自带人后续推进，不纳入 V1 验收/发布门槛（D-036）。
- V1-13：SDK/Runtime v1 = `1.0.0`，`protocolVersion` 仍为 1；SDK v1 公开面沿用 PRD §8.3；snake 在 M1c 迁移到 `sdkVersion ^1.0.0`；V0 遗留按滚动项处理。
- V1-14：Registry 预览图仅**绝对 https URL**（Host 缓存 `preview-cache/`，`/preview` 同源提供）；包内 manifest `icon` 用 data URI，仅用于已安装/本地/开发来源。Registry 索引**整份严格校验**，不做"跳过坏条目"，任一条目非法即整份拒绝并回退缓存（E_REGISTRY_INVALID → GM-5032）。
- V1-15：CSP `frame-ancestors` 配置键 `config.security.frameAncestors: string[]`，默认 `["'self'","http://127.0.0.1:*","http://localhost:*"]` + Host 按绑定地址追加 loopback origin；V0 的 `*` 不再使用；真机不符时只能配置追加、不回落 `*`（S-16 复核）。
- V1-16：安装全局串行 = 进程内队列 + 跨进程锁 `staging/.install.lock`（心跳 5s、30s 无心跳可接管）；等锁 10s 后 `GM-4091`；安装/卸载互斥 `GM-4097`。
- V1-17：内置游戏**不写** `installations.json`，由 `games/snake` 直接服务并在 Market 列表合成 `source:'builtin'`；不可安装/更新/卸载。
- V1-18：`/entry` 实例绑定 TTL = 10 分钟（`TIMING.entryBindingTtlMs`），退出/卸载/超时即失效；Host 仅在内存维护 launch 绑定。
- V1-19：会话 tab 游戏入口按 **Session** 记忆：首次点击 → Market；在该 Session 玩过游戏并返回工作后，再点 tab → 恢复该游戏（`resume-paused` 确认）。记忆在 module store（`sessionGames`，随页面生命周期）；是否跨刷新持久化留 M3 再定。Market 浏览入口保留在 Sidebar 与游戏内「返回市场」。
- V1-20：**“游戏运行中” = 活跃 Runtime 实例**（`/launch` 后未 release），不是未结束的 Play Session。Host `isRunning` 不再用 `sessions.findRunning`；新增 `POST /runtime-release {gameId}`，Client 在 Runtime 卸载/离开时调用。未结束 Session 保留（Continue + 卸载重装继承），但不再阻止更新/卸载。原因：用户本地安装 breakout 后想卸载重装，被历史未结束 Session 判为“运行中”卡死，且 UI 无结束入口（2026-10-18）。

---

## 6. 当前状态与工作日志

> 规则：Lead 每完成一个阶段追加一条（日期、阶段、commit、结果、下一步）。历史细节以 git log 为准，本节只保留最近 10 条。

- 2026-10-18 · **V0 完成**：全量 `npm run verify` 通过（312 tests / 312 pass、严格 check 13 项、构建确定性）；隔离 DSH 0.2.1-rc.2 + headless Chrome 真机验证 V0-01～V0-15 核心链路；证据见 `docs/V0-VERIFICATION.md`。
- 2026-10-18 · **V0 已发布**：`main` 合并提交 `bcdbbfc`，tag `v0.0.0` 已推送 GitHub；feature worktrees/分支已清理（main + origin/main）。下一步：日常桌面端自测（用户执行 dev:enable 并重启）→ V1 规划。
- 2026-10-18 · **V0.1 反馈修复**：等待提示移至会话头标题右侧并本地化「游戏/Game」+ 可爱动效；弹层居中/翻转；修复继续游戏后 ready 状态静止棋盘 + 键盘焦点丢失（新增 `resume.js` 策略与 3 个测试）；dev-enable 兼容空数组 `[]` profile patch；全量 315 tests 通过。
- 2026-10-18 · **V0.1 已发布**：`main` merge `55bc9f8`，tag `v0.0.1`；等待提示位置/动效/弹层对齐与 resume 卡住问题已修复，验证证据更新在 `docs/V0-VERIFICATION.md`。
- 2026-10-18 · **V0.2 反馈修复**：入口改为会话 tab 行常驻「游戏 / Game」（conversation.view），点击进 Market；删除 chip 组件；恢复游戏只保留平台一次确认并直接开玩；轮询改为绑定 session 即可工作；全量 314 tests 通过。
- 2026-10-18 · **V0.2 已发布**：`main` merge `3bfea76`，tag `v0.0.2`；验证见 `docs/V0-VERIFICATION.md`。
- 2026-10-18 · **V0.3 修复**：Host 改订阅真实 `session/event`，修复 Agent 完成后游戏内无提示；真机验证真实 turn/end(error) 到达 Host；单测覆盖完成/取消/审批映射；全量 314 tests 通过。Host 改动需重启 DSH。
- 2026-10-18 · **V0.3 已发布**：`main` merge `c476266`，tag `v0.0.3` 已推送；验证见 `docs/V0-VERIFICATION.md`。
- 2026-10-18 · **V0 用户验收通过**：用户确认 V0.2 入口/恢复与 V0.3 完成提醒在真实桌面端正常工作；“v0 基本验收完毕”。V0 范围（V0-01～V0-15，含 V0.2/V0.3 调整）收官。
- 2026-10-18 · **V1 计划锁定**：四条主线 + foundation；首发 `snake`/`jump`/`2048`/`breakout`；单文件；静态 Registry + 本地/远程包；Market 视觉与功能都做。分支/owner/write scope/验收见 §2.1。下一步：Lead 开 `feat/v1-foundation`。
- 2026-10-18 · **V1 四项遗留裁决 + PRD v2.2 统一 + M0 开工**：用户确认 ①V1 包格式=单文件（V1.5 多文件）②P1 命名/路径由 Lead 统一并双向维护 PRD+记忆 ③首发只做四款，DSH-native Demo 用户亲自带人、不阻塞 V1 ④SDK 版本与 V0 遗留随迭代。已开分支 `feat/v1-foundation`，正在执行 M0（PRD v2.2、shared 契约/校验器/路由表、契约测试、四游戏验收清单）。下一步：M0 `npm run verify` 绿 → `chore/v1-integration` → 并行 M1a/M1b/M1c。
- 2026-10-18 · **V1 M0 已合并 main**：`chore/v1-integration` 合并 `b8aa17a` → `main` `git merge --no-ff` 为 `d81f473`；合并前后各跑一次 `npm run verify` 均 **345/345** 通过；`main` 已推送 origin（`28b75de..d81f473`）。未打 tag：`v1.0.0` 留到 V1 验收完成后。**M1 搁置**：用户要求等明确指令后再开 M1a/M1b/M1c，当前不新建工作树。
- 2026-10-18 · **V1 M1 派发开工（总调度模式）**：按用户指令，Lead 不再直接写业务代码。已建 7 个仓库外 worktree + 7 个 feature 分支（基础 `b84256b`），并派 7 个子智能体各自在 worktree 内独立完成：M1a `feat/v1-install-registry`、M1b `feat/v1-developer`、M2 `feat/v1-market-ux`、snake `feat/game-snake-v1`、jump `feat/game-jump`、2048 `feat/game-2048`、breakout `feat/game-breakout`；M2 强制使用 `frontend-design`+`ui-ux-pro-max`，2048 两者都用，snake/jump/breakout 用 `ui-ux-pro-max`。派发细节见 §2.1.7。下一步：等各分支完成报告 → Lead 逐个验收 → 合并 `chore/v1-integration` → 全量verify → `--no-ff` 合 `main`。
- 2026-10-18 · **V1 M1 完成并合并 main（总调度模式收官）**：7 个子智能体在各自 worktree 内完成全部 M1 任务，Lead 逐个独立验收（范围/测试/构建/截图）后合入 `chore/v1-integration`；集成期 Lead 完成 shared 错误码表、根构建/检查接入全部游戏、`BUILTIN_GAMES.version`/snake 源清理、文档对齐、全部 dist 重建。集成分支最终 `npm run verify` **752/752 pass、CHECK OK (21)**、构建字节可复现；`--no-ff` 合并为 `main` `44cd7a8`。7 个 feature worktree/分支已清理，`chore/v1-integration` 保留。**M1 范围完成**；真机验收与 `v1.0.0` tag 留 M3。
- 2026-10-18 · **用户验收发现 Market 白屏 → 已修复（`b933fe4`）**：用户在桌面端验收时打开 Market 白屏。用隔离 DSH 0.2.1-rc.2 宿主 + 复制用户真实 storage（V0 saves/scores/sessions）复现：Market Hero 的“继续游戏”分支调用 `coverTone()` 但 `market-home.js` 未 import（空 Hero 路径的单测覆盖不到），React 抛 `ReferenceError` 卸载整个 main slot → 白屏；同批还发现 `detail.js` 缺 `initialFor`/`resolvePermissions` import。已修复并新增 `packages/client/test/component-imports.test.js` 源码级回归（组件不能直接渲染测试：零依赖测试环境无 react）。修复后 `npm run verify` **754/754**，隔离宿主 + 真实数据 headless 流程复测 Market 首页/详情正常、0 console error；client.js 已重建并推送 main。
- 2026-10-18 · **Game tab 会话内行为调整（`a6885fd`）**：用户要求“同一 session 首次点游戏去 Market，玩过并返回工作后再点游戏应回到该游戏”。已实现 per-session `sessionGames` 记忆 + `selectGameEntry` 决策 + `entryGameSpace` 纯逻辑（新增 `entry-flow.js` 与 5 个单测）；`npm run verify` **765/765**。待用户在桌面端点验：刷新后新 session 首次进 Market → 玩一局 → 保存并返回工作 → 再点游戏应直接回该游戏。
- 2026-10-18 · **恢复游戏双重提示修复（`4e70958`）**：用户截图发现“返回工作→再返回游戏”时平台弹「已恢复上一局」、breakout 又弹自己的 Continue/New run。根因：平台 resume-paused 启动会给游戏发 pause → 等确认 → resume（snake/2048/jump 已按此实现），breakout 启动时无条件 `showStartOverlay()`。修复：resume-paused 启动时丢弃自身开始菜单、恢复棋盘并只显示暂停态（平台弹窗为唯一确认），确认后直接开玩；pause 竞态也会替换开始界面。重建 `games/breakout/dist`；`npm run verify` **765/765**；已推送 main。此外 V1-19 会话 tab 行为同日落地（`a6885fd`）。
- 2026-10-18 · **“游戏正在运行”卡死卸载修复**：根因 Host 把“未结束 Play Session”当运行中，但 Session 为 Continue 长期保留且无结束入口。改为 live Runtime 实例判定 + 新增 `/runtime-release`（Client Runtime 卸载时释放）；Host 测试覆盖 launch→4096→release→成功、以及“未结束 Session 不阻止卸载”；`npm run verify` **766/766**；契约文档同步；需重启 DSH 生效。
- （待续）

**当前状态 / 待用户确认**：

- **V1 M1 已完成并合并 `main`**（`44cd7a8`；M1 收官 752/752；`npm run verify` 现 754/754、CHECK OK (21)）。**用户正在做桌面端人工验收**；首个问题（Market 白屏）已定位修复并推送（`b933fe4`，client-only，刷新页面即可生效）。**M3 待办**：隔离 DSH 0.2.1-rc.2 真机验收（U/DEV/FM/SEC 全表 + 启动计时/5 分钟/平台暂停遮挡）、`docs/V1-VERIFICATION.md` 归档、通过后打 `v1.0.0` 并推送；M2 组件此前只做过逻辑/静态渲染测试，**真实 loader 渲染验收仍是 M3 必做项**。
- 日常桌面端需用户自行 `npm run dev:enable -- --yes` 并重启 DSH；UI 客户端改动刷新页面即可。
- 想在**日常桌面端**看到 V0：需要用户执行 `npm run dev:enable -- --yes` 后重启 DSH（会自动备份 profile patch；Lead 不会擅自改用户日常 profile）。日常 profile 的隔离验证已完成，无需重复；用户桌面端版本已确认为 0.2.1-rc.2，与验证基线一致。
- GitHub 推送权限：若 `git push` 失败，需要用户提供可用凭据或代为推送。

---

## 7. 交接模板（子智能体完成后按此报告）

```text
分支：feat/xxx
commit：<hash>
完成：<对应任务/PRD 章节>
改动：<目录/文件列表>
验证：<命令 + 结果>
未完成/风险：<逐条>
需要 Lead 处理：<契约变更/合并顺序/依赖>
```
