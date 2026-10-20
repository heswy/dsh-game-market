# V1.5 M0 · S-Q1 / S-Q2 问答探针报告

日期：2026-10-19。工作树：`feat/v1.5-m0`。宿主：本机 `/Applications/DeepSeek Harness.app` 内 DSH 包 **0.2.1-rc.2**（`runtimeIdentity()` 实测，见各 raw JSON）。
所有命令均在本工作树根目录执行；所有 DSH_HOME、chrome profile、会话目录都建在 `/tmp/dsh-v15/` 下，**未读写用户日常 `~/.dsh`，未修改 App 安装目录**。

> **方法学上的最重要差异（必须显式标注）**
>
> 本机隔离 profile 里没有模型凭据，无法发起真实 DeepSeek 模型调用。为了让真实 Agent 轮次里的**原生 `ask_user_question` 工具**被调用，探针注入了一个**本地脚本模型**（probe Bundle 注册 provider `qprobe`），由它按场景产出模型流式输出（文本 / 工具调用参数）。
>
> 因此：**模型不是真实 DeepSeek 模型**；但模型以下的一切都是宿主原生路径：`dsh-agent-loop` 真实 Turn → 原生 `@deepseek-ai/dsh-tool-ask-user` 工具 → 原生 `ctx.userQuestions` waterfall → 原生 Remote Event 转发 → 原生 `@deepseek-ai/dsh-client-ui-user-questions` Client UI（`PendingQuestion`）→ 原生 Session log/projection。报告不会把这些结果写成「真实模型提问通过」。

> **第二个差异：游戏视图是探针面板，不是真实 Game Market UI**
>
> `q1`/`q2` 用第三方 `dsh.client` 探针包注册一个 `main` 面板（`ctx.slots.register({name:'main', key:'qprobe-game'})`），再用 `ctx.layout.selectPanel('qprobe-game')` 选入——这与仓库 `packages/client/src/main.js` 里 Game Market 注册/进入游戏面板的方式**同形**（同一 slot/key/selectPanel 机制），替换掉 conversation view、卸载原生 composer。真实 Game Market 面板内的最终验证仍属 M4 真机项（见「未验证项」）。

---

## 1. 结论摘要（一句话版）

- **可行（de facto）**：第三方 Client 插件能从 `ctx.uiSession.sessionStatus` 拿到宿主原生 `dsh-client-ui-user-questions` 发布的**活 `PendingQuestion` 对象**，在游戏面板选中、原生 composer 卸载的状态下调用 `pending.answer(batch)` 结算 **blocking/open** 问题；原生 Session 里同一 `tool/call` 记录到同 `callId` 的 `tool/result`，Turn 继续直到结束。Q1 全部断言通过。
- **不稳定/非公开**：该对象是原生 UI 插件内部类实例，不是宿主公开 API；blocking 问题**没有 callId**、**不进 `userQuestions` projection**、dismiss 语义是取消（`ASK_CANCELLED`）。第三方只能靠「唯一活对象 + 事件顺序」关联，不能从投影/日志重建。**需要 DSH 上游 seam 才能作为稳定公开依赖**；M4 可先用版本门控 + 能力嗅探的 de facto 适配，并把「回到会话处理」作为能力缺失兜底。
- **timed/continued 路径也成立**：timed 问题带 `wait.callId`，`userQuestions` projection 正确 fold `open → continued → settled`；continued 可由 Client 的 `ctx.remote.userQuestions.answer`（de facto 命名空间 `remote.userQuestions`）排队 steer，返回 `{ok:true,value:true}`，重复/他窗口提交返回 `value:false` 或 RemoteError；会开新一轮 Turn。
- **生命周期**：浏览器重连后 open 问题会重新投递并可继续结算；切 Session 后仍可按 Session 定位结算；`attachWait` 的 claim 会暂停宿主 deadline，释放后立即结算；无 claim 时宿主按 deadline 返回 `{pending:true}`。

---

## 2. 结论表

