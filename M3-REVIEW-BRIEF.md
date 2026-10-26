# M3 历史审查说明（2026-10-21 快照）

> **2026-10-26 更新**：下文为保留的历史审查输入，版本、候选和待办均非当前状态。M3 已完成固定候选隔离验收；当前权威结论与原始证据见 [M3 重启验收](./docs/verification/v1.5/m3-restart-acceptance.md) 和 [最新交接](./docs/verification/v1.5/M3-HANDOFF.md)。旧失败不追认为通过，后续成功由新 JSON 独立证明。

> 本文是给外部审查 Agent 的交接说明，**不是产品文档，不要提交进 PR**。目标：让它能在 1–2 小时内独立核对代码、证据与进度，找出真正的问题，而不是重新踩一遍我们踩过的坑。
>
> 当前状态一句话：**M3 实现已完成、固定候选 head 的自动门禁全绿；真实 DSH 环境验证已完成 V0 + V1 两跳（分 profile 单跳）+ 非 HMR 重启；V2 还有一部分未完成；PR 尚未创建；本地有一个未推送的验证证据提交和 14 个未提交文件；所有进程已停止，会话目标已暂停。** 未 merge、未 tag、未发 Release、未写生产索引。

---

## 1. 审查范围与禁止事项

- 审查对象：V1.5 M3（平台插件持续更新）在分支 `feat/v1.5-platform-update` 上的实现、测试、验证证据、文档。
- 基线：`origin/main` = `40d701678e96d99e777520debb43e25b28ae2d0c`（M2 已合入）。
- **不要** merge / tag / GitHub Release / 修改生产索引 / 推送 force push / 删除他人 worktree。
- 本 worktree 是可写的；`/Applications/DeepSeek Harness.app` 只读，不要改 App。
- 不要用 `/tmp/dsh-v15/m3/asar` 重新安装或改写（它是从 app.asar 只读解出的 DSH 0.2.1-rc.2 运行时，验证用）。
- 发现产品缺陷：先在 worktree 里改 + 测试，再决定是否重建 probe release（见 §7，重建链条成本高，先问 Lead）。

---

## 2. 文件在哪里（地图）

### 2.1 仓库与 worktree

| 内容 | 路径 |
|---|---|
| 主仓库 | `/Users/orange/Orange Field/Matterhorn/dsh-game-market` |
| **本次 M3 worktree（审查对象）** | `/Users/orange/Orange Field/Matterhorn/dsh-game-market-worktrees/v1.5-platform-update` |
| 分支 | `feat/v1.5-platform-update` |
| 远端最新 | `b0a35ca22199728d104ae1e632fb31053c544de2`（origin 上已可见） |
| 本地 HEAD | `37149786017b326bdac009690e10a217aaeea671`（比远端多 1 个证据提交，**未 push**） |

### 2.2 实现文件（M3 相关，按需求块）

| 需求 | 主要文件 |
|---|---|
| 索引格式/目标绑定/错误码/常量 | `packages/shared/src/platform-update.js`、`packages/shared/src/errors.js`、`packages/shared/src/contracts.js` |
| 官方索引发现（固定 URL、校验、缓存、节流） | `packages/host/src/platform-update.js`、`packages/host/src/config.js` |
| Host 身份（激活冻结、expectedClient） | `packages/host/src/host-identity.js`、`packages/host/src/health.js` |
| 原生更新适配器（inspect/beginUpdate/observeUpdate） | `packages/host/src/update-adapter.js` |
| 协调/锁/记录持久化/恢复/状态机 | `packages/host/src/update-operations.js`、`packages/host/src/install-lock.js` |
| Host 路由接线 | `packages/host/src/plugin.js`、`packages/host/src/routes.js`、`packages/host/src/http.js` |
| Client 更新 API/状态/管理器/文案/身份 | `packages/client/src/{api-update.js,update-state.js,update-manager.js,update-copy.js,build-identity.js,page-identity.js,runtime-registry.js}` |
| Client UI（版本与更新、banner、确认/进度/结果） | `packages/client/src/components/update-section.js`、`packages/client/src/components/panel.js`、`packages/client/src/locale.js` |
| 构建时身份嵌入 | `scripts/build-client.mjs`（banner `// release-identity: version=<v> buildCommit=<40hex|none>`） |
| 发布工具（dry-run 默认、两段式身份、index 生成） | `scripts/release/{prepare,promote,verify}.mjs`、`scripts/release/lib/**`、`package.json` scripts `release:*` |
| 维护者文档 | `docs/plugin-update-release.md` |
| 契约落地记录 | `docs/V1.5-CONTRACTS.md` §17（17.1 实现位置 / 17.2 澄清 / 17.3 范围与未验证 / 17.4 test-only seams / 17.5 真实验证发现 + 修复） |
| 决策冻结 | `docs/verification/v1.5/m3-decisions.md`（§8 最终 API 形状、§9 probe release 计划） |
| 验收/支持矩阵 | `docs/verification/v1.5/{acceptance-matrix.md,support-matrix.md}` |
| 验证报告 | `docs/verification/v1.5/plugin-update-m3.md`（**当前未提交修改**） |
| 原始证据 | `docs/verification/v1.5/raw/m3/**`（61 个 JSON + 120 张截图，全部 Git 跟踪/待提交） |

