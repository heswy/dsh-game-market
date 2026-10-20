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

---

# V1.5 M3 验收矩阵（平台插件持续更新 · U02–U06）

> 状态：**M3 交付记录（骨架；V1/V2 真实验证证据提交前不构成放行依据）**。M3 只做契约 §9 与
> `docs/verification/v1.5/m3-decisions.md` 冻结的范围：官方固定索引发现、原生 `pluginManager` 更新 adapter、
> 活跃实例保存协调、Host/Client 双端核验、Client 更新 UI、维护者 release 工具、隔离真实 DSH 验证。
> **M4/M5 不在本阶段**；`html-v1` wrapper 迁移按既定决策是 **M4 前置独立提交**
> （`docs/V1.5-HTML-V1-WRAPPER-MIGRATION.md` §4.1），M3 不夹带该迁移，也**不得**宣称 `html-v1` 已具备包外导航阻断。
>
> - 记录日期：2026-10-20。分支 `feat/v1.5-platform-update`；基线 `origin/main` `40d701678e96d99e777520debb43e25b28ae2d0c`
>   （PR #8 M2 合并提交）。
> - 固定 head（PR-candidate）：**`R_final2`（待 Lead 回填 40-hex 后替换本文占位）**。前一次候选
>   `5c233445b943aaf7c6795c324fa0e456cb1b805e`（package 1.3.0）因全量门禁在自动发现的 manual client smoke 上失败
>   （test-only 缺陷）被 Lead 废弃，**不作为验收 head**。
> - 证据级别：`automated` / `isolated-host`（隔离 `dsh web` + 真实插件服务）/ `isolated-browser`（CDP + 真实 DSH
>   页面/真实 Client 代码）/ `isolated transport fixture` / `real-Desktop` / `not-run`。**未跑就是 not-run，不写成通过。**
> - 主证据索引：`docs/verification/v1.5/plugin-update-m3.md` + `docs/verification/v1.5/raw/m3/`。

## 13. 门禁总表（固定 head 与全量门禁）

| 项 | 值 / 命令 | 结果 |
|---|---|---|
| 固定 head | `R_final2`（Lead 回填 40-hex SHA） | **待回填** |
| 前一次候选（废弃） | `5c23344…`，package 1.3.0 | **不作为验收 head**（全量门禁 manual client smoke 失败，test-only；Lead 重做 release commit）；其构建确定性数据仅作历史参考 |
| 基线 | `origin/main` `40d701678e96d99e777520debb43e25b28ae2d0c` | 已记录 |
| 分支 / 远端 | `feat/v1.5-platform-update`；origin 同名分支 | 已推送；**无 `verify/*` 额外 ref、无 tag** |
| 完整门禁（预发布候选） | `npm install && npm run verify` @ 提交树 `7e952f2` | **1463/1463 pass，exit 0；`CHECK OK (43)`；连续两次构建字节一致；构建后工作树干净**（Lead 执行） |
| 完整门禁（固定 head） | 同上 @ `R_final2` | **待回填**（不得把 7e952f2 的数字当成固定 head 的结果） |
| 静态检查 | `node scripts/check.mjs` | 预发布候选 `CHECK OK (43)`；废弃候选 `5c23344` 上本次只读复跑 **`CHECK OK (44)`**（含 release identity/证据跟踪断言，仅排查用、**不作为固定 head 门禁**）；固定 head 待回填 |
| 构建确定性 | `release:prepare` 两次构建 / 两次 `/tmp` 重建对比 | 预发布候选两次构建字节一致；`5c23344` 的 `client.js` sha256 `d7a2d7f0…`（内嵌 `version=1.3.0`、`buildCommit=c29af5a…`）与两次 `/tmp` 重建一致；`R_final2` 待回填 |
| 实现测试独立复跑（提交树 `61c890e`） | `run-implementation-tests-evidence.mjs --ref 61c890e…` | shared **13/13**、host **291/291**、client **249/249**、release-tools **37/37**，exit 0 [证据](raw/m3/M3-implementation-tests-committed-ref-61c890eba46a-2026-10-20T12-20-41-657Z.json) |
| 实现测试复跑（最终代码树 `7e952f2`） | 同上 | shared 13/13、host 292/292、client 255/255、release-tools 37/37，exit 0 [证据](raw/m3/M3-implementation-tests-committed-ref-7e952f277c24-2026-10-20T12-24-04-731Z.json)（Lead 检查点 `f020d0c` 提交） |
| 真实隔离验证 | V1/V2 runner（`plugin-update-m3.md` §3/§4） | **not-run（进行中）**；已完成的只有 V0（`plugin-update-m3.md` §1） |

