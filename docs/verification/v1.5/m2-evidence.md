# M2-F1 真实设备 / 浏览器证据

> 任务：M2-F1 真实设备/浏览器证据（v1.5）+ PR #8 CR8 复核补齐
> 工作区：`dsh-game-market-worktrees/v1.5-game-and-tooling`（PR #8 head `a76f701` + 本轮未提交 CR8 修复，稳定构建）
> 环境：DSH `0.2.1-rc.2`（desktop-runtime / plugin-manager / electron 同版），Node `v24.14.0`，真实 Chrome `155.0.8059.85` headless（CDP 驱动）
> 证据目录：`docs/verification/v1.5/raw/m2/`（JSON + 截图；仅本目录与脚本/报告为本次交付，**未 commit**）
> 封版身份（CR8 修复后重建）：`client.js` sha256 `4b7d2d19…`；`orbit-courier` descriptor sha256 `16976945…920bd`（25 entries = 24 files + descriptor）；全仓 `node --test` **1189/1189**、`CHECK OK (42)`；分项：orbit-courier **42/42**、host **231/231**、publish-zip **19/19**（本机复跑，见 §5.1）

## 0. 总表

| # | 探针（命令均在 worktree 根执行） | required | 结果 | exit | 证据 |
| --- | --- | --- | --- | --- | --- |
| A08 | `node scripts/verification/v1.5/m2/m2-a08-orbit-courier.mjs` | **34/34**（35 checks，1 条非 required 钩子可用性） | PASSED | 0 | `raw/m2/M2-A08-orbit-courier-2026-10-20T10-43-08-523Z.json`（CR8 修复后构建） |
| CR8-03 | `node scripts/verification/v1.5/m2/m2-cr8-03-two-runs.mjs` | **25/25** | PASSED | 0 | `raw/m2/M2-CR8-03-two-runs-2026-10-20T11-02-45-759Z.json` |
| A02 | `node scripts/verification/v1.5/m2/m2-a02-orbit-resources.mjs` | **21/21** | PASSED | 0 | `raw/m2/M2-A02-orbit-multiresource-2026-10-20T07-36-13-978Z.json` |
| 视觉 | `node scripts/verification/v1.5/m2/m2-visual-responsive.mjs` | **18/18** | PASSED | 0 | `raw/m2/M2-visual-responsive-2026-10-20T07-34-15-454Z.json` |
| 生命周期 | `node scripts/verification/v1.5/m2/m2-lifecycle-zip.mjs` | **48/48** | PASSED | 0 | `raw/m2/M2-lifecycle-zip-2026-10-20T10-26-22-800Z.json`（CR8-05 后） |
| CR7 | `node scripts/verification/v1.5/m2/m2-cr7-document-csp.mjs` | **21/21** | PASSED | 0 | `raw/m2/M2-CR7-document-csp-2026-10-20T08-01-43-798Z.json` |

A/B 早期轮次（保留作缺陷与探针修正对照，非最终结论）：

| 证据 | 结果 | 用途 |
| --- | --- | --- |
| `raw/m2/M2-lifecycle-zip-2026-10-20T06-41-58-541Z.json` | 38/42（4 条红） | 卸载泄漏 defect + 记录写失败后同进程恢复不可行（前 42 检查版本，缺 html-v1 对照） |
| `raw/m2/M2-lifecycle-zip-2026-10-20T07-39-01-494Z.json` | 47/47 | **CR8-05 前**：重启后 Host 泄漏、PASSED 后进程不退出；作清理修复 A/B |
| `raw/m2/M2-A08-orbit-courier-2026-10-20T07-26-49-794Z.json` | 23/31 | orbit 存档 envelope 未解包 / 菜单态覆盖存档 defect；探针盲玩被撞毁、无 `__ORBIT_PROBE__` 钩子 |
| `raw/m2/M2-A08-orbit-courier-2026-10-20T08-40-24-434Z.json` | 34/34 | **CR8-03 前构建**：A08 自身绿，但当时探针未覆盖「同页第二局结算」；作修复前构建 A/B |

## 1. A08 · `orbit-courier` 真实操作（内置游戏，asset-zip-v2）

### 1.1 方法与真实路径