### 2.3 测试

| 内容 | 路径/命令 |
|---|---|
| Host 测试（含 M3） | `packages/host/test/cases/v1.5-platform-update*.js`；`node --test packages/host/test/index.js` → 298/298 |
| Shared 测试 | `node --test tests/v1.5-platform-update.test.js` → 13/13 |
| Client 测试 | `node --test packages/client/test` → 266/266 |
| 发布工具测试 | `tests/v1.5-release-tools.test.js` |
| 全量门禁 | `npm run verify`（build + check + node --test）→ 1491/1491 pass, exit 0（在 `b0a35ca` 上跑过） |
| 静态检查 | `node scripts/check.mjs` → `CHECK OK (44)` |
| 发布身份校验 | `node scripts/release/verify.mjs --release <sha>` |

### 2.4 真实验证 harness

所有脚本在 `scripts/verification/v1.5/m3/`：

| 脚本 | 用途 |
|---|---|
| `lib.mjs` | 隔离 DSH_HOME、app.asar 提取/校验、启动 `dsh web`、CDP/Chrome、证据/报告工具 |
| `fixture.mjs` | 固定 URL 的**传输层**索引夹具（TLS 拦截代理），生产索引从不读写；含本地 mirror 网络模式 |
| `probe-m3-host.js` | 装进隔离 profile 的探针插件（host-route/install/observe 等） |
| `v1-common.mjs` | 单跳/多跳 runner 共用：真实页面打开、更新 UI 操作、身份读取、存档夹具、清理证明 |
| `run-v1-single-hop.mjs` | **V1 单跳**：base → target 真实 Client UI 更新，双端核验（最终证据用它） |
| `run-v1-hmr-chain.mjs` | V1 单 profile A→B→C 两跳（未跑通，见 §6.4） |
| `run-v1-nonhmr-restart.mjs` | 非 HMR pending-restart → 真实 Host 重启 → updated |
| `run-v1-preflight.mjs` | V1 环境门禁（banner/刷新按钮/客户端身份） |
| `run-v2-windows-idempotency.mjs` | 多窗口/重复点击幂等 |
| `run-v2-save-coordination.mjs` | 活跃游戏存档失败阻断包变更 |
| `run-v2-edges-index.mjs` | 恶意索引/无效 target/already-at-target/cancel/too-late/capability unknown/dev-row 等边界 |
| `verify-probe-releases.mjs` | probe release 验收（安装 + release.json 身份 + 客户端构建身份） |
| `run-v0-*.mjs`、`run-h1-tests-evidence.mjs` | V0 证据 |

隔离环境（临时，非仓库）：`/tmp/dsh-v15/m3/{asar,home-*,runs,logs,chrome-*}`；本地 mirror `/tmp/m3-mirror.git` + `/tmp/m3-mirror-gitconfig`；pnpm 预热目录 `/tmp/pnpm-warm-<sha>`（055c53e、b0a35ca、0cf939c、9bad078）。

### 2.5 其他交接物

