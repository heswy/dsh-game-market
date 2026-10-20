# V1.5 M1 验收矩阵（A01–A07）

> 状态：**M1 交付记录**。M1 只做资源包（`asset-zip-v2`）/两代目录/独立资源 origin/开发工具最小面；
> M2～M5 未开始（见 `docs/V1.5-CONTRACTS.md` §15.3 与 `PROJECT_MEMORY.md` V1-47）。
>
> 记录日期：2026-10-20。分支 `feat/v1.5-asset-packages`（基线 `origin/main` `a762449`）。
> 契约：`docs/V1.5-CONTRACTS.md`（§7.5.2 两层沙箱模型为 M1 实测修正）。
> 证据级别标记：`automated`（隔离 Host 服务图 + 真实路由）、`isolated-browser`（CDP + 真实 DSH 页面）、
> `real-Desktop`、`real-public`、`not-run`。**未跑的就是未跑，不写成通过。**

## 0. 本轮验证入口与总结果

| 项 | 命令 | 结果 |
|---|---|---|
| 完整门禁 | `npm install && npm run verify` | **1016/1016 pass, exit 0**；`CHECK OK (41)`；`client.js` sha256 `74f6d997c889621e…` 两次构建一致 |
| 归档政策矩阵 | `node --test tests/v1.5-zip-policy.test.js` | 9/9（含 71 条恶意用例矩阵 + 6 条正向/单元） |
| 共享契约 | `node --test tests/v1.5-contracts-v2.test.js` | 27/27 |
| 两代目录 | `node --test tests/v1.5-catalog.test.js` | 14/14 |
| Runtime/SDK/Client | `node --test tests/v1.5-runtime-resources.test.js` | 见 §6 |
| Host 全量 | `node --test packages/host/test/index.js` | 203/203 |
| 静态检查 | `node scripts/check.mjs` | CHECK OK (41) |
| 构建可复现 | `node scripts/build.mjs` ×2 + `shasum -a 256` | 字节一致（`client.js` 与四个游戏 dist、两代 registry） |

**依赖前置**：M1 起 `npm run verify` 需要先 `npm install`（`yauzl@3.4.0` + `pend@1.2.0`，均 MIT，
PRD D-040 限定例外，只允许 `packages/host/src/zip.js` 引入；`scripts/check.mjs` 断言版本精确、
无安装脚本、引入点唯一、`THIRD-PARTY-NOTICES.md` 存在）。

## 1. A01 旧 HTML 四款不回归

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| `html-v1` 安装/启动/卸载/存档路径 | automated | `packages/host/test/index.js` 203/203（含 `v1-install`/`v1-launch`/`v1-games`/`v1-maintenance`）；`tests/v0-flow.test.js`、`tests/v1-contracts.test.js` 9/9 | 通过（不回归） |
| `html-v1` LaunchInfo 保持 V1 语义 | automated | `entry.js` 对 `html-v1` 仍返回 `/api/game-market/entry` 入口、不给 `wrapperUrl`/`wrapperResourceUrl`；`package.format='html-v1'` | 通过（additive only） |
| 资源 origin 对 html-v1 只提供 additive 凭证 | automated | `packages/host/test/cases/v1.5-resources.js`（`html-v1` CSP 走 V1 builder、`/entry` 重复 GET 200） | 通过 |
| 四款内置游戏构建产物与源一致 | automated | `games/*/test/build.test.js`（`node scripts/build.mjs` 重建后） | 通过 |
| 真实 Desktop 内四款的暂停/自动保存/Continue | real-Desktop | — | **未跑（本阶段不要求）**；沿用 V1.2.0 真机证据 |

## 2. A02 真 ZIP 独立 ESM/CSS/图片/JSON/音频实际加载，断网仍可玩

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| ZIP 包真实安装（外层 sha/描述符/清单绑定） | automated | `tests/v1.5-zip-policy.test.js` P1/P5；本会话端到端复核（`POST /install-local` → `installation.format=asset-zip-v2`/`entry=index.html`/`fileManifestDigest`） | 通过 |
| `/launch` 返回 zip 专用 LaunchInfo | automated | 端到端复核：`entryUrl` = `resourceOrigin/res/<id>/<token>/index.html?launch=…`；`wrapperUrl`/`wrapperResourceUrl` 存在；`package.format=asset-zip-v2` | 通过 |
| 每种资源真的被浏览器加载 | isolated-browser | `docs/verification/v1.5/m1-browser.md` §A02；证据 `raw/m1/M1-A02-multiresource-2026-10-20T04-44-56-876Z.json`（43/43 required，exit 0）：游戏**真实渲染**（title/`#hud`/`#board`/`phase=playing`，非 `chrome-error`）、`window.origin="null"`；8 类资源逐个 200 + 精确 MIME（ESM 静态 import、CSS computed style、JSON 两次解析、PNG 64×64 + canvas 可读、WAV `readyState=4` + decode、SDK 握手 + `storage.save`）；外层 wrapper iframe `sandbox=null`、wrapper frame `origin=resourceOrigin`、内层 game iframe `sandbox="allow-scripts"` 且无 `allow-same-origin`；入口 launch 仅被真实 Runtime 消费 1 次（重放 410）；零 CSP 违规 | **通过** |
| 断网仍可玩 | isolated-browser | 同上：gate 阻断所有非 `resourceOrigin` 请求后 reload 全资源 200（用资源凭证 URL、**无 launch 重放**），CDP offline 模拟下 ticks 1→14 持续推进 | **通过** |