**环境身份（V0 已自证）**：DSH `0.2.1-rc.2`（desktop / desktop-runtime / plugin-manager 同版），app.asar sha256
`b9ec4c2bbc20c9dbc3e39fa4c961434a943434ab0a803052b26753dd15f3b066`（182,833,898 B）；Node `v24.14.0`；
Chrome `155.0.8059.85` headless（CDP）；隔离根 `/tmp/dsh-v15/m3/**`，未读写 `~/.dsh`、App 安装目录、生产索引
[V0 harness 证据](raw/m3/M3-V0-harness-2026-10-20T11-48-47-688Z.json)。

## 14. 验证用 probe releases 与发布身份（staged）

**纪律**：本轮**不写生产索引、不打 tag、不创建 GitHub Release、不合并 main**。`R_A`/`R_B` 是验证专用 probe release
（与最终代码树同源的 release-style commit，不发布），`R_final2` 是可被真实 profile 精确安装、可自证身份的
PR-candidate release-style commit（不发布、不打 tag）。

| 代号 | commit（40-hex） | package | `release.json.clientBuildCommit`（= 父版本提交 P） | `release.json.artifacts.sha256` | tag/Release | 可达性 |
|---|---|---|---|---|---|---|
| `R_A` | `2e2c1fc86dff365d0acf08c6e53a97c86da6a1e6` | 1.2.1 | `694f521f3abe82e607c271076175ec1a770a8d5c` | `d478abe8e09e947f10f8d7c565f045778f9b20c6b0089fbed712c05db7161807` | 无 | `origin/feat/v1.5-platform-update` 的祖先（无额外 ref、无 tag） |
| `R_B` | `70aacee9444f16bc2df1ffbcc71155f2a509e16e` | 1.2.2 | `8bef927d9355bd3a788047acf384398239fea022` | `3345d26883a3537e89a3587d363df334545919589ab7faefff01a9d57e029bd9` | 无 | 同上 |
| `R_final2` | **待回填** | 1.3.0 | **待回填** | **待回填** | 无 | = PR-candidate head（待回填后复核祖先关系） |
| （历史）`R_final-1` | `5c233445b943aaf7c6795c324fa0e456cb1b805e` | 1.3.0 | `c29af5a17beb91e667d847388088585ced2c1fc4` | `ea8d07fe1698b29a287a37f45543fd1851c2e23600dd3ba41f421fc7bcc823c8` | 无 | 已废弃为 head；仅作构建确定性数据来源 |

**记录方式（只读、可复现）**：

```bash
git show <sha>:package.json                                  # package version
git show <sha>:platform-updates/release.json                 # release identity + artifacts digest
git merge-base --is-ancestor <sha> origin/feat/v1.5-platform-update   # 可达性（expect exit 0）
git tag --contains <sha>                                     # 期望空
git ls-remote origin 'refs/heads/verify/*'                   # 期望空
```

`R_final2` 回填后必须复跑以上命令，确认 `R_A`/`R_B` 仍为其祖先；若 Lead 重建历史导致分支重写，本表整体失效并重记。
`R_A`/`R_B` 的**精确 commit 安装性**由 V1 的 `install-exact-commit`（真实 `pluginManager.installBundle`）提供；
V0 已用已发布 v1.2.0 `f422e8d04b3b3de3f920a794317c0d28ee1246a2` 证明该 helper 与安装路径可用
（31/31，exit 0，[证据](raw/m3/M3-V0-exact-install-2026-10-20T11-51-54-704Z.json)），但**不覆盖** `R_A`/`R_B`
本身（not-run）。

**两段式身份（无自引用）**：`release.json.clientBuildCommit = P`（`R` 的父版本提交），Client 只上报自身编入的
`{version, buildCommit}`，Host 从自身包内 `release.json` 读取期望的 Client 身份；`updated` 要求 Host 运行身份
（激活冻结）与 Client 自报身份同时匹配目标且 `/health` 健康。索引条目由 `release:promote` 生成在**另一个提交/PR**，
工具拒绝自引用；本轮不执行真实 promote 到生产索引。

