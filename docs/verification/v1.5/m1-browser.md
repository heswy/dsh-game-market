# M1 真实浏览器验证：A02 多资源包加载 + A06 安全边界（wrapper 协同）

日期：2026-10-20。工作树：`/Users/orange/Orange Field/Matterhorn/dsh-game-market-worktrees/v1.5-asset-packages`（分支 `feat/v1.5-asset-packages`，HEAD `a762449` + M1 未提交改动，由 Lead 提交）。契约：`docs/V1.5-CONTRACTS.md` §1/§3/§4/§7（含 §7.5.1 wrapper 导航边界、§7.6 LaunchInfo）；指南 §8 A02/A06。

## 0. 结论

| 套件 | 结果 | 命令 | exit code | 证据 |
|---|---|---|---|---|
| **A02** 真 ZIP 多资源加载 + 断网可玩 | **通过 43/43 必须断言** | `node scripts/verification/v1.5/m1/m1-a02-multiresource.mjs` | **0** | `raw/m1/M1-A02-multiresource-2026-10-20T04-44-56-876Z.json` |
| **A06** 沙箱/CSP/CORS/ESM 边界 + wrapper 导航 + Bridge 来源校验 | **通过 42/42 必须断言**（另有 1 条非必须断言通过） | `node scripts/verification/v1.5/m1/m1-a06-boundaries.mjs` | **0** | `raw/m1/M1-A06-boundaries-2026-10-20T04-51-00-544Z.json` |
| **CR7-01**（复核补充）同源第二 HTML 文档必须带 asset CSP、外发 sink 零请求 | **修复后通过 21/21**；修复前快照 13/21 失败（sink 真实收到请求） | `node scripts/verification/v1.5/m1/m1-a06b-same-origin-html.mjs` | 修复后 **0** / 修复前 1 | `raw/m1/CR7-01-same-origin-html-2026-10-20T05-25-33-319Z.json`（后）、`raw/m1/CR7-01-same-origin-html-prefix-2026-10-20T05-11-39-097Z.json`（前） |
| **CR7-03**（复核补充）真实 Market UI 点击安装本地 `.dshgame.zip`（逐字节一致） | **修复后通过 36/36**；修复前 15/36；中间修复态（format 未转发）23/36 且 415 | `node scripts/verification/v1.5/m1/m1-a06c-market-ui-local-zip.mjs` | 修复后 **0** / 修复前 1 | `raw/m1/CR7-03-market-ui-local-zip-2026-10-20T05-28-04-816Z.json`（后）、`-prefix-`（前）、`-fix1-415-`（中间态） |

结论摘要：
1. **A02**：真实安装版 DSH `0.2.1-rc.2` 隔离宿主 + 真实 headless Chrome 中，经真实 Host API 安装的 `asset-zip-v2` 包（HTML + 独立 ESM ×2 + CSS + PNG + JSON + WAV）由**真实 RuntimeController → 平台 wrapper → 游戏文档**加载；每种资源逐个 HTTP 200（精确 MIME/CORS/nosniff/no-store/no-referrer），游戏内 `fetch` 解析 JSON、`naturalWidth=64`、`audio.readyState=4`、computed style 生效、SDK 握手 + `storage.save` 成功；**断网（阻断全部非 resourceOrigin 请求 + CDP offline）仍可玩**。
2. **A06**：恶意包（安装校验通过、运行期作恶）的外发 fetch/XHR/WebSocket/beacon 在**网络层零外发**（独立 sink origin：0 HTTP 请求、0 WS upgrade，正向对照：包内同源 fetch=200、SDK 握手与合法 `storage.save` 被接受）；读 Host `/api` 全部在 CSP 之前被阻断；桥没有安装/更新/答案/审批类能力（6 个危险方法一律 `GM-4004`）；从非本实例窗口发 60 条桥消息被**拒绝并计数**（`GM-5004` + 实例撤销，攻击窗口收不到任何桥响应）；wrapper `frame-src` 阻断游戏自我外部导航（目标端零请求、Chrome 违规日志、正向对照：同源 `second.html` 真实 200），`window.top.location` 抛权限错；**零 `frame-ancestors` 违规**。
3. 三层 iframe 模型实测成立：**外层 wrapper iframe `sandbox` 属性不存在**、运行在 resource origin 真实 origin；**内层 game iframe `sandbox="allow-scripts"` 且无 `allow-same-origin`**（游戏文档 `window.origin === "null"`、`referrerpolicy=no-referrer`）。wrapper CSP `frame-ancestors` = **精确 DSH 页面 origin、不含 `*`**。

## 1. 环境身份与隔离方式

| 项 | 实测值 |
|---|---|
| DSH / 宿主包 | `@deepseek-ai/dsh-desktop-runtime` **0.2.1-rc.2**（plugin-manager / electron-app 同版本；ASAR 只读解出 `/tmp/dsh-v15/asar`） |
| 隔离宿主 | `dsh web --no-open --host 127.0.0.1 --port <ephemeral>`，`DSH_HOME=/tmp/dsh-v15/home-probe-m1-a02|a06`；本 worktree 插件行由 `injectProbeRow` 注入（`devMode: true`） |
| 浏览器 | Google Chrome **155.0.8059.85**（headless），CDP 递归 auto-attach（wrapper/game 两层 OOPIF + 同进程 frame 两种形态都覆盖） |
| Node | v24.14.0 |
| 资源 origin | Host 启动时在 loopback 随机端口（A02 实测 `http://127.0.0.1:60688`，A06 `:60971`），只服务 `/res/<instance>/<token>/…` 与 `/wrapper?src=…` |
| 固定基线与源码摘要 | `client.js` sha256 `9c773bc72c2c68bcfcd23c96ae5b54eee1134be378ffbbde06a02d6f478404b6`；`packages/host/src/plugin.js` `72b4d0bc…`；`resources.js` `720bc310…`；`entry.js` `d8fedc85…`；`packages/runtime/src/controller.js` `2f7ac905…`（完整值见 §9） |
| 仓库门禁（本探针改动下） | `node scripts/check.mjs` → **CHECK OK (41)**，exit 0；`node --test` → **1016 pass / 0 fail**，exit 0 |

安全纪律：所有 `DSH_HOME` 位于 `/tmp/dsh-v15/`（探针启动时断言）；**未读写 `~/.dsh/`、未修改 `/Applications/DeepSeek Harness.app`**；未加 `allow-same-origin`；未 `git commit`；证据中 `<resourceToken>`/launch nonce/instanceId/cookie 全部脱敏（扫描 `[a-f0-9]{32}`/长 base64/`launch=`/`/Users/<real>` 均为 0 命中）。