## 3. A03 恶意包矩阵全部拒绝，旧安装可继续

`tests/v1.5-zip-policy.test.js` → **9/9**，其中恶意矩阵 **71 条**，每条都经真实
`POST /install-local`（`Content-Type: application/zip`）并断言 **①错误码 ②HTTP 状态
③`packages/<id>/<version>` 不存在 ④`staging/` 清空 ⑤无 `installations.json` 记录
⑥`details` 在 §8.4 白名单内**。所有「实际码」由断言逐条校验，不是表格推断。

| # | 输入特征（条数） | 期望=实际码 | HTTP | 产出版本目录 | staging |
|---|---|---|---|---|---|
| 1 | 穿越 `../`、嵌套穿越、绝对 `/`、盘符、UNC、反斜杠、空段、`.`/`..`、段尾空格/点、NUL、控制字符、非法 UTF-8、Windows 保留名（15） | GM-4273 | 422 | 否 | 空 |
| 2 | 路径超长 241 码点 / 超深 13 段（2） | GM-4272 | 422 | 否 | 空 |
| 3 | 重复条目、大小写折叠、NFC 折叠、目录-文件同名（4） | GM-4274 | 422 | 否 | 空 |
| 4 | 非根 `sub/dsh-package.json`（1） | GM-4277 | 422 | 否 | 空 |
| 5 | 目录项 `assets/`（1） | GM-4270 | 422 | 否 | 空 |
| 6 | 符号链接位、字符/块设备、FIFO（4） | GM-4271 | 422 | 否 | 空 |
| 7 | 传统加密 bit0、strong 加密 bit6（2） | GM-4271 | 422 | 否 | 空 |
| 8 | 压缩方法 12（1） | GM-4271 | 422 | 否 | 空 |
| 9 | ZIP64（version-needed 45 / extra 0x0001 / EOCD 哨兵）、多卷（4） | GM-4271 | 422 | 否 | 空 |
| 10 | 嵌套归档（`.zip` 扩展名 / `.js` 内 `PK\x03\x04`）（2） | GM-4271 | 422 | 否 | 空 |
| 11 | 伪造 descriptor `size`/`sha256`（2） | GM-4278 | 422 | 否 | 空 |
| 12 | 伪造中央目录 CRC（1） | GM-4276 | 422 | 否 | 空 |
| 13 | 伪造中央目录 size、截断 Deflate 流（3） | GM-4275 | 422 | 否 | 空 |
| 14 | 本地头文件名/flags/method/签名不一致（4） | GM-4275 | 422 | 否 | 空 |
| 15 | 截断包（EOCD 缺失）（1） | GM-4270 | 422 | 否 | 空 |
| 16 | `application/zip` + HTML body（1） | GM-4150 | 415 | 否 | 空 |
| 17 | 高压缩比、总条目 513、`files[]` 512（3） | GM-4272 | 422 | 否 | 空 |
| 18 | 描述符缺失/JSON 非法/`formatVersion≠2`/未排序/自引用（5） | GM-4277 | 422 | 否 | 空 |
| 19 | 描述符 >256 KiB（1） | GM-4272 | 422 | 否 | 空 |
| 20 | 清单缺文件 / 清单外额外文件（2） | GM-4278 | 422 | 否 | 空 |
| 21 | 第二个权威 manifest（1） | GM-4279 | 422 | 否 | 空 |
| 22 | 内联 `<script>`/`<style>`/`on*=`/`javascript:`（4） | GM-4283 | 422 | 否 | 空 |
| 23 | 外部 `fetch`/远程 `import()`/`<iframe>`/外部 `<img>`（7） | GM-4280 | 422 | 否 | 空 |

**可证伪对照**：矩阵首尾各有一条「同 harness、同 `Content-Type`、同包结构」的**合法包安装成功**；
每类拒绝旁配同类正向用例（边界内长度/深度、普通文件 mode、未加密 Stored+Deflate、正确 CRC/size/sha、
恰好 512 条目 = 描述符 + 511 files、外链同内容脚本/样式、包内相对 `fetch`/`import`/XHR）。

**旧安装可继续**：P4 实测同 id+同版本换 ZIP → `GM-4282` 且旧 `entry.html` 未动；升版本 html→zip 成功并保留
`previousVersion`/`previousFormat`；`html-v1` 安装/启动回归在 Host 套件通过。

**列入口径注意**：`zipTotalRatio`（全包 100:1）实现但**没有能独立触发它的夹具**（单条目压缩比 ≤100
在数学上已蕴含全包 ≤100）——记录为「实现但不可独立触发」，不算已验证。

## 4. A04 失败/并发/中断恢复，无半包或越界写入

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| 解压中断/截断 → 受控 GM 码、无半包 | automated | A03 #13/#15 + `zip.js: truncated Deflate streams always fail with a controlled GM code`（gzip 泄漏修复后循环 200 次 0 timeout/0 uncaught）；仅写 `staging/<jobId>/`，失败清理 staging | 通过 |
| 进程重启后的崩溃恢复（§6.5） | automated | P7：健康 `ok`；删 `dsh-package.json`/改 descriptor 使 digest 不符/删版本目录 → 标 `broken` 且**不删数据**；`staging/job_crashed` 启动清空；broken 可重装修复 | 通过 |
| 安装记录写失败 / 并发安装 | automated | 既有 `install-lock`（跨进程写锁/心跳/陈旧锁）+ `v1-install` 套件；重复上传同 ZIP `changed:false` | 通过（沿用 V1 机制，未新增并发模型） |
| current/previous 与 save 保留 | automated | P4：升版本后旧目录保留、`previousVersion`/`previousFormat` 正确；1.0.2 后 1.0.0 按窗口 prune；save 由既有 V1 路径保证 | 通过 |
| 磁盘满 / `statfs` ENOSPC 路径 | — | 已用 `fs.statfs` 尽力预检（`zipOuterBytes + zipUnpackedBytes`），**无法在测试中模拟 ENOSPC** | **未验证** |
| `TIMING.zipExtractMs`（60s 挂钟）上限 | — | 代码按 64 KiB 块检查并在末段复查，**无慢速夹具** | **未验证** |

