# V1.5 M3 · 平台插件持续更新真实验证（isolated-DSH 证据）

> 状态：**进行中**。V0（隔离 harness + 固定官方索引 URL 传输层夹具 + 精确 commit 安装 helper）已完成并有其原始证据；
> V1（真实 Client UI 驱动的 A→B→C、恢复、混合态、非 HMR）与 V2（多窗口/幂等/存档阻断/取消/恶意索引等）
> 在 M3 实现与**验证专用 probe releases A/B/C** 推送前全部为 `not-run`，本文件不写任何未跑场景的通过结论。
>
> - 日期：2026-10-20
> - 分支：`feat/v1.5-platform-update`；worktree：`dsh-game-market-worktrees/v1.5-platform-update`
> - 基线：`origin/main` `40d701678e96d99e777520debb43e25b28ae2d0c`（V0 运行时实现尚未提交，HEAD 即基线）
> - 目标宿主：本机 `/Applications/DeepSeek Harness.app`，DSH `0.2.1-rc.2`（desktop-runtime / dsh / plugin-manager 同版），
>   app.asar sha256 `b9ec4c2bbc20c9dbc3e39fa4c961434a943434ab0a803052b26753dd15f3b066`（182,833,898 B）
> - 运行器：Node `v24.14.0`（`/opt/homebrew/opt/node@24/bin/node`），真实 Chrome `155.0.8059.85` headless（CDP）
> - 隔离根：`/tmp/dsh-v15/m3/**`（asar 只读解出副本、`home-*`、`runs`、`logs`、`fixture-*`）；**未读写 `~/.dsh`、App 安装目录、生产索引**
> - 证据级别：`automated` / `isolated-host`（隔离 `dsh web` + 真实插件服务）/ `isolated-browser`（CDP + 真实 DSH 页面/真实 Client 代码）/
>   `isolated transport fixture`（固定 URL 的传输层夹具，见 §1.2）/ `real-Desktop` / `not-run`。**未跑就是 not-run，不写成通过。**
> - 说明：本文件中的 `docs/verification/v1.5/raw/m3/...` 路径在 Lead 提交证据前以**纯文本**给出（`scripts/check.mjs` 只校验
>   反引号/链接形式的引用；等 Lead 在检查点提交 raw 证据后改为链接即可，避免本轮其他队友跑 `npm run verify` 时出现「证据未跟踪」的假红灯）。

## 0. 总表

| # | 场景 | 级别 | 状态 | 命令 | exit | 证据 |
|---|---|---|---|---|---|---|
| V0-1 | 隔离 harness 自证：运行时身份/解包一致性 + 独立 probe 操作者 + 真实 DSH 页面 + 清理自证 | isolated-browser | **PASSED**（33 checks / required 32 全过） | `node scripts/verification/v1.5/m3/run-v0-harness.mjs` | 0 | docs/verification/v1.5/raw/m3/M3-V0-harness-2026-10-20T11-48-47-688Z.json |
| V0-2 | 固定官方索引 URL 的传输层夹具：真实 DSH Host 进程内 `fetch` 命中夹具；传递/隧道/负向对照；生产索引未写 | isolated transport fixture | **PASSED**（28 checks / required 27 全过） | `node scripts/verification/v1.5/m3/run-v0-fixture.mjs` | 0 | docs/verification/v1.5/raw/m3/M3-V0-fixture-2026-10-20T11-51-00-675Z.json |
| V0-3 | 一次性精确 commit 安装 helper（真实 `pluginManager.installBundle`，隔离 fresh profile，存档保留） | isolated-host | **PASSED**（31 checks / required 31 全过；目标为已发布 v1.2.0 `f422e8d…`，非 A/B/C） | `node scripts/verification/v1.5/m3/install-exact-commit.mjs --commit f422e8d04b3b3de3f920a794317c0d28ee1246a2 --version 1.2.0` | 0 | docs/verification/v1.5/raw/m3/M3-V0-exact-install-2026-10-20T11-51-54-704Z.json |
| V1-1… | HMR A→B→C ×2、Host+Client 双端核验（真实 Client UI 操作） | isolated-browser | **not-run**（等待实现 + probe releases A/B/C 推送） | 见 §3 | — | — |
| V1-2… | 响应丢失/Client 刷新恢复、HMR dispose 存活 | isolated-browser | **not-run** | 见 §3 | — | — |
| V1-3… | 非 HMR pending-restart → 重启 → updated、旧代码仍运行证明 | isolated-browser | **not-run** | 见 §3 | — | — |
| V1-4… | 旧 Client + 新 Host 混合态 `stale-runtime(client-old)` | isolated-browser | **not-run** | 见 §3 | — | — |
| V2-1… | 多窗口并发/幂等/重复点击 | isolated-browser | **not-run** | 见 §4 | — | — |
| V2-2… | 活跃游戏存档失败阻断包变更、多实例协调、未响应实例超时 | isolated-browser | **not-run** | 见 §4 | — | — |
| V2-3… | already-installed / ambiguous-install / cancel / too-late | isolated-host + isolated-browser | **not-run** | 见 §4 | — | — |
| V2-4… | 能力 unknown 禁用、dev row 遮蔽、恶意索引/非法 target 拒绝与恢复 | isolated-browser | **not-run** | 见 §4 | — | — |
| V2-5… | 清理/泄漏自证（每个 V1/V2 运行内自带） | isolated-host | **not-run** | 见 §4 | — | — |