### 1.1 证据级别（明确边界）

本报告的证据 = **真实 DSH 页面（真实 GUI bundle）+ 真实 Host（`/api` launch/install + 独立 loopback 资源 origin + wrapper）+ 生产 `packages/runtime/src` RuntimeController（真实 bridge）+ 生产 SDK（`bundleExpression` 打进测试包）+ 真实 Chrome**。探针在 DSH 页面内 `createGameRuntime(...).launch(LaunchInfo)` 驱动 Runtime，而非点击打包后的 Client Market UI。这与任务要求的「真实浏览器验证」一致；**未驱动打包 Client UI 路径**已列入 §7 未验证项（Lead 2026-10-20 明确接受该证据级别）。

## 2. 命令与 exit code

```bash
cd "/Users/orange/Orange Field/Matterhorn/dsh-game-market-worktrees/v1.5-asset-packages"

node --check scripts/verification/v1.5/m1/lib/lab.mjs \
  && node --check scripts/verification/v1.5/m1/m1-a02-multiresource.mjs \
  && node --check scripts/verification/v1.5/m1/m1-a06-boundaries.mjs        # exit 0
node scripts/check.mjs                                                       # exit 0 — CHECK OK (41)
node --test                                                                  # exit 0 — 1016 pass / 0 fail

# A02（真 ZIP 多资源 + 断网可玩；每个套件各自启动隔离宿主与 Chrome，约 60-90s）
node scripts/verification/v1.5/m1/m1-a02-multiresource.mjs
# exit 0 — M1-A02 PASSED (43/43 required checks)

# A06（安全边界 + wrapper 导航；包含 28s 心跳撤销观察）
node scripts/verification/v1.5/m1/m1-a06-boundaries.mjs
# exit 0 — M1-A06 PASSED (42/42 required checks)
```

退出码语义：脚本把每条断言写入证据（顶层 `passed/failed/required`）；**任一 required 断言失败 → exit 1**；脚本异常 → exit 1；否则 exit 0。`--keep` 保留隔离宿主进程与 `DSH_HOME` 供排查（默认全部清理）。

## 3. A02 逐条结论（必须证明什么 → 实测）

| # | 要求 | 实测结果 | 证据（check / 字段） |
|---|---|---|---|
| A02-1 | 真 `asset-zip-v2` 包经真实 Host 安装 | `POST /api/game-market/install-local`（application/zip）200；`format=asset-zip-v2`、`entry=index.html`、`fileCount=9`、`fileManifestDigest` 存在 | `zip-install-through-host-api-succeeds` |
| A02-2 | 真实 `/launch` 返回 §7.6 LaunchInfo | `resourceOrigin`/`resourceBase`/`resourceTtlMs=600000`/`entryResourceUrl`/`package{format,entry,filesDigest}`/`wrapperUrl`/`wrapperResourceUrl` 全存在且关系正确（entryUrl 带一次性 launch、路径在 `/res/` 下） | `launch-info-contract-v2-fields` |
| A02-3 | wrapper 文档契约 | 200 `text/html; charset=utf-8`；CSP `frame-src/child-src <resourceOrigin>`、`script-src 'nonce-…'`、`frame-ancestors <DSH origin>`（精确、无 `*`）；内嵌 iframe `sandbox="allow-scripts"`、`allow="autoplay"`、`referrerpolicy="no-referrer"`；`src` 是 launch URL | `wrapper-document-contract` |
| A02-4 | 外层 wrapper iframe 无 sandbox | DOM 属性 `sandbox === null`，`allow=autoplay`，`referrerpolicy=no-referrer` | `runtime-wrapper-iframe-has-no-sandbox-attribute` |
| A02-5 | 两层 iframe 属性 | wrapper frame（`Page.getFrameTree`+`createIsolatedWorld`）`origin === resourceOrigin`、`windowOrigin === resourceOrigin`；内层 game iframe `sandbox="allow-scripts"`、**不含** `allow-same-origin`、`referrerpolicy=no-referrer` | `wrapper-layer-real-origin-inner-game-sandbox` |
| A02-6 | 游戏**真的渲染**（不是只看 200） | 游戏文档 `title='M1 Multi-Resource Probe'`、`#hud`/`#board` 存在、`window.origin === "null"`、`chromeError=false`、`__M1_GAME__.phase='playing'`、ticks/score 增长 | `game-document-renders-not-chrome-error-2`、`game-document-title-and-dom-present`（A06 同） |
| A02-7 | classic JS + ESM | `dsh-sdk.js`（classic）200；`scripts/main.mjs`（ESM）200、静态 import `scripts/logic.mjs` 200、静态导入函数生效（`esmStaticImport=true`） | `game-esm-static-import-resolved` |
| A02-8 | CSS 生效（computed style） | `document.styleSheets=1`；`body` 计算背景 `rgb(13, 17, 23)`、`#hud` 颜色 `rgb(255, 204, 102)`，与 `styles/game.css` 一致 | `game-css-applied-computed-style` |
| A02-9 | `fetch('./data/level.json')` 可读且可重复 | 两次均 200，解析出 `{id:'level-01', waves:5}`（`repeated=true`） | `game-json-fetched-twice-and-parsed`、`a02-round1.json-level-fetched-twice` |
| A02-10 | SDK `assetUrl()` 走资源前缀 | 返回 `http://127.0.0.1:<res>/res/<inst>/<token>/data/level.json`，再次 fetch=200 | `game-sdk-asset-url-works` |
| A02-11 | 图片真实解码 + canvas 可读 | `naturalWidth/Height=64`、`decode()` resolve、CORS 图片 canvas `getImageData` 读到 1536 个不透明像素 | `game-image-decoded-and-canvas-readable` |
| A02-12 | 音频真实可加载/解码 | `<audio>` readyState=4、duration=0.2s；`fetch` 3244B → `decodeAudioData` 0.2s/1 声道 | `game-audio-ready-and-decodable` |
| A02-13 | SDK 握手 + 桥写路径 | `game.ready()` 成功（`packageFormat=asset-zip-v2`、`resourceBase` 存在）；`game.storage.save` 经 wrapper relay + Runtime → Host `/api/game-market/save` 200（`bytes=21`） | `game-sdk-handshake-ready`、`game-storage-save-through-bridge` |
| A02-14 | 逐资源 HTTP 200 + 真实响应头 | 8 类资源全部 200：`index.html`、`dsh-sdk.js`、`scripts/main.mjs`、`scripts/logic.mjs`、`styles/game.css`、`data/level.json`（×2）、`assets/ship.png`（×2，含 CSS `url()`）、`assets/pickup.wav`；MIME 精确；每资源 `ACAO:*`、`nosniff`、`no-store`、`no-referrer`；无 404/无失败；CSP 只在入口文档出现 | `a02-round1.*`（6 条） |
| A02-15 | 凭证纪律（探针不消费 launch） | 入口文档**首次且仅一次**带 `launch` 请求且 200（由真实 Runtime 的 wrapper 内层 iframe 消费）；资源凭证 URL 可重复 200；同一 launch URL 重放 **410**；`credentialKind` 逐请求记录 | `launch-credential-consumed-exactly-once-by-runtime`、`launch-url-replay-is-410`、`resource-credential-entry-url-is-repeatable-200` |
| A02-16 | 保留名/方法/穿越拒绝 | `game.json`、`dsh-package.json` → **403 GM-4039**（契约 §7.3 口径）；`HEAD` 资源=200；`POST` 资源=405；`%2e%2e%2f` 穿越=403 | `descriptor-and-game-json-not-served`、`resource-methods-and-traversal-rejected` |
| A02-17 | **断网仍可玩**（非 resourceOrigin 请求全阻断后重载） | 对 wrapper+game 全部 session 开 Fetch gate（仅放行 resourceOrigin）：`runtime.reload()` 成功、阻断请求数=0、资源第二轮全部 200、游戏 phase=playing；wrapper 重载 URL `src` 使用**资源凭证 URL**（无 `launch`），`launchReplayedAfterReload=false` | `offline-gate-reload-renders-and-plays`、`offline-gate-reload-loads-every-resource-from-resource-origin`、`offline-gate-blocked-zero-non-resource-requests`、`reload-uses-resource-credential-url-not-launch-url` |
| A02-18 | CDP offline 下逻辑仍推进 | `Network.emulateNetworkConditions(offline)` 后 ticks 1 → 14（1.5s），恢复网络 | `offline-play-ticks-advance-with-network-disabled` |
| A02-19 | 零 CSP 违规 | wrapper/game 两层 Chrome Log 中 `Framing … violates`/`Refused to` = 0 | `no-csp-violation-logs`、`no-framing-frame-ancestors-violation` |

