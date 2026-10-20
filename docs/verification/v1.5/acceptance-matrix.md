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

## 8. 已知项与未验证项（不写成通过）

1. **`html-v1` 未 wrapper 化**：M1 只为 `asset-zip-v2` 引入 wrapper，`html-v1` 仍走 V1 `/entry` 直嵌，
   §7.5.1 的「包外导航阻断」对 `html-v1` **尚未生效**。属已知项；覆盖它需要 M2/M4 的兼容性决策。
2. **`dshWebOrigin` 未从 DSH 接线**：wrapper/入口 CSP 的 `frame-ancestors` 走
   `settings.security.frameAncestors` allowlist 回退（`'self' + http://127.0.0.1:* + http://localhost:*`，
   覆盖当前 loopback GUI，但非精确 origin）。非 loopback DSH Web UI **未验证**。
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
