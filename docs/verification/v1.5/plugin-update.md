# V1.5 M0 · 宿主插件更新探针（S-U1 / S-U2 / S-U3）

- 日期：2026-10-19
- 目标宿主：本机 `/Applications/DeepSeek Harness.app`，DSH 包与 `@deepseek-ai/dsh-plugin-manager` 均为 **0.2.1-rc.2**
- 运行方式：从 `app.asar` 只读解出运行时，在 `/tmp/dsh-v15/home-*` 的**隔离 DSH_HOME** 中启动 `dsh web`；未读写 `~/.dsh`，未修改 App 内任何文件
- 操作主体：探针 Host 插件 [probe-plugin-host.js](../../../scripts/verification/v1.5/plugin-update/probe-plugin-host.js)（注入 profile 的独立 row，不属于 `dsh-game-market`），内部调用真实 `ctx.get('pluginManager')` 的 `installBundle` / `listBundles` / `removeBundle` / `waitForInstall` / `cancelInstall`，原始 Remote Result 落盘
- 安装源：`https://github.com/heswy/dsh-game-market.git` 的精确 commit
  - A = `c106ac101e064a72f408c58b2516aad5118f513f`（tag v1.1.0，package 1.1.0）
  - B = `f422e8d04b3b3de3f920a794317c0d28ee1246a2`（tag v1.2.0，package 1.2.0）
  - C = `611c0ed0083432fc7b471e1d1351b90bc15f81ff`（tag v1.0.0，package 1.0.0，仅用于验证「连续第二次更新」）
- 结论汇总（自动判定，required 全绿）：
  - S-U2 HMR：**120 checks，required 58 / passed 58**，failedRequired 0，failedOptional 0 → [summary.json](raw/plugin-update/s-u2-hmr/summary.json)
  - S-U1 非 HMR：**42 checks，required 30 / passed 30**，failedRequired 0，failedOptional 0 → [summary.json](raw/plugin-update/s-u1-nohmr/summary.json)
  - S-U2b dev row 迁移：**21 checks，required 9 / passed 9**，failedRequired 0，failedOptional 0 → [summary.json](raw/plugin-update/s-u2b-devmigration/summary.json)

## 1. 结论摘要（先读这段）

1. **真实 Desktop 默认是 HMR 能力开启的 profile**。`dsh-base` 的 `hmr` row 在存在 `profileContext` 时启用；探针实测默认 `web` profile（与 Desktop 同 bundles：`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`）在树稳定后 `manager.ownerContext.get('hmr')` 为 `true`。指南 §5.3 的「非 HMR Desktop」前提不成立于 0.2.1-rc.2 默认配置；非 HMR 路径只能在显式禁用 `hmr` row 的隔离 profile 上复现（S-U1，已标注）。
2. **HMR 下用「Git HTTPS URL + 精确 40 位 commit」的 spec 做覆盖更新可行且可重复**：A→B、B→C 两次连续更新都返回 `application:"applied"`，新版本**无需进程重启**即由 `/health` 报出（version 与磁盘一致），被更新 bundle 的 row 被 dispose 并以新 fiber 重启。
3. **`already-installed` 只在 spec 字符串与 profile 记录串完全相等时命中**（同版本重复点击的正向保护）；用 URL 形态对已装版本再装一次**不会**命中该门，而是 `failed` + `error.code:"ambiguous-install"`（pnpm exit 0、依赖串与 live 版本不变）。
4. **操作由独立于被更新 bundle 的宿主服务持有已被实测证明**：`manager.ownerEntryId = "include:plugin-manager"`，探针插件 fiber uid 全程不变（48）、heartbeat 连续，跨首次安装 / 两次在线更新 / `removeBundle` / 重装均存活。
5. **非 HMR 隔离 profile**：覆盖安装返回 `restart-required` + `restartReason:"no-hmr"`；重启前 `/health` 路由不存在（新代码未加载），**旧 Host 在磁盘已换新版本后仍继续运行旧代码**（同 hostEpoch `he_7275…`，running 1.1.0 / disk 1.2.0）；再次重启后 running = 1.2.0、hostEpoch 变为 `he_abb7…`。
6. **存档与数据保留**：`$DSH_HOME/storages/dsh-game-market` 下的标记与存档形状 fixture 跨「覆盖安装 / 在线替换 / removeBundle / 重装 / 两次重启」保留。
7. **dev row 迁移是「装上了但没接管」**：存在同 id dev row 时，`installBundle` 成功（`applied`、依赖串与磁盘变为 1.1.0），但 live row 仍是 checkout（`devMode:true`、1.2.0、fiber 183 不变）。迁移必须先移除 dev row 或由 DSH 原生链路切换安装来源。