## 15. U02：已装 A → 索引指 B → 一次更新 → 双端 B → 可继续（M3 主路径）

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| 隔离 fresh profile 一次性精确安装 `R_A`（真实 `pluginManager`，非 dev row） | isolated-host | V1 runner 待跑；V0 已证明同形态 helper 可用（v1.2.0，31/31） | **not-run**（A/B 目标待 V1） |
| 固定官方索引（传输层夹具）发现 `R_B` 目标并展示版本/commit | isolated transport fixture + isolated-browser | V0 发现矩阵 160/160（valid/cache/refresh）；V1 动态切换夹具目标 | **发现层已通过（夹具）**；真实 Client UI 链路 **not-run** |
| 真实 Client UI 一次更新：确认对话框（明确影响 profile 所有会话、可能需重启）、协调、`inspecting→installing` 进度 | isolated-browser | V1 待跑 | **not-run** |
| `installBundle` 真实 Remote Result：外层 `ok` + `application` + `packageResult.exitCode` 同时核对 | isolated-browser | V1 待跑；M0 已用独立操作者实测 HMR `applied`（Host-only） | **not-run（M3 链路）** |
| `applied`（中间态）→ `activating` → `updated`：Host 激活冻结 `loadedVersion`/`buildCommit`、Client 自报 `buildVersion`/`buildCommit`、`/health` 三者匹配目标 | isolated-browser | V1 待跑 | **not-run** |
| 更新后存档/配置（`storages/dsh-game-market`、saves、preferences）保留，游戏可继续 | isolated-browser | V1 待跑；M0 证明包变更不触碰 storages（Host-only fixture） | **not-run** |
| 连续第二次更新 `R_B → R_final2` 证明可持续（非一次性） | isolated-browser | V1 待跑 | **not-run** |
| UI 在 `updated` 之前不得显示“已更新/已是最新”；`applied` 不是成功态 | isolated-browser + automated | Client 状态映射/no-fake-success 单测通过（计数见 §13）；真实 UI 文案断言归 V1 | **自动化层通过；真实 UI not-run** |

**U02 结论：not-run。** 只有 V1 证据提交、且本表逐行有 committed raw JSON + 命令 + exit code 后才可改判。

## 16. U03：失败/恢复状态真实可恢复（网络/磁盘/权限/兼容性/取消/applying/响应丢失/`waitForInstall` null/旧 Client 新 Host）

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| `waitForInstall()===null` 不当成功：重读 install-state/实际版本，无法确认 → `verification-failed(response-lost)` | automated | Host 目标测试（`v1.5-platform-update-operations.js`，计数见 §13） | **实现层通过**（假 manager 确定性分支）；真实宿主响应丢失 **not-run** |
| 安装中 Client 刷新/丢 RPC：Host 持久记录恢复观察，无伪成功，终态正确 | isolated-browser | V1-3 待跑；Host 恢复 seam 由 `update-operations.js#recoverFromRecord` 覆盖（`reopen()` 模拟，契约 §17.3） | **not-run**（真实浏览器） |
| HMR dispose 存活：被更新 bundle row disposal/re-apply 期间操作持有者存活、操作收敛到终态 | isolated-browser | V1-4 待跑；M0 已实测独立探针操作者跨 A→B→C/removeBundle 存活 | **not-run（M3 链路）** |
| 非 HMR：`pending-restart(no-hmr)` → 重启 → `activating→updated`；重启前证明磁盘新/运行旧（不得用 hostEpoch 当重启证据） | isolated-browser | V1-5 待跑；M0 已实测 `restart-required` + 旧代码继续运行（Host-only，隔离 profile） | **not-run（M3 链路）** |
| 旧 Client + 新 Host → `stale-runtime(client-old)`；刷新后进入 `updated`，期间不重复安装 | isolated-browser | V1-6 待跑 | **not-run** |
| `ambiguous-install` 不无条件吞掉：核对实际版本/commit，同目标 → `already-at-target`，否则 `verification-failed` | automated | Host 目标测试；M0 已实测 URL 形态重复安装的原始行为 | **实现层通过；真实 V2-4 not-run** |
| 取消三态：installing 期 cancel → `cancelled`；applying 期 → `too-late` 继续观察至终态，绝不显示“已取消/已回滚” | automated + isolated-browser | Host 目标测试；M0 实测 `cancelInstall` 三态；真实 M3 取消 V2-5 待跑 | **实现层通过；真实 not-run** |
| 网络/磁盘/权限/兼容性失败：区分“失败，旧版本仍运行”与“需恢复旧版本”，不得笼统报错 | automated + isolated-browser | Host adapter 错误映射测试；真实 ENOSPC/权限注入归 V2 | **实现层通过；真实故障注入 not-run** |
| 失败恢复入口可操作、修复后重新 begin 成功、持久记录无卡死锁 | isolated-browser | V2-9 待跑 | **not-run** |
| `applied` 绝不当成功、UI 不出现伪百分比 | automated + isolated-browser | client/Host 状态映射测试；V1 真实 UI 待跑 | **实现层通过；真实 UI not-run** |

