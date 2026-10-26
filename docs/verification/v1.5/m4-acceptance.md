# M4 形象与游戏内问答验收（2026-10-26）

M3 已由用户授权合入 main：PR #9，`bcc7b6d09fd9f208657088fd65cc36eba3a9aca6`。M4 在独立分支 `feat/v1.5-presence-questions` 实施，已完成实现与最终固定源码验收，待 PR 复核合入；不替代 M5 正式发布门槛。

## 交付行为

- `html-v1` 新增资源 origin wrapper；旧 `entryUrl` 保留，旧 Client/Host 仍走原有单层路径。新 Runtime 在受信 wrapper 内加载 `sandbox="allow-scripts"` 的游戏，保留 SDK、存档与重载凭据语义。
- 真正桌面 App 使用 `dsh-app://app`，不是后端 HTTP origin。仅识别打包 Electron Host 的启动入口后，精确设置该来源；HTTP 模式仍使用实际 HTTP origin，不增设通配白名单。wrapper、HTML 与 ZIP 文档均覆盖完整祖先链。
- 鲸鱼使用宿主 `FishLogo`，`currentColor`、正式轮廓、运行/等待/完成/错误四态；缺少模块时隐藏图形并保留中性按钮与诊断，不复制占位鲸鱼或引入新依赖。信息 status 与交互按钮语义分开；后台停止动画，reduced-motion 无循环位移。
- 游戏内普通问题读取同一 Session 的活 `PendingQuestion`，open 只调用其回答 channel；continued 走原生 `remote.userQuestions.answer` 并正确拆 RemoteResult。服务/命名空间通过可选 Cordis scope 接入，缺失不阻止市场使用。
- 打开面板先获得独立运行 hold、暂停并真实保存；保存未知或失败不能提交。显式重试先用既有 health 入口重新探测存储，再保存；真实写入仍有最终决定权。hold 与 M3 更新 hold 并存，各自释放，不自动恢复游戏。
- 单选、自定义覆盖、多选补充、自由文本、多题整批提交，保留原始 label。草稿仅在 Client 组件内存，收起不取消、不 dismiss、不发空答案；Esc 回到无遮挡的鲸鱼，重新打开保留草稿。发送后等待原生状态确认，再让用户显式继续游戏。
- continued 的卡片消失可能只是排队：只认原生 `userQuestions` settled 投影，不能据此伪报完成。丢弃排队回复后重新出现的活卡可再次回答；旧对象、旧 key、旧 Session、重复提交和敏感/计划审阅 face 均不会被误提交。
- 普通问题之外的危险审批和计划审阅回到原生会话处理；不复制批准、改变 policy 或给游戏新增答案/审批能力。

## 证据与运行范围

产品源码固定提交：`cef4cb9`（功能实现 `96718e1`、四态/主题验证 `2de91b3`；最终 JSON 中 `source.head` 为完整 SHA、`sourceChanges=[]`，Client 字节 sha256 一致）。

| 项目 | 必需检查 | 证据 |
|---|---|---|
| 真实 Electron + 实际游戏 + open 问答 | 36/36 | [JSON](./raw/m4/M4-product-desktop-open-2026-10-26T07-55-58-477Z.json) |
| 多选补充 + 第二题自由文本 + 375px/键盘/主题 | 37/37 | [JSON](./raw/m4/M4-product-multi-2026-10-26T07-56-15-601Z.json) |
| continued 原生 RPC + settled 投影确认 | 37/37 | [JSON](./raw/m4/M4-product-continued-2026-10-26T07-56-31-952Z.json) |
| 实际目录写失败→恢复权限→重新保存→回答 | 38/38 | [JSON](./raw/m4/M4-product-open-2026-10-26T07-56-48-333Z.json) |
| HTML 同恶意字节导航正反对照 | 7/7 | [JSON](./raw/m4/M4-html-boundary-2026-10-26T07-57-04-535Z.json) |