## 5. A05 一次性 entry + 资源多次请求 + renew/release/TTL；越权拒绝

`packages/host/test/cases/v1.5-resources.js` → 26/26。每条拒绝都有**正向对照**（同结构合法请求成功），
这是 M0 CR-P1 假通过教训后的硬要求。

| 子项 | 证据 | 结论 |
|---|---|---|
| 一次性 launch：首 GET 200 消费 → 重放 **410 GM-4013**；去掉 launch 用资源凭证 **200**；错 nonce **401 GM-4012** | 逐项 + 正向 | 通过 |
| 资源凭证可重复 GET/HEAD（清单内全部文件，每文件 2×GET + HEAD，HEAD `content-length` 一致且无 body） | 逐项 | 通过 |
| `renew` 后越过原 TTL 仍 200；`release` 后立即 **403 GM-4011**；TTL 到期 **403 GM-4011**；`POST /runtime-renew` 返回新 `resourceTtlMs` | 逐项，均带到期/释放前的正向 200 | 通过 |
| 跨实例 token **403 GM-4039**；未知/格式错 token **401 GM-4010**；跨包文件 **404 GM-4043** | 逐项 + 两实例各自正向 200 | 通过 |
| 无鉴权读 / 任意磁盘读 / 目录 listing 拒绝 | `..`、`../../etc/passwd`、`%2e%2e`、`%2e%2e%2f`、`..%5c`、`%2fetc%2fpasswd`、`//etc/passwd`、`%00`、目录路径、仅 base、`dsh-package.json`、`game.json` → 403 GM-4039；未列清单 → 404 GM-4043；`%252e` 双编码不落盘不命中 | 通过 |
| 只监听 loopback、只有实例资源路由（无写接口/诊断接口） | `address()` 断言 127.0.0.1、非 `0.0.0.0`/`::`；未知路径 404、写方法 405 + `Allow: GET, HEAD` | 通过 |
| 头部契约（exact MIME+魔数、`no-store`、`nosniff`、`no-referrer`、`ACAO:*`、无 `Set-Cookie`/`Location`/`ACAC`） | 逐头断言 | 通过 |
| 凭证脱敏（日志/错误体/`details` 无 token/nonce/绝对路径） | 断言 | 通过 |
| 多窗口并发 renew/release 竞争 | — | **未验证**（§7.7） |

## 6. A06 浏览器沙箱/CSP/CORS/ESM 边界与宿主写接口隔离

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| 两层沙箱模型落地（wrapper 无 sandbox、game `sandbox="allow-scripts"`） | automated | `packages/runtime/test/wrapper.test.js` + `tests/v1.5-runtime-resources.test.js`（wrapper iframe `sandbox===null`；html-v1 iframe `sandbox==='allow-scripts'`；非法 wrapper 失败关闭且不创建 iframe） | 通过 |
| 真实浏览器内的沙箱/CSP/CORS/ESM 与 wrapper 协同（外发零请求、读 Host `/api` 被拒、非本实例窗口 postMessage 被拒、wrapper 导航阻断） | isolated-browser | `m1-browser.md` §A06；证据 `raw/m1/M1-A06-boundaries-2026-10-20T04-51-00-544Z.json`（42/42 required，exit 0）：外发 fetch/XHR/WS/beacon **sink 0 HTTP / 0 upgrade**（正向对照：包内同源 fetch 200、合法 `storage.save` 被接受）；Host `/api` 游戏侧全部 `blockedReason=csp`（页面自身 `health` 200 作正对照）；6 个危险桥方法 → `GM-4004`；非本实例窗口 60 条伪造被拒并计数 → `GM-5004` + 撤销（可证伪）；恶意自导航有 attempt 日志 + Chrome 违规日志 + **sink 零请求**，同源 `second.html` 正例 200；`window.top.location` 抛权限错、页面 URL 未变；`frame-ancestors` 违规 0 | **通过** |
| 恶意游戏不能调用更新/答案/审批能力 | automated + isolated-browser | Bridge 方法面由 Runtime/SDK 白名单决定，未知/危险方法 → `GM-4004`；A06 证据里 6 个危险方法逐个被拒 | **通过** |
| Host 写接口对不可信 Origin / 无凭据请求拒绝 | automated | 既有 `/api` Origin+`sec-fetch-site` 围栏（V1）+ 资源 origin 无写路由 | 通过（沿用 V1 围栏） |