## 2. 方法

- 探针插件在 profile patch 中以 `file://` URL 注入，`inject = ['pluginManager']`；宿主用 `node --expose-internals <dsh bin.js> web ...` 启动，复刻 Desktop 启动器的 loader 行为（`execArgv:["--expose-internals"]` 落盘于各 `boot.json`）。
- HMR 能力判定**只**用 `manager.ownerContext.get('hmr')`（`installBundle` 内部读的同一来源），先轮询到稳定（最长 15s）再采样；实测 t≈0 为 `false`（`Service.init` 异步注册的竞态，hmr row `fiberState=1`），t≈0.5s 起为 `true`（`fiberState=2`）。不依赖 UA / 版本字符串。
- 每条命令写入 inbox，探针把命令信封 + 观察/结果原子写入 `results/<id>.json`；脚本对「公开 API 返回值 ↔ 磁盘 profile ↔ 运行中 `/health`」做一致性断言，required 失败即非零退出。
- `/health` 通过 Host connection 的精确路由在进程内调用；响应外层是 `{ok,data,requestId,serverTime}` 信封，已按信封解包（早期实现曾按裸对象误读，已修）。
- 网络：pnpm 拉取 GitHub 需要代理。探针宿主进程注入 `HTTPS_PROXY/HTTP_PROXY/ALL_PROXY/npm_config_https_proxy/npm_config_http_proxy/npm_config_proxy=http://127.0.0.1:7897`、`NO_PROXY=127.0.0.1,localhost`（记录于各 `summary.json#networkEnvUsedForPnpm`）。这只影响包管理器出网，不改变 DSH 行为；未修改用户 git/npm 配置。
- 探针读取了少量未公开内部字段（`ownerContext`、`ownerEntryId`、`installs`、`fetchRoutes`），输出中标注 `internal:`；所有行为结论均来自公开方法返回值。`cancel-at-applying` 用内部 `installs.get(id).phase` **只用于把公开的 `cancelInstall` 调度到 applying 边界**，返回状态是 `cancelInstall` 自己的答案。
- 每次运行先清空本场景的证据目录，避免上一轮的陈旧文件混入（该清理在本轮证据生成后补入脚本；不影响已产出的证据）。
- 证据脱敏保留 commit SHA（公开发布身份，本报告需要逐字引用），仅遮蔽 token / `Bearer` / `/Users/<user>` 等；原始未脱敏副本留在隔离工作目录。

## 3. 结论表

