# V1.5 M3 · 平台插件持续更新真实验证（isolated-DSH 证据）

> 状态：**V0 已完成；V1/V2 以 R_final5 目标执行中（B-hop 待 B3 重建后复跑）**。
> - **V0**：隔离 harness 自证、固定官方索引 URL 传输层夹具、一次性精确 commit 安装 helper、实现测试提交树独立复跑、
>   发现策略矩阵、**V1 preflight 环境门禁**——全部 PASSED 并有原始证据。
> - **实现**：H1 `6d94779` → H2 `61c890e` → 客户端加固 `c95987d` → 构建产物 `7fe3ae4` → 验证 harness `7e952f2`
>   （已冻结评审；`npm run verify` 在提交树通过，verification 独立复跑见 V0-6）。
> - **验证链**：`A2`（1.2.1）/`B2`（1.2.2）为验证专用 probe releases，`R_final5`（1.3.0）= 当前 PR head 候选
>   （release-style commit，**不打 tag、不发布、不合并 main**）；三者线性祖先 A2⊂B2⊂R_final5。
>   旧 `R_A/R_B/R_final/R_final2/R_final3/R_final4` 为 superseded fixture，只保留历史证据，不作任何目标。
> - **V1/V2**（真实 Client UI 驱动 A2→B2→R_final5、恢复/混合态、非 HMR、多窗口/幂等/存档阻断/取消/恶意索引等）
>   结果在本轮运行完成后逐项填入 §3/§4；未完成项保持 `not-run`，不写未跑场景的通过结论。
>
> - 日期：2026-10-20
> - 分支：`feat/v1.5-platform-update`；worktree：`dsh-game-market-worktrees/v1.5-platform-update`
> - 基线：`origin/main` `40d701678e96d99e777520debb43e25b28ae2d0c`；H1 证据提交 `6d94779`；V0 证据提交 `3b73da0`
> - 目标宿主：本机 `/Applications/DeepSeek Harness.app`，DSH `0.2.1-rc.2`（desktop-runtime / dsh / plugin-manager 同版），
>   app.asar sha256 `b9ec4c2bbc20c9dbc3e39fa4c961434a943434ab0a803052b26753dd15f3b066`（182,833,898 B）
> - 运行器：Node `v24.14.0`（`/opt/homebrew/opt/node@24/bin/node`），真实 Chrome `155.0.8059.85` headless（CDP）
> - 隔离根：`/tmp/dsh-v15/m3/**`（asar 只读解出副本、`home-*`、`runs`、`logs`、`fixture-*`、`verify-trees`）；**未读写 `~/.dsh`、App 安装目录、生产索引**
> - 证据级别：`automated` / `isolated-host`（隔离 `dsh web` + 真实插件服务）/ `isolated-browser`（CDP + 真实 DSH 页面/真实 Client 代码）/
>   `isolated transport fixture`（固定 URL 的传输层夹具，见 §1.2）/ `real-Desktop` / `not-run`。**未跑就是 not-run，不写成通过。**
> - 引用约定：已在 `3b73da0`/`6d94779` 提交的证据用链接；本轮新增、尚未提交的 raw 证据在表格里以**纯文本**给出
>   （`scripts/check.mjs` 只校验反引号/链接引用），Lead 检查点提交后转链接，避免其他队友跑 `npm run verify` 时出现「证据未跟踪」假红灯。
> - **绑定目标（Lead 2026-10-20 最终确认）**：
>   `A2=R_A2` `344ce99c57f03645cbb246a75a45845fc1e9d789`（1.2.1，P_A2=`1f6978482a375736bfd419c168b63aec4531c255`，client 构建身份 1.2.1/P_A2）；
>   `B2=R_B2` `ef8197dc3a6979227037e7739a2aac9e3ea4a709`（1.2.2，P_B2=`0591b9075b3d74ce2cadb7eae736c19166af687f`）；
>   `R_final5=d29e45f79ce01fc03927ed9000ee3ee8a304b2c6`（1.3.0，P_final5=`4a4d952390bef89128e7d20c3fa4b8b7c364ff10`，client 构建身份 1.3.0/P_final5；含 host identity/recovery 修复）。
>   HMR 链：安装 A2 → 真实 Client UI 更新到 B2 → 真实 Client UI 更新到 R_final5（含 fixed-client 刷新门禁）；
>   非 HMR：安装 A2 → 更新 B2 → pending-restart → 重启 → 双端 1.2.2。

## 0. 总表