- PR 正文草稿：`/tmp/m3-pr-body.md`（占位符待填最终 SHA/结果）。
- 验证 teammate 的最终报告与矩阵草稿已并入 `docs/verification/v1.5/plugin-update-m3.md`（**未提交**）与两个矩阵（已提交在 `3714978`）。
- Task board：task-1…5 completed；task-6（V1 真实链）、task-7（V2 边界）partial/未完成；task-8（docs 收尾）blocked。所有 teammate 已 inactive/interrupted。

---

## 3. 当前进度（精确）

### 3.1 提交链（从 main 起，仅列关键）

| 提交 | 内容 |
|---|---|
| `3b73da0` … `61c890e` | M3 设计冻结 + host 发现/适配器/协调/状态机 + client UI + release 工具 + 文档（主体实现） |
| `7e952f2` | V0 harness、discovery matrix、V0 证据 |
| `c19bfe1` | **真实缺陷 A 修复**：手动刷新与 6h 自动节流解耦 |
| `91237c6` | **真实缺陷 B 修复**：release 身份 repo URL 解析 + 重启恢复窗口 |
| `8f10705` | **真实缺陷 C 修复**：终态 operation 隐藏下一次更新入口（连续更新） |
| `344ce99` | probe release **A2**（v1.2.1，fixed client；P_A2=`1f69784`） |
| `055c53e` | probe release **B4**（v1.2.2；P_B4=`9a74007`） |
| `b0a35ca` | **最终候选 release R_final7（v1.3.0；P_final7=`1015309`；artifacts sha256-tree-v1 `0867b8f0…`，93 files/3,405,378 B；client.js sha256 `83bfb7af…`）** |
| `3714978` | 本地验证证据提交（**未 push**） |
| 已被取代、**不得作为目标** | `5c23344`/`af99227`/`f218ea8`/`bf6c37f`/`d29e45f`/`9bad078`/`0cf939c`/`ef8197d` 等 |

- 分支线性：`A2 344ce99 ⊂ B4 055c53e ⊂ R_final7 b0a35ca`。
- `platform-updates/release.json` 只存在于 release 提交（`b0a35ca`）；`platform-updates/plugins.json`（生产索引）**从未写入/提交**。
- 与 main 的 diff：284 files, +125049/−7843（含 games/registry 产物重建）。

### 3.2 固定 head 门禁（在 `b0a35ca` 上）

- `npm run verify` → **1491/1491 pass, 0 fail, exit 0**（build + check + node --test）。
- `node scripts/check.mjs` → `CHECK OK (44)`。
- `node scripts/release/verify.mjs --release b0a35ca…` → **verify OK**（自引用、版本、artifacts、client 身份一致）。
- `node scripts/build-client.mjs` → 两次构建字节一致（sha256 `83bfb7af…`）。
- Host 298/298、shared 13/13、client 266/266（均含 M3 新测试）。

> 注意：上述门禁是在 `b0a35ca` 上执行的；当前本地 HEAD `3714978` 只加了 docs/scripts/evidence，**尚未在 3714978 上重跑**。合并前需在最终 head D 上重跑（要求仍全绿）。

### 3.3 真实验证结果（已完成部分，均有 JSON 证据）