| 探针 | 必须证明什么 | 实际结果 | 证据文件 | 通过 | 未验证项 |
|---|---|---|---|---|---|
| S-Q1 | 绑定 Session 的游戏面板内，第三方读取原生 pending question 并提交 blocking/open 回答；原生会话同一调用结算 | 通过。原生 `ask_user_question`（standard preset 默认 legacy blocking 模式）在游戏面板选中、composer 卸载时仍以活 `PendingQuestion` 暴露；第三方 `pending.answer({answers})` 结算成功；Session 记录 `tool/call` → 同 `callId` `tool/result`（含答案），同 Turn 内 ≥2 个 step 后结束；projection 对该 blocking 调用为空（无 callId 不被 fold） | `docs/verification/v1.5/raw/questions/q1-open-in-game-panel.json`、`q1-conversation-question.png`、`q1-game-panel.png` | ✅ | 真实模型工具调用；真实 Game Market 面板；headed Desktop |
| S-Q1-接口 | 该对象是 de facto 还是稳定公开接口 | de facto：实例来自原生插件私有类 `PendingQuestion`（`pendingType` 记录构造器名与方法集），非包的公开 export，无版本契约；blocking 请求无 `callId`、无 projection 行、`dismiss=reject ASK_CANCELLED` | 同上 `q1-...json` 中 `pending.type` / `pending.status` | ✅（结论为「不稳定」） | 上游是否计划公开 seam |
| S-Q2-A | timed 问题 → 倒计时超时 → `continued` → RPC 回答 → 新 Turn | 通过。timed open 带 `callId`、`countdown.remainingMs≈4880 running`；不回答时 Client 倒计时以 pending 结果结算（`pending:true`，同 callId）；projection `active[state=continued]`；RPC 接受 `{ok:true,value:true}`；Session 记录 `user/message source.kind=user-question-reply`（同 callId）并 `turnStarts=2`；projection 转 settled | `q2-lifecycle.json`（checks：*timed open question…* / *client-owned countdown…* / *continued RPC accepted…* / *reply started a new Turn…*） | ✅ | 真实模型时间窗口 |
| S-Q2-B | 重复提交 / 已由其他窗口回答 | 通过。第一窗口接受；第二窗口（独立 Chrome profile，同 token、同 Session）RPC 返回 `{ok:true,value:false}`（已 admitted 后拒绝第二次 steer）；admission 后再提交同样 `value:false`；错误 shape 的批次被 RemoteError 拒绝 | `q2-lifecycle.json`（checks：*second window cannot get a second reply accepted…* / *a reply after admission is refused…*） | ✅ | 第一窗口仍 queued 时的 `REPLY_QUEUED` 错误分支未逐帧捕获（代码保证，实测命中 value:false 分支） |
| S-Q2-C | 多窗口都能看到 continued 卡片 | 第二窗口绑定同一 Session 后可见同一 `PendingQuestion`（`state:continued channel:rpc callId` 一致） | `q2-lifecycle.json`（check：*window 2 observes…*） | ✅ | 极端同时点击竞态 |
| S-Q2-D | 多题批次（多选+自由文本）原地回答 | 通过。两题批次：多选 `[OPT_A,OPT_B]` + 自由文本 custom，tool/result 逐题精确落盘 | `q2-lifecycle.json`（checks：*multi-question…* / *tool result keeps both answers exactly*） | ✅ | 分页/跳过 UI |
| S-Q2-E | 关闭/收起语义（blocking、无 callId 卡片） | 通过且发现关键语义：`dismiss()` 对 unnamed blocking 卡片是 **cancel**（reject `ASK_CANCELLED`），随后再答报 “no channel accepts an answer yet”，Session 记录 `tool/result isError errorCode=ASK_CANCELLED`；即关闭会结束模型请求，不能当「收起」 | `q2-lifecycle.json`（check：*closing an unnamed blocking card cancelled…*） | ✅（结论：游戏视图内不得对 blocking 卡调用 dismiss） | 命名卡片（timed）hide 语义未在 UI 上逐项走查 |
| S-Q2-F | 切 Session 后旧问题处理 | 通过。Session A pending 时主视图切到 Session B；A 的问题仍可按 sessionId 定位并结算，A 的 Turn 正常结束、tool/result 落盘 | `q2-lifecycle.json`（checks：*main view switched…* / *pending question for Session A stays addressable…*） | ✅ | 同 callId 跨轮次误投防御（由 callId 校验天然覆盖） |
| S-Q2-G | 原生问答 UI 与第三方消费方同时在场 | 通过。conversation view 下原生问题卡渲染（composer 内可见题干）时，第三方读取同一 pending 对象并用 `answer()` 结算；settle 后原生卡不再发布 | `q2-lifecycle.json`、`q2-native-question-coexist.png` | ✅ | 原生 UI 点击提交路径（本探针用第三方结算） |
| S-Q2-H | 浏览器重连后问题继续 | 通过。关闭整个浏览器再以同 token 重连（新 Client），open 问题再次投递（新 key、waterfall 活），可结算；Session 记录答案 | `q2-lifecycle.json`（checks：*open question is delivered again to the reconnected browser…*） | ✅ | 重连后原生 UI 与第三方同时抢答的时序 |
| S-Q2-I | timed/attachWait 的 ownership/deadline | 通过（Host 服务级、无浏览器）：无 claim 时 `askTimed(800ms)` 于 ~804ms 返回 `{pending:true}`；claim 持有时已过 nominal deadline 仍不结算；claim 首帧 `remainingMs≈1047`；释放后立即结算（总存活 ~2955ms）；对无 live wait 的 callId `attachWait` 无帧 | `q2b-attach-wait.json` | ✅ | 浏览器 Client claim 与原生 UI 协同的逐帧时序 |
| S-Q2-J | delegation/关闭（domain teardown delegate） | **未验证**：需要运行时卸载原生 `dsh-client-ui-user-questions` Client 插件触发 domain teardown，本轮未做；代码核对显示 teardown 会 delegate 未完成 owner request（README/源码），需专门探针 | —（结论表外） | ⬜ 未验证 | 同左 |
| S-Q2-K | 计划审阅 `intent=plan-review`、敏感审批 `approval/request` | **未验证/不在本探针**：普通问答与敏感审批分离是产品边界；本探针只覆盖 `ask_user_question` 普通问答，不触碰 `approval/request` | — | ⬜ 未验证 | 需要在真实模型/审批场景专项验证 |