| # | 场景 | 级别 | 状态 | 命令 | exit | 证据 |
|---|---|---|---|---|---|---|
| V0-1 | 隔离 harness 自证：运行时身份/解包一致性 + 独立 probe 操作者 + 真实 DSH 页面 + 清理自证 | isolated-browser | **PASSED**（33 checks / required 32 全过） | `node scripts/verification/v1.5/m3/run-v0-harness.mjs` | 0 | [M3-V0-harness-2026-10-20T11-48-47-688Z.json](raw/m3/M3-V0-harness-2026-10-20T11-48-47-688Z.json) |
| V0-2 | 固定官方索引 URL 的传输层夹具：真实 DSH Host 进程内 `fetch` 命中夹具；透传/隧道/负向对照；生产索引未写 | isolated transport fixture | **PASSED**（28 checks / required 27 全过；夹具 body 已对齐 H1 严格校验器） | `node scripts/verification/v1.5/m3/run-v0-fixture.mjs` | 0 | docs/verification/v1.5/raw/m3/M3-V0-fixture-2026-10-20T12-13-15-362Z.json（对齐后复跑）；初始证据 [11-51-00-675Z](raw/m3/M3-V0-fixture-2026-10-20T11-51-00-675Z.json) |
| V0-3 | 一次性精确 commit 安装 helper（真实 `pluginManager.installBundle`，隔离 fresh profile，存档保留） | isolated-host | **PASSED**（31 checks / required 31 全过；目标为已发布 v1.2.0 `f422e8d…`，非 A/B） | `node scripts/verification/v1.5/m3/install-exact-commit.mjs --commit f422e8d04b3b3de3f920a794317c0d28ee1246a2 --version 1.2.0` | 0 | [M3-V0-exact-install-2026-10-20T11-51-54-704Z.json](raw/m3/M3-V0-exact-install-2026-10-20T11-51-54-704Z.json) |
| V0-4 | H1 测试独立复跑（**提交树** `6d94779` 的 pristine 提取，非队友口头报告） | automated | **PASSED**（shared 13/13 + host 245/245，exit 0） | `node scripts/verification/v1.5/m3/run-h1-tests-evidence.mjs --ref 6d94779eae88fd6131c5a83d9333987c53c61daa --write-evidence` | 0 | docs/verification/v1.5/raw/m3/M3-V0-h1-tests-committed-ref-6d94779eae88-2026-10-20T12-06-26-690Z.json |
| V0-5 | 发现策略矩阵（真实 Host 路由 + 固定 URL 夹具）：valid/cache、节流、超时、>256KiB、offline 保留 target、异常、恶意索引/绑定拒绝、测试通道、client-report、begin fail-closed | isolated-host + isolated transport fixture | **PASSED**（160 checks / required 160 全过） | `node scripts/verification/v1.5/m3/run-v0-discovery-matrix.mjs` | 0 | docs/verification/v1.5/raw/m3/M3-V0-discovery-matrix-2026-10-20T12-10-36-937Z.json |
| V0-6 | 实现测试提交树独立复跑（host/shared/client/release 四套件） | automated | **PASSED**（host 292/292、shared 13/13、client 255/255、release-tools 37/37，exit 0） | `node scripts/verification/v1.5/m3/run-h1-tests-evidence.mjs --ref 7e952f2… --write-evidence` | 0 | docs/verification/v1.5/raw/m3/M3-implementation-tests-committed-ref-7e952f277c24-2026-10-20T12-24-04-731Z.json |
| V0-7 | **V1 preflight 环境门禁**：安装 A2 的 Client 构建身份/非 dev-row/可达 update banner/固定刷新按钮（60s 节流后 enabled→真实 POST→单次请求→无 6h 禁用） | isolated-browser | **PASSED**（30 checks / required 30 全过） | `node scripts/verification/v1.5/m3/run-v1-preflight.mjs --a 344ce99… --b ef8197d… --final bf6c37f…` | 0 | docs/verification/v1.5/raw/m3/M3-v1-preflight-2026-10-20T15-00-50-869Z.json |
| V1-1… | HMR A2→B2→R_final5、Host+Client 双端核验（真实 Client UI 操作） | isolated-browser | **running / not-run**（见 §3 结果表） | 见 §3 | — | — |
| V1-2… | 响应丢失/Client 刷新恢复、HMR dispose 存活 | isolated-browser | **not-run** | 见 §3 | — | — |
| V1-3… | 非 HMR（A2→B2）pending-restart → 重启 → updated、旧代码仍运行证明 | isolated-browser | **running / not-run** | 见 §3 | — | — |
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
  截图 [screenshots/M3-V0-harness-v0-harness-mvgme18o-808825.png](raw/m3/screenshots/M3-V0-harness-v0-harness-mvgme18o-808825.png)（真实页面标题 `DeepSeek Harness`）。
