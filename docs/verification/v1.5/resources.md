# M0 · S-A1：opaque-origin sandbox 多文件资源加载与安全隔离探针

日期：2026-10-19。分支 `feat/v1.5-m0`（worktree `/Users/<user>/…/v1.5-m0`，HEAD `689b5b9` + 本探针未提交文件）。对应开发指南 §3 探针表 S-A1、§4.2/§4.3，验收矩阵 A02/A05/A06 的 M0 前置证据。

**结论：S-A1 通过（82/82 必须检查项）。** 在真实安装的 DSH `0.2.1-rc.2` 隔离宿主 + 真实 headless Chrome 155 中，`sandbox="allow-scripts"`（opaque origin，无 `allow-same-origin`）的 iframe 可以真实加载独立 classic JS、ESM（静态 + 动态 import）、CSS、PNG、`fetch()` JSON、WAV 音频，并使用 canvas 读像素；M1 目标设计「实例绑定资源凭证（路径前缀，可重复 GET/HEAD）+ 一次性 launch 凭证 + 匿名 CORS + 显式资源 origin CSP」在浏览器中成立。opaque origin 下游戏既读不到也写不了 Host API，也读不到外网；`Origin: null` 的 Host 写请求被 DSH 平台 403 拒绝。**同时实证了一个关键 M1 约束：资源路由不能复用 DSH `/api` connection 路由**，因为该前缀的 Origin/sec-fetch-site 围栏会拒绝 opaque-origin iframe 的子资源请求；M1 需要独立资源 origin（本探针验证的形态）或 DSH 上游新增 `/api` 之外的公开 route seam。

> 区分：**平台现有能力** = 已安装 DSH 0.2.1-rc.2 的 web 宿主、本项目 V1.2.0 Host 插件（隔离 profile 注入）、DSH `/api` Origin/auth 围栏、生产 `/entry` 路由与生产 CSP builder、`packages/runtime/src/controller.js` 的 iframe 属性、真实浏览器。**M0 目标设计（M1 才实现）** = 探针脚本内的 M0 资源服务（`scripts/verification/v1.5/assets/lib/probe-service.mjs`，不接生产路由）：`/res/<instance>/<token>/<path>` 实例资源路由、一次性 launch 凭证、CORS/CSP 响应头。探针没有修改任何生产路由，也没有加 `allow-same-origin`。

## 1. 环境与命令

| 项 | 值 |
|---|---|
| 目标 DSH（只读 ASAR 解出） | `@deepseek-ai/dsh-desktop-runtime` **0.2.1-rc.2**（plugin-manager / electron app 同版本） |
| 隔离宿主 | `dsh web --no-open`，`DSH_HOME=/tmp/dsh-v15/home-probe-resources`，`127.0.0.1:58261`；真实 GUI 页面加载后同源 `GET /api/game-market/health` = 200，`version` 与 worktree `package.json`（1.2.0）一致 |
| 浏览器 | Google Chrome **155.0.8059.85** headless=new + CDP（OOPIF session 级 Network/Log/Runtime 采集） |
| Node | v24.14.0 |
| M0 资源服务（目标设计） | `127.0.0.1:58262`（`/res/...`，独立 origin）；第三方站点替身 `127.0.0.1:58263`（无 CORS 头） |
| 宿主 profile | 仅 `/tmp/dsh-v15/home-probe-resources`（`injectProbeRow` 指向本 worktree `index.js`，`devMode: true`）；**未读写 `~/.dsh/`，未修改 App** |
| 探针 fixture 包 | `scripts/verification/v1.5/assets/fixture-package/`（10 个文件，`dsh-package.json` 逐文件 size/sha256；PNG/WAV 由 `gen-fixtures.mjs` 确定性生成） |

### 1.1 命令与 exit code

```bash
cd "/Users/<user>/…/v1.5-m0"

# 0) 基线（全量，只跑一次）：build + check + test
node scripts/build.mjs && node scripts/check.mjs && node --test
# exit 0 — build 全部产物、check 38 项、测试 840 pass / 0 fail

# 1) fixture 确定性与清单校验（10 个文件的 size/sha256）
node scripts/verification/v1.5/assets/gen-fixtures.mjs --check
# exit 0

# 2) S-A1 探针（真实隔离宿主 + 真实浏览器；约 30s）
node scripts/verification/v1.5/assets/probe-resources.mjs
# exit 0 — S-A1 probe PASSED (82/82 required checks)

# 失败即非零：开发过程中自检失败时的同一命令（保留样本）
# S-A1 probe FAILED ... failed checks: ... → exit 1
```

