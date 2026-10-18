# DSH Game Market · 项目记忆

> **本文件是全项目唯一的项目记忆文件（Single Source of Project Memory）。**
> 任何项目级约定、状态、决策、交接信息都只记录在这里；其他文档（`PRD｜DSH Game Market.md`、`README.md` 等）是规格或说明，不是记忆。
> **只有 Team Lead 可以修改本文件。** 子智能体/协作者只读；需要变更时向 Lead 报告，由 Lead 统一写入。
> 本文件优先于口头约定；与 PRD 冲突时，实现以 PRD 第 8–12 章为准，本文件记录的是"我们怎么协作/做到哪了"。

- 项目：`dsh-game-market`（DSH 内的小游戏市场与运行平台）
- 线上仓库：<https://github.com/heswy/dsh-game-market>
- 本地工作区：`/Users/orange/Orange Field/Matterhorn/dsh-game-market`
- 当前目标：按 PRD v2.1 完成 **V0**；V0 验证小游戏 = **贪吃蛇（snake）**
- 权威规格：`PRD｜DSH Game Market.md`（第 8–12 章为开发权威来源）
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
6. 合并：Lead 在 feature 分支完成后执行 `git merge --no-ff` 到 `main`；禁止快进合并到 `main`；合并前必须跑通 `npm run build && npm run check && npm test`。
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

## 2. V0 范围（当前目标）

**只证明核心链路**：Agent 工作 → 用户进入游戏（贪吃蛇）→ Agent 完成/需要用户 → 用户自主返回工作；游戏进度跨多次等待保留。

V0 必须包含（对应 PRD §7.1 / §11.2）：

1. Bundle 安装形态：`package.json` + `cordis.patch.yml` + Host 半 + `dsh.client` Client 半；可启用/停用且无残留。
2. 注册 `main` 面板 + `sidebar.panellist` 入口；`selectPanel` 进入/返回；Conversation 草稿与语义滚动位置由宿主恢复。
3. 等待入口：Agent 连续运行 ≥5s，在 `conversation.header.leading` 显示 chip；菜单/忽略频控/Sidebar 状态点；不自动打开游戏。
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
│   ├── shared/             # 跨 Host/Client/Runtime/SDK 的纯 JS 契约（无 Node/browser 全局依赖）
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

## 5. 关键技术决策（增量，完整见 PRD §12.1）

- D-023：V1（含 V0）游戏 entry 必须是自包含单文件；V0 只服务 entry/preview。
- D-024：从“处理 Agent / 查看结果”返回游戏时停在暂停遮罩，用户确认后再继续。
- D-025：Market/My Games 浏览态遇到 waiting-user 显示 32px 顶部提示条。
- D-026/027：V0 不做平台静音、不做长期“少提醒”偏好。
- D-028：写接口一律 POST。
- D-030：对外错误码统一 `GM-*`，内部常量 `E_*` 映射。
- D-031：DSH 基线 0.2.1-rc.2。
- D-032：zip 读取器自研（V1 安装阶段需要；V0 不涉及）。
- D-033：多 profile 共享 `$DSH_HOME/storages/dsh-game-market/`，跨进程写锁。
- V0 本地新增：
  - V0-01：V0 不接真实 Registry/安装；内置游戏以 `games/snake` 目录 + `installations.json` 中的 builtin 记录呈现。
  - V0-02：Agent 状态 V0 以真实 DSH 事件为主，另提供 **dev-only** `POST /api/game-market/dev/agent-state` 便于无 Agent 时验证 UI（仅 `config.devMode === true` 时注册）。
  - V0-03：V0 label 先用中文固定模板（zh-first），labelKey 机制推迟到 V1；SDK 仍不解析 label。
  - V0-04：Client 构建使用零依赖自研 bundler（`scripts/bundle-lib.mjs`），只支持受限 ESM 子集；不支持动态 import/循环依赖。
  - V0-05：没有浏览器自动化工具；UI 验收由用户在 DSH 内按 README 步骤执行，自动化覆盖 Host/API/Runtime 纯逻辑/SDK 协议/游戏逻辑。

---

## 6. 当前状态与工作日志

> 规则：Lead 每完成一个阶段追加一条（日期、阶段、commit、结果、下一步）。历史细节以 git log 为准，本节只保留最近 10 条。

- 2026-10-18 · 仓库初始化：`main` 从 `origin/main`（仅 LICENSE）建立；PRD v2.1 纳入仓库；建立本记忆文件与 V0 开发基座。下一步：搭 Bundle 基座并拆分分支。
- （待续）

**当前阻塞/待用户确认**：

- 是否允许执行 `npm run dev:enable` 修改本机 `~/.dsh/profiles/desktop/cordis.patch.yml`（需要的话，Lead 会先备份；改 Host 需重启 DSH）。
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