| ID | 必须证明什么 | 实际结果（实测） | 证据 | 通过 |
|---|---|---|---|---|
| U1-1 | 能构造无 `hmr` 服务的 profile，并证明能力确实缺失 | patch 中 `- id: hmr` + `disabled: true`；`dsh web --dump-config` exit 0，输出该覆盖（`disabled: true`，注释标明被 profile patch 修改）；运行时 30 次采样全部 `managerContextHmr=false`，hmr loader row `disabled:true` / 无 fiber | [composition-dump-config.json](raw/plugin-update/s-u1-nohmr/composition-dump-config.json)、[boot1/boot.json](raw/plugin-update/s-u1-nohmr/boot1/boot.json) | ✅（隔离路径，非真实 Desktop） |
| U1-2 | 非 HMR 下对同一包覆盖安装旧→新 commit 是否允许、返回什么 | 装 A：`application:"restart-required"`、`restartReason:"no-hmr"`、`bundle:"dsh-game-market"`、`version:"1.1.0"`、`changed:true`、pnpm exit 0；重启后对已装包装 B：同样 `restart-required`/`no-hmr`、`version:"1.2.0"`、`changed:true` | [boot1/install-a.json](raw/plugin-update/s-u1-nohmr/boot1/install-a.json)、[boot2/install-b.json](raw/plugin-update/s-u1-nohmr/boot2/install-b.json) | ✅ |
| U1-3 | 未重启前旧 Host 是否继续跑旧代码 | 装 A 后（同进程）`/health` 路由不存在（bundle row 未启动）；boot2 装 B 后 running=1.1.0、disk=1.2.0、hostEpoch 与安装前一致（`he_7275…`）、bundle row fiber 182 未变 | [boot1/observe-post-a.json](raw/plugin-update/s-u1-nohmr/boot1/observe-post-a.json)、[boot2/observe-post-b.json](raw/plugin-update/s-u1-nohmr/boot2/observe-post-b.json) | ✅ |
| U1-4 | 重启后实际 loadedVersion | boot2：running 1.1.0（hostEpoch `he_7275…`）；boot3：running 1.2.0、新 hostEpoch `he_abb7…`、bundle row 182 running | [boot2/observe-pre.json](raw/plugin-update/s-u1-nohmr/boot2/observe-pre.json)、[boot3/observe-final.json](raw/plugin-update/s-u1-nohmr/boot3/observe-final.json) | ✅ |
| U1-5 | 存档/数据保留 | `storages/dsh-game-market` 标记 + `saves/snake/current.json` fixture 在覆盖安装、两次重启后内容不变 | [boot2/storage-pre.json](raw/plugin-update/s-u1-nohmr/boot2/storage-pre.json)、[boot2/storage-after-update.json](raw/plugin-update/s-u1-nohmr/boot2/storage-after-update.json)、[boot3/storage-final.json](raw/plugin-update/s-u1-nohmr/boot3/storage-final.json) | ✅ |
| U2-1 | HMR 能力的可靠来源 + 时序 | 采样 `false`(0ms) → `true`(≈500ms)，`hmr` row `fiberState 1→2`，ctor `Hmr`，`runExclusive` 存在；`ownerEntryId="include:plugin-manager"`、`ownerContextIsProbeContext=false` | [boot1/boot.json](raw/plugin-update/s-u2-hmr/boot1/boot.json) | ✅ |
| U2-2 | 操作是否由独立于被更新插件的宿主服务持有 | 探针 fiber uid **48 全程不变**（8 次 observe + heartbeat），被更新 bundle row fiber 337→338→339→340→341 | [heartbeat-final.json](raw/plugin-update/s-u2-hmr/boot1/heartbeat-final.json)、[observe-post-a.json](raw/plugin-update/s-u2-hmr/boot1/observe-post-a.json) | ✅ |
| U2-3 | 首次安装（包不在 dependencies）在 HMR 下如何 | `applied`、`version 1.1.0`、`changed:true`、pnpm exit 0；无需重启 `/health` 即 1.1.0（新 hostEpoch `he_37f8…` = 插件重新 apply），bundle row 337 running | [install-a.json](raw/plugin-update/s-u2-hmr/boot1/install-a.json)、[observe-post-a.json](raw/plugin-update/s-u2-hmr/boot1/observe-post-a.json) | ✅ |
| U2-4 | HMR + 已是 dependency + **记录串完全相同** | `failed` + `error.code:"already-installed"` + `changed:false`，未跑 pnpm（无 `packageResult`）；A、B 两次都复现 | [install-recorded-a.json](raw/plugin-update/s-u2-hmr/boot1/install-recorded-a.json)、[install-recorded-b.json](raw/plugin-update/s-u2-hmr/boot1/install-recorded-b.json) | ✅ |
| U2-5 | HMR + 已是 dependency + **URL+commit 更新**（真实一键更新形态） | `applied`、`version 1.2.0`、`changed:true`；`/health` 无需进程重启报 1.2.0（hostEpoch `he_85a7…`，探针 pid/fiber 不变）；依赖串被 pnpm 记为 `github:heswy/dsh-game-market#f422…`（非 HTTPS 原串） | [install-b.json](raw/plugin-update/s-u2-hmr/boot1/install-b.json)、[observe-post-b.json](raw/plugin-update/s-u2-hmr/boot1/observe-post-b.json) | ✅ |
| U2-6 | 连续第二次更新 B→C 是否也放行（可重复性） | 同一 URL 形态装 C（tag v1.0.0）：`applied`、`version 1.0.0`、`/health` 1.0.0（hostEpoch `he_218e…`）、依赖串 `…#611c0ed…`、bundle row 换新 fiber | [install-c.json](raw/plugin-update/s-u2-hmr/boot1/install-c.json)、[observe-post-c.json](raw/plugin-update/s-u2-hmr/boot1/observe-post-c.json) | ✅ |
| U2-7 | 同目标重复点击（URL 形态）会怎样 | `failed` + `error.code:"ambiguous-install"`、`changed:false`，pnpm exit 0；依赖串与 live 版本均未变（既不是 `already-installed`，也不是静默成功） | [install-b-again-url.json](raw/plugin-update/s-u2-hmr/boot1/install-b-again-url.json)、[observe-post-b-again.json](raw/plugin-update/s-u2-hmr/boot1/observe-post-b-again.json) | ✅（语义见 §4.2） |
| U2-8 | 在线替换时旧 bundle row 是否 disposal | 每次 `applied` 后 `dsh-game-market` row 都是**新的 fiber uid**（337→338→339→340→341），旧 fiber 不再存在；同时探针 row 48 不变 | [observe-post-b.json](raw/plugin-update/s-u2-hmr/boot1/observe-post-b.json)、[observe-post-too-late.json](raw/plugin-update/s-u2-hmr/boot1/observe-post-too-late.json) | ✅ |
| U2-9 | `removeBundle` + 重装（HMR，独立操作者） | remove `applied`、`changed:true`、无 `stop-profile`/`bundle-in-use`；依赖/健康路由/row 全部消失；探针存活（同 fiber uid）；随后重装 B `applied`、`/health` 1.2.0、row 341 | [remove-bundle.json](raw/plugin-update/s-u2-hmr/boot1/remove-bundle.json)、[observe-post-remove.json](raw/plugin-update/s-u2-hmr/boot1/observe-post-remove.json)、[reinstall-b.json](raw/plugin-update/s-u2-hmr/boot1/reinstall-b.json) | ✅ |
| U2-10 | dev row 存在时首次迁移安装会怎样（重复 id） | 包安装 `applied`（pnpm 真跑、依赖串/磁盘 1.1.0），但同 id dev row **覆盖了 bundle 行**：live 仍是 checkout（`devMode:true`、1.2.0、hostEpoch 与安装前一致 `he_bbbb…`、fiber 183 不变），无重复 live row、无报错 | [observe-pre.json](raw/plugin-update/s-u2b-devmigration/observe-pre.json)、[install-a.json](raw/plugin-update/s-u2b-devmigration/install-a.json)、[observe-post.json](raw/plugin-update/s-u2b-devmigration/observe-post.json) | ✅（结论：需先移除 dev row） |
| U3-1 | `application` / `restartReason` 语义 | 非 HMR：`restart-required` + `restartReason:"no-hmr"`；HMR：`applied`（无 `restartReason`）；管理类失败：`failed` + `error.code`（如 `already-installed`/`ambiguous-install`）；取消：`cancelled`；`changed` 由 profile 文件是否变化决定 | 各 install/cancel JSON | ✅ |
| U3-2 | `requestId` 语义 | `installBundle` 结果**不回显** `requestId`（`resultKeys` 已落盘）；`plugin-manager/install-state` 事件逐条带 `requestId`（7 个请求 id：`su2-a-req`…`su2-tooLate-req`）；`waitForInstall`/`cancelInstall` 以 requestId 为键 | [install-state-events.json](raw/plugin-update/s-u2-hmr/boot1/install-state-events.json)、[install-a.json](raw/plugin-update/s-u2-hmr/boot1/install-a.json) | ✅ |
| U3-3 | 安装结果丢失：`waitForInstall` 返回 `null` 的边界 | 未知 id → `null`；安装结算后再查同一 id → `null`（结果不保留，**null 不代表成功/取消/没装过**）；活动期内并发 `waitForInstall` 返回**同一结果**（`waitEqualsResult:true`） | [install-a.json](raw/plugin-update/s-u2-hmr/boot1/install-a.json)、[cancel-unknown.json](raw/plugin-update/s-u2-hmr/boot1/cancel-unknown.json) | ✅ |
| U3-4 | `cancelInstall` 三态 | `not-running`（未知 id）；`cancelled`（installing 期取消，`application:"cancelled"`、`changed:false`、依赖串保持 C）；`too-late`（applying 期，安装继续完成 `applied` 1.2.0，**不回滚不伪报**） | [cancel-unknown.json](raw/plugin-update/s-u2-hmr/boot1/cancel-unknown.json)、[cancel-during-install.json](raw/plugin-update/s-u2-hmr/boot1/cancel-during-install.json)、[cancel-at-applying.json](raw/plugin-update/s-u2-hmr/boot1/cancel-at-applying.json) | ✅ |
| U3-5 | profile 依赖声明版本 vs 实际 loadedVersion | 依赖声明是 **git spec 串**（`github:heswy/… #sha`，无 semver）；磁盘 `node_modules/dsh-game-market/package.json#version` 与 `listBundles().version`、`/health.version` 在 `applied` 后一致（1.2.0）；`restart-required` 后 running(1.1.0) 与 disk(1.2.0) 故意不一致（U1-3） | [observe-post-b.json](raw/plugin-update/s-u2-hmr/boot1/observe-post-b.json)、[boot3/observe-final.json](raw/plugin-update/s-u1-nohmr/boot3/observe-final.json) | ✅ |
| U3-6 | HMR 能力判定不得靠 UA/版本字符串 | 全部结论只用 `manager.ownerContext.get('hmr')` 采样；非 HMR profile 30 次 `false` + row `disabled:true`，HMR profile 0→`true` 且 row `fiberState 2` | [u1 boot1/boot.json](raw/plugin-update/s-u1-nohmr/boot1/boot.json)、[u2 boot1/boot.json](raw/plugin-update/s-u2-hmr/boot1/boot.json) | ✅ |

