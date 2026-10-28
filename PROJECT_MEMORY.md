# DSH Game Market · 项目记忆

> **本文件是全项目唯一的项目记忆文件（Single Source of Project Memory）。**
> 任何项目级约定、状态、决策、交接信息都只记录在这里；其他文档（`PRD｜DSH Game Market.md`、`README.md` 等）是规格或说明，不是记忆。
> 项目记忆由主会话统一维护；开发 Agent 交付状态与证据，由主会话复核后同步。
> 用户最新明确指示优先。实现规格以 PRD 第 8–12 章及对应契约为准；本文件记录协作规则、当前状态和交接信息。

- 项目：`dsh-game-market`（DSH 内的小游戏市场与运行平台）
- 线上仓库：<https://github.com/heswy/dsh-game-market>
- 本地工作区：`/Users/orange/Orange Field/Matterhorn/dsh-game-market`
- 当前目标：**V1.5 M5 本机工程验收交付，等待复核；正式发布未放行**。M0–M4 已合入（M4 PR #10：`e700eea`）。M5 PR #11、内容 PR #6：1570/1570 + CHECK44、真实407031ms游戏、直接公开 Git 安装10/10、同资料真实两跳33/33、游戏进度导入/重开、确定性包和内容CI均已取证。用户只有自己的账号；独立外部作者与两台实体机迁移仍未验证。无 V1.5 生产 tag、Release、stable 推广；当前权威矩阵见 `docs/verification/v1.5/m5-acceptance.md`。以下较早阶段记录保留为历史。
- 历史：V1 验收/修复过程（M3 自动化、真机代执行、codex 两轮 review CR-01..09）见 `docs/V1-VERIFICATION.md`、`docs/verification/v1/AUTOMATED-EVIDENCE.md`、`docs/reviews/2026-10-19-codex-acceptance-review.md` 与 `git log`。
- 权威规格：`PRD｜DSH Game Market.md`（**v2.2 + V1.1 呈现修订 + 社区投稿 §8.14 / D-038**；第 8–12 章为开发权威来源；全出血/安全区见 §9.6.1、D-037）
- 开始记录：2026-10-18

---

## 1. 项目规则（必须遵守）

### 1.1 Git 规则

1. 仓库已初始化：`main` 跟踪 `origin/main`（`origin = https://github.com/heswy/dsh-game-market`）。
2. **`main` 是集成分支，不直接开发功能。** Git 合并、远端写入、发布和打 tag 按用户授权执行；合码不自动授权发布或打 tag。
3. 所有开发在短生命周期分支上进行；Codex 新分支默认 `codex/<topic>`，用户指定或已有分支保持原命名：
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
6. 合并：以固定 PR head 复核并通过 `npm run verify`（build + check + test），得到用户合并授权后，以 merge commit（`--no-ff` 或 GitHub merge 方法）合入 main；不强制增加中间集成分支。PR head 或基线发生实质变化时重新核对验证范围；集成通过不等于已经发布。
7. 禁止 `git push --force` 到 `main`；禁止改写已推送历史；不 `git reset`/`clean` 丢掉用户改动。
8. 推送：按任务授权提交开发分支、开 PR 或更新远端；没有远端写入授权时保留本地交付。推送失败必须记录，不能报告为远端已同步。
9. 版本 tag：V0 完成打 `v0.0.0`；之后按 `v<major>.<minor>.<patch>`。
10. 不把任何 token/凭据写进仓库、日志、记忆或测试夹具。

### 1.2 协作规则

1. 主会话负责架构、方案、任务指南、开发标准、仓库协调、review 和验收；用户选择其他开发 Agent 实施、验证、修复并开 PR。主会话不自动派发开发 Agent，也不默认接管实现；直接实现须有用户明确指派。
2. 可复用开发规则集中在本文件；任务指南引用本文件，只增加任务范围和验收要求，不复制另一套协作规则。
3. 开工先读本文件、任务指南、PRD 对应章节与共享契约；保留用户修改。开发 Agent 在独立 worktree/分支工作，按授权修改共享契约与工具，不自行扩大范围或修改用户 DSH profile。
4. 交付报告必须包含固定 SHA、分支、改动、实际验证结果和未完成项；主会话在隔离 checkout 复核。不得把 mock、模拟器或 headless 证据写成真实公网/桌面 Host 验收。
5. 不自动合并、发布或打 tag，不自动向其他任务或外部人员发消息；相关动作遵循用户在会话中的授权。
6. 平台 Host/Client/Runtime/SDK 保持现有零新增第三方依赖约束（Client 使用 react）；新增依赖须先明确决策。开发者 React 模板的构建依赖按其模板契约管理。
   - **V1.5 已批准的限定例外（2026-10-19，PRD D-040）**：`packages/host/src/zip.js` 及其测试**允许** import `yauzl@3.4.0`（唯一传递依赖 `pend@1.2.0`，均 MIT），精确版本 + integrity pin，发行 Bundle 必须放进真实 `dependencies`。其余位置（`packages/client|runtime|sdk|shared`、`games`、`scripts`）仍为零新增依赖。详见 `docs/V1.5-CONTRACTS.md` §2。

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
- **静态 Registry**：索引 `registry/games.json`，`{registryVersion:1, generatedAt, games:[{id, version, …, package:{url, sha256, size, releasedAt}}]}`；`url` 必须 https、路径末段 `<id>-<version>.html`，或（仅本地 file Registry）Registry 目录内相对路径。默认 allowlist = `github.com`/`raw.githubusercontent.com`/`objects.githubusercontent.com`/`release-assets.githubusercontent.com`（PR #5 公网重定向补充），可配置 `allowedHosts`；包 host 必须在 allowlist 或与索引同 host；重定向 ≤5 且不降级 http；缓存 `registry-cache.json`（TTL 6h、陈旧上限 14 天、离线回退、≤500 条/≤2 MiB）。
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
- **M3 自动化（2026-10-19 完成）**：隔离 `app.asar` + `dsh web` + headless Chrome 155 执行；AE-01..17 通过（767/767、构建确定性、契约 9/9、snake 30/30、四款 87/87、SDK/Runtime 124/124）、AE-18 部分；新增 `scripts/verification/{make-fixtures,host-e2e,ui-evidence}.mjs`；host E2E 覆盖 file/HTTPS Registry 安装、1.0.0→1.0.1 更新、卸载保留数据+重装 Continue、entry 安全头、存档配额/CAS/损坏恢复、恶意包拒绝矩阵、幂等/并发；UI 证据 9 张截图（含平台暂停单层弹窗）。**真机剩余项见 REAL-MACHINE-CHECKLIST.md**；U-03 详情截图因选择器失败未取得（需重跑或真机补）。
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