> 说明：A02 的「断网」按任务允许的第二种口径实现——**阻断所有非 resourceOrigin 请求**（Fetch gate，阻断计数 0 说明没有外发）+ 加载完成后 **CDP offline 模拟**下逻辑继续推进。loopback 资源 origin 本身是本地服务器，是平台离线可玩的设计前提。

## 4. A06 逐条结论（恶意面 → 实测）

### 4.1 外发与 Host API（网络层零外发 = 核心）

| 攻击面 | 实测（恶意包运行期真实尝试） | 正向对照 | 证据 |
|---|---|---|---|
| `fetch('http://sink/…')` | `TypeError` 拒绝；CDP 无请求；sink 0 | 包内 `fetch('data/level.json')` = **200** | `egress-fetch-external-rejected`、`egress-fetch-same-origin-positive-control` |
| `XMLHttpRequest` 到 sink | `xhr-error`；CDP 仅 1 条 `failed=true, blockedReason=csp` 的事件（CSP 在渲染进程内拦截，**未出网络**）；sink 0 | 同上 | `egress-xhr-external-rejected`、`egress-network-layer-blocked-before-send` |
| `new WebSocket(ws://sink/…)` | `ws-error`；sink **0 upgrade** | — | `egress-websocket-external-not-opened`、`egress-sink-received-zero-websocket-upgrades` |
| `navigator.sendBeacon(sink)` | 入队（`queued=true`）但 sink 0 请求 | — | `csp-reported-blocked-egress-attempts` |
| `window.open(sink)` | 返回 null（sandbox 无 `allow-popups`） | — | `egress-window-open-external-blocked` |
| `window.top.location = sink` | 抛 `SecurityError`（无 `allow-top-navigation`）；DSH 页面 URL 未变 | — | `egress-top-navigation-blocked`、`egress-top-navigation-did-not-change-page` |
| 游戏 `fetch(DSH/api/health)`、`XHR(DSH/api/save)` | CSP `connect-src` 拦截（`TypeError`），CDP 事件 `blockedReason=csp` | 页面自身 `fetch(/api/game-market/health)` = **200**（端点存在） | `host-api-game-fetch-rejected`、`host-api-game-xhr-rejected`、`host-api-game-attempts-all-blocked-pre-network` |
| 危险 Host 端点 | 游戏侧调用全部被 CSP 预网络阻断；成功 `/api` 流量只有桥的合法 `/api/game-market/save` 与 DSH 自身 `/api/session/create`；`/health` 读尝试未成功 | — | `host-api-no-dangerous-endpoint-called`、`host-api-read-attempt-blocked` |

> 口径说明（可证伪性）：`fetch` 被 CSP 阻断时 CDP 不产生请求事件；**XHR 会先产生一个 `requestWillBeSent`，随后以 `loadingFailed(blockedReason='csp')` 结束**，这是渲染进程内拦截、没有网络字节。因此断言写成「sink 0 请求 + 不存在 status/非 CSP 失败的出网事件」，而不是「CDP 数组中绝对不存在该 URL」；原始 `externalNetwork` 数组完整落盘可复核。

### 4.2 Bridge 能力与来源校验

| 项 | 实测 | 证据 |
|---|---|---|
| 合法桥（wrapper 正常转发） | `game.ready()` 成功；合法 `storage.save` 收到 `ok:true` 响应（Runtime→Host `/api/game-market/save` 200） | `bridge-handshake-ready-positive-control`、`bridge-legit-save-accepted-via-wrapper-relay` |
| 危险方法不可用 | 6 个方法（`pluginManager/install`、`update/begin`、`install`、`userQuestions/answer`、`approval/request`、`score.reset`）全部 `ok:false, code=GM-4004`（不存在/未实现），无对应 Host 调用 | `bridge-dangerous-methods-absent-or-rejected` |
| 游戏直接 `window.top.postMessage` 伪造桥消息 | 5 条直投 top 的消息不产生额外 `init`（`initEvents=1`，只有合法通道那次） | `bridge-direct-to-top-spoof-produces-no-extra-init` |
| **非本实例窗口**（另一 iframe，静态无辜 origin）伪造 60 条结构合法桥信封 | Runtime 因 `event.source !== wrapper WindowProxy` 全部拒绝并**计数**：>50/10s 触发 `GM-5004 "Too many invalid bridge messages"`，实例撤销（state=error、iframe 被移除）；攻击窗口收到 **0** 条桥响应 | `bridge-untrusted-window-spoof-rejected-and-counted`、`bridge-untrusted-window-got-no-bridge-response` |