## 7. A07 两代目录兼容与历史不可变

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| 旧 v1.2 插件读取旧目录不失败 | automated | `registry/games.json` 在 M1 后**字节与改动前一致**（`node scripts/build-registry.mjs` 两次构建 hash 稳定）；`packages/host/test/cases/v1-registry.js` 保持通过 | 通过 |
| V1.5 读取 v2 | automated | `packages/host/test/cases/v1.5-registry-v2.js` 13/13：显式 v2 源严格校验且只写 `registry-cache-v2.json`；v2 缺 `format`/坏条目整份拒绝并保留旧缓存；v2 ZIP 条目可读可列 | 通过 |
| 双投影选择（最新 ZIP、v1 保留上一个 HTML） | automated | `tests/v1.5-catalog.test.js` 14/14：`1.0.0(html)+1.1.0(zip)` → v1=1.0.0（无 `format` 字段）、v2=1.1.0（`asset-zip-v2`+`filesDigest`）；ZIP-only 游戏不出现在 v1 | 通过 |
| 生成确定性 | automated | 独立内容仓库两次生成：v1 `709902e2…`、v2 `04a46233…` 两次相同；随包 seed `68fd1d13…`/`908ca4b9…`；`generatedAt` 取源记录最大固定时间 | 通过 |
| 显式源兼容（v1/v2 自检、不跨代回退） | automated | `v1.5-registry-v2.js`：显式源按 `registryVersion` 选校验器与缓存；v2 缓存 `schemaVersion`/`sourceUrl` 不符视为无缓存 | 通过 |
| 双投影撤下 | automated | `withdrawnAt` 非空 → 两代投影同时移除；`owners/`/`reviews/` 审计保留 | 通过 |
| 历史不可变 / 格式策略 | automated | 同 id/version 字节不可变、版本回退拒绝、`html-v1→asset-zip-v2` 必须升版本（`GM-4281`/`GM-4282`），发布工具 dry-run 在**下载前**拒绝 | 通过 |
| 完整 ZIP 发布链路（升级版本的 ZIP 提交） | — | `prepare.mjs` 的包内容校验仍只认 HTML 单文件；接 `zip.js` 属 M2 | **未完成（M2）** |

## 7b. CR7 复核修正轮（基于固定 head `77c8d0a`）

Codex 复核提出 3 项，均为「契约说了、实现没做到」的缺口（非契约被推翻）。逐项状态：

| ID | 问题 | 级别 | 修复 | 证据 | 状态 |
|---|---|---|---|---|---|
| CR7-01 | 只有入口文档带 CSP；包内其他 HTML/SVG 作为**同源文档**被导航后无策略，可外发 | P1 | `asset-zip-v2` 对所有 `text/html` 与 `image/svg+xml` 响应发送与入口**完全相同**的 asset CSP；`.js/.css/.json/图片/音频/字体` 仍不带 CSP；`x-entry-sha256` 仅入口；`html-v1` 不变 | 修复前：`raw/m1/CR7-01-same-origin-html-prefix-*.json`（`secondCsp=null`，外部 sink **实际收到** HTTP 请求 + WS upgrade，8 项 required 失败）；修复后：`raw/m1/CR7-01-same-origin-html-*.json`（21/21，sink 零请求，`second.html` CSP 与入口逐指令一致，第二页真实运行） | **通过** |
| CR7-02 | 保留的上一版 ZIP 目录无法回滚（重装旧版本 → 409 `GM-4094`） | P2 | `placePackageTree`/`placePackage` 按**实测内容**判定目录等价（zip 逐文件 sha256 + `fileManifestDigest`；html 实测 `entry.html` sha256+size，不依赖可能为 null 的 `record.sha256`）；一致 → 复用目录（不重命名/不重解压/不重封存）；不一致仍 409；记录写失败**不得**删复用目录 | 回滚 1.0.0→1.1.0→1.0.0 = 200 `changed:true`/`previousVersion=1.1.0`、目录字节未改写、**save 前后一致**；目录篡改 / 同版本不同内容 = 409 且旧目录完好；注入 `installations.put` 失败 = 新装清理、复用目录完好；本地 html `sha256:null` 回滚成功 | **通过** |
| CR7-03 | Market UI 本地 ZIP 安装未接通，且文本路径把 2384 B ZIP 变成 2474 B | P2 | 文件选择接受 `.dshgame.zip`（扩展名优先、MIME 兜底）、统一二次确认（文件名/大小/格式/覆盖版本）、**ArrayBuffer 原始字节 + `application/zip`** 上传、零文本编解码；`html-v1` 路径不变 | 客户端单测：2384 B 含高位字节样本 source/uploaded sha256 **逐字节相等**、`content-type: application/zip`、`body` 为 ArrayBuffer；`html` 对照仍 `text/html` 字符串零回归。**真实 Market UI 点击路径**（侧栏→上传游戏→真实 fileChooser→`DOM.setFileInputFiles`→二次确认→安装，全程 `probeInitiatedInstallApiCalls=0`）：`raw/m1/CR7-03-market-ui-local-zip-2026-10-20T05-28-04-816Z.json` **36/36**，`POST /install-local` 200 + `application/zip`，CDP `Network.postDataEntries` 原始 body **102 997 B / sha256 `c07a9f8c…` = 源**，`installation.format=asset-zip-v2`、`entry=index.html`、`fileCount=9`；HTML 对照 200 + `format=html-v1` 零回归。三态 A/B：修复前 15/36（无对话框无请求）、中间态 23/36（**415 且 body 膨胀为 106 118 B**）、修复后 36/36 | **通过** |

CR7-01 的修复同时收紧了 §7.5 的一条边界：**「可文档化资源」不等于「所有资源」**——
只对 `text/html` 与 `image/svg+xml` 发 CSP，其余静态子资源保持不带 CSP（避免过度修复掩盖真实边界）。

## 8. 已知项与未验证项（不写成通过）