- Node ≥ 20（本机 v24.14.0）。**V1.5 M0 之前**零 npm 依赖、不需要 `npm install`。
- **自 M1 起（PRD D-041 预告，实施时生效）**：为 `asset-zip-v2` 引入 `yauzl@3.4.0`（见 §1.2.6 例外）后，仓库首次需要安装运行时依赖，`npm run verify` **不再能在无 `node_modules` 的全新 checkout 上直接跑**；CI 与本地须先安装依赖，`scripts/check.mjs` 在缺依赖时给出可操作失败信息。README 快速开始同步修订。
- DSH 基线：Desktop **0.2.1-rc.2**。V1.5 实测：**真实 Desktop 是 HMR 能力开启的 profile**（详见 `docs/verification/v1.5/support-matrix.md` §3）。
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
- V1-21：**`launchMode` 随 init 显式下发**（SDK `game.runtime.launchMode`）：平台 `resume-paused` 启动时，游戏据此隐藏自己的“继续/开始”界面并保持暂停，平台弹窗为唯一确认；不再只依赖 `pause` 生命周期事件的到达时序（Electron 桌面端曾出现时序差异导致双层）。Runtime/SDK 契约扩展向后兼容（旧 SDK 忽略新字段）。
- V1-22：**会话 Game tab 返回 = 直接恢复，不再弹平台确认**（`autoResume: true`）：用户点击 Game tab 本身就是确认，Runtime 进入 paused 后立即 resume；Market 详情「继续游戏」/Agent 恢复等其他路径仍保留 D-024 一次确认。原因：用户验收时把平台确认弹窗视为剩余“双层提示”（2026-10-19）。
- V1-23：**暂停 UI 归属统一**：平台发起的 `pause` 只冻结/保存游戏，**不渲染游戏自己的暂停面板**（否则与平台「已暂停」弹窗双层）；本地暂停（游戏内按 P/Esc）仍画自己的暂停面板。四款游戏已统一：breakout/jump/2048/snake 的平台暂停路径均 `hideOverlay()`；已用真实平台 E2E 验证（四款平台暂停时游戏层 0 个可见 overlay，恢复后游戏继续）。
- V1-24：**M3 自动化证据归档与真机分工**：自动化可覆盖的验收（构建/测试/CLI/Registry/安装生命周期/安全头/存档/拒绝矩阵/幂等）已执行并归档于 `docs/verification/v1/`；真机只保留交互/真实 Agent/性能/故障注入。证据纪律：不预填通过、模拟标注、未执行写「未执行」。
- V1-25：**AskUserQuestion 提示**：`AskUserQuestion` 在 Session 日志里是普通 `tool/call`（工具名 `ask_user_question`），未回答期间没有 `tool/result`；Host 在 `tool/call` 时置 `waiting-user`（`agent.state.waiting.question`，source=question），`tool/result` 后回 running。仅匹配工具名，不读问题/参数内容；不依赖 `userQuestions` 投影（比 PRD 原 Spike S-14 方案更稳）。Host 单测覆盖；需重载 Host（插件行 off/on 或重启 DSH）后真机复测。
- V1-26：**提问等待态收尾**：真实 DSH 的 `tool/result` payload 不带工具名（仅 tool message），V1-25 按工具名匹配会卡在 waiting-user；改为「`waiting-user` 且 `source=question` 时，收到 `tool/result` 即回 running」，审批等待仍由 `approval/decided` 关闭。Host 单测更新（结果事件不带 name）；用户实测提问提示已出现，此修复解决“回答后提示不消失”。
- V1-27：**M3 真机收口**：U-06 提问提醒（出现+回答后消失）与 U-08 应用级关闭重开已由用户真机确认通过；剩余仅真实审批（环境禁用）、字号/减少动效、性能采样与 DEV-03/07 非阻塞项。
- V1-28：**CR-01 默认分发放内置**：`registry/games.json` + `registry/packages/<id>-<version>.html` 由 `scripts/build-registry.mjs` 从 `games/*/dist` 确定性生成，`build.mjs` 接入、`check.mjs` 校验、`package.json.files` 含 `registry/**`；全新存储可直接发现/安装 Jump/2048/Breakout。
- V1-29：**存档真实删除**：新增 `POST /save-remove`（shared route/api-client/Host/runtime）；`storage.remove` 不再写 `data:null`；删空存档视为无存档（404/无 Continue）；`data:null` 保留为普通值。
- V1-30：**运行实例生命周期**：entry 凭证 TTL 与实例寿命分离；Client 每 60s `/runtime-renew` 心跳；`/runtime-release` 按 `instanceId` 只释放单个实例；崩溃/断网停止心跳后 TTL 回收。
- V1-31：**提问结果关联**：记录 ask_user_question 的 `callId`（tool/result 在 `message.source.callId`）与 turn；只有匹配结果关闭等待，旧 turn/并行结果不清除；`turn/end` 收尾取消/中止。
- V1-32：**验收可复查/可判定**：`.gitignore` 例外 + sanitize 脚本把证据日志纳入 Git；`assert.mjs` 统一断言并让采集脚本失败非零退出；A-11 断言游戏内部推进；性能指标拆 shell/cards-ready/runtime-playing 并多次采样。
- V1-33：**codex 复核第二轮收口**：CR-02 `pathExists` 仅 ENOENT 视为缺失 + 删除前 preflight；CR-05 Client 无 instanceId 不调用 release（`shouldReleaseRuntimeInstance`）；CR-06 有 callId 时无名/并行结果不清除、turn/end 只匹配本 turn；CR-08 冻结自测必须 exit 1、perf 全样本断言、A-11 周期采样真实推进；CR-09 详情等待移出计时（launch 实测 105–107ms）。codex 审核文档归档到 `docs/reviews/2026-10-19-codex-acceptance-review.md`（此前误随首轮修复提交，已用 git mv 说明）。
- V1-34：**V1.0.0 发布**：`fix/m3-review` 两轮复核通过后以 `--no-ff` 合入 `main`（`643fcb9`），`package.json` 版本置 `1.0.0`，tag `v1.0.0` 推送；README 更新为 V1 首发状态；V1 验证文档/证据/真机结论归档。发布后滚动项：真实审批环境、桌面参考机性能终值、字号/减少动效真机项、DEV-03/07、2048 PB 反馈、完整 Tab 键盘链路（均已在验证文档 §5 记录）。
- V1-35：**PR #2 全出血呈现契约复核**：平台常驻控件避让区统一为顶部全宽 112px（控件 clearance 限制 0–48px）和右下 96×96；鲸鱼展开消息可临时覆盖右下 254×184。manifest viewport 仅为推荐设计尺寸，SDK init/ready viewport 为实际容器 CSS 尺寸与 DPR。Vanilla/React 模板同步全出血、HUD 避让与实际尺寸绘制；React 构建先类型检查，禁用带 fetch 的 Vite preload polyfill。
- V1-36：**V1.1 UI/呈现改进合入**：PR #1（Market header/hero/详情、侧边栏去状态、会话 Game tab 状态 pill；用户补充 gallery 视觉 `8ab8004`）合入 `b4c640b`；PR #2（Runtime 全出血、删除黑边/舞台内边距、`viewport` 降为推荐尺寸、安全区规范、Vanilla/React 模板、开发者指南 §4.4）合入 `58fb5ce`；用户 follow-up `395ed75` 把顶部安全区收敛为全宽 112px（控件 clearance 0–48px）、澄清 SDK viewport 为实测容器尺寸、React 模板类型检查/去 fetch polyfill。验证 787/787。`v1.0.0` tag 不动；发 `v1.1.0` 前先定版本与验证记录。
- V1-37：**V1.1.0 发布**：PR #3（locale）合入 `192aa6a` 后，`package.json` 升 `1.1.0`，README/验证文档/开发者指南/证据索引更新；以发布提交打 tag `v1.1.0` 并推送。发布内容：UI 收口、Runtime 全出血、开发包呈现/安全区规范、宿主 locale 文案。`v1.0.0` tag 不动。