## 4. 关键原始 Remote Result（逐字摘录）

说明：安装推进到 enablement 后，`target` 会被 DSH 改写为包名 `dsh-game-market`（`stage` 为 `enable`）；在 pnpm 之前被拒的调用（`already-installed` / `ambiguous-install`）保留原始 spec 串作为 `target`。

### 4.1 同记录串重复安装 → already-installed（U2-4）

```json
{"stage":"install","target":"github:heswy/dsh-game-market#c106ac101e064a72f408c58b2516aad5118f513f","enabled":true,"changed":false,"application":"failed","error":{"code":"already-installed"}}
```

### 4.2 URL 形态重复安装 → ambiguous-install（U2-7）

```json
{"stage":"install","target":"https://github.com/heswy/dsh-game-market.git#f422e8d04b3b3de3f920a794317c0d28ee1246a2","enabled":true,"changed":false,"application":"failed","error":{"code":"ambiguous-install"},"packageResult":{"exitCode":0,"truncated":false}}
```

因果链（同一轮实测，三条证据互相咬合）：pnpm 成功（exit 0）→ profile `package.json` 的依赖值 `before === after` → `installed.length===0` → `specPackageName` 无法把 HTTPS 串匹配到已记录的 `github:` 串 → `ambiguous-install`。因此**依赖串与 live 版本均未变化**（[observe-post-b-again.json](raw/plugin-update/s-u2-hmr/boot1/observe-post-b-again.json)）。