stdout 原始日志：
- 最终通过运行：`docs/verification/v1.5/raw/resources/probe-stdout-final.log`（exit 0）
- 断言失败样本：`docs/verification/v1.5/raw/resources/probe-stdout-failed-sample.log`（exit 1；一次自检期望值写错时的真实失败运行，用于证明断言失败会非零退出，不代表最终产品结论）

探针退出码由 `createReport()` 的 required checks 决定：任一项失败 → `process.exitCode = 1`；异常 → 1。脚本内部还有两道硬前提：`dsh-package.json` 逐文件 sha/size 校验、`DSH_HOME` 必须位于 `/tmp/dsh-v15` 下。

### 1.2 原始证据文件

| 文件 | 内容 |
|---|---|
| `raw/resources/summary.json` | 全部检查项 + 5 个场景 + HTTP 矩阵 + Host 围栏矩阵 + 环境（脱敏后） |
| `raw/resources/browser-candidate.json` | 目标设计场景：逐资源 HTTP 状态/响应头、浏览器 Network/Log/console、DOM/JS 证据、CSP 违例 |
| `raw/resources/browser-legacyCsp.json` | 控制组：生产 V1.2 CSP 应用到多文件包 → 全部子资源被 CSP 拦截 |
| `raw/resources/browser-selfCsp.json` | 控制组：`'self'`-only CSP 的实测行为（见 §4） |
| `raw/resources/browser-noCsp.json` | 控制组：无 CSP（隔离 CORS 行为；展示 no-cors 外发通道） |
| `raw/resources/browser-platformEntry.json` | 平台现有能力：生产 `/entry` 单文件包 + 生产响应头 + `Origin: null` 围栏 |
| `raw/resources/http-credential-matrix.json` | 26 条直连 HTTP 用例（凭证/路径/TTL/release/HEAD/重复 GET） |
| `raw/resources/http-host-fence.json` | 7 条 Host API Origin/auth 围栏用例 |
| `raw/resources/probe-server-log.json` | M0 资源服务 88 条请求日志（token/launch 已脱敏） |
| `raw/resources/runtime-identity.json` / `platform-facts.json` | DSH 身份；`controller.js` iframe 属性核对 |
| `raw/resources/screenshots/*.png` | 10 张截图：DSH 页面、平台单文件包、candidate、legacy-csp、self-csp、no-csp（整页 + iframe 裁剪） |

脱敏核对：证据内无 token/cookie/launch 明文（`grep` 32-hex/长 base64/`launch=`/`token=` 均为 0 命中；仅保留测试用例里人为构造的 `bbbb…` 错误 token 路径）；绝对用户路径已替换为 `/Users/<user>`。

## 2. 结论表（探针项 / 必须证明什么 / 实际结果 / 证据 / 是否通过 / 未验证）