**U03 结论：not-run。** 自动化分支覆盖不等于真实宿主失败路径已验收。

## 17. U04：多窗口/多 Session 协调、不偷换 dev/link、禁用状态保留

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| 两窗口同时点更新：同一 `operationId`、无重复 `installBundle`、两端收敛同一终态 | isolated-browser | V2-1 待跑；Host 幂等/并发 begin 目标测试通过（automated） | **not-run（真实）** |
| 单窗口快速重复点击幂等 | automated + isolated-browser | Host 目标测试；真实 V2-1 待跑 | **实现层通过；真实 not-run** |
| 活跃实例保存失败：更新在包变更**之前**中止、无 `installBundle`、旧版本仍运行、UI 可操作提示 | automated + isolated-browser | Host 协调/中止目标测试；真实游戏实例故障注入 V2-2 待跑 | **实现层通过；真实 not-run** |
| 恢复保存后重试成功 | isolated-browser | V2-2 待跑 | **not-run** |
| 跨窗口两个活跃实例都必须暂停+确认，缺一不进入包变更 | automated + isolated-browser | Host 聚合逻辑目标测试；真实 V2-2 待跑 | **实现层通过；真实 not-run** |
| 未响应实例超时（15s）阻断 | automated + isolated-browser | Host 目标测试；真实 V2-2 待跑 | **实现层通过；真实 not-run** |
| dev/link 来源不被静默替换：显示“开发模式，前往插件管理切换安装来源”、不调用 `installBundle` | automated + isolated-browser | M0 U2-10 行为实测；Host dev-row 识别目标测试；真实 V2-7 待跑 | **not-run（真实 M3）** |
| 安装前记录 enabled/config/dataRoot，更新后禁用状态等不丢失 | automated | Host 记录/恢复目标测试；真实数据保留 V1-7 待跑 | **实现层通过；真实 not-run** |

**U04 结论：not-run。**

## 18. U05：HMR 与无 HMR 分别记录；不支持模式禁用并有恢复入口；不伪报、不擅自移除用户插件

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| 真实 DSH Desktop 默认是 HMR 能力开启（推翻旧“非 HMR Desktop”前提） | isolated-host（M0 探针）+ 进程事实核对 | `docs/verification/v1.5/plugin-update.md` §1/§2、`support-matrix.md` §3、M0 raw `raw/plugin-update/s-u2-hmr/boot1/boot.json` | **已实测（M0，Host-only；不是 M3 端到端）** |
| HMR 判定 = 树稳定后轮询采样；`absent` 需收敛窗；翻转/抛错/超时 → `unknown`（fail-closed） | automated | Host adapter 目标测试（契约 §9.2/§17.2 条目 12）；M0 时序实测 | **实现层通过** |
| M3 HMR 路径真实更新（in-place）并双端确认 | isolated-browser | V1-1/V1-2 待跑 | **not-run** |
| 无 HMR（显式禁用 `hmr` row 的隔离 profile）：真实更新 → `pending-restart`，重启后双端 `updated` | isolated-browser | V1-5 待跑；M0 已实测宿主返回与旧代码继续运行 | **not-run（M3 链路）** |
| 能力 `unknown`：`canBeginUpdate=false`、原因可读、市场/游戏不受影响、不显示可执行更新按钮 | automated + isolated-browser | Host 目标测试；真实 V2-6 待跑 | **实现层通过；真实 not-run** |
| 不支持模式有原生恢复入口（插件管理），不谎称一键可用 | isolated-browser | V2-6/V2-7 待跑 | **not-run** |
| 不伪报已升级（`applied` 中间态；`stale-runtime`/`verification-failed` 不显示成功） | automated + isolated-browser | client/Host 状态映射测试；V1 真实 UI 待跑 | **实现层通过；真实 not-run** |
| 不为测试移除/替换用户插件；所有安装只在隔离 `DSH_HOME`，未碰 `~/.dsh` | 合规记录 | 各 runner 断言隔离根前缀、拒绝 `~/.dsh`；清理自证 | **合规（已执行）** |