### 4.3 HMR 下 URL+commit 更新（U2-5）

```json
{"stage":"enable","target":"dsh-game-market","enabled":true,"changed":true,"application":"applied","bundle":"dsh-game-market","version":"1.2.0","packageResult":{"exitCode":0,"truncated":false}}
```

### 4.4 非 HMR 下覆盖安装（U1-2）

```json
{"stage":"enable","target":"dsh-game-market","enabled":true,"changed":true,"application":"restart-required","restartReason":"no-hmr","bundle":"dsh-game-market","version":"1.2.0","packageResult":{"exitCode":0,"truncated":false}}
```

### 4.5 cancel 三态（U3-4）

```json
{"cancelInstall":{"status":"not-running"}}
{"cancelInstall":{"status":"cancelled"},"install":{"application":"cancelled","changed":false}}
{"cancelInstall":{"status":"too-late"},"install":{"application":"applied","version":"1.2.0","changed":true}}
```

### 4.6 removeBundle（HMR）

```json
{"stage":"remove","target":"dsh-game-market","changed":true,"application":"applied","packageResult":{"exitCode":0,"truncated":false}}
```

## 5. 命令与 exit code

最终证据由以下命令产生（worktree `/Users/<user>/…/v1.5-m0`）：

| 命令 | exit code | 结果 | 日志 |
|---|---|---|---|
| `node scripts/verification/v1.5/plugin-update/run-su2-hmr.mjs` | 0 | passed=true，120 checks / required 58 全过 | `/tmp/dsh-v15/plugin-update/su2-run7.log` |
| `node scripts/verification/v1.5/plugin-update/run-su1-nohmr.mjs` | 0 | passed=true，42 checks / required 30 全过 | `/tmp/dsh-v15/plugin-update/su1-run8.log` |
| `node scripts/verification/v1.5/plugin-update/run-su2b-devmigration.mjs` | 0 | passed=true，21 checks / required 9 全过 | `/tmp/dsh-v15/plugin-update/su2b-run7.log` |