| # | 探针项 | 必须证明什么 | 实际结果（真实浏览器/真实宿主） | 证据 | 通过 | 未验证项 |
|---|---|---|---|---|---|---|
| S-A1-01 | sandbox 不变量 | iframe 仍 `sandbox="allow-scripts"`，无 `allow-same-origin` | `controller.js` 源码（去注释）只有 `sandbox='allow-scripts'`、`allow='autoplay'`、`referrerpolicy='no-referrer'`；探针 iframe 逐属性复刻；文档 `window.origin === "null"`，CORS 请求实际带 `Origin: null`、`sec-fetch-site: cross-site` | `platform-facts.json`、`browser-candidate.json`（`probe.documentOrigin`/`requestHeaders`） | ✅ | 未用真实 Runtime UI 点击驱动（探针在真实 DSH 页面内用同一属性建 iframe） |
| S-A1-02 | classic JS | 独立非 module JS 真实执行 | `scripts/bootstrap.js` 200；`window.__PROBE_CLASSIC__.ok = true`；无 console error | `browser-candidate.json`（`probe.classic`、`browser.network`） | ✅ | — |
| S-A1-03 | ESM import | 静态 import 与动态 `import()` 都 resolve | 静态 `./level-loader.mjs` → `MODULE_ID=level-loader@probe-1`；动态 `./powerup.mjs` → `POWERUP_ID=powerup@probe-1`；两者 200 + `text/javascript; charset=utf-8` | 同上（`probe.staticModule`/`probe.dynamicImport`） | ✅ | 包外 import / CDN import（应被 CSP 拒绝，不在 S-A1 范围） |
| S-A1-04 | CSS | 独立样式表生效（不是只看 200） | `document.styleSheets.length=1`；`body` 计算背景 `rgb(18, 24, 38)`、HUD `rgb(255, 196, 92)` 与 `game.css` 完全一致；CSS `url("../assets/ship.png")` 触发第 2 次图片请求；CSSOM `cssRules` 抛 `SecurityError`（opaque/cross-origin 的预期行为，不影响样式生效） | 同上（`probe.css`、`httpRequests`） | ✅ | 字体 `@font-face`（无可再分发字体 fixture，见 §6） |
| S-A1-05 | 图片 | 真实解码，且 CORS/非 CORS 差异可解释 | `<img crossorigin="anonymous">` 200、`naturalWidth/Height=64`、`decode()` resolve、canvas `getImageData` 可读（非透明像素 416）；普通 `<img>`（no-cors）同样 200/64，但 canvas 被 taint（`SecurityError`） | 同上（`probe.image`/`probe.imageNoCors`） | ✅ | — |
| S-A1-06 | fetch JSON | 动态关卡 JSON 用 `fetch` 解析，且同一资源可重复 GET | `levels/level-01.json` 两次请求均 200，解析出 `level-01 / goal 1200 / 5 个 obstacles`（`signature=level-01:5:1200`）；服务端日志两条 200 | 同上（`probe.levels`、`httpRequests`） | ✅ | — |
| S-A1-07 | HEAD | 子资源 HEAD 可重复 | `HEAD styles/game.css` = 200，`content-type: text/css; charset=utf-8`，无 body | `browser-candidate.json`、`http-credential-matrix.json` | ✅ | — |
| S-A1-08 | 音频 | 音频可加载、可解码、受手势门控 | `audio` 元素 200、`readyState=4`、`canplay`；`fetch` 3244B → `decodeAudioData` 得到 0.2s/1 声道；`play()` 在手势前 `NotAllowedError`，CDP 真实鼠标点击（trusted）后 `play()=ok`、`AudioContext state=running` | 同上（`probe.audio`/`probe.audioGesture`） | ✅ | 设计要求的「静音」UI 不在 S-A1（M2/M4） |
| S-A1-09 | entry 一次性凭证 | entry 凭证只消费一次 | 首次 `GET …/index.html?launch=<nonce>` = 200 且服务端记录 `launch-credential-consumed`；同一 URL 再次 GET = **410**；去掉 `launch` 用资源凭证 GET 同一入口文件 = **200**（reload/重复读所需） | `browser-candidate.json`、`http-credential-matrix.json` | ✅ | 资源凭证下 reload 的运行时策略待 M1 裁决（§5.3） |
| S-A1-10 | 子资源重复 GET | 同一有效资源可重复 GET/HEAD（不是一次性） | 每个 manifest 文件 ≥1 次 200；`level-01.json` 2×200；CSS background 图片 2×200；HEAD 200；矩阵中 `resource-repeat-get-1/2` 均 200 | `http-credential-matrix.json`（10 文件全读）、`browser-candidate.json` | ✅ | — |
| S-A1-11 | 凭证生命周期 | TTL 到期 / renew / release 生效 | 600ms TTL 实例过期后 → 403；`renew` 后越过原 TTL 仍 200；`release` 后 → 403；未知实例/错 token/跨实例 token → 403 | `http-credential-matrix.json` | ✅ | 多窗口并发 renew/release 竞争不在 S-A1 |
| S-A1-12 | 路径准入 | 只映射已校验清单；穿越/绝对路径/目录 listing 拒绝 | 26 条矩阵全通过：`%2e%2e%2f`、`..%2f`、`%252e…`、`..%5c`、`%2fetc%2fpasswd`、`%00`、未列清单文件、目录/裸目录 → 403/404；`GET /res/<inst>/index.html`（缺 token）→ 404；POST → 405；所有成功读取仅来自 `dsh-package.json` 清单内 10 个文件 | `http-credential-matrix.json` | ✅ | 归档层（ZIP）路径校验属 M1（不在 S-A1） |
| S-A1-13 | CORS 响应头 | opaque origin 的 CORS 模式请求可读（含 ESM/fetch），匿名 | 所有资源响应 `Access-Control-Allow-Origin: *`；模块脚本/fetch 请求实际携带 `Origin: null`；`fetch` 能读到 JSON 内容；无 `Access-Control-Allow-Credentials`；无 `Set-Cookie` | `browser-candidate.json`、`http-credential-matrix.json` | ✅ | 带 credentials 的跨域请求不被支持（设计如此） |
| S-A1-14 | 候选 CSP | 显式资源 origin 的 CSP 下多文件包真实可用 | 入口文档 CSP（仅文档，见 §3）为 `default-src 'none'; script-src <resOrigin>; …; connect-src <resOrigin>; …; frame-ancestors <DSH origin>`；全部资源正常加载，7 条对 Host API/外网/第三方 origin 的 CSP 违例被 `securitypolicyviolation` + Chrome Log 捕获（均为预期拒绝）；页面 console error 0（仅 `ASSETS_PROBE_DONE` 一条 log）、`probe.steps` 失败 0；Chrome Log 中的 CSP/410 拒绝均为预期用例 | `browser-candidate.json`（`probe.cspViolations`、`browser.logEntries`） | ✅ | 浏览器差异（仅 Chrome 155 实测） |
| S-A1-15 | 生产 CSP 对照 | 现有 V1.2 CSP 不能服务多文件包（证明 M1 必须改 CSP） | 用**生产 `buildContentSecurityPolicy()` 原样输出**做响应头：classic/module 脚本、CSS、图片、音频全部被 CSP 拦截；`body` 背景保持透明；`window.__PROBE_CLASSIC__`/`__ASSETS_PROBE__` 均不存在；Chrome Log 出现 6 条 CSP 违例（stylesheet/classic/module/2×image/media）；网络只命中入口文档 | `browser-legacyCsp.json`、`screenshot dh-02-legacy-csp-*` | ✅ | — |
| S-A1-16 | 无 CSP 对照（隔离 CORS） | CSP 之外，CORS 头行为独立成立 | 去掉 CSP 后资源同样全部加载（证明 CORS 头独立有效）；`fetch` Host API → `TypeError`；`fetch https://example.com/` → `net::ERR_FAILED`（CORS 拒绝读）；`fetch` 第三方 `evil.json` → `net::ERR_FAILED`；Host API 响应对浏览器无 ACAO | `browser-noCsp.json`（`browser.network`） | ✅ | 外网可达性在本机环境下为「可发出请求、不可读」，见 §4 |
| S-A1-17 | no-cors 外发通道 | 仅靠 CORS 无法阻止数据外发 → CSP 是必需边界 | 无 CSP 时：no-cors `<img>` 到第三方 origin **真实发出并加载**（第三方日志记录）；no-cors `POST /sink` 携带 body **真实送达**第三方（日志 `probe-no-cors-side-channel`）；同样请求在候选 CSP 下全部被拦截（`img-src`/`connect-src` 违例） | `browser-noCsp.json`（`no-csp.third-party-log`）、`browser-candidate.json` | ✅ | WebSocket/beacon/worker 等其它外发向量未逐一测（M1 需 CSP `worker-src 'none'` 等兜底） |
| S-A1-18 | 游戏读 Host API | opaque origin 读不到 Host API | 候选 CSP：网络请求未发出（CSP 拦截）；无 CSP：`fetch` → `TypeError`，浏览器 Network 记录 `net::ERR_FAILED`；no-cors `<img src=/api/game-market/health>` 被 **DSH 平台围栏 403**；console 有 CORS 错误 | `browser-candidate.json`、`browser-noCsp.json`、`http-host-fence.json` | ✅ | — |
| S-A1-19 | 游戏写 Host API | opaque origin 写请求被拒 | 浏览器内 `POST /api/game-market/preferences`：候选 CSP 直接拦截；无 CSP 时预检 `OPTIONS` 被平台 403、`fetch` `TypeError`；**直连对照**：带合法浏览器 auth cookie + `Origin: null` 的 POST = **403**，同请求改成 DSH origin = 200（证明拒绝原因是 Origin，而非未认证） | `browser-noCsp.json`、`http-host-fence.json` | ✅ | — |
| S-A1-20 | 不能 fetch 外网 | 外网不可读（且不可外发，见 S-A1-17） | 候选 CSP：`connect-src` 拦截 `https://example.com/`；无 CSP：请求可达但 CORS 拒绝读（`net::ERR_FAILED`） | 同上 | ✅ | 本机有透明代理，Chrome 侧「请求已发出但读不到」的结果已如实记录 |
| S-A1-21 | Host 围栏（直连） | `Origin: null` 与不可信 Origin 的 Host 请求被拒；认证另需 | 7 条全通过：同源 Origin+cookie GET=200；无 Origin+cookie GET=200（平台围栏只校验 Origin 存在时的一致性）；Origin:null+cookie GET/POST=**403**；`http://evil.example`+cookie=**403**；同源 Origin 无 cookie=**401**；同源 Origin+cookie 写=200（隔离环境内 preferences） | `http-host-fence.json` | ✅ | — |
| S-A1-22 | 平台现有能力 | 现有单文件 HTML 包仍可运行，且其 `/entry` 不能当资源 origin | 真实 Host `/api/game-market/launch` 200 → `/entry` 200（生产头：`text/html`、生产 CSP、`cache-control: no-store`、`nosniff`、`no-referrer`、`x-entry-sha256`）；沙箱 iframe 内 Snake 真实渲染（`PerformanceNavigationTiming.responseStatus=200`，DOM/样式生效）；同 URL 重复 GET=200（现平台 entry 是 TTL 绑定、非真正一次性）；**同一 entry URL 带 `Origin: null` = 403**，且 `/entry` 响应无 ACAO → 不能作为 opaque-origin 子资源 origin | `browser-platformEntry.json`、`screenshot dh-01-platform-entry-single-file.png` | ✅ | 真实 Desktop Electron 窗口未替换，见 §6 |
| S-A1-23 | `'self'` CSP 语义 | 判断 M1 能否用 `'self'` 代替显式 origin | 实测 Chromium 155：sandboxed opaque-origin 文档中 `'self'` 按**入口 URL origin** 解析，同 URL origin 的 script/style/img/media 全部放行；跨 origin 的 `connect-src 'self'` 仍拦截 Host API/外网。结论：**可作为实测事实记录，但 M1 不应依赖该语义**（opaque origin 的 `'self'` 行为属实现细节；跨浏览器未验证；资源 origin 一旦与入口 origin 不同即静默失效） | `browser-selfCsp.json` | ✅（实测）/ ⚠️ 不采纳为设计 | 其他浏览器引擎未测 |