---

## 3. 关键运行证据（逐条可复核）

### 3.1 S-Q1（blocking/open，游戏面板内结算）

```bash
cd "/Users/<user>/…/v1.5-m0"
node scripts/verification/v1.5/questions/q1-open-in-game-panel.mjs
# exit 0（26/26 required checks passed）
```

证据要点（`q1-open-in-game-panel.json`）：

- `pending.status.pending`：`{kind:"question", key:"question:<random>:1", callId:null, dismissal:"cancel", hasWaterfall:true, snapshot:{state:"open", channel:"waterfall"}}` —— 说明这是原生 UI 发布的活对象；**blocking 请求无 callId**（未携带 `wait`）。
- `pendingType`：构造器名 `PendingQuestion`，可用方法 `answer/dismiss/delegate/close/snapshot/hasWaterfall/subscribe`。
- 选中游戏面板后：`dom.probePanelVisible=true`、`dom.composerEditorCount=0`；同一 pending 对象仍 `hasWaterfall=true`。
- `answerPending(...)` → `{ok:true, elapsedMs:0}`。
- Session events：`assistant/message` → `tool/call(name=ask_user_question, arguments.timeout=-1)` → `tool/result(callId=同, answers=[{id:"probe-q1",selected:["QPROBE_OPT_A"]}])` → `step/end` → 第 2 个 `step/start` → `assistant/message` → `turn/end`；`stepStarts=2, turnStarts=1`。
- `projection`：`{active:[], settled:[]}` —— blocking（legacy schema，无 `timeout` 参数）**不被 `userQuestions` projection 跟踪**（projection 只 fold timed 调用）。这是一个需要在 M4 适配层规避的硬事实。

### 3.2 S-Q2（timed/continued、竞态、多题、关闭、切 Session、原生 UI、重连）