- **环境注入可见性**：宿主进程标记 env（`M3_FIXTURE_RUN_TAG`）与 pnpm 代理 env 键被探针在进程内读回并落盘，证明"注入的环境变量确实生效在真实 Host 进程"。
- **清理自证**：Host 子进程 SIGKILL 后 `await exit` → 端口拒绝连接（`portAccepting=false`、`lsof -sTCP:LISTEN -t` 为空）→ PID 死亡 →
  home 与 Chrome 临时 profile 目录删除。evidence `cleanupProof.ok:true`，且运行结束后无任何监听/残留进程。

### 1.2 固定官方索引 URL 的传输层夹具（`run-v0-fixture.mjs` + `fixture.mjs`）

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
4. 场景控制（不重启代理即可切换，供发现限制/超时/恶意索引用例复用）：`valid`（可运行时换整个 index body）、`server-error`(503)、
   `oversize`(>256 KiB)、`slow`(4s)、`timeout`(8s，超过 5s 发现预算)、`abort`(连接断开)、`malformed-json`、
   `redirect-http`(降级到 http)、`redirect-loop`(超过 maxRedirects)。
5. 夹具默认 body 与 H1 严格校验器 **精确格式 1 对齐**：`{format:1, title:{en,…}, plugins:[{name:'dsh-game-market', versions:[
   {version, publishTimestamp, source:{type:'git',url:'https://github.com/heswy/dsh-game-market.git',commit:<40hex>}}]}]}`。

**本轮实测（全部 required 通过）**：

- fresh `node` 子进程（真实全局 fetch 代码路径）取固定 URL：200、body sha256 与夹具一致；审计日志记录 `mode:fixture` 且 path 精确匹配。
- 同一 host 其它 path（仓库 `package.json`）：审计记录 `mode:passthrough`，返回真实源站内容（非夹具字节）→ **只有固定 URL 被替换**。
- `https://api.github.com/…`：`mode:tunnel`（不拦截其它主机）。
- 场景切换：503 如实返回；oversize 返回 307,215 B（>256 KiB）；slow 实测 ~4 s 后才返回。
- 负向对照：去掉 `NODE_EXTRA_CA_CERTS` 后同一 fetch 失败，`causeCode: SELF_SIGNED_CERT_IN_CHAIN`（证明是夹具 CA 在起作用，而不是全局降级/忽略证书）。
- **真实 DSH Host 进程内证明**：隔离 `dsh web`（真实 0.2.1-rc.2）以夹具 env 启动，探针插件在 Host 进程内执行真实全局 `fetch` 固定 URL：
  200、body sha256 与夹具一致；代理审计只记录到 **1 个** Host 期间的请求且 `mode:fixture`。
- **生产索引未写**：仓库内 `platform-updates/plugins.json` 运行前后 stat 完全一致（当前不存在 → 不存在）。

**诚实的限制（不得写成已验证）**：

- 这是 `isolated transport fixture`，不是生产索引内容、不是 Electron 主进程/真实 Desktop 网络栈；夹具 body 是验证数据。
- 该夹具方法依赖 Node 24 `NODE_USE_ENV_PROXY`；真实 Desktop 的 Electron 主进程是否同样尊重该 env 未验证（见 §5 not-run）。

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
  但 A/B/R_final 的连续更新将使用新推送的 commit（必为真实 fetch），由 V1 runner 记录 `packageResult.output` 原文。
- **A/B/R_final 验证专用 probe releases 尚未推送 → 以其为目标的安装 not-run**（计划见 §2）。

### 1.4 发现策略矩阵（`run-v0-discovery-matrix.mjs`，H1 基座）

真实 Host 路由（`/api/game-market/platform-update*`，当前 worktree 的 Host 插件以 dev row 启动）在隔离 `dsh web` 中、固定 URL 夹具之下逐项验证；
每个用例使用 fresh 隔离 profile，Host 退出后端口/PID/home 清理自证。**结果：160 checks / required 160 全过，exit 0。**