- V1-38：**社区投稿 MVP 合入（PR #4）**：作者侧 `dsh-game-developer` Skill、submission/review/owner/catalog 契约、内容仓库模板/CI、维护者发布工具与官方 HTTPS + 随包 seed 兜底已合入 `2b45b2e`；包与 Runtime 协议不变。先校验候选再远端写入，draft 资产认证核验，撤下后仍保留不可变归属/审核历史，Git 回滚失败显式报告；CR4-01～06 全关闭。C-21 独立本地纠错、C-22 独立模拟器更新/旧 save 继续已有证据，不代表真实 Host 或公网发布通过。M4 与发布继续独立验收/授权。

- V1-39：**受控 M4 与 V1.2.0**：受控作者 `heswy/dsh-game-test-author` 经真实内容仓库 PR #3/#4/#5 完成 1.0.0→1.0.1→撤下，目录为空、owner/review 审计保留；独立 Host 从固定目录快照安装/启动 SHA 一致，不等同真实 DSH App 验收。平台 PR #5 合入 `e247b93`：精确放行 GitHub Release 的 `release-assets.githubusercontent.com`；draft 认证 REST 数字资产 id、分页查找与 fail closed；脱敏 M4 日志已跟踪并纳入 check。用户授权合码/打 tag，平台版本升 1.2.0；内容仓库 toolchain pin 更新通过后续独立 PR，不自动修改其他仓库。

- V1-40：**V1.5 正式对外首版规划**：用户指定资源包+新内置游戏、DSH 平台持续一键更新、DeepSeek Logo 鲸鱼与原地问答。HTML/ZIP 并存、两代游戏目录隔离；插件安装由 DSH 管理器执行，非 HMR Desktop 覆盖安装/待重启是必须实证路径，HMR 需独立能力门；open 问答复用原生 pending channel，continued 走宿主 answer，危险权限不由游戏批准。指南及能力记录位于 `docs/plans/2026-10-19-v1.5-*`；均为待实施方案，M0 先验证宿主能力并冻结契约，正式发布门槛见指南 §8。
- V1-41：**V1.5 M0 探针与契约冻结（2026-10-19 完成，PR 待复核）**：分支 `feat/v1.5-m0`（从 `origin/main` `f422e8d` 建，`--no-ff` 合入本地指南分支 `codex/v1.5-development-guide`），M0 证据提交 `50f27ad`。S-U1/U2/U3、S-Q1/Q2、S-A1、S-B1 **全部通过**（required 断言 0 失败），主证据索引 `docs/verification/v1.5/host-spikes.md`。冻结 `docs/V1.5-CONTRACTS.md`（1429 行）、ZIP 依赖裁决（`yauzl@3.4.0` + `pend@1.2.0`）、支持矩阵，PRD 新增 D-039～D-050 与 S-26～S-32。**三条改变设计的事实**：① 真实 DSH Desktop 是 **HMR 能力开启**（推翻指南「非 HMR Desktop」前提），主更新路径为 git URL+精确 commit 的**在线替换**（`applied`，无需重启；`already-installed` 只是幂等保护；URL 形态重复点击是 `ambiguous-install`）；② HMR 能力判定必须在 Loader 树稳定后**轮询采样** `manager.ownerContext.get('hmr')`（t=0 为 false 的竞态）；③ 资源服务**不能复用 DSH `/api`**（opaque-origin 被围栏 403），必须用独立 loopback 资源 origin；open 问答**不能调用 `pending.dismiss()`**（unnamed blocking 卡那是取消请求）。**未验证项**见 host-spikes.md §6，未推进 M1～M5 实现。
- V1-42：**M0 复核修正轮（2026-10-19）**：Codex 对固定 head `240c5d4` 复核，**接受方向**（HMR 主路径、独立资源 origin、只收起自绘问答 UI、`yauzl` 依赖例外），要求先修 4 项。已全部处理：① [P1] **资源隔离遗漏 iframe 自导航** —— 新增 CR-P1 探针实测缺口（子文档自身 CSP 拦不住自己的导航，负对照实测外泄）并验证缓解：**平台自服务的同源 wrapper** 用 `frame-src <resourceOrigin>` 阻断（Chromium 155，且不依赖 host 页面策略）；契约新增 §7.5.1，CSP 因果改为**按 origin 匹配**，validator 的绝对 URL 拒绝降级为创作期规则（PRD D-051、契约 D-U/D-V/D-W）。② [P2] §9.4/§9.5 更新成功语义统一为单状态机 `inspecting→installing→applied→activating→updated`，`applied` 为中间态、核验前不得报成功，补 `verification-failed`/`stale-runtime`/`pending-restart`，删除过期「B→C 未验证」。③ [P2] S-A1 两条 stdout 日志纳入 Git、`.gitignore` 增加 V1.5 证据例外、`check.mjs` 新增「证据文档引用的文件必须存在/未忽略/已跟踪」断言（CHECK 39 项）。④ ZIP 条目口径统一为**总条目含描述符 ≤512 → `files[]` ≤511**；残留 TBD 清理完毕。另删除 v2 CSP 的 `upgrade-insecure-requests`（loopback http 风险）。复验 `npm run verify` 840/840、CHECK OK (39)、CR-P1 4/4。
- V1-43：**合并门禁去抖动（2026-10-19，测试侧）**：跑 M0 复核修正轮的 `npm run verify` 时发现**既有**竞态导致偶发失败——并行负载下 `packages/host/test/cases/v1-registry.js` **12/12 失败**、空载 0/12 失败，且在复核 head `240c5d4` 上同样 12/12 失败（**非本轮引入**）。两个测试侧根因：① `registry-layered.start()` 只等 **250ms** 有界窗口（为不让挂起的远端阻塞 list/health），测试在 `ready()` 后立刻断言 `activeSource` 会与远端赛跑 → 改为轮询到期望来源（真正坏掉的 official 仍会在超时后失败）；② harness 用普通递归 `rm` 清理临时目录，后台预热下载仍在写 → `ENOTEMPTY` 撕裂 → 改用 `fs.rm` 的 `maxRetries`/`retryDelay`。**未改任何产品代码**；复验 12/12 并行干净、3 个并发全量套件 2520/2520、`npm run verify` 840/840。
- V1-44：**CR-P1 探针假通过修正（2026-10-19，第二轮复核）**：Codex 复核 `18c219b` 指出 C3（wrapper 阻断自导航）**没有真正验证外部导航**——wrapper 未转发 `?to=`，游戏执行 `location.replace(null)`（同源相对路径）；且 C3 顶层页面当时也带 CSP，无法归因给 wrapper。已修正：① wrapper 转发导航目标给子 iframe；② C3/C3c 顶层页面**一律不发 CSP**，探针把 `topLevelCsp` 记入报告（均为 `null`）使归因可审计；③ 新增 **C3c 对照**（同 wrapper 去掉自身 CSP，**必须泄漏**）；④ 新增 `attemptedTarget`/`aimedAtSink` 断言，判定要求「游戏运行 + 目标确为外部 sink + 泄漏符合预期」三者同时成立。结果 C1 泄漏 / C2 阻断 / **C3 阻断** / **C3c 泄漏** / C4 泄漏，5/5 符合预期；契约 §7.5.1 结论不变（wrapper 方案成立），`resources.md` 增「修正记录」如实记载旧版为假通过。教训：安全类探针必须自证可证伪——需要**对照组**与**「真的尝试过」的正向证据**，否则「被阻断」可能只是「什么都没做」。