## 1. V0 · 方法与结果（已完成）

### 1.1 隔离 harness（`run-v0-harness.mjs`）

- **运行时身份**：每次运行从 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` **只读解出**到 `/tmp/dsh-v15/m3/asar`，
  并对 6 个身份关键文件（`package.json`、`dsh/package.json`、`dsh/desktop-runtime.json`、`@deepseek-ai/dsh/package.json`、
  `@deepseek-ai/dsh-plugin-manager/package.json`、`@deepseek-ai/dsh/lib/bin.js`）逐文件 sha256 与 app.asar 内字节比对；
  本轮 `extractionVerifiedAgainstInstalledApp: true`，版本全部 `0.2.1-rc.2`。陈旧/被改的解包副本无法冒充实机 DSH。
- **隔离 DSH_HOME**：`/tmp/dsh-v15/m3/home-v0-harness-*`（断言前缀，拒绝 `~/.dsh`）；`dsh web --no-open --port <p> --host 127.0.0.1`，
  `node --expose-internals`（复刻真实 Desktop 启动器的 loader 行为，M0 已实测不改变 HMR 结论）。
- **独立 probe 操作者**：探针插件以 `file://` row 注入（`v15-m3-probe`，不属于 `dsh-game-market`），`inject = ['pluginManager']`；
  boot 记录真实 `pluginManager` 方法集（`installBundle`/`waitForInstall`/`cancelInstall`/`listBundles` 均在）、
  `ownerEntryId`、`ownerContextIsProbeContext`，并证明默认 web profile 的 HMR 能力存在（`manager.ownerContext.get('hmr')`，轮询至稳定）。
- **真实 DSH 页面**：headless Chrome（CDP）加载隔离 Host 的 `http://127.0.0.1:<port>/?token=…` 真实页面，`waitForDshPage` 通过；
  页面内 same-origin `fetch('/api/game-market/health')` 与 `/api/game-market/installed` 均 200 且信封 `ok:true`；
  截图 docs/verification/v1.5/raw/m3/screenshots/M3-V0-harness-v0-harness-mvgme18o-808825.png（真实页面标题 `DeepSeek Harness`）。
- **环境注入可见性**：宿主进程标记 env（`M3_FIXTURE_RUN_TAG`）与 pnpm 代理 env 键被探针在进程内读回并落盘，证明"注入的环境变量确实生效在真实 Host 进程"。
- **清理自证**：Host 子进程 SIGKILL 后 `await exit` → 端口拒绝连接（`portAccepting=false`、`lsof -sTCP:LISTEN -t` 为空）→ PID 死亡 →
  home 与 Chrome 临时 profile 目录删除。evidence `cleanupProof.ok:true`，且运行结束后无任何监听/残留进程。

### 1.2 固定官方索引 URL 的传输层夹具（`run-v0-fixture.mjs`）

**要解决的问题**：发现代码 MUST 保持固定 URL
`https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json` 与策略（HTTPS/大小/超时/重定向），
验证又不能写生产索引、不能改产品 URL、不能给产品加测试专用分支。

**方法（传输层夹具，按请求可审计替换）**：

1. 用系统 `openssl`（`OpenSSL 3.6.1`）在 `/tmp/dsh-v15/m3/fixture-<tag>/tls` 生成一次性 CA + `raw.githubusercontent.com` 叶证书
   （SAN 仅 `DNS:raw.githubusercontent.com`；CA/叶证书 sha256 与指纹落盘；私钥运行结束删除）。