## 3. 给 M1 资源服务的确切响应头清单

以下为 candidate 场景实测通过的响应头（`browser-candidate.json` / `http-credential-matrix.json` 有逐资源记录）。`<resourceOrigin>` = M1 资源服务的独立 origin，如 `http://127.0.0.1:<port>`；`<dshWebOrigin>` = 当前 DSH web 宿主 origin。

### 3.1 入口文档（`GET/HEAD /res/<instanceId>/<resourceToken>/<entry>`，首个请求可带 `?launch=<one-shot-nonce>`）

```http
Content-Type: text/html; charset=utf-8
Content-Length: <bytes>
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD
X-Content-Type-Options: nosniff
Cache-Control: no-store
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'none'; script-src <resourceOrigin>; style-src <resourceOrigin>; img-src <resourceOrigin> data:; media-src <resourceOrigin>; font-src <resourceOrigin>; connect-src <resourceOrigin>; child-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors <dshWebOrigin>
```

要点：
- CSP **只在文档响应上发送**（浏览器忽略子资源上的 CSP）；必须使用**显式资源 origin**，不能用 `'self'`（§S-A1-23）；`frame-ancestors` 精确到 DSH web origin（不要 `*`）。
- 不要加 `'unsafe-inline'`/`'unsafe-eval'` 除非 M1 契约明确允许内联脚本（当前 10 文件 fixture 全外链即可，未验证内联决策）。
- 不要加 `Cross-Origin-Embedder-Policy`（会要求所有子资源 CORS/CORP）、不要设 `Cross-Origin-Resource-Policy: same-origin`（会破坏 no-cors 的 script/img/media 加载；实测这些资源在无 CORP 头下正常）、不要设 `X-Frame-Options: DENY`（应交给 CSP）。