| 用例 | 关键断言（实测） |
|---|---|
| valid | ready + target 1.2.0/`f422e8d…`；indexUrl=固定 URL；channel=stable；target spec=`gitUrl#commit`；target id 模式；cache 文件原子可解析且 target/indexHash 一致 |
| refresh-throttle | 60s 内 POST refresh → `throttled:true`、`refreshed:false`、夹具请求数不增加 |
| refresh-allowed | 用"上次成功检查在 10 分钟前"的隔离 cache fixture + `startupCheck:false`：refresh 放行并真实 fetch 一次，target 更新到 1.2.2，cache 同步 |
| oversize | >256 KiB → `invalid` / `lastError.reason=too-large` / target null，GET 仍 200 |
| timeout | 夹具延迟 8s，5s 预算内中止 → `offline` / `reason=timeout` / retryable，target null |
| malformed-json | `invalid` / `reason=json` |
| unbound-repo | 索引指向非官方 repo → `invalid` / `reason=binding` |
| file-source | `file:` 源 → `invalid` / `reason=format` |
| short-sha | 7 位短 SHA → `invalid` / `reason=format` |
| redirect-http | 302 到 http → `invalid` / `reason=redirect` |
| redirect-loop | 302 自循环超过 maxRedirects → `invalid` / `reason=redirect` |
| offline-keeps-target | 连接中断 + 旧 cache → `offline` / `reason=network`，**上次成功 target 保留** |
| anomaly | 同版本不同 commit（previous-target）→ `discovery.anomaly.kind=same-version-different-commit`、expected/found commit 正确、`canBeginUpdate=false` |
| prerelease-stable | 只有 prerelease → 稳定通道 target null（ready、无错误） |
| test-channel-optin | 配置 `channel=test` 显式 opt-in → 选中 1.3.0-alpha.1（稳定通道不选） |
| client-report | 合法自报身份 accepted/idle；非法 buildVersion/buildCommit → 4xx 拒绝 |
| begin-fail-closed | H1 基座下 begin 返回 GM-5038（adapter 不可用），不产生 operation；伪造 targetId 亦不启动（H2 后应为 GM-4090，见 §3/§4） |

**边界（诚实）**：矩阵使用 dev row profile，`capability.canBeginUpdate` 因 dev-source 遮蔽而为 false，不能作为完整能力矩阵证据；
adapter/observation/协调/UI 路径不在本矩阵（H2/V1/V2）。另：并发队友在共享 worktree 编辑 H2 时，直接对 worktree 跑 `packages/host/test/index.js`
会命中"编辑中"的失败（实测 246 tests/2 fail，begin 409 vs 503）；因此 §1.5 用**提交树 pristine 提取**复跑，避免把队友未提交的中间态当成 H1 结论。

### 1.5 H1 测试独立复跑（`run-h1-tests-evidence.mjs --ref`）

`git archive 6d94779…` 解出到 `/tmp/dsh-v15/m3/verify-trees/`（`node_modules` 只读软链，**不修改共享 worktree**）后执行：

| 套件 | 命令 | 结果 |
|---|---|---|
| 共享平台更新 | `node --test tests/v1.5-platform-update.test.js` | **13/13 pass，exit 0**（138 ms） |
| Host 全量 | `node --test packages/host/test/index.js` | **245/245 pass，exit 0**（11.7 s） |

与 Lead 报告的数字一致，但这是 verification 自己执行的（逐测试名、计数、exit code、被测试树 commit 全部落盘）。

### 1.6 V1 preflight 环境门禁（`run-v1-preflight.mjs`，V0-7）

长链运行前的 2 分钟门禁，防止“harness 自己错”被写成产品结论：
隔离 fresh profile → 真实 `installBundle(A2 精确 commit)` → 真实页面；断言：
安装 `applied`/版本 1.2.1；Host identity loaded 1.2.1/A2；`devRowShadow=false` 且 `capability.canBeginUpdate=true`；
页面打开的“版本与更新”区显示 Host=1.2.1 与 Client=已安装 A2 构建身份（DOM `data-commit`）；
**服务给页面的 Client bundle 自身内嵌身份 == A2 的 `release.json.clientBuildCommit`**（防止 cwd/资源解析错误）；
update banner 指向 B2；60s 手动节流窗口后真实刷新按钮 enabled → 真实点击 → Host 收到一次真实刷新（夹具计数 +1、checkedAt 变化、
进入 60s 短暂节流而非 6h 禁用）；运行结束端口/PID/home/chrome 清理自证。**30/30 required 全过，exit 0**。
两个 harness 级修正（probe 中性路径、Host cwd）与一个产品缺陷（D1）详见 §2.1。

## 2. 验证专用 probe releases（已由 Lead 生成并推送，实际目标）

**边界**：不写生产索引、不打 tag、不创建 GitHub Release、不合并 main。A2/B2 只存在于 `feat/v1.5-platform-update`
分支历史中（按精确 SHA 可安装）；R_final5 是该分支的 release-style head。A2/B2/R_final5 均由**修复刷新缺陷后的同一代码树**生成，
`release:prepare --write` 产出确定性构建产物与包内 `platform-updates/release.json`（`clientBuildCommit` = 各自版本提交 P_x）。