2. 本地启动**选择性 TLS 拦截代理**；隔离 Host 进程注入 `NODE_USE_ENV_PROXY=1`、`HTTPS_PROXY/HTTP_PROXY/ALL_PROXY=http://127.0.0.1:<夹具端口>`、
   `NODE_EXTRA_CA_CERTS=<夹具 CA>`、`NO_PROXY=127.0.0.1,localhost`。Node 24 的真实全局 `fetch` 因此走夹具代理；
   叶证书由夹具 CA 验证，产品代码的 TLS 校验没有被关闭。
3. 代理只对**固定 host + 固定 path** 的请求用夹具 body 回答；同一 host 其它 path **透传真实源站**（经本机 7897 代理、TLS 隧道到真实 origin，
   字节原样返回）；其它 host 为**不透明 CONNECT 隧道**（不拦截）。每个请求记录 `mode: fixture|passthrough|tunnel`、host、path、状态、字节、sha256。
4. 场景控制：`server-error`(503)、`oversize`(>256 KiB)、`slow`(4s)、`malformed-json` 可在不重启代理的情况下切换——
   供 V1/V2 的发现限制/超时/恶意索引用例复用同一夹具。

**本轮实测（全部 required 通过）**：

- fresh `node` 子进程（真实全局 fetch 代码路径）取固定 URL：200、365 B、sha256 与夹具 body 一致；审计日志记录 `mode:fixture` 且 path 精确匹配。
- 同一 host 其它 path（仓库 `package.json`）：审计记录 `mode:passthrough`，返回真实源站内容（非夹具字节）→ **只有固定 URL 被替换**。
- `https://api.github.com/…`：`mode:tunnel`（不拦截其它主机）。
- 场景切换：503 状态如实返回；oversize 返回 307,215 B（>256 KiB）；slow 实测 ~4 s 后才返回。
- 负向对照：去掉 `NODE_EXTRA_CA_CERTS` 后同一 fetch 失败，`causeCode: SELF_SIGNED_CERT_IN_CHAIN`（证明是夹具 CA 在起作用，而不是全局降级/忽略证书）。
- **真实 DSH Host 进程内证明**：隔离 `dsh web`（真实 0.2.1-rc.2）以夹具 env 启动，探针插件在 Host 进程内执行真实全局 `fetch` 固定 URL：
  200、365 B、sha256 与夹具一致；代理审计只记录到 **1 个** Host 期间的请求且 `mode:fixture`。
- **生产索引未写**：仓库内 `platform-updates/plugins.json` 运行前后 stat 完全一致（当前不存在 → 不存在）。

**诚实的限制（不得写成已验证）**：

- 这是 `isolated transport fixture`，不是生产索引内容、不是 Electron 主进程/真实 Desktop 网络栈；夹具 body 是验证数据
  （当前为格式 1 的占位形状，等 M3-H1 的严格校验器落地后再对齐成 validator-conformant fixture；transport 本身与 body 形状无关）。
- 该夹具方法依赖 Node 24 `NODE_USE_ENV_PROXY` 实验特性；真实 Desktop 的 Electron 主进程是否同样尊重该 env 未验证（见 §5 not-run）。

### 1.3 一次性精确 commit 安装 helper（`install-exact-commit.mjs`）

- 流程：fresh 隔离 home（只有 probe 操作者 row，无 `dsh-game-market`）→ 真实 `pluginManager.installBundle("https://github.com/heswy/dsh-game-market.git#<40hex>", {enabled:true, requestId})`
  → 断言 Remote Result → 等 HMR apply → 磁盘 package / profile 依赖串 / `listBundles` / `/api/game-market/health` 四处一致。
- 本轮用**已发布** v1.2.0 commit `f422e8d04b3b3de3f920a794317c0d28ee1246a2` 证明 helper 可用（M3 代码无关，commit/version 是参数）。
  原始 Remote Result（逐字，已脱敏保留 40-hex SHA）：

  ```json
  {"stage":"enable","target":"dsh-game-market","enabled":true,"changed":true,"application":"applied",
   "registries":[null],
   "packageResult":{"exitCode":0,"truncated":false,"output":"… + dsh-game-market github:heswy/dsh-game-market#f422e8d04b3b3de3f920a794317c0d28ee1246a2 …"},
   "bundle":"dsh-game-market","version":"1.2.0","warnings":[]}
  ```