- 通过**真实 Market UI 点击**进入：侧栏「游戏市场」→「我的游戏」→ `orbit-courier` 行 `开始/继续`，Runtime 包装层与游戏 iframe 均为真实产品路径；游戏文档 `window.origin === "null"`。
- 键盘输入：用 CDP `Input.dispatchKeyEvent` **投递到游戏 OOPIF 的 CDP session**（root target 的键盘事件不会到达 cross-origin iframe；实测 root dispatch 无效、iframe session dispatch 生效——见 §6 归因）。事件走浏览器真实输入管线（`isTrusted`），不是 DOM `dispatchEvent`；没有调用游戏内部 API 改状态。
- 只读快照：以 `window.__ORBIT_PROBE__`（`readOnly:true`、`writable:false`、冻结快照）作为 shell 就绪信号与躲避决策输入；字段：`phase/endReason/elapsedMs/timeLeftMs/score/finalScore/deliveries/combo/hull/maxHull/lane/laneCount/stationAngle/ship/cargo[]/asteroids[]/best/audio{...}/at`。快照只读、无 setter、无输入注入。
- 躲避/收集策略：生存优先——按 `asteroids[]` 预测同轨威胁，威胁临近时切到最安全轨道；安全时收集 cargo，持货后切到最安全轨道转向站门交付；不追求分数最大化。
- 退出：先真实按 Space 暂停（`pause()` 立即落盘），再点 Runtime「返回市场」走正式 leave 协议（`pause` + `before-save`，scheduler 等 `storage.save` ACK 后销毁/release）。
- Continue：真实 UI「我的游戏」行「继续」→ runtime 进入 paused → 游戏菜单 `#btn-continue` → 真实 Enter 确认 → 等 snapshot 回到 `playing` 再比较 elapsed/score。
- 墙钟：全部使用真实 `Date.now()` 差值；无时间加速、无改时钟。

### 1.2 一局真打满 ~120 s（shift-complete）

- 首个 session 真实游玩约 43 s → 暂停 → 退出（存档 `paused`）；Continue 后从 42.96 s 继续，跑满到 **120,000 ms** 自然结束，`endReason: "shift-complete"`（`attempts=1`）。
- 本局：score **470**，deliveries **18**，best **606**；Host `/game?id` `bestScore` = **606**（CR8 修复后构建）。
- 关键快照（evidence `scenario.snapshots`）：

| 快照 | phase | elapsedMs | score | deliveries | shield | lane | cargo/asteroids | audio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| playingStart | playing | 80 | 0 | 0 | 3/3 | 1 | 0/1 | unlocked=true, muted=false |
| beforeExit（暂停退出前） | playing | 42896 | 95 | 4 | 3/3 | 2 | 2/2 | unlocked=true, muted=true |
| afterContinueResume | playing | 42992 | 95 | 4 | 3/3 | 2 | 0/2 | unlocked=true, muted=true |
| naturalRunEnded | ended(shift-complete) | 120000 | 470 | 18 | 2/3 | 2 | 2/5 | unlocked=true, muted=false |
| afterFiveMinutes（累计活动 350733 ms） | ended(shift-complete) | 120000 | 660 | 20 | 3/3 | 2 | 3/5 | unlocked=true, muted=false |

### 1.3 暂停/继续与音频

- `Space` 暂停：phase `paused`，1.4 s 墙钟后 `elapsedMs` 不变（±250 ms 容差内）；再按 `Space` 恢复且 elapsed 继续增长（evidence `scenario.pause`，`pauseMethod: keyboard-space`）。
- 音频门控：首个用户手势前 `audio.unlocked=false` 且 `audio.play('collect')===false`；真实键盘手势后 `unlocked=true`、`play('collect')===true`（等缓冲解码后断言）。
- 静音：真实 `M` 键 `muted true↔false`；退出前保持静音，Continue 后 `muted===true` 恢复（存 Host `values` 的静音键）。

### 1.4 存档 / Continue 精确对齐

- 退出前 Host 存档文件实测（`scenario.saves.hostSaveAfterExit`）：`saves/orbit-courier/current.json` 存在，`meta.json {hasSave:true, revision: 15, savedAt:…}`，`values.run = {schemaVersion:1, phase:"paused", elapsedMs:…, score:…}`。
- Continue 后快照：`elapsedMs 42896 / score 95 / muted true` → `elapsedMs 42992 / score 95 / muted true`（elapsed/score/静音均保持；「继续」入口为我的游戏行）。
- 最高分：本局结束后 `best`/HUD/ Host `bestScore` 三者一致（606）。

