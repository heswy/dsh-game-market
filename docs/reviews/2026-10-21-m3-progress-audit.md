# M3 开发进度与风险审计

日期：2026-10-21（Asia/Shanghai）
审查者：Codex
结论：主体实现已形成，但尚未满足 M3 验收；先修复下面三项实现问题，再收敛验证。当前不能合并，也不能把两个 fresh profile 的单跳改称同 profile 连续更新。

## 审计范围与证据级别

- 开发 worktree：`/Users/orange/Orange Field/Matterhorn/dsh-game-market-worktrees/v1.5-platform-update`。
- 基线：M2 merge `40d701678e96d99e777520debb43e25b28ae2d0c`。
- 实现候选：`b0a35ca22199728d104ae1e632fb31053c544de2`。
- 本地审计 head：`37149786017b326bdac009690e10a217aaeea671`，另读取当前未提交报告、V2 runner 和证据；未把这些当作已提交交付。
- 独立验证在 `/tmp/dgm-m3-audit-3714978` 执行，未修改开发者 worktree、运行中的任务、用户 DSH profile、App 或远端仓库。
- 本轮未重跑完整 DSH 浏览器更新链；真实链路部分是核查已有原始 JSON，下面三个缺陷是独立故障注入/边界复现。

## 已确认的实际进度

1. 独立 `npm run verify`：1491/1491 pass，CHECK OK (44)，exit 0（Node 24.14.0）。不是仅引用交接说明。
2. 独立 release 校验：`release:verify --release b0a35ca...` 成功；P/R 身份、93 个产物及 Client 内嵌身份一致。
3. A2→B4、B4→R_final7 两份单跳 JSON：各 31 项通过、无 failedRequired，目标身份和清理结果有记录；它们使用不同的 fresh profile。
4. 非 HMR JSON：59 项通过，包含 pending-restart、真实 Host 重启和双端核验；仍属于隔离 dsh web + headless Chrome，安装传输使用本地 mirror。
5. 多窗口最新 JSON 仍失败：`window1-operation-updated` 采样为 activating。可以怀疑采集时序，但没有补跑通过前不能关闭。
6. 同 profile A→B→C、保存失败真实路径、V2 大部分边界仍未形成通过证据。真实 Electron 与公网安装应继续独立标记。

## 必须修复的实现问题

### M3-AUD-01 / P1：恢复记录写入失败仍开始包变更

位置：`packages/host/src/update-operations.js:241`、`:627`、`:412`。

`persist()` 捕获所有 writeJson 错误后仅记录 warning，调用者继续执行 adapter.install。安装前的持久记录不是可靠的前置门禁。

独立复现：对真实 operations + adapter + storage 测试夹具注入 `storage.writeJson` 抛 ENOSPC，begin 仍返回 operationId，原生 installBundle 被调用 1 次，最终 pending-restart，而 platform-update-operation.json 不存在。

影响：磁盘满、权限错误或存储故障时照常更换插件；一旦 HMR 销毁旧实例，恢复目标、requestId 与旧版本信息可能全部丢失。

修复要求：开始包变更前的关键记录必须成功持久化；失败则阻断安装，显式报可重试错误并释放锁。区分关键预写与后续尽力写诊断，不能统一吞异常。补 ENOSPC/EACCES 和失败后重试回归，断言 installBundle 调用数为 0。

### M3-AUD-02 / P1：保存失败后重试更新可绕过保存门禁

位置：`packages/client/src/update-manager.js:418`、`:430`；跨模块根因是 `packages/runtime/src/controller.js:836`。

M3 将 pause() 的 `{ok:true, saveStale:false}` 直接解释为确认保存成功。但 Runtime 对已经 paused 的实例直接返回该值，不验证此前保存是否失败，也不重新保存。

独立复现（真实 Runtime controller + 仓库 DOM/bridge/API 夹具）：

- 第一次 pause，注入 storage.save 失败，结果 `{ok:false,saveStale:true}`，状态留在 paused。
- 不恢复游戏，第二次 pause，结果变成 `{ok:true,saveStale:false}`。
- setSave 调用数仍为 1，没有新的保存。

影响：第一次更新因保存失败中止后，用户点击重试，M3 可能把仍未落盘的游戏当成已保存，继续替换插件。

修复要求：为更新协调提供可以验证的保存结果；paused 不能等同于已保存。保存失败应保留 stale 状态并执行真实重试，或使用单独的强制保存协调操作。补“保存失败→保持 paused→重试更新”的跨 Runtime/Client/Host 回归，不能只用预设 pause 返回值的 fake。

### M3-AUD-03 / P1：实例盘点后缺少启动/恢复屏障

位置：`packages/host/src/update-operations.js:594`、`:627`、`:404`；Host entry 启动链与更新协调未建立准入屏障。

开始更新时只读取当时活跃实例。后续 persist/等待/安装阶段仍可新增实例；已确认实例也未由协调协议持续冻结。仅在一次盘点时保存，不能保证真正替换包时所有活跃游戏都满足保存条件。

独立复现：begin 最初无活跃实例，在安装前记录持久化的 await 处阻塞；加入一个新的活跃实例后放行。最终 liveInstances=1、coordination=null，installBundle 仍调用 1 次并进入 pending-restart，全程无该实例的保存确认。