| 代号 | 实际 SHA | 版本 | 身份（client build） | 说明 |
|---|---|---|---|---|
| A2 | `344ce99c57f03645cbb246a75a45845fc1e9d789` | 1.2.1 | 1.2.1 / P_A2 `1f69784…` | 验证专用 probe release（fixed client） |
| B2 | `ef8197dc3a6979227037e7739a2aac9e3ea4a709` | 1.2.2 | 1.2.2 / P_B2 `0591b90…` | 验证专用 probe release（fixed client） |
| R_final5 | `d29e45f79ce01fc03927ed9000ee3ee8a304b2c6` | 1.3.0 | 1.3.0 / P_final5 `4a4d952…` | M3 PR head（release-style，不发布）；含 host identity parser + recovery window 修复；artifacts sha256-tree-v1 `3293ae69…` |
| superseded | `2e2c1fc`/`70aacee`（旧 A/B）、`5c23344`/`af99227`/`f218ea8`/`bf6c37f`（旧 final 候选） | — | — | 历史 fixture，不得作为目标；其证据仅作历史 |

**只读验收（verification 独立执行）**：`verify-probe-releases.mjs` 在临时 clone 中重放
`git fetch --no-tags origin <sha>`（pnpm 精确 commit 安装同一 want-by-SHA 路径），校验：commit 存在、package/version、
`release.json{schemaVersion,version,clientBuildCommit==P_x}`、版本提交无自引用、`files[]` 可安装性 + 必需树文件、
client.js 内嵌身份且无 `RAW_IDENTITY` 占位、A2⊂B2⊂R_final5 线性祖先、`origin/feat/v1.5-platform-update == R_final5`、
无 tag、探针提交不含生产索引。**结果：79 checks / required 67 全过，exit 0**
（evidence：docs/verification/v1.5/raw/m3/M3-probe-release-acceptance-2026-10-20T14-45-57-669Z.json）。
注意：版本提交可能携带**上一版**发布身份（release 工具两阶段流程的预期中间态），要求仅为“无自引用”。

## 2.1 已发现的缺陷与 harness 有效性修正（preflight 断言，作为 §1.6 的记录）

1. **D1 客户端手动刷新被 6h 自动检查时间禁用（已修复）**：旧 Client `update-state.js` 用 `discovery.nextCheckAt` 当手动刷新倒计时；
   Host 在 `canRefresh=true` 时 `nextCheckAt` = 下一次**自动**检查（约 6h），导致发布后用户 ~6h 内无法手动刷新。修复 commit `c19bfe1`；
   A2/B2/R_final4 均含修复。验证：preflight 在 60s 节流窗口后断言按钮 enabled → 真实点击 → POST 刷新一次 → 短暂 60s 节流（无 6h 禁用）。
2. **D2 dev-row 启发式误判（产品健壮性，低；harness 规避）**：`update-adapter.js#devRowShadowOf` 把任何 `file:`/`link:` loader row
   且 moduleName **包含** bundle id 的 row 当作 dev row；验证 probe 插件若放在含 `dsh-game-market` 的 worktree 路径下会触发误判，
   使 `canBeginUpdate=false`（reason=devSource）。harness 已改为从 `/tmp/dsh-v15/m3/probe-plugin/` 中性路径加载 probe；
   产品侧建议更严格匹配 patchId/moduleName（未阻塞本轮）。
3. **D3 harness 有效性：Host cwd 决定 Client 资源解析（非产品缺陷）**：隔离 `dsh web` 若以 worktree 为 cwd 启动，DSH 的 Client 资源解析会
   服务 worktree 的 `client.js`（1.3.0 身份）而非已安装包，导致双端身份证据失真。harness 已固定 `cwd=/tmp/dsh-v15/m3/host-cwd`；
   preflight 现在断言“服务给页面的 Client bundle 身份 == 已安装 release 的 client buildCommit”。
4. **D4 release identity 仓库 URL 解析缺陷（真实产品缺陷，已修复 91237c6）**：旧 `isReleaseRepository` 只接受带 `.git` 的 clone URL 等形式，
   而 release.json 写的是 `https://github.com/heswy/dsh-game-market`（无 `.git`）→ Host `readOwnRelease` 解析失败 → `expectedClient.buildCommit=null`，
   真实 Client 身份永远匹配不上（HMR 表现为 stale-runtime(client-old) 无限停留；非 HMR 表现为 verification-failed(response-lost)）。
   **残余影响**：B2 包内的 Host 代码仍是 pre-fix，因此 A→B hop 的 client 核验必然失败；需要从修复树重建 B3 才能完成 A→B 的 UI 链（见 §3 说明）。
5. **D5 harness/网络环境（非产品）**：本机 DNS github.com 被墙、7897 代理抖动；最终 harness 采用 pinned-tunnel 方案（fixture MITM 的 CONNECT 直连 140.82.112.3/185.199.108.133），
   并移除 host env 中的 GIT_CONFIG_* 注入（native manager 某路径会保留 COUNT 丢掉 KEY 致 git 解析失败）。