### 1.5 ≥ 5 分钟实际推进（墙钟）

- 累计**活动游玩**：**350,733 ms**（≥ 300,000 ms）；墙钟区间 `2026-10-20T10:36:09.023Z` → `2026-10-20T10:43:08.503Z`（419,480 ms），活动时长 ≤ 墙钟——真实推进、非 near-time-up、非加速。
- 组成：首个 ~120 s 局 + Continue 后半局 + 2 个 120 s 重开局（均自然 `shift-complete`），运行在同一已挂载 Runtime 中，仅用真实 Enter 确认重开。
- 帧率：活动窗口 rAF 采样 **avg 60.0 fps（4595 rAF / 76,578 ms；分段 60/60/60/60/60）**（`__M2_FPS__` count/ms 增量；headless+CDP 开销下仍稳定推进）。
- CSP/可靠性：全程零 CSP 违规；探针未直接调用任何 Host 写 API/未伪造分数（`no-direct-api-install-from-probe-or-score-forgery`）。

## 2. A02 · 多资源真实加载（内置 `orbit-courier`）

- 真实 UI 启动后，在沙箱内游戏文档逐个 `fetch` 包内资源（浏览器真实请求、走 resource origin）：**20/20 非保留资源 HTTP 200**，**MIME 精确**（`.js→text/javascript`、`.css→text/css`、`.json→application/json`、`.png→image/png`、`.wav→audio/wav`），全部非空；覆盖 ESM 模块、CSS、关卡 JSON（`levels/shift-01.json`）、3 张 PNG、7 个 WAV。
- 保留资源：`dsh-package.json`、`game.json` 仍 **403**（descriptor/manifest 保留语义）。
- 网络层每个 200 资源响应带 §7 头：`access-control-allow-origin: *`（匿名 CORS）、`x-content-type-options: nosniff`、`cache-control: no-store`、`referrer-policy: no-referrer`。
- 双层 iframe：外层 wrapper `sandbox` **无**属性（真实 Host origin）；内层游戏 iframe `sandbox="allow-scripts"`（**无** `allow-same-origin`）、`referrerpolicy="no-referrer"`。
- 游戏文档 `window.origin === "null"`、标题含「轨道信使」、canvas/HUD 真实渲染、ESM `<script type="module">` 生效、关卡 JSON 载入（`shift-01`，duration 120 s）。
- CSP：wrapper `frame-ancestors` 精确 DSH origin（无 `*`）、入口文档带 asset CSP（`connect-src` 收窄到 resource origin）、零 CSP/零 frame-ancestors 违规。

## 3. 375 px / 深色 / reduced-motion（内置 `orbit-courier`）

- CDP device metrics **375×667**（mobile、DPR2）下：页面 viewport 恰为 375×667；游戏文档 viewport 319 宽（Runtime 舞台内），**水平溢出 0 px**、垂直溢出 0；`#hud/#stage/#controls` 全部在视口内；375 紧凑 HUD 规则生效（`max-width:430px`）。
- 深色：`prefers-color-scheme: dark` 命中；游戏背景 `rgb(4,6,15)`（相对亮度 0.002），HUD 文字 `rgb(246,241,228)`，对比度 **17.94:1**（≥4.5）。
- reduced-motion：`prefers-reduced-motion: reduce` 命中；CSS 过渡/动画折叠到 **0.001 ms**（`toast` transitionDuration 全部分量）；no-preference 对照组过渡存在（0.2 s）→ 开关可观测差异。
- 截图：`raw/m2/screenshots/m2-visual-375-dark-reduced.png`、`m2-visual-375-light.png`（含深色/浅色对照；375 全屏）。
- 备注：OOPIF（wrapper + 游戏 iframe）不继承 root target 的 media/device emulation，必须对每个 attached session 下发 `Emulation.setEmulatedMedia`；这是探针实现要点，不是产品缺陷（见 §6）。

## 4. 非 builtin ZIP 全生命周期（独立测试包 `m2-life.zip` / `m2-html-control`）

真实 Market UI 全链路（每轮全新隔离 data root、包一轮只构建一次、上传原始 body 与源文件 sha256/长度/head16 对照）：

