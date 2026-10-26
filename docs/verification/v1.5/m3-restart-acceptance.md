# M3 重启验收（2026-10-26）

当前状态：验收进行中，不作为通过声明。主会话已获用户直接实施 M3 授权；未获合并 main、打 tag、正式发版或生产索引推广授权。

## 固定候选与范围

| 候选 | 版本 | 安装 commit R | Client build commit P |
|---|---|---|---|
| A | 1.2.1 | `ce0247cbd3f3bee59aae9d276616dfb080ae0e08` | `76d0414617ea0558a8763fc449159ec9ba4e0d45` |
| B | 1.2.2 | `1a110b651b200ab6ac597306e544267b59352c0d` | `a51dc6f82eac5239661f88a79f265b7786a81bb4` |
| C | 1.3.0 | `a321bc72c95ae3f246c3b7081731ea4e6e541f19` | `9a4cd66d93faf1780c17d11acf1f5e6fa4dbcb66` |

三个候选均包含 `33d50aa` 的 Runtime update hold 与 `2c3d971` 的存储重试恢复/盘点失败阻断。只推送开发候选分支以便真实 GitHub 精确安装；未创建 tag/Release、未写生产索引。最后候选已通过 `release:verify`；准备工具对每版执行隔离确定性构建并验证 P/R 对应关系。最终门禁和端到端结果另列，不把生成成功当作安装验收。

环境：macOS，Node 24.14.0，当前安装 App 的只读 DSH `0.2.1-rc.3` 副本 + 隔离 `dsh web` + headless Chrome。生产固定索引 URL 的返回体由隔离 TLS 夹具提供；插件包通过真实 GitHub/本机上游代理传输。此证据是 **isolated-browser + real GitHub package transport + isolated index fixture**，不等于真实 Electron 或生产索引发布。

## 已修复与本轮补修

- AUD-01：关键恢复记录写入失败阻断包变更，释放锁/屏障；ENOSPC/EACCES 回归。
- AUD-02：paused 不等于已保存；真实保存失败后重试执行新保存，不伪报成功。补修权限恢复后 Host 仍保持只读标记的问题，显式 begin 重新探测；关键持久化门禁继续生效。
- AUD-03：Host 在入口与注册后双重阻断新 launch，包变更前重枚举；本轮补齐已协调 Runtime 的 user/visible resume、reload/relaunch hold。旧终态不能解除新操作 hold；结束后由用户显式恢复。
- 适配器缺少 saveStale 的结果按未知/不安全处理；拒绝恢复结果透传 UI。
- 验证准备修正：两款已内置游戏（snake/orbit-courier），等待真正 playing/paused；第三个真实页面操作更新，避免为打开更新页而卸载待保存的游戏；目录权限故障作用于各游戏实际原子写目录并自检；游戏保存与无关字节保留标记分开。Orbit 先真实点击开始，确保存在可保存的局；重试必须观察新 operationId。

## 验收结果

新候选的同 profile 两跳、非 HMR、多窗口、保存失败/重试、取消/响应丢失/恢复正在串行采集，完成后逐项记录下表与原始 JSON。

| 项目 | 当前结论 |
|---|---|
| 新候选核心端到端 | 进行中 |
| 最终完整门禁/构建 | 待最终 head 复跑 |
| 真实 Electron/干净桌面安装升级 | 本轮未跑，M5 门槛 |
| stable/生产索引推广 | 未执行，需要正式发布授权 |
| 多 Host 进程共享同 profile 的活跃游戏协调 | 未支持；本轮只验证同一 Host 的多页面/多实例，profile 更新锁只保证更新互斥 |

## 历史结果与失败记录

原 P1 修复候选（不含新增 hold）的 rc.3 结果：smoke 28/28；同 profile 两跳 54/54；非 HMR 59/59；多窗口 42/42。这些不是新候选的替代证据，原始文件保留在 raw/m3，均记录实际 targets。

初次预检因旧 ASAR 副本与当前 App 不一致失败；重新只读提取后通过。旧保存测试因未安装 2048、只检查 Runtime 壳、无效菜单局、错误页面观察而失败；这些记录不计为产品通过。故障注入和恢复必须以实际游戏写入及新 operation 为准。

公开 parser 兼容核对：对推广工具 dry-run 生成的索引，用实际 rc.3 的公开 parseMarketIndex/marketInstallTarget 和本项目严格子集校验器检查，7 项通过（包含浮动/短 SHA 拒绝）；没有引入私有模块或新运行依赖。证据：[public parser](./raw/m3/M3-index-parser-compatibility-2026-10-26.json)。