S-U1 内部还会执行 `node <dsh bin.js> web --dump-config`（`DSH_HOME` 指向隔离 home），exit 0，输出见 [composition-dump-config.json](raw/plugin-update/s-u1-nohmr/composition-dump-config.json)。

过程中的失败运行（诚实记录；均已定位并修复，最终运行不受影响）：

| 运行 | exit | 原因 |
|---|---|---|
| `run-su2-hmr` 第 1 次（`su2-run.log`） | 1 | 安装 B 超时：pnpm 直连 GitHub 拉取停滞（宿主未注入代理） |
| `run-su1-nohmr` 第 1 次（`su1-run.log`） | 1 | 同上 |
| `run-su2-hmr` 第 2 次（`su2-run2.log`） | 1 | 脚本未解包 `{ok,…,snapshot}` 信封，断言误判 |
| `run-su1-nohmr` / `run-su2b-devmigration`（`su1-run2.log` / `su2b-run1.log`） | 1 | 启动器 cwd 指到主工作区，`MODULE_NOT_FOUND`，未产生写入 |
| `run-su2b-devmigration` 第 2 次（`su2b-run2.log`） | 1 | 未解构 `waitReady()` 的 `{ready, boot}`，能力断言取到 `undefined`（**这就是 Lead 看到的 required 失败，属探针 bug，已修**） |
| `run-su1-nohmr` 第 3 次（`su1-run3.log`） | 1 | boot2 用 boot2 的 marker 名去查 boot1 的标记文件（断言写法问题），已改为编排器直接校验存储根 |
| `run-*` 第 6 次（`*-run6.log`） | 1 | 三个脚本的 `sanitizeEvidence` import 被插到错误的模块块，`SyntaxError` |
| `run-su1-nohmr` 第 7 次（`su1-run7.log`） | 1 | 三个探针并发时的瞬时网络失败：`checkGithubConnection` 报 `dsh: connection to github.com timed out after 5000ms`，结果为 `failed` + `error.code:"operation-error"`（该次 JSON 已被随后成功运行覆盖，不作为通过证据，仅记录该失败形态） |

## 6. 对契约/实现的影响（给 M0 契约使用）

1. **两条更新路径必须在 adapter 中区分**：
   - HMR profile（真实 Desktop）：`installBundle(URL+exactCommit)` → `applied`，在线替换、无需进程重启；注意每次替换会让该插件的 `hostEpoch` 变化（插件重新 apply），不能用 hostEpoch 判定进程重启。
   - 非 HMR profile：`restart-required` + `no-hmr`，只显示「已安装，重启后生效」，不得把磁盘版本当运行版本。