### 4.3 wrapper 导航边界（自导航）

| 项 | 实测 | 证据 |
|---|---|---|
| 恶意游戏 `location.replace(sinkOrigin/self-navigation)` | 游戏先记录 attempt（证明确实尝试），sink **0 请求**、CDP 无出网请求；Chrome 记录 `Framing 'http://127.0.0.1:58342/' violates … "frame-src http://127.0.0.1:60971"` | `navigation-external-attempt-is-observable`、`navigation-wrapper-frame-src-blocked-external`、`navigation-external-blocked-by-frame-src`、`navigation-no-request-reached-external-origin` |
| 正向对照：同源 `second.html` 导航 | 200 加载、新文档执行（`second-page` 日志）；随后 Runtime 心跳失联检测生效（`GM-5012`，§7.5.1 纵深防御） | `navigation-same-origin-positive-control-loads`、`navigation-runtime-detects-unexpected-nested-navigation`（非必须，已通过） |
| CSP 日志 | `frame-ancestors` 违规 **0**；`frame-src` 阻断 1 条（预期）；其余 CSP 拒绝报告 20 条（预期攻击尝试） | `no-frame-ancestors-framing-violations`、`frame-src-blocked-external-self-navigation-observed` |

> 注意：被 `frame-src` 阻断的自导航在 Chromium 里可能把游戏文档替换为错误页，这不影响安全结论（目标端零请求是边界）；本探针把「文档是否仍存活」记录为观测，不作为必须项。

## 5. 实测响应头 / 两层次属性（最终基线）

### 5.1 外层 wrapper iframe（Runtime 创建）

```
sandbox        = (无该属性 / null)
allow          = "autoplay"
referrerpolicy = "no-referrer"
src            = http://127.0.0.1:<resourcePort>/wrapper?src=<entry launch URL>
```

### 5.2 wrapper 文档响应头

```http
Content-Type: text/html; charset=utf-8
Access-Control-Allow-Origin: *
X-Content-Type-Options: nosniff
Cache-Control: no-store
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'none'; frame-src http://127.0.0.1:<res>; child-src http://127.0.0.1:<res>;
  script-src 'nonce-<nonce>'; style-src 'unsafe-inline'; img-src 'none'; media-src 'none'; font-src 'none';
  connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';
  frame-ancestors http://127.0.0.1:<dshWebPort>
```

内层 iframe（wrapper HTML 固定）：`sandbox="allow-scripts" allow="autoplay" referrerpolicy="no-referrer"`。

### 5.3 入口文档（`/res/<instance>/<token>/index.html`，CSP 只在文档发送）

```http
Content-Type: text/html; charset=utf-8
Access-Control-Allow-Origin: *; Access-Control-Allow-Methods: GET, HEAD
X-Content-Type-Options: nosniff; Cache-Control: no-store; Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'none'; script-src http://127.0.0.1:<res>; style-src http://127.0.0.1:<res>;
  img-src http://127.0.0.1:<res> data:; media-src http://127.0.0.1:<res>; font-src http://127.0.0.1:<res>;
  connect-src http://127.0.0.1:<res>; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none';
  base-uri 'none'; form-action 'none'; frame-ancestors http://127.0.0.1:<dshWebPort> http://127.0.0.1:<res>
```

> 与 M0 `resources.md` §3 的差异：`frame-ancestors` 由「精确 DSH origin + resourceOrigin」（P0 修复后）取代 M0 的 loopback 通配回退；工作树以 `plugin.js` 的 `webServer.getOrigin()` 接线实现。**两层都实测为精确值、不含 `*`。**

### 5.4 子资源

```http
Content-Type: <exact MIME>; charset=utf-8 (文本)
Access-Control-Allow-Origin: *; X-Content-Type-Options: nosniff
Cache-Control: no-store; Referrer-Policy: no-referrer; Content-Length: <bytes>
```
无 `Set-Cookie`、无 `Access-Control-Allow-Credentials`、无重复 CSP、无 302。实测 MIME：`text/html; charset=utf-8`、`text/javascript; charset=utf-8`（.js/.mjs）、`text/css; charset=utf-8`、`application/json; charset=utf-8`、`image/png`、`audio/wav`。

## 6. §7.5.1 落地理由：祖先链与 opaque origin（含 A/B 对照与 chrome-error 教训）

这是 M1 期间最有价值的两组反证，直接决定 wrapper 形态：

**实验 A（外层 wrapper iframe 带 `sandbox="allow-scripts"`，即旧 Runtime 行为）**
- wrapper 文档加载 200，但 wrapper 内 `window.origin === "null"`（沙箱使 wrapper 成为 opaque origin）；
- 内层游戏文档请求本身返回 200，但 Chrome **拒绝渲染**：
  `Framing 'http://127.0.0.1:<res>/' violates the following Content Security Policy directive: "frame-ancestors http://127.0.0.1:* http://localhost:* http://127.0.0.1:<res>". The request has been blocked.`
- 游戏 target 变为 `chrome-error://chromewebdata/`，游戏资源（CSS/JS/图/JSON/音频）一个都没加载。
- 原因：`frame-ancestors` 按**每个祖先文档的 origin** 匹配；wrapper 被 sandbox 后是 opaque origin，任何 host-source（包括显式列出的 resourceOrigin）都匹配不上，故必然被拒。

**实验 B（只去掉外层 sandbox，wrapper 字节/CSP 不变）**
- 同一 launch：wrapper 以真实 resource origin 运行；游戏文档正常渲染（`title/body`、CSS/JS 资源 200），无 CSP 违规日志。
- 结论：原因可归因到「外层 sandbox → opaque 祖先」，与 wrapper 文档/CSP/资源服务无关。

**由此冻结（已落地并被本报告重验）**：外层 wrapper iframe **不 sandbox**（平台受信静态文档、无游戏字节、CSP nonce + `frame-src` 限定），内层 **game iframe 保持 `sandbox="allow-scripts"`（无 allow-same-origin）**；两份文档 CSP `frame-ancestors` 均用**精确 origin**。游戏文档始终是 opaque origin，A06 的「不可信/不可读 Host API/不可外发」结论不受影响。

**`chrome-error` 教训（写进探针纪律）**：仅断言 HTTP 200 会把「frame 被 CSP/释放凭证打成 chrome-error」假通过。本套件所有「加载成功」都必须以**帧内真实 DOM/JS 状态**（`document.title`/关键 DOM/`window.__M1_GAME__`）+ CDP 网络 200 + 零 CSP 违规三者同时成立为准；A02/A06 都包含该断言。

