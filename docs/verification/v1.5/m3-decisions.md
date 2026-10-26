# V1.5 M3 · 接口、身份与分工冻结（Lead 记录，待 Codex 复核）

- 日期：2026-10-20
- 分支：`feat/v1.5-platform-update`；worktree：`dsh-game-market-worktrees/v1.5-platform-update`
- 基线：`origin/main` `40d701678e96d99e777520debb43e25b28ae2d0c`（M2 / PR #8 合并提交）
- 范围：**只做 M3**（官方插件更新发现、原生更新 adapter、协调与真实生效确认、UI/维护者工具、真实验证）。
  M4/M5 不展开；`html-v1` wrapper 迁移仍按既定决策作为 M4 前置独立提交，M3 不夹带、不宣称所有格式已阻断包外导航。
- 本轮禁止：写生产索引、打 tag、发布 Release、合并 main、修改用户 Desktop profile/App 安装目录/生产内容仓库。

## 1. 团队与写范围（同一 worktree，Lead 统一提交/推送）

| 工作流 | owner | 写范围（不重叠） |
|---|---|---|
| 发现 + shared + Host adapter/协调 | `host-core` | `packages/shared/src/**`、`packages/host/src/**`、`packages/host/test/**`、`tests/v1.5-platform-update*.test.js`、`docs/V1.5-CONTRACTS.md`（§9/§15 落地记录） |
| Client 更新 UI/身份上报 | `client-ui` | `packages/client/**`、`client.js`、`locale/**`、`scripts/build-client.mjs` |
| 维护者 release 工具 | `release-tools` | `scripts/release/**`、`scripts/build.mjs`、`scripts/check.mjs`、`package.json`、`tests/v1.5-release-tools.test.js`、`platform-updates/**`（模板/产物，不提交生产索引）、`docs/plugin-update-release.md` |
| 真实验证/证据 | `verification` | `scripts/verification/v1.5/m3/**`、`docs/verification/v1.5/plugin-update-m3.md`、`docs/verification/v1.5/raw/m3/**`、`docs/verification/v1.5/acceptance-matrix.md`（M3 追加）、`support-matrix.md`（M3 追加） |
| 接口冻结/集成/PR/项目记忆 | Lead | 本文件、`PROJECT_MEMORY.md`、最终集成与 git 操作 |

规则：teammates 不执行 `git commit/push/branch/worktree/reset/clean`；Lead 在检查点统一提交。共享工作区里不要并发改同一文件；
大范围重建（`node scripts/build.mjs`）需先向 Lead 报备，避免与其他人的构建/探针竞争。

## 2. 已冻结的 Host HTTP API（`API_BASE = /api/game-market`）

沿用既有信封 `{ok:true,data,requestId,serverTime}` / `{ok:false,error:{code,message,retryable,details?},...}`；只允许 GET/HEAD/POST，精确 pathname。

| 路由 | 方法 | 请求 | `data` 关键字段 |
|---|---|---|---|
| `/platform-update` | GET | — | `schemaVersion`、`host`{version,commit,hostEpoch,loadedAt}、`installed`{bundleId,spec,specShape,version,enabled,loadedVersion,loadedCommit,devRowShadow}、`target`{id,version,commit,channel,publishedAt,spec}\|null、`discovery`{channel,indexUrl,state,fetchedAt,checkedAt,nextCheckAt,lastError,canRefresh}、`capability`{hmr,updatePath,canBeginUpdate,reasonKey}、`operation`（当前/最近 observation） |
| `/platform-update/refresh` | POST | `{}` | 同上 + `refreshed:boolean`、`throttled:boolean`（节流时 `nextCheckAt`）|
| `/platform-update/begin` | POST | `{targetId}` | `{operationId}`；只接受当前已验证发现记录的 id；重复点击/多窗口返回同一 operation |
| `/platform-update/observe` | GET | `?operationId=` | `UpdateObservation`（契约 §9.1，状态机唯一权威）；终态保留到下一次 begin |
| `/platform-update/cancel` | POST | `{operationId}` | `{status:'cancelled'\|'too-late'\|'not-running', observation}` |
| `/platform-update/coordinate` | POST | `{windowId, instances:[{instanceId,gameId,playSessionId,paused,saved,saveRevision,error?}], idle:boolean}` | 协调阶段各窗口的暂停/落盘确认；Host 聚合，任一未确认则不进入包变更 |
| `/platform-update/client-report` | POST | `{clientId,windowId,buildVersion,buildCommit,pageToken,startedAt}` | `{accepted:true,state:'idle'\|'updating',expected?}`；用于双端核验与多窗口 |
| `/health` | GET | — | 追加 `buildCommit`、`loadedVersion`（**激活时冻结的运行身份**，不是磁盘版本）；旧字段不回归 |

`UpdateObservation` 完全按契约 §9.1 的 union；允许附加只读字段（如 `inspecting` 的 `coordination:{phase,pending,failed}`、`applied` 的 `requestId`），
但不得新增会改变状态机语义的 state。UI 只能按 `state` 展示，`applied` 绝不显示“已更新”。