### 3.2 子资源（`GET/HEAD /res/<instanceId>/<resourceToken>/<path>`）

```http
Content-Type: <exact MIME per extension>; charset=utf-8   # 文本类型
Content-Length: <bytes>
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD
X-Content-Type-Options: nosniff
Cache-Control: no-store
Referrer-Policy: no-referrer
```

实测 MIME 映射（`nosniff` 下必须精确）：`.html → text/html; charset=utf-8`、`.js/.mjs → text/javascript; charset=utf-8`、`.css → text/css; charset=utf-8`、`.json → application/json; charset=utf-8`、`.png → image/png`、`.wav → audio/wav`。扩展名 → MIME 必须来自已校验 manifest 白名单，禁止按请求推断。

### 3.3 明确禁止/不需要的头

- ❌ `Set-Cookie`（实测无；资源路由不应建立会话）。
- ❌ `Access-Control-Allow-Credentials: true`，也不要用「反射 `Origin: null` + credentials」；anonymous `*` 已实测可用。
- ❌ `Cache-Control: public/immutable`（release 后仍能绕过鉴权读）；实例资源必须 `no-store`。入口文档同样 `no-store`。
- ❌ `Location` 302 到公开资源目录（指南 §4.3）；直接在该路由返回字节。
- ⚠️ `Access-Control-Allow-Methods` 对 GET/HEAD 并非必需（GET/HEAD 是 CORS 安全方法、不触发预检），保留无副作用。
- 现有生产 `/entry` 的 `x-entry-sha256` 是单文件入口完整性头；M1 多文件应按 manifest/版本记录完整性，是否继续在响应暴露摘要由契约裁决（暴露摘要本身可被跨域读到的前提是有 ACAO；本探针未测该头）。