- V1-45：**V1.5 M1 实现完成（2026-10-20，`feat/v1.5-asset-packages`，基线 `a762449`）**。M1 只做资源包/两代目录/资源 origin/开发工具最小面，**不推进 M2～M5**。四条并行工作流：
  - **M1-A 归档链路**：`packages/host/src/zip.js`（yauzl 封装 + §4.1 十一项政策、`decodeStrings:false`/`lazyEntries`/64 KiB 分块/双层限额/CRC/本地头一致性/ZIP64 与嵌套归档显式拒绝/只解压到 staging）+ 安装管线 + 崩溃恢复（`installations.js#verifyInstalledRecord`，单一判定点）+ A03 恶意包矩阵。`yauzl@3.4.0`（+`pend@1.2.0`，均 MIT）精确版本，`THIRD-PARTY-NOTICES.md` 落地，`check.mjs` 断言「版本精确/无安装脚本/引入点唯一（只允许 `zip.js` 与其测试）」。**从 M1 起 `npm run verify` 需要先 `npm install`**。
  - **M1-B 两代目录**：`/registry/games.json`（v1，字节与改动前一致，只含 html-v1 投影）与 `/registry/v2/games.json`（v2，`package.format` 必填）并存；`registry-cache-v2.json`（schemaVersion 2）与 v1 缓存彻底隔离；默认源 **v2 → v1 → seed** 降级；catalog v2（`releases[]`/`withdrawnAt`）双投影生成器确定性（同输入字节一致，实测两代 hash 相同），旧 v1 catalog 在内存升级无需迁移。
  - **M1-C 资源 origin**：`packages/host/src/resources.js` 独立 **loopback** origin（`/res/<instanceId>/<resourceToken>/<path>`），实例绑定凭证 + renew/release/TTL + 一次性 launch（首 GET 200 消费、重放 410）；路径只映射已校验清单、精确 MIME+魔数、`no-store`/`nosniff`/`no-referrer`/`ACAO:*`；入口文档 CSP 精确到 origin，wrapper 文档做 `frame-src` 阻断与 Bridge 点对点 relay。
  - **M1-D 客户端接入**：Runtime 按 format 分叉（zip 走 wrapper 两层、html-v1 走 V1 单层）、Bridge 来源校验收紧、SDK `assetUrl()`、Client 消费新 LaunchInfo；`bundle-lib.mjs` 受审最小 allowlist（react / react-dom/client / `@deepseek-ai/dsh-client-ui-primitives`，其余 bare import 继续抛错）。