## 3. 发现策略（固定官方索引）

- 固定索引 URL：`https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json`（DSH plugin-market-index **格式 1**）。
- 主题绑定：插件名 `dsh-game-market`、仓库 `github.com/heswy/dsh-game-market`、`source.type='git'`、精确 semver、**完整 40 位小写 commit**；
  拒绝浮动分支/tag/短 SHA/本地路径/file:/任意仓库/裸包名。
- 稳定通道默认排除 prerelease；测试通道只能显式 opt-in（配置，不在普通 UI 一键切换）。
- 请求：HTTPS、≤256 KiB（超限拒绝）、5s 总超时、重定向上限 3 且不降级 http、单一 in-flight；启动静默检查 ≤6h；
  手动刷新节流（默认 60s，返回 `throttled` 而非报错）；失败保留上次成功目标但显示离线/陈旧；**发现失败不得阻塞游戏/Market**。
- 缓存：`$DSH_HOME/storages/dsh-game-market/platform-update-cache.json`（原子写，含 indexUrl/indexHash/fetchedAt/target/lastError）。
- 同版本不同 commit（与 profile 已记录 commit 或上次发现不一致）→ 显示异常，不自动重装。
- “公开解析入口”待裁决：优先尝试宿主公开包 `@deepseek-ai/dsh-plugin-market-index` 的可达性；不可达时用**本仓库自有的格式 1 严格校验器**
  （按公开格式文档实现，不复制私有实现），并把可达性探针与结论记录进证据。此项作为 Q1 交 Codex。

## 4. 更新身份协议（双端核验）

目标身份 = `{version, commit}`（来自固定索引，commit 为不可变安装目标）。两端运行身份：

- **Host**：插件激活时冻结 `/health.loadedVersion`（当前运行代码的 package version）与 `buildCommit`（从 `$DSH_HOME/profiles/<profile>/package.json`
  中 `dsh-game-market` 依赖串解析的精确 git commit；dev 行/path 来源则标记 dev-row）。不得在请求时重新读磁盘版本冒充运行版本。
- **Client**：`scripts/build-client.mjs` 把 `{version, buildCommit}` 编进 bundle（唯一来源：`package.json.version` +
  `platform-updates/release.json.clientBuildCommit`，缺失时 `buildCommit:null`），Client 通过 `client-report` 上报**自身编入的身份**，
  不能用 Host 返回的版本冒充自己。
- **release 身份**（避免自引用，见 §5）：release commit `R` 内提交 `platform-updates/release.json`，声明 `clientBuildCommit = P`
  （`P` = 构建产物所基于的版本提交，即 `R` 的父/祖先，构建前已知）。Host 运行 `R` 后从自身包内 `release.json` 读取期望的 Client 身份。
- `updated` 条件（全部满足）：Host `loadedVersion==target.version && buildCommit==target.commit`；Client `buildVersion==target.version &&
  buildCommit==<本 release.json.clientBuildCommit>`；`/health` 健康检查通过；协调阶段无未确认存档。
  `pending-restart`/`stale-runtime`/`verification-failed` 不得被 UI 当作成功。
- 状态机与分支：严格按契约 §9.5.1；`applied` 中间态；`waitForInstall()===null` 不得当成功；`ambiguous-install` 必须核对实际版本/commit；
  `too-late` 继续观察至终态；重复点击/多窗口幂等。

## 5. 维护者发布工具（默认 dry-run，不产生自引用）

- 两段式：版本提交 `P`（package version + 代码） → `release:prepare` 校验并生成 `release.json`（`clientBuildCommit=P`）+ 构建产物，
  **`--write` 时** 提交为 release commit `R`；`release:promote` 校验 `R`（版本/构建身份/产物/可安装性）并生成 DSH 格式 1 索引条目，
  **索引必须在另一个提交/PR `I` 中引用 `R`**（工具拒绝 `R` 本身含索引或索引指向未提交 commit 的自引用）。
- 默认 dry-run 零写入；校验版本一致性、两次构建字节一致、产物完整（client.js、games dist、registry、platform-updates/release.json）、
  仓库/通道/engines；stable 推广前需 test 通道演练。索引只生成到工作区/模板，不由本工具推送或写生产。
- 本 M3 的最终 head 需要可被真实 profile 安装并自证身份：按上述两段式把 M3 head 做成 release-style commit（版本 `1.3.0`，不发布、不打 tag）。

## 6. 真实环境验证计划（隔离 DSH_HOME，不碰日常 profile/App）

证据级别：`automated` / `isolated-browser`（CDP + 真实 DSH 页面/真实 Client 代码）/ `real-Desktop` / `not-run`。
索引夹具通过隔离宿主进程内的**传输层夹具**（或等价可审计注入）提供，生产索引不写；所有证据脱敏、脚本自然退出、端口/子进程清理自证。