6. 上述断言 + 安装瞬时网络失败的有界重试（GitHub 连通性检查 5s 超时，M0 同类偶发；仅对 `operation-error/timeout` 形态重试并逐次记录）
   构成了 V1 长链前的 preflight 门禁（V0-7）。

## 3. V1 场景矩阵（not-run，等待 H2 冻结 + probe releases 推送）

Runner 将全部在隔离 DSH_HOME + 固定 URL 传输夹具下执行；更新动作由**真实 Client UI**（CDP 真实点击/输入，非直接 API）发起，
Host 侧用 probe 操作者与页面 same-origin 路由做旁证；原始 JSON 脱敏后进 `docs/verification/v1.5/raw/m3/`。

| # | 要求 | 断言要点 | 状态 |
|---|---|---|---|
| V1-1 | HMR A→B→R_final 连续两次精确 commit 更新 | 一次性安装 `R_A`（1.2.1）→ UI 更新到 `R_B`（1.2.2）→ UI 更新到 `R_final`（1.3.0）；每次 `applied→activating→（旧 Client 刷新）→updated`；Host `loadedVersion`+`buildCommit`、Client 自身上报 `buildVersion`+`buildCommit`、`/health` 健康三者匹配目标 | not-run |
| V1-2 | 双端身份不得用 Host 返回值冒充 Client / 不得 applied 当成功 | 旧 Client 期间 `stale-runtime(client-old)`；刷新后 Client 加载新 client.js 并上报新身份才 `updated`；UI 文案在 updated 前不出现"已更新" | not-run |
| V1-3 | 响应丢失/刷新恢复 | 安装中刷新页面/丢 RPC：Host 持久记录恢复观察，无假成功，终态正确（`updated` 或明确 `verification-failed(response-lost)` 且可恢复） | not-run |
| V1-4 | HMR dispose 存活 | 被更新 bundle row 被 disposal/re-apply 期间操作持有者（Host 服务/探针 fiber）存活，更新操作持续到终态 | not-run |
| V1-5 | 非 HMR pending-restart（`R_A`→`R_B`） | 显式禁用 `hmr` row 的隔离 profile：`R_A`→`R_B` 更新 → `pending-restart(no-hmr)`；证明磁盘已新、运行仍旧（`/health.loadedVersion` 旧值；hostEpoch 变化≠进程重启证据）；重启 Host → `activating→updated` 双端 1.2.2；存档/配置保留 | not-run |
| V1-6 | 混合态旧 Client + 新 Host | 保留旧页面 client 构建（旧 buildCommit 上报）→ Host 新；必须 `stale-runtime(client-old)`，不得报成功；刷新后 `updated` | not-run |
| V1-7 | 数据保留 | `storages/dsh-game-market`、saves、配置（preferences）在 A→B→R_final 与重启前后字节/语义一致 | not-run |

## 4. V2 场景矩阵（not-run，等待 H2 冻结 + probe releases 推送）

| # | 要求 | 断言要点 | 状态 |
|---|---|---|---|
| V2-1 | 多窗口并发更新 + 幂等 | 两个真实页面同时点更新 → 同一 `operationId`、无重复 installBundle、两端收敛同一终态；单窗口快速重复点击幂等 | not-run |
| V2-2 | 活跃游戏存档失败阻断包变更 | 真实游戏实例运行中；注入保存失败（如 saves 目录只读/保存错误）→ 更新在包变更**之前**中止（无 installBundle、旧版本仍运行）、UI 可操作提示；恢复保存 → 重试成功；跨窗口两个实例都需暂停+确认；未响应实例超时阻断 | not-run |
| V2-3 | already-installed / 同 commit | 已在目标 → `already-at-target`（非 failed、不重装）；记录 spec 形态重放 / URL 形态同目标 → 核对实际版本/commit 后映射正确 | not-run |
| V2-4 | ambiguous-install | 复现 URL 形态重复安装的 `ambiguous-install`（pnpm exit 0、依赖串/live 版本不变）→ adapter 不得报成功：同目标 `already-at-target`，否则 `verification-failed` + 实际版本证据 | not-run |
| V2-5 | cancel / too-late | installing 期 cancel → `cancelled`（安装不继续）；`applying` 期 cancel → `too-late`，安装继续并观察到正确终态，绝不显示"已取消/已回滚" | not-run |
| V2-6 | 能力 unknown | 强制 `hmr` 采样超时/服务缺失 → `canBeginUpdate=false`、原因可读、市场/游戏不受影响 | not-run |
| V2-7 | dev row 遮蔽 | 隔离 profile 注入同 id dev row → inspect 报告 `stale-runtime(dev-row-shadows-package)`、更新禁用、给原生插件管理指引、无静默迁移（无 installBundle） | not-run |
| V2-8 | 恶意索引/非法 target 拒绝且有恢复路径 | 夹具 index 覆盖：错误 repo/插件名、branch/tag/短 SHA/本地路径/file:/裸包名、stable 通道 prerelease、超 256 KiB、5s 超时、重定向降级、同版本不同 commit、version/commit 与包不符 → 明确错误码、不发起更新、保留上次成功 target/离线态、游戏不受影响；直接伪造 targetId/任意 spec 调 begin → `GM-4090` 拒绝 | not-run |
| V2-9 | 失败恢复路径 | `failed`/`verification-failed` 后 UI 恢复入口可操作；修复后重新 begin 成功；持久记录反映恢复、无卡死锁 | not-run |
| V2-10 | 清理/泄漏自证 | 每个 runner 内：端口拒绝、PID 死亡、隔离 home 删除、无残留 DSH/Chrome 子进程 | not-run（V0 各 runner 已自证；V1/V2 runner 内建） |