2. **幂等保护不能只依赖 `already-installed`**：URL 形态与 profile 记录串形态不同（pnpm 归一化为 `github:<owner>/<repo>#<sha>`）。adapter 应在调用前比较「记录的依赖串」与目标 spec；并把 `already-installed` 与「URL 形态同目标的 `ambiguous-install`」都映射为「无变更/已是目标」，但**不得**把 `ambiguous-install` 无条件当成功（真实歧义场景也可能出现该 code）。
3. **操作持有者必须是独立于被更新 bundle 的宿主服务**：本轮用独立探针插件实测了首次安装、两次在线更新、`removeBundle`、重装，持有者 profile 行与探针 fiber 全程未被销毁；HMR 替换只 dispose 被更新 bundle 自己的 row。
4. **能力门**：只认 `manager.ownerContext.get('hmr')`，并等稳定（异步注册，早读为 false）；缺失时只禁用可执行更新入口，不影响市场与游戏运行。
5. **迁移场景**：检测到同 id dev row（`dev:enable` 形态）时，安装包不会接管运行中的行；必须先引导用户移除 dev row（或在原生插件页切换来源），再走常规更新。
6. **数据位置**：`$DSH_HOME/storages/dsh-game-market` 与包目录分离，本轮覆盖安装/在线替换/卸载/重装全部保留数据。

## 7. 未验证项 / 边界（不得写成通过）

1. **真实 Desktop GUI 内的一键更新按钮**：v1.2.0 没有更新 UI，本探针为 Host-only；客户端半在 bundle 被替换时的销毁时序、RPC 结果在浏览器侧是否会丢失（需配合 `install-state` + `waitForInstall` 恢复）**未验证**。
2. **多窗口 / 多游戏实例协调与 profile 更新锁**（指南 §5.2 步骤 2）不在本任务范围。
3. **存档写入未经服务层**：存储保留用直接落盘的存档形状 fixture 验证（真实游戏会话需要 Client UI）。它证明「包变更不触碰 `storages/`」，不等于「服务层保存路径端到端可用」。
4. **`too-late` 的调度**：用内部 `installs.get(id).phase` 把公开 `cancelInstall` 调度到 applying 边界；返回状态来自公开 API。
5. **事件订阅走内部 context**：`plugin-manager/install-state|install-log|changed` 通过 `manager.ownerContext.on(...)` 观察，非公开 API；生产实现应走正式 Remote/事件 seam。
6. **desktop profile 未直接启动**（禁止读写用户 `~/.dsh`）。探针用与 Desktop 相同 bundles 的 `web` profile；Lead 已用 `ps` 单独确认真实 Desktop 进程 bundles 含 `dsh-base`、用户 patch 未禁用 hmr。
7. **pnpm 出网依赖代理**：探针宿主显式注入代理环境变量；真实 Desktop 使用 App 自带 pnpm 与用户网络环境，可能与探针环境不同。并发运行时已实测一次 GitHub 连接检查 5s 超时导致的 `operation-error`。
8. **dev row 场景下的原生「切换安装来源」UI** 是否存在未验证；本轮只证明了行为与风险。

## 8. 产物清单

| 文件 | 说明 |
|---|---|
| [`scripts/verification/v1.5/plugin-update/probe-plugin-host.js`](../../../scripts/verification/v1.5/plugin-update/probe-plugin-host.js) | 独立探针 Host 插件（命令 inbox 驱动，调用真实 pluginManager） |
| [`lib.mjs`](../../../scripts/verification/v1.5/plugin-update/lib.mjs) | Host 启动（`--expose-internals`、代理环境）、patch 写入、Probe 客户端、存储 fixture、保留 commit SHA 的证据脱敏 |
| [`run-su2-hmr.mjs`](../../../scripts/verification/v1.5/plugin-update/run-su2-hmr.mjs) | S-U2：HMR 首次安装 / 更新 A→B→C / 重复点击 / 取消三态 / removeBundle / 重装 |
| [`run-su1-nohmr.mjs`](../../../scripts/verification/v1.5/plugin-update/run-su1-nohmr.mjs) | S-U1：隔离非 HMR 覆盖安装 + 两次重启 + 数据保留 |
| [`run-su2b-devmigration.mjs`](../../../scripts/verification/v1.5/plugin-update/run-su2b-devmigration.mjs) | S-U2b：dev row 同 id 迁移 |
| `docs/verification/v1.5/raw/plugin-update/**` | 脱敏原始 JSON（boot / observe / install / cancel / remove / heartbeat / 事件流 / summary） |

脚本约定：required 断言失败即非零退出；证据脱敏保留 40 位 commit SHA，遮蔽 token、`Bearer`、`/Users/<user>`；原始未脱敏副本留在隔离工作目录 `/tmp/dsh-v15/plugin-update/`。