## 4. 平台现有能力 vs M0 目标设计（关键差异与约束）

| 维度 | 现有 V1.2 / DSH 0.2.1-rc.2 | M0 探针验证的目标设计（M1 实现） |
|---|---|---|
| 包形态 | 单文件自包含 HTML | 多文件静态包（M0 用 `dsh-package.json` 逐文件 size/sha256 清单；ZIP 属 M1） |
| 入口 | `/api/game-market/entry?gameId&version&instance&nonce`，`text/html`，TTL 绑定（实测重复 GET=200，**不是真正一次性**） | `/res/<instance>/<token>/index.html?launch=<一次性 nonce>`：入口文档在**路径前缀**下 → 包内相对 URL（`scripts/main.js` 等）自然解析，无需 `<base>`/改写 HTML |
| 子资源 | 无（单文件全内联） | 同前缀 `/res/<instance>/<token>/…`，实例凭证可重复 GET/HEAD |
| 凭证 | entry 绑定 = instance/nonce 校验 + 10min TTL（`packages/host/src/entry.js` `serveEntry`） | entry **一次性 launch 凭证**（首 GET 消费，重放 410）+ **实例绑定资源凭证**（路径内 token，renew 同步续期、release/TTL 失效，跨实例/错 token 403） |
| 路由前缀 | 只能注册到 `/api/*`：`connection.fetch.register` 要求路径在 `/api` 下（`dsh-client-connection/lib/index.js:973 assertFetchRoute`），且 `/api` 前缀先过 `connection.admit()` 围栏（同文件 `:1044-1049`；`isTrustedApiRequest` 在 `:240`，`:246` 拒绝 `sec-fetch-site: cross-site`，Origin 存在时必须等于宿主 authority） | **独立资源 origin**（本探针：独立 127.0.0.1 端口），不经过 DSH `/api` 围栏；只提供实例资源路由 |
| CORS | 无 ACAO（子资源不可被 opaque origin 读取）；实测 `/entry` + `Origin: null` = 403 | `Access-Control-Allow-Origin: *`（匿名），ESM/fetch/canvas 实测可用 |
| CSP | `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; …`（单文件内联包足够） | 显式资源 origin 的 CSP（§3.1） |
| 安全隔离 | iframe 已 `sandbox="allow-scripts"`；Host API 有平台 Origin/auth 围栏 | 维持不变；游戏无法读/写 Host API、无法读外网；CSP 同时阻断 no-cors 外发 |

**实测到的 M1 硬约束：** opaque-origin iframe 的子资源请求无法复用 DSH `/api` connection 路由——
1. 模块/fetch 请求带 `Origin: null` → 平台 403（`http-host-fence.json`：Origin:null + 合法 cookie 的 GET/POST = 403）；
2. no-cors `<img src="…/api/game-market/health">` 请求虽无 Origin，但被 `sec-fetch-site: cross-site` 拒绝 → 浏览器实测 **403**（`browser-noCsp.json` 的 Image 403 条目）；
3. `connection.fetch.register` 只接受 `/api/*` 路径（源码 `assertFetchRoute`），当前 DSH 没有给插件开放 `/api` 之外的公开 route mount。

因此 M1 二选一：**(推荐) 插件自建独立 loopback 资源 origin**（本探针已验证端到端），或**请 DSH 上游提供 `/api` 之外的受控公开 route seam**（需上游改动，M0 无法自行放行）。

## 5. entry 一次性 vs 子资源重复 GET 的分离方案（实测结论）

### 5.1 成立的最小方案