```bash
node scripts/verification/v1.5/questions/q2-lifecycle.mjs
# exit 0（53/53 required checks passed）
```

为让真实 Session 里的工具走 timed 分支，探针 Host 用原生 `agentPresets.register()` 注册了**仅探针使用**的 preset（`qprobe-timed`，组合 `@deepseek-ai/dsh-persona` + `@deepseek-ai/dsh-tool-ask-user` `{mode:'timed'}`），再用 `session/create {agentPreset:'qprobe-timed'}` 建会话；未改宿主自带 preset 或用户 profile。

- **A**：timed open → 5s 倒计时内不答 → `tool/result {pending:true, callId}` → Turn 结束 → projection `active:[{state:"continued"}]` → 卡片 `snapshot {state:"continued", channel:"rpc"}` → `answerViaRpc` 首窗 `{ok:true,value:true}`、二窗 `{ok:true,value:false}` → Session `user/message source.kind="user-question-reply"` + 新 Turn（turnStarts=2）→ projection settled → 状态清空。
- **C 关闭语义**：对 blocking（无 callId）卡片 `dismiss()` → 原请求被 reject `ASK_CANCELLED`（tool/result `isError:true, errorCode:"ASK_CANCELLED"`），再答报错。**游戏视图的「收起」不得透传到该对象**。
- **H 重连**：关闭浏览器后重连，open blocking 问题以新 `PendingQuestion` 再次投递并可结算（说明 Host 侧开放请求仍可回答，原生 Waterfall 路径会重投）。
- 截图：`q2-timed-game-panel-countdown.png`（游戏面板内 timed 倒计时卡片所在视图）、`q2-native-question-coexist.png`（conversation view 中原生问题卡）。

### 3.3 S-Q2b（`askTimed` / `attachWait` ownership / deadline，无浏览器）

```bash
node scripts/verification/v1.5/questions/q2b-attach-wait.mjs
# exit 0（10/10 required checks passed）
```

- 基线：`askTimed(timeout=800ms)` 无 claim → `{pending:true}`，`elapsedMs=804`。
- claim：ask 启动 400ms 后 `attachWait`，首帧 `{remainingMs:1047}`（宿主计算）；claim 持有 2502ms；nominal deadline（1500ms）已过（`heldPastDeadline≈1705ms`）而结果文件仍是 started（未结算）；释放 claim 后立即结算，总 `elapsedMs=2955, pending:true` → **claim 拥有 wait 时宿主 deadline 被暂停**。
- 无 live wait 的 callId：`attachWait` 返回 `{attached:false, frames:[]}`（不伪造帧）。

---

## 4. 这是公开接口吗？de facto 判定

| 判据 | 观测 | 结论 |
|---|---|---|
| 调用入口是否文档化/导出 | `PendingQuestion` 不是任何包的公开 export；只能经 `ctx.uiSession.sessionStatus` 收到另一个插件发布的实例 | ❌ 非公开 |
| 身份/版本契约 | 无 callId（blocking）、无 wire 类型、无版本字段；`key` 对 unnamed 卡是一次性随机 `question:<random>:<n>` | ❌ 无契约 |
| 路径依赖 | 依赖原生 `dsh-client-ui-user-questions` 插件加载并「接受」转发请求；若该插件缺失，agent 范围 waterfall 无 answerer（`NO_PROVIDER`/等到 deadline） | ⚠️ 隐式依赖 |
| 多窗口 | 每个 Client 各自持有一个 waterfall 通道；宿主只结算一次；第二窗口得到 `value:false`/RemoteError | ⚠️ 语义可用但非文档保证 |
| 可恢复性 | blocking 卡不能被 projection/日志重建；关闭/收起即 cancel；重连后靠宿主重投 | ❌ 缺持久身份 |

**判定**：对 M0 而言，`uiSession.sessionStatus → pendingInteraction → .answer(batch)` 是**可用的 de facto 接口**（足以支持 M4 自绘问题面板），但**不是稳定公开接口**。若 V1.5 正式对外版本将其作为唯一问答通道，必须做 DSH 版本门控 + 能力嗅探 + 兜底，或推动上游 seam。