## 5. 未验证 / 限制（本阶段如实）

1. **真实 Desktop / Electron 主进程**：全部证据来自隔离 `dsh web` + headless Chrome；真实 App 内 Electron 主进程的发现网络栈、
   原生窗口 UI、真实用户 profile 未验证（不碰 `~/.dsh`）。
2. **生产官方索引**：从未抓取/写入生产索引；夹具 body 是验证数据，不代表线上内容，也不证明线上索引当前格式正确。
3. **H2 与全部 V1/V2 场景**：`not-run`（H2 实现进行中；probe releases 未推送）；本文件不预写任何通过结论。
   发现矩阵（§1.4）只覆盖 discovery，不含 adapter/observation/协调/UI。
4. **V2-6 能力 unknown 的构造**：需要在隔离 profile 上人为制造采样超时/服务缺失并证明真实 fail-closed；若实现未提供可注入 seam，
   将以「只读操作路径 + 最小环境改动」尝试并在证据里如实标注。
5. **多窗口**：同一隔离 Host 上开两个真实页面（同一 web profile）；跨进程 profile 锁用两个隔离 Host 指向同一 profile 目录的形式验证，
   若宿主不支持共享 profile 目录则标 `not-run` 并说明。
6. **pnpm 出网**：隔离 Host 注入本机 `127.0.0.1:7897` 代理 env（仅进程内，不改用户/App 配置）；真实用户网络条件未覆盖。
7. **夹具方法的 Node 依赖**：`NODE_USE_ENV_PROXY` 为 Node 24 行为；Electron 主进程是否同样适用未验证。
8. **长时稳定性**：未做 soak；每次运行都是短时验证。
9. **安装瞬时网络失败**：原生 `installBundle` 的 GitHub 连通性预检（5s）偶发超时（M0 同类）；V1/V2 runner 对
   `operation-error/timeout` 形态做有界重试并把每次原始结果记录进证据，非该形态的管理失败不重试。
10. **probe-release 中间态发布身份**：A2/B2/R_final4 的 P_x 版本提交可能带上一版 release.json（工具两阶段流程预期），
    verifier 只强制“无自引用”，并在证据中记录 stale 版本。

## 6. 证据索引

已提交（链接；`3b73da0` 检查点）：

| 证据 | 内容 |
|---|---|
| [M3-V0-harness-2026-10-20T11-48-47-688Z.json](raw/m3/M3-V0-harness-2026-10-20T11-48-47-688Z.json) | 运行时身份/解包一致性、probe 操作者、真实页面、health/installed 路由、清理自证 |
| [screenshots/M3-V0-harness-v0-harness-mvgme18o-808825.png](raw/m3/screenshots/M3-V0-harness-v0-harness-mvgme18o-808825.png) | 真实 DSH 页面截图 |
| [M3-V0-fixture-2026-10-20T11-51-00-675Z.json](raw/m3/M3-V0-fixture-2026-10-20T11-51-00-675Z.json) | 传输夹具初始证据（body 为占位形状；方法/结论有效） |
| [M3-V0-exact-install-2026-10-20T11-51-54-704Z.json](raw/m3/M3-V0-exact-install-2026-10-20T11-51-54-704Z.json) | 精确 commit 安装原始 Remote Result、profile/磁盘/health/listBundles 一致性、存档保留、清理自证 |

本轮新增（**未提交**，Lead 检查点后转链接）：