1. `POST /api/game-market/launch`（现有、认证）返回实例信息 + `entryUrl = /res/<instanceId>/<resourceToken>/<entry>?launch=<oneShotNonce>`。
2. **一次性 launch 凭证**：仅授权「实例的第一次入口文档 GET」。首次 GET 校验 `launch` 并标记消费（200），同一 URL 再 GET → **410**（实测）。
3. **实例绑定资源凭证**：路径前缀内 `<resourceToken>`，与 `gameId/version/instanceId` 绑定；入口文档与全部子资源都可**重复 GET/HEAD**（实测 `index.html` 去 launch 后 200、每文件重复读 200、HEAD 200）。
4. 实例 `renew` 同步续期资源凭证；TTL 到期 / `release` 后所有读取 403（实测）。
5. 路径只映射到已校验清单（`dsh-package.json` 的 10 个文件），canonicalize 一次后精确匹配；穿越/绝对路径/编码分隔符/目录 listing/未列文件全部拒绝（实测 403/404）。
6. 入口响应的 CSP 显式允许该实例资源 origin 前缀；`frame-ancestors` 只允许 DSH web origin。

### 5.2 必须由 M1 契约明确的两点

- **iframe reload / 重新导航**：入口文档的 launch 凭证已消费后，原 URL 再导航会 410（实测）。M1 运行时必须在 reload 时改用「不含 launch 的资源凭证 URL」（实测同一入口文件 200），或通过认证 RPC 重新领取一次性 launch 凭证。不能假设「首 URL 永远可重放」。
- **凭证在 URL 上**：资源 token 位于 path，必然出现在 iframe 的 `location` 与网络请求中；它只是实例内文件读取凭证，不得同时具备 Host API/存档/安装等任何权限（探针服务本身不挂任何写接口）。`Referrer-Policy: no-referrer` 已实测：资源请求无 Referer 泄漏（`httpRequests[].referer` 全空）。

### 5.3 顺带发现的现有平台差距（供 M1/契约裁决，不是本探针失败）

- 现有 V1.2 `/entry` 的“一次性”只是 **TTL 绑定**：同一 URL 重复 GET 仍 200（`browser-platformEntry.json`：`repeatGetStatus=200`）。若 M1 要「entry 仍一次性消费」，需比现有实现更强的显式消费语义（本探针已验证可行），并处理 reload（§5.2）。
- 现有 `/entry` 响应无 ACAO，且 `Origin: null` 请求被平台 403 —— 这再次说明资源服务不能复用该路由。

## 5.4 复核补充（CR-P1）：sandboxed iframe 的**自导航**边界

> 来源：Codex 对 PR #6 固定 head `240c5d4` 的复核指出 —— S-A1 的 CSP 结论只覆盖**子资源加载**，没有覆盖
> **子文档自身的导航**：sandboxed 游戏执行 `window.location.replace(外部地址)` 时目标服务**实际收到请求**。
> Lead 用真实浏览器独立复现并验证缓解方案，证据 `raw/resources/cr-p1-selfnav.json`，
> 探针 `scripts/verification/v1.5/assets/probe-selfnav.mjs`（exit 0，4/4 as-expected）。
> 每个用例都先发一个**同源 boot beacon**（`connect-src` 允许），用来证明「没有外泄」不是「游戏根本没跑起来」。

| 用例 | 嵌入文档的 `frame-src` | 游戏实际运行 | 外部 origin 是否收到请求 | 浏览器日志 |
|---|---|---|---|---|
| C1 host page **无 CSP**（现状） | 无 | 是 | **收到（gap 复现）** | — |
| C2 host page `frame-src <resOrigin>` | 有 | 是 | 未收到 | `Framing 'http://127.0.0.1:58301/' violates the following Content Security Policy directive: "frame-src http://127.0.0.1:58302". The request has been blocked.` |
| C3 **平台自服务的同源 wrapper**（wrapper 自己的 CSP 含 `frame-src <resOrigin>`） | 有（wrapper） | 是 | 未收到 | 无（静默阻断） |
| C4 游戏文档**自身 CSP**（负对照） | 无 | 是 | **收到** | — |

**结论（供契约与 M1 使用）**

1. **子文档自身的 CSP 拦不住它自己的导航**（C4 负对照证实）：`connect-src` / `frame-src 'none'` 只约束子资源，不约束文档导航。
2. **阻断必须来自嵌入文档的 `frame-src`**（CSP3 对 nested browsing context 的导航生效），由 Chrome 的违规日志直接佐证（C2）。
3. **首选缓解（本轮已验证、无需 DSH 改动）**：资源 origin 提供一个**平台自服务的同源 wrapper 文档**，其 CSP 设 `frame-src <resourceOrigin>; child-src <resourceOrigin>`，由它内嵌游戏 iframe（C3 实测阻断）。这样导航边界不依赖 host 页面策略。
4. **替代缓解**：host 页面自身设 `frame-src <resourceOrigin>`（C2 实测阻断）。**产品实现 MUST NOT 假设 host 页面有该策略** —— 现状没有（C1）。
5. **纵深防御（不能替代阻断）**：请求可能已经发出，检测无法挽回。受信 Runtime 仍应把「非预期导航 / Bridge 心跳中断」当失败处理：暂停并销毁实例、显示错误、不再授予能力。
6. **修正一处表述**：CSP **按 origin 匹配**，不是按「绝对 vs 相对」。指向同一资源 origin 的绝对 URL 会被放行；`connect-src <resourceOrigin>` 是运行时权威边界，而 validator 对绝对 URL 的静态拒绝是**创作期可移植性规则，不是安全证明**。