---

## 5. 建议的最小 DSH 上游 seam（形状提案，尚不存在）

目标：只公开「当前 Session 的问答面板/领域 face」，不要让第三方复制审批器，也不要复制内部 React 组件或抓 DOM。

1. **Session 问答领域 face（Client 侧，稳定、可版本化）**
   ```ts
   // 建议命名空间：ctx.uiSession.questions（示意，不是现有 API）
   interface SessionQuestionsFace {
     snapshot(): {
       active: Array<{
         callId: string;            // 所有可答请求都必须有稳定 callId（含 blocking）
         kind: 'question' | 'plan-review';
         questions: Question[];      // 原生词表
         state: 'open' | 'continued';
         deadline?: { remainingMs: number };  // 宿主计算，Client 不另起超时器
       }>;
     };
     subscribe(listener: () => void): () => void;
     /** 按 callId 结算；宿主决定 waterfall/RPC 通道，调用方不需要知道 */
     answer(callId: string, batch: AnswerBatch): Promise<{ accepted: boolean }>;
     /** 收起=仅隐藏；不得结束请求。取消必须是独立显式动作 */
     hide(callId: string): void;
   }
   ```
   关键点：**宿主签发 callId**（blocking 也要有），暴露 state/channel 语义，`answer` 内部路由，`hide` 不 cancel。
2. **渲染 seam（二选一或并存）**
   - 公开一个 session-scope 的 slot/hole（如 `question.panel`），允许第三方把原生问题面板挂到 conversation 之外（游戏覆盖层）；或
   - 允许 `uiSession.registerPendingInteraction` 的发布方指定一个宿主拥有的 overlay 渲染区，使原生卡片不依赖 `conversation.composer` 挂载。
   这样游戏面板不必复制整个聊天 composer，仍复用原生表单与无障碍。
3. **Host 侧补充**
   - blocking `ask()` 路径也写入稳定 `callId` 并进入 `userQuestions` projection（或至少让 projection 记录 blocking 行），使重连/多窗口/日志关联有持久身份；
   - `dismiss` 明确拆分为 `hide`（不结算）与 `cancel`（显式取消，审计）；
   - 把 `remote.userQuestions` 命名从「实现细节」升级为文档化 Remote face（当前它是 Client 端 de facto 路径）。

**若上游短期不提供 seam**：M4 适配层按以下约束实现，风险可控：

- 只依赖「`uiSession.sessionStatus` 发布 pendingInteraction，且对象具备 `answer/snapshot/hasWaterfall` 方法」这一最小能力面；启动时做能力探测 + DSH 包版本门控（`0.2.1-rc.2` 已知可用；升级必跑本探针）。
- 自绘问题面板渲染在游戏覆盖层；提交统一走 `pending.answer(batch)`；**只有** `snapshot().state === 'continued' && channel === 'rpc'` 时才走 `ctx.remote.userQuestions.answer`。
- 不调用 `dismiss()` 处理「收起」；收起只隐藏自绘面板。
- 任何能力缺失/异常：显示「回到 DSH 会话处理」，不伪造结果、不代替批准。
- blocking 问题没有 callId：自绘面板以 `sessionId + pending.key` 定位；结算前后用 Session 事件（唯一 open 的 ask tool call）辅证；不要把 WebSocket 重连后的投影当权威。

---

## 6. 对 M4 的明确结论

1. **游戏面板内原地回答普通 AskQuestion 在 0.2.1-rc.2 上可行**（Q1 全绿），产品可以不把用户踢回会话。
2. 但支撑它的是**内部对象 + 内部 Client 插件**，不是公开 API；正式对外版本不应把它写成「DSH 支持的稳定能力」。**建议需要 DSH 上游 seam**（如上），并把它列为 M4 的依赖/风险项。
3. 危险工具审批（`approval/request`）与普通问答严格分离，本探针没有触碰；游戏内仍只提供「回到 DSH 处理」。
4. 若不做 seam，M4 必须以「版本门控 + conformance 探针（本脚本）+ 兜底回会话」模式发布，且 DSH 升级时重新跑 `run-all.mjs`。