1. **UI 安装 1.0.0**（`.dshgame.zip`，`application/zip`）：安装响应 200、`format=asset-zip-v2`、`fileManifestDigest`；上传 raw body sha256 = 源包 sha256、长度一致、`Content-Type: application/zip`。
2. **UI 启动**：我的游戏行进入 Runtime，`__M2_LIFE__` 版本标记 1.0.0、真实 play session、自动存档（interval）观测、分数增长。
3. **退出**：Runtime「返回市场」→ `pause`+`before-save` 落盘；我的游戏行出现「继续」。
4. **Continue**：精确恢复退出前 save（elapsed/score 数组逐字段相等）；再次退出再存。
5. **升级 1.0.1**：UI 安装新版本 200；`packages/<id>/1.0.0` 保留为 previous；1.0.1 启动读取旧存档。
6. **回滚 1.0.0**：UI 安装 1.0.0（回滚）200；**保留目录复用**（目录 inode + mtime 证明未重写、未重新解包），旧存档仍可 Continue。
7. **同 id+version 不同内容**：UI 安装返回 **409 GM-4094**；被拒绝后保留的 previous 目录树完好（不误删/不覆盖）。
8. **记录写失败**：`chflags uchg installations.json` 后卸载/写入被拒（`GM-5025 Storage is read-only`，进程内 readOnly 闩锁）；**复用目录不被删除**；在同一 data root 上重启 Host 后恢复安装成功且复用同一目录（符合「重启才是正确恢复」的契约语义）。
9. **卸载**：UI 菜单+确认后：行消失、`/installed` 记录消失、`packages/<id>` 下**所有版本目录（含 previous）全部清理**；不删除存档（`deleteData:false` 语义）。
10. **旧 HTML 对照**：额外 `html-v1` 本地 HTML 包经同一 UI 安装（format=`html-v1`）、启动渲染（opaque origin、canvas）、卸载成功——CR7「旧 HTML 对照路径仍可用」。
11. 全程无探针直接 API 安装；零 frame-ancestors / CSP 违规。

缺陷记录（已修复，见 §6）：本轮最初发现**卸载只清理 current 版本、previous 保留目录泄漏**（A/B 证据 `06-41-58` 红 4 条）；host-zip 修复后为 **47/47**（A/B `07-39-01`）；CR8-05 修复探针清理后又补一条 `host-cleanup-left-no-listener-after-restart`，稳定构建最终 **48/48 全绿、exit 0、进程自行退出**（最终证据 `10-26-22-800Z`）。

## 5. CR7 回归（同源第二 HTML + 历史目录/409/记录失败/ZIP 原始字节）

- **CR7-01 同源第二个 HTML**（`M2-CR7-document-csp` 21/21）：`second.html` 与入口 `index.html` 的 **CSP 逐指令一致**（`script-src/connect-src/img-src/...`），`frame-ancestors` 精确 DSH origin + resource origin；游戏页真实运行并跑完攻击套件；`sink` 收到 **0 个 HTTP 请求、0 个 WebSocket upgrade**；网络层零外部请求；external fetch/image 被 CSP 真实拒绝；Chrome 违规日志 0 条。
- **CR7-02 历史版本目录复用 / 同版本不同内容 409 / 记录写失败不删复用目录**：由 §4 生命周期探针覆盖（目录复用 inode+mtime、409 GM-4094、记录写失败后目录完好、同 data root 重启恢复）。
- **CR7-03 ZIP 原始字节上传**：安装上传 raw body（`postDataEntries` base64 还原）sha256 与源 `.dshgame.zip` 完全一致，长度一致；Content-Type `application/zip` 保持。
- **旧 HTML 对照路径**：`html-v1` 安装→启动→卸载全通（§4.10，本轮新增，补上 M1 未覆盖的「对照路径仍可用」）。

## 5.1 CR8 复核补充（PR #8 复核轮，CR8 修复后的稳定构建）

本节覆盖 PR #8 复核提出的 5 个问题在**修复后稳定构建**上的复核证据；前四节是 M2-F1 原交付，本节是 CR8 回填。