**M1 必须补的回归**：正例 —— wrapper 内导航到资源 origin 内页面成功；反例 —— 导航到外部 origin 被阻断且**不产生网络请求**（用与 C2/C3 相同的 sink 记录法判定）。
**仍未验证**：wrapper 方案只在 Chromium 155 实测；跨引擎、以及接入真实 DSH 页面后的行为未验证（见 §6）。

## 6. 未验证项（明确不写成通过）

| 未验证项 | 原因 / 下一步 |
|---|---|
| 字体 `@font-face` 跨域加载 | 无「可再分发且体积合适的字体 fixture」；`font-src <resourceOrigin>` 与 ACAO `*` 的语义与已实测的图片/音频同属 CORS 资源，但未实测。M1 集成测试应补一个 OFL 字体文件，验证成功与失败降级。 |
| asset-zip-v2 归档安装后的资源服务 | M0 只验证资源服务形态与响应头；ZIP 解包、清单校验、安装布局、staging 提升属 M1（指南 §4.2/§4.3）。 |
| 真实 DSH Runtime/UI 驱动 iframe | 探针在真实 DSH GUI 页面里用与 `controller.js` 完全相同的属性创建 iframe（并在源码层核对不变量），但没有通过 Market UI「点击开始游戏」链路进入；M1 完成后应把本探针接入真实 Runtime 流程复跑。 |
| 真实 Electron Desktop 窗口 | 使用安装版 DSH 的 `dsh web` 隔离宿主（与 M3 证据同一做法），未替换/驱动用户 Desktop App 窗口。 |
| 多窗口 / 多实例并发 | 单实例顺序场景；renew/release 竞争、多窗口同时读同一实例未压测（M1 的资源服务需自证）。 |
| 其它浏览器引擎（Safari/WebKit/Firefox） | 仅 Chrome 155 实测；`'self'` 在 opaque origin 下的行为（§S-A1-23）尤其不应跨引擎外推。 |
| 内联 `<script>`/`style` 在候选 CSP 下的策略 | fixture 采用全外链；M1 若允许内联，需在 `script-src` 加 `'unsafe-inline'` 并单独评估 XSS 面；本探针不裁决。 |
| 外网可达性差异 | 本机 Chrome 对 `https://example.com/` 是「请求可发出、CORS 拒绝读」；若测试机完全断网，`net::ERR_INTERNET_DISCONNECTED` 也会判为「不可读」。CSP 层拦截（候选场景）与网络可达性无关。 |
| 无 `allow-same-origin` 的其它绕行（`srcdoc`、blob:、data:） | 不在 S-A1；M1 资源服务只接受 `/res/...`，不应新增这些入口。 |

## 7. 复现与维护

```bash
node scripts/verification/v1.5/assets/gen-fixtures.mjs --check   # fixture 清单/字节确定性
node scripts/verification/v1.5/assets/probe-resources.mjs        # 全量 S-A1；失败非零
```

- fixture 文本文件在 `scripts/verification/v1.5/assets/fixture-package/`；PNG/WAV 与 `dsh-package.json` 由 `gen-fixtures.mjs` 确定性生成（两次生成字节一致，`--check` 校验）。
- 探针脚本复用 `scripts/verification/v1.5/lib/harness.mjs` 的 `ensureRuntime/makeHome/startHost/injectProbeRow/Cdp`；隔离 `DSH_HOME` 固定在 `/tmp/dsh-v15/home-probe-resources`，副作用只有 `/tmp` 与 `docs/verification/v1.5/raw/resources/`。
- 端口：宿主 58261、资源服务 58262、第三方 origin 58263、CDP 9495（避免与本仓库其它探针冲突；被占用时改 `PORTS` 后重跑）。
- 引用源码位置：`packages/runtime/src/controller.js`（iframe 属性）、`packages/host/src/entry.js`（现有 entry + 生产 CSP builder）、`dsh-client-connection/lib/index.js:240/:246/:973/:1044-1049`（平台 `/api` Origin/sec-fetch-site 围栏与 fetch 路由前缀限制）。