实际原生 turn 驱动 running/waiting/completed/error 四态，错误由脚本模型主动失败触发；错误标志静止，后台与 reduced-motion 断言通过。浅/深色均验证宿主主题属性真正切换后再截图；相同正式轮廓不变形。四态截图：[运行](./raw/m4/m4-running-desktop-open-2026-10-26T07-55-58-477Z.png)、[等待](./raw/m4/m4-question-desktop-open-2026-10-26T07-55-58-477Z.png)、[完成](./raw/m4/m4-completed-desktop-open-2026-10-26T07-55-58-477Z.png)、[错误](./raw/m4/m4-error-desktop-open-2026-10-26T07-55-58-477Z.png)。

五个场景串行 exit 0，浏览器/独立 App 与 Host 均停止。普通问答在原生 Session 的同一调用落盘，未发生 ASK_CANCELLED；continued 记录原 callId 的 user-question-reply，未自动恢复游戏。官方 Logo 轮廓 sha256 与冻结值一致；截图：[桌面 375px](./raw/m4/m4-question-desktop-open-2026-10-26T07-55-58-477Z.png)、[多题 375px](./raw/m4/m4-question-multi-2026-10-26T07-56-15-601Z.png)。

每次运行记录源码 commit、源文件是否有未提交变化、Client 字节 sha256、DSH build、退出结果和清理证明。此前失败 JSON 原样保留，不追认为通过。固定源码完整门禁为 1564/1564、0 失败、0 跳过、CHECK OK (44)：[门禁摘要](./raw/m4/M4-full-gate-2026-10-26.json)、[脱敏日志](./raw/m4/M4-full-gate-2026-10-26.log)。最终交付提交另在独立干净 checkout 复跑，结果记入 PR。

产品验证入口：

```bash
DSH_V15_WORK=/tmp/dsh-v15/m3 node scripts/verification/v1.5/m4/run.mjs --scenario=open --desktop
DSH_V15_WORK=/tmp/dsh-v15/m3 node scripts/verification/v1.5/m4/run.mjs --scenario=multi
DSH_V15_WORK=/tmp/dsh-v15/m3 node scripts/verification/v1.5/m4/run.mjs --scenario=continued
DSH_V15_WORK=/tmp/dsh-v15/m3 node scripts/verification/v1.5/m4/run.mjs --scenario=open --save-fault
DSH_V15_WORK=/tmp/dsh-v15/m3 node scripts/verification/v1.5/m4/html-boundary.mjs
```

`--desktop` 启动当前安装的 DSH 0.2.1-rc.3 / Electron 44.7.0，独立 DSH_HOME、desktop profile 和 Electron user-data-dir；通过原生欢迎页“稍后”进入，不使用日常账号或模型密钥。其余产品场景是同版本只读副本的隔离 dsh web + Chrome。全部使用真实 Game Market 页面、实际贪吃蛇和原生问答工具；本地脚本模型负责确定性发出工具调用，**不是真实 DeepSeek 模型调用**。

HTML 安全 A/B 在同一真实 Host 上安装同一有效恶意 HTML：legacy 直接加载会真的到达 sink；新 wrapper 收到游戏的导航尝试后，sink 请求为零，游戏仍只有 `allow-scripts`。这是 Runtime/资源边界验证，不伪称恶意包来自公网或外部作者。

原生 face 升级回归独立保留在 [native-rc3 汇总](./raw/m4/native-rc3/run-all.json)：S-Q1 必需 24/24、S-Q2 44/44、S-Q2b 9/9。覆盖原生重连、换 Session、多窗口、并存和 attachWait；它们使用同形探针，不能替代上述真实产品页面证据。`REPLY_QUEUED`、回复丢弃重新可答、未知/损坏 face、保存失败与晚返回隔离等另由自动化回归覆盖，不把未强制命中的原生分支写成实测。

## 发布边界

本轮是开发行加载的已固定源码验收，不是新增不可变发行包安装或生产更新。package/release 元数据仍为 M3 的开发候选；M5 正式准备发行时统一生成新版本、Host/Client 身份、确定性包与恢复说明，不把旧 buildCommit 当成 M4 源码身份。

M5 仍需：干净用户正式安装与持续升级、完整长局/重开/存档迁移、外部作者投稿闭环、跨机数据流程、发行说明和生产索引推广。M4 桌面普通问答通过不能代替这些检查。未打 tag、发 Release、推广生产索引；M4 合入由后续复核与授权决定。