1. HMR 真实链路：隔离 profile 一次性安装 M3 版本 A（精确 commit）→ 真实 Client 更新 A→B→C（两次连续）→ Host/Client 双端身份核验；
   覆盖 `applied→activating→updated`、Client 刷新、HMR 销毁/响应丢失恢复。
2. 非 HMR：显式禁用 hmr 的 profile → 更新返回 `pending-restart` → 重启 → 双端核验 `updated`；存档/配置保留。
3. 协调与幂等：多窗口同时点更新（同一 operation）、重复点击、活跃游戏存档失败阻断包变更、未确认实例超时阻断。
4. 混合/边界：旧 Client+新 Host → `stale-runtime(client-old)`；already-installed/same-commit；ambiguous-install；取消/too-late；
   能力 unknown 禁用更新；dev row 遮蔽提示；恶意索引/非法 target 拒绝且有恢复路径。
5. 全量 `npm run verify`、回归测试、两次构建字节一致；证据文档与原始 JSON 纳入 Git。

## 7. 待 Codex 裁决的问题（附可复现证据）

- **Q1**：安装后的 profile bundle 能否 import 宿主的 `@deepseek-ai/dsh-plugin-market-index`（公开入口）？若不能，自有格式 1 校验器是否可接受。
- **Q2**：Client 运行身份用 `{version, buildCommit=release.json.clientBuildCommit}` 而非 `buildCommit===target.commit`（文件无法包含自身 commit）；
  `updated` 语义是否满足“双端运行版本/commit 同时匹配目标”。替代方案需接受两段式 release 与索引外元数据。
- **Q3**：固定索引格式 1 无法携带扩展元数据；release 身份放包内 `release.json` 是否可接受（不新增索引外网络依赖）。
- **Q4**：测试通道的 opt-in 表示（Host 配置键/设置项）与 UI 是否可见；默认稳定通道是否必须无任何 prerelease 入口。
- **Q5**：手动刷新节流的错误/返回语义（`throttled:true` vs 专用 GM 码），是否需要新增错误码。

## 8. H1 实现冻结的最终 API 形状（2026-10-20，host-core 落盘，Lead 确认）

与 §2 的差异（以本节为准，client-ui/verification 按此对齐；实现后再回写契约）：

- `discovery.state`: `never | checking | ready | stale | offline | invalid`（`ready` 取代 §2 的 `fresh`）；新增
  `discovery.anomaly: {kind:'same-version-different-commit', version, expectedCommit, foundCommit, source}|null`。
- `capability.reasonKey` 枚举：`update.reason.adapterUnavailable | hmrUnknown | devSource | noTarget | versionCommitAnomaly | alreadyAtTarget`。
- `POST /platform-update/begin`：`{targetId}` -> `{operationId:'upd_<16hex>'}`；同 target 活动期内重复/多窗口返回同一 operationId；
  不同 target 在活动期内 -> `GM-4091`（映射为 update-in-progress，文案需区分游戏安装）；未知/非当前 target -> `GM-4090`；
  能力不可用/dev-row -> `GM-5038` 或 `GM-4090`（dev-source）。
- `POST /platform-update/coordinate` -> `{accepted, phase:'waiting'|'satisfied'|'failed', pending:{windows,instances}, failed?}`；
  15s 超时中止且不进入包变更。
- `POST /platform-update/client-report` -> `{accepted:true, state:'idle'|'updating', expected?:{buildVersion,buildCommit}}`（expected 仅诊断）。
- `GET /platform-update/observe` 终态保留到下一次 begin；未知 operationId -> `GM-4002`。
- `updated` payload：`{state:'updated', version, host:'<loadedVersion>+<commit>', client:'<buildVersion>+<buildCommit>'}`；
  `failed` 允许附加只读 `reasonKey`（`error{code,message}` 与 `oldVersionStillRunning` 不变）。
- 新增错误码 `GM-5039 E_UPDATE_INDEX_UNAVAILABLE`（索引不可用，已有登记）。

## 9. 真实更新链 probe release 计划（修订，避免与最终 head 脱节）

- 最终 M3 head `C` = 版本 `1.3.0` 的 release-style commit（`R_final`，不发布/不打 tag），即 PR 固定 head。
- 验证用 probe releases 从**最终代码树**派生（两段式、不 tag、不发布，仅推送验证 ref）：
  - `A` = `1.2.1` 的 release commit `R_A`
  - `B` = `1.2.2` 的 release commit `R_B`
  - 更新链：隔离 profile 一次性精确安装 `R_A` → 真实 Client 更新到 `R_B` → 再更新到 `R_final`（1.3.0，固定 PR head）。
  - 非 HMR：安装 `R_A` → 更新 `R_B` → `pending-restart` → 重启 → 双端 `B` 核验。
- A/B 的 `clientBuildCommit` 各自指向其版本提交（由 release 工具生成）；索引夹具按步骤动态切换目标（`R_A` 阶段指向 `R_B`，`R_B` 阶段指向 `R_final`）。