**U05 结论：not-run（M3 端到端）；能力事实与禁用语义有 M0/自动化层证据。**

## 19. U06：release commit/两种构建身份/index/version 一致；不可变 target；stable 最后推广；旧通道不被推到 prerelease；撤回不隐式降级

| 子项 | 级别 | 证据 | 结论 |
|---|---|---|---|
| release commit 身份一致：`package.json.version` = `release.json.version`；`clientBuildCommit` = 父版本提交 P；产物 digest 与 `release.json.artifacts` 一致；无自引用 | automated（静态 + 工具链） | release-tools 37/37（§13）；§14 只读 `git show` 记录；`5c23344` 上只读复跑 `node scripts/check.mjs` = `CHECK OK (44)`（含 release identity 断言） | **R_A/R_B 身份已核对（只读 git）；`5c23344` 身份断言通过（已废弃 head，仅参考）；`R_final2` 待回填复核** |
| Client 构建身份：`client.js` 内嵌 `{version, buildCommit}` 且确定性构建；Client 只上报自身身份、不回填 Host 值 | automated + isolated-browser | client/release 套件；V1 双端核验待跑 | **实现层通过；真实 not-run** |
| 索引格式 1 严格校验 + 官方仓库/插件名/`source.type=git`/完整 40-hex 绑定；拒绝 branch/tag/短 SHA/本地路径/file:/任意仓库 | automated + isolated transport fixture | 共享契约 13/13；V0 发现矩阵 160/160（恶意索引/绑定拒绝用例） | **通过（单元/夹具层）**；生产索引未抓取 |
| 不可变 target：`begin` 只接受当前已验证发现记录的 `targetId`；伪造/任意 spec → `GM-4090`（能力缺失 `GM-5038`） | automated + isolated-host | Host 路由/adapter 目标测试；V0 begin fail-closed（H1 基座 `GM-5038`；H2 后 `GM-4090` 由 V2-8 复核） | **实现层通过；真实 V2-8 not-run** |
| `release:promote` 拒绝自引用、拒绝 stable 通道 prerelease、默认 dry-run 零远端写；索引必须是独立提交 I | automated（dry-run） | release-tools 37/37；本轮未执行真实 promote | **通过（dry-run/工具层）；真实推广 not-run** |
| stable 通道排除 prerelease；test 通道显式 opt-in，普通 UI 不提供一键切换 | automated + isolated transport fixture | 共享契约；V0 矩阵 `prerelease-stable`/`test-channel-optin` | **通过（夹具层）** |
| 旧通道用户不被推到 prerelease；stable 最后推广（test 先演练） | — | 真实索引推广流程未执行（本轮不写生产索引） | **not-run / 未验证** |
| 撤回不隐式降级（索引移除目标后不降级安装） | — | 本轮无撤回演练证据 | **未验证（不得写成通过）** |
| 本轮无生产索引写入、无 tag、无 Release、`origin/main` 未变 | 合规记录 + isolated transport fixture | 夹具证据（生产索引文件运行前后不存在/未变）；`git tag --contains` 为空；`origin/main` 仍 `40d7016`；未执行发布命令 | **合规（GitHub Release 页面未由本地核验）** |

**U06 结论：工具/夹具层通过；发布流程端到端 not-run。**

## 20. M3 已知项与未验证项（不写成通过）

1. **真实 Desktop / Electron 主进程**：全部 M3 证据来自隔离 `dsh web` + headless Chrome；真实 App 内 Electron 网络栈、
   原生窗口 UI、真实用户 profile 未验证（不碰 `~/.dsh`）。