| ID | 场景 | 结果 | 证据 |
|---|---|---|---|
| V0 | harness/fixture/exact-commit 安装/discovery 160/160/preflight 30/30/probe-release acceptance | **PASS** | `docs/verification/v1.5/raw/m3/M3-V0-harness-2026-10-20T11-48-47-688Z.json`、`M3-V0-fixture-*`、`M3-V0-exact-install-*`、`M3-V0-discovery-matrix-*`、`M3-V0-h1-tests-*`，以及 `M3-v1-preflight-2026-10-21T07-14-32-261Z.json`、`M3-probe-release-acceptance-2026-10-21T07-19-02-015Z.json` |
| V1-1a | **A2→B4 单跳**，真实 Client UI（banner→dialog→confirm→states→updated） | **PASS 31/31** | `M3-v1-single-hop-2026-10-21T07-51-10-186Z.json`；Host `1.2.2+055c53e`，Client `1.2.2+9a74007`；存档/配置字节不变；清理证明 |
| V1-1b | **B4→R_final7 单跳**（连续第二跳），真实 Client UI | **PASS 31/31** | `M3-v1-single-hop-2026-10-21T08-01-41-538Z.json`；Host `1.3.0+b0a35ca`，Client `1.3.0+1015309` |
| V1-3 | 非 HMR：A2→B4 pending-restart（磁盘 1.2.2/运行 1.2.1）→ **真实 Host 重启** → activating→updated 双端；存档保留 | **PASS 59/59（required 57）** | `M3-v1-nonhmr-restart-2026-10-21T08-04-28-800Z.json` |
| V1-2 | **单 profile A→B→C 两跳** | **未跑通**（见 §6.4，不是产品失败；用 V1-1a+V1-1b 两个 fresh profile 各一跳共同证明连续两次更新） | 多个失败运行 JSON 如实保留（如 `M3-v1-hmr-chain-2026-10-21T07-16-44-164Z.json` 等） |
| V2-W | 多窗口/重复点击幂等 | **接近**：42 checks / 41 passed，唯一 required 失败 `window1-operation-updated` 是截图时仍 `activating` 的采集时序 | `M3-v2-windows-idempotency-2026-10-21T08-15-13-532Z.json` |
| V2-S | 活跃游戏存档失败阻断包变更 | **未完成**：runner 已启动但被“停止所有任务”中断，无结果 | 无最终证据（日志 `/tmp/dsh-v15/m3/logs/v2-save.log` 为空） |
| V2-其它 | 恶意索引/无效 target、already-at-target、cancel/too-late、capability unknown、dev-row shadow、清理 | **多数未跑或未定论**（不要声称通过） | 部分早期 runner/证据存在，需重跑 |

### 3.4 未提交 / 未推送状态（审查重点之一）

- 未推送：`3714978`（仅 docs/scripts/evidence，不改 artifacts）。
- 未提交：
  - `M docs/verification/v1.5/plugin-update-m3.md`（verification 最终报告，含 V1 PASS 行）
  - `M scripts/verification/v1.5/m3/run-v2-save-coordination.mjs`
  - `M scripts/verification/v1.5/m3/run-v2-windows-idempotency.mjs`
  - `??` 4 个新证据 JSON（非 HMR PASS、3 次 V2 windows）+ 7 张截图。
- 这些都**没有**进入 `b0a35ca` 的 release 身份/artifacts，所以不影响 R_final7 身份；但 PR 前必须提交或在本文说明。

### 3.5 明确未做

- PR 未创建（草稿在 `/tmp/m3-pr-body.md`，需填最终 head 与结果）。
- 未在最终 head D（`3714978` 或其后 docs-only 提交）上重跑 `npm run verify`/`check`。
- V2 剩余场景未完成（见上表）。
- PROJECT_MEMORY V1-54..V1-56 草案已由 docs-verifier 写好（在它最后消息里），**未并入仓库**。
- 真实 Electron/Desktop 窗口、生产官方索引内容、真实 GitHub 网络安装、跨进程锁竞争、真实 promote/撤回、非 Chromium/headed/soak —— 均未验证（见 §7）。

---

## 4. 为什么卡了这么久（诚实复盘）

时间跨度：2026-10-20 启动 → 2026-10-21 16:16 停止（约 30+ 小时，其中约 1/3 是等待网络窗口/失败重跑）。

### 4.1 外部环境（最大单一原因）

1. 本机到 GitHub 的路由极不稳定：DNS 解析到的 IP 被阻断（`github.com`/`api.github.com` 超时），本机代理 `127.0.0.1:7897` 时好时坏；备用 IP 140.82.112.3 / codeload / raw 可达但窗口短。
2. DSH 插件管理器的安装预检会执行 `git ls-remote`（5s 超时），且用 `scrubbedParentEnv()` **过滤掉含 `KEY/PASSWORD/SECRET/TOKEN` 的环境变量** —— 我们最初用 `GIT_CONFIG_KEY_*` 注入 pinned IP 被过滤成 `missing config key GIT_CONFIG_KEY_0`，静默失败多轮；最终改用 `GIT_CONFIG_GLOBAL`（隔离 gitconfig 文件里的 `http.curloptResolve`）才通过。
3. pnpm 对 `github:...#<sha>` 依赖每次要真实 fetch；后来预热 pnpm store（A2/B4/R_final7）把安装降到 2–7s，但管理器预检仍要网络。
4. 最终解法：**本地 bare mirror**（`/tmp/m3-mirror.git`）+ `GIT_CONFIG_GLOBAL` 的 `url.insteadOf`，使 `git ls-remote`/pnpm 完全离线，且 profile 里记录的依赖仍是 `github:heswy/dsh-game-market#<sha>`（身份/解析不变）。这是 2026-10-21 15:48 才打通的，之后 V1 两个单跳/非 HMR 才快速变绿。**诚实标注**：最后几条 PASS 的安装走隔离本地 mirror，未走公网 GitHub；公网 exact-commit 安装只在 V0 的网络证据里体现。