修复要求：从盘点到包变更完成建立 Host 权威的更新屏障；阻止新 launch/resume，或动态将新增/恢复实例纳入协调并在实际变更前重新确认。UI 禁用按钮不足以覆盖其他窗口和并发请求。补新 launch、恢复已暂停实例、协调结束临界点的并发回归。

## 验收与交付问题

### M3-AUD-04 / P2：连续更新证据不能用 fresh profile 替代

这是未完成的验收项，不等于已经确认产品第二跳一定失败。

两个 fresh profile 分别证明 A→B 和 B→C 的基本安装路径；无法证明第一次更新遗留的 operation、锁、发现缓存、HMR 生命周期和 Client 状态允许同一用户继续第二次更新。

原始失败证据确有 harness ReferenceError、发现目标切换失败和网络安装失败。由于该场景未通过，不能进一步断言“全是 harness，产品行为正确”。Host 单测与 offer 单测也不能替代端到端验收。

要求：保留现有单跳证据，名称明确为两个独立单跳；补同一个 DSH_HOME/profile 的 A→B→C，无重置 operation/cache/配置/存档。允许测试夹具切换发现索引，但更新开始应从真实 Client UI 发起。两个阶段分别核对双端身份、保存与清理。

多窗口 41/42 保持 FAIL，直到通过等待权威状态和 UI 收敛重新采集，不能改成忽略断言。V2 保存失败阻断和故障恢复应优先于低风险展示检查。

## 对 Q1–Q5 的裁决

- Q1：条件接受自有的严格格式 1 校验器作为受限安全校验层；应增加与宿主公开 parser/target 构造入口的兼容验证并写清严格子集。公开入口已可达时，不应只凭“避免依赖”永久复制一套易漂移的语义。这不要求立即推翻现有 Host 实现。
- Q2：接受 P/R 两段式身份。Client 上报 P，Host 绑定目标 R，R 内 release.json 绑定预期 P；展示与记录必须明确各自含义，release 校验需要证明对应关系。无需让文件包含自身最终 Git commit。
- Q3：接受包内 release.json，避免额外运行时网络依赖。
- Q4：接受配置显式 opt-in test 通道，stable 默认排除 prerelease。
- Q5：接受 throttled + nextCheckAt；GM-4091 复用需确保 Client 文案能区分插件更新与游戏安装。

## 为什么慢，以及后续应如何收敛

有实际工作产出，不是空转；但推进方式造成大量返工。

- 网络问题有失败证据支持；“约三分之一时间等待网络”属于开发者复盘，本审计未独立量化。
- 多个真实缺陷到浏览器阶段才发现，说明跨组件关键场景前置测试不足。
- harness 在运行中修改、缺少常量/import、目标切换编排失败与并发清理事故，使每次长链路重跑成本叠加。
- 形成主体实现后，继续扩展和重跑验证工具，没有先把最小稳定 runner 固定下来。
- P/R 身份使每次产物变化都需要新不可变目标，这是成本，不应因此降低验收；应批量修复后集中生成候选，避免一行一轮全量重建。

下一步按顺序执行：

1. 固定现有代码与证据快照；明确未提交文件归属。保持单一验证负责人、单 run 串行；不要再让多个任务共享清理路径。
2. 先用快速、确定性的回归修复 AUD-01～03，一并检查恢复写入失败和锁释放；暂不反复构建 probe release 链。
3. 固定最小 runner：启动→目标切换→真实点击→权威状态等待→有界超时→清理。先做 smoke，禁止无界等待与宽泛 pkill。
4. 批量生成一次新候选；复用已有 A/B 仅在其 Client 协议兼容时，不合适则有计划地重建。每条证据绑定实际安装 commit，避免旧 PASS 指向新产物。
5. 使用已打通的本地 mirror 先跑同 profile 两跳、多窗口、保存失败阻断/重试、响应丢失恢复和取消等 V2；mirror 结果只证明该传输范围，公网与 Electron 单列。
6. 收尾文档，删除相互矛盾的旧 not-run/已完成语句；补项目记忆，提交所有交付证据，在最终 PR head 重跑门禁后开 PR。
7. 可以先开 draft PR 固定审查入口；不能因此称验收完成，不合并、不打 tag、不发布、不写生产索引。

不要求重写 M3，也不批准继续增加新功能。下一次交付应是“3 项缺陷关闭 + 同 profile 两跳 + V2 核心门禁 + 固定 PR head”，而不是再增加一轮单跳 PASS 或截图数量。

## 独立审计临时证据

- `/tmp/dgm-m3-audit-verify.log`：1491/1491、CHECK OK (44)。
- `/tmp/dgm-m3-audit-cases.mjs`：恢复记录写失败仍安装；另含实例变化边界的初步复现。
- `/tmp/dgm-m3-audit-admission.mjs`：安装前 await 期间新增实例绕过协调的确定性复现。
- `/tmp/dgm-m3-audit-pause.mjs`：真实 Runtime 保存失败后第二次 pause 返回假成功的复现。

这些是审计 scratch，不是平台产品修改，不应直接复制为正式长期测试；开发者应将有价值的行为断言整合到现有测试结构。
