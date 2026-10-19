# M3 自动化证据记录（2026-10-19）

> 环境：macOS / Node v24.14.0 / DSH Desktop 0.2.1-rc.2（`app.asar` 解出 `dsh web`，隔离 `DSH_HOME`）。
> 插件提交：`d0b1db7`（M3 夹具提交 `ac136ec`；本记录随后与脚本一并提交）。
> 执行人：Lead（AI）。证据目录：`docs/verification/v1/{logs,results,screenshots,fixtures}`。
> 纪律：只记录实际执行结果；未执行项明确写「未执行」。

## 1. 自动化命令（AE-01..18）

| 编号 | 命令 / 操作 | 实际结果 | 证据 |
|---|---|---|---|
| AE-01 | `npm run verify` | build + check + tests 全绿：tests **767** / pass **767** / fail **0** | `logs/AE-01-run.log` |
| AE-02 | `npm run build` 连续两次比较 sha256 | 两次产物 **完全一致**（client.js + 四款游戏 dist） | `logs/AE-02-deterministic-build.log` |
| AE-03 | `node scripts/check.mjs` | `CHECK OK (21 checks)` | `logs/AE-03-check.log` |
| AE-04 | `node --test`（全量） | tests 767 / pass 767 / fail 0 | `logs/AE-04-run.log` |
| AE-05 | `node --test tests/v1-contracts.test.js` | tests 9 / pass 9 / fail 0 | `logs/AE-05-run.log` |
| AE-06 | `node --test games/snake/test/*.test.js` | tests 30 / pass 30 / fail 0 | `logs/AE-06-run.log` |
| AE-07 | `node --test games/{jump,2048,breakout}/test/*.test.js` | tests 87 / pass 87 / fail 0 | `logs/AE-07-run.log` |
| AE-08 | CLI `create/build/validate/pack`（空目录） | 生成 17 个模板文件；build 106931B；pack 产出 `<id>-<version>.html` + `.sha256`；validate 均 OK；违规路径 exit=1/2 | `logs/DEV-01-04-06-cli.log` |
| AE-09 | CLI `publish --url --cover`（离线） | 输出 `registry-entry.json` / `upload-plan.md` / `review-checklist.md` + sha256；exit=0 | `logs/AE-09-cli-publish.log` |
| AE-10 | file Registry：安装 jump/2048/breakout → jump 更新 1.0.0→1.0.1 → 卸载（保留数据）→ 重装 | 安装各 17–23ms；更新成功（previousVersion=1.0.0）；卸载 `removed:true, dataDeleted:false`；重装后 **canContinue=true** 且存档恢复（score=7） | `results/AE-10-15-host.json`、`logs/AE-10-15-host.log` |
| AE-11 | HTTPS Registry（raw.githubusercontent.com）安装 jump | 刷新 1543–2113ms；下载+安装 331–1260ms；安装 jump 1.0.0 成功（真实 HTTPS） | 同上 |
| AE-12 | 恶意包矩阵（registry + install-local） | sha 不匹配 `GM-5015`；非包内容 `GM-4221`；缺/双 manifest `GM-4221`；外部子资源 `GM-4225`；非法 capability `GM-4240`；旧字段 `GM-4232`；路径穿越 id `GM-4234`；21 MiB `GM-4135` | 同上 |
| AE-13 | 同 operationId 重放 + 并发安装 | 重放：两次调用均返回，版本一致（幂等）；并发：一个 changed=true、另一个 changed=false（串行化，无重复目录）；另有 host 单测覆盖 | `results/AE-10-15-host.json` |
| AE-14 | `/entry` 响应头断言 | 200；`content-type: text/html; charset=utf-8`、`cache-control: no-store`、`nosniff`、`no-referrer`、CSP（含 `connect-src 'none'` 与 `frame-ancestors 'self' http://127.0.0.1:* http://localhost:*`）、`x-entry-sha256` 与文件 sha 一致、content-length 210783 | 同上 |
| AE-15 | 存档契约 | 单值 300 KiB → `GM-4131`；第 33 个 key → `GM-4132`；revision CAS → `GM-4092`；损坏 current.json → 从 `.bak` 恢复成功 | 同上 |
| AE-16 | SDK/Runtime/契约测试 | tests 124 / pass 124 / fail 0（覆盖 ready 超时、协议校验、写串行、能力拒绝、resolve-paused 等） | `logs/AE-16-run.log` |
| AE-17 | 四款游戏包自包含扫描 | 四款 `validatePackageHtml` 均 ok；外部资源/网络 API 命中 **0** | `logs/AE-17-self-contained.log` |
| AE-18 | 日志/证据脱敏扫描 | 本次日志未命中 API key/Bearer/绝对用户路径/存档值（扫描仅覆盖本目录；最终发布前需人工复核） | `logs/AE-18-redaction.log` |