- V1-46：**M1 期间被实测推翻/补齐的三处冻结设计（已记入契约 §7.5.2 与 §15.2）**：① **两层沙箱模型**——真实 Chrome 实测证明「§7.5 精确 `frame-ancestors` + §7.5.1 MUST 用 wrapper + Runtime 唯一 iframe MUST sandbox」三者不能同时成立：外层 sandbox 让 wrapper 变 **opaque origin**，而 `frame-ancestors` 检查整条祖先链，opaque origin 匹配不上任何 host-source → 游戏文档「HTTP 200 但 `chrome-error://chromewebdata/`」、资源全不加载（A/B 对照：仅去掉外层 sandbox 即恢复）。裁决：**wrapper iframe 不加 sandbox**（受信平台文档、运行在 resource origin、CSP 锁 nonce script + `frame-src/child-src <resourceOrigin>` + `frame-ancestors <DSH web origin>`），**游戏 iframe 由 wrapper 创建并 `sandbox="allow-scripts"`**（禁止 `allow-same-origin`）；`html-v1` 保持单层 sandbox 不回归。安全不变量语义等价（游戏永远 opaque）。② **wrapper 需承担 Bridge 点对点 relay**（只做 parent↔game 两条转发，不广播/不解析/不持能力），Runtime 仍只接受 `event.source === 我们创建的 wrapper iframe.contentWindow`。③ **§7.5 `frame-ancestors` 必须覆盖整条祖先链**：`<DSH web origin> <resourceOrigin>`（只列前者会拦掉 wrapper→游戏）。另有三条实现约束：`fileManifestDigest(files, sha256Hex)` 必须注入哈希函数（shared 浏览器纯 JS）；`shared` 新增校验器统一 `{ok,value}`/`{ok:false,code}` 形状；**SDK 不能内联 shared `resources.js`**（`new URL(`/`url(` 等文本会让单文件游戏的 `checkSelfContained` 误报），改为 `packages/sdk/src/asset-url.js` 纯字符串实现 + parity 测试，shared 仍是 Runtime/Client/Host 的唯一规范化来源。教训同 V1-44：一次真实浏览器 A/B 对照推翻了三条静态推理都以为成立的组合。
- V1-47：**M1 未完成/顺延项（明确不写成通过）**：① 完整 ZIP 提交发布链路（`prepare.mjs` 的下载→归档校验→写 catalog v2）仍依赖把 `zip.js` 接进发布工具，按指南属 **M2 开发工具升级**；当前 dry-run 已能在下载前拒绝「同版本 html→zip」。② **`html-v1` 未 wrapper 化**（M1 只为 `asset-zip-v2` 引入 wrapper，html-v1 仍走 V1 `/entry` 直嵌），其残余自导航风险为**已知项**，覆盖它需要 M2/M4 的兼容性决策（让 wrapper 的 `frame-src` 含 DSH entry origin，或把 html-v1 入口迁到资源 origin），不在 M1 静默改变。③ `dshWebOrigin` 未从 DSH 接线，wrapper/入口 CSP 的 `frame-ancestors` 走 `settings.security.frameAncestors` allowlist 回退（`'self' + http://127.0.0.1:* + http://localhost:*`，覆盖当前 loopback GUI，但非精确 origin）。④ 多窗口并发 renew/release、`@font-face` 经资源 origin、非 Chromium 引擎的导航阻断未实测。⑤ M2～M5（新内置游戏 `orbit-courier`、开发工具/Skill 完整升级、一键更新 UI、鲸鱼/气泡视觉与游戏内 AskQuestion UI）**未开始**。

- V1-48：**V1.5 M1 复核修正轮 CR7（2026-10-20，固定 head `77c8d0a`）**。Codex 认可「两层 iframe / 点对点 relay / 祖先链 origin 补全」方向，提出 3 项实现缺口（**契约说了但实现没做到**，非契约被推翻）并建议暂不合并：① **CR7-01（P1）** 只有入口文档带 CSP，包内其他 HTML/SVG 作为**同源文档**被导航后无策略可外发（真实浏览器复现：外部 sink 收到请求）→ 修为「所有 `text/html` 与 `image/svg+xml` 响应发送与入口完全相同的 asset CSP」，其余静态子资源仍不带 CSP（避免过度修复）；补「修复前 8 项失败 / 修复后 21/21、sink 零请求」的 A/B 证据。② **CR7-02（P2）** 保留的上一版 ZIP 目录无法回滚（重装旧版本 → 409 `GM-4094`）→ 修为「按**实测内容**判定目录等价后复用目录」（zip 逐文件 sha256 + `fileManifestDigest`；html 实测 `entry.html` sha256+size，**不依赖可能为 null 的 `record.sha256`**），不一致仍 409，且记录写失败时**不得删除复用目录**；`zip.js#verifyPackageDirectory` 因此增加 `verifyContents` 选项（默认轻量，§6.5 语义不变）。③ **CR7-03（P2）** Market UI 本地 ZIP 安装未接通、文本路径把 2384 B ZIP 变成 2474 B → 修为「扩展名优先选格式 + 统一二次确认 + ArrayBuffer 原始字节 + `application/zip`」，html 路径零回归；客户端 2384 B 含高位字节样本 source/uploaded sha256 逐字节相等。验收矩阵新增 §7b，契约新增 §15.4。教训：**「入口文档」不等于「包内唯一文档」，「保留版本目录」不等于「可回滚」，「二进制上传」最容易被文本 API 静默破坏**——这三类都要用真实端到端证据而不是单点单测确认。

- V1-49：**V1.5 M2 实现完成（2026-10-20，`feat/v1.5-game-and-tooling`，基线 `9388b37` = M1 合入后的 main）**。只做 M2，不提前铺开 M3～M5。四块交付：① **新内置 `orbit-courier`（轨道信使）** —— 首个 **builtin + `asset-zip-v2`** 游戏，`games/orbit-courier/dist/` 为包树（`dsh-package.json` + `game.json` + 外链 ESM/CSS/3 PNG/关卡 JSON/6 WAV，22 文件 ≈399 KB），三航段 40/40/40s 共约 120 秒、键盘可玩、连击/最高分/暂停/自动存档/Continue、音效首次手势解锁且可静音、375px/深色/reduced-motion 适配；构建确定性（两次构建描述符 sha256 一致、逐文件字节一致），自带 27 条测试（18 规则 + 9 包契约，含真 ZIP→`extractPackageArchive` 往返）。② **内置资源包支持**：`BUILTIN_GAMES` 新增条目（`format`/`packageDir`）并从 `constants.js` **拆到 `shared/src/builtin-games.js`**（否则游戏构建会把平台内置目录内联进每个分发包、且每次新增内置都会改变既有包字节），`host/src/{games,entry}.js` 让内置 zip 走与安装包**完全相同**的 LaunchInfo/资源 origin/wrapper/CSP 路径，`resources.js` 零逻辑改动即复用目录来源；「未随包分发 → 跳过」与「随包但损坏 → `package-invalid` fail closed」分开处理；host 套件 219/219（新增 11 条 builtin 用例）。③ **双格式开发工具**：CLI `create/build/validate/pack/publish/dev` 全部支持 `--format html-v1|asset-zip-v2`（不带时与 M1 完全一致），新增确定性 ZIP writer（UTC 1980 固定时间/STORED/0444/排序）与 `package-v2.mjs`（校验一律调 shared + Host `zip.js` 真实解包，不复制规则），`templates/{vanilla,react}/zip/**`（React `base:'./'` 相对路径、非 singlefile、最后校验**最终 ZIP**），Simulator 按格式走 wrapper/单文件；CLI 67/67。④ **ZIP 投稿发布链**：`scripts/registry/lib/assets.mjs#validatePackageBytes` 对 `asset-zip-v2` **动态 import** `packages/host/src/zip.js`（唯一 yauzl 引入点不变，HTML-only 内容仓库无需安装依赖）做真实归档校验，把外层 sha256 + size + 内部 `filesDigest` 三重绑定写进 catalog v2，`validate-assets` 对每个历史 ZIP release 重跑；顺带修 V1→V2 升级时历史 release 的 `reviewSha256` 绑定 bug 与 replay 幂等性；`tests/v1.5-publish-zip.test.js` 10/10 覆盖 dry-run 零远端写、端到端、双投影、撤下、不可变/格式、失败恢复、非法 ZIP 零写入。⑤ **Skill 升到 1.1.0**（142→277 行 + references），覆盖双格式、非法包→修复→重验、1.0.0→1.0.1 旧 save 兼容与投稿材料；命令按真实 CLI 校验后写入。
- V1-50：**M2 期间的两条结构/口径决定**：① `BUILTIN_GAMES` 移出 `constants.js`（见 V1-49②）——这是一次性字节变更，随包 seed 同步重建；② **`html-v1` 仍未 wrapper 化**，M2 不改变其服务路径，迁移方案（把 html-v1 入口也搬到资源 origin + 保留 `/api/entry` 兼容）写在 `docs/V1.5-HTML-V1-WRAPPER-MIGRATION.md` 交 Codex 裁决，**不得宣称所有格式均已实现包外导航阻断**。另：`tests/v1.5-catalog.test.js` 一条 M1 用例因 M2 收紧而**换 fixture**（原「19 字节假 ZIP + 只看外层 sha」→ 真实包走归档校验），断言逻辑不变，属收紧不是回归。

