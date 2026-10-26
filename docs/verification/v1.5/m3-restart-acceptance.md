# M3 重启验收（2026-10-26）

当前状态：M3 已于 2026-10-26 按用户授权通过 PR #9 合入 main（`bcc7b6d`）。本次已授权合并；未打 tag、正式发版或推广生产索引。

## 固定候选与范围

| 候选 | 版本 | 安装 commit R | Client build commit P |
|---|---|---|---|
| A | 1.2.1 | `75c0041c3e73ddea83940d1d23a54f0d6d1431cf` | `80435467c87fbb58b2715e37ae54b86275039df8` |
| B | 1.2.2 | `e4cb4694ad856b1132179f4db2385057dca7f66d` | `ededfaa30cf908624b2f6224246d837d64cd9dfa` |
| C | 1.3.0 | `f8244cf24a418aaf796a2b64ad17e7417b65ecac` | `e2fa60a0bcf89aac9482ff0b08b9170450184a7e` |

三个候选均包含 `33d50aa`（Runtime hold）、`2c3d971`（存储恢复/盘点失败阻断）、`6ff6e0b`（禁用状态）、`a60e74d`（后续更新入口/开发态身份）修复。只推送开发候选分支以便真实 GitHub 精确安装；未创建 tag/Release、未写生产索引。最后候选已通过 `release:verify`；准备工具对每版执行隔离确定性构建并验证 P/R 对应关系。最终门禁和端到端结果另列，不把生成成功当作安装验收。

环境：macOS，Node 24.14.0，当前安装 App 的只读 DSH `0.2.1-rc.3` 副本 + 隔离 `dsh web` + headless Chrome。生产固定索引 URL 的返回体由隔离 TLS 夹具提供；插件包通过真实 GitHub/本机上游代理传输。此证据是 **isolated-browser + real GitHub package transport + isolated index fixture**，不等于真实 Electron 或生产索引发布。

## 已修复与本轮补修

- AUD-01：关键恢复记录写入失败阻断包变更，释放锁/屏障；ENOSPC/EACCES 回归。
- AUD-02：paused 不等于已保存；真实保存失败后重试执行新保存，不伪报成功。补修权限恢复后 Host 仍保持只读标记的问题，显式 begin 重新探测；关键持久化门禁继续生效。
- AUD-03：Host 在入口与注册后双重阻断新 launch，包变更前重枚举；本轮补齐已协调 Runtime 的 user/visible resume、reload/relaunch hold。旧终态不能解除新操作 hold；结束后由用户显式恢复。
- 适配器缺少 saveStale 的结果按未知/不安全处理；拒绝恢复结果透传 UI。
- 验证准备修正：两款已内置游戏（snake/orbit-courier），等待真正 playing/paused；第三个真实页面操作更新，避免为打开更新页而卸载待保存的游戏；目录权限故障作用于各游戏实际原子写目录并自检；游戏保存与无关字节保留标记分开。Orbit 先真实点击开始，确保存在可保存的局；重试必须观察新 operationId。

## 验收结果

最终固定候选的以下场景全部通过，均记录真实目标身份与清理证明。

| 场景 | 必需检查 | 原始证据 |
|---|---|---|
| 异常索引/取消/恢复/开发态 | 86/86 PASS | [JSON](./raw/m3/M3-v2-edges-index-2026-10-26T03-20-24-091Z.json) |
| 同 profile A→B→C + 响应丢失 | 55/55 PASS | [JSON](./raw/m3/M3-v1-two-hop-2026-10-26T04-43-16-402Z.json) |
| 两游戏保存失败→修复→重试 | 34/34 PASS | [JSON](./raw/m3/M3-v2-save-coordination-2026-10-26T04-45-37-872Z.json) |
| 非 HMR 安装→重启→身份确认 | 57/57 PASS | [JSON](./raw/m3/M3-v1-nonhmr-restart-2026-10-26T04-48-10-566Z.json) |
| 同 Host 多窗口幂等 | 41/41 PASS | [JSON](./raw/m3/M3-v2-windows-idempotency-2026-10-26T04-51-17-506Z.json) |
| 隔离安装预检 | 28/28 PASS | [JSON](./raw/m3/M3-v1-preflight-2026-10-26T04-52-24-879Z.json) |