**第三个 P0（about:blank 初始 load）**：P0-1 修复后暴露了另一条「200 但 chrome-error」链——旧 `createIframe()` 在插入 DOM 前没有 src，Chrome 触发初始 `about:blank` load，命中 Runtime 的「非我方导航」纵深防御 → `revokeCapabilities(GM-5013)` → `/runtime-release` **释放实例** → 内层入口文档请求变 **403**。证据见 `raw/m1/blocker-about-blank-load-*.json`（trace/事件/release 调用/403 链）；已由 runtime-client 以「插入前写 src + 忽略无 src/初始 load + 插入前 arm expectedFrameLoads」根治，本报告 42+43 项在其后全部通过。**纵深防御本身保留**：A06 里游戏自导航到同源第二页后 `GM-5012` 心跳失联撤销仍实测到。

## 7. 归因表终版（每条历史 failed 的类别与最终状态）

| 项（历史失败/疑点） | 归因类别 | 根因/证据 | 处理 | 最终状态 |
|---|---|---|---|---|
| wrapper 内嵌被 `frame-ancestors` 拦（A 用例，200→chrome-error） | **product-defect（P0-1）** | 外层 wrapper iframe 被 sandbox → opaque 祖先无法匹配 host-source；`raw/m1/blocker-wrapper-frame-ancestors-*.json` | runtime-client 改为 wrapper 层不 sandbox、html-v1 不变 | ✅ 修复后 A02/A06 通过 |
| 入口文档 403（200-wrapper 但 game chrome-error，实例被释放） | **product-defect（P0-2）** | 初始 `about:blank` load 触发 `GM-5013` → `releaseRuntime` → 403；`raw/m1/blocker-about-blank-load-*.json` | runtime-client 根治（src 先于插入、忽略无 src/初始 load、arm 计数） | ✅ 修复后通过 |
| wrapper CSP `frame-ancestors` 回退通配 `http://127.0.0.1:*` | **product-defect（P0-3，composition wiring）** | `plugin.js` 未把 `webServer.getOrigin()` 传给 `createHost({http:{dshWebOrigin}})`；`raw/m1/blocker-wrapper-frame-ancestors-wildcard-*.json` | Lead 在 `plugin.js` 接线 `resolveDshWebOrigin`（reflect/get('webServer').getOrigin） | ✅ 精确 origin、无 `*` |
| `wrapper-layer-…: null` / wrapper 取不到 | **probe-harness-artifact** | P0-1 修复后 wrapper 不再是 OOPIF（same-site 不同 port 同进程），探针按 OOPIF 找 session | 探针改为 `Page.getFrameTree` + `Page.createIsolatedWorld` 在 wrapper frame 内取 DOM | ✅ 已修 |
| `game-sdk-*` = `GM-5003 "not running inside a sandbox iframe"` | **product-defect 连锁** | 入口文档 403 未执行 → SDK 在错误文档里跑 | 随 P0-2 修复消失，不是独立 SDK 回归 | ✅ 重验通过 |
| `descriptor-and-game-json-not-served` 期望 404 实际 403 | **contract-expectation-mismatch** | 契约 §7.3：保留名/不在清单 → `GM-4039`(403)，404 仅用于清单内缺文件 | 断言改为 403（未改实现） | ✅ 按契约通过 |
| `egress-network-layer-saw-zero-external-requests` | **probe-harness-artifact（口径）** | XHR 被 CSP 拦时 CDP 会先发 `requestWillBeSent` 再 `blockedReason=csp`；sink 仍 0 | 断言改为「sink 0 + 无出网事件」，保留原始数组 | ✅ 通过 |
| `egress-top-navigation-did-not-change-page` | **probe-harness-artifact** | 拿带 token 的 host.url 全串比较（token 已被消费） | 比较 origin+pathname | ✅ 通过 |
| `egress-entry-launch-replay-is-410` 缺字段 | **probe-harness-artifact** | 初始 snapshot 在 phase1 完成前采集（stale） | phase1-complete 后重读最终 `__M1_EVIL__` | ✅ 通过 |
| `bridge-untrusted-window-spoof-rejected-and-counted` 查不到 fatal | **probe-harness-artifact** | 断言读 `event.code` 而非 `event.error.code` | 修断言；并观测 state=error+frames 移除 | ✅ 通过（GM-5004） |
| `navigation-document-still-alive-after-blocked-navigation` | **probe-harness-artifact** | Chrome 对被 frame-src 阻断的导航可能替换文档；安全要求是零请求 | 改为记录观测 + 必须断言 attempt/sink0/frame-src 违规 | ✅ 通过 |
| `no-frame-ancestors-framing-violations` 误报 | **probe-harness-artifact** | 正则把预期中的 `frame-src` 阻断日志当成 frame-ancestors 违规 | 拆分 frame-ancestors（必须 0）与 frame-src（预期 1） | ✅ 通过 |
| A06 安装 422 `forbidden construct: window-open` | **probe-harness-artifact（测试包构造）** | 包校验静态扫描禁止字面量 `window.open(`（契约 §4.7 明言是纵深防御、不是安全证明） | 恶意包用动态引用调用（`window['op'+'en']`）表达运行期作恶；静态扫描非安全边界本身也是可报告发现 | ✅ 安装通过；该发现见 §8 |
| 心跳撤销检测未触发（超时期望过短） | **probe-harness-artifact** | 3 次 ping miss 需 ~20s | 等待 28s 后观测到 `GM-5012` | ✅ 非必须断言通过 |

**没有任何一条通过放宽安全断言或修改 `packages/**` 变绿**；所有 product-defect 均由对应 owner 修复后重验。

## 8. 发现（非阻塞，供 M2/M4/上游参考）

1. **静态扫描可被动态引用绕过**（`window.open` 字面量被 zip 校验拒绝，但 `window['op'+'en']` 可以安装）：与契约 §4.7「静态扫描是纵深防御、不是安全证明」一致；运行时边界（sandbox 无 `allow-popups` + CSP）才是真正阻断，A06 已实证。
2. **`frame-src` 阻断自导航可能终止游戏文档**：安全上等价（无外发），但 Runtime 的 `GM-5012` 心跳检测是必要的状态收敛；A06 实测 28s 内触发撤销。
3. **wrapper/入口 `frame-ancestors` 的精确 origin 依赖宿主 `webServer.getOrigin()`**：非 web 宿主（纯 CLI/TUI、未绑定端口）仍会回退到配置 allowlist；这是 compose 级契约差异，M2 如有非 web 形态需复核（见 §7 未验证）。
4. **A06 危险桥方法返回 `GM-4004`（未知方法）**：与契约「桥消息里不存在这些方法」一致；M1 桥表应保持冻结，新增方法必须走契约变更。