1. **`html-v1` 未 wrapper 化**：M1 只为 `asset-zip-v2` 引入 wrapper，`html-v1` 仍走 V1 `/entry` 直嵌，
   §7.5.1 的「包外导航阻断」对 `html-v1` **尚未生效**。属已知项；覆盖它需要 M2/M4 的兼容性决策。
2. **`dshWebOrigin` 已接线（本项已关闭）**：`packages/host/src/plugin.js` 从 DSH
   `webServer.getOrigin()` 读取精确页面 origin，并传入 `createHost({ http: { dshWebOrigin } })`；
   wrapper 与入口文档的 `frame-ancestors` 实测为**精确 origin、不含 `*`**
   （`raw/m1/M1-A02-multiresource-*.json` 的 `wrapper-csp-frame-ancestors-no-wildcard-at-all`）。
   仅在**宿主没有 `webServer` 服务**（或尚未 `listen`）时回退
   `settings.security.frameAncestors` allowlist（`'self' + http://127.0.0.1:* + http://localhost:*`）——
   该回退路径**未在真实无 web 宿主上验证**（当前产品形态不涉及）。
3. **非 Chromium 引擎**（WebKit/Firefox）的导航阻断与资源加载**未验证**（浏览器证据为 Chrome headless via CDP）。
3b. **真实打包 Client UI 路径未驱动**：A02/A06 以生产 `packages/runtime/src`（真实 controller/bridge）+ 真实 SDK + 真实 DSH 页面为证据级别，未经打包后的 Market UI 点击路径；真实 Electron 桌面窗口亦未驱动。
4. `@font-face` 经资源 origin 加载**未测**（服务端按 woff/woff2 魔数+MIME 提供）。
5. 多窗口并发 `renew`/`release` 竞争**未测**。
6. 磁盘满（ENOSPC）与 `zipExtractMs` 挂钟上限**未验证**（无夹具）。
7. `zipTotalRatio` 实现但不可独立触发（已被单条目比值数学蕴含）。
8. Windows 下 0444 文件的删除行为**未验证**（仅 macOS 实测）。
9. 真实 DSH Desktop 窗口内的 A03/A06 全链路（本阶段以隔离 Host + CDP 真实页面为证据级别）。

## 9. 证据索引

| 类别 | 路径 |
|---|---|
| 归档政策矩阵 | `tests/v1.5-zip-policy.test.js`（71 条恶意用例由断言逐条校验） |
| 共享契约 | `tests/v1.5-contracts-v2.test.js` |
| 两代目录 | `tests/v1.5-catalog.test.js`、`packages/host/test/cases/v1.5-registry-v2.js` |
| Host 归档/安装 | `packages/host/test/cases/v1.5-install-zip.js` |
| 资源与凭证 | `packages/host/test/cases/v1.5-resources.js` |
| Runtime/SDK/Client | `packages/runtime/test/wrapper.test.js`、`tests/v1.5-runtime-resources.test.js`、`packages/client/test/bundle-lib.test.js` |
| 浏览器 | `docs/verification/v1.5/m1-browser.md`、`docs/verification/v1.5/raw/m1/*.json`（A02/A06 最终 + 3 份 P0 阻断证据 + 6 张截图）；探针 `scripts/verification/v1.5/m1/**` |
| 契约落地 | `docs/V1.5-CONTRACTS.md` §15（实现↔契约对照）、§7.5.2（两层沙箱模型） |

---

# V1.5 M2 验收矩阵（内置资源包游戏 + 双格式工具链）

> 记录日期：2026-10-20。分支 `feat/v1.5-game-and-tooling`，基线 `origin/main` `9388b37`（M1 已合入）。
> 契约落地见 `docs/V1.5-CONTRACTS.md` §16；证据目录 `docs/verification/v1.5/raw/m2/`。
> 证据级别同 §0：`automated` / `isolated-browser`（CDP + 真实 DSH 页面）/ `not-run`。

## 10. 门禁总表

| 项 | 命令 | 结果 |
|---|---|---|
| 完整门禁 | `npm install && npm run verify` | **1189/1189 pass，exit 0**；`CHECK OK (42)` |
| 新游戏自带测试 | `node --test "games/orbit-courier/test/*.test.js"` | **42/42**（规则 + 包契约 + 每局结算 7 条，含真 ZIP → `extractPackageArchive` 往返） |
| 内置资源包 Host | `node --test "packages/host/test/index.js"` | **231/231**（含 builtin `asset-zip-v2` 15 条 + 卸载符号链接 2 条） |
| 双格式 CLI | `node --test "scripts/cli/test/*.test.js"` | 74/74（含 `format-v2.test.js` 双格式 + 确定性 + 非法包拒绝 + dev save） |
| ZIP 投稿发布链 | `node --test tests/v1.5-publish-zip.test.js` | **19/19**（含 CR8-02 素材绑定 9 条） |
| 双格式投稿校验 | `node --test tests/v1.5-submission-format.test.js` | 6/6 |
| 构建可复现 | `node scripts/build.mjs` ×2 + `shasum -a 256` | `client.js`、四个 HTML 游戏 dist + orbit-courier dist、两代 registry 均字节一致 |

## 11. M2 交付逐项