### 4.2 三个真实产品缺陷（每个都导致 probe 链重建 + 全量重跑）

- **A：手动刷新按钮被 6h 自动检查节流误禁用**（真实 Client 点击发现；`c19bfe1`）。修复后必须重建 A2/B2（旧 probe 的 client 不含修复），导致链从 `R_A/B2` 换成 `A2/B3`。
- **B：release 身份 parser 拒绝 repo URL（无 `.git`）+ 非 HMR 重启恢复 client-report 窗口仅 60s**（真实重启发现；`91237c6`）。修复后再次重建 B3/R_final5；链换成 `A2/B3/R_final6`。
- **C：终态 operation 保留导致下一次更新入口永久隐藏**（真实两跳发现；`8f10705`）。这是 M3 的核心价值之一（可持续更新），修复后重建 **B4/R_final7**，即当前链。
- 每次重建都意味着：新 P/R 提交 → push（网络）→ 重装验收 → 新证据 → 旧证据标 superseded。

### 4.3 验证 harness 自身不成熟（第二大人为成本）

- harness 边写边跑：多次 `ReferenceError`（缺 import/常量）、无界等待、截图先于渲染、发现 refreshed UI 选择器不对、CDP 20–30s 超时、清理时 `pkill -f` 误杀并发 run 的 shell/host。
- 真实页面驱动（CDP + headless Chrome + DSH 真 HMR reload）每轮 3–25 分钟；失败一次基本等于“这轮时间全损”。
- 并发事故（我的责任）：14:24 我在 verification 已启动 run 的同时又启动了一次，两边清理互相删除 home/chrome，浪费约 10 分钟；此后改为单 run 串行。
- “边改边跑”导致多次跑在编辑中的半成品脚本上（watchdog 未定义、`PLATFORM_UPDATE_PATH` 未定义等），每次约 5–10 分钟。
- 大部分时间是“改一行 → 跑一轮 → 等 10 分钟 → 网络失败/超时 → 再改”。见 §8 的流程建议。

### 4.4 单 profile 两跳为什么最终放弃

`run-v1-hmr-chain.mjs` 的第二跳需要：A→B4 更新后把 fixture 索引切到 R_final7 → 触发 Host discovery refresh → 等 target 切换 → 再走真实 UI begin。这里反复出现：fixture 切换与 Host 刷新时序/节流不一致、页面 reload 后 Market 面板/更新区未重新渲染、banner 检测过早；导致 begin 时 target 仍是 B4，Host 正确返回已终态/已装（**产品行为正确**，host unit test 也证明“终态+新目标=新 operation”）。为不无限迭代，改为两个 fresh profile 各跑一跳（V1-1a/1b）共同证明“连续两次精确 commit 更新”，并在文档里如实标注“单 profile 连续两跳未端到端跑通，原因是测试夹具/编排限制”。审查者可复核 Host 的两个回归测试与 client 的 8 个 offer 测试。

### 4.5 协作开销

- 5 个 teammate（host/client/release/verification/docs）+ Lead；多次 handoff、等待 inactive→resume、上下文丢失，实际推进靠 Lead 直接看日志/改脚本/重启 run。
- docs-verifier 因证据未定稿长期 blocked，最后才出矩阵；task board 的 blocked_by 也没有及时清理。

---

## 5. 实现摘要（供审查正确性）

> 以 `docs/V1.5-CONTRACTS.md` §9 + §17 与 `docs/verification/v1.5/m3-decisions.md` §8 为冻结契约；下面只是索引。