## 9. 未验证项（如实保留，不写成通过）

| 项 | 状态 | 说明 |
|---|---|---|
| 打包后的 **Client UI 路径**（点 Market 卡片 → 真实 Client bundle 创建 Runtime） | **未验证** | 本报告用生产 `packages/runtime/src` controller + 真实 SDK 在真实 DSH 页面驱动（Lead 2026-10-20 接受该级别）。未自动化点击打包 UI（Market 面板需会话 UI 交互；`README` 未要求） |
| 真实 DSH **Desktop Electron 窗口** | **未验证** | 使用安装版同一套包的 `dsh web` 隔离宿主（与 M0/M3 方法一致），未替换用户 App 窗口 |
| 非 Chromium 引擎（Safari/WebKit/Firefox） | **未验证** | opaque origin + CSP `frame-ancestors`/`frame-src` 行为仅 Chromium 155 实测 |
| `@font-face` 经资源 origin 加载 | **未验证** | 见契约 §7.7；本套件未放入可再分发字体 fixture |
| 多窗口并发 `renew`/`release` | **未验证** | 单实例顺序；A06 的两次实例是顺序执行 |
| WebSocket/beacon 的**真实服务端握手** | **未验证（设计上不可能）** | CSP `connect-src` 在渲染进程内提前阻断，网络层不可达；我们证明的是「零请求到达 sink」，这是更强的安全边界 |
| 物理断网（本机断网/断 Wi-Fi） | **未验证** | 「断网」按任务口径 = 阻断所有非 resourceOrigin 请求 + CDP offline 模拟；loopback 资源 origin 是设计内本地依赖 |
| `html-v1` 旧游戏回归（A01） | 不在本任务范围 | 本次 A06 恶意面仅 `asset-zip-v2`；html-v1 仍单层 sandbox（Runtime 代码保留原路径） |
| 包内联 `<script>/<style>` | **不适用** | `asset-zip-v2` 契约禁止内联（GM-4283），未测允许路径 |
| Client UI 内真实键盘/鼠标玩法（暂停/存档/继续） | 由 A01/M2 覆盖 | 本套件聚焦 A02/A06 |

## 10. 复现与维护

- 探针入口：`scripts/verification/v1.5/m1/m1-a02-multiresource.mjs`、`m1-a06-boundaries.mjs`；共享设施：`scripts/verification/v1.5/m1/lib/lab.mjs`（隔离宿主、递归 CDP、静态 repo origin、sink origin、真包构造、Runtime lab、证据写出）。
- 测试包在脚本运行期由 `tests/helpers/zip-package.mjs` + `scripts/bundle-lib.mjs`（真实 SDK）确定性构造（PNG/WAV 复用 M0 fixture 资产），**不提交生成 ZIP**；恶意包同样通过真实安装校验。
- 端口（避免与其它探针冲突）：A02 bootstrap/host/static/sink/chrome = 58280/58281/58331/58332/9506；A06 = 58290/58291/58341/58342/9507。ZIP 安装、launch 均为页面内已认证同源请求。
- 每次运行都会新建 `/tmp/dsh-v15/home-probe-m1-*`，退出时（默认）清理；`--keep` 保留现场。
- 生成证据：`docs/verification/v1.5/raw/m1/<id>-<timestamp>.json`（顶层含 `passed/failed/required`）、`raw/m1/screenshots/*.png`；本报告引用：
  - A02：`M1-A02-multiresource-2026-10-20T04-44-56-876Z.json` + `screenshots/a02-dsh-page-full.png`、`screenshots/a02-runtime-iframe.png`；
  - A06：`M1-A06-boundaries-2026-10-20T04-51-00-544Z.json` + `screenshots/a06-game-rendered.png`、`a06-game-rendered-full.png`、`a06-dsh-page-full.png`；
  - 三个 P0 历史证据（保留 A/B 对照与 chrome-error/403 现象）：`blocker-wrapper-frame-ancestors-*.json`、`blocker-about-blank-load-*.json`、`blocker-wrapper-frame-ancestors-wildcard-*.json`。
- 证据脱敏：`<resourceToken>`/launch nonce/instanceId 以 `<credential>`/`<instance>`/`<token>`/`<launch-nonce>` 替换；`/Users/<real>` 归一为 `/Users/<user>`；`grep` 复核 32-hex/长 base64/`launch=` 明文 = 0。
- 源码摘要（本次证据对应的稳定基线，供回归比对）：`client.js 9c773bc72c2c68bcfcd23c96ae5b54eee1134be378ffbbde06a02d6f478404b6`、`packages/host/src/plugin.js 72b4d0bcf0c9d8856a0da2b7fc5ba7c755496f9c478ab70a41135d09ea420dcd`、`resources.js 720bc310cc4952968937a779ce8ddb0ce5d7cbba406fe987dddaadf8756880d2`、`entry.js d8fedc853036f84ce2d877564f983f8b3233bbc89016b244c0d5aa578a595f59`、`controller.js 2f7ac905ce9bcc6c86e6030c138ab0047e03e94ec986927999d7751e12a5f9b5`、`index.js 3be5152f02aaafb7a072ccb5a3cae2782470e09cf49b5857d1b8786648b684a5`。

## 11. CR7 复核补充（Codex review of head `77c8d0a`；CR7-01 / CR7-03）

Codex 复核认可 M1 方向（两层 iframe、点对点 relay、祖先链 origin 补全），但指出原 A02/A06 探针未覆盖两个缺口。本小节补**真实浏览器 A/B 证据**：每条缺口都先在同 head 快照（修复前）跑出失败证据，再在修复后工作区跑通；证据文件名带 `-prefix-` 的是**修复前**，不带的是**修复后**。

- 修复后基线：工作树 HEAD `77c8d0a` + CR7 修复未提交改动；`client.js` sha256 `ab54b8eaa421fa10196eb85454f1836fda47b9a5c23fa4a57f57868c9a4c2641`（重建产物）；`packages/host/src/resources.js` `6b6b04bf…`；`packages/client/src/components/panel.js` `aa0461ff…`；`actions.js` `3c110c90…`；`local-install.js` `929c74b5…`；`api-v1.js` `9413c073…`。
- 修复前快照：`git archive 77c8d0a` 解到 `/tmp/m1b-prefix-77c8d0a`（只读快照 + 指向工作树 `node_modules` 的符号链接），探针以 `--plugin-root=/tmp/m1b-prefix-77c8d0a --label=prefix` 运行。两个探针的**断言集完全相同**，A/B 只差被测代码。
- 探针纪律：不修改 `packages/**`、不 commit；文件选择器用 CDP 协议事件 + `DOM.setFileInputFiles`（Lead 批准的自动化方式，不是直接调 API 冒充点击）；安装请求只可能来自真实 Client UI，探针仅在安装完成后做只读 `GET /installed`、`GET /game` 观测。