### 11.1 新内置游戏 `orbit-courier`（A08 对应）

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| 真实使用独立 ESM/CSS/图片/关卡 JSON/本地音效 | automated | `dist/` 23 条目（22 files + descriptor）：`scripts/*.js`(8) + `styles/game.css` + 3 PNG + `levels/shift-01.json` + 6 WAV，`dsh-package.json` 清单绑定 | **通过** |
| 确定性构建 | automated | 两次构建描述符 sha256 一致；逐文件字节一致（`build.test.js`） | **通过** |
| 约 120 秒一局 / 键盘 / 计分 / 暂停 / 自动保存 / Continue | isolated-browser | `raw/m2/M2-A08-orbit-courier-2026-10-20T08-40-24-434Z.json` **34/34 required**（见 §11.1.1） | **通过** |
| 音效手势解锁 + 可静音 | isolated-browser | A08 证据：`audio-locked-before-first-gesture` / `audio-unlocked-after-first-gesture` / `M` 键静音 + `mute-persists-across-continue` | **通过** |
| 与现有四款共存、builtin 不可卸载、复用资源包校验器与资源服务 | automated | builtin 用例：`/uninstall` → `GM-4038`；catalog 列出 5 款；资源 origin/凭证/CSP 与安装包同路径 | **通过** |
| 375px / 深色 / reduced-motion | isolated-browser | `raw/m2/M2-visual-responsive-2026-10-20T07-34-15-454Z.json` **18/18 required** | **通过** |
| 多资源真实加载（ESM/CSS/PNG/JSON/WAV 逐个 200 + 精确 MIME + 两层 iframe） | isolated-browser | `raw/m2/M2-A02-orbit-multiresource-2026-10-20T07-36-13-978Z.json` **21/21 required** | **通过** |

#### 11.1.1 A08 真实时长与 Continue

**`raw/m2/M2-A08-orbit-courier-2026-10-20T08-40-24-434Z.json` → 34/34 required（35 checks，1 条非 required），exit 0。**

| 断言 | 实测 |
|---|---|
| `run-really-lasted-about-120s-of-game-time` | `elapsedMs = 120000`（一局真实打满 120 秒游戏时间） |
| `run-ends-naturally` | `endReason = "shift-complete"`，`attempts = 1`，score 280 / deliveries 10（不是撞毁提前结束） |
| `at-least-5-minutes-active-wall-clock-play` | `activePlayMs = 351934`（≈5.87 分钟墙钟），`sessions = 5`；区间墙钟 419,803 ms，活动 ≤ 墙钟 |
| `continue-offered-after-exit` | 真实 UI「我的游戏」行 `playText = "继续"` |
| `continue-launch-shows-continue-action` | 菜单 `#btn-continue` 存在（`continueButton:true`） |
| `continue-restores-elapsed-time-and-score` | 退出前 `elapsedMs 43120 / score 200 / muted=true`（Host `current.json` + meta revision 15 实测落盘）→ Continue 后 `43200 / 200 / true` |
| `mute-persists-across-continue` | `muted = true` 跨 Continue 保持 |
| `score-grows-during-real-play` / `space-pauses-the-real-run` / `clock-stops-while-paused` | 真实键盘驱动，暂停时 `elapsedMs` 冻结 |
| 音效 | 首次手势前 `unlocked:false` 且 `playResult:false`；手势后 `unlocked:true` 且可播放；`M` 静音/恢复 |

**M2 期间发现并修复的游戏缺陷（都有回归测试）**：
1. `storage.load()` 返回的是 V1 envelope `{key,data,revision,updatedAt}`，旧代码把 envelope 当 payload → Continue/静音/最高分全部失效（`resume.test.js` 用真实 envelope 覆盖）。
2. 从「继续」重开时 host 先发 `pause` lifecycle，旧代码把**菜单态 elapsed=0** 写回、覆盖有效存档（A08 的 112ms/score 0 即此因）→ `shouldPersistRun()` 只允许 playing/paused 且 `elapsed≥500ms` 落盘。
3. 自动化验收需要**只读**观察面 → 新增 `window.__ORBIT_PROBE__.snapshot()`（冻结副本、无 setter、无输入注入、不改状态），README 已说明不影响游戏行为。

### 11.2 双格式开发工具

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| CLI `create/build/validate/pack/publish` 显式 `--format`；不带时与 M1 一致 | automated | `scripts/cli/test/**` 68/68；旧 55 条 html-v1 测试未改且通过 | **通过** |
| `asset-zip-v2` 产物确定性 + sha256/size/fileCount/权限/自测 | automated | 样例：`sha256 2c849455…`、125,895 B、fileCount 8（+descriptor 共 9 entries @0444）、`filesDigest 22499aa7…`；两次 pack 同 sha | **通过** |
| React 资源包用相对 `base`（非 singlefile）并校验最终 ZIP | automated | `templates/react/zip/vite.config.ts` `base:'./'` + 外部 `assets/*.js|css`；真实 `tsc --noEmit` + vite 构建 + `pack` + `validate`（探针用真实 `npm install` 环境验证） | **通过**（真实依赖链由探针验证，见 §12） |
| Simulator 支持按格式加载 | automated | `dev` 对 zip 走 wrapper + `/res/<instance>/<token>/…`，`/health` 报 `format/fileCount`；html-v1 单文件路径不变 | **通过** |