- V1-51：**M2 CR8 复核轮（2026-10-20，PR #8 head `a76f701` 之后）**。Codex 提 5 项（2×P1、3×P2），全部修复并补回归：① **CR8-01（P1 安全）卸载跟随符号链接删外部文件** —— `install.js` 卸载清理改为先 realpath 边界（祖先/根任一段是链接则不遍历、根非目录只 rename 链接本身、`readdir` 前后 lstat 比对 `dev+ino` 防换链、子项不跟随链接的 unseal），外部哨兵目录 sha256 前后一致；② **CR8-02（P1 安全）删素材摘要绕过审核** —— 新增 `scripts/registry/lib/media.mjs` 统一素材绑定（catalog 的 url+size 必填、sha256 可从可信 review 补足但补足后仍真实下载重算、两边都缺 `E_PUBLISH_MEDIA_UNBOUND` 绝不跳过、可信历史加 media 指纹防已发布 release 换素材），publish-zip 测试 10→19；③ **CR8-03（P2）轨道信使第二局不结算** —— 新增 `run-sessions.js` 每局 runId 账本（`settle()` 按 token 幂等、同步发 score.submit/session.end 并立即弹窗、异步结果只对当前局生效），真实宿主 run1 1392→run2 9392→run3 432 三局各结算一次，游戏测试 35→42；④ **CR8-04（P2）缺描述符的内置包被当未分发** —— `builtinPackageShipped()` 只看 `dist/` 是否存在（权限错误也视为已分发），描述符缺失/不可读 → `package-invalid` + `/launch GM-4277` 且 builtin 保护仍生效，host 测试 225→231；⑤ **CR8-05（P2）探针重启泄漏 Host** —— `lab.mjs` 清理解引用当前 Host、`handle.restart()` 先完整关闭旧 Host（await exit + 端口拒连证明）再起新的，新增 `self-check-cleanup.mjs` 覆盖成功/断言失败/重启三路径，lifecycle 48/48 且进程自行退出。**修复后全量 1189/1189、`CHECK OK (42)`、构建字节可复现。**
- V1-52：**html-v1 迁移方案 A 获 Codex 认可**，安排为**M4 前置独立提交**（保留旧 `/api/entry`、新 Runtime 用资源 origin+wrapper、保留旧 HTML 内联 CSP），需先补隔离探针 + 旧客户端兼容回归，作为 **M5 发布前必须关闭的门槛**。M2 不改变 html-v1 服务路径；不得宣称所有格式均已实现包外导航阻断。裁决记录见 `docs/V1.5-HTML-V1-WRAPPER-MIGRATION.md` §4.1。
- V1-53：**CR8 轮的两个边界如实记录**：CR8-01 的 TOCTOU 仅剩「目录内部 walk 期间被换链」极窄窗口（Node 无 openat/fd API，威胁模型是 dataRoot 本地写权限）；CR8-04 的「是否随包分发」仍是 Host 激活时快照（构建中途增删需重启，与 M2-B 既有语义一致）。二者均不写成通过项。

---

## 6. 当前状态与工作日志

> 历史细节以 `git log`、`docs/V0-VERIFICATION.md`、`docs/V1-VERIFICATION.md` 为准；本节只保留最近 10 条工作日志（每阶段追加：日期、阶段、commit、结果、下一步）。