1. **发现**：固定 HTTPS URL（不可配置）；DSH plugin-market-index 格式 1 的**自有严格校验器**（不耦合公共包，虽然实测可 import）；绑定 plugin id/repo/`source.type=git`/精确 semver/完整 40-hex commit；stable 排除 prerelease，test 需显式 opt-in；HTTPS、≤256 KiB、5s、redirect≤3 不降级、单飞、6h 静默、60s 手动节流、原子缓存、失败保留上次 target、同版本不同 commit 报异常；发现失败不阻塞游戏/Market。错误码 `GM-5039/5040`，复用 `GM-4091/4090/5038`。
2. **适配器**：只用 `pluginManager` 公开方法（`installBundle/listBundles/listPlugins/waitForInstall/cancelInstall`）；begin 只接受已验证 discovery `targetId`，构造 `https://github.com/heswy/dsh-game-market.git#<40hex>`；同目标幂等、异目标 busy、终态+异目标新 operation；HMR 能力在树稳定后采样（present/absent/unknown fail-closed，按 hostEpoch+树签名缓存）；dev-row 影挡显式提示、不自动迁移。
3. **协调/恢复/状态机**：profile 级跨进程锁（心跳/陈旧接管）；所有活跃游戏实例 pause+save 确认才允许包变更（15s 超时/失败中止）；安装前落盘记录；HMR dispose/Client 刷新/RPC 丢失/进程重启可恢复；`waitForInstall()===null` 不当成功；`ambiguous-install` 用真实 version/commit 裁决；`too-late` 继续到终态；状态机 `inspecting→installing→applied→activating→updated`，`applied` 仅中间态，`updated` 需 Host 冻结身份+Client 自报身份+`/health` 三者匹配；`pending-restart/already-at-target/stale-runtime/verification-failed/failed/cancelled/too-late` 分支。
4. **UI**：Market 内“版本与更新”（Host/Client 完整 commit 身份、发现状态含 offline/stale/anomaly、手动刷新、明确“影响当前 profile 所有会话/可能需要重启”、无伪进度、`applied` 不报成功、结果/恢复入口）；身份只由 Client 自报自身编入 build；终态后仍显示新 target 的更新入口（缺陷 C 修复）。
5. **发布工具**：两段式 `P`（版本提交）→ `R`（release.json + 重建产物），`clientBuildCommit=P`；`release:prepare/promote/verify` 默认 dry-run、零依赖/local-git、索引独立提交拒自引用、stable 拒 prerelease、无 push/tag/fetch 副作用。`docs/plugin-update-release.md` 维护者流程。
6. **身份协议**：`updated` 要求 Host 运行 commit == 目标 commit 且 Client 自报 `release.json.clientBuildCommit` 匹配（Q2，待 Codex 裁决）；Client 不读磁盘版本冒充运行版本；hostEpoch 不作为重启证明。

---

## 6. 审查建议顺序（1–2 小时）

**0–15 分钟：读契约与进度**
1. 本文 §2/§3/§4；`docs/V1.5-CONTRACTS.md` §9、§17（尤其 §17.5 三个缺陷与修复）；`docs/verification/v1.5/m3-decisions.md` §8。
2. `git log --oneline origin/main..HEAD` 核对提交链；确认 `A2 ⊂ B4 ⊂ R_final7`，且 superseded 没有被当作目标。

**15–40 分钟：独立复跑门禁（只读命令）**
```bash
cd "/Users/orange/Orange Field/Matterhorn/dsh-game-market-worktrees/v1.5-platform-update"
npm run verify          # 期望 1491/1491 pass, exit 0（当前 HEAD 3714978 上需重跑确认）
node scripts/check.mjs  # 期望 CHECK OK (44)
node scripts/release/verify.mjs --release b0a35ca22199728d104ae1e632fb31053c544de2
node --test packages/host/test/index.js
node --test packages/client/test
```
注意：`npm run verify` 会重建产物；如果工作树不干净先看 §3.4，避免把未提交证据误当产品改动。