- 断言（31/31）：fresh profile 无依赖/无磁盘包/无 health 路由 → 安装 `applied` + pnpm `exitCode:0` + `version:1.2.0`；
  profile 依赖串被 pnpm 归一化为 `github:heswy/dsh-game-market#f422…`；磁盘 package `1.2.0`；`listBundles` 显示 `version:1.2.0, installed:true`；
  bundle row 以新 fiber 运行；`/health` `version:1.2.0`；`storages/dsh-game-market` 下 marker 与 save fixture 字节 sha256 前后完全一致；
  probe 操作者 fiber 在安装前后不变；清理自证通过。
- 说明：本机 pnpm store 已有 v1.2.0（输出 `reused 1`），所以本次安装很快；这不影响「精确 commit → 隔离 profile 内真实生效」的结论，
  但 A/B/C 的连续更新将使用新推送的 commit（必为真实 fetch），由 V1 runner 记录 `packageResult.output` 原文。
- **A/B/C 验证专用 probe releases 尚未推送 → 以 A/B/C 为目标的安装 not-run**（计划见 §2）。

## 2. 验证专用 probe releases A/B/C 计划（Lead 执行 git）

**边界**：不写生产索引、不打 tag、不创建 GitHub Release、不合并 main。A/B/C 只是 origin 上的**验证用分支提交**（可被 pnpm 按精确 SHA 拉取），
版本使用稳定、递增且低于 M3 最终版本 `1.3.0` 的 `1.2.1 / 1.2.2 / 1.2.3`（稳定通道无 prerelease）。每个 release commit `R_x` 内含
`release.json {schemaVersion:1, version, clientBuildCommit: P_x}` 与确定性构建产物（client.js 内嵌 `{version, buildCommit:P_x}`、games dist、registry），
`P_x` 是 `R_x` 的父（版本提交）。双端身份协议见 `docs/verification/v1.5/m3-decisions.md` §4。

前提：M3 实现提交 `I` 已在 `feat/v1.5-platform-update` 且 `npm run verify` 绿、worktree 干净；`scripts/release/` 工具已就绪。

**命令序列草案**（`release-tools` CLI 冻结后以其实际 flag 为准；所有 git 写操作由 Lead 执行）：

```bash
cd "/Users/orange/Orange Field/Matterhorn/dsh-game-market-worktrees/v1.5-platform-update"
test -z "$(git status --porcelain)" || { echo "worktree must be clean"; exit 1; }
git switch -c verify/m3-probes        # 从实现提交 I 派生；仅为验证分支

# ---- A = 1.2.1 ----
npm version 1.2.1 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(verify): probe release A version 1.2.1"
P_A=$(git rev-parse HEAD)
npm run release:prepare -- --version 1.2.1 --write     # 生成 release commit R_A（含 release.json{clientBuildCommit:P_A}+产物）
R_A=$(git rev-parse HEAD)

# ---- B = 1.2.2 ----
npm version 1.2.2 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(verify): probe release B version 1.2.2"
P_B=$(git rev-parse HEAD)
npm run release:prepare -- --version 1.2.2 --write
R_B=$(git rev-parse HEAD)

# ---- C = 1.2.3 ----
npm version 1.2.3 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(verify): probe release C version 1.2.3"
P_C=$(git rev-parse HEAD)
npm run release:prepare -- --version 1.2.3 --write
R_C=$(git rev-parse HEAD)

# ---- push：每个 R_x 都作为可达分支 tip，保证 pnpm 能按 SHA fetch ----
git push origin verify/m3-probes \
  "${R_A}:refs/heads/verify/m3-probe-a" \
  "${R_B}:refs/heads/verify/m3-probe-b" \
  "${R_C}:refs/heads/verify/m3-probe-c"
git rev-parse "$R_A" "$R_B" "$R_C"     # ← 回填到 V1 证据与本文档
```

**验收/记录要求**（Lead 把结果发回 verification）：

1. 三个 40-hex SHA（A/B/C）与对应版本 1.2.1/1.2.2/1.2.3；三个 commit 均来自 M3 实现。
2. 每个 `R_x` 的 `git show R_x:package.json` version 等于 `x`；`git show R_x:platform-updates/release.json` 的 `clientBuildCommit` == `P_x`（其父提交）。
3. `git ls-remote origin` 能看到 3 个 `verify/m3-probe-*` ref；`git cat-file -e <sha>^{commit}` 在干净 clone 通过。
4. 无 tag、无 Release、无生产索引写入；`origin/main` 未变化。
5. 推送后不要删除这些分支，直到 M3 验收记录 SHAs（可复现性）；最终清理在 Lead 的交付说明里注明。