| 复核项 | 结论 | 本轮证据 |
| --- | --- | --- |
| CR8-01 卸载符号链接穿越 | 已修（host 安全遍历/不跟链接） | `packages/host/test/cases/v1-install.js` CR8-01 用例；host **231/231** |
| CR8-02 媒体绑定（catalog 删摘要/换 URL 绕过 publish） | 已修（摘要+大小绑定，缺失即拒绝且不下载） | `tests/v1.5-publish-zip.test.js` **19/19**（含 9 条 CR8-02 用例） |
| CR8-03 同页第二局不结算 | 已修（每局 run token 账本） | 新增真机探针 **25/25**，本节两局实测 |
| CR8-04 builtin 损坏状态 | 已修（tampered/unreadable fail-closed，健康包不回归） | `packages/host/test/cases/v1.5-builtin-package.js` 用例；host **231/231** |
| CR8-05 探针重启后 Host 泄漏/不退出 | 已修（handle 始终引用当前 Host + 端口拒连证明 + 三条路径自检） | `self-check-cleanup.mjs` 三条路径全绿；lifecycle **48/48** 自行退出 |

### CR8-01 · 卸载不得穿越符号链接

- 代码：`packages/host/src/install.js` 的 package 清理路径全程 `lstat`（不 `stat`/不递归 follow），`packages/` 或游戏根被替换为链接时只做**链接级 rename**，目标目录内容不被访问；命中时返回 `warnings: ['package-path-symlink']`。
- 测试（`packages/host/test/cases/v1-install.js`）：`CR8-01 uninstall never traverses a symlinked game package root`、`CR8-01 uninstall never traverses a symlinked packages ancestor`、`uninstall renames symlinks without following their targets`；host 套件本机复跑 **231/231 pass, exit 0**。

### CR8-02 · 发布媒体绑定（catalog 摘除摘要也必须拒绝）

- 代码：publish 校验把 catalog 的 `media.cover/screenshots` 摘要+大小作为**批准绑定**；catalog 摘要/大小被删、URL 被换、远端字节与摘要不符等任一情况都拒绝发布，且**不会下载**未绑定 URL；已发布 release 的 media URL 不可改写。
- 测试（`tests/v1.5-publish-zip.test.js`）：9 条 CR8-02 用例（stripped binding rejected & never downloaded / tampered catalog blocks publish before any write / missing remote asset / digest mismatch / complete binding positive control downloaded / digest recovered from approved review then real bytes verified / no digest anywhere rejected / published media URL immutable / V1.2→V1.5 migration history passes）；本机 **19/19 pass, exit 0**。

### CR8-03 · 同一页面连续多局都结算（真机）

- 缺陷：boot shell 用两个闭包布尔 `sessionStarted/sessionEnded`，`beginNewRun()` 不重置 → 第一局结算后第二局不再 `score.submit`/`session.end`/弹窗。
- 修复：新增 `games/orbit-courier/src/run-sessions.js`——每局单调 run token；`settle()` 按 token 幂等，**同步发** `score.submit`+`session.end` 并立即弹结算窗，异步结果只在 token 仍为当前局时清存档；best 单调不降。`games/orbit-courier/test/run-sessions.test.js` 7 条用例 + orbit 套件 **42/42 pass**。
- 真机探针 `m2-cr8-03-two-runs.mjs`（**25/25 required，exit 0**，真实 Chrome + 真实 Runtime + 真实 UI 行；同一游戏文档不刷新，页面 mark 与 `performance.timeOrigin` 全程一致）：

| 局 | 结束方式 | 游戏时长 | finalScore | 弹窗 | best | Host 结算记录 |
| --- | --- | --- | --- | --- | --- | --- |
| run1 | shift-complete | 120,000 ms | **917** | 可见，「这一班完成 / 新纪录！」，`#btn-restart` | 917 | `ps_546695f94d3ef51467223e35` completed score 917 |
| run2 | shift-complete | 120,000 ms | **519** | 可见，「这一班完成 / 最高分 917」 | **917（不降）** | `ps_08acb2dd68e1cb9dcc0fa2c1` completed score 519 |
| run3 | wrecked（低分局） | 44,816 ms | **40** | 可见，「船体报废 / 最高分 917」 | **917（不降）** | `ps_6a3d2607cf3d162c4d1955a9` lost score 40 |

- 断言：每局弹窗各出现一次（`finalText` 与 finalScore 一致）；**run2(519) < run1(917)** 时 best 保持 917（Lead 要求的「run2 分数 < run1」情形）；3 条记录 **3 个互异 `playSessionId`、全部闭合、各结算一次**（无重复 submit/end）；重开延迟 **77 ms**；页面未刷新；探针墙钟 314.75 s。证据：`raw/m2/M2-CR8-03-two-runs-2026-10-20T11-02-45-759Z.json`。