2. **生产官方索引**：从未抓取/写入生产索引；夹具 body 是验证数据，不证明线上索引当前格式正确。
3. **V1/V2 全部端到端场景未跑**：HMR A→B→R_final2 双端核验、RPC 丢失/刷新恢复、HMR dispose 存活、非 HMR 真实重启、
   混合态、多窗口并发、活跃实例保存阻断、取消/too-late、能力 unknown、dev-row、恶意索引/非法 target、失败恢复、
   清理自证——全部 `not-run`（见 `plugin-update-m3.md` §3/§4）。**不得用 Host 目标测试代替真实链路。**
4. **跨进程 profile 更新锁**：Host 目标测试只证明逻辑与锁复用；真实两进程竞争未压测（契约 §17.3 未验证项 3）。
5. **真实故障注入**（ENOSPC/权限、游戏运行中保存失败）：自动化用假 manager/注入；真实隔离 profile 注入归 V2。
6. **非 Chromium 引擎 / headed 真实窗口 / 长时 soak**：未验证。
7. **夹具方法的 Node 依赖**：`NODE_USE_ENV_PROXY` 是 Node 24 行为；Electron 主进程是否同样尊重该 env 未验证。
8. **`html-v1` wrapper 迁移**：M3 不涉及，仍为 **M4 前置独立提交**；不得宣称所有格式已阻断包外导航。
9. **两段式 release 的“生产推广/回滚”**：本轮只 dry-run 与身份核对；真实 stable promote、旧通道用户升级、撤回演练均未执行。
10. **`5c23344` 的废弃原因**：全量门禁在自动发现的 manual client smoke 上失败（test-only）；`R_final2` 修复后需重新跑
    全量门禁与两次构建，本文档只认 `R_final2` 的门禁数字。

## 21. 证据索引（M3 已提交部分）

| 证据 | 内容 | 结果 |
|---|---|---|
| [M3-V0-harness-2026-10-20T11-48-47-688Z.json](raw/m3/M3-V0-harness-2026-10-20T11-48-47-688Z.json) | 隔离 harness：运行时身份/解包一致性、真实 DSH 页面、Host 路由、清理自证 | 33 checks / required 32 全过，exit 0 |
| [M3-V0-fixture-2026-10-20T12-13-15-362Z.json](raw/m3/M3-V0-fixture-2026-10-20T12-13-15-362Z.json) | 固定官方索引 URL 的传输层夹具：透传/隧道/负向对照/Host 进程内 fetch/生产索引未写 | 28 checks / required 27 全过，exit 0 |
| [M3-V0-exact-install-2026-10-20T11-51-54-704Z.json](raw/m3/M3-V0-exact-install-2026-10-20T11-51-54-704Z.json) | 一次性精确 commit 安装 helper（真实 `pluginManager`，v1.2.0 目标） | 31/31，exit 0 |
| [M3-V0-discovery-matrix-2026-10-20T12-10-36-937Z.json](raw/m3/M3-V0-discovery-matrix-2026-10-20T12-10-36-937Z.json) | 发现策略矩阵（真实 Host 路由 + 夹具；valid/节流/超时/超限/offline/异常/恶意索引/通道/client-report/begin fail-closed） | 160/160 required 全过，exit 0 |
| [M3-V0-h1-tests-committed-ref-6d94779eae88-2026-10-20T12-06-26-690Z.json](raw/m3/M3-V0-h1-tests-committed-ref-6d94779eae88-2026-10-20T12-06-26-690Z.json) | H1 提交树独立复跑 | shared 13/13 + host 245/245，exit 0 |
| [M3-implementation-tests-committed-ref-61c890eba46a-2026-10-20T12-20-41-657Z.json](raw/m3/M3-implementation-tests-committed-ref-61c890eba46a-2026-10-20T12-20-41-657Z.json) | M3 实现测试独立复跑（提交树） | shared 13/13、host 291/291、client 249/249、release 37/37，exit 0 |
| [M3-implementation-tests-committed-ref-7e952f277c24-2026-10-20T12-24-04-731Z.json](raw/m3/M3-implementation-tests-committed-ref-7e952f277c24-2026-10-20T12-24-04-731Z.json) | 最终代码树实现测试复跑（提交树 `7e952f2`） | shared 13/13、host 292/292、client 255/255、release 37/37，exit 0 |
| （待跑）`M3-V1-*.json` / `M3-V2-*.json` | 真实 Client UI 更新链 / 边界与协调场景 | **not-run** |