### 11.3 ZIP 投稿发布工具链

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| prepare/validate-assets/模板/CI 认识两种包 | automated | `tests/v1.5-publish-zip.test.js` 10/10 + `scripts/registry/test/*` 31/31 | **通过** |
| 复用 M1 归档校验，绑定外层 ZIP SHA + 内部清单摘要 | automated | `validatePackageBytes()` 动态 import `zip.js#extractPackageArchive`；catalog v2 写 `sha256`+`size`+`filesDigest` 三重绑定 | **通过** |
| 下载→归档校验→catalog v2→两代索引 完整流程 | automated | publish-zip 第 2 条：真实 ZIP 下载→校验→catalog v2→双索引；再生成字节一致 | **通过** |
| dry-run 零远端写入、历史不可变、同版本禁换字节/格式、双投影撤下、失败恢复、审核边界 | automated | publish-zip 第 1/3/4/5/6/7 条逐项断言（`git.calls==0`/`github.calls==0`/快照不变；`E_PUBLISH_VERSION_IMMUTABLE`/`E_FORMAT_POLICY`；撤下双移除保留审计；下载/上传/commit/history 失败无半成品） | **通过** |
| 不自行更新生产 pin/资产/合并内容 PR | — | 未执行（按纪律） | 合规 |

### 11.4 Skill

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| 独立 AI 仅凭 Skill 完成资源包开发/验证/投稿材料 | 独立 AI 评估（隔离目录） | `docs/verification/v1.5/m2-skill-eval.md` + `raw/m2/skill-eval/**`（46 份原始证据） | **核心链路 PASS**；首轮暴露 3×P1 + 4×P2 + 6×P3 Skill 缺陷与 6 个产品缺陷，已按清单修复（见 §11.4.1） |
| 非法包 → 修复 → 重验 | 同上 + Skill 内实测输出 | 评估者在隔离目录真跑 4 类：构建期内联 `<script>`、外链 CSS（exit 1）、归档期 `GM-4278` 陈旧描述符、`GM-4283` 归档内联；修复后回到原 sha256 | **通过** |
| 1.0.0 → 1.0.1 旧 save 兼容 | 同上 | 评估者实操：`save.schemaVersion 1→2` + 双版本 `deserialize`，1.0.0 存档载入 1.0.1 → Continue 恢复 score 20/pickups 2 并写回 v2、损坏档安全重开；node 断言 16/16 | **通过** |
| 命令可执行、可移植、无本机路径 | automated | `scripts/check.mjs` 扫描 `/Users/` 零命中；Skill 命令逐条实测 exit 0 | **通过** |

#### 11.4.1 评估暴露缺陷的修复

**Skill（`skills/dsh-game-developer/**`）**
- P1：① 「零 npm 依赖/离线」错误陈述 → 改为明确 `npm install` 前置（M2 起 `yauzl@3.4.0` 是 `validate/pack` 的依赖）；② 1.0.0→1.0.1 旧存档的 Simulator 步骤不可执行 → CLI 新增 dev-only `--seed-save/--save-out` 与 `/dev/save/export|import`，Skill 按实际 flag 写可执行步骤；③ 投稿材料缺生成步骤 → 补 `submission.draft.json` 生成、`pending[]` 白名单与 `validateSubmission(draft)` 调用命令。
- P2：ZIP publish `--url` 约束；`filesDigest` 命名统一；`dev` 的端口/health/停止；`save.schemaVersion` 升级语义。
- P3：模板文案、`styles/` 路径、`package.json` 版本一致性、ZIP 两层 iframe 说明。

**产品（`scripts/cli/**`、`templates/**`、`docs/developer-guide.md`）**
- PD-1 `publish` 的 review-checklist 按格式措辞；PD-2 upload-plan/registry-entry/submission 统一 `filesDigest`；PD-3 `validate` 失败不再误报 `(0 bytes)`；PD-4 `dev --help` 补齐专属选项与两层 iframe 说明；PD-5 模板去除残留示例名；PD-6 developer-guide §5 按格式说明 `/game`（ZIP 故意 404）。
- P1-A 无 `node_modules` 时 `E_TOOLCHAIN_DEPS_MISSING`（exit 2 + `npm install` hint），不再裸模块错误。
- P1-B 新增 dev-only 存档导出/导入（`--seed-save`/`--save-out`、`/dev/save/export|import`），生产 Host 不暴露。

验证：CLI **74/74**、全仓 **1163/1163**；Skill 命令逐条实测（评估者首轮报告 + 修复后复验）。

### 11.5 CR7 回归（M1 已修，不得回归）

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| 所有 HTML/SVG 文档带 asset CSP，同源第二页外发 sink 零请求 | isolated-browser | `raw/m2/M2-CR7-document-csp-2026-10-20T08-01-43-798Z.json` **21/21 required**（响应头逐指令 + sink 0 请求/0 upgrade + 同源读取 200 正对照） | **通过** |
| 历史目录复用与失败保护 | automated + isolated-browser | host 用例（回滚/同版本不同内容 409/记录写失败不删复用目录）+ 生命周期证据（回滚后目录 inode+mtime 证明复用） | **通过** |
| ZIP 原始字节上传 | isolated-browser | 生命周期证据：UI 点击 → `application/zip` → CDP 原始 body sha256 = 源 ZIP | **通过** |
| 旧 HTML 对照 | isolated-browser | 生命周期证据：同流程 HTML 安装 200 + `format=html-v1` | **通过** |
| **卸载清理保留的 previous 版本目录（M2 新发现并修复）** | automated + isolated-browser | `raw/m2/M2-lifecycle-zip-*.json`（47/47）；host 用例 225/225 含 6 条新卸载用例 | **通过** |

### 11.6 非内置 ZIP 全生命周期（真实 UI 点击）

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| 安装 → 启动 → 存档 → 退出 Continue → 升级 1.0.1 → 回滚 1.0.0 → 旧 save Continue → 同版本不同内容 409 → 记录写失败恢复 → 重启恢复 → 卸载 | isolated-browser | `raw/m2/M2-lifecycle-zip-2026-10-20T07-39-01-494Z.json` **47/47 required，exit 0** | **通过** |