- 2026-10-19 · **U-06/U-08 真机通过**：用户确认 AskUserQuestion 提醒回答后消失（`bcc3c92` 生效），U-08 关闭 DSH 重开后 Continue/进度正确。后续补跑 A-11 连续 5 分钟与收尾封板。
- 2026-10-19 · **codex review 收口（fix/m3-review）**：CR-01 默认 Registry 随包（build/check/files + 冷启动安装测试）；CR-02 卸载删除含 `.bak` 且失败可重试；CR-03 新增 `POST /save-remove` 真实删除；CR-04/05 实例心跳/按实例释放/凭证 TTL 分离；CR-06 提问 callId/turn 关联；CR-07 日志入库+脱敏+check；CR-08 采集脚本断言/非零退出；CR-09 性能指标语义拆分。Host 149/149、全量 **780/780**、CHECK OK (23)；证据脚本（host-e2e/stability/reduced-motion/perf）全部通过。该分支后经两轮复核合入 main。
- 2026-10-19 · **codex 复核第二轮修复**：按复核意见补修 CR-02/05/06/08/09；Host 150/150、全量 **780/780**、`CHECK OK (23)`；冻结自测 exit 1、正式 A-11（19 样本/8 状态/anyMovement）与 perf（全样本成功）通过；证据刷新；审核文档移入 `docs/reviews/`；随后 codex 复核通过并发布 `v1.0.0`。
- 2026-10-19 · **V1.0.0 发布**：codex 复核通过；`fix/m3-review@f1aeb28` `--no-ff` 合入 main（`643fcb9`）；main 上 `npm run verify` 780/780、CHECK OK (23)；package 版本 1.0.0；README/PRD/契约/验证文档/记忆同步；tag `v1.0.0` 推送。
- 2026-10-19 · **UI/UX 收口合入（PR #1）**：Market header 只留市场/我的游戏、移除更新提示、上传按钮强化；Hero 去 kicker/meta、分区去序号；详情改紧凑缩略图；侧边 Game Market 去状态点；会话 Game tab 集成状态 pill（等你/完成/出错/已暂停）。用户随后补 gallery 视觉 `8ab8004`；PR 合入 `b4c640b`，verify 782/782。
- 2026-10-19 · **全出血 Runtime + 开发包呈现规范（PR #2）**：删除舞台黑边/内边距/圆角黑框，Runtime 全出血；`viewport` 降级为推荐设计尺寸；开发者指南 §4.4 定义铺满/主题/响应式/安全区；Vanilla + React 模板改为全出血示例。用户 follow-up `395ed75` 统一顶部全宽 112px 安全带、SDK viewport 实测语义、React 模板类型检查；PR 合入 `58fb5ce`，main verify 787/787、CHECK OK (23)。
- 2026-10-19 · **V1.1.0 发布**：PR #3（Game tab/sidebar 宿主 locale）合入 `192aa6a`；`package.json` 1.1.0；README/验证文档/记忆更新；发布提交（即 tag `v1.1.0` 指向的提交）推送；全量 787/787、CHECK OK (23)。
- 2026-10-19 · **社区投稿 MVP 复核通过并合码（PR #4）**：固定 head `c93a85a` 经 Codex 复跑 verify 835/835、CHECK OK (37)、registry 28/28；真实 ref lock 复现正确返回 `E_PUBLISH_ROLLBACK_FAILED`。用户授权后以 merge commit `2b45b2e` 合入 main；未发布、未打 tag。下一步 M4 公网闭环及真实 Host 安装/持久化、120 秒流程、跨机 save 验收。
- 2026-10-19 · **PR #5 复核合入与 V1.2.0 发版**：固定 head `f862650` 验证 840/840、CHECK OK (38)、registry 31/31，两个 P2 全关闭；PR #5 合入 `e247b93`。用户随后授权合码/打 tag；本次合入项目记忆维护提交，升 package 1.2.0，更新发布说明并以 main 发布提交打 tag v1.2.0。真实 App 等剩余边界未改写为通过。
- 2026-10-19 · **V1.5 正式对外首版开发指南**：只读核对当前 DSH 0.2.1-rc.2 的 pluginManager/pluginMarket/userQuestions/uiSession/FishLogo 实现并对照官方文档；交付 V1.5 指南与宿主能力记录，明确 ZIP/双目录、原生更新/重启确认、原地问答与权限隔离、M0 探针及正式验收门槛。尚未实施或发布 v1.5，下一步由用户指定开发 Agent 执行 M0。
- 2026-10-19 · **V1.5 M0 执行完成**：按指南 §7.1 从 `origin/main` `f422e8d` 建 `feat/v1.5-m0` worktree 并 `--no-ff` 合入本地指南分支（`689b5b9`）；交付 7 个宿主探针（S-U1/U2/U3、S-Q1/Q2、S-A1、S-B1）全部通过 + `docs/V1.5-CONTRACTS.md` 冻结 + ZIP 依赖裁决 + 支持矩阵 + PRD D-039～D-050/S-26～S-32；`npm run verify` 840/840、CHECK OK (38)。**未**推进 M1～M5、未合并 main、未打 tag、未发布。等 Codex 复核。

**当前状态（2026-10-20，V1.2.0 已发布 / V1.5 M0、M1 已合入 / V1.5 M2 待复核）**：

- **发布**：`package.json` 1.2.0；tag `v1.2.0` 指向本次 main 发布提交。平台 Git tag 分发，不创建 GitHub Release 页面、不上传新游戏资产；历史 tag 不动。
- **V1.5 M0（已完成并合入）**：分支 `feat/v1.5-m0` 经两轮复核后合入 `main`（`a762449`，PR #6），最终 head `3927d04`。交付物见 `docs/verification/v1.5/host-spikes.md`（主证据索引）、`docs/V1.5-CONTRACTS.md`、`support-matrix.md`。**探针结论改变了三处设计前提**（见 §5 V1-41）：真实 Desktop 是 HMR 开启、能力判定要轮询采样、资源服务必须独立 origin、open 问答不得 `dismiss()`。
- **V1.5 M1（已合入 main）**：分支 `feat/v1.5-asset-packages`，经 CR7 复核修正后合入（合并提交 `9388b37`，PR #7）；实现 `asset-zip-v2` 归档链路、两代 Registry/catalog 投影、独立 loopback 资源 origin + 实例凭证 + wrapper、Runtime/SDK/Client 接入。**真实浏览器实测推翻了「唯一 iframe 一律 sandbox」的旧假设**，冻结为两层沙箱模型（契约 §7.5.2，见 §5 V1-46）。CR7 三项（同源文档 CSP、历史目录回滚、ZIP 原始字节上传）已修并带 A/B 浏览器证据（§5 V1-48）。
- **V1.5 M2（当前阶段，CR8 修复后待复审）**：分支 `feat/v1.5-game-and-tooling`（从 `origin/main` `9388b37` 建）交付新内置 `orbit-courier`（builtin `asset-zip-v2`）、内置资源包 Host 支持、双格式 CLI/模板/Simulator、ZIP 投稿发布链、Skill 1.2.0（见 §5 V1-49～V1-53）。PR #8 首轮 head `a76f701` 经 Codex 复核提出 CR8-01..05（2×P1、3×P2），已**全部修复并补回归**：`npm run verify` **1189/1189**、`CHECK OK (42)`、构建字节可复现。**`html-v1` 的 wrapper 化仍为已知残余项**——方案 A 已获 Codex 认可，安排为 **M4 前置独立提交**，作为 M5 发布前门槛（`docs/V1.5-HTML-V1-WRAPPER-MIGRATION.md` §4.1）。
- **V1.5 下一步**：M2 PR 交 Codex 复核 → 通过后按指南进 M3（插件更新 adapter/UI/保存协调）；M4/M5 未开始。
- **合并 / 验收**：PR #4 `2b45b2e`、PR #5 `e247b93`；已验收 head `f862650` 为 840/840、CHECK OK (38)、registry 31/31。本次版本/文档收口的独立验证结果见 `docs/releases/v1.2.0.md`。
- **入口**：作者 `docs/community-submission.md`；维护者 `docs/community-operations.md`；契约 `docs/community-publishing-contracts.md`；Skill `skills/dsh-game-developer/SKILL.md`；任务指南 `docs/plans/2026-10-19-community-publishing-mvp.md`。
- **受控 M4 已完成**：内容仓库 `heswy/dsh-game-registry` 已配置规则/不可变 Release；受控作者公网投稿→1.0.0→1.0.1→撤下闭环通过，目录为空且保留审计。独立 Host 安装/启动、Release 重定向与 SHA 核验已有归档；见 `m4-public-loop.md` / `external-content-repo.md`。
- **V1.5 交付分工**：主会话规划/review/验收，用户指定 DSH 实施；先交宿主更新/问答/资源/Logo 的 M0 探针与 V1.5-CONTRACTS，再按指南分阶段开 PR。不默认派发开发 Agent，不修改日常 profile 做验收。
- **发布后续**：以独立内容仓库 PR 将 toolchain pin 从 `2b45b2e` 提升到本次平台发布提交并跑 CI；验证目标 AI 宿主的 Skill 安装/调用与真实外部作者/维护者生产流程。本次平台发版不自动改内容仓库。
- **真实环境待验收**：真实 DSH App 安装与持久化、Host GM-4006 独立安装拒绝路径、完整真实 120 秒流程、跨机 save 传输、真实 Host 更新分发。C-22 save 恢复仍为模拟器证据。
- **后续迭代**：V1.5 多资源包与既有滚动项（真实审批、桌面性能终值、字号/减少动效、DEV-03/07、2048 PB、Tab 键盘链路）保留。
- **日常桌面端**：需要 dev 行时用户执行 `npm run dev:enable -- --yes` 后重启 DSH；Client 改动刷新页面即可；Host 改动需重启/重载插件行。