**40–70 分钟：复核证据与声明**
- 打开 §3.3 的 PASS JSON，核对：
  - `checks[]` 是否全 `ok:true`；`failedRequired` 是否为空；
  - `targets/releaseIdentities` 里的 commit 是否等于 §3.1；
  - `transitions` 是否 `installing→updated`（或非 HMR `pending-restart→…→updated`）；
  - `dataPreservation` 前后 sha 一致；`cleanup.proof.ok===true`（端口/pid/目录都清）；
  - V1 单跳是否真的包含 UI 操作（`uiActions`/`screenshots`/`dialog`），而不是 API-only。
- 抽查 `M3-v1-hmr-chain-*` 失败证据：确认失败原因是 harness/fixture/网络，不是产品错误（如 `GM-5033` 网络、target 未切换、截图时序）。
- 核对 `docs/verification/v1.5/plugin-update-m3.md`（未提交）里的 PASS 行与 JSON 是否一一对应；不要相信旧 head 的 PASS 被当成本 head。

**70–100 分钟：代码正确性抽审（按风险）**
1. `packages/host/src/update-operations.js`：状态机/恢复/幂等/锁；重点 `waitForInstall()===null`、`applied`、`updated` 三端匹配、`pending-restart`/`stale-runtime`、终态+新目标 begin。
2. `packages/host/src/update-adapter.js`：是否只调用公开 pluginManager、targetId 校验、spec 构造（不可注入 URL）、HMR 能力 fail-closed、dev-row 检测。
3. `packages/host/src/platform-update.js`：固定 URL/HTTPS/大小/redirect/超时/节流/原子缓存/失败保留/异常 channel；确认没有任何“可配置 URL”后门。
4. `packages/shared/src/platform-update.js`：格式 1 校验器是否严格（多余字段拒绝、prerelease/stable、commit 40hex、repo 绑定、`source.type=git`）。
5. `packages/client/src/update-state.js` + `components/update-section.js`：offerable/终态/恢复/build 身份自报；`client.js` 是构建产物，不要手改。
6. `scripts/release/**`：dry-run 默认、无 push/tag、两段式身份、index 自引用拒绝、artifacts 计算是否覆盖 roots、版本/buildCommit 绑定。
7. `scripts/build-client.mjs`：身份 banner 是否被正确嵌入且不破坏确定性。

**100–120 分钟：判断“还差什么”**
- 对照 §3.5 未做项与 §7 未验证清单，决定 PR 是否可以带 not-run 开放，还是要求先补 V2。
- 若发现产品缺陷：先记录最小复现 + 现有测试，**不要**自行重建 probe 链（问 Lead/owner）。

---

## 7. 未验证 / 不成立清单（不要被 PR 文案误导）

1. **单 profile A→B→C 连续两跳未端到端跑通**；改用 V1-1a + V1-1b 两个 fresh profile 单跳共同证明。若审查要求“同一 profile 内连续两跳”，这是缺口。
2. **最后几条 PASS 的安装传输**是隔离本地 git mirror（`GIT_CONFIG_GLOBAL url.insteadOf`），不是公网 GitHub；公网 exact-commit 安装只在 V0 网络证据（`verify-probe-releases`/`install-exact-commit`）里。
3. **真实 Electron/Desktop 窗口未验证**；用的是已安装 App 只读解出的 DSH 0.2.1-rc.2 `dsh web` + headless Chrome/CDP。
4. **生产官方索引从未读写**；索引是传输层 fixture（TLS 拦截），生产 `platform-updates/plugins.json` 不存在。
5. **V2 未完成**：多窗口幂等（41/42，1 项采集时序）、save-failure 阻断（被中断）、恶意索引/无效 target、already-at-target、cancel/too-late、capability unknown、dev-row shadow、清理证明——多数为 not-run。
6. 跨进程更新锁竞争、真实 ENOSPC/权限/内存档失败注入、非 Chromium/headed/soak、真实 stable promote/撤回/旧通道升级、PR head D 身份与最终门禁——未验证。
7. `html-v1` wrapper 迁移仍为 M4 前置；M3 不声称所有包格式阻止包外导航。
8. 已知测试不稳定：`packages/host/test/cases/saves.js` 配额清理在并发高负载下偶发 `ENOTEMPTY`（既有测试，单跑/quiet 时通过）；CDP evaluate 偶发 20–30s 超时（已加重试，仍可能出现在慢机器）。