串行执行六个场景全部 exit 0、无超时、遗留进程 0：[串行汇总](./raw/m3/M3-serial-summary-2026-10-26T04-53-47-008Z.json)。边界场景独立串行通过；runner selfcheck 448 项通过。完整 `npm run verify`：1543/1543，0 失败、0 跳过，CHECK OK (44)，构建通过：[门禁记录](./raw/m3/M3-full-gate-2026-10-26.json)、[日志](./raw/m3/M3-full-gate-2026-10-26.log)。最终提交仍须以干净 checkout 独立复跑后交付。

真实 Electron/干净桌面安装升级仍为 M5 门槛；stable/生产索引推广未执行。多 Host 进程共享 profile 的活跃游戏协调未支持；这里只验证同一 Host 的多页面/多实例，跨进程更新锁只保证更新互斥。强制未知 HMR 的真实环境用例保持 informational not-run，自动化覆盖其分支，不把它计为通过。

## 历史结果与失败记录

原 P1 修复候选（不含新增 hold）的 rc.3 结果：smoke 28/28；同 profile 两跳 54/54；非 HMR 59/59；多窗口 42/42。这些不是新候选的替代证据，原始文件保留在 raw/m3，均记录实际 targets。

初次预检因旧 ASAR 副本与当前 App 不一致失败；重新只读提取后通过。旧保存测试因未安装 2048、只检查 Runtime 壳、无效菜单局、错误页面观察而失败；这些记录不计为产品通过。故障注入和恢复必须以实际游戏写入及新 operation 为准。

公开 parser 兼容核对：对推广工具 dry-run 生成的索引，用实际 rc.3 的公开 parseMarketIndex/marketInstallTarget 和本项目严格子集校验器检查，8 项通过（包含浮动/短 SHA 拒绝及 dry-run 无写入）；没有引入私有模块或新运行依赖。证据：[public parser](./raw/m3/M3-index-parser-compatibility-2026-10-26.json)。


## 本轮补充边界裁决

- `already-at-target` 只表示上一次操作已满足，不得永久隐藏后续更高版本。相同运行身份仍由独立比较抑制重复安装。
- 开发态 file row 的识别须覆盖单 profile 和显式 profileDir；本地运行代码不得借用 profile 依赖里的正式 commit。
- 发现契约保留上次验证过的 target（包括最新请求 invalid/offline）。恶意索引验收应证明：新非法元数据被拒绝、只保留原可信 target、任意 target/spec 拒绝、包身份未变。对已经安装的可信缓存 target，begin 返回 already-at-target 是合法无包变更结果，不能误判成接纳了恶意源。异常同版本不同 commit 仍必须阻断。
- 取消结果若为 too-late，必须观察到最终生效或真实失败之后才能进入下一测试；开发态拒绝迁移验证对比进入该场景前后的真实依赖/包身份，不假定取消一定发生在安装前。
- 第二跳已由浏览器在 Host 已接受请求后丢弃 begin 的 HTTP 响应，验证 Client 通过 inspect/observe 恢复。Native waitForInstall null 等服务分支仍标为 automated，不把 HTTP 故障等同全部原生 RPC 故障。


网络复现：直接 curl GitHub 的最新候选归档为 200、50,352,077 B、约 6 秒；经索引夹具的 curl 同样约 7 秒成功，但 pnpm 经夹具停滞。相同 pnpm 命令仅将 npm_config 代理改为上游后 8.5 秒成功。因此验证环境中 Host 索引 fetch 继续隔离，pnpm 包传输直接使用上游代理；正式产品代码未改。原失败保留：[fixture transfer](./raw/m3/M3-package-transfer-2026-10-26.json)，成功与预热说明：[direct package transfer](./raw/m3/M3-direct-package-transfer-2026-10-26.json)。后续安装可复用 pnpm 缓存，不宣称每跳重新下载；实际包身份仍逐跳核验。