## 2. 主机级 E2E 场景摘要

详见 `results/AE-10-15-host.json`。关键结论：

1. **安装/布局**：`packages/<id>/<version>/entry.html` 落位正确，sha256 与 fixture 一致。
2. **更新**：file Registry 从 1.0.0 → 1.0.1 成功，`previousVersion` 记录 1.0.0。
3. **卸载/重装**：默认保留 save/scores/session；重装后 Continue=true、存档可读。
4. **HTTPS**：真实拉取 `raw.githubusercontent.com` 的 registry + 包，安装成功（URL 准入/allowlist 路径通过）。
5. **拒绝矩阵**：见 AE-12，均返回对应 GM 码，无「部分安装」写入。
6. **幂等/并发**：同 operationId 幂等；并发安装串行化，第二次 changed=false。

## 3. 开发者链路（DEV）

| 编号 | 结果 | 证据 |
|---|---|---|
| DEV-01 | 通过：`create my-game --template vanilla` 生成模板（manifest/SDK/生命周期/自动保存/README） | `logs/DEV-01-04-06-cli.log` |
| DEV-02 | 通过：`dsh-game dev` 本地 Runtime Simulator 启动，`GET /` = 200，页面列出 Agent 状态/暂停/存档控制 | `logs/DEV-02-07-simulator-timing.log` |
| DEV-03 | **未执行**（热更新需真机交互；留真机/后续） | — |
| DEV-04 | 通过：build/validate/pack 产物正确；违规包 exit=1/2；DEV-06 的 6 类违规包全部拒绝 | `logs/DEV-01-04-06-cli.log` |
| DEV-05 | 通过：CLI 生成的 my-game 经 file Registry 安装、launch 成功、entry 106931B、save/session/Continue 均可用 | `logs/DEV-05-cli-game-install.log` |
| DEV-06 | 通过：缺 manifest/双 manifest/外部资源/非法 capability/旧字段/路径穿越全部拒绝并给出 GM 码 | `logs/DEV-01-04-06-cli.log`、host JSON |
| DEV-07 | 部分：模板→build→validate→pack 耗时 **0.392s**；「外部开发者 30 分钟」需真人体验记录 | `logs/DEV-02-07-simulator-timing.log` |

## 4. 性能测量（自动化可得部分）

| 指标 | 目标 | 实测 | 说明 |
|---|---|---|---|
| file Registry 刷新 | ≤2s | **9ms** | 本机 file 源 |
| HTTPS Registry 刷新 | ≤2s | **1543–2113ms** | raw.githubusercontent.com；其中一次 2.1s 略超，受网络影响 |
| 安装 5 MiB 包 | ≤5s | file **17–23ms**；HTTPS **331–1260ms** | fixture 包 ~100–210KB，非 5MiB，仅作链路参考 |
| Market 首屏可交互 | ≤500ms | **未测量（headless 面板常驻导致 1ms 无意义）** | 真机录屏测量 |
| 游戏启动到可操作 | ≤1.5s | **未测量** | 真机/录屏 |
| FPS / 暂停 CPU / 内存 | PRD §10.5 | **未测量** | 真机 Activity Monitor/Profiler |

## 5. 失败模式与安全覆盖映射