### 6.1 当前状态与后续安排（2026-10-26）

用户授权“合码，然后完成 M4”。M3 PR #9 已合并：`bcc7b6d09fd9f208657088fd65cc36eba3a9aca6`；从该 main 新建仓库外 `../dsh-game-market-worktrees/v1.5-presence-questions`、分支 `feat/v1.5-presence-questions` 实施 M4。原主目录旧指南分支与用户修改保留；不要在旧目录重新开发已完成阶段。

| 阶段 | 已做 | 剩余 |
|---|---|---|
| M0–M2 | 宿主契约、ZIP/双目录/资源服务、Orbit Courier 与开发投稿工具；PR #6/#7/#8 已合入 | M5 正式用户/外部作者回归 |
| M3 | 更新发现、保存/运行冻结、DSH 精确安装、恢复、双端身份和发布工具；1543/1543；固定候选两跳/保存重试/非 HMR/多窗口均通过；PR #9 已合入 | 正式发行与生产推广在 M5 |
| M4 | HTML wrapper 迁移、真实桌面来源修复、官方 FishLogo/气泡、open/continued 原地问答、保存失败恢复、草稿/焦点/窄窗/动效边界 | 已通过 PR #10 合入 main，`e700eea` |
| M5 | 本机工程验收补齐：进度导出/导入/备份；真实直接安装与同资料两跳、407秒实玩、App重开；1570/1570、确定性包、内容CI；PR #11 / 内容PR #6 | 独立外部作者、两台实体机迁移实测、PR复核合入与后续正式发布 |

当前 M4 权威结论见 [M4 验收](./docs/verification/v1.5/m4-acceptance.md)；M3 的固定候选与历史证据见 [M3 验收](./docs/verification/v1.5/m3-restart-acceptance.md)。M4 功能提交 `96718e1`，最终受测源码/样式为 `cef4cb9`；后续证据提交单列；最终 PR 提交不能与 M3 的发行候选身份混淆。

**M4 实测裁决**：真实 rc.3 Desktop renderer 为 `dsh-app://app`，不是后端 HTTP origin。只有打包 Electron Host 入口选取该精确来源；Web 使用自身 HTTP origin，不新增通配。HTML 保留旧 `/entry` 给旧 Client，新 Runtime 使用新增 wrapper 和资源凭据；SDK/存档格式不变。问答接原生活对象与原生 RPC，continued 只认 settled 投影、排队消失不等于完成；未知 face、计划审阅与危险审批回原生。独立 question hold 与 M3 hold 按 id 共存，收起不取消、不自动继续；权限修复后通过既有 health 探测并真实重存。

**更新机制保持**：固定索引发现→用户确认→保存与运行冻结→DSH 管理器精确 Git commit 安装→Host/Client 实际身份确认。不自行覆盖或先卸载自己；master 新接口不视作 rc.3 发布能力，npm 分发未选定。跨进程更新锁只串行化更新，不支持同 profile 多独立 Host 活跃游戏协同冻结。

**证据边界**：M4 已在安装的 rc.3 Electron App 的独立资料/窗口中验证实际游戏内普通问答，其余为隔离真实 Host/Client 链路。模型为本地脚本驱动原生工具，并非真实 DeepSeek 模型调用；强制 queued/损坏 face 等分支由自动化覆盖。M4 是开发行加载，不是新发行包安装；M5 必须重新生成正式版本/Host-Client 身份和确定性包，不能把 M3 release 元数据当作 M4 源码身份。当前无 tag、Release 或生产索引推广。

下一步复核 M5 PR #11 与内容 PR #6，补独立外部作者和实体跨机证据，再按原指南 §8 全部门槛与用户授权发布。不重开已完成的 M3/M4。

**M5 固定候选（2026-10-28）**：rc.1 安装 R=`07f2ef1de6aea2b3857bc7e2983f7f083db7eb99`，Client 构建 P=`0ca0aacc4501f313776f4ea1e0683255cb14e62b`；Host 实际运行报告 R。第二跳仅测试 rc.2（R=`fe181461c12b850ee0a3dc23abfaf4154f25f454`，P=`9b4a9c59c8e6bf78e35a1d2fd562154488ede0e5`），不合入本产品 PR。内容锁指 rc.1，`b1bae24` 的更新工作流 CI 已通过。确定性4次独立构建93文件/3449879字节，SHA树 `d0d7fc7a64930e75373eef9c892fb687423ae0b948f7c7e4cfc21bed0476f932`。完整原始失败与通过记录均保留，模型/索引均明确标注隔离脚本/夹具，不冒充真实模型或生产推广。


---

## 7. 交接模板（开发 Agent 完成后按此报告）

```text
分支：feat/xxx
commit：<hash>
完成：<对应任务/PRD 章节>
改动：<目录/文件列表>
验证：<命令 + 结果>
未完成/风险：<逐条>
需要主会话处理：<契约变更/合并顺序/依赖>
```