### CR8-04 · builtin 损坏状态 fail-closed

- 代码：builtin catalog 校验失败时不静默跳过；`package-invalid`/损坏状态在 `/games` 可见且 launch 被拒（`GM-4277` 等），健康 shipped builtin 行为不回归。
- 测试（`packages/host/test/cases/v1.5-builtin-package.js`）：`a tampered built-in package fails closed: listed as package-invalid and launch is rejected`、`an unreadable built-in package is reported as broken, never silently skipped (CR8-04)`、`a healthy shipped built-in still validates and launches (CR8-04 non-regression)`、`a shipped built-in that lost only its descriptor stays visible, broken and install-protected`；host 套件 **231/231 pass, exit 0**。

### CR8-05 · 探针基础设施：重启后 Host 泄漏/进程不退出

- 修复：`scripts/verification/v1.5/m2/lib/lab.mjs` 的 handle 改为 state 支撑（`stop/cleanup` 解引用当前 Host），新增 `handle.restart()`（SIGKILL 旧子进程 → `await exit` → 端口拒连证明 → 再起新 Host）；新增 `self-check-cleanup.mjs` 三条路径（成功 exit 0 / 断言失败 exit 1 / 重启后成功 exit 0，均断言端口拒连、PID 死亡、home 删除）。
- 实测：self-check 三条路径 **3022 / 3023 / 4250 ms，总 real 10.41 s，全绿**；lifecycle 探针 **48/48 required、exit 0、real 31.82 s 后进程自行退出**，退出后 58420/58421/9522 无监听、无残留 DSH 进程；重启快照：pid 37625→39228（同端口 58421），`oldPidAliveAfterRestart:false`，cleanup `pids:[37625,39228], finalPid:null`。

## 6. 归因表（product-defect / 探针问题 / 契约口径）