| 编号 | 自动化状态 | 说明/证据 |
|---|---|---|
| FM-01 Registry 不可达 | 未执行 | 需断网/不可达 URL 场景（真机或专项） |
| FM-02 下载中断 | 未执行 | 需中断连接注入 |
| FM-03 SHA 不匹配 | **通过** | GM-5015（AE-12） |
| FM-04 Manifest 非法 | **通过** | GM-4221 矩阵（AE-12） |
| FM-05 恶意包/超大/路径穿越 | **通过** | GM-4225/4234/4135，无残留（AE-12 + host 单测） |
| FM-06 版本不兼容 | 未执行（单测覆盖映射） | `packages/host/test/cases/v1-install.js` |
| FM-07 存档写入失败 | 未执行 | 需只读/磁盘满注入 |
| FM-08 存档损坏恢复 | **通过** | `.bak` 恢复（AE-15） |
| FM-09 iframe 崩溃/超时 | 未执行 | 需故障注入（真机专项） |
| FM-10..14 | 未执行 | 占位场景仍需 Lead 校正后执行 |
| SEC-01/02/03 宿主/网络/存储隔离 | 未执行 | 需恶意运行时包 + 真机 CSP 取证（当前设计：sandbox + CSP，见契约；未作为 V1 阻塞项） |
| SEC-04 伪造 postMessage | 单测覆盖 | protocol/SDK 测试（AE-16） |
| SEC-05 恶意包拒绝 | **通过** | AE-12 |
| SEC-06 篡改复用 hash | **通过** | GM-5015 |
| SEC-07 伪造平台 UI | 未执行 | 设计上平台 UI 在 iframe 外；专项验证留待后续 |
| SEC-08 日志脱敏 | 部分 | AE-18 自动扫描通过；发布前人工复核 |
| SEC-09 路径注入 | **通过** | GM-4234 + host 单测 |
| SEC-10 URL 准入/重定向 | 单测覆盖 | registry URL 准入测试（AE-16 内的 v1-registry 用例） |

## 6. 截图证据

`docs/verification/v1/screenshots/`（均来自隔离宿主 + headless Chrome，`docs/verification/v1/results/ui-evidence.json` 有元数据）：

| 文件 | 内容 | 对应 |
|---|---|---|
| `U-01-market-first-run.png` | 全新插件存储：空 Continue + Quick Play 空态 + Snake 内置 | U-01 |
| `U-02-market-with-games.png` | 已有安装/Continue 的 Market | U-02、U-08 前置 |
| `U-02-search-jump.png` | 搜索 `jump` 后的过滤结果 | U-02 |
| `U-03-detail-jump.png` | **未成功打开详情（点击选择器失败，截图仍为 Market）** | U-03 待真机/重跑 |
| `U-08-resume-confirm.png` | 平台「已恢复上一局」确认（单层） | U-08、A-08 |
| `U-13-runtime-2048.png` | 2048 游玩画面（hero Continue 进入） | A-03、A-12 |
| `A-05-pause-overlay.png` | 平台暂停：**仅平台一个弹窗**，无游戏内暂停面板 | A-05、V1-23 |
| `U-13-narrow-720.png` | 720×900 窄窗 Market | U-13、A-13 |
| `U-13-dark-theme.png` | 暗色主题（CDP prefers-color-scheme 模拟） | U-13、A-14 |

限制：headless 环境下 onboarding 需自动点「继续」；主题为媒体模拟，真机主题切换仍需确认。

## 7. 未执行 / 阻塞（交真机或后续）

1. 真机条目：U-04/05/06（真实 Agent）、U-08 关闭 DSH 重开、U-09 完成一局、U-13（主题/字号）、U-14 纯键盘、U-15 减少动效、A-03/04/05/06/07/11/12/13/14/15/16 的观感部分。
2. 失败模式：FM-01/02/06/07/09/10..14（需故障注入或占位校正）。
3. 安全：SEC-01/02/03/07（建议 V1 后专项；当前设计有 sandbox+CSP，但未做 V1 阻塞）。
4. 性能：Market 首屏、游戏启动、FPS、暂停 CPU、内存（真机测量）。
5. U-03 详情页截图需重跑（选择器失败）。