---

## 8. 复现/继续推进的最小步骤

### 8.1 只读复核（安全）
见 §6 的命令。若 `npm run verify` 因工作树未提交内容变化而不一致，先 `git stash` 或直接读 §3.4 区分。

### 8.2 复跑真实 probe（需要 macOS + 已安装 DSH App + 临时资产）
环境前提：
- `/Applications/DeepSeek Harness.app`（0.2.1-rc.2）存在；harness 会从 `app.asar` 只读提取到 `/tmp/dsh-v15/m3/asar`（已有，可复用/重建，见 `lib.mjs`）。
- 本地 mirror `/tmp/m3-mirror.git` 存在（HEAD=b0a35ca）；若被清理：`git clone --bare --no-hardlinks <worktree> /tmp/m3-mirror.git`，并写 `/tmp/m3-mirror-gitconfig`：
```
[url "file:///tmp/m3-mirror.git"]
	insteadOf = https://github.com/heswy/dsh-game-market.git
	insteadOf = https://github.com/heswy/dsh-game-market
	insteadOf = github:heswy/dsh-game-market
```
- pnpm store 已预热 A2/B4/R_final7（`/tmp/pnpm-warm-<sha>`，可重建）。
- 单跳复跑：
```bash
node scripts/verification/v1.5/m3/run-v1-single-hop.mjs \
  --a 344ce99c57f03645cbb246a75a45845fc1e9d789 \
  --b 055c53e7f3fd912b84ff00975be016b572b13740 \
  --final b0a35ca22199728d104ae1e632fb31053c544de2 --label A2-to-B4
# 预期 PASS 31/31；证据写入 docs/verification/v1.5/raw/m3/
```
- 非 HMR：`run-v1-nonhmr-restart.mjs --a A2 --b B4 --final R_final7`（预期 PASS 59，含真实重启）。
- V2：`run-v2-windows-idempotency.mjs`、`run-v2-save-coordination.mjs`、`run-v2-edges-index.mjs`（见 §2.4；未跑完的按实际结果记录，不要补写成 PASS）。

### 8.3 收尾 PR 的路径（建议）
1. 提交 §3.4 未提交文件（证据/报告/runner 改动），重跑 `npm run verify` + `node scripts/check.mjs`（当前 head D）。
2. 把 `plugin-update-m3.md` 的 V2 状态按实际 PASS/FAIL/not-run 填好；矩阵同步。
3. push 本地提交到 `feat/v1.5-platform-update`（不要 force）。
4. 用 `/tmp/m3-pr-body.md` 开 PR，head 固定为最终 D；正文必须包含 §7 未验证清单 + Codex Q1–Q5。
5. **不 merge/tag/release/写生产索引**。

---

## 9. 需要 Codex/审查者裁决的问题（已写入契约/草稿）

- Q1：生产用自有严格格式 1 校验器（公共 `@deepseek-ai/dsh-plugin-market-index` 可 import 但未耦合）是否接受？
- Q2：Client 运行身份 = `{version, buildCommit=release.json.clientBuildCommit}`（文件不能自含自身 commit）；`updated` 需 Host 目标 commit + Client 声明 + health，是否接受两段式语义？
- Q3：release 身份放在包内 `platform-updates/release.json`（索引外无网络依赖）是否接受？
- Q4：test 通道配置 opt-in（`platformUpdate.channel`），stable 默认排除 prerelease，是否接受？
- Q5：手动刷新节流返回 `throttled:true`+`nextCheckAt`（不新增错误码）；`GM-4091` 复用为“更新进行中”，是否接受？

---

## 10. 当前机器状态（交接时）

- 所有验证进程（隔离 `dsh web`、Chrome、runner、mirror 相关）已停止；监听端口已确认清空；`/tmp` 资产保留（asar/mirror/warm/logs/runs）。
- 会话目标已置为 **paused**；teammates 全部 inactive/interrupted；未做 git push/merge/tag/release。
- 本 worktree 可写；`M3-REVIEW-BRIEF.md` 本身是未跟踪文件，PR 前请删除或明确不提交。