### 11.1 CR7-01（P1）：同源第二 HTML 文档没有 CSP → 新文档可外发

**缺口（修复前实测）**：ZIP 入口 `index.html` 导航到同源 `second.html`（wrapper `frame-src` 允许该导航），旧实现只在**入口文档**回 CSP；`second.html` 作为新文档无策略，其 `fetch`/`Image`/`WebSocket` 直接出网。

**探针** `m1-a06b-same-origin-html.mjs`：真实 ZIP（入口 `index.html` + 同源 `second.html` + ESM 脚本 + JSON + CSS）经真实 Host API 安装 → 真实 `/launch` → 生产 RuntimeController + platform wrapper 加载；入口先验同源 `fetch('./data/x.json')=200`，再自导航到 `second.html`，第二页尝试 `fetch(sink)`、`new Image().src=sink`、`new WebSocket(ws://sink)`、`window.open(sink)`；外部 `sink` origin 独立记录 **HTTP 请求 + WS upgrade**（网络层见证，不只看 console）；用 Node 直接 `GET second.html`（资源凭证 URL）读响应头 CSP 逐指令。

| 断言 | 修复前（`-prefix-`，13/21） | 修复后（21/21） |
|---|---|---|
| `second.html` 响应头 asset CSP | **缺失**（`secondCsp=null`） | 完整策略，13 条逐指令与入口一致，0 mismatch |
| `frame-ancestors` | 无 | `http://127.0.0.1:<dshPort> http://127.0.0.1:<resOrigin>`，无 `*` |
| 第二页真的运行（title/DOM/JS） | ✅ 正常（`M1 CR7 Second Document`、`#second-hud`、marker、`origin="null"`） | ✅ 同样正常 |
| **sink HTTP 请求** | **收到 2 条**：`GET /cr7-01/fetch`、`GET /cr7-01/image.png` | **0** |
| **sink WS upgrade** | **1 条**：`/cr7-01/ws` | **0** |
| CDP 网络层外部请求 | Image 实际 200（`sentExternal=1`） | 0 条 sent；仅 1 条 `blockedReason=csp` 事件（CSP 在渲染进程内拦截） |
| Chrome CSP 违规日志（成因证据） | 0 条 | **3 条**：`Connecting to '…/cr7-01/fetch' violates … connect-src`、`Connecting to 'ws://…' violates … connect-src`、`Loading the image '…/cr7-01/image.png' violates … img-src` |
| 第二页外发结果 | fetch 因 CORS 拒绝、Image **加载成功**、WS **打开** | fetch 被 CSP 拒绝、Image 不加载、WS 不打开 |
| 对照：入口同源 `fetch('./data/x.json')` | **200** | **200**（策略不误杀同源读取） |
| `window.open` | 被 sandbox 拦（对照组，前后一致） | 被 sandbox 拦 |

证据：`raw/m1/CR7-01-same-origin-html-prefix-2026-10-20T05-11-39-097Z.json`（修复前，8 条 required 失败：CSP 缺失/无 frame-ancestors/sink 有请求/WS upgrade/CSP 违规缺失）、`raw/m1/CR7-01-same-origin-html-2026-10-20T05-25-33-319Z.json`（修复后 21/21）、截图 `screenshots/cr7-01-same-origin-html*.png`。

结论：缺口真实、修复有效，且**同源子资源读取不回归**；第二页作为 sandboxed opaque-origin 文档仍可运行，但被 asset CSP 限制在 resource origin 内。

### 11.2 CR7-03（P2）：真实 Market UI 点击安装本地 `.dshgame.zip`（逐字节一致）

**缺口（修复前实测）**：Market 面板文件选择器 `accept=".html,text/html"`、`handleFileSelected` 只接受 HTML，ZIP 被拒并弹「这个文件不是受支持的 .html 游戏包」；即使强行进入安装，`api-v1.installLocal` 用 `File.text()` 读取 → ZIP 被 UTF-8 解码损坏（Codex 实测 2384 B → 2474 B），Host 拒绝。本探针把「真实点击路径」作为必测项：**禁止直调 API 冒充**。

**探针** `m1-a06c-market-ui-local-zip.mjs`（真实 `client.js` bundle，隔离 `dsh web` + 真实 Chrome/CDP）：
1. 关闭启动期「预览版说明」/「添加 API Key」浮层（真实点击）；
2. 点击侧栏「游戏市场」→ 真实 Client 面板 `.dgm-root[data-page=market]`；
3. 点击插件自己的「上传游戏」按钮 → 开启 `Page.setInterceptFileChooserDialog`，等 `Page.fileChooserOpened` → `DOM.setFileInputFiles` 选真实磁盘文件（`m1-cr7-local-zip-1.0.0.dshgame.zip`，102 997 B；文件名遵循 `<id>-<version>.dshgame.zip`）；
4. 断言二次确认对话框（文件名 / 文件大小 101 KB / 包格式「资源包（.dshgame.zip）」/ 本地安装警告 / 「安装」按钮），点击「安装」；
5. 断言 **UI 自己**发出 `POST /api/game-market/install-local`，`content-type: application/zip`，HTTP 200；**用 CDP `Network.postDataEntries`（base64 原始 body）计算 sha256 与源 ZIP 逐字节比较**（`c07a9f8c0a…`，102 997 B，完全一致），并与 Host 记录的 `installation.sha256`、`sizeBytes=102997` 三方一致；
6. 断言 UI 成功 toast（「《M1 Multi-Resource Probe》已从本地安装」）、「我的游戏」出现该游戏、`GET /installed` 含该 id、`GET /game?id=` 的 `installed.format=asset-zip-v2` 且 sha256 一致；
7. 再次选择同一 ZIP → 断言覆盖提示（「将覆盖《M1 Multi-Resource Probe》当前安装的 1.0.0…」）→ 点「取消」不产生第二次安装；
8. **回归对照**：同流程上传真实 `html-v1` 单文件（内置 Breakout 内容 + 改 manifest id/name，182 561 B）→ 二次确认 → 安装成功（`format=html-v1`、`content-type: text/html`、CDP 原始 body sha256 与源一致、`sizeBytes=182561`）。

**三态 A/B**（同一脚本、同一断言集；中间态=「二进制上传已接上但 `dialog.format` 未转发」的初版修复）：