**验证侧将执行的复跑前置检查**（只读 git，不写）：`git ls-remote`、`git cat-file` 校验上述身份与 `release.json` 一致性，结果作为 V1 证据的 `targets` 字段。

## 3. V1 场景矩阵（not-run，等待实现 + A/B/C）

Runner 将全部在隔离 DSH_HOME + 固定 URL 传输夹具下执行；更新动作由**真实 Client UI**（CDP 真实点击/输入，非直接 API）发起，
Host 侧用 probe 操作者与页面 same-origin 路由做旁证；原始 JSON 脱敏后进 `docs/verification/v1.5/raw/m3/`。

| # | 要求 | 断言要点 | 状态 |
|---|---|---|---|
| V1-1 | HMR A→B→C 连续两次精确 commit 更新 | 一次性安装 A（1.2.1）→ UI 更新到 B（1.2.2）→ UI 更新到 C（1.2.3）；每次 `applied→activating→（旧 Client 刷新）→updated`；Host `loadedVersion`+`buildCommit`、Client 自身上报 `buildVersion`+`buildCommit`、`/health` 健康三者匹配目标 | not-run |
| V1-2 | 双端身份不得用 Host 返回值冒充 Client / 不得 applied 当成功 | 旧 Client 期间 `stale-runtime(client-old)`；刷新后 Client 加载新 client.js 并上报新身份才 `updated`；UI 文案在 updated 前不出现"已更新" | not-run |
| V1-3 | 响应丢失/刷新恢复 | 安装中刷新页面/丢 RPC：Host 持久记录恢复观察，无假成功，终态正确（`updated` 或明确 `verification-failed(response-lost)` 且可恢复） | not-run |
| V1-4 | HMR dispose 存活 | 被更新 bundle row 被 disposal/re-apply 期间操作持有者（Host 服务/探针 fiber）存活，更新操作持续到终态 | not-run |
| V1-5 | 非 HMR pending-restart | 显式禁用 `hmr` row 的隔离 profile：更新 → `pending-restart(no-hmr)`；证明磁盘已新、运行仍旧（Host `/health.loadedVersion` 旧值 + hostEpoch 不变≠进程重启证据）；重启 Host → `activating→updated` 双端核验；存档/配置保留 | not-run |
| V1-6 | 混合态旧 Client + 新 Host | 保留旧页面 client 构建（旧 buildCommit 上报）→ Host 新；必须 `stale-runtime(client-old)`，不得报成功；刷新后 `updated` | not-run |
| V1-7 | 数据保留 | `storages/dsh-game-market`、saves、配置（preferences）在 A→B→C 与重启前后字节/语义一致 | not-run |

## 4. V2 场景矩阵（not-run，等待实现 + A/B/C）

| # | 要求 | 断言要点 | 状态 |
|---|---|---|---|
| V2-1 | 多窗口并发更新 + 幂等 | 两个真实页面同时点更新 → 同一 `operationId`、无重复 installBundle、两端收敛同一终态；单窗口快速重复点击幂等 | not-run |
| V2-2 | 活跃游戏存档失败阻断包变更 | 真实游戏实例运行中；注入保存失败（如 saves 目录只读/保存错误）→ 更新在包变更**之前**中止（无 installBundle、旧版本仍运行）、UI 可操作提示；恢复保存 → 重试成功；跨窗口两个实例都需暂停+确认；未响应实例超时阻断 | not-run |
| V2-3 | already-installed / 同 commit | 已在目标 → `already-at-target`（非 failed、不重装）；记录 spec 形态重放 / URL 形态同目标 → 核对实际版本/commit 后映射正确 | not-run |
| V2-4 | ambiguous-install | 复现 URL 形态重复安装的 `ambiguous-install`（pnpm exit 0、依赖串/live 版本不变）→ adapter 不得报成功：同目标 `already-at-target`，否则 `verification-failed` + 实际版本证据 | not-run |
| V2-5 | cancel / too-late | installing 期 cancel → `cancelled`（安装不继续）；`applying` 期 cancel → `too-late`，安装继续并观察到正确终态，绝不显示"已取消/已回滚" | not-run |
| V2-6 | 能力 unknown | 强制 `hmr` 采样超时/服务缺失 → `canBeginUpdate=false`、原因可读、市场/游戏不受影响 | not-run |
| V2-7 | dev row 遮蔽 | 隔离 profile 注入同 id dev row → inspect 报告 `stale-runtime(dev-row-shadows-package)`、更新禁用、给原生插件管理指引、无静默迁移（无 installBundle） | not-run |
| V2-8 | 恶意索引/非法 target 拒绝且有恢复路径 | 夹具 index 覆盖：错误 repo/插件名、branch/tag/短 SHA/本地路径/file:/裸包名、stable 通道 prerelease、超 256 KiB、5s 超时、重定向降级、同版本不同 commit、version/commit 与包不符 → 明确错误码、不发起更新、保留上次成功 target/离线态、游戏不受影响；直接伪造 targetId/任意 spec 调 begin → 拒绝 | not-run |
| V2-9 | 失败恢复路径 | `failed`/`verification-failed` 后 UI 恢复入口可操作；修复后重新 begin 成功；持久记录反映恢复、无卡死锁 | not-run |
| V2-10 | 清理/泄漏自证 | 每个 runner 内：端口拒绝、PID 死亡、隔离 home 删除、无残留 DSH/Chrome 子进程 | not-run（V0 已各自证；V1/V2 runner 内建） |

