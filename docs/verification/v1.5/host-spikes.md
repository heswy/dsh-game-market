# V1.5 M0 · 宿主探针证据索引（host-spikes）

> 本文件是 M0 阶段的**主证据索引**：逐探针给出「必须证明什么 / 实际结果 / 证据文件 / 是否通过 / 未验证项」。
> 细节在各自的分报告里；本文件只做索引与结论汇总，不重复原始日志。
>
> - 分支：`feat/v1.5-m0`（worktree `/Users/<user>/…/v1.5-m0`）
> - **探针证据提交**：`50f27ad`（`test(v1.5): add M0 host capability probes and freeze contracts`）
> - 宿主：本机 `/Applications/DeepSeek Harness.app` —— `@deepseek-ai/dsh-desktop` / `@deepseek-ai/dsh-desktop-runtime` / `@deepseek-ai/dsh-plugin-manager` 均 **0.2.1-rc.2**
> - 日期：2026-10-19
> - 结论：**S-U1 / S-U2 / S-U3 / S-Q1 / S-Q2 / S-A1 / S-B1 全部通过**（逐项 required 断言 0 失败）；未验证项在 §6 逐条列出，**不得**当作已支持。

## 0. 隔离与合规

| 项 | 做法 |
|---|---|
| 运行时代码来源 | 只读解包 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` → `/tmp/dsh-v15/asar`（`scripts/verification/v1.5/lib/harness.mjs`） |
| 宿主启动 | `node <dsh bin.js> web --no-open --port <p> --host 127.0.0.1`，`DSH_HOME=/tmp/dsh-v15/home-*` |
| 未触碰 | `~/.dsh/profiles/desktop`、`~/.dsh` 下任何文件、App 安装目录内任何文件、生产索引、tag |
| 未执行 | 未 `git commit`（由 Lead 统一提交）、未合并 main、未打 tag、未发布、未改用户日常 profile |
| 浏览器 | 本机 Google Chrome（headless=new + CDP）；S-A1 记录为 155.0.8059.85 |
| 脱敏 | 证据内不写 profile 凭据/配置原文、问答原文、签名 URL query；token/cookie 已脱敏；绝对用户路径已归一为 `/Users/<user>`。**刻意保留公开发布的 40 位 commit SHA**（契约需要逐字引用安装目标） |

## 1. 探针逐项结果

| 探针 | 必须证明什么 | 实际结果（实测） | 通过 | 证据 |
|---|---|---|---|---|
| **S-U1** 非 HMR 更新 | 显式无 `hmr` 的隔离 profile 中，旧 Bundle → 新精确 Git commit 是否允许覆盖、返回值、旧 Host 是否继续运行、重启后版本与存档 | 覆盖安装返回 `application:"restart-required"` + `restartReason:"no-hmr"`、`changed:true`、pnpm exit 0；**未重启时旧 Host 继续跑旧代码**（disk 1.2.0 / running 1.1.0，hostEpoch `he_7275…` 不变）；重启后 running 1.2.0、新 hostEpoch `he_abb7…`；存储与存档 fixture 跨覆盖安装与两次重启保留。**注意：该 profile 是显式禁用 `hmr` 的隔离构造，不是真实 Desktop 默认路径** | ✅ 42 checks / required 30 | [plugin-update.md](plugin-update.md)、[raw/plugin-update/s-u1-nohmr/](raw/plugin-update/s-u1-nohmr/) |
| **S-U2** HMR 更新 | HMR profile 中重复安装、卸载/重装、销毁时序；操作是否由独立于被更新插件的宿主服务持有 | HMR 下用 **git HTTPS URL + 精确 40 位 commit** 覆盖更新可行且**可重复**（A→B、B→C 两次均 `application:"applied"`，新版本**无需重启**由 `/health` 报出）；被更新 bundle row 每次 dispose 并换新 fiber（337→341）；`removeBundle` 未报 `stop-profile`/`bundle-in-use`，可重装；**独立操作者 fiber uid 48 全程存活**（`ownerEntryId="include:plugin-manager"`）；记录串完全相同的重复安装 → `failed`/`already-installed`/`changed:false`/不跑 pnpm；URL 形态同目标重复点击 → `failed`/`ambiguous-install`（pnpm exit 0、依赖串与 live 版本不变）；cancel 三态 `not-running`/`cancelled`/`too-late`（`too-late` 不回滚、安装继续完成） | ✅ 120 checks / required 58 | [plugin-update.md](plugin-update.md)、[raw/plugin-update/s-u2-hmr/](raw/plugin-update/s-u2-hmr/) |
| **S-U3** 宿主状态 | `application`/`restartReason`/`requestId`/结果丢失/声明版本 vs loadedVersion/HMR 能力可靠来源 | `application` 语义：非 HMR `restart-required`+`no-hmr`；HMR `applied`（无 `restartReason`）；管理类失败 `failed`+`error.code`；取消 `cancelled`；`changed` 由 profile 文件是否变化决定。`requestId` **不回显在结果里**，由 `plugin-manager/install-state` 事件携带，`waitForInstall`/`cancelInstall` 以它作键。`waitForInstall`：未知 id → `null`；安装结算后再查同一 id → `null`（**结果不保留，null 不代表成功/取消/没装过**）；活动期内并发查询返回同一结果。Profile 依赖声明是 **git spec 串**（无 semver），`applied` 后磁盘版本 / `listBundles().version` / `/health.version` 一致。**HMR 能力唯一权威来源 = Loader 树稳定后轮询 `manager.ownerContext.get('hmr')`**（实测 t=0 `false`（`Service.init` 竞态，row `fiberState=1`）→ t≈0.5–2s `true`（`fiberState=2`））；不用 UA/版本字符串 | ✅ 见两列 | [plugin-update.md](plugin-update.md)、[raw/host-capability/](raw/host-capability/) |
| **S-U2b** dev row 迁移 | 用户当前是 dev row（本地路径）时，安装正式 Bundle 会发生什么 | 包**装上了但没接管**：`installBundle` 成功（`applied`、依赖串与磁盘 1.1.0），但同 id 的 dev row 覆盖 bundle 行，live 仍是 checkout（`devMode:true`、1.2.0、fiber 183 不变），无重复 live row、无报错。**结论：迁移必须先移除 dev row 或走 DSH 原生插件页切换安装来源** | ✅ 21 checks / required 9 | [raw/plugin-update/s-u2b-devmigration/](raw/plugin-update/s-u2b-devmigration/) |
| **S-Q1** open 问答 | 绑定 Session 的游戏面板内读取原生 pending question、提交 blocking/open 回答，并在原生会话观察同一调用结算 | 在 `selectPanel` 选中游戏面板、原生 composer 已卸载（`composerEditorCount=0`）时，第三方 Client 仍能从 `ctx.uiSession.sessionStatus` 取得**活 `PendingQuestion`** 并 `pending.answer(batch)` 结算成功（`{ok:true, elapsedMs:0}`）；原生 Session 记录同一 `callId` 的 `tool/call` → `tool/result`（含答案），同 Turn 内 2 个 step 后正常结束。**判定：de facto 可用，但不是稳定公开接口** —— 私有类实例、blocking 请求**无 callId**、**不进 `userQuestions` projection**、`dismiss()` 对 unnamed blocking 卡是 **cancel（`ASK_CANCELLED`）** | ✅ 26/26 required | [questions.md](questions.md)、[raw/questions/q1-open-in-game-panel.json](raw/questions/q1-open-in-game-panel.json)、截图 `q1-conversation-question.png` / `q1-game-panel.png` |
| **S-Q2** 问答生命周期 | timed 继续、重连、切 Session、多窗口竞争、原生 UI 并存、delegation/关闭语义 | timed：open 带 `wait.callId` + 倒计时；不答 → `tool/result {pending:true, callId}`；projection `open → continued → settled`；`ctx.remote.userQuestions.answer` 首窗 `{ok:true,value:true}`、**第二窗口/重复提交 `value:false`**、错误 shape 被 RemoteError 拒绝；steer 会开**新 Turn**（`turnStarts=2`）。多题批次（多选 + 自由文本）逐题精确落盘。**关闭语义：对 unnamed blocking 卡 `dismiss()` = 取消请求**（Session 记 `tool/result isError errorCode=ASK_CANCELLED`）。切 Session 后 A 的问题仍可定位结算。原生问答卡与第三方消费者可同时在场，第三方结算后原生卡不再发布。浏览器重连后 open 问题**重新投递**并可结算。`attachWait` 持有 claim 时宿主 deadline 被暂停、释放后立即结算；无 claim 时按 deadline 返回 `{pending:true}` | ✅ 53/53 + 10/10 required | [questions.md](questions.md)、[raw/questions/](raw/questions/) |
| **S-A1** 资源加载 | 现有 `sandbox="allow-scripts"`（opaque origin）下加载独立 JS/CSS/图片/ESM/fetch JSON/音频；CORS/CSP 与一次性 entry 凭证的关系 | 真实浏览器中 classic JS、ESM（静态 + 动态 `import()`）、CSS（计算样式生效）、PNG（解码 + canvas 读像素）、`fetch` 关卡 JSON（重复 GET 均 200）、WAV（解码；手势前 `NotAllowedError`、真实点击后播放成功）全部加载成功；entry 一次性 launch 首 GET 消费、重放 **410**、去掉 launch 用资源凭证 **200**；TTL/renew/release → 403；穿越/绝对路径/编码分隔符/目录 listing 26 条全部拒绝。**关键 M1 硬约束：资源路由不能复用 DSH `/api`**（`assertFetchRoute` 只接受 `/api/*`，且 `/api` 前缀围栏拒绝 opaque-origin：`Origin:null` → 403、no-cors `<img>` 因 `sec-fetch-site: cross-site` → 403）→ 需**独立 loopback 资源 origin**（已端到端验证）。**CSP 是必需的外发边界**：无 CSP 时 CORS 挡不住 no-cors 外发（第三方 origin 实测收到数据） | ✅ 82/82 required | [resources.md](resources.md)、[raw/resources/](raw/resources/)、`screenshots/` 10 张 |
| **CR-P1** iframe 自导航 | `sandbox="allow-scripts"` 的游戏文档能否被自己的 CSP 阻止导航到外部 origin | **不能**（负对照 C4 实测外泄）。阻断必须来自**嵌入文档的 `frame-src`**：host 页无 CSP 时外泄（C1，缺口复现）；host 页 `frame-src <resOrigin>` 阻断（C2，Chrome 报 CSP 违规）；**平台自服务的同源 wrapper**（wrapper 自身 CSP 含 `frame-src <resOrigin>`、顶层页面**不发 CSP**）阻断（C3），而**同一 wrapper 去掉该 CSP 即外泄**（C3c 对照）→ 阻断可归因给 wrapper 自身策略，不依赖 host 页面，已在 Chromium 155 验证。五个用例都带同源 boot beacon 上报**实际导航目标**，判定要求「游戏运行 + 目标确为外部 sink + 泄漏符合预期」三者同时成立 | ✅ 5/5 as-expected | [raw/resources/cr-p1-selfnav.json](raw/resources/cr-p1-selfnav.json)、`probe-selfnav.mjs`、[resources.md §5.4](resources.md) |
| **S-B1** 正式标志 | 当前 Client 模块加载器能否解析 `FishLogo`、正式 SVG 许可/来源、明暗表现 | 第三方 `dsh.client` 包在真实页面 `require('@deepseek-ai/dsh-client-ui-primitives')` **成功**（288 exports，含 `FishLogo`/`FISH_LOGO_PATH`/`FISH_LOGO_VIEWBOX`；未知 specifier 仍抛错 = 负控制通过）。来源：随 `dsh-web-frontend`（MIT）构建产物分发，轮廓 3448 字符、`viewBox 0 0 23.16 17.04`、`fill="currentColor"`；运行时 `d` 与 ASAR 逐字节一致。明暗：浅色 `rgb(15,17,21)` / 深色 `rgb(249,250,251)`，**同一路径、同一 3625 墨迹像素**（形状不随主题变形）。**M1 待办**：现 `bundle-lib.mjs` 拒绝该 bare import，需扩受审最小 allowlist | ✅ 23/23 | [brand.md](brand.md)、[raw/brand/](raw/brand/) |

## 2. 原始能力普查（Lead 独立复现，非队友代跑）

| 项 | 结果 | 证据 |
|---|---|---|
| 默认 profile 的 `hmr` 是否存在 | **存在**，但存在**初始化竞态**：`apply()` 时读 `false`（row `fiberState=1`）→ t≈2s `true`（`state=2`）。`--expose-internals` 与不带该 flag 结果一致 | [raw/host-capability/hmr-census-plain.json](raw/host-capability/hmr-census-plain.json)、[hmr-census-expose-internals.json](raw/host-capability/hmr-census-expose-internals.json) |
| 真实 Desktop 是否 HMR | **是**。`ps` 实测 Electron 主进程带 `--expose-internals` 运行 `dsh-desktop-host/lib/index.js`，且**监听 GUI 端口的正是该 PID**（profile 在进程内运行）；bundles 含 `dsh-base`，用户 patch 未禁用 `hmr` 行 | 见 [support-matrix.md](support-matrix.md) §3 |
| `pluginManager` 调用面 | `installBundle`/`waitForInstall`/`cancelInstall`/`removeBundle`/`listBundles`/`setBundleEnabled`/`inspect` 等（`managerMethods` 落盘） | `raw/plugin-update/s-u2-hmr/boot1/boot.json` |

> **本阶段最重要的更正**：开发指南 §3/§5.3 把「非 HMR Desktop」当作首版必须实证的一键更新路径。实测**相反**：真实 DSH Desktop 是 **HMR 能力开启**，主路径是 URL+commit 的**在线替换**（`applied`，无需重启）；`restart-required` 只在显式禁用 `hmr` 的隔离 profile 上复现。指南与 PRD 措辞已由 Lead 更新（PRD D-046/D-047/D-049）。

## 3. 复现命令与退出码

```bash
cd "/Users/<user>/…/v1.5-m0"

# 基线（全量）：build + check + test
npm run verify            # exit 0 —— 840 tests pass / 0 fail，CHECK OK (38)

# S-U1 / S-U2 / S-U2b（真实宿主 + 真实 git commit 安装）
node scripts/verification/v1.5/plugin-update/run-su2-hmr.mjs          # exit 0（120 checks / required 58）
node scripts/verification/v1.5/plugin-update/run-su1-nohmr.mjs        # exit 0（42 checks / required 30）
node scripts/verification/v1.5/plugin-update/run-su2b-devmigration.mjs # exit 0（21 checks / required 9）

# S-Q1 / S-Q2 / S-Q2b（真实 Agent 轮次 + 原生问答面 + 真实浏览器）
node scripts/verification/v1.5/questions/run-all.mjs                  # exit 0（26/26 + 53/53 + 10/10）

# S-A1（真实浏览器 iframe + 隔离宿主）
node scripts/verification/v1.5/assets/gen-fixtures.mjs --check        # exit 0（10 文件 size/sha256）
node scripts/verification/v1.5/assets/probe-resources.mjs             # exit 0（82/82 required）

# CR-P1（复核修正轮）：iframe 自导航边界 + 缓解验证
node scripts/verification/v1.5/assets/probe-selfnav.mjs               # exit 0（5/5 as-expected）

# S-B1（隔离宿主 + headless Chrome + ASAR 字节比对）
node scripts/verification/v1.5/brand/b1-fishlogo.mjs                  # exit 0（23/23）
node scripts/verification/v1.5/brand/zip-reader-eval.mjs              # exit 0（12/12；需先取 yauzl 到临时目录）
```

- 每个探针用统一断言器：**任一 required 失败即 `exit 1`**；S-A1 与 S-B1 保留了「故意失败」样本运行以证明非零退出（`raw/resources/probe-stdout-failed-sample.log`、`raw/brand/b1-selftest-exit.txt`）。
- 网络：GitHub 需代理 `http://127.0.0.1:7897`（pnpm 经 `HTTPS_PROXY` 等注入，**未修改用户 git/npm 配置**）；npm registry 可直连。

### 3.1 如何机器核对每份 summary 的判定

各 summary 的判定字段位置不同，复核时按下表读取即可（Lead 已逐个核对，全部 `required` 0 失败）：

| 探针 | summary | 判定字段 |
|---|---|---|
| S-U1 | `raw/plugin-update/s-u1-nohmr/summary.json` | `passed:true`、`requiredChecks:30`、`requiredPassed:30`、`failedRequired:[]` |
| S-U2 | `raw/plugin-update/s-u2-hmr/summary.json` | `passed:true`、`requiredChecks:58`、`requiredPassed:58`、`failedRequired:[]` |
| S-U2b | `raw/plugin-update/s-u2b-devmigration/summary.json` | `passed:true`、`requiredChecks:9`、`requiredPassed:9`、`failedRequired:[]` |
| S-Q1 | `raw/questions/q1-open-in-game-panel.json` | `passed:true`、`checks[].required` 24 项全 `ok` |
| S-Q2 | `raw/questions/q2-lifecycle.json` | `passed:true`、`checks[].required` 44 项全 `ok` |
| S-Q2b | `raw/questions/q2b-attach-wait.json` | `passed:true`、`checks[].required` 9 项全 `ok` |
| S-A1 | `raw/resources/summary.json` | 判定在**嵌套的 `report`** 下：`report.passed:true`、`report.checks` 94 项中 `required` 82 项全 `ok`、`report.failed:[]` |
| CR-P1 | `raw/resources/cr-p1-selfnav.json` | `passed:true`、`unexpected:[]`、`cases[].verdict` 全 `as-expected`（5/5）、`conclusion.allCasesAimedAtSink:true`、`wrapperCasesHaveNoTopLevelCsp:true` |
| S-B1 | `raw/brand/b1-report.json` | `passed:true`、`checks[].required` 23 项全 `ok` |

一行核对命令（在 `docs/verification/v1.5/` 下执行）：

```bash
node -e '
const fs=require("fs");
const pick=(f,p)=>p(JSON.parse(fs.readFileSync(f,"utf8")));
const rows=[["S-U1","raw/plugin-update/s-u1-nohmr/summary.json",s=>s.failedRequired],
 ["S-U2","raw/plugin-update/s-u2-hmr/summary.json",s=>s.failedRequired],
 ["S-U2b","raw/plugin-update/s-u2b-devmigration/summary.json",s=>s.failedRequired],
 ["S-Q1","raw/questions/q1-open-in-game-panel.json",s=>s.checks.filter(c=>c.required&&!c.ok)],
 ["S-Q2","raw/questions/q2-lifecycle.json",s=>s.checks.filter(c=>c.required&&!c.ok)],
 ["S-Q2b","raw/questions/q2b-attach-wait.json",s=>s.checks.filter(c=>c.required&&!c.ok)],
 ["S-A1","raw/resources/summary.json",s=>s.report.checks.filter(c=>c.required&&!c.ok)],
 ["CR-P1","raw/resources/cr-p1-selfnav.json",s=>s.cases.filter(c=>c.verdict!=="as-expected")],
 ["S-B1","raw/brand/b1-report.json",s=>s.checks.filter(c=>c.required&&!c.ok)]];
for(const [id,f,g] of rows){const bad=pick(f,g);console.log(id, bad.length===0?"OK":"FAIL "+JSON.stringify(bad));}
'
```

## 4. M0 冻结产出

| 产出 | 位置 | 状态 |
|---|---|---|
| 实现级契约 | [docs/V1.5-CONTRACTS.md](../../V1.5-CONTRACTS.md) | 1429 行；§13.2 无待裁决设计问题 |
| ZIP 依赖裁决 | 同上 §2（**Decision V1.5-01**） | 选定 `yauzl@3.4.0` + `pend@1.2.0`（MIT、精确 pin、唯一引入点 `packages/host/src/zip.js`）；维持禁止自研完整解压器 |
| 支持矩阵 | [support-matrix.md](support-matrix.md) | 能力面（HMR / 更新语义 / 资源 / 品牌）+ 安装 spec 形态 + 未验证项 |
| PRD 决策 | `PRD｜DSH Game Market.md` §12.1 | 新增 **D-039～D-050**；§12.2 新增 **S-26～S-32**；§7.6 V1.5 范围更新 |
| 上游 seam 需求 | 契约 §13.3 | 三项：`/api` 之外的公开 route seam、宿主受限解压能力、Session 问答领域 face（**均非 V1.5 阻塞**，独立提出/评审） |

### 4.1 ZIP 依赖决策（摘要）

`yauzl@3.4.0`（MIT）+ 唯一传递依赖 `pend@1.2.0`（MIT），精确版本 + integrity pin，`import` 只允许出现在 `packages/host/src/zip.js`。
理由：宿主自带的 `fflate@0.8.2` reader **不暴露 CRC 字段且对篡改过的 Stored 条目照常返回数据不报错**（实测），不满足 CRC 实测要求，且它属宿主运行时闭包（违反"不依赖 DSH 私有 `node_modules`"）；自研容器解析器被指南与 D-032 明确排除。
**代价（已接受并记录）**：仓库首次需要安装运行时依赖，`npm run verify` 不再能在无 `node_modules` 的全新 checkout 上直接跑 —— 见 PRD D-041 与 `PROJECT_MEMORY` §3 修订。
**否决退路**（契约 §2.6）：推迟 `asset-zip-v2`，或向 DSH 上游要受限解压 seam；**不得**自研。

### 4.2 更新路径结论（摘要）

| 场景 | 结果 |
|---|---|
| 真实 Desktop（HMR 开）+ git HTTPS URL + 精确 40 位 commit | `application:"applied"`，**无需重启**在线替换；连续两次更新均成功 |
| 同上，spec 与 profile 记录串**逐字相同** | `failed` + `error.code:"already-installed"`，`changed:false`，不跑 pnpm → **幂等保护** |
| 同上，URL 形态但目标已是当前版本 | `failed` + `error.code:"ambiguous-install"`，pnpm exit 0，依赖串与 live 版本不变 → adapter 需与 `already-installed` 一并映射为「已是目标」，但**不得无条件吞掉 `ambiguous-install`** |
| 显式非 HMR profile | `restart-required` + `restartReason:"no-hmr"`；未重启时旧 Host 继续跑旧代码，重启后生效 |
| 用户当前是 dev row | 能装上但**不接管**（同 id dev row 覆盖 bundle 行）→ 迁移必须先移除 dev row 或走原生插件页 |

**禁止**：裸包名 / 本地路径 spec（会被 `already-installed` 拦或语义不同）；用 spec 字符串判定「已是最新」（pnpm 会把 https spec 归一化记录为 `github:` 形态）；先卸载自己再靠自身完成安装。

### 4.3 问答结论（摘要）

- **open 原地回答可行（de facto）**，但**不是稳定公开接口**：私有 `PendingQuestion`、blocking 无 callId、不进 projection → 只能靠「唯一活对象 + 事件顺序」关联。M4 按「能力探测 + DSH 版本门（0.2.1-rc.2 已知可用，宿主升级必重跑探针）+ 能力缺失回退『回到会话处理』」实施。
- **硬裁决**：游戏视图内的「收起/关闭」**只能收起平台自绘 UI 状态，绝对不得调用 `pending.dismiss()`**（对 unnamed blocking 卡那是**取消请求**，Session 会记 `ASK_CANCELLED`）；只有 timed/continued（有 callId、`dismissal:"hide"`）允许 hide；blocking 卡在 V1.5 **不提供**拒绝/取消入口。M4 必须有「收起不会导致 `ASK_CANCELLED`」的断言/单测。这条**与指南 §6.3.4 冲突**，已在契约 §13.1 `D-T` 记录。

## 5. 建议的 M1 起点（不构成 M0 承诺）

1. `packages/shared`：包格式联合类型 + `dsh-package.json` 校验器 + 限额常量 + 新 `GM-*` 错误码（契约 §1/§3/§4/§8）。
2. `packages/host/src/zip.js`：按契约 §2 引入 `yauzl`（唯一引入点）+ 供应链断言 + `THIRD-PARTY-NOTICES.md`。
3. 两代 Registry 投影（契约 §5）与安装记录扩展（§6）。
4. **独立 loopback 资源 origin**（§7）——**不要**尝试复用 `/api`。
5. `bundle-lib.mjs` 扩受审 bare-import allowlist（primitives + `react-dom/client`）。

## 6. 未验证项（M0 结束时仍开放，不得写成已支持）

| 项 | 说明 |
|---|---|
| 真实 DeepSeek 模型发起的提问 | 隔离 profile 无模型凭据；S-Q 用**本地脚本模型**驱动真实 `dsh-agent-loop` + 原生 `ask_user_question` 工具 → 原生 waterfall/UI/log。**不是真实模型调用** |
| 真实 Game Market 面板内的问答 | S-Q 用**同形探针面板**（同一 slot/key/`selectPanel` 机制），非仓库真实 UI；属 M4 真机项 |
| headed Desktop / 真实 Electron 窗口 | 全部探针在隔离 `dsh web` + headless Chrome 中执行 |
| `plan-review` / `approval/request` | 只覆盖 `ask_user_question` 普通问答；敏感审批路径未验证 |
| domain teardown delegation | 需运行时卸载原生 `dsh-client-ui-user-questions` 触发，未做 |
| 客户端半在 bundle 替换时的销毁时序、RPC 响应丢失 | 需浏览器侧更新探针；v1.2.0 无更新 UI |
| 多窗口 / profile 更新锁；多窗口并发 renew/release | 未做 |
| 字体 `@font-face`、非 Chromium 引擎、WebSocket/beacon 等外发向量 | S-A1 未验证项，M1 补测 |
| 2000 文件路由注册开销（PRD S-11） | 未做（只验证 10 文件包加载正确性） |
| 直接启动用户 `desktop` profile 的探针 | 未直接启动（合规：不碰日常 profile） |
| 本地后备品牌资产 | 来源与许可已冻结，但首选路径可用 → 后备未启用、未验证 |
| 真实外部用户的干净 profile 安装 | 属 M5 / U01–U06 验收，不在 M0 |

## 7. 交付清单（本文件随以下内容一起提交）

```
docs/V1.5-CONTRACTS.md                      # M0 冻结契约
docs/verification/v1.5/host-spikes.md       # 本文件：M0 主证据索引
docs/verification/v1.5/support-matrix.md    # 支持矩阵
docs/verification/v1.5/plugin-update.md     # S-U1/U2/U3 + S-U2b
docs/verification/v1.5/questions.md         # S-Q1/Q2 + S-Q2b
docs/verification/v1.5/resources.md         # S-A1 + §5.4 CR-P1
docs/verification/v1.5/brand.md             # S-B1
docs/verification/v1.5/raw/**               # 脱敏原始 JSON / 截图 / 日志
scripts/verification/v1.5/**                # 探针与共享 harness
```

## 8. 复核修正轮（Codex 对固定 head `240c5d4` 的复核）

复核结论：方向接受（HMR 主路径、独立资源 origin、只收起自绘问答 UI、`yauzl` 依赖例外），**要求先修 3 项再合并**。逐项处理：

| # | 复核意见 | 处理 | 证据 / 落点 |
|---|---|---|---|
| 1 [P1] | 资源隔离契约遗漏 iframe **自导航**，不能保证「包外网络拒绝」；并修正「任何绝对 URL 都会被 CSP 阻断」的错误表述 | 新增 `CR-P1` 探针复现缺口并验证缓解（**平台自服务同源 wrapper 的 `frame-src`**，不依赖 host 页面策略）；契约新增 §7.5.1 与导航边界裁决，CSP 因果改为**按 origin 匹配**，validator 的绝对 URL 拒绝降级为创作期规则 | [raw/resources/cr-p1-selfnav.json](raw/resources/cr-p1-selfnav.json)、[resources.md §5.4](resources.md)、`docs/V1.5-CONTRACTS.md` §7.4/§7.5/§7.5.1、§13.1 `D-U` |
| 1b [P2] | **第二轮复核**：C3 的 wrapper 用例没有转发 `?to=`（游戏执行 `location.replace(null)`，从未尝试外部导航），且顶层页面当时也带 CSP，无法归因给 wrapper —— 属**假通过** | 修正探针：wrapper 转发目标；C3/C3c 顶层页面**一律不发 CSP**（`topLevelCsp:null` 落盘）；新增 **C3c 对照**（同 wrapper 去掉自身 CSP，必须泄漏）；新增 `attemptedTarget`/`aimedAtSink` 断言，判定要求「游戏运行 + 目标确为外部 sink + 泄漏符合预期」三者同时成立。结果：C1 泄漏、C2 阻断、**C3 阻断、C3c 泄漏**、C4 泄漏，5/5 符合预期 | [raw/resources/cr-p1-selfnav.json](raw/resources/cr-p1-selfnav.json)、[resources.md §5.4](resources.md)「修正记录」 |
| 2 [P2] | §9.5 与 §9.4 更新成功时机冲突；`updated` 不在 `UpdateObservation`；残留过期的「B→C 尚未验证」 | 统一为 `inspecting → installing → applied → activating → updated` 单状态机；`applied` 明确为中间态、核验前不得报成功；补 `verification-failed`/`stale-runtime`/`pending-restart` 等非成功分支；删除过期描述并改指实测证据 | `docs/V1.5-CONTRACTS.md` §9.1/§9.5.1、§13.1 `D-W`；[plugin-update.md](plugin-update.md)（A→B→C 已实测） |
| 3 [P2] | `probe-stdout-final.log` / `probe-stdout-failed-sample.log` 未入库，后者仍被 `.gitignore` 忽略 | 两条日志脱敏核对后纳入 Git；`.gitignore` 增加 V1.5 证据目录例外；`scripts/check.mjs` 新增断言：**证据文档引用的每个证据文件必须存在、未被忽略、已跟踪** | `.gitignore`、`scripts/check.mjs`（`V1.5 evidence referenced and tracked (57 files)`，CHECK 39 项） |
| 4 | 统一 `files[] ≤512` 与「ZIP 总条目含描述符 ≤512」；清理残留 TBD | 以**总条目**为准：ZIP 条目总数（含 `dsh-package.json`）≤512 → `files[]` ≤511；正文无主 TBD 清理完毕，剩余项改为带归属的 M1 落地前置 | `docs/V1.5-CONTRACTS.md` §3 规则 0、§1.4、§1.5、§13.1 `D-V` |
| 附加 | §7.5 CSP 的 `upgrade-insecure-requests` 对 loopback http 资源 origin 有破坏风险 | 删除，并加注「若要用必须先实测」；S-A1 通过的 CSP 本就不含该指令 | `docs/V1.5-CONTRACTS.md` §7.5 |

修正后复验：`npm run verify`（840/840、CHECK OK 39）、`node scripts/check.mjs`、CR-P1 探针（5/5）、台账核对命令（9/9 OK）。