| 断言 | 修复前 head `77c8d0a`（15/36） | 中间修复态（23/36） | 修复后（36/36） |
|---|---|---|---|
| picker accept | `.html,text/html`（**无 ZIP**） | 含 `.dshgame.zip` | 含 `.html` + `.dshgame.zip` |
| 选 ZIP 后 | 拒绝 toast「这个文件不是受支持的 .html 游戏包」，**无对话框** | 二次确认正常（文件名/101 KB/资源包格式/警告） | 同左 |
| 安装请求 | **无请求** | `POST install-local` → **415 `GM-4150`** | `POST install-local` → **200** |
| `content-type` | — | **`text/html; charset=utf-8`**（ZIP 被当文本） | **`application/zip`** |
| CDP 原始 body 字节 / sha256 | — | **106 118 B**（文本化膨胀），sha256 ≠ 源 | **102 997 B**，sha256 **=== 源 ZIP sha256**（`c07a9f8c0a…`） |
| Host 记录 | — | 无（415） | `format=asset-zip-v2`、`sizeBytes=102997`、`sha256=源` |
| UI 成功/列表 | — | 失败 toast，无游戏 | 成功 toast + 「我的游戏」可见 + `/installed` 含该 id |
| 覆盖提示 | — | 无（未安装成功） | 「将覆盖…当前安装的 1.0.0…」；取消后无第二次安装 |
| html-v1 回归对照 | 旧版 HTML 本地安装可用（对照本身不是缺口） | ✅ 通过 | ✅ 通过（200 / `text/html` / `format=html-v1` / body sha256=源） |
| 直调 API 冒充 | — | — | 无（`probeInitiatedInstallApiCalls=0`；POST 均为 UI 发起） |

**探针发现并上报的 latent product-defect（CR7-03 修复的后续缺口）**：初版修复在 `api-v1.js` 接了二进制上传，但 `panel.js confirmDialogAction()` 调 `installLocalGame()` 时**没有转发 `dialog.format`**，`actions.js` 又硬编码 `html-v1` 缺省 → ZIP 被按 `text/html` 上传 → Host 返回 **415 `GM-4150` "ZIP packages must use application/zip"**，且 CDP 原始 body 106 118 B（文本化膨胀）。已按最小复现报 Lead；最终修复由 runtime-client 用 `localInstallOptionsFromDialog(dialog)` 统一转发（`file/format/bytes/fileName`），`actions.js` 再按文件名 `detectLocalInstallFormat` 兜底，`client.js` 重建（sha256 `ab54b8ea…`）。

> 中间态证据说明：发现该 415 缺陷的原始运行发生在「初版修复尚未完成」的工作树上；为让评审可复核，现用**带标签的中间态快照**（= 最终工作树 + 仅回退 `panel.js` 的 format 转发与 `actions.js` 的 filename 兜底，其余修复保留；`client.js` 用仓库构建脚本重建）复现同一现象并留证 `CR7-03-...-fix1-415-...json`。三份证据的断言集完全相同，仅被测代码状态不同。

证据：`raw/m1/CR7-03-market-ui-local-zip-2026-10-20T05-28-04-816Z.json`（修复后 36/36，含 dialog 文本/meta、POST 请求头、原始 body sha256、200 响应、`/installed`/`/game` 记录、UI 截图）、`raw/m1/CR7-03-market-ui-local-zip-prefix-2026-10-20T05-30-49-407Z.json`（修复前 15/36：picker 拒绝 toast、无请求）、`raw/m1/CR7-03-market-ui-local-zip-fix1-415-2026-10-20T05-29-57-771Z.json`（中间态 23/36：415 + text/html + 原始 body 106118 B），截图 `screenshots/cr7-03-market-ui-local-zip*.png`。

**`/installed` 口径说明**：实测 `GET /api/game-market/installed` 的 item 不含 `format` 字段（与 `/games` 的 summary 同构）；`format=asset-zip-v2` 出现在 **install 响应 `installation.format`** 与 **`GET /api/game-market/game?id=<id>` 的 `installed.format`**。探针对「`/installed` 出现该游戏」+「installed record format=asset-zip-v2」两条分别断言，未把不存在字段写成通过。

### 11.3 CR7 复核补充的命令与 exit code

```bash
# 修复后（当前工作区；client.js 重建后）
node scripts/verification/v1.5/m1/m1-a06b-same-origin-html.mjs
# exit 0 — PASSED (21/21 required)

node scripts/verification/v1.5/m1/m1-a06c-market-ui-local-zip.mjs
# exit 0 — PASSED (36/36 required)

# 修复前（head 77c8d0a 只读快照，留存 A/B 的「before」证据）
git archive 77c8d0a | tar -x -C /tmp/m1b-prefix-77c8d0a   # + node_modules 符号链接
node scripts/verification/v1.5/m1/m1-a06b-same-origin-html.mjs --plugin-root=/tmp/m1b-prefix-77c8d0a --label=prefix
# exit 1 — FAILED (13/21 required)：second.html 无 CSP，sink 收到 fetch/image + WS upgrade
node scripts/verification/v1.5/m1/m1-a06c-market-ui-local-zip.mjs --plugin-root=/tmp/m1b-prefix-77c8d0a --label=prefix
# exit 1 — FAILED (15/36 required)：picker 拒 ZIP，无确认对话框/无安装请求
node scripts/verification/v1.5/m1/m1-a06c-market-ui-local-zip.mjs --plugin-root=/tmp/m1b-fix1-415 --label=fix1-415
# exit 1 — FAILED (23/36 required)：UI 发出 415（text/html 上传，原始 body 106118 B）
```

### 11.4 CR7 未验证项（如实）

- **原生文件选择器 UI 的可视化**：headless 下用 CDP `Page.setInterceptFileChooserDialog` 捕获真实的 `fileChooserOpened` 事件并 `DOM.setFileInputFiles` 注入（Lead 批准的自动化方式）；未截取 macOS 原生文件选择器窗口（headless 不渲染系统对话框），但访问路径是真实点击 → 真实 chooser 事件 → 真实 `<input type=file>` change。
- **真实 Electron 桌面窗口**：仍使用隔离 `dsh web` 宿主（与全报告一致）；未驱动用户 App 窗口。
- **多文件/超大文件/恶意 ZIP 选择器边界**：由 Host/安装校验用例覆盖，不在本点击路径探针重复。
- **非 Chromium 引擎**：同上文 §9。
- 本小节两项的 A/B 证据均来自**真实浏览器 + 真实打包 Client bundle + 真实 Host**；探针脚本、原始 JSON 与截图均在 `scripts/verification/v1.5/m1/`、`docs/verification/v1.5/raw/m1/` 内，可复跑。