## 5. 未验证 / 限制（本阶段如实）

1. **真实 Desktop / Electron 主进程**：全部证据来自隔离 `dsh web` + headless Chrome；真实 App 内 Electron 主进程的发现网络栈、
   原生窗口 UI、真实用户 profile 未验证（不碰 `~/.dsh`）。
2. **生产官方索引**：从未抓取/写入生产索引；夹具 body 是验证数据，不代表线上内容，也不证明线上索引当前格式正确。
3. **A/B/C 与全部 V1/V2 场景**：`not-run`（等待实现提交与验证分支推送）；本文件不预写任何通过结论。
4. **V2-6 能力 unknown 的构造**：需要在隔离 profile 上人为制造采样超时/服务缺失并证明真实 fail-closed；若实现未提供可注入 seam，
   将以「只读操作路径 + 最小环境改动」尝试并在证据里如实标注。
5. **多窗口**：同一隔离 Host 上开两个真实页面（同一 web profile）；不同 profile 的跨进程锁（cross-process profile lock）用两个隔离 Host
   指向同一 profile 目录的形式验证，若宿主不支持共享 profile 目录则标 `not-run` 并说明。
6. **pnpm 出网**：隔离 Host 注入本机 `127.0.0.1:7897` 代理 env（仅进程内，不改用户/App 配置）；真实用户网络条件未覆盖。
7. **长时稳定性**：未做 soak；每次运行都是短时验证。

## 6. 证据索引

V0（已生成，等待 Lead 在检查点提交 raw 证据；提交前以下路径为纯文本）：

| 证据 | 内容 |
|---|---|
| docs/verification/v1.5/raw/m3/M3-V0-harness-2026-10-20T11-48-47-688Z.json | 运行时身份/解包一致性、probe 操作者、真实页面、health/installed 路由、清理自证 |
| docs/verification/v1.5/raw/m3/screenshots/M3-V0-harness-v0-harness-mvgme18o-808825.png | 真实 DSH 页面截图 |
| docs/verification/v1.5/raw/m3/M3-V0-fixture-2026-10-20T11-51-00-675Z.json | 传输夹具：TLS 材料指纹、审计日志、场景切换、负向对照、Host 进程内 fetch、生产索引未触碰、清理自证 |
| docs/verification/v1.5/raw/m3/M3-V0-exact-install-2026-10-20T11-51-54-704Z.json | 精确 commit 安装原始 Remote Result、profile/磁盘/health/listBundles 一致性、存档保留、清理自证 |

V1/V2：`not-run`，运行后按 `M3-V1-*.json` / `M3-V2-*.json` 命名追加。

## 7. 复跑命令

```bash
cd dsh-game-market-worktrees/v1.5-platform-update
node scripts/verification/v1.5/m3/run-v0-harness.mjs
node scripts/verification/v1.5/m3/run-v0-fixture.mjs
node scripts/verification/v1.5/m3/install-exact-commit.mjs \
  --commit f422e8d04b3b3de3f920a794317c0d28ee1246a2 --version 1.2.0
```

约定：所有 runner **required 断言失败即非零退出**；证据经 `sanitiseM3` 脱敏（**保留 40 位 commit SHA**、semver、`/tmp` 路径；
遮蔽 token/Bearer/32 位会话凭证/`/Users/<user>`）；运行结束前做端口拒绝 + PID 死亡 + 临时 home/配置删除自证。