| 证据 | 内容 |
|---|---|
| docs/verification/v1.5/raw/m3/M3-V0-fixture-2026-10-20T12-13-15-362Z.json | 夹具复跑：body 对齐 H1 格式 1；透传/隧道/场景/负向对照/Host 进程内 fetch/生产索引未写/清理自证 |
| docs/verification/v1.5/raw/m3/M3-V0-h1-tests-committed-ref-6d94779eae88-2026-10-20T12-06-26-690Z.json | H1 提交树独立复跑：13/13 + 245/245、exit 0、逐测试结果、被测试树 ref |
| docs/verification/v1.5/raw/m3/M3-V0-discovery-matrix-2026-10-20T12-10-36-937Z.json | 发现策略矩阵 160/160：逐用例 checks、fixture 审计、per-case cleanup |

本轮新增（**未提交**，Lead 检查点后转链接）：

| 证据 | 内容 |
|---|---|
| docs/verification/v1.5/raw/m3/M3-implementation-tests-committed-ref-7e952f277c24-2026-10-20T12-24-04-731Z.json | 实现提交树独立复跑（host/shared/client/release 四套件，逐测试结果） |
| docs/verification/v1.5/raw/m3/M3-probe-release-acceptance-2026-10-20T14-45-57-669Z.json | A2/B2/R_final4 只读验收（精确 SHA fetch、身份、安装完整性、祖先、ref/tag、无生产索引） |
| docs/verification/v1.5/raw/m3/M3-v1-preflight-2026-10-20T15-00-50-869Z.json | preflight 30/30：安装 A2 身份、非 dev-row、banner、fixed-client 刷新（enabled→真实 POST→单次请求→60s 节流） |
| docs/verification/v1.5/raw/m3/M3-v1-preflight-2026-10-20T14-55-01-970Z.json | preflight 失败记录（served-client 解析器错误；harness bug，非产品缺陷；已修） |

V1/V2：运行后按 `M3-v1-*.json` / `M3-v2-*.json` 命名追加（含 exit code 与逐项 checks）。历史上已存档但不作本轮结论：
`M3-v1-preflight-2026-10-20T14-46-05-688Z.json`（安装瞬时网络失败）、`M3-v1-preflight-2026-10-20T14-58-53-720Z.json`（UI 刷新按钮轮询时序）。

## 7. 复跑命令

```bash
cd dsh-game-market-worktrees/v1.5-platform-update
node scripts/verification/v1.5/m3/run-v0-harness.mjs
node scripts/verification/v1.5/m3/run-v0-fixture.mjs
node scripts/verification/v1.5/m3/install-exact-commit.mjs \
  --commit f422e8d04b3b3de3f920a794317c0d28ee1246a2 --version 1.2.0
node scripts/verification/v1.5/m3/run-h1-tests-evidence.mjs --ref 7e952f277c24e4cf0e8ef72d3f522e871bd9c858 --write-evidence
node scripts/verification/v1.5/m3/run-v0-discovery-matrix.mjs

# 最终目标 A2/B2/R_final4（只读验收 → preflight → V1 → V2）
A=344ce99c57f03645cbb246a75a45845fc1e9d789
B=ef8197dc3a6979227037e7739a2aac9e3ea4a709
FINAL=bf6c37f23f57c246c1f491b6e5aa9272c178c8e9
node scripts/verification/v1.5/m3/verify-probe-releases.mjs --a "$A" --b "$B" --final "$FINAL" \
  --pa 1f6978482a375736bfd419c168b63aec4531c255 --pb 0591b9075b3d74ce2cadb7eae736c19166af687f \
  --pfinal cdf83a63a6e15de7c4987137b4981001885e0fd2 --write-evidence
node scripts/verification/v1.5/m3/run-v1-preflight.mjs --a "$A" --b "$B" --final "$FINAL"
node scripts/verification/v1.5/m3/run-v1-hmr-chain.mjs --a "$A" --b "$B" --final "$FINAL"
node scripts/verification/v1.5/m3/run-v1-nonhmr-restart.mjs --a "$A" --b "$B" --final "$FINAL"
node scripts/verification/v1.5/m3/run-v2-windows-idempotency.mjs --a "$A" --b "$B" --final "$FINAL"
node scripts/verification/v1.5/m3/run-v2-save-coordination.mjs --a "$A" --b "$B" --final "$FINAL"
node scripts/verification/v1.5/m3/run-v2-edges-index.mjs --a "$A" --b "$B" --final "$FINAL"
```

约定：所有 runner **required 断言失败即非零退出**；证据经 `sanitiseM3` 脱敏（**保留 40 位 commit SHA**、semver、`/tmp` 路径；
遮蔽 token/Bearer/32 位会话凭证/`/Users/<user>`）；运行结束前做端口拒绝 + PID 死亡 + 临时 home/配置删除自证。