---

## 7. 复现命令与退出码

| # | 命令（在 worktree 根目录） | 期望 exit | 实际 exit（2026-10-19 本轮） | 产物 |
|---|---|---|---|---|
| 1 | `node scripts/verification/v1.5/questions/q1-open-in-game-panel.mjs` | 0 | 0 | `q1-open-in-game-panel.json`、2 张截图 |
| 2 | `node scripts/verification/v1.5/questions/q2-lifecycle.mjs` | 0 | 0 | `q2-lifecycle.json`、2 张截图 |
| 3 | `node scripts/verification/v1.5/questions/q2b-attach-wait.mjs` | 0 | 0 | `q2b-attach-wait.json` |
| 4 | `node scripts/verification/v1.5/questions/run-all.mjs` | 0 | 0 | 汇总 `run-all.json` + 完整 stdout `run-all.log`（三个探针顺序执行、逐项 exit 0） |

每条脚本：要求外部命令一律带超时/断言；失败写 `*-failure.json` 并 exit 1；成功会删除同名旧 failure 文件。

required checks 数量（本轮实测）：S-Q1 `26/26`、S-Q2 `53/53`、S-Q2b `10/10`；`run-all.mjs` 汇总三个探针 exit code 均为 0。

原始证据目录：`docs/verification/v1.5/raw/questions/`：

- `q1-open-in-game-panel.json`、`q1-conversation-question.png`、`q1-game-panel.png`
- `q2-lifecycle.json`、`q2-timed-game-panel-countdown.png`、`q2-native-question-coexist.png`
- `q2b-attach-wait.json`
- `run-all.json`、`run-all.log`

脚本源码：`scripts/verification/v1.5/questions/`：

- `lib/probe.mjs`（隔离 home、Host 文件命令总线、浏览器与断言辅助）
- `probe-bundle/`（Host 半：脚本 LLM adapter + 探针 timed preset + 命令总线；Client 半：第三方 pending consumer + 模拟游戏 main 面板）
- `q1-open-in-game-panel.mjs`、`q2-lifecycle.mjs`、`q2b-attach-wait.mjs`、`run-all.mjs`

---

## 8. 未验证项（明确不为通过）

1. **真实 DeepSeek 模型调用**：隔离 profile 无凭据，模型由本地脚本 adapter 代替；工具与 UI 链路是真实的。
2. **真实 Game Market 面板**：本轮用同机制探针 `main` 面板模拟「conversation view 被 selectPanel 替换」；真实 `packages/client` 面板内的最终体验属 M4 真机项。
3. **headed Desktop App**：浏览器探针是 headless Chrome + `dsh web` Host，非 `DeepSeek Harness.app` 的 Electron 窗口。
4. **delegation / domain teardown**：需运行时卸载原生问答 Client 插件，未做。
5. **计划审阅（`intent=plan-review`）与敏感审批（`approval/request`）**：本轮不覆盖。
6. **`REPLY_QUEUED` 的逐帧命中**：实测命中的是「admission 后 `value:false`」分支；`REPLY_QUEUED` 仅由源码核对，未在一帧内稳定捕获。
7. **原生 UI 手动点击提交 vs 第三方提交的竞态**：仅验证并存与第三方结算，未做「两边同时点」的毫秒级竞态。
8. **跨版本 DSH 兼容**：只测 0.2.1-rc.2；无其他版本矩阵。

---

## 9. 环境与安全声明

- 只读解包 `/Applications/DeepSeek Harness.app` 的 app.asar 到 `/tmp/dsh-v15/asar`；未改 App 内任何文件。
- 所有 `DSH_HOME` 均为 `/tmp/dsh-v15/home-questions-*`；未读写 `~/.dsh`，未接触用户日常 profile/凭据。
- 证据中的问答文本均为探针占位符（`QPROBE_*`），不含真实用户内容；token 已脱敏为 `token=<redacted>`。
- 未执行任何 `git commit/checkout/merge/push/reset`；本轮只写本分支工作树文件。