| 现象 | 归因 | 证据 | 处理 |
| --- | --- | --- | --- |
| 卸载后 `packages/<id>/<previous>` 目录残留 | **product-defect（host-zip）**：uninstall 只 trash `record.version`，rmdir 父目录失败被静默吞掉 | A/B `M2-lifecycle-zip-2026-10-20T06-41-58-541Z`（`uninstall-prunes-package-directories` 红，目录仍存在） | 已报 lead；host-zip 修复为逐版本目录清理；最终 48/48（CR8-05 后） |
| orbit Continue 后 elapsed/score 归零、静音不恢复（112/0） | **product-defect（orbit-courier）**：`storage.load` 返回 envelope，但 `loadSave/restoreMuted/readBest` 未取 `.data`；另有「Continue 时旧 menu 态 elapsed=0 覆盖有效存档」次生 bug | A/B `M2-A08-orbit-courier-2026-10-20T07-26-49-794Z`；修复前 Host 存档实测 `values.run` 完好而 UI 无 `#btn-continue` | 已报 lead 并给出最小复现/修复方向；brand-contracts 修复 envelope/menu 覆盖/启动竞态 + 35/35 游戏测试；最终 A08 Continue/mute 全绿 |
| A08 一局未打满 120 s（撞毁） | **探针玩法能力**：无快照/盲玩，非游戏缺陷 | A/B A08（wrecked 76 s） | 使用 `__ORBIT_PROBE__.snapshot()` 只读快照 + 生存优先躲避策略；最终 120,000 ms shift-complete |
| root target 的键盘事件对游戏无效 | **探针 harness**：cross-origin OOPIF 需把 `Input.dispatchKeyEvent` 下发到游戏 iframe 的 CDP session | 实测 root dispatch 无反应、iframe session dispatch 立即生效 | 已改为 per-session 投递（仍是真实浏览器输入管线/isTrusted） |
| reduced-motion / 375 设备模拟在游戏文档不生效 | **探针 harness**：OOPIF 不继承 root target 的 `Emulation.setEmulatedMedia/DeviceMetrics` | 首轮视觉探针 `reducedMotion:false`、width 319 | 改为对每个 attached session 下发 emulation + 页面级 viewport 断言 |
| 上传字节与源 ZIP 不一致/幽灵 409 | **探针 harness**：并行跑共享 fixture 目录竞态 | 曾出现 95948 vs 100407 | 每轮唯一 runTag fixture、fresh data root、source/upload sha256+长度+head16 对照、`postDataEntries` |
| `EADDRINUSE` / `ENOTEMPTY` | **探针卫生**：上轮 host/端口未清 | 启动失败日志 | 唯一端口/唯一 host 名、跑前清理 listener 与 home |
| `/installed` item 无 `format` 字段 | **契约口径**（非缺陷）：format 在 install 响应与 `GET /game?id` 的 `installed.format` | M1 留档一致 | 按响应契约断言 |
| **CR8-01** 卸载穿越符号链接（复核） | 安全加固（非功能缺陷）：清理路径全程 `lstat`、只做链接级 rename，目标不被访问 | host `v1-install.js` CR8-01 三用例；host **231/231** | 已修并复跑全绿 |
| **CR8-02** catalog 删媒体摘要/换 URL 绕过 publish（复核） | **product-defect（publish-zip）**：媒体绑定缺失时可绕过 | `tests/v1.5-publish-zip.test.js` 9 条 CR8-02 用例；**19/19** | 已修：摘要+大小绑定、缺失即拒绝且不下载；§5.1 |
| **CR8-03** 同页第二局不结算（复核重点） | **product-defect（orbit-courier）**：boot shell 闭包布尔未随新局重置 | 修复前 A/B `M2-A08-orbit-courier-2026-10-20T08-40-24-434Z`（当时探针未覆盖两局）；新真机探针 **25/25** | 已修：`src/run-sessions.js` run token 账本；§5.1 两局实测 917→519 best 不降 |
| **CR8-04** builtin 损坏状态（复核） | 健壮性修复：tampered/unreadable fail-closed 且健康包不回归 | host `v1.5-builtin-package.js` 用例；host **231/231** | 已修并复跑全绿；§5.1 |
| **CR8-05** 探针重启后 Host 泄漏/不退出 | **探针基础设施**：cleanup 闭包引用旧 Host；restart 未关闭旧实例 | 修复前 lifecycle 47/47 不退出（A/B `07-39-01`）；self-check 三条路径 + lifecycle 48/48 自行退出 | 已修：lab handle 解引用当前 Host/端口拒连证明；§5.1 |
| 记录写失败后进程内恢复安装 500 GM-5025 | **契约语义**：EACCES/EPERM 闩锁 readOnly 到进程重启 | A/B `06-41-58` 该条红 | 探针改为同 data root 重启 Host 后再恢复安装；最终绿并注明「重启是正确恢复」 |

## 7. 未验证 / 限制（如实）

- **Electron 原生窗口**（菜单/原生文件选择器视觉、系统主题切换、窗口缩放/多显示器）未验证；本轮全部为真实 Chrome headless + CDP（真实 host/web 产物）。
- **非 Chromium 引擎**（Safari/WebKit、Firefox）未验证；`prefers-reduced-motion`/CSS 行为仅在 Chromium 155 实测。
- **真实物理输入设备**：键盘/鼠标事件由 CDP 注入（浏览器真实输入管线、`isTrusted`），非物理硬件；未覆盖输入法、触摸手势（pointer 语义仅间接覆盖）。
- **可听声音**：headless 无音频输出设备；只断言 WebAudio 解锁/`play()` 成功返回与静音状态，不验证声学输出。
- **真实网络条件**：本地 127.0.0.1，无高延迟/断网/带宽限制场景（M1 已覆盖资源失败注入的部分契约，本轮未重跑）。
- **长时间稳定性**：本轮累计 5.9 min 活动游玩、~7 min 墙钟；未做小时级 soak / 内存泄漏观测。
- **多游戏并发 / 多实例**：未验证同时运行两个游戏、切换实例的资源隔离（另有 M1 证据覆盖部分）。
- **无障碍**：仅验证对比度与 reduced-motion；未做读屏器/键盘焦点全链路审计。
- **375 px 之外的响应式断点**（平板/桌面宽屏）与**横屏**未在最终证据中逐一断言（备注：游戏 CSS 有 560px 高度断点，未实测）。

## 8. 证据索引与复跑