## 11.7 CR8 复核轮（Codex 对 M2 head `a76f701` 的 5 项意见）

| 条目 | 级别 | 修复 | 证据 |
|---|---|---|---|
| **CR8-01** 卸载跟随游戏根/祖先符号链接删外部文件 | P1 安全 | 卸载清理改为**先 realpath 边界**：祖先/根任一段是链接 → 不遍历（祖先只 warning、根只 rename 链接本身）；根非目录 → 只处理链接；`readdir` 前后 `lstat` 比对 `dev+ino` 防换链；子项 realpath 包含检查 + 不跟随链接的 unseal | host **231/231**（新增 2 条：根链接、祖先链接）；外部哨兵目录 3 文件 sha256 前后一致；正常卸载不回归 |
| **CR8-02** 删除素材摘要绕过 V2 素材审核 | P1 安全 | 新增 `scripts/registry/lib/media.mjs` 统一绑定：catalog 的 `url+size` 必须存在，`sha256` 可**从可信 review 补足**但补足后**仍真实下载重算**；两边都缺 → `E_PUBLISH_MEDIA_UNBOUND`（绝不跳过）；可信历史增加 media 指纹，已发布 release 不能改素材 URL | publish-zip **19/19**：删摘要+换 URL → `E_PUBLISH_MEDIA_UNBOUND` 且**零下载零写入**、素材 404 → `E_PUBLISH_DOWNLOAD_FAILED`、内容不符 → `E_PUBLISH_SHA_MISMATCH`、review 也无摘要 → 拒绝、正向完整/补足各一条、已发布改 URL → `E_CATALOG_IMMUTABLE` |
| **CR8-03** 轨道信使第二局不结算 | P2 | 新增 `games/orbit-courier/src/run-sessions.js` 每局账本：`beginRun()` 自增 runId、`settle()` 按 token 幂等、**同步**发 `score.submit`+`session.end` 并立即弹窗、异步结果只在 token 仍当前局时清存档；删除跨局 `sessionStarted/sessionEnded` 布尔 | 游戏 **42/42**（新增 7 条：两局/三局、pending 不串局、重复 settle、恢复局、host 失败、未开局 no-op）；真实宿主 run1 1392 → run2 9392 → run3 432，三局弹窗各一次、sessions 3 条独立 playSessionId |
| **CR8-04** 缺描述符的内置包被当成「未分发」 | P2 | `builtinPackagePresent()` → `builtinPackageShipped()`：**只看 `dist/` 是否存在**，不看描述符；ENOENT/ENOTDIR → 未分发（skip），**EACCES/EPERM 等 → 仍视为已分发**（可见损坏）；描述符缺失/不可读 → `issue='package-invalid'` + `/launch` `GM-4277`，builtin id 保护继续生效 | host **231/231**（15 条 builtin 用例）：删描述符仍可见+不可卸载+安装同 id `GM-4002`；删整个 dist → 未分发；`chmod 000` → 可见损坏；正常 dist 不回归 |
| **CR8-05** 探针重启后泄漏 Host、打印 PASSED 不退出 | P2 | `lib/lab.mjs` 的清理闭包改为**解引用当前 Host**（`get host()`）；新增 `handle.restart()`：先 kill → await exit（10s 超时抛错）→ 端口拒连证明 → 再起新 Host；5 个探针 `finally` 不再吞清理异常（失败强制 exit 1）；新增 `self-check-cleanup.mjs` 覆盖成功/断言失败/重启三条路径 | lifecycle **48/48 required，exit 0，real 31.82s，进程自行退出**；退出后 58420/58421/9522 无 LISTEN、无残留进程；self-check 三条路径 exit 0/1/0、总 real 10.41s，断言「自然退出 + 端口拒连 + PID 已死 + home 删除」 |

**修复后全量**：`node --test` **1189/1189 pass**、`CHECK OK (42)`、构建字节可复现（`client.js`、orbit dist、两代 registry）。

**已知边界（不作通过项）**：CR8-01 的 TOCTOU 仅剩「目录内部 walk 期间被换链」的极窄窗口（Node 无 openat/fd API，需 dataRoot 本地写权限，已如实记录）；CR8-04 的「是否随包分发」仍是 Host 激活时快照（构建中途增删需重启，与 M2-B 既有语义一致）。

## 12. M2 已知项与未验证项（不写成通过）

1. **`html-v1` 仍未 wrapper 化**：M2 不改变其服务路径；迁移方案见
   `docs/V1.5-HTML-V1-WRAPPER-MIGRATION.md`，交 Codex 裁决。**不得宣称所有格式均已实现包外导航阻断。**
2. **React 真实依赖链**（`npm install` + vite）：本仓库环境不跑；由独立验收探针在真实
   `npm install` 工程里验证过（`tsc`/vite/pack/validate），但**不是**在 CI 里自动执行。
3. **GitHub Actions 未在真实 CI 执行**：workflow 静态断言 + 模板生成测试覆盖。
4. **CLI `publish --registry-dir` 对 ZIP**：指向维护者工具 `scripts/registry/prepare.mjs`（权限边界，非缺失）。
5. **真实 Electron 桌面窗口 / 非 Chromium 引擎 / 触摸设备**：未验证（证据为 Chrome headless + CDP）。
6. **`@font-face` 经资源 origin、多窗口并发 renew/release**：沿用 M1 未验证项。
7. **磁盘满 ENOSPC 与 `zipExtractMs` 挂钟上限**：无夹具，未验证。