```bash
cd dsh-game-market-worktrees/v1.5-game-and-tooling
node scripts/verification/v1.5/m2/m2-a08-orbit-courier.mjs      # A08（~7-8 min，真实墙钟）
node scripts/verification/v1.5/m2/m2-a02-orbit-resources.mjs    # 多资源
node scripts/verification/v1.5/m2/m2-visual-responsive.mjs      # 375/dark/reduced-motion
node scripts/verification/v1.5/m2/m2-lifecycle-zip.mjs          # 非 builtin ZIP 生命周期
node scripts/verification/v1.5/m2/m2-cr7-document-csp.mjs       # CR7 同源第二 HTML
node scripts/verification/v1.5/m2/m2-cr8-03-two-runs.mjs        # CR8-03 同页两局结算（~5 min）
node scripts/verification/v1.5/m2/self-check-cleanup.mjs        # CR8-05 清理三路径自检
```

每个脚本：`writeEvidence()` 输出 `raw/m2/<id>-<ISO>.json`（含 `passed/failed/required`、逐条 required、`scenario` 明细；token/nonce/launch 凭证与 `/Users/<real>` 已用证据层替换），退出码 0 当且仅当全部 required 通过。最终证据文件：

- A08（CR8 修复后构建）：`raw/m2/M2-A08-orbit-courier-2026-10-20T10-43-08-523Z.json`
- CR8-03 两局：`raw/m2/M2-CR8-03-two-runs-2026-10-20T11-02-45-759Z.json`
- A02：`raw/m2/M2-A02-orbit-multiresource-2026-10-20T07-36-13-978Z.json`
- 视觉：`raw/m2/M2-visual-responsive-2026-10-20T07-34-15-454Z.json`（+ `raw/m2/screenshots/m2-visual-375-*.png`）
- 生命周期（CR8-05 后，48/48）：`raw/m2/M2-lifecycle-zip-2026-10-20T10-26-22-800Z.json`
- CR7：`raw/m2/M2-CR7-document-csp-2026-10-20T08-01-43-798Z.json`
- A/B：`raw/m2/M2-lifecycle-zip-2026-10-20T06-41-58-541Z.json`（卸载泄漏）、`raw/m2/M2-lifecycle-zip-2026-10-20T07-39-01-494Z.json`（CR8-05 前 47/47）、`raw/m2/M2-A08-orbit-courier-2026-10-20T07-26-49-794Z.json`（存档 envelope）、`raw/m2/M2-A08-orbit-courier-2026-10-20T08-40-24-434Z.json`（CR8-03 前构建）

稳定构建上 `node scripts/check.mjs` 的 42 项检查全部 PASS；当前**唯一 FAIL** 是本轮 3 个新证据文件尚未跟踪（`M2-A08-orbit-courier-2026-10-20T10-43-08-523Z.json`、`M2-CR8-03-two-runs-2026-10-20T11-02-45-759Z.json`、`M2-lifecycle-zip-2026-10-20T10-26-22-800Z.json`）——按约定 `raw/m2/**` 新证据留待 Lead 提交时纳入，纳入后即恢复 `CHECK OK (42)`。

## 9. 结论

- 真实 Chrome + 真实 Host + 真实 Market UI 下：非 builtin ZIP 全生命周期（48/48）、内置 `orbit-courier` 真实 120 s 局与 ≥5 min 墙钟推进（A08 34/34，新构建）、多资源加载（21/21）、375 px/深色/reduced-motion（18/18）、CR7 同源第二 HTML 与历史目录/409/记录写失败/ZIP 原始字节/旧 HTML 对照（21/21），均以 required 全绿收口。
- **CR8 复核轮补齐**：同页连续多局结算真机验证 **25/25**（run1 917 → run2 519 best 不降 → run3 低分 40 best 不降，3 条互异 playSessionId 各结算一次）；CR8-01/02/04 引用 host **231/231**、publish-zip **19/19**；CR8-05 self-check 三路径 + lifecycle 48/48 自行退出。
- 累计发现并推动修复 3 类真实产品缺陷（卸载 previous 目录泄漏、orbit 存档 envelope/菜单态覆盖、orbit 第二局不结算）与 1 类安全/健壮性加固（CR8-01/02/04）；探针侧 OOPIF 输入/媒体模拟、fixture 竞态、端口卫生、重启清理问题均已修正并在 §6 留档。
- 未验证项集中在原生 Electron 外壳、非 Chromium 引擎、物理输入/音频输出与长时间 soak，未以 mock 代替。
