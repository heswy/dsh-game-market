# PRD｜DSH Game Market

> **文档状态**：v2.2 · 2026-10-18。第 0–7 章为产品定义与体验设计；第 8–12 章为可开发的实现级规格、界面交互规格、验收标准、任务拆解与决策日志。**两者冲突时以第 8–12 章为准**；已定决策见 12.1，待验证项见 12.2。v2.1 已按一轮独立一致性审查修复 P0/P1 问题（接口超时、容量模型、Session 字段、偏好模型、错误码、文案 key 等）。
>
> **v2.2 修订（2026-10-18，用户决策锁定）**：包格式从「`.dshgame` zip 归档」改为**单文件自包含 HTML + 内嵌 manifest v1**（`<script type="application/json" id="dsh-game-manifest">`，全文恰好一处，manifest 文本 ≤64 KiB）；V1 不引入 zip/解压/文件列表/压缩炸弹等概念，多文件资源推迟到 V1.5。随之统一：安装目录为 `packages/<id>/<version>/entry.html`；Registry 索引为 `registry/games.json`（`registryVersion: 1`），条目 `package = { url, sha256, size, releasedAt }`；新增 Host `POST /install-local`（raw `text/html`，≤20 MiB，`source: 'local'`，Client 负责二次确认）；包 URL 准入改为 host allowlist（默认 `github.com`/`raw.githubusercontent.com`/`objects.githubusercontent.com`，可配置 `allowedHosts`），删除「只允许 `/releases/download/`」的硬限制；V1 首发锁定四款 `snake`/`jump`/`2048`/`breakout`，DSH-native Demo 从 V1 阻塞范围移除。包内 `entry`、`cover`、`screenshots` 字段退出 manifest：文件本身即入口，封面/截图仅作为 Registry 条目字段。决策记录见 12.1 D-034/D-035/D-036。
>
> **V1.1 呈现规范修订（2026-10-19，用户决策锁定）**：Runtime 舞台改为**全出血（edge-to-edge）**，删除黑色舞台背景/letterbox/舞台内边距；`manifest.viewport` 仅作为推荐设计分辨率（SDK `viewport` 为实际容器尺寸），不再驱动平台等比缩放；游戏必须铺满视口并遵守平台悬浮控件安全区。开发包规范见 `docs/developer-guide.md` §4.4，决策记录 D-037。
>
> **阅读路径**：
> - 产品 / 设计：0–7 章 → 9 章（交互规格）→ 12 章（决策与风险）
> - 工程实现：8 章（工程规格）→ 9 章（界面状态）→ 10 章（验收）→ 11 章（任务）
> - 排期 / 验收：11 章（任务与里程碑）→ 10 章（验收）→ 12.2（Spike 门禁）

## 0 背景

随着 AI Agent 从“即时问答”走向 Coding、Research、文件处理等长任务，用户越来越频繁地进入一种新的使用状态：**Agent 在工作，人却只能等待**。任务执行可能持续几十秒到几分钟，期间用户既不需要持续操作，又不愿意一直盯着进度条。现有产品大多把这段时间处理成单纯的 Loading，但它实际上已经成为 Agent 产品中稳定、反复出现的一段空闲时间。

小游戏天然适合填补这种碎片化等待：启动快、单局短、随时可以暂停，也不要求用户切换到另一套复杂工作流。但如果只是内置几款小游戏，它仍然只是一个小功能，内容数量和生命周期都会很有限。真正有价值的是把“等待时玩什么”开放出来，让用户可以选择、安装并持续游玩自己喜欢的游戏，让开发者也能低成本制作和发布新的小游戏。

DSH 本身拥有插件化能力和 Agent 工作流，因此很适合承载这样一个游戏市场。`DSH Game Market` 希望把 Agent 执行过程中的等待时间变成一个可持续的游戏空间：游戏可以保留上一局进度、记录分数和排行榜，也可以感知 Agent 是否正在工作、何时完成。用户不再只是“等 Agent 干完”，而是在同一个 DSH 环境里拥有一套可以长期积累的小游戏体验。

## 1 产品定义

`DSH Game Market` 是一个运行在 DSH 内的小游戏市场与运行平台。用户只需安装一次插件，就可以在其中发现、安装、启动和管理不同小游戏，并保留游戏进度、历史成绩和排行榜等长期状态。

它提供一套统一的游戏运行环境。游戏以独立的轻量 Game Package 存在，由 `DSH Game Market` 负责安装、运行、状态保存以及与 DSH 的通信。**所有游戏都运行在与 Agent 工作状态联动的统一 Runtime 中**，能够感知 Agent 是否正在工作以及任务何时完成。当 Agent 完成任务时，游戏以轻量方式提醒用户，但不强制结束当前游戏，也不改变原有工作进程。

这也是 `DSH Game Market` 的核心产品原则：**不打断工作，只填充等待。** 用户可以在 Agent 工作时进入游戏，在任务完成后自主决定立即返回工作，还是继续完成当前一局；游戏本身的进度则可以持续保存，在下一次等待时继续。

同时，`DSH Game Market` 面向开发者提供统一的 Game SDK、开发模板和发布规范。开发者无需理解 DSH 底层实现，也无需自行处理 Agent 状态与游戏生命周期的基础联动，只需要基于模板完成游戏本身，即可接入存档、分数、排行榜等平台能力，并将游戏发布到市场中。

因此，产品最终由三个核心部分组成：**面向用户的 Game Market、负责承载游戏并协调 Agent 工作状态的 Game Runtime，以及面向开发者的 Game SDK 与 Template。**

## 2 核心体验 / 用户场景

`DSH Game Market` 的核心体验围绕一条非常简单的链路展开：**Agent 开始工作 → 用户进入游戏 → Agent 完成任务 → 用户自主返回工作。** 游戏始终附着在原有工作流旁边，而不是将用户带入一个独立、封闭的新场景。

### 2.1 等待时进入游戏

当用户向 Agent 发起一个需要一定执行时间的任务后，`DSH Game Market` 可以在不干扰当前界面的前提下提供轻量入口，例如提示“Agent 正在工作，要不要玩一局？”。用户可以直接进入最近玩过的游戏、继续上一局，也可以临时选择其他已安装游戏。

整个过程不改变 Agent 的执行状态，也不要求用户离开当前 DSH 工作环境。游戏只是覆盖原本无操作价值的等待时间。

### 2.2 游戏可以跨多次等待持续进行

游戏不是一次性的 Loading 彩蛋，而是一个可以长期存在的状态。

用户这次只玩了两分钟，Agent 就完成了任务，可以随时退出；下一次 Agent 再开始执行长任务时，用户可以继续上一局。关卡、分数、角色状态、道具或其他进度都能够被保存。

因此，零散的 Agent 等待时间可以被不断连接起来，形成连续的游戏体验。

### 2.3 Agent 完成后，游戏提醒但不打断

当 Agent 完成当前任务时，Game Runtime 将完成状态同步给正在运行的游戏。

游戏以轻量方式告诉用户：

> Agent 已完成任务

但不会强制暂停、结束或关闭当前游戏。

用户可以立即返回查看结果，也可以先完成当前这一局，再回到工作。决定权始终属于用户。

### 2.4 在等待之外发现和管理游戏

用户也可以主动进入 Game Market 浏览游戏。

市场提供游戏推荐、分类、搜索、最近游玩和已安装游戏等基础能力。用户找到感兴趣的游戏后，可以直接安装并加入自己的游戏库；后续进入等待状态时，这些游戏就成为可随时启动的选择。

因此，等待场景负责触发游玩需求，而 Game Market 负责持续丰富“等待时可以玩什么”。

### 2.5 游戏体验具有长期积累

每款游戏都可以拥有自己的存档、历史成绩和排行榜。用户的游玩行为不会随着一次 Agent Session 结束而消失，而会持续沉淀为长期状态。

例如用户可以看到自己的最高分、最近一局、历史成绩和游戏进度，并在下一次等待时继续挑战。

这使 `DSH Game Market` 从“等待时偶尔打开的小功能”，变成一个会随着使用 DSH 不断积累的个人游戏空间。

### 2.6 开发者可以不断扩充这个空间

开发者可以基于 `DSH Game Market` 提供的 Template 和 SDK 创建小游戏，并直接接入平台统一的存档、分数、排行榜以及 Agent 生命周期能力。

开发者无需重新解决“如何接入 DSH”“如何知道 Agent 是否完成”“如何保存游戏状态”等问题，只需要完成游戏本身，并按照统一规范发布到市场。

最终，用户获得越来越丰富的游戏选择，开发者获得一个低门槛的创作与分发渠道，而 `DSH Game Market` 则持续扩大 Agent 等待场景中的内容供给。

## 3 产品设计

### 3.1 整体产品结构

`DSH Game Market` 在用户侧由三个主要空间组成：

**Market** 用于发现和安装游戏；**My Games** 用于管理已安装游戏、最近游玩和存档；**Game Runtime** 用于真正运行游戏，并负责与当前 Agent 工作状态保持连接。

用户不需要理解这三层的技术区别。实际体验应当尽可能接近：

> Agent 开始工作 → 点开一个游戏 → 玩 → Agent 完成 → 回去工作。

Game Market 不应该成为一个需要用户专门“经营”的复杂产品，而应该始终保持轻量、低学习成本和快速启动。

### 3.2 游戏入口与等待触发

Game Market 应同时存在**主动入口**和**等待入口**。

**主动入口**是左侧 Sidebar 中常驻的 Game Market 图标（`sidebar.panellist`）。用户可以随时打开，用于浏览游戏、管理游戏和查看记录；图标同时承担状态指示：Agent 运行中、需要用户、有新完成未读时显示对应的轻量状态点。它保证 Game Market 本身不是一个只有 Agent 工作时才能进入的临时页面。

**等待入口**是最核心的使用入口。触发规则固定为：绑定 Session 的 Agent **连续运行满 5 秒**后，在会话头顶部（`conversation.header.leading`，标题之前）出现轻量 chip，例如：

> 🎮 Agent 正在工作 · 继续上一局

或：

> 🎮 Agent 正在工作 · 选择一个游戏

点击 chip 展开一个小菜单（继续上一局 / 选择一个游戏 / 暂时忽略），**不自动打开游戏**，也不遮挡 Agent 当前执行信息。用户选择忽略后，同一 turn 内不再出现；下一次 Agent 开始运行时重新计时。短于 5 秒的任务不出现入口。如果用户此刻已经在 Game Market 面板中，则不显示 chip：Runtime 内由小鲸鱼承担状态提示，Market／My Games 浏览态由面板顶部提示条承担（见 9.1.7、9.2.7）。

入口的具体状态机、菜单结构、文案、键盘与动效见 9.1。

### 3.3 Market 首页

Market 首页承担“发现游戏”的作用，但不需要做成传统大型游戏商店。

首屏优先展示最适合当前场景的内容，例如：

- **Continue Playing**：存在未完成进度时优先展示
- **Recently Played**：最近玩过的游戏
- **Quick Play**：适合几十秒到几分钟等待时间的游戏
- **Popular**：人工精选游戏（V1 不采集下载量与评分）
- **New**：新发布游戏

同时提供搜索和简单分类，例如 Arcade、Puzzle、Card、Idle 等。

游戏卡片只展示做决策最需要的信息：游戏名称、封面、作者、游戏类型、是否已安装，以及必要的人工精选标记（V1 不采集评分）。

首页不追求信息密度，而追求用户能够在几秒内回答：

> **“我现在玩什么？”**

### 3.4 游戏详情与安装

点击游戏后进入详情页。

详情页需要帮助用户快速判断这款游戏是否值得安装，核心信息包括游戏预览、名称与作者、简介、类型、版本、大小、所需权限、排行榜入口以及 Install / Play / Continue 等操作。

安装过程尽量保持一次点击完成。游戏安装后进入 My Games，并可以直接启动。

Game Market 负责游戏的安装、更新和卸载。对于用户而言，不需要接触游戏包文件、依赖或其他实现细节。

如果游戏请求额外能力，例如读取经过限制的当前任务上下文，需要在安装或首次使用时明确展示权限，不允许游戏绕过 Runtime 直接获得 DSH 权限。

### 3.5 My Games

My Games 是用户自己的游戏库。

这里不是简单罗列“安装过什么”，而是承担用户长期游戏状态的入口。游戏可以展示当前进度、最近游玩、个人最高分、未完成状态、总游玩时长以及更新状态。

拥有未完成状态的游戏优先出现 **Continue**，而不是 **Play**。Continue 的判定由游戏通过 SDK 显式声明的 Session 决定（见 4.3 与 8.3），平台不靠猜测“看起来是否玩过”。

例如：

> **2048**  
> 上一局：8,240 分  
> Continue

或者：

> **Pixel Dungeon**  
> Chapter 4 · Lv.12  
> Continue

这也是产品区别于普通 Loading Game 的核心体现：**每一次短暂等待都可以接着上一次继续。**

### 3.6 Game Runtime / 游戏运行态

游戏运行态是整个产品最重要的界面之一。

当用户进入游戏后，除 DSH 原有的左侧侧边栏外，**右侧主要工作空间可以完整交给游戏使用**。不继续保留聊天窗口、Agent 执行日志或额外的工作面板，也不把游戏限制在一个狭窄的小 Pane 中。用户既然选择用等待时间玩游戏，就应该获得一个完整、舒服的游戏空间。

但进入游戏不意味着 Agent 从界面中消失。Game Runtime 在游戏右下角始终保留一个由 DeepSeek 小鲸鱼形象承担的 **Agent Presence**。小鲸鱼是游戏状态与原工作流之间的连接点，让用户在不退出游戏的情况下，始终知道 Agent 当前发生了什么。

小鲸鱼根据 Agent 状态产生不同反馈，例如：

> 🐳 正在工作…

> 🐳 正在运行测试…

> 🐳 需要你回答一个问题

> 🐳 任务完成啦

普通运行状态保持安静，只提供轻量的状态感知，不持续占用用户注意力。当 Agent 状态发生真正需要用户知道的变化时，小鲸鱼通过动作、状态变化或短气泡进行提示。

其中需要区分三类状态：

**进行中状态**：Agent 正常执行任务。小鲸鱼保持低存在感，用户无需处理。

**需要用户状态**：例如 Agent 触发 AskQuestion、需要确认权限或等待用户选择。小鲸鱼明显进入“等待你”的状态，并展示问题入口。用户点击后，Runtime 先暂停并保存当前游戏，再切回 Conversation，由 DSH 原生审批/提问界面接管；处理完成后，会话头部出现“继续游戏”入口，用户点击即可回到游戏并从存档恢复；默认停在暂停遮罩，用户确认后再开始（D-024）。游戏不会在后台继续运行，也不会丢失进度；完整流程见 9.2。

**已完成状态**：Agent 已完成当前任务。小鲸鱼提示任务完成，并提供“查看结果”入口，但游戏保持正常运行。

这样，用户进入游戏后不需要在“玩游戏”和“盯 Agent”之间来回切换。**游戏占据空间，小鲸鱼负责维持 Agent 的存在感。**

Game Runtime 同时统一负责游戏加载与退出、Save / Auto Save、Pause / Resume、分数记录、Agent 状态同步、用户交互等待处理、完成提醒、异常恢复以及返回工作。

### 3.7 Agent 完成后的返回体验

Agent 完成任务时，不额外弹出大型 Modal，也不强制暂停或关闭当前游戏。

右下角的小鲸鱼从运行状态切换为完成状态，并通过轻量气泡告诉用户：

> 🐳 任务完成啦  
> `查看结果`

用户可以立即点击小鲸鱼返回 Agent，也可以继续完成当前这一局。只要用户仍然停留在游戏中，小鲸鱼保持“任务已完成”的状态，让用户知道工作已经可以继续，但不重复催促。

核心原则是：

> **Agent 完成意味着工作已经可以继续，而不是游戏必须立刻结束。**

相比强制退出游戏，这种方式让工作和游戏之间形成一个非常清楚的主次关系：Agent 决定什么时候工作完成，用户决定什么时候回去。

### 3.8 退出、暂停与状态保存

所有游戏都必须默认支持用户随时离开。

当用户返回 Agent、关闭游戏、切换游戏、关闭 DSH 或 Agent 完成后离开时，Runtime 都会通知游戏进入 Pause / Save 流程，并保存必要状态。

自动保存策略固定为：**每 30 秒一次**、**关键节点**（暂停、页面隐藏、离开游戏、Agent 完成提醒、游戏自身声明的关键节点）各一次、**离开前强制一次**。单游戏存档总量上限 1MB（≤32 个 key、单值 ≤256KB），超出时拒绝写入并向开发者报错；进程被强杀时最多丢失最近 30 秒（详见 8.4、8.6）。

平台区分两类状态：

**Game Save** 用于保存游戏世界本身，例如关卡、棋盘、角色状态和道具。

**Session Record** 用于记录某一次游玩，例如本局得分、开始时间、结束时间和结果。

这样既能支持“继续上一局”，也能支持长期成绩统计。

### 3.9 分数与排行榜

对于存在明确分数或结果的游戏，平台提供统一排行榜能力。

第一阶段优先支持当前成绩、Personal Best、历史成绩和本地排行榜。排行榜入口既可以出现在游戏结束页面，也可以出现在游戏详情页。排序方向（越高越好/越低越好）由内嵌 manifest 的 `score.direction` 声明；V1 只做本地榜，不做登录与全球榜。具体数据模型见 8.2 与 8.6。

开发者只需要向 Runtime 提交标准化结果，排行榜的存储、展示和排序由平台负责。

后续如果引入在线服务，可以进一步扩展为 Global Leaderboard、Weekly Leaderboard 和社区排行，但排行榜始终是增强游戏持续性的能力，而不是 MVP 必须依赖的核心闭环。

### 3.10 游戏与 Agent 的统一关系

所有游戏都通过统一 Runtime 感知 Agent 生命周期，因此不存在“普通游戏”和“Agent-aware 游戏”两套完全不同的运行模式。

对于最普通的小游戏，Agent 联动可以仅体现为小鲸鱼所承载的 Agent 状态：

> Agent 工作中 / 等待用户 / Agent 已完成

更加深入的游戏则可以使用更多经过平台允许的能力，例如根据任务类型改变游戏反馈，或使用有限、脱敏后的上下文生成内容。

但无论游戏如何设计，都需要遵守同一个产品原则：

> **游戏可以利用 Agent 状态丰富体验，但不能影响 Agent 的正常工作，也不能要求用户为了游戏改变原有工作流程。**

Agent 是主流程，Game Market 是围绕等待时间存在的伴随体验。

## 4 开发者体系

开发者体系的目标不是让开发者“学会写 DSH 插件”，而是让一个会做 Web 小游戏的人，甚至只会使用 AI Coding 的人，也能够快速做出一款可以运行在 `DSH Game Market` 中的游戏。

DSH 原生插件基于 Cordis，插件通过 Context 注册 Service、Event 和 Effect，并以 Bundle/Profile 的方式进入实际运行组合。Web 侧又拥有独立的 `dsh.client` 插件机制。因此这些复杂性应该由 `dsh-game-market` 自己吸收，而不是暴露给普通游戏开发者。

整个开发者体系遵循一个原则：

> **Game Market 适配 DSH，Game SDK 适配游戏。**

### 4.1 Game Market 与 DSH 的技术关系

`dsh-game-market` 本身是一个正式的 DSH Plugin / Bundle。

Host 侧负责游戏安装、Registry、存档、成绩、Agent 状态监听等能力；Client 侧负责 Market UI、Game Runtime、小鲸鱼 Agent Presence 以及具体游戏的展示。

所有 DSH-specific 能力都封装在 Game Market 内部，游戏本身不直接依赖 Cordis、DSH Service 或 DSH Client API。

这样即使 DSH 后续发生 breaking change，也只需要修改 Game Market 的 Adapter，而不需要让整个游戏生态跟着迁移。

### 4.2 Game Package

市场中的游戏不作为 DSH Plugin 安装，而使用独立的轻量 **Game Package**。

V1 的 Game Package 是**一个自包含的单文件 HTML**（D-034），例如：

```text
snake-1.0.0.html           # UTF-8 无 BOM，≤20 MiB；JS / CSS / 图片 / 字体全部内联
```

文件本身即游戏入口；游戏的基础信息与运行要求以**内嵌 manifest** 的形式写在 HTML 中：

```html
<script type="application/json" id="dsh-game-manifest">
{
  "manifestVersion": 1,
  "id": "snake",
  "name": "Snake",
  "version": "1.0.0",
  "author": { "name": "orange" },
  "description": "经典贪吃蛇。",
  "categories": ["arcade"],
  "capabilities": ["storage", "score"],
  "sdkVersion": "^1.0.0",
  "runtimeVersion": "^1.0.0",
  "viewport": { "width": 960, "height": 540, "fit": "contain" }
}
</script>
```

manifest 声明游戏的基础信息和运行要求；`icon` 使用 data URI，封面/截图等展示素材只存在于 Registry 条目，不进入游戏包。Game Package 本质上是一份已经构建完成的静态游戏资源。用户安装游戏时，Game Market 只下载、验证并保存这一个文件，不在用户机器上执行第三方安装脚本。V1 要求包是**自包含单文件**：所有 JS、CSS、图片、字体都内联进 HTML，游戏运行时不请求任何外部子资源；多文件资源能力在 V1.5 验证后再开放。完整字段、校验规则与包格式见 8.2：单文件 ≤20 MiB，安装阶段只做校验与落位。

### 4.3 Game SDK

所有游戏通过统一的 `Game SDK` 与 Game Runtime 通信。

SDK 只暴露小游戏真正需要的少量能力，例如：

```ts
import { game } from "@dsh-game/sdk"

await game.ready()

await game.storage.save("current", state)
const state = await game.storage.load("current")

game.score.submit(score)
game.score.getBest()

game.lifecycle.on("pause", pauseGame)
game.lifecycle.on("resume", resumeGame)

game.agent.getStatus()
game.agent.on("status", status => {})
```

其中 `game.session.start()/end()` 决定 My Games 是否显示 Continue；`game.storage` 是每游戏隔离的命名空间，单次存档 ≤1MB；`game.agent.*` 只读。完整 API、错误码与超时语义见 8.3。

SDK 不向游戏暴露 Cordis Context，也不提供文件系统、Shell、Credential、任意 Tool 调用等底层 DSH 权限。

其中，**Agent Presence 是平台能力，而不是游戏能力。**

小鲸鱼、Agent 运行状态、需要用户介入的提醒和任务完成提醒由 Game Runtime 自动提供。开发者即使完全不调用 `game.agent.*`，他的游戏仍然天然符合“Agent 工作时玩、Agent 有事时提醒”的产品原则。

`game.agent.*` 只用于允许开发者进一步利用 Agent 状态设计玩法。

### 4.4 开发模板

开发者的第一步不应该是读文档，而应该是直接创建一个可以运行的游戏。

提供：

```bash
npx create-dsh-game my-game
```

创建时可以选择 Vanilla / Canvas、React、Phaser、Three.js 等模板。

模板自动包含 Game SDK、构建配置、Manifest 和基础生命周期处理。对于大部分简单小游戏来说，从创建项目到看到第一个可运行画面，不应该要求开发者进行任何 DSH 配置。

### 4.5 Local Preview / Runtime Simulator

开发模板中提供一个本地 **Game Runtime Simulator**。

Simulator 模拟真实的 DSH Game Runtime，并允许开发者主动切换 Agent Running、等待用户、Agent Completed、Pause、Resume、Clear Save 等状态。

开发者不需要真的让 Agent 跑一个长任务，即可验证完整的游戏生命周期。

### 4.6 开发者只负责游戏，平台负责公共能力

Game Runtime 统一负责 Agent Presence、小鲸鱼、Agent 生命周期、用户交互入口、游戏暂停恢复、Sandbox、安装更新和返回工作。

Game SDK 统一负责 Save / Load、Score、Leaderboard、Achievement 与生命周期 API。

开发者主要负责游戏规则、画面、操作、音效和游戏内部体验。

开发者的核心心智始终应该是：

> **我在做一个小游戏，而不是在开发一个 DSH 系统插件。**

### 4.7 Build、打包与发布

开发完成后，通过统一 CLI 完成：

```text
dsh-game build
      ↓
dsh-game validate
      ↓
dsh-game pack
      ↓
dsh-game publish
```

最终生成独立的单文件 HTML 包 `dist/<id>-<version>.html`。（CLI 各子命令的输入输出、校验项与退出码见 8.2；Registry 发布格式见 8.8。）

构建和依赖安装发生在开发者机器或 CI 中，最终用户只获得已经构建好的静态产物。

V1 可以优先采用 GitHub Repository + Release + Registry Index 的轻量发布方式，在真正形成开发者规模后再建设 Developer Console、审核、Analytics 和版本后台。

### 4.8 游戏更新与兼容性

游戏拥有独立版本号，同时声明支持的 Game SDK 与 Runtime Version。

Game Market 在更新前检查兼容性，不兼容版本不自动升级。

游戏只依赖 Game Runtime Contract，不直接依赖 DSH 内部版本：

```text
Game
  ↓
Game SDK
  ↓
Game Runtime
  ↓
DSH Adapter
  ↓
DSH
```

### 4.9 安全边界

第三方游戏默认作为不可信内容处理。

游戏不能直接访问 DSH Cordis Context、文件系统、Shell、用户 Credential、Agent Tool、本地系统 API 或其他游戏的数据，只能通过 Game SDK Bridge 与 Runtime 通信。

如果未来允许访问网络、Workspace 或 Agent 上下文，则这些能力必须成为显式 Capability。

安全原则是：

> **小游戏默认是不可信内容，Game Runtime 是可信边界。**

### 4.10 面向 AI Coding 的开发体验

小游戏天然适合 AI Coding：规模小、反馈快、结果高度可视化。

Template 中应预置 Game SDK 文档与 Agent 开发说明，让开发者可以直接要求 Agent：

> “基于 DSH Game Template 给我做一个打砖块游戏。”

生成后直接 Preview、修改并发布。

长期可以进一步提供 **Create a Game**，让用户在 DSH 内描述玩法，由 Agent 基于官方模板创建本地游戏项目。

## 5 技术架构与实现边界

### 5.1 DSH 中的实际安装形态

`dsh-game-market` 本身按照 DSH 官方的 **Bundle** 机制发布，而不是修改 DSH Core。

**DSH** 的运行结构由 Profile 和 Bundle 组合而成。Bundle 是 npm package，通过 `package.json` 中的 `dsh.bundle` 指向 `cordis.patch.yml`，由 patch 向 Cordis Plugin Tree 插入 Game Market 所需的 Host 和 Client 组件；用户则通过 `dsh plugin --profile web add ...` 将 Bundle 安装到自己的 Web Profile 中。DSH 会把该 Bundle 加入 Profile 的有序组合层。

因此项目在 DSH 中的关系是：

```text
web Profile
   │
   ├── @deepseek-ai/dsh-base
   ├── @deepseek-ai/dsh-web-app
   └── dsh-game-market
            │
            ├── Host Service
            └── Client Plugin
```

Game Market 是 DSH 的一个正常扩展层，而不是 fork、patch Core 或额外启动一套独立应用。

同时在 Bundle 中声明适配的 `engines.dsh` 范围，由 DSH 在安装和启动阶段检查兼容性，避免在不兼容版本上强行加载。

### 5.2 Host 与 Client 分层

技术上将 `dsh-game-market` 明确拆为 Host 与 Client 两部分。

**Host 是权威状态层。** 它运行在 DSH Host Cordis Context 中，负责游戏安装信息、Package 管理、持久化存档、成绩记录、Registry 请求，以及把 DSH Agent 生命周期转换成 Game Runtime 可以理解的状态。

**Client 是展示和交互层。** 它通过 `dsh.client` 声明成为 DSH Web Client Plugin，由 DSH 的 Client Modules 系统加入浏览器启动图并按需加载。DSH 当前就是通过这种方式加载浏览器侧功能插件，而不是要求第三方直接改 React 主应用。

两层之间不共享 Node 对象，也不让浏览器直接访问 Host Context，而遵守 DSH 自己的依赖路径：

```text
DSH Host
   ↓
Game Market Host Service
   ↓
Remote / Stream
   ↓
Game Market Client Model
   ↓
Game Runtime UI
   ↓
Game SDK Bridge
   ↓
Game
```

这与 DSH 当前 Web Client 的标准数据方向保持一致：权威状态存在 Host，通过 Remote 或 stream 到 Client Model，再由 UI Adapter / Slots 进入 React。

### 5.3 Market 与游戏如何占据主工作区

Game Market 不需要覆盖 Conversation DOM，也不需要把游戏塞进右侧 Sidebar。

DSH 的 AppFrame 本身由左侧 Sidebar、中央 Main 和右侧区域组成。其中 `main` 是一个 root-scoped keyed Slot，`conversation` 只是官方保留的其中一个 key；插件可以注册自己的 Global Panel，再通过 `ctx.layout.selectPanel(id)` 在不同 Main Panel 之间切换。

因此 Game Market Client 注册一个自己的 Main Panel，例如：

```text
main
├── conversation
├── plugins
└── dsh-game-market
```

用户进入 Market 或开始游戏时：

```ts
ctx.layout.selectPanel("dsh-game-market")
```

中央 Main 整体切换到 Game Market。

左侧 DSH Sidebar 仍由原 AppFrame 管理，因此保留。这里需要修正一个实现层认知：切到 `dsh-game-market` 时，Conversation 子树会随 main key 切换而**卸载**（不是简单隐藏）；宿主会保留当前 Session、输入草稿和语义阅读位置，返回时恢复，但 DOM 选区、光标与输入法状态不会保留。因此 Game Runtime 的页面状态必须放在组件之外（模块级 store），返回游戏按“重新加载 + 恢复存档”设计，而不是依赖 Conversation 或游戏组件一直存活。

用户点击小鲸鱼的“查看结果”或主动返回工作时：

```ts
ctx.layout.selectPanel(null)
```

重新选回 Conversation。

这意味着“**左侧仍然是 DSH，右边整个主空间交给游戏**”能够建立在 DSH 已有的 Global Panel 机制上，而不是依赖 CSS 覆盖或 DOM Hack。

Game Market 内部的 Market、My Games、Game Runtime 不再分别注册多个 DSH Panel，而是在同一个 `dsh-game-market` Panel 内维护自己的页面状态：

```text
DSH Main Panel
    ↓
dsh-game-market
    ├── Market
    ├── My Games
    ├── Game Detail
    └── Game Runtime
```

这样切换游戏不会反复修改 DSH 的全局布局状态。

### 5.4 Agent 状态桥接

Game Market 不通过观察聊天 UI、Loading 动画或 DOM 判断 Agent 是否仍在工作，而直接接入 DSH Agent Runtime。

DSH 区分两类事件：`agent/*` 用于正在发生的实时 Agent 状态，Session Event 则用于已经写入 Session Log、需要在刷新后仍然存在的事实。Agent Loop 本身提供 Turn、Step、Tool Call、状态与错误等生命周期信息。

Game Market Host 在这一层建立一个 **Agent State Adapter**，将复杂的 DSH 状态压缩成游戏真正需要的少量状态，例如：

```ts
type GameAgentState =
  | "idle"
  | "running"
  | "waiting-user"
  | "completed"
  | "error"
```

必要时再附带一个简短的 presentation：

```ts
{
  state: "running",
  label: "正在运行测试…"
}
```

Game Runtime 和小鲸鱼只依赖这个稳定模型，而不直接理解 `turn/start`、`step/end`、`tool/result` 等 DSH 内部事件。状态映射、优先级、多 Session 绑定与等待态检测见 8.9。V1 中 Host 维护权威快照，游戏页可见时由 Client 以 1 秒轮询快照接口获取（D-015）；不轮询 `agent/status`。

这也是 Adapter 层存在的意义：未来 DSH 改变 Agent Loop 事件结构时，只修改这里即可。

### 5.5 Agent Presence 与用户介入事件

小鲸鱼由 Game Runtime 自己渲染，不属于第三方游戏 iframe，因此每款游戏无需自行实现。

对于普通运行、完成和异常状态，Agent State Adapter 即可提供信息。

对于**需要用户立即介入**的状态，则优先接 DSH 已有的 Interaction seam。DSH 当前已经有正式的 User Approval subsystem：Host 通过 `approval/request` 发出请求，Client 的 `ui-approval` 负责展示并返回用户决定。

Game Market 不重新实现一套权限审批逻辑，而只承担“在游戏态提醒用户”的职责：

```text
DSH approval / interaction
        ↓
Game Market Adapter
        ↓
🐳 需要你处理一下
        ↓
用户点击
        ↓
进入对应的 DSH 原生交互
```

对于 AskQuestion 这类由具体 Tool 或未来 DSH Interaction 能力提供的结构化提问，同样通过 Adapter 接入，而**不把某个具体 Tool 名写死在 Game Runtime 中**。

因此产品层可以统一表现为“Agent 正在等你”，技术层则继续尊重 DSH 原本拥有该交互的 Service。

### 5.6 Host → Client 状态同步

**已按本机 DSH Desktop（0.2.1-rc.2）契约修正：第三方 bundle 不能新增 `ctx.remote` namespace。** Game Market 使用宿主已验证的 UI→Host 通道：Host 半在 `inject: ['connection']` 下通过 `ctx.connection.fetch.register(...)` 注册窄 HTTP 路由，Client 用同源相对路径 `fetch('api/game-market/...')` 调用。Game Market 不自己建立 WebSocket Server，也不需要生成 Remote 类型。

接口按业务拆成窄端点，例如：

```text
GET  /api/game-market/games
GET  /api/game-market/game?id=
GET  /api/game-market/installed
POST /api/game-market/install
POST /api/game-market/install-local
POST /api/game-market/uninstall
GET  /api/game-market/save?gameId=
POST /api/game-market/save
POST /api/game-market/session
GET  /api/game-market/scores?gameId=
POST /api/game-market/score
GET  /api/game-market/preferences
POST /api/game-market/preferences
GET  /api/game-market/agent-state?sessionId=
POST /api/game-market/launch
GET  /api/game-market/entry?gameId=&version=&instance=&nonce=
GET  /api/game-market/preview?gameId=&version=&file=
```

写接口一律使用 POST：`connection.fetch` 只允许 `GET/HEAD/POST`，且路径是精确匹配（无 `/:id` 模板），资源定位通过 query 与 body 完成。

完整端点、载荷与错误码见 8.5。Agent 状态采用 snapshot 语义：进入游戏时获取一次当前状态，游戏页可见期间以 1 秒轮询获取变化（D-015）。接口语义不依赖具体传输方式，后续若验证 SSE/长轮询可行，Client 不需要改协议。

这样游戏运行页面即使比 Agent 晚打开，也能立刻拿到当前 Agent 状态，不会因为错过一个实时事件而不知道 Agent 在做什么。

### 5.7 数据持久化

游戏长期状态不写入 Session Log。

**V1 的实现选择是插件自有存储目录**：Host 使用 `$DSH_HOME/storages/dsh-game-market/`（`DSH_HOME` 默认 `~/.dsh`），以 JSON 文件持久化，写入采用原子替换（临时文件 + rename + `.bak` 恢复）。这样做的原因是：`ctx.storageDomain` 虽存在于 Host 服务目录，但第三方 bundle 的 `defineDomain` 用法尚未验证，不作为 V1 依赖；待 Spike S-01/S-02 通过后，可在不改接口的前提下迁移。

Host 至少维护以下逻辑分区：

```text
installations.json
preferences.json
saves/
  <gameId>/
    current.json
    meta.json
sessions/
  <gameId>.json
scores/
  <gameId>.json
registry-cache.json
packages/
  <gameId>/<version>/
```

具体 Save 按 `gameId` 隔离，`gameId` 必须经过白名单校验以防路径穿越。更完整的数据 schema、配额、原子写、并发与损坏恢复规则见 8.6。

Game Save 与 Session Record 也保持分离。

Game Save 是当前可恢复状态；Session Record 是一次历史游玩记录。关闭 DSH 后，下一次启动仍然可以恢复上一局。

游戏包是单文件 HTML，本身包含图片、JS 等静态资源，因此不塞入数据库。Host 使用 Game Market 自己管理的 package 目录保存 `entry.html`，元数据与业务状态保存在上述 JSON 文件中。

### 5.8 Game Runtime 与安全沙箱

这一层不是直接复用 DSH Agent 的文件系统 Sandbox，因为那套 Sandbox 服务于 Agent Tool，而第三方小游戏运行在浏览器中，安全边界不同。

因此 Game Runtime 自己建立浏览器 Sandbox。

游戏最终运行在独立 iframe 中，第三方 Game Package 不作为 DSH Client Plugin materialize 到 Cordis Client Context，也不能注册 DSH Service 或 Slot。

推荐的关系是：

```text
DSH Client
    │
Game Runtime                Trusted
    │
────────────────────────────────────
    │  postMessage / SDK Bridge
    ↓
Sandboxed iframe            Untrusted
    │
  Game
```

默认 Sandbox 只允许游戏自身脚本运行，不提供 DSH Host API、Cordis Context、本地文件系统、Credential 或原生 Desktop Bridge。V1 的具体 `sandbox` 属性、CSP、postMessage 校验与能力矩阵见 8.4 与 8.10。需要说明：这里使用 iframe 是**不可信游戏内容的安全边界**，与 DSH 插件 UI 规范中“插件界面不要用 iframe”的约束不冲突。

Game SDK 实际上只是 iframe 中的一层 Bridge Client。比如：

```ts
game.storage.save(...)
```

不会直接写 Storage，而是：

```text
Game
 ↓
SDK
 ↓ postMessage
Game Runtime
 ↓ HTTP（/api/game-market/*）
Game Market Host
 ↓
$DSH_HOME/storages/dsh-game-market/
```

所有权限控制都发生在可信 Runtime 一侧，而不是相信第三方游戏“自觉”。

### 5.9 Game Package 安装路径

Game Package 不使用 DSH 的：

```text
dsh plugin add
```

因为官方 `dsh plugin` 最终会将一个 npm package 作为 Bundle 加入 Profile，并允许其中的插件代码进入 Cordis Tree。这个权限级别适合 `dsh-game-market` 本身，不适合任意小游戏。

游戏安装由 Game Market Host 自己完成：

```text
Registry
   ↓
下载 <id>-<version>.html
   ↓
校验 hash（sha256）
   ↓
解析 HTML 内嵌 manifest + 自包含校验
   ↓
落位到 packages/<id>/<version>/entry.html
   ↓
记录 installation metadata
   ↓
Client 可启动
```

安装阶段不执行：

```text
npm install
pnpm install
prepare
postinstall
任意游戏自定义脚本
```

游戏必须在发布前已经构建成单文件、浏览器可运行的静态产物。

这也是 Game Package 相比 DSH Plugin 最核心的安全区别。（完整安装流程、校验与失败回滚见 8.7。）

### 5.10 Registry 与 Market 数据

V1 不需要为了 Market 立刻搭建复杂后端。

Registry 可以先是一份远程索引：

```json
{
  "registryVersion": 1,
  "generatedAt": "2026-10-18T00:00:00Z",
  "games": [
    {
      "id": "snake",
      "name": "Snake",
      "version": "1.0.0",
      "package": {
        "url": "https://github.com/example/dsh-game-snake/releases/download/v1.0.0/snake-1.0.0.html",
        "sha256": "…",
        "size": 921004,
        "releasedAt": "2026-10-10T09:00:00Z"
      },
      "sdkVersion": "^1.0.0"
    }
  ]
}
```

Game Market Host 拉取 Registry，再与本地 installation metadata 合并，最终提供给 Client。

因此 Market 页面本身不直接访问 GitHub，也不让每个游戏自己联网：

```text
Registry
   ↓
Game Market Host
   ↓
Remote
   ↓
Market Client
```

后续切换到真正的 Registry API 时，Client 和 Game Runtime 都不需要改变。（Registry JSON 结构、缓存 TTL 与离线策略见 8.8。）

### 5.11 版本兼容关系

系统实际存在三层版本：

```text
DSH
 ↑
DSH Adapter / Game Runtime
 ↑
Game SDK
 ↑
Game
```

`dsh-game-market` Bundle 用 `engines.dsh` 约束自己支持的 DSH 版本；游戏 Manifest 则使用 `runtimeVersion` 与 `sdkVersion` 声明它支持的 Game Runtime。

因此 DSH 发生 Breaking Change 时：

> 修改 DSH Adapter / Game Market

而不是：

> 要求所有小游戏一起升级。

这是项目能否形成生态的关键技术边界。（版本匹配算法、升级/回滚与兼容矩阵见 8.11。）

### 5.12 MVP 的实际工程结构

第一版可以控制在一个 monorepo 中：

```text
dsh-game-market/
├── packages/
│   ├── host/             # DSH Host plugin
│   ├── client/           # dsh.client + Market UI
│   ├── runtime/          # iframe / Agent Presence / Bridge
│   ├── sdk/              # 给游戏开发者使用
│   ├── create-game/      # Template CLI
│   └── game-cli/         # build / validate / pack
│
├── games/
│   ├── snake/
│   ├── jump/
│   ├── 2048/
│   └── breakout/
│
├── registry/
│   └── games.json
│
├── cordis.patch.yml
└── package.json
```

其中真正直接依赖 DSH API 的代码尽量限制在：

```text
packages/host
packages/client
```

而：

```text
runtime
sdk
games
```

尽可能保持 DSH-agnostic。

这样既符合 DSH 当前 Everything is a Plugin 的架构，也能够把 Game Runtime 做成一层相对稳定的产品协议。

### 5.13 技术实现原则

整个项目最终遵循一条明确的依赖方向：

```text
Game
  ↓
Game SDK
  ↓
Sandbox Bridge
  ↓
Game Runtime
  ↓
Game Market Client
  ↓
DSH Remote
  ↓
Game Market Host
  ↓
DSH Services
```

任何第三方游戏都不能跳过这条链路直接访问 DSH。

对于 DSH 来说，整个游戏生态最终只表现为一个正常安装的 `dsh-game-market` Bundle；对于游戏开发者来说，DSH 又几乎是不可见的。

**DSH 负责提供可扩展的 Agent 宿主，Game Market 负责在其上建立游戏运行平台。两层之间保持明确边界。**

## 6 前端视觉与交互设计

`DSH Game Market` 的视觉目标不是做一个“很像游戏商城”的界面，而是让它看起来像一个原本就属于 DSH 的系统级空间，同时拥有比普通工具产品更轻松、更有生命力的气质。

整体设计参考 macOS / iOS 的空间层级、材质和动效语言，但不直接复制 Apple UI。核心审美可以概括为：

> **Quiet shell, playful content.**

平台本身安静、克制、精确；游戏内容可以自由、鲜活、有个性。

### 6.1 视觉原则

Game Market 的界面首先应该是一个**内容空间**，而不是一个由大量边框、按钮和卡片堆起来的后台系统。

视觉设计遵循四个原则：

**内容优先。** 游戏封面、游戏画面和正在运行的游戏是视觉中心，平台 UI 主动后退。

**层级清晰。** 内容层、导航层、浮动控制层之间要有明确空间关系，而不是所有元素都处在同一平面。

**材质克制。** 玻璃、模糊、阴影只用于表达悬浮关系和功能层级，不把所有 Card 都做成毛玻璃。

**动效有意义。** 动效主要解释“从哪里来、到哪里去、发生了什么”，而不是持续制造视觉刺激。

产品不追求传统 Gamer UI 常见的高饱和、霓虹灯、HUD 和赛博朋克感。

它应该更像：

> **一个安静、精致的 macOS 应用，里面恰好住着很多有趣的小游戏。**

### 6.2 与 DSH 视觉系统保持连续

Game Market 不是独立网站，因此不能进入插件后突然切换成另一套设计系统。

基础字体、正文尺寸、背景、前景色、分割线以及 Light / Dark 状态优先继承 DSH Theme。实现层面应消费 DSH 已有 Design Tokens，而不是在 Game Market 内重新硬编码一套颜色。

需要自行建立的 Game Market Token 也应该建立在 DSH Semantic Token 之上，例如：

```text
--game-surface
--game-surface-elevated
--game-glass
--game-border
--game-text-primary
--game-text-secondary
--game-accent
```

它们根据当前 DSH Theme 自动解析。

这样用户从 Conversation 切换到 Game Market 时，感受到的是**空间改变了，但仍然处于同一个产品中**。

### 6.3 内容层与控制层

整个 UI 明确分为两个视觉层级：

```text
Control / Navigation Layer
──────────────────────────
Game / Content Layer
```

**内容层**包括游戏封面、游戏列表、详情内容以及真正运行的 Game。

它可以拥有游戏自己的颜色、插画和视觉风格，不要求所有游戏统一成 DSH 风格。

**控制层**包括返回、搜索、Install / Play、小鲸鱼 Agent Presence、临时菜单以及其他平台级操作。

控制层可以采用轻量的半透明材质、背景模糊和细微阴影，与下方内容形成深度关系。

原则是：

> **Glass belongs to controls, not content.**

因此不会出现“整个页面几十张透明玻璃 Card”的设计。

### 6.4 Market 首页视觉

Market 首页不设计成 Steam 式高密度商品列表，而更接近具有编辑感的内容浏览空间。

首屏首先出现最重要的一件事：

**Continue Playing。**

如果用户存在上一局，它应该是首页最明显的入口，可以使用相对大的横向 Hero Card 展示当前游戏、进度和 Continue。

下面再自然展开：

```text
Continue Playing

Quick Play
──────────────
○ ○ ○ ○

Popular
──────────────
○ ○ ○ ○

New
──────────────
○ ○ ○ ○
```

游戏卡片以封面为核心，平台信息主动减少。

默认状态只显示：

**封面 + 游戏名 + 极少量辅助信息。**

Hover 后才逐步出现 Play、排行榜或更多操作。

页面应保留充足留白，不用边框把每一个区域封起来。Section 主要通过间距、标题和对齐建立结构。

### 6.5 游戏卡片

游戏卡片应该具有“物件感”，但不能像传统 Web Card 一样显得笨重。

默认状态保持安静：

- 清晰封面
- 柔和圆角
- 非常轻的边缘分离
- 游戏名称
- 必要状态

鼠标 Hover 时，卡片不是简单放大，而产生非常轻微的抬升和内容反馈：

```text
hover
 ↓
封面轻微响应
 ↓
阴影 / 高光变化
 ↓
Play 控件自然出现
```

卡片本身不进行明显弹跳。

点击卡片进入详情页时，应优先使用具有空间连续性的过渡，让用户感受到：

> **这张卡片展开成了游戏详情。**

而不是页面突然消失，再加载另一页。

### 6.6 游戏详情页

详情页应该尽可能让游戏本身说话。

顶部使用较大的游戏视觉素材建立氛围，游戏信息和操作作为第二层出现。

页面的主要行动始终保持明确：

> `Install`

> `Play`

> `Continue`

只有一个 Primary Action。

版本、作者、权限、大小等信息保持低视觉权重，需要时再查看。

如果游戏拥有独特主色，可以允许其视觉素材轻微影响详情页背景氛围，但不能覆盖 DSH 的基础 Theme，也不改变平台级控件的可读性。

### 6.7 游戏运行态

进入游戏以后，**平台 UI 几乎全部消失。**

除左侧 DSH Sidebar 外，整个 Main Panel 交给 Game Runtime。

游戏内容尽可能占满有效空间。

不额外常驻：

- Market 导航
- 游戏介绍
- 排行榜
- 顶部大 Toolbar
- Agent Log

平台只保留少量必要的悬浮控制以及右下角的小鲸鱼 Agent Presence。

这时整个界面的视觉中心必须百分之百属于游戏。

原则是：

> **进入游戏以后，Market 要学会消失。**

### 6.8 小鲸鱼 Agent Presence

小鲸鱼是整个 Game Market 最重要的平台级视觉元素，也应该成为最有记忆点的设计。

它不是一个普通聊天机器人悬浮按钮，而是 **Agent 在游戏空间中的化身**。

默认位于右下角，与边缘保持舒适距离，并拥有非常小的视觉面积。

它不应该持续晃动、跳跃或主动吸引视线。

不同状态通过**姿态 + 极轻动效 + 文案**表达：

#### Running

小鲸鱼保持安静，可以拥有非常缓慢、幅度极小的呼吸感或状态光点。

> 正在工作…

一般情况下不弹气泡。

#### Tool / Stage Change

如果 Agent 进入一个有意义的新阶段，例如运行测试，可以短暂出现：

> 正在运行测试…

随后自动收起，只留下鲸鱼。

#### Waiting for User

这是最高优先级状态。

鲸鱼可以从安静状态明显“醒来”，通过一次短促、克制的动作吸引注意力：

> 需要你回答一个问题

此状态持续存在，直到用户处理。

但不能连续弹跳、闪烁或重复播放动画。

#### Completed

任务完成时，鲸鱼产生一次完整但柔和的状态变化，并展开消息：

> 任务完成啦  
> `查看结果`

之后进入稳定的 Completed 状态，不重复催促。

#### Error

出现需要用户知道的异常时，以明确但不过度警报化的方式表现：

> 遇到了一点问题  
> `查看`

颜色不是唯一的信息渠道，同时依靠图形和文本表达状态。

### 6.9 小鲸鱼气泡

鲸鱼气泡可以成为整个产品最接近 Liquid Glass 的元素之一。

它位于游戏内容之上，因此需要同时满足：

- 与游戏背景分离
- 不完全遮挡内容
- 保持较高可读性
- 明确属于系统控制层

气泡采用轻量半透明材质与背景模糊，但根据游戏背景自动调整透明度和前景对比度。

气泡不是聊天框。

一般只容纳：

```text
状态描述
+
1 个主要行动
```

例如：

> 任务完成啦  
> 查看结果

或：

> Agent 在等你的选择  
> 去回答

避免在游戏中展开长篇 Agent 内容。

### 6.10 页面与游戏之间的空间动效

Game Market 的动效核心是**空间连续性**。

从 Conversation 进入 Game Market，不应该像打开一个网页链接，而更像当前 DSH 工作空间切换到另一个 Mode。

从 Market 点击游戏时：

```text
Game Card
    ↓
自然放大 / 展开
    ↓
Game Detail
    ↓
Play
    ↓
Game Runtime
```

从 Runtime 返回时则反向收回。

尤其是：

> `Conversation → Game → Conversation`

应该保持用户对原有工作位置的记忆。

用户从游戏返回后，应该立刻回到之前的 Session 和滚动位置，而不是重新进入一个“新的聊天页”。

### 6.11 Motion Language

整体动效参考 macOS / iOS 的自然运动感，但不追求模仿系统动画参数。

原则是：

**位置变化使用自然减速或轻量 Spring。**

**Opacity 用于辅助，不依靠纯 Fade 解决所有页面切换。**

**空间发生变化时，尽可能让元素具有来源和去向。**

**状态反馈短而明确。**

例如：

Game Card 点击后不是：

```text
fade out
→
fade in
```

而是：

```text
Card
→ expand
→ Detail
```

小鲸鱼气泡不是突然出现，而从鲸鱼附近自然展开。

Agent 完成时不是 Toast 从屏幕顶部砸下来，而是小鲸鱼本身发生状态变化。

动画时间总体保持短促。普通微交互约为数百毫秒以内，页面级空间切换可以略长，但任何动画都不能阻碍操作。

### 6.12 Hover 与 Pointer 反馈

由于 DSH 的主要使用环境是 Desktop，Hover 是重要的质感来源。

按钮和 Card 在 Hover 时应当出现轻微的材质、亮度或深度变化，而不是所有元素都进行明显 Scale。

建议更多使用：

- 背景亮度变化
- 边缘高光变化
- Shadow 深度变化
- Icon 细微位移
- Cursor 反馈

较少使用：

- 大幅 Scale
- Bounce
- Rotation
- 持续漂浮

目标是：

> **手感存在，但视觉保持稳定。**

### 6.13 圆角与几何语言

整体采用连续、柔和的圆角语言，但避免“所有东西都是胶囊”。

建议形成层级：

**Window / 大内容容器**

使用较大的圆角。

**Card / Preview**

使用中等圆角。

**Button / Search / Control**

根据尺寸使用中小圆角。

**状态 Pill**

只有真正适合短文本状态时才使用胶囊形态。

同一层级的圆角保持一致，避免页面出现大量 8px、10px、12px、14px、16px 随意混用的情况。

几何语言总体偏柔和，但必须保持 macOS Desktop 应有的精确感。

### 6.14 色彩策略

Game Market 本身不建立一个强烈的品牌主色去压过所有游戏。

基础 UI 使用 DSH 当前主题。

游戏封面和游戏本身负责提供色彩。

平台 Accent 主要用于：

- Primary Action
- 当前 Selection
- Agent 需要用户关注的状态
- 少量品牌识别

Market 页面因此可以保持相对中性，让不同游戏成为真正的视觉焦点。

Dark Mode 不是简单把白色换成黑色，而需要重新控制边缘、材质、Shadow、玻璃透明度和对比度。

### 6.15 Typography

字体体系完全跟随 DSH 当前 UI 字体配置，不为 Game Market 单独加载另一套系统字体。

重点通过字号、字重和空间建立层级：

```text
Page Title
Section Title
Game Title
Body
Metadata
Caption
```

避免大量 Bold。

大标题可以拥有更强视觉存在感，但普通信息应保持轻量。

游戏开发者自己的 iframe 内可以自由决定游戏字体，但平台层 UI 永远保持一致。

### 6.16 Iconography

平台 Icon 应保持简单、几何化和统一线宽。

可以参考 macOS / SF Symbols 的视觉逻辑，但 Web 产品不依赖或直接复制 Apple 专有资源；优先沿用 DSH 已有 Icon 体系，缺失部分再补充风格一致的开放 Icon。

Icon 不应带装饰性背景，除非它本身是一个独立的可点击控制。

优先：

```text
icon
```

而不是：

```text
rounded-square
  ↓
 icon
```

避免界面充满“小方块按钮”。

### 6.17 Light / Dark / System

Game Market 必须原生支持 DSH 的：

```text
Light
Dark
System
```

不额外增加一套独立 Theme Switch。

所有平台 UI 都跟随 DSH Theme 即时变化。

游戏 iframe 自身可以声明：

```text
preferredTheme:
  system
  light
  dark
  game-defined
```

对于支持 System 的游戏，Runtime 可以把当前主题状态通过 SDK 告知游戏。

但平台不会强制第三方游戏改变其艺术风格。

### 6.18 Reduce Motion 与无障碍

精致动效不能成为使用产品的前提。

Runtime 需要识别 `prefers-reduced-motion`。开启后：

- Shared Element 大幅位移减少
- Spring / Bounce 被替换为简单过渡
- 小鲸鱼取消持续运动
- 状态变化依然通过文本和视觉层级表达

游戏市场的核心导航需要支持键盘操作和清晰 Focus 状态。

Agent 状态也不能只依靠颜色表达，例如 Waiting、Completed、Error 都同时具有图形或文本信息。

### 6.19 游戏与平台视觉边界

Game Runtime 不强迫游戏采用 Game Market 的 Design System。

这是非常重要的边界。

Snake 可以是像素风。

卡牌游戏可以是手绘风。

2048 可以极简。

三维小游戏也可以拥有完整自己的艺术方向。

Game Market 只规定：

- 游戏画布如何进入和退出
- 平台悬浮控件如何覆盖
- Safe Area
- Agent Presence 区域
- Pause / Resume 生命周期
- 必要的 Accessibility Contract

因此最终形成的是：

```text
DSH Visual System
        ↓
Game Market Shell
        ↓
────────────────
        ↓
Game's Own World
```

平台提供统一秩序，但不把所有游戏做成同一种样子。

### 6.20 明确避免的设计

以下视觉方向不进入 Game Market：

**不做满屏毛玻璃。**  
玻璃只属于悬浮导航和控制层。

**不做 Steam 式信息堆积。**  
Market 的核心是快速决定“现在玩什么”，而不是展示所有元数据。

**不做赛博朋克 Gaming UI。**  
DSH Game Market 是一个 AI 工作产品中的游戏空间，不是电竞启动器。

**不让小鲸鱼持续卖萌。**  
它首先是 Agent Presence，其次才是 Mascot。

**不为了动效牺牲速度。**  
所有 Transition 都必须允许用户快速操作，不出现“动画没放完所以不能点”的情况。

**不让 Game Market 的品牌压过游戏本身。**  
平台越安静，游戏越有表现空间。

### 6.21 最终视觉体验

理想情况下，用户第一次进入 Game Market 时不应该产生：

> “这里换了一套 UI。”

而应该觉得：

> “DSH 里面原来还有这样一个空间。”

当用户点击 Play 后，又应该感觉：

> “现在这个空间属于游戏了。”

当右下角的小鲸鱼告诉用户：

> “任务完成啦。”

用户能够立刻意识到：

> “Agent 一直都还在。”

因此整个前端设计最终服务于同一个产品哲学：

> **工作没有离开，游戏也不只是 Loading。**

> **用安静的系统 UI 承载有趣的游戏，用自然的动效维持工作与游戏之间的连续性。**

### 6.22 实现级界面规格

本章描述视觉方向与设计原则；所有可实现的交互细节、状态矩阵、文案（zh/en）、动效时长与无障碍规则以第 9 章为准。两者不冲突时互为补充，冲突时以第 9 章为准。

## 7 MVP 范围与版本规划

`DSH Game Market` 的第一阶段目标不是建立一个完整游戏平台，而是验证一个最核心的产品判断：

> **当 Agent 进入持续执行状态后，用户是否愿意留在 DSH 内，通过一个可持续的小游戏体验度过等待时间，并在 Agent 需要自己时自然返回工作。**

因此 MVP 必须同时证明三件事：游戏能够自然进入 DSH 工作流；游戏状态能够跨多次等待持续存在；第三方游戏可以通过统一 Runtime 和 SDK 接入，而不需要成为 DSH Plugin。

第一版只围绕这三个目标建设，其他能力一律后置。

### 7.1 V0：跑通核心体验

V0 的目标是先证明：

> **“Agent 工作 → 玩游戏 → Agent 找你 → 回去工作”这条链路真的成立。**

这一阶段不追求真正的 Market 生态，也不需要外部开发者参与。

需要完成：

**DSH 接入。**  
`dsh-game-market` 能够作为正常 Bundle 安装进入 DSH，并注册自己的 Main Panel。

**游戏空间。**  
用户能够从 DSH 进入 Game Market，再进入 Game Runtime。游戏占据 Main Panel，左侧 Sidebar 保持不变。

**Agent State Adapter。**  
至少能够稳定识别：

```text
running
waiting-user
completed
error
```

并同步给 Client。

**小鲸鱼 Agent Presence。**  
完成 Running、Waiting for User、Completed、Error 四个基础状态及对应的返回工作入口。

**基础 Runtime。**  
能够加载并运行一个受控的静态游戏，支持 Pause / Resume 和退出。

**基础 Save / Load。**  
用户关闭游戏后可以恢复上一局。

**首个 Demo Game。**  
选择一个足够简单、但有明确持续状态的游戏，例如 2048。

V0 不需要搜索、不需要排行榜、不需要 Developer CLI，甚至不需要真的“安装游戏”。但仍需包含：等待入口（5 秒阈值）、小鲸鱼四态与完成提醒、需要用户时切回处理并可一键返回、Continue 判定与 30 秒自动保存——这些是 V0 必须证明的体验，不是可选项。

如果这条体验链路本身不好玩，后面的 Market 没有意义。

### 7.2 V1：形成真正的 Game Market MVP

当 V0 的核心体验成立后，进入 V1。

V1 需要形成一个用户可以独立安装和持续使用的完整产品。

#### 用户侧

完成：

- Market 首页
- My Games
- Game Detail
- Game Runtime
- Install / Uninstall
- Continue Playing
- 最近游玩
- Personal Best
- 基础历史成绩
- Agent Presence
- Agent 完成 / 等待用户提醒
- Light / Dark / System
- 基础动效与视觉系统

用户第一次安装 `dsh-game-market` 后，应当不需要任何额外配置就能开始玩。

#### Game Runtime

V1 需要正式建立单文件 Game Package（自包含 HTML + 内嵌 manifest v1）。

Runtime 至少完成：

- Game Package 加载
- Manifest 校验
- iframe Sandbox
- 单文件自包含游戏包与 CSP
- SDK Bridge
- 生命周期管理
- Save / Load
- Session 记录与 Continue 判定
- 自动保存（30 秒 + 关键节点）
- Score
- Package Version
- 游戏数据隔离
- Runtime Version 检查

这一阶段意味着游戏已经不再写死在 Game Market Client 中，而是真正作为独立 Package 被 Runtime 承载。

#### Developer SDK

V1 的 SDK 只做真正必要的接口。

建议控制在：

```ts
game.ready()

game.storage.save()
game.storage.load()

game.score.submit()
game.score.getBest()

game.lifecycle.on("pause")
game.lifecycle.on("resume")

game.agent.getStatus()
game.agent.on("status")

game.session.start()
game.session.end()

const info = game.runtime   // 版本 / 主题 / 能力，只读
```

暂不为了“看起来完整”加入复杂 API。

第一版 SDK 的评价标准不是能力有多少，而是：

> **一个开发者能不能在很短时间内理解完。**

#### 开发模板

完成至少一个正式模板：

```text
Vanilla / Canvas
```

同时可以再提供一个开发者体验更友好的：

```text
React
```

Phaser、Three.js 等模板可以后续补充，不阻塞 V1 发布。

提供：

```bash
npx create-dsh-game
```

以及 Local Runtime Simulator。

#### 发布与 Registry

V1 不建设完整 Developer Console。

采用轻量 Registry：

```text
GitHub Repository
+
Release / 静态 Package
+
registry/games.json
```

支持从 Registry 发现和安装游戏即可。

发布流程可以先以 PR 或 CLI 辅助提交为主，不要求真正做到“一键自动审核上线”。

### 7.3 首发游戏

首发游戏的目标不是堆数量，而是证明不同类型游戏都能够正常运行在 Runtime 中。

V1 首发名单已锁定为四款：`snake`（内置）、`jump`（跳跃）、`2048`、`breakout`（打砖块）；四款均计入“至少四个首发游戏”的验收范围（D-036）。

**2048**

用于验证：

- Save / Load
- Continue
- Score
- Personal Best
- 键盘操作

它应当成为最基础的 Runtime Sample。

**Snake**

用于验证：

- 实时输入
- Pause / Resume
- Game Over
- Score

同时也是最容易被用户理解的 Quick Play 游戏。

**Jump（跳跃）与 Breakout（打砖块）**

两款分别验证纵向平台跳跃与街机弹球循环：连续输入、无尽分数、多关卡与生命、球速变化，以及 Agent 完成时“不强制打断”的体验。

**DSH-native Demo（V1 不做，延后由用户主导）**

原计划的首发 DSH-native Demo 已从 V1 阻塞范围移除：由用户亲自带人后续推进，不阻塞 V1 验收与发布（D-036）。

V1 的首发四款统一走 V1 SDK/契约、单文件自包含，具备分数/最高分/暂停/自动保存/Continue；四款都通过平台统一的 Agent Presence（小鲸鱼）获得“游戏知道 Agent 在工作”的基础联动。

### 7.4 V1 不做什么

以下能力明确不进入 V1。

**不做全球账号体系。**

优先 Local-first，不为了排行榜引入登录。

**不做全球排行榜。**

第一版 Personal Best 和本地历史已经足够验证持续游玩。

**不做好友和社交。**

没有必要为了游戏市场先建设社交网络。

**不做多人联机。**

实时房间、匹配和网络同步都会显著扩大工程范围。

**不做游戏内购买。**

MVP 不涉及商业化。

**不做开发者收益分成。**

只有形成真实分发规模后才有讨论意义。

**不做完整 Developer Console。**

V1 的开发者规模不足以支撑独立后台。

**不做复杂评论与评分系统。**

下载量、最近更新和简单推荐已经足够完成发现。

**不做自动化内容审核平台。**

首批游戏数量可控，采用人工审核即可。

**不默认开放 Workspace / Prompt / File 权限。**

Agent-aware 首先通过 Agent 生命周期实现。读取工作内容属于后续高权限能力。

**不开放游戏联网。**

V1 的游戏 iframe 默认阻断网络（`connect-src 'none'`）；联网能力属于后续显式 Capability，需要重新做安全评审。

**不做几十种 SDK Capability。**

只开放已经有明确使用场景的能力。

**不追求大量首发游戏。**

三个真正完成度高的游戏，比二十个粗糙 Demo 更重要。

### 7.5 V1 完成标准

V1 不是“所有功能都写完”就算完成，而是需要形成一个可以独立演示的完整闭环。

一个新用户应该能够：

```text
安装 dsh-game-market
        ↓
打开 Market
        ↓
安装一款游戏
        ↓
让 Agent 开始任务
        ↓
进入游戏
        ↓
小鲸鱼显示 Agent 正在工作
        ↓
游戏过程中自动保存
        ↓
Agent 需要用户 / Agent 完成
        ↓
小鲸鱼提示
        ↓
用户返回 Conversation
        ↓
下一次等待继续上一局
```

一个新开发者应该能够：

```text
create-dsh-game
        ↓
修改游戏逻辑
        ↓
Local Preview
        ↓
测试 Agent 状态
        ↓
Build / Validate
        ↓
生成单文件 HTML 包 `<id>-<version>.html`
        ↓
在 Game Market 中安装运行
```

只要这两条链路都能够顺畅完成，V1 就已经具备发布价值。对应的可执行验收清单见 10.2–10.4，性能与安全验收见 10.5–10.7。

### 7.6 V1.5：开始验证生态

V1.5 不做大规模重构，重点观察用户和开发者是否真的愿意持续使用平台。

用户侧可以逐步加入：

- 本地排行榜
- Achievement
- 更完整的搜索与分类
- 自动更新
- Favorite
- 更丰富的 Continue Playing
- 游戏时长与历史记录

开发者侧可以增加：

- Phaser Template
- Three.js Template
- 更完善的 Validator
- Package Size / Performance 检测
- CLI Publish
- SDK 文档站
- 示例游戏仓库

这一阶段最重要的是让**第一个非项目作者的开发者成功发布一款游戏**。

这比继续增加十个官方游戏更有价值。

### 7.7 V2：从插件走向平台

只有当用户游玩和第三方供给都被验证后，再进入平台化阶段。

V2 可以考虑：

**在线 Registry Backend**

替代静态 `registry/games.json`。

**Developer Account / Console**

管理 Game、Version、Release、Analytics。

**Global Leaderboard**

建立跨用户排行。

**Cloud Save**

实现跨设备同步。

**Rating / Review**

提升游戏发现效率。

**自动审核与安全扫描**

包括 Manifest、Package、网络访问和静态代码风险检测。

**更丰富的 Agent Context API**

在用户授权下允许游戏使用有限的 Session / Workspace Context。

**Create a Game**

直接在 DSH 中调用 Agent 基于官方 Template 创建游戏。

**社区内容运营**

例如：

- Game of the Week
- New & Noteworthy
- Waiting Game Challenge
- Developer Spotlight

这时 `DSH Game Market` 才真正从“一个好玩的 DSH 插件”开始演进成游戏生态。

### 7.8 版本规划原则

产品演进始终遵循一个顺序：

> **先证明等待时玩游戏成立，再证明游戏可以持续，再证明开发者愿意供给，最后才建设平台。**

因此：

```text
V0
验证核心交互
    ↓
V1
形成完整可发布产品
    ↓
V1.5
验证第三方供给
    ↓
V2
平台化与在线生态
```

任何功能如果不能帮助当前阶段验证对应假设，都应该推迟。

尤其需要避免一个最容易出现的问题：

> **在还没有人玩游戏的时候，先把游戏平台基础设施全部造完。**

`DSH Game Market` 的第一阶段应该保持足够轻，快速跑出真实体验，再让产品规模随着真实需求增长。

## 8 工程规格

第 8 章把第 4、5 章的技术方向落成可实现的契约：8.1 约定写法与事实分级；8.2–8.8 覆盖包格式、数据、安装与 Registry；8.9–8.12 覆盖 Agent 桥接、安全、兼容与诊断；8.13 统一错误码映射。**本章是实现权威来源；与第 4、5 章冲突时以本章为准。** 未验证项统一标注为 `Spike S-xx`，清单见 12.2。

### 8.1 规格约定与术语

**权威性。** 第 8 章是实现与验收的权威来源。本章与第 3–7 章冲突时，以第 8 章为准（D-018）；产品取舍以 12.1 决策日志为准，DSH 契约事实以本章 8.1 末尾的 F-01～F-12 契约基线表为准。本节定义全章共用的语言、标识与错误处理原则，8.3–8.13 不再重复。

#### 规范用语

| 用语 | 含义 | 验收方式 |
|---|---|---|
| **必须（MUST）** | 不满足即视为缺陷，阻断合并/发布 | 自动化测试或人工检查清单 |
| **禁止（MUST NOT）** | 出现即视为安全或正确性缺陷 | 同上，安全项按 8.10 的攻击用例 |
| **应当（SHOULD）** | 默认做法；偏离需在 PR 说明中记录理由与替代验证 | Code Review 记录 |
| **可以（MAY）** | 可选实现，不得成为其它规则的隐含前提 | 无 |

数值一律写死或来自 Manifest/Config，不写“尽量”“合理”“视情况”。时间单位默认毫秒（`ms`），除非字段名带 `At`（ISO 8601 字符串）。

#### 事实分级

| 级别 | 标记 | 写作要求 |
|---|---|---|
| 已核实 | `（已核实 F-06）` 或 `（已核实：<证据位置>）` | 可直接作为实现约束；证据优先为 DSH 0.2.1-rc.2 的 inspection/随包源码/本机已跑通实现 |
| 推断 | `（推断）` | 由已核实事实组合得出；必须给出验证点或降级方案 |
| 待验证 | `**待验证（Spike S-xx）**` | 必须同时写出验证方法与降级方案；编号见 12.2（包/数据段 S-01～S-09，本章段 S-10～S-19，界面段 S-20～S-25） |

未标注的陈述默认是“已核实”。写不出证据的陈述必须降级标注。**禁止编造 DSH API**：凡涉及 `ctx.*`、事件名、Slot、`connection.fetch` 的字段，只能来自 F-01～F-12 或随包源码，不得凭产品文档推测。

#### 术语表

| 术语 | 定义 |
|---|---|
| **Host** | `dsh-game-market` 的 Host 半，运行在 DSH Host Cordis Context，是安装、存档、成绩、Registry、Agent 状态的权威层 |
| **Client** | 插件浏览器半，注册 `main` 面板与 `conversation.header.leading` 入口，渲染 Market / My Games / Runtime 外壳 |
| **Runtime** | Client 内的可信运行层：管理 iframe 生命周期、Bridge 服务端、Agent Presence、存档调度 |
| **Bridge** | Runtime 与游戏 iframe 之间的 `postMessage` 协议层；SDK 是它在 iframe 内的客户端 |
| **Game Package** | 单文件自包含 HTML（UTF-8 无 BOM，≤20 MiB），内嵌 manifest v1；文件本身即入口；格式与校验见 8.2/8.7 |
| **Manifest** | HTML 内嵌的 `<script type="application/json" id="dsh-game-manifest">`，声明 `id`、`version`、`sdkVersion`、`runtimeVersion`、`capabilities` 等；字段定义以 8.2 为准 |
| **Play Session** | 一次游玩区间，由 SDK `game.session.start/end` 声明，Host 持久化为 Session Record |
| **Game Save** | 游戏世界状态，按 `gameId` 隔离，单游戏上限 1MB（D-005） |
| **Session Record** | Play Session 的持久记录：`playSessionId`、起止时间、`outcome`、`score`、耗时 |
| **DSH Session** | Conversation 的会话对象（`sessionId`），用于 D-006 的 Agent 状态绑定；与 Play Session 不是一个概念 |
| **Agent Presence** | 平台自绘的小鲸鱼状态呈现；游戏不实现也能获得 |
| **Capability** | Manifest 显式声明的能力；默认拒绝 |
| **Spike** | 未验证项的最小验证任务；编号与清单见 12.2 |

为避免歧义：字段 `sessionId` 一律指 DSH Session；游戏会话一律用 `playSessionId`。SDK 的 `game.session` 命名保留产品语义，返回 `playSessionId`。

#### 标识与版本

| 标识 | 规则 | 示例 |
|---|---|---|
| `gameId` | kebab-case，`^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$`，3–48 字符，禁止连续 `--`；保留字以 8.2.4 为准，本节至少保留 `api`、`assets`、`health`、`launch` | `2048`、`snake`、`whale-idle` |
| 游戏版本 | semver `MAJOR.MINOR.PATCH[-prerelease]`，**禁止 build metadata（`+`）**，≤64 字符；作为安装记录与入口缓存键 | `1.0.0`、`1.2.0-beta.3` |
| 入口版本键 | V1 用 `version` 作为入口缓存/校验键；不再生成 `assetKey`（V1.5 多文件时再定义） | `1.0.0` |
| `instanceId` / `nonce` | 32 位小写 hex，每次 launch 重新生成 | — |
| `playSessionId` | `ps_` + 24 位小写 hex | `ps_4d2a…` |
| `requestId` | `req_` + 16 位小写 hex，Host 生成并回显 | — |
| 能力名 | `^[a-z][a-z0-9-]{0,31}$` | `storage`、`score` |
| 包文件名 | `<id>-<version>.html`，与 manifest 的 `id`/`version` 一致 | `snake-1.0.0.html` |

包是单文件，不存在“包内路径”规则；V1 资源路由只有 `/entry`（固定文件 `packages/<id>/<version>/entry.html`）与 `/preview`（Registry 缓存素材），不按文件名注册，也不接受任何来自包的路径或文件名。

#### 错误码

统一格式 `GM-<4 位数字>`，按段分配；错误体必须同时带 `code`、`message`（英文诊断）、`retryable`，可选 `details`。用户可见文案由 Client 按 `code` 映射（完整表见 9.8，高频项见 8.12），不得把 `message` 直接展示给用户。

| 段 | 用途 | 代表错误 |
|---|---|---|
| `GM-400x` | 请求格式/参数 | `GM-4001 INVALID_JSON`、`GM-4002 INVALID_PARAM`、`GM-4004 UNKNOWN_METHOD` |
| `GM-403x` | 状态/权限/未就绪 | `GM-4031 NOT_READY`、`GM-4032 CAPABILITY_DENIED`、`GM-4033 SESSION_NOT_BOUND` |
| `GM-404x` | 资源不存在 | `GM-4041 SAVE_NOT_FOUND`、`GM-4042 GAME_NOT_FOUND`、`GM-4043 ASSET_NOT_FOUND` |
| `GM-409x` | 冲突/并发/重复 | `GM-4091 INSTALL_IN_PROGRESS`、`GM-4092 STORAGE_CONFLICT`、`GM-4093 SESSION_STATE_CONFLICT` |
| `GM-413x` | 体积/配额 | `GM-4131 SAVE_TOO_LARGE`、`GM-4132 STORAGE_QUOTA`、`GM-4133 STORAGE_KEY_INVALID`、`GM-4134 VALUE_NOT_SERIALIZABLE` |
| `GM-415x` | 媒体类型 | `GM-4150 UNSUPPORTED_MEDIA_TYPE` |
| `GM-422x` | Manifest/包语义 | `GM-4221 MANIFEST_INVALID`、`GM-4222 PACKAGE_INVALID`（细节见 8.2/8.7） |
| `GM-426x` | 版本兼容 | `GM-4260 RUNTIME_INCOMPATIBLE`、`GM-4261 SDK_INCOMPATIBLE` |
| `GM-429x` | 频率/背压 | `GM-4290 RATE_LIMITED`、`GM-4291 BACKPRESSURE` |
| `GM-500x` | Bridge/协议 | `GM-5001 HANDSHAKE_TIMEOUT`、`GM-5002 PROTOCOL_MISMATCH`、`GM-5003 NO_RUNTIME`、`GM-5004 MESSAGE_INVALID`、`GM-5005 BRIDGE_TIMEOUT` |
| `GM-501x` | Runtime/iframe | `GM-5011 LOAD_TIMEOUT`、`GM-5012 IFRAME_UNRESPONSIVE`、`GM-5013 IFRAME_CRASHED`、`GM-5014 ASSET_INTEGRITY` |
| `GM-502x` | 持久化 | `GM-5021 SAVE_WRITE_FAILED`、`GM-5022 SAVE_CORRUPT`、`GM-5023 HOST_EPOCH_STALE` |
| `GM-503x` | 服务/Registry | `GM-5031 HOST_UNAVAILABLE`、`GM-5032 REGISTRY_UNAVAILABLE`、`GM-5033 INSTALL_FAILED` |

新增错误码必须落在本节已分配的段内，并在 §8.13 维护完整码表与 HTTP 映射（8.5）、文案 key（8.12）；不得复用已发布语义。8.2/8.6/8.7/8.8 的 `E_*` 在 SDK/HTTP 面映射为本表对应的 `GM-*`，完整映射表见 §8.13。

**与包/安装/存储域的关系。** §8.2、§8.6、§8.7、§8.8 中的 `E_*` 是 Host 内部常量名；面向 API/Bridge 的对外错误码一律使用本节 `GM-*`，完整映射见 §8.13。新增 `E_*` 必须同时在 §8.13 登记对应 GM 码。

#### 错误处理总原则

1. **Fail-closed。** 未知能力、未知协议版本、哈希不符、Manifest 不合法、路径不符字符集，一律拒绝执行；默认值只能是“不授予”。
2. **用户可见、可恢复。** 每个错误都有 `code`、一句用户文案、一个恢复动作（重试/返回/重装/查看诊断）。禁止静默失败或只写 console。
3. **分层隔离。** Host 不信任 Client 入参；Client 不信任 iframe 消息；游戏不信任 Runtime 之外的任何对象。校验发生在接收方，不依赖发送方“自觉”。
4. **不产生半写。** 存档、安装、更新必须先写临时文件再原子替换（见 8.6）；失败保留上一份可用数据。
5. **日志脱敏。** 任何日志、诊断、错误 `details` 不得含存档内容、prompt、消息正文、文件路径、Cookie、nonce 原值（见 8.12）。
6. **重试只用于幂等操作。** GET 与带 `operationId` 的 POST 可自动重试；安装/更新处于未知结果时只能查询状态，不得盲目重发。

#### 已核实的 DSH 契约基线（F-01～F-12）

以下是与本机 DSH Desktop **0.2.1-rc.2** 核对过的契约事实，第 8、9 章所有涉及 `ctx.*`、事件名、Slot、`connection.fetch` 的描述只能建立在此表或明确标注的随包源码证据上。表中"证据"指向本机参考实现/随包源码核对结果；标注"未验证"的项按 Spike 处理。

| 编号 | 事实 | 证据 |
|---|---|---|
| F-01 | 插件是普通 npm 包目录：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`；可选 `dsh.client = { platform: 'web', inject?, external?, immediately? }`；Client 产物为预构建的 `window.__ModuleLoader__.load({ id: '<包名>', factory(require) {...} })`；Host 半为 `export function apply(ctx, config)`，用到服务必须写入 `export const inject` | 本机参考插件 + DSH 包内 parser |
| F-02 | Host 半禁止 import `@deepseek-ai/*` 与第三方 npm 包（profile 路径包解析不到）；只用 `node:` 内置模块；所有注册放入 `ctx.effect(...)` 并返回清理 | 本机参考实现踩坑结论 |
| F-03 | Slot：`main` 为 keyed 且只渲染 active key，`conversation` 为保留 key，其它 key 不接收 Session 绑定；`sidebar.panellist` 用 `id` 寻址同名 `main` key；`conversation.header.leading` 为 single / root 且当前无占用、blank session 也渲染；`shell.overlay` 为 list / root、点击穿透、无主列几何 | DSH 随包源码 + 本机参考插件 |
| F-04 | `ctx.layout.selectPanel(panelId \| null)` 选择全局中央面板，不改变当前 Session；`null` 显示 Conversation；选择未注册 key 抛错；`usePanelInfo(info => info.activePanelId)` 是选中态来源 | DSH 随包源码 + inspection |
| F-05 | 切到其它 `main` key 时 Conversation 子树**卸载**；宿主保留当前 Session、输入草稿（localStorage）、语义阅读位置（同页面进程内）与 View 偏好；DOM 选区/焦点/IME 状态不保留。因此游戏页面状态必须放在组件外，返回游戏按"重新加载 + 读存档"设计 | 本机参考实现研究 + 随包源码 |
| F-06 | UI→Host 通道：Host `ctx.connection.fetch.register({ path, methods, requestBody, fetch })` + Client 同源相对 `fetch('api/...')`；`connection` 必须写入 `inject`；**第三方 bundle 不能新增 `ctx.remote` namespace**；路由只接受 `GET/HEAD/POST`，pathname 精确匹配、query 不参与 | 本机已验证参考实现 |
| F-07 | 持久化：Host 可使用插件自有文件（如 `$DSH_HOME/storages/<name>/`）；`ctx.storageDomain` 在 Host 服务目录存在，但第三方 `defineDomain` 用法未验证；禁止 append 新类型 Session Event | DSH Host 服务目录 + 本机参考实现 |
| F-08 | Agent 事件：等待 `turn/end`、`assistant/message`、`tool/result` 等持久事件，不轮询 `agent/status`；实时 token 从 `agent/assistant-stream` 读取；审批为 `approval/asked` / `approval/decided` 持久 Session 事件（决策面为 `ctx.approval`），提问 seam 为 `ctx.userQuestions`，Client 侧由 `ui-approval` / `ui-user-questions` 的 composer takeover 呈现 | 随包源码 + 本机验证 |
| F-09 | Client 约束：产物只能 `require` 静态模块表种子（`react` 最稳）；样式只用主题 token（`--dsw-alias-*` 等），明暗主题都要过；插件 UI 不使用 iframe——游戏 iframe 属于不可信内容边界，不在此约束内 | 官方插件技能 + 本机参考实现 |
| F-10 | 布局：宿主提供 `--dsh-frame-top-clearance`（macOS 48px）、`--dsh-frame-overlay-top`、`--dsh-frame-leading-clearance` 等变量；macOS 拖拽带用 `[data-window-drag]` / `[data-window-drag-recall]` | 随包 CSS + 本机参考实现 |
| F-11 | 安装：正式安装走 DSH Plugins 页 / `plugin_manager install_bundle`（Host 代码在进程内执行，需要 Full access 或审批）；开发态可在 profile 的 `cordis.patch.yml` insert 一行指向绝对路径；Client 改约 0.5s 热更新，Host 改需重启或停用/启用 | 本机已验证 |
| F-12 | 已跑通的挂载组合：`main` + `sidebar.panellist` + `conversation.header.leading`；等待入口 chip 放 `conversation.header.leading` 可行 | 本机参考实现（dsh-video / dsh-git-graph） |

### 8.2 Game Package 与 Manifest 规范

> **游戏是一个包，不是一个插件。** 安装过程只搬运、校验、落位一个静态文件，任何阶段都不执行第三方代码。

#### 8.2.1 单文件游戏包结构

V1 的 Game Package 是**一个自包含的单文件 HTML**（D-034），文件名规则为 `<id>-<version>.html`：

```text
block-drop-1.2.0.html            # UTF-8 无 BOM，≤20 MiB
└── <html>                       # 文件本身即游戏入口
    ├── <script type="application/json" id="dsh-game-manifest">…</script>   # 内嵌 manifest v1，恰好一处
    └── <style> / <script> / <img src="data:…"> 等内联资源（可选）
```

- **文件本身即入口**：manifest 中不再有 `entry` 字段；Host 安装后固定落位为 `packages/<id>/<version>/entry.html`（§8.6.2），通过 `/entry` 路由提供给 sandbox iframe。
- **manifest 内嵌**：以 `<script type="application/json" id="dsh-game-manifest">` 的形式写在 HTML 中，全文恰好一处，其文本内容（标签之间）≤64 KiB。
- **单文件自包含**：所有 JS、CSS、图片、字体、音频都以 inline 或 `data:` URL 内联；运行时不得请求任何外部子资源（详见 8.2.4）。
- **V1 没有 zip/归档/解压/文件列表/目录树**：包内不存在“其它文件”，多文件资源推迟到 V1.5 评估（S-04）。
- `icon` 使用 data URI；封面/截图不是包内容，只存在于 Registry 条目（§8.8.1）。

结构规则全部可机检，任一条违反即整包拒绝（错误码见 8.2.7）：

| 编号 | 规则 | 错误码 |
|---|---|---|
| PKG-R-01 | 必须是合法 HTML 文件：UTF-8 无 BOM、非空、可解析；文件大小 ≤20 MiB | `E_PKG_HTML_INVALID` / `E_PKG_TOO_LARGE` |
| PKG-R-02 | HTML 中必须存在且只存在一处 `<script type="application/json" id="dsh-game-manifest">…</script>` | `E_PKG_MANIFEST_MISSING` / `E_PKG_MANIFEST_DUPLICATE` |
| PKG-R-03 | manifest 文本 ≤64 KiB，JSON 可解析（无重复键） | `E_PKG_MANIFEST_TOO_LARGE` / `E_PKG_MANIFEST_JSON` |
| PKG-R-04 | manifest 通过 §8.2.3 字段校验（必填、类型、范围、枚举） | `E_PKG_FIELD_*` / `E_PKG_*` |
| PKG-R-05 | 通过 §8.2.4 自包含校验：无外部子资源、无网络调用、无 `<iframe>` | `E_PKG_ENTRY_NOT_SELF_CONTAINED` |
| PKG-R-06 | manifest 的 `id`/`version` 与 Registry 条目一致，且包文件名等于 `<id>-<version>.html` | `E_PKG_VERSION_INVALID` / `E_INSTALL_VERSION_MISMATCH` |
| PKG-R-07 | 出现已废弃字段（`author` 字符串、`category` 单数、`entry`、`cover`、`screenshots`）一律拒绝 | `E_PKG_LEGACY_FIELD` |

> 原归档模型下的 `E_PKG_STRUCTURE`、`E_PKG_PATH_UNSAFE`、`E_PKG_ENTRY_MISSING` 以及全部 `E_PKG_ZIP_*`/文件数/解压炸弹类错误码随 D-010/D-032 废止，V1 不再产生也不再分配（完整废弃清单见 §8.13.2）。

#### 8.2.2 体积与内容上限

V1 的包是单文件，上限只针对这一个文件和其中内嵌的 manifest：

| 限制项 | 阈值 | 理由 | 错误码 |
|---|---|---|---|
| 包文件大小 | ≤ 20 MiB（20,971,520 B） | 单文件包体积预算，控制下载与加载成本 | `E_PKG_TOO_LARGE` |
| manifest 文本 | ≤ 64 KiB | 元数据不是内容 | `E_PKG_MANIFEST_TOO_LARGE` |
| `icon` data URI 解码后 | ≤ 256 KiB | 详情页图标，避免拖慢首屏 | `E_PKG_ICON_TOO_LARGE` |

- 文件大小按**实际接收字节**计，不信任 `Content-Length`；下载/读取过程中边收边计数，越界立即中止并删除临时文件。
- 内联的图片、音频、字体、data URI 共同占用 20 MiB 预算，没有单独的“单文件资源”上限。
- 不再有解压后总量、文件数、单文件解压大小、路径长度、目录深度、单目录条目数、压缩比等限制——这些只属于 zip 模型，V1 不适用。

#### 8.2.3 内嵌 manifest 字段表

manifest 是唯一权威元数据，位于 HTML 的 `<script type="application/json" id="dsh-game-manifest">` 中。早期版本的 `author`（字符串）与 `category`（单数）已被废弃；`entry`、`cover`、`screenshots` 也不再是包字段。校验器按下表执行，历史字段报 `E_PKG_LEGACY_FIELD`（§8.2.7）。

| 字段 | 类型 | 必填 | 默认 | 约束与校验 |
|---|---|---|---|---|
| `manifestVersion` | integer | 是 | — | 必须为 `1`；其它整数 → `E_PKG_MANIFEST_VERSION`；非整数 → `E_PKG_FIELD_TYPE` |
| `id` | string | 是 | — | 3–48 字符，`^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$`，禁止连续 `--`（允许数字开头，如 `2048`）；不得为 §8.2.4 保留字；不得含 `.`；安装后不可变 |
| `name` | string | 是 | — | 1–64 个 Unicode 码点；去首尾空白后非空；禁止控制字符与换行 |
| `version` | string | 是 | — | `MAJOR.MINOR.PATCH[-prerelease]`；无前导 0；**不允许** build metadata（`+` 后内容） |
| `author` | object | 是 | — | `{ name, url? }`；`name` 1–64 字符；`url` 必须 `https://` 且 ≤ 300 字符 |
| `description` | string | 是 | — | 1–280 字符；纯文本（禁止 HTML 标签、禁止 Markdown 链接语法）；换行归一为单个空格 |
| `icon` | string | 否 | `null` | data URI（png/webp/jpeg）；解码后 ≤256 KiB，建议 256×256 方图；缺失时 Market 用首字母占位 |
| `categories` | string[] | 是 | — | 1–3 项，枚举 `arcade` `puzzle` `card` `idle` `action` `strategy` `trivia` `sandbox`；去重；未知值 → `E_PKG_CATEGORY_UNKNOWN` |
| `tags` | string[] | 否 | `[]` | ≤ 8 项，`^[a-z0-9][a-z0-9-]{0,23}$`；去重；用于本地搜索与筛选 |
| `capabilities` | string[] | 是 | `[]` | V1 仅允许 `storage`、`score`；去重；其它值见 §8.2.5 的两类错误码 |
| `sdkVersion` | string | 是 | — | semver range，形式受限（§8.11.2） |
| `runtimeVersion` | string | 是 | — | semver range，形式同上 |
| `preferredTheme` | string | 否 | `"system"` | `system` `light` `dark` `game-defined`（对齐 §6.17） |
| `viewport` | object | 否 | `{ "width": 960, "height": 540, "fit": "contain" }` | 推荐设计分辨率；`width`/`height` 为 1–3840 整数，`fit` 仅允许 `contain`。**V1.1 起 Runtime 全出血铺满，不再据此计算/letterbox 舞台尺寸**（见 9.6.1、开发者指南 §4.4） |
| `score` | object | 否 | `null` | `capabilities` 含 `score` 时**必填**，否则忽略 |
| `score.direction` | string | 否 | `"higher-better"` | `higher-better` `lower-better` |
| `score.min` | number | 是（`score` 在场） | — | 有限数；须满足 `min < max`；`max - min ≤ 1e9` |
| `score.max` | number | 是（`score` 在场） | — | 同上 |
| `score.integer` | boolean | 否 | `true` | `true` 时提交值必须是 `Number.isSafeInteger` |
| `save` | object | 否 | `{ "schemaVersion": 1 }` | `capabilities` 含 `storage` 时**必填** |
| `save.schemaVersion` | integer | 是（`save` 在场） | — | 1 – 2^31−1；只增不减；语义见 §8.11.6 |
| `permissions` | object | 否 | 省略 | **V1 只接受省略或 `{}`**；任何非空内容 → `E_PKG_PERMISSION_UNSUPPORTED`（字段为 V2 预留） |
| `homepage` | string | 否 | `null` | `https://`，≤ 300 字符 |
| `repository` | string | 否 | `null` | `https://`，≤ 300 字符；建议指向源码仓库 |
| `license` | string | 否 | `null` | SPDX 标识符，`^[A-Za-z0-9.+-]{1,64}$` |
| `i18n` | object | 否 | `null` | `{ default, locales }`；`default` 必须是 `locales` 的键；≤ 16 个 locale |
| `i18n.locales[tag].name` | string | 否 | — | 覆盖顶层 `name`；1–64 字符；`tag` 匹配 `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$` |
| `i18n.locales[tag].description` | string | 否 | — | 覆盖顶层 `description`；1–280 字符 |

未知字段策略（向前兼容的基础）：顶层未知字段记 `W_PKG_UNKNOWN_FIELD` 警告，不阻断安装；以 `x-` 开头的顶层字段静默忽略；`score`/`save`/`i18n` 对象内的未知键同样只警告。**但 `capabilities` 的未知值是错误**，因为它是权限声明。

**封面/截图不是 manifest 字段：** `cover` 与 `screenshots` 只存在于 Registry 条目（§8.8.1）。Host 在 Registry 刷新时把外链素材缓存到 `preview-cache/<id>/<version>/`，Market 通过同源 `/preview` 加载；本地/开发安装没有 Registry 条目时，详情页用 manifest 的 `icon` data URI 或首字母占位，不显示截图区。

#### 8.2.4 入口即文件本身、自包含校验

**没有独立的入口文件字段。** 包文件本身就是入口；Host 将其落位为 `packages/<id>/<version>/entry.html`，通过 `/entry` 路由返回一次 HTML 响应，游戏在 sandbox iframe 中运行（属性与 CSP 见 §8.4、8.10）。平台不解析、不注入、不重写游戏 HTML 的正文，只读取内嵌 manifest 做校验。

**`id`** 是数据目录的键（§8.6），因此比其它字段更严格：

- 允许多种写法：`snake`、`block-drop`、`2048`（**数字开头合法**）、`whale-idle`；禁止大写、下划线、连续 `--`、首尾 `-`。
- 保留字（不可使用）：`conversation`、`plugins`、`schedules`、`dsh-game-market`、`game-market`、`main`、`sidebar`、`api`、`static`、`dsh` → `E_PKG_ID_RESERVED`。
- 卸载后以相同 `id` 重装视为**同一款游戏**，继承 `saves/`、`scores/`、`sessions/`；这也是"卸载默认保留数据"的前提（§8.6.13）。
- `id` 一旦进入 Registry 即永久占用，不允许"转卖/转移"，避免存档被另一款游戏接管。

**`version`** 使用严格 semver 子集：`^` range 匹配同 MAJOR，`~` 匹配同 MINOR，比较遵循 semver 优先级（预发布版本低于同版本正式版）。同一 `id` 的正式版本必须严格递增；**安装新版本只允许 ≥ 已装版本**，降级只能走 §8.11.7 的回滚通道。

**自包含校验（静态检查，与运行时 CSP 双保险）。** 以下任一出现即拒绝，报 `E_PKG_ENTRY_NOT_SELF_CONTAINED`：

1. 外部子资源：`<script src>`、`<link rel="stylesheet" href>`、`<img src>`、`<audio>/<video>/<source src>`、`<object>/<embed data>` 等指向 `http(s):`、协议相对（`//`）、`file:` 或相对路径。
2. 样式外链：`@import`、外链字体（`@font-face` 的远程 `src`）。
3. 嵌入框架：`<iframe>`、`<frame>`、`<object>`、`<embed>`。
4. 网络调用：`fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`、`navigator.sendBeacon`。
5. 导航/弹窗：`window.open`、改写 `top.location` / `parent.location`（运行时 sandbox 也会阻断）。

只放行 `data:` URL 与内联内容。运行时再由 CSP（`default-src 'none'`、`connect-src 'none'`、`frame-src 'none'` 等，见 §8.10）二次阻断；静态检查用于更早、更明确的报错，两者缺一不可。

**运行时加载方式。** iframe 只加载 `/entry` 一次；游戏内联资源不产生子资源请求。`icon` 以 data URI 出现在 manifest 中，不由 `/entry` 之外的文件服务提供；包内不存在可供读取的图片路径。

#### 8.2.5 `capabilities` 允许枚举

V1 **只允许两个 capability**，其它一切声明都拒绝：

| capability | 授予的 SDK 面 | 数据落点 | 未声明时 |
|---|---|---|---|
| `storage` | `game.storage.save/load/clear` | `saves/<gameId>/` | SDK 调用返回 `E_CAPABILITY_DENIED`（SDK 侧错误码，见 §8.3），详情页不显示"可存档" |
| `score` | `game.score.submit/getBest` | `scores/<gameId>.json` | 同上，详情页不显示排行榜入口 |

**为什么 `session`/`lifecycle`/`agent` 不是 capability**：它们由 Runtime 无条件提供，不写用户数据、不授予额外权限，属于 D-011 列出的 ambient SDK 面。把它们做成 capability 会让"游戏能不能暂停"变成可拒绝项，产品上没有意义。

三类拒绝，文案与错误码必须区分：

| 情况 | 错误码 | 用户可见文案 |
|---|---|---|
| 不是已知 capability 名（如 `storag`） | `E_PKG_CAPABILITY_UNKNOWN` | 安装包声明了未知能力 `storag`，请更新游戏或联系作者 |
| 是已知但 V1 未开放（`network`、`workspace-context`、`clipboard`、`audio-capture`、`notifications`） | `E_PKG_CAPABILITY_UNSUPPORTED` | 该游戏需要 `network` 能力，当前版本不支持（见 D-014） |
| 重复声明 | `E_PKG_CAPABILITY_DUPLICATE` | 安装包声明重复，请作者重新打包 |

新增 capability 的规则：必须同时提升 `runtimeVersion` 的 MINOR、更新 §8.11 兼容矩阵、并在 §12 决策日志登记；不得在 patch 版本内静默增加。

#### 8.2.6 完整示例

（示例省略 HTML 外壳；实际以内嵌 `<script type="application/json" id="dsh-game-manifest">` 的形式写在单文件 HTML 中。）

```json
{
  "manifestVersion": 1,
  "id": "block-drop",
  "name": "Block Drop",
  "version": "1.2.0",
  "author": { "name": "Orange", "url": "https://github.com/orange" },
  "description": "把下落的方块叠成完整横行，适合几十秒到几分钟的等待。",
  "icon": "data:image/png;base64,iVBORw0KGgo…",
  "categories": ["puzzle", "arcade"],
  "tags": ["blocks", "keyboard", "short-run"],
  "capabilities": ["storage", "score"],
  "sdkVersion": "^1.0.0",
  "runtimeVersion": "^1.0.0",
  "preferredTheme": "game-defined",
  "viewport": { "width": 960, "height": 540, "fit": "contain" },
  "score": { "direction": "higher-better", "min": 0, "max": 999999, "integer": true },
  "save": { "schemaVersion": 2 },
  "homepage": "https://example.com/block-drop",
  "repository": "https://github.com/example/block-drop",
  "license": "MIT",
  "i18n": {
    "default": "zh",
    "locales": {
      "zh": { "name": "方块坠落", "description": "把下落的方块叠成完整横行。" },
      "en": { "name": "Block Drop", "description": "Stack falling blocks into full rows." }
    }
  }
}
```

#### 8.2.7 校验器 `dsh-game validate`

三个执行点共享同一套规则表，但**职责不同**：CLI 最全，Host 安装期只做安全必需项（不可信输入），Runtime 启动期只做一致性复核（防磁盘被改）。

| 检查阶段 | 检查项 | 错误码 | CLI | 安装 | 启动 |
|---|---|---|---|---|---|
| 文件 | 大小 ≤20 MiB；UTF-8 无 BOM、非空、HTML 可解析 | `E_PKG_TOO_LARGE` / `E_PKG_HTML_INVALID` | ✓ | ✓ | ✓ |
| Manifest | 内嵌 `<script id="dsh-game-manifest">` 存在且恰好一处 | `E_PKG_MANIFEST_MISSING` / `E_PKG_MANIFEST_DUPLICATE` | ✓ | ✓ | ✓ |
| Manifest | 文本 ≤64 KiB | `E_PKG_MANIFEST_TOO_LARGE` | ✓ | ✓ | ✓ |
| Manifest | JSON 可解析、无重复键 | `E_PKG_MANIFEST_JSON` | ✓ | ✓ | ✓ |
| Manifest | `manifestVersion = 1` | `E_PKG_MANIFEST_VERSION` | ✓ | ✓ | ✓ |
| Manifest | 必填字段、类型、长度、枚举 | `E_PKG_FIELD_MISSING` / `E_PKG_FIELD_TYPE` / `E_PKG_FIELD_RANGE` | ✓ | ✓ | ✓ |
| Manifest | `id` 语法与保留字 | `E_PKG_ID_INVALID` / `E_PKG_ID_RESERVED` | ✓ | ✓ | ✓ |
| Manifest | `version` 语法；与 Registry 声明及包文件名一致 | `E_PKG_VERSION_INVALID` / `E_INSTALL_VERSION_MISMATCH` | ✓ | ✓ | — |
| Manifest | `capabilities` 枚举与重复 | `E_PKG_CAPABILITY_*` | ✓ | ✓ | ✓ |
| Manifest | `score` 范围合法、`save.schemaVersion` 合法 | `E_PKG_SCORE_RANGE` / `E_PKG_SAVE_SCHEMA` | ✓ | ✓ | ✓ |
| Manifest | `icon` data URI 类型与解码后大小 | `E_PKG_ICON_FORMAT` / `E_PKG_ICON_TOO_LARGE` | ✓ | ✓ | — |
| 自包含 | 无外部子资源、无网络调用、无 `<iframe>`（§8.2.4） | `E_PKG_ENTRY_NOT_SELF_CONTAINED` | ✓ | ✓ | ✓ |
| 兼容 | `sdkVersion`/`runtimeVersion` 的范围语法（§8.11.2） | `E_PKG_RANGE_SYNTAX` | ✓ | ✓ | ✓ |
| 兼容 | `sdkVersion`/`runtimeVersion` 满足当前 Runtime | `E_COMPAT_SDK` / `E_COMPAT_RUNTIME` | ✓ | ✓ | ✓ |
| 一致性 | 运行前重新读取 `packages/<id>/<version>/entry.html` 的内嵌 manifest，`id`/`version` 与安装记录一致 | `E_INSTALL_CORRUPT` | — | — | ✓ |
| 兼容 | 旧字段（`author` 字符串、`category`、`entry`、`cover`、`screenshots`） | `E_PKG_LEGACY_FIELD` | ✓ | ✓ | ✓ |

> **错误码约定：** 本节与 §8.7.9 中的 `E_*` 是内部常量名；对外（HTTP API、Bridge、用户提示、日志的 `code` 字段）统一使用 `GM-*` 码，完整映射见 §8.13。`E_*` 只允许出现在代码常量与诊断日志的来源字段中。

错误码总表（用户文案与可修复性同样是要验收的内容）：

| 错误码 | 含义 | 用户可见文案（zh） | 作者可修复 |
|---|---|---|---|
| `E_PKG_HTML_INVALID` | 不是合法 UTF-8 HTML（空文件/非 UTF-8/含 BOM/无法解析） | 安装包不是有效的 HTML 文件 | 是 |
| `E_PKG_TOO_LARGE` | 单文件超过 20 MiB | 安装包超过 20 MiB 上限 | 是 |
| `E_PKG_MANIFEST_MISSING` | 未找到内嵌 manifest | 安装包缺少游戏清单 | 是 |
| `E_PKG_MANIFEST_DUPLICATE` | 内嵌 manifest 多于一处 | 安装包包含多份游戏清单 | 是 |
| `E_PKG_MANIFEST_TOO_LARGE` | manifest 文本超过 64 KiB | 游戏清单体积过大 | 是 |
| `E_PKG_MANIFEST_JSON` | JSON 语法错误或重复键 | 游戏清单格式错误 | 是 |
| `E_PKG_MANIFEST_VERSION` | manifestVersion ≠ 1 | 游戏清单版本不受支持 | 是 |
| `E_PKG_FIELD_MISSING` / `E_PKG_FIELD_TYPE` / `E_PKG_FIELD_RANGE` | 字段缺失/类型错/越界 | 游戏清单字段 `{field}` 不合法 | 是 |
| `E_PKG_ID_INVALID` / `E_PKG_ID_RESERVED` | id 语法错 / 保留字 | 游戏 id 不合法或与系统保留名冲突 | 是 |
| `E_PKG_CATEGORY_UNKNOWN` | `categories` 含未知枚举 | 游戏分类不在允许列表内 | 是 |
| `E_PKG_VERSION_INVALID` | 版本号非 semver 子集 | 版本号格式不正确 | 是 |
| `E_PKG_CAPABILITY_UNKNOWN` / `_UNSUPPORTED` / `_DUPLICATE` | 能力声明问题 | 见 §8.2.5 文案 | 是 |
| `E_PKG_SCORE_RANGE` / `E_PKG_SAVE_SCHEMA` | 分数范围或存档版本非法 | 计分/存档配置不合法 | 是 |
| `E_PKG_ICON_FORMAT` / `E_PKG_ICON_TOO_LARGE` | icon data URI 格式或大小非法 | 游戏图标不可用 | 是 |
| `E_PKG_ENTRY_NOT_SELF_CONTAINED` | 引用外部子资源或网络调用 | 游戏入口必须是自包含单文件，请使用官方模板重新打包 | 是 |
| `E_PKG_PERMISSION_UNSUPPORTED` | 声明了非空 permissions | 该游戏请求了当前版本不支持的能力 | 是（V1 不支持） |
| `E_PKG_LEGACY_FIELD` | 使用了已废弃字段 | 请使用 `author` 对象与 `categories` 数组，并移除 `entry`/`cover`/`screenshots` | 是 |
| `E_COMPAT_SDK` / `E_COMPAT_RUNTIME` | 版本范围不满足 | 该游戏需要更新的 Game Market | 否（用户侧） |
| `E_PKG_RANGE_SYNTAX` | 版本范围使用了不允许的形式 | 版本范围写法不受支持（仅支持 ^ ~ 精确或上下界） | 是 |

> **已废弃的 `E_*`（V1 不再产生、不再分配）：** `E_PKG_ZIP_*`（含 `E_PKG_ZIP_UNSUPPORTED`、`E_PKG_ZIP_BOMB`）、`E_PKG_ENTRY_UNSUPPORTED`、`E_PKG_JUNK_ENTRY`、`E_PKG_TOO_MANY_FILES`、`E_PKG_FILE_TOO_LARGE`、`E_PKG_DIR_TOO_WIDE`、`E_PKG_PATH_TOO_LONG`、`E_PKG_PATH_TOO_DEEP`、`E_PKG_ASSET_MISSING`、`E_PKG_ASSET_ANIMATED`。原归档模型下的 `E_PKG_STRUCTURE` / `E_PKG_PATH_UNSAFE` / `E_PKG_ENTRY_MISSING` 也一并退出，其语义由 `E_PKG_HTML_INVALID` / `E_PKG_MANIFEST_MISSING` / `E_PKG_MANIFEST_DUPLICATE` / `E_PKG_ENTRY_NOT_SELF_CONTAINED` 承接。这些常量只允许出现在历史代码与迁移说明中。

输出契约：按上表阶段顺序输出；同阶段内按检查项在该表中的顺序；最多 50 条，超出置 `truncated: true`；`--json` 输出 `{ ok, errors[], warnings[], truncated }`，每项含 `code`/`path`/`message`/`hint`。**同一输入重复执行必须输出逐字节一致**（耗时字段仅在 `--verbose` 出现）。

#### 8.2.8 CLI：build / validate / pack / publish

| 命令 | 输入 | 输出 | 退出码 | 联网 |
|---|---|---|---|---|
| `dsh-game build` | 模板工程目录（含 manifest 源与 `src/`） | `dist/index.html`（单文件自包含，内嵌 manifest v1；JS/CSS/图片/字体内联；无 sourcemap） | 0 / 1 / 3 | 否 |
| `dsh-game validate <path>` | 单文件 `.html`（或模板工程目录，先 build 再校验） | stdout 报告；`--json` 机器可读 | 0 / 1 / 2 | 否 |
| `dsh-game pack` | 已构建的 `dist/index.html` | `dist/<id>-<version>.html` + `dist/<id>-<version>.html.sha256` | 0 / 1 / 3 | 否 |
| `dsh-game publish` | `dist/<id>-<version>.html` + `.sha256` | `registry/games.json` 条目（`package` 字段）+ 上传清单 + 人工审核 checklist | 0 / 1 / 2 | 否（V1） |

退出码语义固定：`0` 成功；`1` 校验或兼容性失败（作者可修复）；`2` 用法/配置错误；`3` 内部错误（IO 或未预期异常）；`4` 网络或 Registry 错误（V1 只有 Host 安装流程使用，CLI 不使用）。

**确定性打包**是硬要求，否则 Registry 的 `sha256` 无法复现：同一构建输入连续构建两次，产出的 HTML 必须**逐字节一致**——内联资源按固定顺序拼接，不写时间戳、机器路径、随机 id；manifest 序列化稳定（键序固定、无多余空白）。验收方法：同一目录连续 `build`/`pack` 两次，`sha256` 必须相同。

`sha256` 附属文件内容为 `shasum -a 256` 兼容格式：

```text
3f9c…（64 位小写 hex）  block-drop-1.2.0.html
```

**单文件内联是 V1 硬要求：** `build` 必须把 manifest、SDK、JS、CSS、图片、字体合并进一个 HTML；`pack` 前由 validate 复查内嵌 manifest 唯一性与自包含（§8.2.7）。

V1 的 `publish` **不调用任何服务端 API**：它产出可直接粘进 `registry/games.json` 的条目、`.html` 上传目标路径提示（建议 GitHub Releases）、以及一份人工审核 checklist。真正的上架仍是 PR（§8.8）。

#### 8.2.9 模板必须预置的内容

两个模板共用同一份契约，区别只在渲染方式：

| 模板 | 文件 | 说明 |
|---|---|---|
| Vanilla / Canvas | `manifest.json`、`index.html`、`src/main.js`、`src/render.js`、`src/storage.js`、`src/i18n.js`、`scripts/dev.mjs`、`README.md` | 无框架、无构建依赖；`<canvas>` + DPR 缩放 |
| React | `manifest.json`、`index.html`、`vite.config.ts`、`src/App.tsx`、`src/game/loop.ts`、`src/game/storage.ts`、`src/sdk.ts`、`README.md` | Vite + React；游戏状态放 `useRef` 而不是 React state，避免每帧重渲染 |

模板的 `manifest.json` 是**构建期源文件**：`build` 把它序列化后以内嵌 `<script type="application/json" id="dsh-game-manifest">` 的形式写入 `dist/index.html`，不产出独立的 manifest 文件。两个模板的 `build` 脚本都必须产出**单文件自包含**的 `dist/index.html`：Vanilla 用 esbuild 把 JS/CSS/资源内联；React 用 Vite + `vite-plugin-singlefile`。模板的 `pack` 前置 validate 会拒绝外部子资源、缺失/重复 manifest。

两个模板都必须预置的行为（缺一项即模板不合格）：

1. 启动时 `await game.ready()` 之后才进入主循环；`ready` 失败要有可见错误态，不能白屏。
2. 提供**纯同步、幂等**的 `serialize(): SaveData` 与 `deserialize(data)`；Runtime 可能在任意时刻请求序列化（§8.4 协议），模板不得依赖"只在结束时可保存"。
3. `lifecycle.on("pause")` → 停 `requestAnimationFrame`、停所有计时器、立即 `save`；`resume` → 按真实经过时间重算 `dt`，**不得把暂停时长计入游戏时间**。
4. `document.visibilitychange` 与 `blur` 时按 pause 处理（D-005 关键节点）。
5. 键盘：canvas 自动获得焦点；不拦截 `Escape`（Runtime 用它返回）；可用 Tab 离开画布。
6. 尺寸：监听 `resize`，按 canvas 实际 CSS 尺寸绘制（不强制放大最小逻辑尺寸），DPR 上限 2；HUD 遵守 §9.6.1 安全区。
7. 无网络、无外部资源：模板不得包含 `fetch`/CDN 引用/远程字体；图片、字体、音频一律内联或 `data:` URL。
8. 分数：结束调用 `game.score.submit(score)`，并对 `GM-4006`（分数超出 Manifest 声明范围，见 §8.13）做可见处理（不静默吞掉）。
9. 文案集中在 `src/i18n.js`，提供 `zh`/`en` 两套。
10. `scripts/dev.mjs` 启动 Runtime Simulator（§4.5）；`npm run validate` 可在 CI 中执行。
11. README 中包含：如何改包名、如何加能力、如何本地预览、如何打包上架。

#### 8.2.10 Game Package 与 DSH Plugin 的本质区别

| 维度 | Game Package（单文件 HTML） | DSH Plugin（Bundle） |
|---|---|---|
| 载体 | 单文件自包含 HTML（内嵌 manifest v1） | npm 包目录 + `cordis.patch.yml` |
| 安装者 | Game Market Host 自有安装器 | DSH `plugin_manager` / Plugins 页 |
| 安装期执行代码 | **绝不**（无 `prepare`/`postinstall`/任意脚本） | 是，Host 半 `apply` 在进程内执行 |
| 执行位置 | 浏览器 sandbox iframe（不可信） | Host Node 进程内 + Client 模块（可信） |
| 进入 Cordis Tree | **否** | 是 |
| 权限面 | 仅 SDK + `capabilities` | 全部注入的 DSH Service、文件、网络 |
| 版本约束 | `runtimeVersion` / `sdkVersion` | `engines.dsh` |
| 数据 | `saves/` `scores/`（平台定义外壳） | `ctx.storageDomain` 或自有目录 |
| 卸载 | 删静态文件，可选留存档 | 从 profile 移除插件行 |
| 更新 | 重新加载 iframe | client 热替换；host 需重启 |
| 失败影响 | 单款游戏不可用 | 可能导致 DSH 启动异常 |

> 这条边界是整个产品的前提：**`dsh plugin add` 的权力太大，不能给任意小游戏。**

### 8.3 Game SDK 规范

**定位。** SDK 是 `@dsh-game/sdk` 的浏览器侧薄层：把 `game.*` 调用编码为 postMessage，把 Runtime 的结果还原为 Promise。它不依赖 DSH、Cordis、React 或任何构建工具，可以被内联进单个 HTML。SDK 的边界由 D-011 锁定：V1 只有 `ready`、`storage`、`session`、`score`、`lifecycle`、`agent`、`runtime` 七组能力。

#### 公开 TypeScript 声明

以下声明即 `@dsh-game/sdk@1.x` 的公开面，可直接落为 `sdk/src/index.d.ts`；内部消息类型不导出。

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type GameErrorCode =
  | 'GM-4002' | 'GM-4004' | 'GM-4006'
  | 'GM-4031' | 'GM-4032' | 'GM-4033'
  | 'GM-4092' | 'GM-4093' | 'GM-4098' | 'GM-4099'
  | 'GM-4131' | 'GM-4132' | 'GM-4133' | 'GM-4134'
  | 'GM-4260' | 'GM-4261' | 'GM-4290' | 'GM-4291'
  | 'GM-5001' | 'GM-5002' | 'GM-5003' | 'GM-5004' | 'GM-5005'
  | 'GM-5011' | 'GM-5012' | 'GM-5021' | 'GM-5022' | 'GM-5031';

export interface GameError extends Error {
  readonly code: GameErrorCode;
  readonly retryable: boolean;
  readonly details?: JsonObject;
}
export declare function isGameError(error: unknown): error is GameError;

export type GameLifecycleEvent = 'pause' | 'resume' | 'hidden' | 'visible' | 'before-save';
export type PauseReason = 'user' | 'hidden' | 'leave' | 'waiting-user';
export type SaveReason = 'interval' | 'pause' | 'hidden' | 'leave' | 'agent-complete';

export type LifecyclePayload =
  | { event: 'pause'; reason: PauseReason; at: number }
  | { event: 'resume'; reason: 'user' | 'visible'; at: number }
  | { event: 'hidden'; at: number }
  | { event: 'visible'; at: number }
  | { event: 'before-save'; reason: SaveReason; deadlineMs: number };

export interface StorageSaveResult { key: string; bytes: number; revision: number; updatedAt: string }
export interface StorageLoadResult<T extends JsonValue = JsonValue> {
  key: string; data: T; revision: number; updatedAt: string;
}
export interface StorageRemoveResult { key: string; removed: boolean; revision: number }

export interface SessionStartResult { playSessionId: string; startedAt: string; adopted: boolean }
export type SessionOutcome = 'completed' | 'lost' | 'abandoned' | 'quit';
export interface SessionEndResult {
  playSessionId: string; startedAt: string; endedAt: string;
  outcome: SessionOutcome; score: number | null; ignored: boolean;
}

export interface ScoreSubmitResult { best: number; isBest: boolean; submittedAt: string }
export interface BestScore { score: number; achievedAt: string; meta: JsonObject | null }

export type GameAgentPhase = 'idle' | 'running' | 'waiting-user' | 'completed' | 'error';
export type GameAgentSource = 'turn' | 'tool' | 'approval' | 'question' | 'lifecycle' | 'restore';
export interface GameAgentState {
  state: GameAgentPhase;
  label: string;
  sessionId: string | null;
  updatedAt: string;
  source: GameAgentSource;
  seq: number;
  since: string;
}

export interface GameRuntimeInfo {
  sdkVersion: string;
  protocolVersion: 1;
  runtimeVersion: string | null;
  gameId: string;
  gameVersion: string;
  /** 平台启动模式；resume-paused 表示平台弹窗是唯一确认，游戏不得再弹自己的继续/开始界面。 */
  launchMode: 'start' | 'resume-paused';
  locale: string;
  theme: 'light' | 'dark';
  reducedMotion: boolean;
  capabilities: readonly string[];
  viewport: { width: number; height: number; dpr: number };
  ready: boolean;
}

export interface Game {
  readonly runtime: GameRuntimeInfo;
  ready(timeoutMs?: number): Promise<GameRuntimeInfo>;
  storage: {
    save<T extends JsonValue>(key: string, data: T): Promise<StorageSaveResult>;
    load<T extends JsonValue = JsonValue>(key: string): Promise<StorageLoadResult<T> | null>;
    remove(key: string): Promise<StorageRemoveResult>;
  };
  session: {
    start(): Promise<SessionStartResult>;
    end(options?: { outcome?: SessionOutcome; score?: number }): Promise<SessionEndResult | null>;
  };
  score: {
    submit(score: number, meta?: JsonObject): Promise<ScoreSubmitResult>;
    getBest(): Promise<BestScore | null>;
  };
  lifecycle: {
    on(event: GameLifecycleEvent, handler: (payload: LifecyclePayload) => void | Promise<void>): () => void;
  };
  agent: {
    getStatus(): Promise<GameAgentState>;
    on(event: 'status', handler: (state: GameAgentState) => void): () => void;
  };
}

export declare const game: Game;
```

`game.runtime` 是**只读活视图**：对象引用稳定，`theme`、`reducedMotion`、`viewport` 属性由 SDK 在收到 Runtime 更新时改写内部值，游戏每次读取都拿到当前值。`ready` 之前 `runtimeVersion` 为 `null`、`capabilities` 为空数组、`ready` 为 `false`，读取不抛错。

#### 方法与语义

| 方法 | 语义 | 前置 | 超时 | 主要错误 |
|---|---|---|---|---|
| `ready(timeoutMs?)` | 完成握手并发送 `ready`；返回 Runtime 信息。重复调用返回同一个 Promise | 无 | 默认 10000 | `GM-5001`、`GM-5002`、`GM-5003` |
| `storage.save(key, data)` | 原子写入一个 key；返回实际字节数与新 `revision` | `ready` | 6000 | `GM-4031/4032/4131/4132/4133/4134/4092/5021` |
| `storage.load(key)` | 读取一个 key；不存在返回 `null`（不抛错） | `ready` | 3000 | `GM-4031/4032/5022` |
| `storage.remove(key)` | 真实删除一个 key（Host `POST /save-remove`）；不存在视为成功（`removed:false`）；删除释放 key/字节配额；删空后视为无存档 | `ready` | 3000 | `GM-4031/4032/4133` |
| `session.start()` | 开始或接管当前 Play Session | `ready` | 4000 | `GM-4031/4033/4093` |
| `session.end(opts?)` | 先尝试最终保存，再结束当前 Play Session | `ready` | 6000 | `GM-4031/4093` |
| `score.submit(score, meta?)` | 提交本局分数；Host 更新最佳分与历史 | `ready` | 4000 | `GM-4002/4031/4290` |
| `score.getBest()` | 返回最佳分；无记录返回 `null` | `ready` | 3000 | `GM-4031` |
| `agent.getStatus()` | 返回绑定的 DSH Session 的 Agent 快照 | `ready` | 2000 | `GM-4031/4033` |
| `agent.on('status', fn)` | 订阅状态变化；订阅后异步补发一次当前快照；返回取消函数 | 无（可早于 `ready`） | — | — |
| `lifecycle.on(event, fn)` | 订阅生命周期；不重放历史；返回取消函数；回调异常被隔离 | 无 | — | — |

**Promise 与顺序。** 每次调用生成唯一 `id`，Runtime 按 `id` 回包；同一游戏的所有**写操作**（`storage.save/remove`、`session.*`、`score.submit`）由 Runtime 串行执行，读操作可并发但只看到已提交结果。SDK 允许最多 32 个在途请求，超出立即以 `GM-4291` 拒绝。`ready` 之前除 `ready`、`lifecycle.on`、`agent.on`、`runtime` 外的调用一律以 `GM-4031` 拒绝，不排队。

**未就绪与不可用。** 若页面不在 iframe 中（`window.parent === window`），`ready()` 立即以 `GM-5003` 拒绝；若在 iframe 内但 Runtime 未响应，超时后以 `GM-5001` 拒绝。两种情况下之后所有方法都以同一错误拒绝。若握手中 Runtime 报告的 `protocolVersion` 主版本不受支持，`ready()` 以 `GM-5002` 拒绝，Runtime 进入 `error` 状态并显示“游戏与当前版本不兼容”。

#### 存储语义

- **命名空间。** `key` 规则 `^[a-z0-9][a-z0-9._-]{0,63}$`（1–64 字符，禁止 `__proto__`、`constructor`、`prototype`；8.2 表中的 `clear` 即本节的 `remove`）。每个游戏最多 **32 个 key**，每个值 ≤ **256KB**，单游戏合计 ≤ **1MB**（D-005）；按 UTF-8 字节计。
- **序列化限制。** 只接受 `JsonValue`：拒绝 `undefined`、函数、Symbol、BigInt、`NaN`、`Infinity`、循环引用、`Date`/`Map`/`Set`/TypedArray/Blob 等非纯对象；嵌套深度 ≤32；对象 key 长度 ≤128、单对象 key 数 ≤1000。SDK 在 `postMessage` 前做一次预检，Host 再做一次权威校验；两次任一失败都返回 `GM-4134`。
- **超限错误。** 单值超限 `GM-4131`；游戏总量超限 `GM-4132`；key 非法 `GM-4133`；不可序列化 `GM-4134`。失败不产生部分写入，旧值保持不变。
- **并发。** 同一 key 的写入按调用顺序串行；未提供 CAS 的 `save` 是 last-write-wins。需要检测冲突的调用方使用 HTTP `POST save` 的 `expectedRevision`（8.5），SDK 不暴露该参数。
- **原子性。** Host 先写 `*.tmp` 并 `fsync`，再 `rename` 覆盖；读取只读已提交文件。损坏文件视为 `GM-5022`，由 Host 隔离并回退到上一份备份。

#### Session 语义（对齐 D-004）

- **自动开始。** Runtime 在 iframe 首次进入 `playing` 时，若该游戏无进行中的 Play Session，自动创建一个（`startedBy: 'runtime'`）。因此**所有游戏**都能获得 Continue 的基础能力，不依赖开发者记得调用 `start()`。
- **显式声明。** 游戏调用 `session.start()` 时：已有进行中 Session 则返回同一个 `playSessionId`，`adopted: true`，不改 `startedAt`；没有则创建，`adopted: false`。重复 `start()` 幂等。
- **结束。** 只有游戏调用 `session.end()`、卸载游戏、或 Host 检测到包被更新替换时才结束。**暂停、切后台、离开游戏都不结束 Session**，否则 Continue 永远不成立（D-004）。`end()` 先发起一次最终保存（≤2s），再写 `endedAt` 与 `outcome`；默认 `outcome: 'completed'`，可传 `'lost' | 'abandoned' | 'quit'`。
- **幂等。** 已结束后再次 `end()` 返回同一条记录，`ignored: true`，不修改 `endedAt/outcome`；不同 `outcome` 的第二次调用被忽略。
- **Continue 判定。** Host 同时满足以下三条才在 Market/My Games 暴露 `canContinue: true`：存在该游戏的进行中 Session；存在该游戏的 Game Save；Save 的 `revision > 0`。`GET installed`/`GET game` 返回该字段，判定逻辑只在 Host 实现一次。
- **Session 与存档分离。** 结束 Session 不删除 Game Save；删除/覆盖 Save 不自动结束 Session。卸载时两者都按 8.5 的策略处理。

#### 分数语义

- `score` 必须是有限数，绝对值 ≤1e12；非整数允许，但 Host 按原值存储、只用于比较。`meta` 为 `JsonObject`，序列化后 ≤2KB，只允许标量或浅层对象；Host 不解释其内容。
- 最佳分取最大值；同分保留**更早**达成的一条。历史保留最近 20 条（含 `score`、`achievedAt`、`playSessionId`、`meta`）。
- 频率限制：同一游戏 1 次/200ms、20 次/分钟、单 Play Session 50 次；超限 `GM-4290`，`retryable: true`。
- `submit` 不要求先 `session.start`；若没有进行中 Session，Host 自动补一个（与 Runtime 自动开始同规则），避免分数无归属。

#### 生命周期语义

| 事件 | 触发 | SDK 约定 |
|---|---|---|
| `pause` | 用户点暂停、窗口隐藏、离开游戏、waiting-user 切回 | 游戏必须停止渲染循环与音频；不要求返回值 |
| `resume` | 轻暂停结束、窗口可见 | 只在 iframe **未被销毁**时发送；游戏恢复循环 |
| `hidden` / `visible` | iframe 文档或 DSH 窗口可见性变化 | 信息性事件；不作为暂停依据，避免与 `pause` 双触发 |
| `before-save` | 30s 定时、暂停、隐藏、离开、Agent 完成 | 游戏应在此调用 `storage.save`；Runtime 最多等 `deadlineMs`（默认 800） |

`before-save` 是**平台唯一能触发保存的机制**：Runtime 读不到游戏内部状态，也不会替游戏序列化。游戏必须在处理器内调用 `storage.save`；否则该次自动保存记为 `autoSaveSkipped`，只写诊断，不弹错误。模板必须预置这段代码。

`lifecycle.on` 的回调按注册顺序同步调用；返回 Promise 的处理器只在 `before-save` 被等待，其余不等待。回调抛错被捕获并写入游戏自己的 console，不打断 Bridge。

#### Agent 与 Runtime 信息

- `agent.getStatus()` 返回 8.9 定义的 `GameAgentState`。未绑定 DSH Session 时返回 `{ state: 'idle', sessionId: null, ... }`，**不抛错**；游戏不能据此判断“没有 Agent”。
- `agent.on('status')` 只推送顶层状态或 `label` 真正变化的快照；`seq` 单调递增，可用于去重。多个订阅者互不影响。
- `label` 已由 Host 按当前 locale 生成，游戏**禁止**解析或拼接 `label`；需要本地化判断时只用 `state`。
- `game.runtime` 提供 `sdkVersion/runtimeVersion/protocolVersion/gameId/gameVersion/locale/theme/reducedMotion/capabilities/viewport`。`theme` 与 `reducedMotion` 以 DSH 当前设置为准（不是 OS 媒体查询），在 DSH 手动切换主题时实时更新。

#### 版本协商

握手时 SDK 上报 `sdkVersion` 与 `protocolVersion: 1`；Runtime 在 `init` 中回报 `runtimeVersion`、`protocolVersion`、`supportedSdkRange`。规则：

1. `protocolVersion` 主版本必须为 `1`；否则 Runtime 回 `GM-5002`，SDK 进入不可用态，Runtime 显示错误页。
2. SDK 版本必须落在 `supportedSdkRange`（V1 为 `>=1.0.0 <2.0.0`）；低于下限回 `GM-5002`，高于上限按“未知字段忽略、未知方法拒绝”的向前兼容策略继续，但诊断中标记 `sdkAhead: true`。
3. Manifest 的 `runtimeVersion`/`sdkVersion` 范围由 Host 在 launch 前校验（见 8.11）；不满足直接 `GM-4260`，不创建 iframe。
4. 未知 `init` 字段、未知事件名一律忽略；未知方法返回 `GM-4004`。任何一方不得因未知字段崩溃。

#### SDK 明确不暴露的能力

网络（fetch/XHR/WebSocket/EventSource/sendBeacon）、文件系统、Shell/子进程、Credential/环境变量、Cordis Context、DSH Service、Tool 调用、其它游戏的存档或分数、Agent 的 prompt/消息/工具参数/文件路径、宿主路径、窗口控制、剪贴板、通知、下载、打开外链。游戏 iframe 内即使直接写 `fetch` 也会被 CSP `connect-src 'none'` 阻断；SDK 不提供绕过封装。

#### 实现约束（iframe 内的 bridge client）

1. 单文件、零依赖；ESM 与 IIFE 两种产物；min+gzip ≤12KB；禁止 `eval`/`new Function`；不使用 `document.write`。
2. 模块求值时只做特性检测，不启动握手；首次调用 `ready()`、`agent.on`、`lifecycle.on` 或读取 `runtime` 时惰性启动。若 `window.parent === window`，立即进入 `NO_RUNTIME` 态。
3. 只注册一个 `message` 监听器；只接受 `event.source === window.parent` 的消息；从不使用 `event.origin` 做认证（sandbox 下为 `"null"`）。
4. 从 `location.search` 读取 `instance` 与 `nonce`；`hello` 消息回显二者；`init` 的 nonce 不匹配则丢弃并计数。
5. 发送一律 `window.parent.postMessage(msg, '*')`。原因：sandbox 文档的源是 opaque，父页面无法用具体 origin 匹配；安全性由接收方的 `event.source` + nonce + 结构校验保证，不靠 `targetOrigin`。**禁止**通过消息传递任何密钥、Cookie 或宿主路径。
6. 请求 ID 用 `crypto.randomUUID()`，不可用时用 `m-<counter>-<random>`；响应按 `id` 关联；超时后从 pending 表删除并 reject。
7. 消息体上限：请求 ≤1.2MB（存档 1MB + 信封），事件 ≤64KB；超限本地拒绝，不发送。
8. 不修改 `window.parent`、不访问 `parent.document`、不尝试移除 sandbox、不打开新窗口。

#### 最小示例

```ts
import { game, isGameError } from '@dsh-game/sdk';

const info = await game.ready();            // 10s 超时
document.documentElement.dataset.theme = info.theme;

const saved = await game.storage.load<{ board: number[][] }>('current');
let board = saved?.data.board ?? newBoard();

game.lifecycle.on('before-save', async () => {
  await game.storage.save('current', { board, score });
});
game.lifecycle.on('pause', () => stopLoop());
game.lifecycle.on('resume', () => startLoop());

await game.session.start();                  // 幂等；Runtime 已自动开始时 adopted=true
game.agent.on('status', (s) => {
  if (s.state === 'waiting-user') showHint(s.label);
});
```

#### 错误处理示例

```ts
try {
  await game.storage.save('current', { board, score });
} catch (error) {
  if (!isGameError(error)) throw error;
  if (error.code === 'GM-4131' || error.code === 'GM-4132') {
    await game.storage.remove('replay');     // 主动腾空间
    await game.storage.save('current', { board, score });
  } else if (error.code === 'GM-5021') {
    showToast('存档失败，请检查磁盘空间');     // retryable=true，可重试一次
  } else {
    showFatal(error.code);
  }
}
```

### 8.4 Game Runtime 状态机与 Bridge 协议

Runtime 是 Client 内的可信组件，负责加载 iframe、驱动状态机、执行保存调度、维护 Agent Presence。它不把任何 DSH 对象传进 iframe，也不读取 iframe 的 DOM。

#### 页面状态机

| 状态 | 进入条件 | 允许转移 | UI 行为 |
|---|---|---|---|
| `idle` | 未选择游戏；面板显示 Market/My Games | `loading` | 正常 Market 导航；无 iframe、无计时器 |
| `loading` | 已调用 `launch`，iframe 已创建 | `ready`、`error` | 游戏容器显示骨架屏；返回按钮可用；10s 超时 |
| `ready` | 收到 `init` 且 `ready` 请求 ACK | `playing`、`error`、`exited` | 最多显示 1 帧“即将开始”；平台控件淡入 |
| `playing` | `ready` 后下一个 `requestAnimationFrame`（≤100ms） | `paused`、`saving`、`error`、`exited` | 游戏占满主区；小鲸鱼常驻；无其它平台 UI |
| `paused` | 用户暂停、窗口隐藏、waiting-user、离开前置 | `playing`、`saving`、`exited`、`error` | 半透明遮罩 + “继续 / 返回市场 / 回到工作”；游戏画面冻结 |
| `saving` | 强制保存（暂停/离开/切后台） | `paused`、`playing`、`error`、`exited` | 轻量“保存中…”指示；禁用离开按钮；≤2s |
| `error` | 加载超时、握手失败、iframe 无响应、保存失败且不可恢复 | `loading`（重试）、`exited` | 错误卡片：原因、`code`、重试/返回/诊断 |
| `exited` | iframe 已销毁 | `loading`（重新进入） | 回到 Market 或 Conversation；保留 Continue 判定 |

除此之外的转移一律非法：Runtime 记录 `invalid-transition` 诊断并保持原状态，不执行副作用。`ready` 与 `saving` 都是短暂态，超过 2s 未离开即按超时处理。

**UI 归属。** 行为在本节定义，视觉/文案见 9.6/9.7，Presence 动效见 9.7；Runtime 不直接写样式。

#### 自动保存（D-005）

| 触发 | 时机 | 是否阻塞 | 说明 |
|---|---|---|---|
| 定时 | `playing` 期间每 30s | 否 | 成功后重置计时；`paused`/`error` 期间暂停计时 |
| 暂停 | 进入 `saving` 前 | 是（≤2s） | 与 `pause` 事件同一批发送 |
| 切后台/隐藏 | `visibilitychange` → hidden，或 DSH 窗口失焦 | 是（尽力） | 先发 `hidden`，再发 `before-save` |
| 离开 | 返回工作、切游戏、waiting-user、卸载 | 是 | 保存完成才销毁 iframe；失败走确认流程 |
| Agent 完成 | `turn/end` → completed | 否 | 只触发一次，失败静默重试 1 次 |
| 游戏关键节点 | 游戏自行调用 `storage.save` | 否 | 平台不感知节点，只统计频率 |

**执行方式。** Runtime 发送 `before-save`（带 `reason`、`deadlineMs: 800`），等待游戏在窗口内调用 `storage.save`；若 800ms 内没有 save 请求到达，记为 `autoSaveSkipped` 并在诊断面板显示，不向用户报错。一次保存进行中时最多排队 1 次，后续触发合并为一次；`storage.save` 本身在 Host 侧串行。

**失败与重试。** 写入失败重试 3 次（200/500/1000ms）；仍失败则：定时保存 → 顶部非阻塞条“存档失败，点击重试”；离开保存 → 状态停在 `saving` 并弹出确认“存档失败，仍要离开吗？”，用户确认后以 `saveStale` 离开，保留上一份成功存档。禁止在失败时删除旧存档。

**上限。** Runtime 在发 Bridge 前预检 ≤1MB、≤32 key；Host 再校验一次。两处都返回 `GM-4131/4132`。

#### Pause / Resume 语义（确定结论）

| 场景 | iframe | 行为 | 恢复方式 |
|---|---|---|---|
| 用户点暂停 | 保留 | `pause(reason:'user')` → `before-save` → 保存 → `paused` | `visible` + `resume(reason:'user')`，不重载 |
| DSH 窗口隐藏/失焦 | 保留 | `hidden` → `pause(reason:'hidden')` → 保存 | 窗口可见时 `visible` + `resume(reason:'visible')` |
| 返回工作 / 切游戏 | 销毁 | `pause(reason:'leave')` → `before-save` → 保存 → 销毁 | **重新加载 + 读存档**，不发送 `resume` |
| waiting-user | 销毁 | `pause(reason:'waiting-user')` → 保存 → 销毁 → `selectPanel(null)` | 用户点击“回到游戏”后重新加载 + 读存档；加载后显示暂停遮罩，用户确认后才 `resume`（D-024） |
| Agent 完成 | 保留 | 不暂停；只更新 Agent Presence，触发一次保存 | 无 |
| 关闭 DSH | 销毁（随页面） | `hidden` → `pause` → 尽力保存 | 下次进入重新加载 + 读存档 |

**结论：离开游戏面板（iframe 被卸载）后返回，唯一路径是重新创建 iframe 并从 Game Save 恢复，不存在“对已销毁 iframe 发 resume”。** 这与 F-05 一致：`main` 是 keyed slot，切到 Conversation 时游戏子树卸载，iframe 的 JS 状态不可能保留。`resume` 仅用于 iframe 仍存活的轻暂停。游戏不得把“暂停”当作“结束”：暂停不结束 Play Session。

暂停顺序固定为：状态置 `paused` → 发 `pause` → 发 `before-save` → 状态置 `saving` → 等待/强制保存 → 成功回 `paused`（轻暂停）或销毁（离开型）。任何一步超时都不阻塞用户超过 2s。

#### 进入、退出与切换流程

1. **Market 进入。** 详情页 Play/Continue → `POST launch`（带 `gameId`、`dshSessionId`、`mode`）→ `loading` → 握手 → `ready` → `playing`。`mode` 取值 `'start' \| 'resume-paused'`：`start` 为首次进入，`ready` 后直接开始；`resume-paused` 用于从 waiting-user／查看结果返回，读档完成后显示暂停遮罩“已恢复上一局 / 继续游戏”，用户确认后才 `resume`（D-024）。存档恢复始终由游戏 `storage.load` 完成。
2. **等待入口进入。** 点击 `conversation.header.leading` chip → 捕获当前 `sessionId`（Slot 的 `useSessions`）→ 若有未完成游戏则直接 launch 该游戏，否则打开 My Games → 进入后绑定不变（D-006）。
3. **返回工作。** 点击小鲸鱼“查看结果”或返回按钮 → 保存 → 销毁 → `ctx.layout.selectPanel(null)` → 回到之前的 Conversation；不改变当前 Session（F-04）。
4. **返回市场。** 保存 → 销毁 → 面板留在 `dsh-game-market`，状态回 `idle`，刷新 Continue/最近游玩。
5. **切换游戏。** 先按“返回市场”处理当前游戏，再 launch 目标游戏；同一时刻只允许一个 iframe。
6. **关闭 DSH。** `visibilitychange` 先触发保存；`pagehide` 时不再等待。若宿主在保存完成前退出，回退到最近一次成功存档，**丢失窗口 ≤30s**。这是 V1 已知限制，见 8.12。

#### 异常检测与恢复

| 异常 | 检测 | 处理 |
|---|---|---|
| 导航超时 | iframe `load` 10s 未触发 | 记 `GM-5011`；UI 显示“加载时间有点久”；自动重载 1 次；20s 仍失败进 `error` |
| 握手超时 | 建 iframe 后 10s 无 `init`/`ready` | 记 `GM-5001`；提示并自动重载 1 次；20s 仍失败进 `error` |
| iframe 无响应 | 每 5s `ping`，连续 3 次无 `pong`（15s） | `GM-5012`；提示“游戏无响应”，重载或结束 |
| 渲染进程崩溃 | `load` 后心跳同时中断，或浏览器 `error` 事件 | `GM-5013`；重载并恢复存档 |
| 白屏但存活 | 心跳正常但无 `ready`/首帧信号 | 按握手超时处理，记 `firstFrameMs`。**待验证（Spike S-18）**：心跳+首帧能否覆盖“活着但空白”；降级为只保证“无响应可恢复” |
| 入口损坏 | launch 前校验：registry 源比对安装记录的 entry SHA-256；local/dev 源无记录哈希，改为重新解析内嵌 manifest 并核对 id/version | `GM-5014` / `GM-5037`；拒绝启动，提示重新安装 |
| 反复崩溃 | 5 分钟内重载 ≥3 次 | 停止自动重载，进 `error`，只保留手动“重试/返回” |

恢复一律“重建 iframe + 读存档”，最多重试 2 次（0/1000ms）；不自动切游戏、不删存档。**游戏完成提醒不打断游戏**：`turn/end` 只改变小鲸鱼状态并触发一次保存，不暂停、不弹 Modal、不改 iframe。

#### waiting-user 流程（D-003）

1. Host 快照变为 `waiting-user`，Client 轮询拾取，小鲸鱼进入等待态并显示入口。
2. 用户点击小鲸鱼 → Runtime 发 `pause(reason:'waiting-user')` + `before-save` → 强制保存（≤2s）。
3. 保存成功（或用户确认带 `saveStale` 继续）→ 销毁 iframe → `ctx.layout.selectPanel(null)` → 进入 Conversation 的原生审批/提问 UI。
4. 用户处理完毕；Game Market 在会话头部 chip 或 Sidebar 状态点保留“回到游戏”入口，**不自动打开游戏**。
5. 用户点击“回到游戏” → `selectPanel('dsh-game-market')` → `POST launch`（沿用同一 `dshSessionId` 绑定，`mode: 'resume-paused'`）→ `loading` → 游戏自行 `storage.load` 恢复 → 显示暂停遮罩，用户确认后才开始（D-024）。
6. 用户不返回时，游戏保持关闭；不得后台重建 iframe，也不得重复提醒。

#### iframe 加载方式

```html
<iframe
  title="Game: 2048"
  src="api/game-market/entry?gameId=2048&version=1.0.0&instance=<32hex>&nonce=<32hex>"
  sandbox="allow-scripts"
  allow="autoplay"
  referrerpolicy="no-referrer"
  loading="eager"
  style="width:100%;height:100%;border:0;display:block;background:#000"
></iframe>
```

- **单文件入口（D-023）。** entry 必须自包含，iframe 加载后不再发起任何子资源请求；Host 只为该 entry 提供一次由父页面发起的导航响应。多文件资源推迟到 V1.5（S-10/S-11）。
- **协议。** 与 DSH Web 同源同协议（本地为 `http://127.0.0.1:<port>`；若宿主启用 TLS 则为 `https`）。禁止 `file:`、`data:`、`blob:` 作为入口；`data:`/`blob:` 无法承载相对资源，也无法被 `/api` 栅栏认证。
- **sandbox 确切值。** 只有 `allow-scripts`。**禁止** `allow-same-origin`（与 `allow-scripts` 同时出现会让游戏能读父页面 DOM、移除 sandbox，隔离失效）。V1 也不加 `allow-forms`、`allow-popups`、`allow-modals`、`allow-downloads`、`allow-top-navigation*`、`allow-pointer-lock`、`allow-presentation`。
- **allow。** `allow="autoplay"`；V1 不授予 `fullscreen`，游戏调用全屏会被拒绝。理由：全屏会覆盖 DSH 控制层，且 V1 不需要。
- **referrerpolicy。** `no-referrer`，避免把宿主 URL 作为 Referer 泄露给资源请求。
- **CSP。** 由 `/entry` 路由在入口 HTML 响应上设置，见 8.10；`script-src 'unsafe-inline'` 只放行游戏内联脚本，`connect-src 'none'`（D-014），`frame-ancestors` 只允许宿主 origin。
- **焦点。** iframe 可聚焦；进入时调用一次 `iframe.focus()`，之后键盘事件留在游戏内。
- **URL 组合。** Host 返回绝对路径 `/api/...`，Client 去掉前导 `/` 后作为 `src`（与 `fetch('api/...')` 约定一致），避免子路径部署问题。

#### postMessage 协议

信封固定为三类，`v` 当前为 `1`：

```ts
type Req  = { v: 1; id: string; kind: 'req'; method: string; params?: JsonValue };
type Res  = { v: 1; id: string; kind: 'res'; ok: true; result?: JsonValue }
          | { v: 1; id: string; kind: 'res'; ok: false; error: { code: string; message: string; retryable: boolean } };
type Evt  = { v: 1; id?: string; kind: 'evt'; event: string; data?: JsonValue };
```

**握手。** ① iframe 加载 `entryUrl`，SDK 从 `location.search` 取 `instance`/`nonce`；② SDK 每 250ms 发 `hello`（最多 30 次），携带 `instanceId`、`nonce`、`sdkVersion`、`protocolVersion`；③ Runtime 校验 `event.source === iframe.contentWindow`、instance、nonce，回一条 `init`：`{ protocolVersion, instanceId, nonce, gameId, gameVersion, runtimeVersion, sdkVersion, supportedSdkRange, locale, theme, reducedMotion, capabilities, limits: { saveBytes: 1048576, saveKeys: 32, scoreMetaBytes: 2048 }, viewport }`；④ SDK 发 `ready` 请求，Runtime 回 `{ ok: true, result: RuntimeInfo }`；⑤ 状态进入 `ready`，`game.ready()` resolve。握手 10s 未完成 → `GM-5001`。

**方法表（req/res）。**

| method | 方向 | params | result | 超时 |
|---|---|---|---|---|
| `ready` | 游戏→Runtime | `{ sdkVersion, protocolVersion }` | `GameRuntimeInfo` | 10000 |
| `ping` | Runtime→游戏 | `{ at }` | `{ at }` | 2000 |
| `storage.save` | 游戏→Runtime | `{ key, data }` | `StorageSaveResult` | 6000 |
| `storage.load` | 游戏→Runtime | `{ key }` | `StorageLoadResult \| null` | 3000 |
| `storage.remove` | 游戏→Runtime | `{ key }` | `StorageRemoveResult` | 3000 |
| `session.start` | 游戏→Runtime | `{}` | `SessionStartResult` | 4000 |
| `session.end` | 游戏→Runtime | `{ outcome?, score? }` | `SessionEndResult \| null` | 6000 |
| `score.submit` | 游戏→Runtime | `{ score, meta? }` | `ScoreSubmitResult` | 4000 |
| `score.getBest` | 游戏→Runtime | `{}` | `BestScore \| null` | 3000 |
| `agent.getStatus` | 游戏→Runtime | `{}` | `GameAgentState` | 2000 |

未单列的方法默认 **5000ms** 超时；超时统一回 `GM-5005` 并记 `bridge-timeout` 诊断。

**事件表（evt，无回包）。**

| event | 方向 | data |
|---|---|---|
| `hello` | 游戏→Runtime | `{ instanceId, nonce, sdkVersion, protocolVersion }` |
| `init` | Runtime→游戏 | 见握手 ③ |
| `pause` / `resume` | Runtime→游戏 | `{ reason, at }` |
| `hidden` / `visible` | Runtime→游戏 | `{ at }` |
| `before-save` | Runtime→游戏 | `{ reason, deadlineMs }` |
| `agent-status` | Runtime→游戏 | `GameAgentState` |
| `theme` | Runtime→游戏 | `{ theme, reducedMotion }` |
| `viewport` | Runtime→游戏 | `{ width, height, dpr }`，节流 200ms |

**校验与丢弃。** 接收方必须依次校验：`event.source` 身份、`kind` 合法、`v === 1`、`id`/`method`/`event` 类型、nonce（`hello` 与 `init` 之外均需匹配）、payload 大小与深度。任一项失败：丢弃、计数、不回复；10s 内非法消息 >50 条则 Runtime 终止 iframe（`GM-5004`）并提示。未知 method 回 `GM-4004`，未知 event 忽略。

**并发与顺序。** 请求可并发，响应可能乱序，按 `id` 关联；同一游戏写操作由 Runtime 串行；事件按下发顺序到达，不保证与响应的相对顺序。双向在途请求各 ≤32；超出 `GM-4291`。

**targetOrigin。** 双向都用 `'*'`。这不是疏忽：sandbox（无 `allow-same-origin`）文档的源是 opaque，父页面无法用具体 origin 匹配；`event.origin` 在 iframe→父方向恒为 `"null"`，**不能作为认证**（本机实测）。安全由 `event.source` 同一性 + 每次 launch 随机 nonce + 严格结构校验保证。禁止通过消息传递任何密钥或宿主路径。

#### 视口、缩放、DPR 与音频

- iframe 尺寸由 Runtime 用容器 `100%` 控制，**不做 CSS `transform: scale`**，避免模糊与坐标系错位；游戏自行处理内部缩放。容器留出右下角 Agent Presence 的安全区（详情见 9.6）。
- `init.viewport` 给出 CSS 像素与 `devicePixelRatio`；窗口尺寸变化时节流发送 `viewport`，游戏可据此重设 canvas。DPR 由游戏乘以自身分辨率，平台不强制。
- 音频自动播放：`allow="autoplay"` 是必要条件但不是充分条件；opaque origin 每次都是新源，浏览器可能仍要求用户手势。**游戏必须在首次用户手势前保持静音**，在 `pointerdown`/`keydown` 后再启动音频。**待验证（Spike S-19）**：在 DSH Electron 中验证 `allow="autoplay"` 的实际效果；降级方案是首次点击时显示“点击开始”按钮，不依赖自动播放。

#### 主题、Reduce Motion 与键盘

- 主题来自 DSH 当前主题（light/dark），通过 `init.theme` 与 `theme` 事件下发。游戏可以用自己的美术风格，但**不得假设** `prefers-color-scheme` 与 DSH 一致：DSH 手动切换主题时，OS 媒体查询不会变。需要跟随主题的游戏读 `game.runtime.theme`。
- `prefers-reduced-motion` 由 Runtime 用 `matchMedia('(prefers-reduced-motion: reduce)')` 读取，写入 `init.reducedMotion` 并在变化时发 `theme` 事件。游戏应当减少位移动画；平台层（小鲸鱼、遮罩）由 9.9 处理。
- **键盘焦点。** iframe 内按键属于游戏；平台**禁止**注册 `window`/`document` 级 `keydown` 捕获（包括方向键、空格、Esc），禁止 `preventDefault` 全局按键。平台按钮（返回、暂停、小鲸鱼）是普通可聚焦元素，Tab 可到达；打开平台 Modal 时才允许在 Modal 内接管 Esc。V1 不设全局“退出游戏”快捷键，退出用可见按钮。

#### 性能与资源约束

- 同一时刻只允许 1 个游戏 iframe；launch 新游戏前必须销毁旧的。
- 以下时机**必须销毁** iframe 并移除 `src`、清空引用：离开游戏面板、切游戏、waiting-user 切回、卸载/更新当前游戏、`error` 持续 30s 且用户未重试、插件停用、DSH 页面卸载。
- 销毁时必须：清计时器、移除 `message` 监听、`iframe.remove()`、释放 Blob URL；之后不得再向旧 `contentWindow` 发消息。
- 隐藏（非离开）时保留 iframe，但 `pause` 后游戏应停止 rAF；Runtime 自己不跑渲染循环。
- Runtime 自身的轮询在 `document.hidden` 时暂停，可见时立即刷新一次。

### 8.5 宿主 HTTP API

**通道。** Client 与 Host 之间的唯一通道是 `ctx.connection.fetch.register` 注册的精确 Fetch 路由 + Client 同源相对 `fetch`（D-008/F-06）。不使用 `ctx.remote`，不新增 Remote namespace，不自己起 WebSocket/HTTP Server。

#### 注册方式

```js
export const inject = ['connection'];   // 必须写入 inject，冷启动时序（F-06）

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = ROUTES.map((route) => ctx.connection.fetch.register(route));
    return async () => { await Promise.allSettled(disposers.map((d) => d?.())); };
  }, 'dsh-game-market: http routes');
}
```

- `register(route)` 返回 `() => Promise<void>`；注册由 Context effect 持有，插件停用/HMR 自动移除。重复 `path` 注册抛错，必须在 apply 阶段一次性注册固定路由，动态资源路由单独管理（见下）。
- 路由**只接受 `GET`/`HEAD`/`POST`**（F-06 的 `ConnectionFetchRoute.methods` 类型）。因此本 API **不使用 `PUT`/`PATCH`/`DELETE`**：写入一律 `POST`，资源 id 放 query 或 body：`POST save`、`POST preferences`，不使用 REST 风格的路径参数。
- `path` 必须是 `/api/<segment...>`，每段匹配 `[A-Za-z0-9_$.-]+`。**精确 pathname 匹配，query 不参与匹配**（已核实：`fetchRoutes.get(url.pathname)`；非法路由报 `invalid exact Fetch route`；重复注册抛错）。因此不使用 `/:id` 路径参数，统一“固定 path + query/body 定位资源”。
- `requestBody: 'buffered'`；宿主全局上限 300MiB 不是我们的限制，每个 handler 必须自己按 Content-Length 与实际字节二次限制（见下表）。
- 未声明的方法/未注册的 path 由宿主返回 **404**（不是 405）；非 owner peer 返回 **403**。

#### 路径与响应约定

- Base path：`/api/game-market/`。
- 所有响应 `content-type: application/json; charset=utf-8`、`cache-control: no-store`；资源字节路由例外。
- 统一信封：

```json
{ "ok": true, "data": {}, "requestId": "req_9f2c41a0b7d38e16", "serverTime": "2026-10-18T08:00:00.000Z" }
```

```json
{ "ok": false, "error": { "code": "GM-4131", "message": "Save exceeds 1 MiB", "retryable": false },
  "requestId": "req_9f2c41a0b7d38e16", "serverTime": "2026-10-18T08:00:00.000Z" }
```

- 除 `/install-local` 外，请求体必须是 JSON 对象；`content-type` 非 `application/json` → 415 `GM-4150`；解析失败 → 400 `GM-4001`；未知字段忽略，未知 method 400 `GM-4004`。`/install-local` 的请求体是 raw `text/html` 字节（`content-type: text/html; charset=utf-8`，其它类型同样 415）。
- **GET 必须无副作用**：所有写操作只走 POST。这是安全要求，不是风格（见 8.10 的 CSRF/子资源侧信道）。
- **日志与错误 `details` 不返回存档内容**，只返回字节数、key 名、revision。

#### 端点表

“注册 path”是实际注册的精确路径；“逻辑资源”对应 REST 风格的 `:id` 记法。所有路径前缀 `/api/game-market`。

| 逻辑资源 | 方法与注册 path | 请求 | 成功 `data` | 幂等 / 限制 |
|---|---|---|---|---|
| 游戏列表 | `GET /games` | `q?`、`category?`、`cursor?`、`limit?`（≤50） | `{ items, nextCursor, source, refreshedAt }` | 只读；2s |
| 游戏详情 | `GET /game?id=` | `id` | `{ game, installed, canContinue, bestScore, activePlaySession }` | 只读；1s |
| 安装 | `POST /install` | `{ gameId, version?, operationId }` | `{ gameId, version, sha256, installedAt, changed }` | 按 `operationId` 幂等；全局串行；**180s**（下载 120s + 校验/安装 60s） |
| 本地安装 | `POST /install-local` | raw `text/html` 字节（≤20 MiB；`content-type: text/html; charset=utf-8`；**无 sha256 可校验**） | `{ gameId, version, sha256: null, installedAt, changed }` | 全局串行；60s；`source: 'local'`；Client 必须已完成二次确认（§8.7.7） |
| 卸载 | `POST /uninstall` | `{ gameId, operationId, deleteData? }` | `{ gameId, removed, dataDeleted }`（默认 `deleteData:false` → 全部数据保留；为 true 时同时删除存档、成绩与未结束 Session） | 幂等；10s |
| 已安装 | `GET /installed` | — | `{ items: [{ gameId, name, version, installedAt, lastPlayedAt, canContinue, bestScore }] }` | 只读；2s |
| 读存档 | `GET /save?gameId=&include=` | `gameId`、`include=data?` | `{ gameId, keys, bytes, revision, updatedAt }`；`include=data` 时附 `data`（key→值） | 只读；不存在 404 `GM-4041` |
| 写存档 | `POST /save` | `{ gameId, key, data, expectedRevision?, operationId }` | 同上 | 按 `operationId` 幂等；1MB；6s；`expectedRevision` 不符 409 `GM-4092` |
| Play Session | `POST /session` | `{ gameId, action: 'start'\|'end', playSessionId?, outcome?, score?, operationId }` | `{ playSessionId, startedAt, endedAt, outcome, adopted, ignored }` | 按自然键幂等；4s |
| 成绩 | `GET /scores?gameId=` | `gameId` | `{ best, history }` | 只读；2s |
| 提交成绩 | `POST /score` | `{ gameId, score, meta?, playSessionId?, operationId }` | `{ best, isBest, submittedAt }` | 按 `operationId` 幂等；限频；4s |
| 偏好 | `GET /preferences` | — | `PreferencesFile`（`lastPlayedGameId`、`lastMarketTab`、`marketFilter`、`notifySoundEnabled`、`dismissedHints`、`lastUpdateCheckAt`，见 8.6.4） | 只读；1s |
| 偏好 | `POST /preferences` | 上述字段的任意子集 | 同上 | 合并写；1s |
| Agent 快照 | `GET /agent-state?sessionId=` | `sessionId` | `GameAgentState` + `hostEpoch` | 只读；可带 `If-None-Match`；1s |
| Agent 确认 | `POST /agent-ack` | `{ sessionId, seq }` | `{ state: 'idle', seq }` | 幂等；1s |
| Registry 刷新 | `POST /registry-refresh` | `{ force? }` | `{ refreshedAt, count, etag, source }` | 5 分钟节流，返回 429；10s |
| 健康检查 | `GET /health` | — | `{ ok, version, hostEpoch, storage, registry, uptimeMs }` | 只读；1s |
| 启动 | `POST /launch` | `{ gameId, version?, dshSessionId?, mode? }` | `{ instanceId, nonce, entryUrl, preview, runtimeVersion, capabilities, limits, viewport, hostEpoch }` | 每次生成新实例；8s |
| 入口页 | `GET /entry` | `gameId`、`version`、`instance`、`nonce` | HTML 字节流（`text/html`） | 只读；`no-store`；1s |
| 预览图 | `GET /preview` | `gameId`、`version`、`file` | 图片字节流（`image/*`；来源为 Registry 缓存） | 只读；`immutable`；2s |

`POST launch` 与 `POST agent-ack` 是 8.4/8.9 必需的补充端点：前者下发 iframe 入口与 nonce，后者把 completed 置回 idle。**体积上限：** 所有 JSON 请求体 ≤1MB（`save` 的 `data` 与信封合计）；单文件包 ≤20 MiB（下载与 `/install-local` 同）；响应体 ≤2MB，列表超出用 `nextCursor` 分页。错误码按 8.1 分段：读接口以 `GM-404x` 为主，写接口以 `GM-400x/409x/413x/429x/502x/503x` 为主，逐条以 handler 为准。

**“不并发执行安装”的实现约束。** Host 维护一个全局安装锁（不是每游戏一把）：同一时刻只允许一个安装/更新任务；锁被占用时新请求立即返回 409 `GM-4091` 并附 `retryAfterMs`，不排队、不阻塞请求线程。安装任务包含下载、哈希校验、HTML/内嵌 manifest 校验、原子落位、写 metadata；任何一步失败都回滚到上一版本，不留下半安装目录。同 `operationId` 的重放返回上次结果，不重新执行。

#### 资源路由

V1 资源路由只有两条固定路径（D-023），不做逐文件注册：

```text
GET|HEAD /api/game-market/entry?gameId=<id>&version=<ver>&instance=<32hex>&nonce=<32hex>
GET|HEAD /api/game-market/preview?gameId=<id>&version=<ver>&file=<cover.webp|shot-1.webp>
```

- **entry。** 返回安装目录中的 `entry.html`（`packages/<id>/<version>/entry.html`，`text/html; charset=utf-8`），同时设置 8.10 的 CSP、`cache-control: no-store`、`x-content-type-options: nosniff`、`referrer-policy: no-referrer`。`gameId`+`version` 必须与当前安装记录一致，否则 404 `GM-4042`；`instance`/`nonce` 只用于 URL 唯一性与诊断，不写入 HTML。包是单文件，此路由不接受任何文件路径参数。
- **preview。** 供 Market UI 在**父页面**（同源）加载封面/截图（以及 Registry 提供的图标），来源只有一个：Host 在 Registry 刷新时缓存到 `preview-cache/<gameId>/<version>/` 的素材（§8.8.2）——封面/截图不是包内容，本地/开发安装没有缓存。`file` 必须与缓存清单逐字匹配（禁止任意路径拼接或目录遍历），扩展名白名单 png/webp/jpeg，返回 `image/*`、`cache-control: public, max-age=31536000, immutable`。无缓存返回 404 `GM-4043`，Market 改用 manifest 的 `icon` data URI 或首字母占位。V1 不支持 Range（游戏不加载外部媒体），Client 不直接请求外链图片。
- **为什么不逐文件注册。** `connection.fetch` 只支持精确 pathname；sandbox iframe 是 opaque origin，其子资源请求会被 `/api` 栅栏按 `sec-fetch-site` 拦截（S-10），逐文件注册无法解决认证问题。单文件 entry 让 iframe 只需一次由父页面发起的导航请求；多文件能力推迟到 V1.5（S-10/S-11 + `ctx.webServer.register` 或独立 origin 方案）。
- **完整性。** `POST launch` 时 Host 对 registry 源重新计算 entry 文件 SHA-256 与安装记录比对，不符返回 409 `GM-5014`；local/dev 源没有记录哈希，改为重新解析内嵌 manifest 并核对 `id`/`version`（不符 409 `GM-5037`）；均不返回 HTML。preview 素材在缓存时校验格式与大小，不在每次请求时重复计算。
- **响应头。** entry/preview 均 `x-content-type-options: nosniff`、`referrer-policy: no-referrer`；均由同源父页面发起，不需要 CORS。`content-length` 必须设置；preview 单张 ≤2 MiB。

#### 错误码 → HTTP 状态码

| HTTP | 错误码段 | 说明 |
|---|---|---|
| 200 | — | 成功 |
| 304 | — | `If-None-Match` 命中，无 body |
| 400 | `GM-400x` | 参数/JSON/请求语义错误 |
| 422 | `GM-422x` | 包/Manifest 语义错误（安装前校验） |
| 401 | 宿主栅栏 | 未认证；由宿主返回，插件不产生 |
| 403 | `GM-403x`、宿主栅栏 | 能力/状态不允许；或非 owner peer |
| 404 | `GM-404x` | 资源不存在；未注册路由也由宿主返回 404 |
| 409 | `GM-409x`、`GM-426x` | 并发冲突、revision 冲突、版本不兼容 |
| 413 | `GM-413x` | 体积/配额超限 |
| 415 | `GM-415x` | Content-Type 不支持 |
| 429 | `GM-429x` | 限频/背压；带 `retry-after` 秒 |
| 500 | `GM-500x`、`GM-501x`、`GM-502x` | Bridge/Runtime/持久化内部错误 |
| 503 | `GM-503x` | Host/Registry 暂不可用；带 `retry-after` |

不在表内的错误一律 500 `GM-500x`，并记录完整堆栈到 Host 日志（脱敏）。

#### 同源与安全（结论）

V1 **没有账号/登录，但 `/api` 不是无认证的**。已核实：浏览器持有宿主签发的 host-only、`HttpOnly`、`SameSite=Strict` Cookie；认证前每个请求经过 `api-request-trust`：`Host` 必须是 loopback/绑定 IP，`Origin` 必须指向同一 authority，`sec-fetch-site: cross-site` 一律拒绝；Host/Origin 失败 403，可信但未认证 401；exact route 只对 `principal.kind === 'owner'` 放行，其它 403。

因此本插件**不额外校验 Origin/Referer，也不引入 HTTP nonce**：重复校验无收益，且易误伤子路径部署。插件只做业务授权（`gameId` 归属、能力、大小、频率）。V1 的单文件 entry 只产生一次由父页面发起的导航请求（不产生 iframe 子资源请求），因此这条栅栏在 V1 不构成阻塞。**待验证（Spike S-10，V1.5 前置）**：多文件游戏时 sandbox iframe 的子资源请求是否携带 Cookie 并通过 `sec-fetch-site`；若不通，再评估 `ctx.webServer.register` 公开静态路由或独立 origin，不得用 `allow-same-origin` 绕过。

#### 请求/响应示例

```json
// POST /api/game-market/install
{ "gameId": "2048", "version": "1.0.0", "operationId": "op_3f9c2a" }
// 200
{ "ok": true, "data": { "gameId": "2048", "version": "1.0.0",
  "sha256": "9f2c…", "installedAt": "2026-10-18T08:00:00.000Z", "changed": true },
  "requestId": "req_9f2c41a0b7d38e16", "serverTime": "2026-10-18T08:00:00.000Z" }
```

```json
// POST /api/game-market/save
{ "gameId": "2048", "key": "current", "data": { "board": [[2,4],[8,16]], "score": 8240 },
  "expectedRevision": 12, "operationId": "op_a1b2c3" }
// 200
{ "ok": true, "data": { "gameId": "2048", "keys": 1, "bytes": 61, "revision": 13,
  "updatedAt": "2026-10-18T08:00:01.000Z" }, "requestId": "req_…", "serverTime": "…" }
```

```json
// GET /api/game-market/agent-state?sessionId=ses_123
{ "ok": true, "data": { "state": "running", "label": "正在运行测试…",
  "sessionId": "ses_123", "updatedAt": "2026-10-18T08:00:02.000Z",
  "source": "tool", "seq": 42, "since": "2026-10-18T08:00:01.800Z", "turnId": "turn_9c2f", "hostEpoch": "he_7c1a" },
  "requestId": "req_…", "serverTime": "…" }
```

#### Client 侧 fetch 封装

```ts
const BASE = 'api/game-market';
const TIMEOUT: Record<string, number> = { install: 180000, 'registry-refresh': 15000, launch: 8000 };

export async function call<T>(name: string, init: { method?: 'GET'|'POST'; query?: Record<string,string>; body?: unknown } = {}): Promise<T> {
  const url = `${BASE}/${name}${init.query ? '?' + new URLSearchParams(init.query) : ''}`;
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
  const timeout = TIMEOUT[name] ?? 5000;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeout),
      });
      const json = await res.json();
      if (!json.ok) throw Object.assign(new Error(json.error.message), { code: json.error.code, retryable: json.error.retryable });
      return json.data as T;
    } catch (error) {
      const retryable = attempt < 2 && (method === 'GET' || name === 'registry-refresh');
      if (!retryable) throw error;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
}
```

写入类 POST 只有在带 `operationId` 时才允许重试；`install`/`uninstall`/`launch` 一律不自动重试，先查 `GET installed`/`GET health` 再决定。

#### 轮询与后续优化（D-015）

- 游戏面板可见且 `document.visibilityState === 'visible'` 时，以 **1s** 轮询 `GET agent-state?sessionId=`；面板不可见或页面隐藏时停止，恢复可见立即请求一次。
- **两处消费者共用一个轮询器。** `conversation.header.leading` 入口 chip 与游戏页都要快照；Client 按 `sessionId` 复用模块级轮询器，引用计数为 0 时停止。D-001 的“连续运行 ≥5s”由 chip 用快照 `since` 计算，状态离开 running 即重新计时。
- 失败退避：1s → 2s → 4s → 8s（上限 8s），成功后回到 1s；连续 5 次失败显示“Agent 状态暂不可用”，不阻塞游戏。
- 支持 `ETag`（`W/"<hostEpoch>:<seq>"`）与 `If-None-Match`；304 不读 body。V1 可以只发请求头、不依赖 304。
- **待验证（Spike S-17）**：SSE/长轮询能否在 `connection.fetch` 的 Response 上长期保持（涉及缓冲与连接生命周期）。接口语义不变，只替换传输；降级就是 1s 轮询。V1 不实现 SSE。

### 8.6 数据模型与持久化

#### 8.6.1 存储根目录

Host 使用插件自有目录（D-009），不走 `ctx.storageDomain`（F-07 未验证，仅记为后续优化）：

```text
$DSH_HOME/storages/dsh-game-market/
```

解析顺序（与参考实现 `dsh-token-stats` 一致的写法）：

```ts
const home = process.env.DSH_HOME?.trim()
const base = home && home.length > 0 ? home : join(homedir(), '.dsh')
const root = join(base, 'storages', 'dsh-game-market')
```

**profile 隔离**：本机实测 `DSH_HOME=/Users/orange/.dsh`、`DSH_PROFILE=desktop`、`DSH_PROFILE_DIR=~/.dsh/profiles/desktop`，且 `~/.dsh/profiles/` 下同时存在 `desktop` 与 `web` 两个 profile，而 `~/.dsh/storages/` 在 profile 目录**之外**。结论：**默认情况下同一台机器的多个 profile 共享同一份游戏数据**。

这是有意接受的行为（装一次、两个 profile 都能玩、存档连续），代价是所有写入必须按 §8.6.9 做跨进程串行化。若未来 DSH 改为 per-profile `DSH_HOME`，路径不变、行为变成隔离，**无需迁移**。

> 待验证（Spike S-01）：DSH 是否在所有启动路径上都设置 `DSH_HOME`；该目录是否始终可写（macOS 容器/沙箱下）。
> 验证方法：写一个探针插件，在 `apply` 中记录 `process.env.DSH_HOME`、目录 `realpath`、`fs.access(W_OK)` 结果与文件 `mode`，跑 desktop 与 web 两个 profile 各一次，并在 DSH 完全退出后检查文件仍在。
> 降级方案：若目录不可写，进入**只读模式**——Market 与已安装游戏可玩，存档/成绩写入返回 `E_STORE_READONLY` 并在 UI 顶部常驻提示，不静默丢数据。

#### 8.6.2 目录树与文件职责

```text
$DSH_HOME/storages/dsh-game-market/
├── installations.json          # 已安装游戏索引（唯一权威）
├── preferences.json            # 平台 UI 偏好
├── registry-cache.json         # Registry 拉取缓存
├── preview-cache/<gameId>/<version>/  # Registry 封面/截图缓存（Market 展示，与包无关）
├── packages/
│   └── <gameId>/
│       ├── 1.2.0/              # 单文件包落位目录（只读），内含 entry.html
│       └── 1.1.0/              # 保留 1 个旧版本用于回滚
├── saves/
│   └── <gameId>/
│       ├── current.json        # Game Save 信封 + 游戏私有数据
│       └── meta.json           # 存档摘要（热路径只读它）
├── sessions/
│   └── <gameId>.json           # Session Record 列表（一次游玩一条）
├── scores/
│   └── <gameId>.json           # Personal Best + 历史成绩
├── staging/<jobId>/            # 下载临时目录（.part，启动时清理）
├── trash/<gameId>-<ts>/        # 卸载/回滚/失败残留（延迟删除）
└── logs/market.log             # 可选诊断日志，1 MiB × 3 轮转
```

| 路径 | 写入者 | 读取者 | 生命周期 |
|---|---|---|---|
| `installations.json` | Host 安装器 | Host API / Market UI | 永久，卸载即删条目 |
| `preferences.json` | Client 经 Host | Host | 永久 |
| `registry-cache.json` | Host Registry 客户端 | Host | 可随时丢弃 |
| `preview-cache/<id>/<version>/` | Host Registry 客户端 | Market UI（经 `/preview`） | 随 Registry 刷新更新，可随时丢弃 |
| `packages/<id>/<version>/entry.html` | Host 安装器 | Runtime（`/entry`） | 卸载删除 |
| `saves/<id>/current.json` | Host（游戏提交） | Runtime → 游戏 | 卸载默认保留 |
| `saves/<id>/meta.json` | Host | Market UI（Continue 判定） | 同上 |
| `sessions/<id>.json` | Host Runtime | Market UI / 统计 | 同上 |
| `scores/<id>.json` | Host | Market UI / 详情页 | 同上 |
| `staging/`、`trash/` | Host | 无 | 启动时清理 |

#### 8.6.3 `installations.json`

```ts
interface InstallationsFile {
  schemaVersion: 1
  updatedAt: string                  // ISO 8601
  games: Record<string, Installation>
}

interface Installation {
  id: string
  version: string                    // 已安装版本
  installedAt: string
  updatedAt: string
  source: 'registry' | 'local' | 'dev' | 'builtin'
  packagePath: string                // 相对 packages/，固定为 "<id>/<version>"；该目录下只有 entry.html
  sha256: string | null              // 64 位小写 hex；'registry' 源必填，'local'/'dev' 为 null
  sizeBytes: number                  // 单文件包字节数（entry.html）
  previousVersion: string | null      // 回滚目标，最多 1 个
  manifest: {                        // 内嵌 manifest 解析快照，非权威
    name: string
    authorName: string
    description: string
    categories: string[]
    capabilities: string[]
    icon: string | null              // data URI
    cover: string | null             // Registry 缓存文件名（如 "cover.webp"），无则为 null
    viewport: { width: number; height: number; fit: 'contain' }
  }
  lastPlayedAt: string | null
  playCount: number
  totalPlayMinutes: number
  compatibility: {
    status: 'ok' | 'incompatible' | 'broken'
    reason: string | null            // 错误码或人读原因
    checkedAt: string
  }
  update: {
    available: boolean
    version: string | null
    checkedAt: string | null
  }
}
```

一致性规则：`manifest` 只是内嵌 manifest 的解析快照、**非权威**；**运行前必须重新读取 `packages/<id>/<version>/entry.html` 并解析其内嵌 manifest**，若 `id`/`version` 与记录不一致，置 `compatibility.status = 'broken'` 并禁用 Play（`E_INSTALL_CORRUPT`），不自动修复。

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-18T08:12:31.402Z",
  "games": {
    "block-drop": {
      "id": "block-drop",
      "version": "1.2.0",
      "installedAt": "2026-10-17T11:02:10.000Z",
      "updatedAt": "2026-10-18T08:12:31.402Z",
      "source": "registry",
      "packagePath": "block-drop/1.2.0",
      "sha256": "3f9c1a…",
      "sizeBytes": 4821339,
      "previousVersion": "1.1.3",
      "manifest": {
        "name": "Block Drop",
        "authorName": "Orange",
        "description": "把下落的方块叠成完整横行。",
        "categories": ["puzzle", "arcade"],
        "capabilities": ["storage", "score"],
        "icon": "data:image/png;base64,iVBORw0KGgo…",
        "cover": "cover.webp"
      },
      "lastPlayedAt": "2026-10-18T05:44:02.117Z",
      "playCount": 17,
      "totalPlayMinutes": 63,
      "compatibility": { "status": "ok", "reason": null, "checkedAt": "2026-10-18T08:12:31.402Z" },
      "update": { "available": false, "version": null, "checkedAt": "2026-10-18T08:12:31.402Z" }
    }
  }
}
```

（示例中 `sha256` 为省略写法，真实值必须是完整 64 位小写 hex。）

#### 8.6.4 `preferences.json`

```ts
interface PreferencesFile {
  schemaVersion: 1
  lastPlayedGameId: string | null    // 首页 Hero 卡与等待入口的"继续上一局"
  lastMarketTab: 'discover' | 'mine'
  marketFilter: { categories: string[]; query: string }
  notifySoundEnabled: boolean        // 默认 true；仅平台提示音，不影响游戏内音频（D-026）
  dismissedHints: string[]           // 一次性提示的 ID 列表
  lastUpdateCheckAt: string | null
}
```

`preferences.json` **不得**保存主题（DSH 拥有 Light/Dark/System）、不得保存窗口几何、不得保存任何游戏业务数据。

```json
{
  "schemaVersion": 1,
  "lastPlayedGameId": "block-drop",
  "lastMarketTab": "discover",
  "marketFilter": { "categories": ["puzzle"], "query": "" },
  "notifySoundEnabled": true,
  "dismissedHints": ["waiting-chip-intro"],
  "lastUpdateCheckAt": "2026-10-18T08:12:31.402Z"
}
```

#### 8.6.5 `saves/<gameId>/`

```ts
interface SaveEnvelope {
  schemaVersion: 1                   // 信封版本，平台定义
  gameId: string
  saveSchemaVersion: number          // 游戏定义，来自 manifest.save.schemaVersion
  savedAt: string
  reason: 'auto' | 'pause' | 'exit' | 'agent-complete' | 'manual'
  bytes: number                      // data 序列化后的 UTF-8 字节数
  values: Record<string, unknown>    // 游戏私有 KV；≤32 key、单值 ≤256 KiB、总量 ≤1 MiB（见 8.3）
}

interface SaveMeta {
  schemaVersion: 1
  gameId: string
  hasSave: boolean
  saveSchemaVersion: number
  savedAt: string
  bytes: number
  reason: SaveEnvelope['reason']
  lastPlaySessionId: string | null
  saveCount: number
}
```

`meta.json` 存在的唯一理由是性能：Market 列表与 Continue 判定要读几十款游戏的"有没有存档"，不能每次都加载 1 MiB 的 `current.json`。**读 `current.json` 只发生在真正进入游戏时。**

```json
{
  "schemaVersion": 1,
  "gameId": "block-drop",
  "saveSchemaVersion": 2,
  "savedAt": "2026-10-18T05:51:44.900Z",
  "reason": "exit",
  "bytes": 18422,
  "data": { "board": [[0,2,0,0],[4,4,8,0]], "score": 8240, "next": 3, "seed": 913402 }
}
```

#### 8.6.6 `sessions/<gameId>.json` 与 `scores/<gameId>.json`

```ts
interface SessionRecordsFile {
  schemaVersion: 1
  gameId: string
  records: SessionRecord[]           // 按 startedAt 降序，上限 100
}

interface SessionRecord {
  playSessionId: string             // 平台生成；与 SDK session.* 返回一致
  dshSessionId: string | null        // 绑定的 DSH Session（D-006）
  startedAt: string
  endedAt: string | null             // null = 未正常结束（崩溃/断电）
  durationMs: number
  outcome: 'running' | 'completed' | 'lost' | 'abandoned' | 'quit' | 'crashed'
  score: number | null
  saveSchemaVersion: number
}
```

`outcome` 的取值来源：SDK `session.end()` 传 `completed | lost | abandoned | quit`；Host 检测到进程崩溃/长期无心跳时写 `crashed`；未结束时为 `running`。SDK 的 `score` 与该 Session 的最终分对应。

```ts
interface ScoresFile {
  schemaVersion: 1
  gameId: string
  direction: 'higher-better' | 'lower-better'
  best: { value: number; at: string; playSessionId: string } | null
  history: { value: number; at: string; playSessionId: string }[]   // 上限 200，按时间降序
  submitCount: number
}
```

`best` **永不淘汰**；`history` 超出 200 条时按时间淘汰最旧条目。V1 的"本地排行榜"就是 `history` 的排序视图（单用户，无多玩家档案），V2 再做多档案。

```json
// saves/block-drop/meta.json
{ "schemaVersion": 1, "gameId": "block-drop", "hasSave": true, "saveSchemaVersion": 2,
  "savedAt": "2026-10-18T05:51:44.900Z", "bytes": 18422, "reason": "exit",
  "lastPlaySessionId": "ps_01jb7q2k9v3m", "saveCount": 63 }
```

```json
// sessions/block-drop.json
{ "schemaVersion": 1, "gameId": "block-drop",
  "records": [
    { "playSessionId": "ps_01jb7q2k9v3m", "dshSessionId": "session-1444e928",
      "startedAt": "2026-10-18T05:31:02.000Z", "endedAt": "2026-10-18T05:51:44.900Z",
      "durationMs": 1242900, "outcome": "completed", "score": 8240, "saveSchemaVersion": 2 }
  ] }
```

```json
// scores/block-drop.json
{ "schemaVersion": 1, "gameId": "block-drop", "direction": "higher-better",
  "best": { "value": 8240, "at": "2026-10-18T05:51:44.900Z", "playSessionId": "ps_01jb7q2k9v3m" },
  "history": [ { "value": 8240, "at": "2026-10-18T05:51:44.900Z", "playSessionId": "ps_01jb7q2k9v3m" },
               { "value": 6110, "at": "2026-10-17T12:04:11.000Z", "playSessionId": "ps_01jb5r0t2a8c" } ],
  "submitCount": 17 }
```

`registry-cache.json` 属于 Host 缓存而不是业务数据，结构见 §8.8.3；损坏或 `schemaVersion` 不匹配时**直接丢弃重拉**，不做迁移。


#### 8.6.7 Game Save 与 Session Record 分离规则

对齐 §3.8：两类状态必须独立存储、独立生命周期。

| 维度 | Game Save | Session Record |
|---|---|---|
| 语义 | 世界状态，可恢复 | 一次游玩的流水 |
| 写入者 | 游戏经 SDK 提交 | Runtime 生成，游戏不可写 |
| 时机 | 30s 定时 / 暂停 / 退出 / Agent 完成（D-005） | 开始时创建，结束时闭合 |
| 覆盖性 | 单条，后写覆盖前写 | 追加，永不覆盖 |
| 上限 | 1 MiB / 次 | 100 条 / 游戏 |
| 用于 | Continue | 历史成绩、游玩时长、最近游玩 |
| 卸载默认 | 保留 | 保留 |

派生规则：`scores.history[]` 中的条目由**已闭合的 Session Record** 派生（`outcome !== 'running'` 且有 `score`），不允许游戏直接写成绩历史；`game.score.submit()` 只更新 `best` 与当次 `SessionRecord.score`，闭合时再落入 `history`。这样"最高分"与"历史成绩"不会互相矛盾。

#### 8.6.8 原子写、`.bak` 与恢复

所有 JSON 文件共用一个写入口，禁止直接 `writeFile`：

```ts
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const dir = dirname(file)
  const tmp = join(dir, `.${basename(file)}.${process.pid}.${randomHex(6)}.tmp`)
  const fh = await open(tmp, 'wx', 0o600)
  try {
    await fh.writeFile(JSON.stringify(value))
    await fh.sync()                              // fsync 文件内容
  } finally {
    await fh.close()
  }
  await copyFile(file, `${file}.bak`).catch(() => {})   // 保留上一份成功写入
  await rename(tmp, file)                        // 同目录 rename 才是原子的
  const dh = await open(dir, 'r')
  try { await dh.sync() } catch { /* Windows 不支持目录 fsync */ } finally { await dh.close() }
}
```

规则：tmp 文件必须在**同目录**（跨目录 rename 不是原子操作）；写前不删除旧文件；`.bak` 只保留一份，内容为"上一次成功写入"；损坏文件不覆盖，重命名为 `.<name>.corrupt-<ts>` 保留现场。

读取与恢复：

| 情况 | 检测 | 处理 | 用户可见 |
|---|---|---|---|
| 主文件 JSON 解析失败 | `JSON.parse` 抛错 | 读 `.bak`；成功则回填并告警 | 无感 |
| 主文件与 `.bak` 都失败 | 两者都抛错 | 两份重命名为 `.corrupt-<ts>`，按"缺失"处理 | 存档丢失提示 + 保留现场路径 |
| 主文件 `schemaVersion` 更高 | `>` 当前支持 | **只读**，不写不迁移 | "数据来自更新版本的 Game Market"（`E_STORE_SCHEMA_NEWER`） |
| 主文件 `schemaVersion` 更低 | `<` 当前支持 | 跑迁移（§8.6.11） | 无感 |
| 主文件字段缺失/类型错 | schema 校验 | 逐字段回退默认值；无法回退的字段整体按损坏处理 | 部分丢失提示 |
| `installations` 有条目但 `packages/` 缺失 | 启动时扫描 | `compatibility.status = 'broken'` | My Games 显示"需要修复"，Play 禁用 |

> 待验证（Spike S-02）：`fsync` + 目录 `fsync` + `.bak` 的完整组合在 DSH 内是否可用；macOS 上目录 `fsync` 的行为；文件 `mode` 是否稳定。
> 当前实测：`~/.dsh/storages/` 下的文件权限并不统一（`git_graph/pr-cache.json` 为 `0600`，`token_stats/state.json` 为 `0644`），说明不能依赖既有惯例，必须显式 `mode: 0o600`。
> 验证方法：循环 5000 次原子写并在随机时刻 `kill -9`，重启后断言"要么旧值要么新值，不存在半写"；同时在两个 profile 下并发写同一文件。
> 降级方案：若 `fsync` 不可用，保留 tmp + rename（只丢最近一次写入，不产生半文件），并在诊断日志记录一次告警。

#### 8.6.9 写入串行化与并发锁

三层串行：

1. **进程内**：按文件路径建立 promise 链，同一路径的写入严格排队；不同路径可并行（`saves/*` 之间互不阻塞）。
2. **跨进程**：因为多个 profile 共享 `storages/`（§8.6.1），`installations.json`、`registry-cache.json` 这类全局文件的写入必须加锁。锁文件 `<file>.lock`，内容 `{ pid, startedAt, host }`；`open(lock, 'wx')` 失败则重试 3 次（间隔 50/150/400 ms）；锁超过 10 秒视为陈旧，读取其 pid 判断进程是否存活后强制接管。
3. **跨游戏**：安装/卸载改变全局索引，V1 串行执行（同时只有 1 个安装 job），避免"两个安装同时重写 `installations.json`"。

约束：锁只在**写**期间持有，读不加锁；任何持锁路径不得包含网络请求（下载期间不持有全局锁）。

#### 8.6.10 配额与超限行为

| 对象 | 上限 | 超限行为 | 错误码 |
|---|---|---|---|
| 单游戏存档总量 | 1 MiB（1,048,576 B，含信封；≤32 key、单值 ≤256 KiB） | 拒绝写入，**保留旧存档**，通知游戏 | `E_SAVE_TOO_LARGE` |
| Session Record | 100 条 / 游戏 | 按 `startedAt` 淘汰最旧 | — |
| Score history | 200 条 / 游戏 | 淘汰最旧；`best` 不淘汰 | — |
| `registry-cache.json` | 2 MiB / 500 条 | 截断到 500 条并置 `truncated: true` | — |
| `preview-cache/` | 单张 ≤2 MiB；合计 ≤128 MiB | 淘汰最旧版本/条目 | — |
| 单游戏磁盘占用 | 单文件 ≤20 MiB × 2 版本（当前 + 1 个回滚版本，合计 ≤40 MiB） | 删除更旧的版本目录 | — |
| 全部游戏占用 | 无硬上限 | 超过 2 GiB 时 Market 顶部提示"清理旧版本" | — |
| 日志 | 1 MiB × 3 | 轮转 | — |

"1 MiB 拒绝写入"必须显式反馈给游戏，不允许截断后当成功——截断的存档比没有存档更糟。

#### 8.6.11 数据隔离、schemaVersion 与迁移

**路径隔离**：任何以 `gameId` 拼路径的地方，都必须先通过 `assertGameId()`：

```ts
const GAME_ID = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/   // 与 §8.2.4 完全一致；另需拒绝连续 `--`

function resolveGameDir(root: string, gameId: string): string {
  if (!GAME_ID.test(gameId) || gameId.length > 48) throw new Error('E_STORE_BAD_GAME_ID')
  const dir = resolve(root, 'saves', gameId)
  if (relative(root, dir).startsWith('..')) throw new Error('E_STORE_PATH_ESCAPE')
  return dir
}
```

要点：**每次读写都校验**，不只安装时；不使用游戏提供的任何原始字符串拼路径（SDK 层不暴露路径概念）；`packages/<id>/<version>/` 的 `version` 同样按 semver 正则校验，不允许直接把 Registry 里的 `version` 字符串拼进路径。`E_STORE_BAD_GAME_ID` / `E_STORE_PATH_ESCAPE` 是内部错误，对外只暴露为 `E_STORE_IO`，不泄露路径细节。

**schemaVersion 分层**：`schemaVersion` 是**平台文件格式**版本，`saveSchemaVersion` 是**游戏存档**版本，两者独立演进。平台永远不解析 `data`，因此也不可能替游戏迁移存档；平台只负责"拒绝让降级游戏读到更新版本的存档"（§8.11.6）。

**迁移策略**：

| 规则 | 内容 |
|---|---|
| 迁移单元 | 每个文件类型一对 `migrate_N_to_N+1` 函数，纯函数、输入输出都是对象 |
| 执行时机 | 首次读取该文件时懒迁移，不在启动时全量扫描 |
| 备份 | 迁移前先写 `<file>.v<old>.bak`，成功后保留；失败则保留原文件并进入只读 |
| 幂等 | 重复执行结果一致；迁移函数不得依赖当前时间以外的外部状态 |
| 方向 | 只支持向前；遇到更高版本一律只读（`E_STORE_SCHEMA_NEWER`） |
| 测试 | 每个迁移函数必须配一份真实旧版样本文件（`fixtures/v1/…`）做快照测试 |

#### 8.6.12 绝不能写进 Session Log 的数据

F-07 明确禁止第三方 append 新类型 Session Event，且 Session Log 会进入模型上下文与审计。以下数据**一律不写入**：

- 存档内容（`data`）、分数明细、Session Record 全文
- Agent 状态快照、`waiting-user` 的 prompt/选项内容
- Registry 原始响应、GitHub token、下载 URL 里的签名参数
- 任何绝对路径（`$DSH_HOME` 之后的路径也不写，只写相对路径）
- 安装/下载日志与错误堆栈
- 用户偏好（游戏排序、筛选条件）
- 游戏提交的任何自由文本（防止 prompt injection 经日志进入模型上下文）

允许出现在 Session Log 的只有 DSH 自身的会话事实；Game Market 的状态全部在自己的存储里，通过 §8.5 的 Host 路由读取。

#### 8.6.13 卸载时的数据保留

默认**保留** `saves/`、`scores/`、`sessions/`，只删除 `packages/<id>/` 与 `installations.json` 条目。

| 操作 | 删除 | 保留 |
|---|---|---|
| 卸载（默认） | package 目录、安装记录、`preferences.lastPlayedGameId` 若指向它 | 存档、成绩、会话记录 |
| 卸载 + "同时删除数据" | 上述 + `saves/<id>/`（含 `.bak`）、`scores/<id>.json` + `.bak`、`sessions/<id>.json` + `.bak`、预览缓存；删除先于包移除执行 | 无（失败则整体可重试，不报告完全删除） |
| 重装同 id | 覆盖 package | 自动继承全部历史数据 |

"同时删除数据"必须是**二次确认**，且确认框内明确列出将被删除的内容与不可恢复性（文案归属 §9.5）：

```text
卸载 Block Drop 并删除数据？
将永久删除：1 个存档（18 KB）、17 次游玩记录、最高分 8,240。
此操作不可撤销。
[仅卸载]  [卸载并删除]
```

理由（这是产品决策，不是实现细节）：

1. 等待场景里用户试新游戏的频率高，**"卸载即清空"会让用户不敢试**，与"持续积累"的产品承诺冲突。
2. 误删存档的代价远高于多占几百 KB；1 MiB × 若干游戏的存储成本可忽略。
3. 保留数据让"卸载 → 重装 → 继续上一局"成立，这也让更新失败时的回滚更安全。

> 待验证（Spike S-05）：用户对"默认保留"的预期是否符合直觉，二次确认的措辞是否能让人准确理解"删除数据"的后果。

#### 8.6.14 三种异常下的一致性保证

| 场景 | 具体保证 | 机制 |
|---|---|---|
| DSH 正常重启 | 已返回的写入必定持久；最多丢失最后一次未开始写的自动保存（≤30s 游戏进度） | 原子写 + `fsync`；离开游戏前强制保存 |
| 宿主崩溃 / 断电 | 不产生半写 JSON；`current.json` 要么旧值要么新值 | tmp + rename + `.bak`；`staging/`、`trash/` 启动时清理 |
| 插件停用 | 不丢已落盘数据；不再接受新写入；游戏页面被卸载 | 写队列 flush 后置为只读；所有路由随 `ctx.effect` 清理 |

补充规则：

- **未闭合 Session**：启动时把所有 `outcome === 'running'` 的记录改为 `'crashed'`，`endedAt` 取 `startedAt + durationMs`（最后一次 heartbeat），不猜测真实结束时间。
- **进行中的安装 job**：`staging/<jobId>` 若存在，启动时一律删除（V1 不支持断点续传，没有恢复价值）。
- **插件停用**：Client 侧 `fetch('api/...')` 会返回 404，UI 必须显示"Game Market 已停用"而不是无限 loading；已进入游戏的 iframe 随 `main` 面板卸载，重启用时按"重新加载 + 恢复存档"处理（F-05 已证明 DOM 状态不保留）。

### 8.7 安装 / 更新 / 卸载

#### 8.7.1 依赖边界（先于流程）

Host 半禁止 import `@deepseek-ai/*` 与任何第三方 npm 包（F-02），这条约束直接决定了安装器的实现形态：

| 需要的能力 | 允许的实现 | 禁止 |
|---|---|---|
| HTTP 下载 | 全局 `fetch` + `AbortSignal.timeout()` | `axios`、`got`、`node-fetch` |
| SHA-256 | `node:crypto` 的 `createHash` | 第三方哈希库 |
| 文件系统 | `node:fs/promises` | 任何封装库 |
| HTML 内嵌 manifest 定位与自包含静态检查 | 自有字符串/正则扫描（约百行，不引入解析库） | 第三方 HTML/DOM 库 |
| 进度事件 | 自有回调 / Host 事件 | 第三方事件总线 |

因此 V1 的安装器只需要 `fetch` + `crypto` + `fs` 三个内置能力：下载字节流、算 sha256、写一个文件；**没有解压步骤**，也没有 zip/归档解析模块。

> 原 S-04（自研最小 zip 读取器）在 V1 **不需要**：单文件包没有归档与解压。该 Spike 保留为 V1.5 多文件资源方案的评估项（见 12.2）。

#### 8.7.2 安装流程

```text
Registry 解析 → URL 准入 → 下载 .part（边下边算 sha256）→ 落位 → SHA-256 校验
      → HTML 解析 / 内嵌 manifest 校验 / 自包含校验 → 兼容性检查
      → 原子落位 packages/<id>/<version>/entry.html → 更新 installations → 清理
```

| 步骤 | 行为 | 限制 / 超时 | 失败码 |
|---|---|---|---|
| 1 Registry 解析 | 从缓存或 Registry 取条目；校验 `id`/`version`/`sha256`/`package.url`/`size` | 缓存 TTL 6h（§8.8）；`size ≤20 MiB` | `E_REGISTRY_UNAVAILABLE` / `E_NOT_IN_REGISTRY` |
| 2 URL 准入 | `https`（本地 file Registry 允许 Registry 目录内相对路径）+ host 在 allowlist 或与 Registry 同 host；重定向 ≤5 且不得降级为 http | 只允许 Registry 声明的 URL（§8.8.2） | `E_INSTALL_URL_REJECTED` |
| 3 下载 | 流式写入 `staging/<jobId>/package.html.part`，边下边算 sha256 | 连接 10s / 整体 120s / 无数据 20s；≤20 MiB | `E_INSTALL_DOWNLOAD_FAILED` |
| 4 重试 | 仅对网络错误、5xx、429 重试 2 次（退避 1s、3s） | **不做断点续传**，每次从头 | 同上 |
| 5 落位 | rename `.part` → `package.html` | 同目录 | `E_INSTALL_IO` |
| 6 SHA-256 校验 | 与 Registry 的 `sha256` 逐字比较（本地安装无此步） | 不一致立即删除临时文件 | `E_INSTALL_HASH_MISMATCH` |
| 7 HTML/manifest 校验 | 执行 §8.2.7 中「安装」列的全部检查：HTML 可解析、内嵌 manifest 唯一且 ≤64 KiB、字段/自包含 | 与 CLI 同一规则表 | `E_PKG_*` |
| 8 兼容性检查 | `runtimeVersion`/`sdkVersion` 范围满足性 + capabilities 是否为当前 Runtime 的子集 | §8.11 | `E_COMPAT_*` |
| 9 原子落位 | 确保 `packages/<id>/<version>/` 存在，写入 `entry.html`（临时文件 + rename） | 目标已存在且 sha256 相同视为已装（幂等），不同则 `E_INSTALL_VERSION_CONFLICT` | `E_INSTALL_IO` |
| 10 更新索引 | 单次原子写 `installations.json`（含 previousVersion 计算） | 持跨进程锁 | `E_STORE_IO` |
| 11 清理 | 删除 `staging/<jobId>/`；按 §8.7.6 清理旧版本 | `finally` 必执行 | — |

**路径安全（不依赖包内容）：** 目标目录 `packages/<id>/<version>/` 完全由 manifest 中通过正则校验的 `id`/`version` 构造，**不接受包内路径**；写入文件名固定为 `entry.html`，不接受任何来自包的路径或文件名。`staging/<jobId>/` 的 jobId 由 Host 生成，不来自用户输入。

**不再有安全解压、zip slip、压缩炸弹步骤**：V1 不解析归档、不写多文件，安装器只处理一个字节流和一个目标文件；单文件大小上限（20 MiB）与流式计数即为资源防护。

#### 8.7.3 安装状态机与用户可见进度

```text
queued ──► downloading ──► verifying ──► installing ──► installed
   │            │              │              │
   └────────────┴──────────────┴──────────────┴──► failed
              （canceled 仅在 installing 之前可达）
```

| 状态 | 进入条件 | 用户可见 | 可取消 | 超时 |
|---|---|---|---|---|
| `queued` | 已入队等锁 | "准备中" | 是 | 10s（等锁） |
| `downloading` | 开始收字节 | 百分比 + 已下载 MB/总 MB | 是 | 120s |
| `verifying` | 下载完成 | "校验文件…"（不确定进度） | 是 | 15s |
| `installing` | 校验通过 | "正在安装…"（不确定进度） | **否**（≤500ms） | 30s |
| `installed` | 索引写入成功 | "已安装" + 立即出现 Play | — | — |
| `failed` | 任一步失败 | 错误码对应文案 + "重试" | — | — |

进度只暴露百分比与阶段名，**不暴露 URL、路径、sha256**（避免把内部信息渲染到 UI，也避免用户误以为需要手动核对）。

#### 8.7.4 幂等、并发与残留

- **幂等**：同一 `gameId` 已存在进行中的 job 时，重复安装请求返回同一 `jobId` 与当前状态，不新建任务。
- **同一版本**：若已安装版本与目标版本相同且 `sha256` 相同 → 直接返回 `installed`（"已安装"），不重写磁盘。
- **不同版本**：交由 §8.7.5 更新流程处理，同一时刻只允许一个安装/更新 job（V1 串行）。
- **失败回滚**：步骤 9 已落位但步骤 10 失败 → 把 `packages/<id>/<version>` 移入 `trash/`；`installations.json` 因原子写不会出现半更新，因此"索引"与"磁盘"最多短暂不一致，启动扫描可修复（§8.6.8）。
- **残留清理**：启动时删除 `staging/` 下全部内容；`trash/` 下超过 7 天的目录；`packages/<id>/` 下不在 `installations` 中且不是 `previousVersion` 的目录。

#### 8.7.5 更新流程

```text
检查新版本 → 版本比较 → 兼容性 → 运行中检查 → 下载并安装新版本
   → 写入 previousVersion → 保留旧目录 → 存档兼容提示
```

| 规则 | 内容 |
|---|---|
| 触发 | 打开 Market 首页、进入 My Games 时各检查一次；最小间隔 10 分钟；不后台轮询（§8.8.6） |
| 版本比较 | 仅当 Registry 版本 **semver 大于** 已装版本才算"可更新"；同版本不同 sha256 视为"已重新发布"，提示"重新安装"而非"更新" |
| 兼容性 | 新版本必须先通过 §8.11 检查；不通过则按钮置灰并说明原因，**不自动升级** |
| 游戏运行中 | **禁止更新**（`E_UPDATE_GAME_RUNNING`）；按钮置灰，文案"退出游戏后可更新" |
| 旧版本保留 | 安装成功后把当前版本记入 `previousVersion`，保留 `packages/<id>/<old>/` 1 份 |
| 存档兼容 | 新 manifest 的 `save.schemaVersion` 若高于当前存档，UI 提示"更新后存档将升级，旧版本可能无法读取"，需用户确认后才继续 |
| 失败 | 保持旧版本可玩；`installations` 不变；临时目录清理 |

#### 8.7.6 磁盘占用与清理

- 每个游戏保留 `current + 1 previous`，最多 2 个版本目录；安装第 3 个版本时删除 `previousVersion` 对应的目录。
- 删除只走 `rename` 到 `trash/<id>-<ts>/`，7 天后或下次启动真实删除，提供 7 天恢复窗口。
- My Games 展示每款游戏的 `sizeBytes` 与总占用；总占用 > 2 GiB 时提示清理（§8.6.10）。
- 永不自动删除存档与成绩来"腾空间"——只能由用户显式操作。

#### 8.7.7 离线安装与开发模式

| 模式 | 入口 | 校验 | 落位 | 标记 |
|---|---|---|---|---|
| Registry 安装 | Market 详情页 Install | 全部（含 sha256） | `packages/<id>/<version>/entry.html` | `source: 'registry'` |
| 本地文件安装 | 选择本地 `.html` 文件（拖入可选），raw bytes `POST /install-local` | 单文件大小 ≤20 MiB；HTML/内嵌 manifest/自包含校验；**无 sha256 可校验** | `packages/<id>/<version>/entry.html` | `source: 'local'` |
| 开发模式 | 配置 `devGameRoots: string[]` | 只校验 manifest 结构与兼容性 | **不复制**，直接指向绝对路径 | `source: 'dev'` |

边界条件必须显式：

- 本地文件安装**必须二次确认**，文案明确"本地安装包未经验证，请只安装你信任的来源"；确认后才读取文件并 raw bytes 上传（`POST /install-local`，`text/html`，≤20 MiB）；不显示作者认证徽章。
- 本地安装不得覆盖 Registry 已安装的同 id 版本而不提示；覆盖时同样二次确认。
- 开发模式默认关闭，需在 profile patch 显式配置；`devGameRoots` 变更后需要重新扫描；开发游戏不参与更新检查、不上架、卸载只移除记录不删目录。开发模式是本机开发开关，**不属于面向最终用户的能力**。

#### 8.7.8 卸载流程

```text
确认 → （可选）勾选"同时删除数据" → 若运行中先停止游戏
     → 从 installations 移除条目 → package 目录移入 trash
     → （可选）删除 saves/scores/sessions → 清理完成
```

| 步骤 | 规则 |
|---|---|
| 确认 | 必弹确认；若存在存档，确认框必须展示"将保留 1 个存档与最高分"，并给出"同时删除数据"选项（默认不勾） |
| 内置游戏 | `source: 'builtin'` 的游戏（如 `snake`）**不可卸载**，也不提供"删除数据"；Host 拒绝并返回 403 `E_UNINSTALL_BUILTIN` |
| 运行中 | 先执行 Pause + 强制 Save，等待写入完成（≤2s 超时）后再卸载；超时则提示"游戏未能保存，是否继续" |
| 顺序 | **先更新索引，再动磁盘**；磁盘删除失败不影响"已卸载"状态，残留由启动清理处理 |
| 已卸载但数据保留 | `saves/<id>/` 等目录独立存在，不影响任何逻辑；重装后自动继承 |
| 清除数据 | 二次确认（§8.6.13），删除时走 `trash/` 延迟删除，7 天内可通过"恢复"找回 |

#### 8.7.9 错误码与用户提示

| 错误码 | 用户可见文案（zh） | 可重试 |
|---|---|---|
| `E_REGISTRY_UNAVAILABLE` | 无法连接游戏市场，请检查网络后重试 | 是 |
| `E_NOT_IN_REGISTRY` | 这款游戏已从市场下架 | 否 |
| `E_INSTALL_URL_REJECTED` | 下载地址不被信任，已阻止 | 否 |
| `E_INSTALL_DOWNLOAD_FAILED` | 下载失败，请稍后重试 | 是 |
| `E_INSTALL_DOWNLOAD_TIMEOUT` | 下载超时，请检查网络 | 是 |
| `E_PKG_TOO_LARGE` | 安装包超过 20 MiB，无法安装 | 否 |
| `E_INSTALL_HASH_MISMATCH` | 文件校验失败，安装包可能已损坏 | 是 |
| `E_INSTALL_VERSION_MISMATCH` | 安装包版本与市场记录不一致，请重试 | 是 |
| `E_PKG_HTML_INVALID` / `E_PKG_MANIFEST_MISSING` / `E_PKG_MANIFEST_DUPLICATE` | 安装包不是有效的游戏文件 | 否 |
| `E_PKG_ENTRY_NOT_SELF_CONTAINED` | 安装包引用了外部资源或网络，已阻止 | 否 |
| `E_COMPAT_RUNTIME` / `E_COMPAT_SDK` | 该游戏需要更新的 Game Market（或更旧的 Runtime） | 否 |
| `E_INSTALL_VERSION_CONFLICT` | 已安装其他版本，请先卸载或使用回滚 | 否 |
| `E_INSTALL_DISK_FULL` | 磁盘空间不足，需要 {n} MB | 是 |
| `E_UPDATE_GAME_RUNNING` | 游戏正在运行，退出后即可更新 | 是 |
| `E_UNINSTALL_BUSY` | 有安装任务正在进行，请稍后 | 是 |
| `E_UNINSTALL_BUILTIN` | 内置游戏不可卸载 | 否 |
| `E_INSTALL_CORRUPT` | 游戏文件不完整，请重新安装 | 是 |
| `E_INSTALL_IO` | 安装过程写入失败，请重试 | 是 |
| `E_STORE_READONLY` / `E_STORE_IO` | 无法保存数据（存储不可写） | 是 |
| `E_MARKET_DISABLED` | Game Market 已停用 | 否 |

> 错误码约定同 §8.2.7：`E_*` 为内部常量，对外统一返回 `GM-*`，映射见 §8.13。

错误对象对外只暴露 `{ code, message, retryable }`：不包含绝对路径、URL、堆栈、sha256。

#### 8.7.10 安全要求

安装阶段的安全红线，全部可测：

1. **绝不执行游戏代码**：不 `require`/`import` 包内任何文件，不启动子进程，不 `eval`；只做字符串级的 manifest 定位与自包含静态检查，不做 DOM 渲染或脚本执行。
2. **绝不执行安装脚本**：不跑 `npm/pnpm install`、不跑 `prepare`/`postinstall`/`preinstall`、不识别 `package.json`（包里就算有也当普通文件）。
3. **不跟随符号链接**：单文件包没有解压；写入 `entry.html` 前如目标已存在符号链接一律拒绝，后续静态服务也不允许 symlink 逃逸。
4. **不接受任意路径**：入口服务只按 `gameId + version` 读取固定文件名 `entry.html`，`realpath` 后必须仍在 `packages/<id>/<version>/` 内（与 §8.6.11 同一套断言）；`/install-local` 由 Host 从 manifest 取 id/version 构造目标路径，不接受请求里的路径。
5. **不信任文件名与扩展名**：入口固定为 `text/html; charset=utf-8`；preview 素材只按缓存清单中的 png/webp/jpeg 扩展名返回 `image/*`，其它一律 `application/octet-stream` + `X-Content-Type-Options: nosniff`。
6. **不在安装期联网**（除下载本身）：不上报、不检查更新、不拉取远程图标。
7. **权限位**：文件 `0644`、目录 `0755`，显式去除 setuid/setgid；不继承任何外部权限位。
8. **失败不留残留**：任何失败路径都必须进入 `failed` 并清理 `staging/`。

### 8.8 Registry 与 Market 数据源

#### 8.8.1 V1 静态 Registry Schema

V1 是**一份静态 JSON + GitHub Releases 静态包**（D-013），没有服务端。

```ts
interface RegistryFile {
  registryVersion: 1
  generatedAt: string                  // ISO 8601
  games: RegistryGame[]                // ≤ 500 条
}

interface RegistryGame {
  id: string
  name: string
  version: string                      // 最新正式版
  description: string
  author: { name: string; url?: string }
  categories: string[]
  tags?: string[]
  capabilities: string[]
  sdkVersion: string
  runtimeVersion: string
  package: {
    url: string                        // 包文件绝对 https URL；本地 file Registry 为目录内相对路径
    sha256: string                     // 64 位小写 hex
    size: number                       // 字节
    releasedAt: string
  }
  icon?: string                        // 绝对 https URL（Host 缓存到 preview-cache）
  cover?: string                       // 绝对 https URL；上架必填
  screenshots?: string[]
  homepage?: string
  repository?: string
  license?: string
  changelog?: string                   // 纯文本，≤ 2000 字符
  featured?: boolean                   // 人工挑选，用于首页 Popular
  quickPlay?: boolean                  // 人工标记，用于 Quick Play
  publishedAt: string
  updatedAt: string
}
```

示例（两条，含 `featured` / `quickPlay` 两种首页来源）：

```json
{
  "registryVersion": 1,
  "generatedAt": "2026-10-18T00:00:00Z",
  "games": [
    {
      "id": "block-drop",
      "name": "Block Drop",
      "version": "1.2.0",
      "description": "把下落的方块叠成完整横行，适合几十秒到几分钟的等待。",
      "author": { "name": "Orange", "url": "https://github.com/orange" },
      "categories": ["puzzle", "arcade"],
      "tags": ["blocks", "keyboard"],
      "capabilities": ["storage", "score"],
      "sdkVersion": "^1.0.0",
      "runtimeVersion": "^1.0.0",
      "package": {
        "url": "https://github.com/example/dsh-game-block-drop/releases/download/v1.2.0/block-drop-1.2.0.html",
        "sha256": "3f9c1a…",
        "size": 4821339,
        "releasedAt": "2026-10-17T10:40:00Z"
      },
      "icon": "https://raw.githubusercontent.com/example/dsh-game-block-drop/v1.2.0/assets/icon.png",
      "cover": "https://github.com/example/dsh-game-block-drop/raw/v1.2.0/assets/cover.webp",
      "screenshots": ["https://github.com/example/dsh-game-block-drop/raw/v1.2.0/assets/shot-1.webp"],
      "license": "MIT",
      "changelog": "修复撤销后分数不回滚；新增键盘 P 暂停。",
      "featured": true,
      "quickPlay": true,
      "publishedAt": "2026-09-30T00:00:00Z",
      "updatedAt": "2026-10-17T10:40:00Z"
    },
    {
      "id": "snake",
      "name": "Snake",
      "version": "1.0.4",
      "description": "经典贪吃蛇。",
      "author": { "name": "Orange" },
      "categories": ["arcade"],
      "capabilities": ["storage", "score"],
      "sdkVersion": "^1.0.0",
      "runtimeVersion": "^1.0.0",
      "package": {
        "url": "https://github.com/example/dsh-game-snake/releases/download/v1.0.4/snake-1.0.4.html",
        "sha256": "9ab7…",
        "size": 921004,
        "releasedAt": "2026-10-10T09:00:00Z"
      },
      "cover": "https://github.com/example/dsh-game-snake/raw/v1.0.4/assets/cover.webp",
      "quickPlay": true,
      "publishedAt": "2026-09-12T00:00:00Z",
      "updatedAt": "2026-10-10T09:00:00Z"
    }
  ]
}
```

上限与校验：单文件 ≤ 2 MiB；`package.size` 必须为正整数且 ≤20 MiB；超过 500 条时截断到 500 并置 `truncated: true`，Market 显示"仅展示前 500 款"。`id` 重复、`version` 非法、`sha256` 非 64 位 hex、`package.size` 越界、`package.url` 不匹配规则 → 整份 Registry 视为无效并回退到缓存（不做"跳过坏条目"的宽容解析，否则坏一条会让排序与索引不稳定）。

#### 8.8.2 托管方式与 URL 规则

```text
dsh-game-market (repo)
├── registry/
│   └── games.json                     # 纯文本索引，PR 即上架（registryVersion: 1）
└── packages/                          # 无：包不放主仓库；官方托管建议放 GitHub Releases

每个游戏自己的仓库
└── Releases
    └── v<version>/
        └── <id>-<version>.html
```

- Registry 索引：`https://raw.githubusercontent.com/<owner>/dsh-game-market/main/registry/games.json`（任意 https 静态地址均可）。**V1 默认分发为随包 file Registry**：`registry/games.json` + `registry/packages/<id>-<version>.html`（由 `scripts/build-registry.mjs` 从四款游戏构建确定性生成），全新环境无需网络即可发现/安装 Jump、2048、Breakout；远程 https 索引为可选项。
- 包下载 URL 规则：
  1. 必须是 `https`；本地 file Registry 例外，允许 Registry 目录内的相对路径。
  2. host 必须属于 allowlist，**或与 Registry 索引同 host**（自建镜像/内网分发）。
  3. URL 路径末段必须是 `<id>-<version>.html`（允许末尾带不改变文件名的 query，如缓存参数）。
  4. 重定向 ≤5 次，且任何一跳都不得把 https 降级为 http。
  5. 禁止 `data:`、`blob:`；`file:` 仅限本地 file Registry 场景。
- 默认 allowlist：`github.com`、`raw.githubusercontent.com`、`objects.githubusercontent.com`。配置 `allowedHosts: string[]` 可追加自建/测试 host（仍要求 https）；allowlist 只影响下载准入，不改变校验与审核要求。
- **不再要求 URL 形如 `/releases/download/`**：官方托管仍建议 GitHub Releases，但任何满足上述规则的 https 静态地址都可用。
- 封面/截图（Registry 字段，不属于包）：允许 `https://` 外链，不允许 `http://`、`data:`、`file:`。**V1 Client 不直接加载外链图片**：Host 在 Registry 刷新时按 allowlist 下载 `icon/cover/screenshots` 到本地 `preview-cache/<gameId>/<version>/`（单张 ≤2 MiB，校验 content-type 与图片格式，失败则跳过并记录），Market UI 只从同源 `/preview` 路由加载；下载失败的条目使用 manifest 的 icon data URI 或首字母/纯色占位。
- 本地 file Registry（开发/内网）：`package.url` 使用 Registry 目录内的相对路径；Host 解析 `realpath` 后必须仍在 Registry 目录内，越出即拒绝（`E_INSTALL_URL_REJECTED`）。

> 待验证（Spike S-03）：桌面应用进程内 `fetch` 到 GitHub 的可达性、TLS、302 跳转、速率限制与代理环境。
> 验证方法：在 Host 侧发起真实请求，记录状态码、重定向链、耗时、`Content-Length` 是否存在；分别在直连与系统代理下各跑一次。
> 降级方案：若 Host 侧不可达，Registry 与包下载改为"用户手动下载 + 本地安装"（§8.7.7），文档给出明确路径；不内置镜像。

#### 8.8.3 拉取、校验、缓存与离线回退

| 环节 | 规则 |
|---|---|
| 触发 | 打开 Market 首页、进入 My Games、用户点"检查更新" |
| 请求 | `GET` registry URL，10s 超时，`If-None-Match`（ETag）与 `If-Modified-Since` |
| 304 | 不重写文件，只更新 `fetchedAt` |
| 200 | 全量校验 → 原子写 `registry-cache.json` |
| 失败 | 使用缓存并标注"离线/可能不是最新"；无缓存则只显示已安装游戏 + 顶部提示 |
| TTL | 6 小时；未过期不发请求，除非用户手动检查 |
| 陈旧上限 | 缓存最多使用 14 天，之后即使请求失败也提示"市场数据过期" |
| 并发 | 同时只有一个拉取请求，其余等待同一 promise |

```ts
interface RegistryCacheFile {
  schemaVersion: 1
  fetchedAt: string
  sourceUrl: string
  etag: string | null
  lastModified: string | null
  truncated: boolean
  games: RegistryGame[]
}
```

```json
{
  "schemaVersion": 1,
  "fetchedAt": "2026-10-18T08:12:31.402Z",
  "sourceUrl": "https://raw.githubusercontent.com/example/dsh-game-market/main/registry/games.json",
  "etag": "W/\"1a2b3c\"",
  "lastModified": null,
  "truncated": false,
  "games": [{ "id": "block-drop", "version": "1.2.0", "name": "Block Drop" }]
}
```

（示例中 `sha256` 与 `games` 条目为省略写法，真实文件必须是完整 64 位 hex 与完整条目。）

#### 8.8.4 Market 列表 = Registry + 本地安装合并

合并发生在 Host，Client 只拿合并后的结果（接口见 §8.5）。规则必须确定，不能"看情况"：

| 字段 | 已安装游戏 | 未安装游戏 | 冲突胜者 |
|---|---|---|---|
| 是否安装 / 已装版本 | `installations` | 无 | installations |
| 名称 / 简介 | **已安装包的内嵌 manifest** | Registry | 已安装侧优先 |
| 图标 / 封面 / 截图 | 包内 manifest 的 `icon`（data URI）+ Registry 缓存素材 | Registry | 已安装侧优先，缺失时用 Registry 缓存 |
| 最新版本 / 是否有更新 | Registry + 版本比较 | Registry | 计算得出 |
| 能力 / 评分范围 | 已安装包的内嵌 manifest | Registry | 已安装侧优先 |
| 最近游玩 / 游玩次数 / 最高分 | 本地数据 | 无 | installations |
| 排序权重（featured/quickPlay） | Registry | Registry | Registry |
| 存档状态（可否 Continue） | 本地 `save/meta.json` | 无 | installations |

补充规则：

- **已安装但 Registry 中不存在** → 仍然显示（`source: 'local'` 或 `'builtin'`），若曾来自 Registry 则标"已下架"，不隐藏、不禁用。
- **Registry 有但本地没有** → 显示"安装"。
- **同 id 不同版本** → 卡片显示已装版本，详情页显示"已安装 1.1.3 / 最新 1.2.0"。
- **`id` 相同但 `name` 不同**（作者改名）→ 以已安装包为准，避免用户看到"装完变了"。

#### 8.8.5 V2 切换在线 Registry 时接口不变

Host 内部只暴露两个语义接口，Client 不感知数据来源：

```ts
registry.list(): Promise<MarketGame[]>           // 已合并本地状态
registry.checkUpdates(ids?: string[]): Promise<UpdateInfo[]>
```

V2 换成在线 API 时，改变的是这两个函数的实现（分页、鉴权、增量），**返回类型、Client 调用方式、渲染逻辑均不变**。为此 V1 就必须做到：列表结果是"完整可渲染对象"而不是"Registry 原始条目"；分页字段预留但不暴露给 Client（V1 恒为 `hasMore: false`）。

#### 8.8.6 更新检查时机

只在两个时机检查，且**不做后台轮询**：

1. 打开 Market 首页（`market.open`）。
2. 进入 My Games（`market.mygames`）。

约束：最小间隔 10 分钟（`preferences.lastUpdateCheckAt`）；同一时刻只有一个检查请求；检查结果是 `installations.update` 的字段更新，不产生通知、不打断游戏。用户可在 My Games 手动点"检查更新"跳过间隔限制。

> 明确不做：定时器轮询、启动时全量检查、游戏运行中检查（会与"不打断"原则冲突）。

#### 8.8.7 开发 Registry 覆盖

优先级从高到低：

1. 环境变量 `DSH_GAME_REGISTRY_URL`（绝对 http(s) URL 或绝对文件路径）。
2. profile patch 的 `config.registry.url`，可配 `config.registry.allowLocalFile: true` 才允许 `file://` 或绝对路径。
3. 默认 URL（§8.8.2）。

规则：本地文件来源必须在 UI 上永久标注"开发 Registry"（避免误以为看到的是线上市场）；`registry-cache.json` 的 key 包含 `sourceUrl`，切换来源不命中旧缓存；开发 Registry 的包仍必须通过 §8.2 校验与 §8.11 兼容检查。

#### 8.8.8 V1 明确不做

| 不做 | 原因 | V1 的替代 |
|---|---|---|
| 服务端搜索 | 500 条以内本地过滤足够 | Client 侧 `name`/`description`/`tags` 子串匹配（不区分大小写） |
| 评分与评论 | 需要账号与服务端审核 | 不显示评分；排序用 `featured` + 本地游玩数据 |
| 下载量/热度 | 无服务端统计，造假成本低 | "Popular" = `featured` 人工挑选 + 本地 `playCount` |
| 分页 / 增量更新 | 单文件 ≤ 2 MiB | 全量拉取 + ETag |
| 服务端排行榜 | §7.4 明确不做 | 本地 Personal Best 与历史成绩 |
| 包签名 | V1 只做 SHA-256 | `sha256` + 人工审核（PR） |
| CDN / 镜像 | 引入额外信任面 | GitHub Releases |

### 8.9 Agent 状态桥接规范

**职责。** Host 维护“每个 DSH Session 一个权威快照”，把 DSH 的 Turn/Step/Tool/审批/提问事件压缩为游戏需要的五个状态；Client 只读快照，不自己推导；游戏只通过 SDK 读。Adapter 是唯一允许理解 DSH 事件名的地方，游戏侧永远看不到 `turn/end` 之类的词。

#### 类型

```ts
export type GameAgentPhase = 'idle' | 'running' | 'waiting-user' | 'completed' | 'error';
export type GameAgentSource = 'turn' | 'tool' | 'approval' | 'question' | 'lifecycle' | 'restore';

export interface GameAgentState {
  state: GameAgentPhase;
  label: string;            // Host 已按 locale 生成，游戏禁止解析
  sessionId: string | null; // 绑定的 DSH Session；未绑定为 null
  updatedAt: string;        // 本次字段变化时间（ISO 8601）
  source: GameAgentSource;  // 诊断用，游戏不得依赖其取值做玩法
  seq: number;              // 每 Session 单调递增，用于去重/ETag
  since: string;            // 当前 state 开始时间；同 state 内不变
  turnId?: string | null;    // 当前/最近 turn 的稳定 id；idle 时为 null，用于按 turn 忽略入口
}
```

`label` 只来自固定模板（见下），**禁止**插值 prompt、消息、工具参数、文件路径、模型名、token 数。`source` 只用于诊断面板；未来可扩展枚举，游戏必须容忍未知值。

#### 事件/状态源映射

| DSH 信号（已核实存在） | 观测方式 | 条件 | 顶层状态 | `source` |
|---|---|---|---|---|
| `agent/created` | Host 事件 | 记录 `agent.id` ↔ `Session`，不改变状态 | — | — |
| `agent/pre-step` | Host waterfall，**只读观察，必须 `return next()`**，不得改写 decision | 当前不是 waiting-user | `running` | `turn` |
| `tool/result` | Session 持久事件 | 已有 running；只更新 label 类别 | `running`（不变） | `tool` |
| `assistant/message` | Session 持久事件 | 轮次仍在进行 | `running`（不变） | `turn` |
| `agent/assistant-stream` | Host 流事件 | 仅作为“仍在活动”的心跳，不读内容 | 不改变 | — |
| `turn/end`（正常） | Session 持久事件 | 无后续 follow-up step（250ms 稳定窗内） | `completed` | `turn` |
| `turn/end`（错误/取消） | 同上 | 读取结果字段；字段名 **待验证（Spike S-15）** | `error` | `turn` |
| `approval/asked` | Session 持久事件（log-only，已核实） | 审批未决 | `waiting-user` | `approval` |
| `approval/decided` | Session 持久事件 | 审批关闭 | `running` | `approval` |
| `tool/call`（工具名 `ask_user_question`） | Session 持久事件（log-only，已核实） | 工具调用未返回、等待用户回答 | `waiting-user` | `question` |
| `tool/result`（`waiting-user` 且 `source=question` 时） | Session 持久事件（payload 不携带工具名；关联字段：`message.source.callId`） | 与待回答调用匹配的结果到达；旧的/同轮其他工具结果不清除 | `running` | `question` |
| `agent/disposed` | Host 事件 | Agent 释放 | `idle` | `lifecycle` |
| Host 启动/launch | 持久快照 | 恢复终止态 | `restore` | `restore` |

**不要轮询 `agent/status`**（F-08）。也不通过读聊天 DOM、截屏、监听 `assistant/message` 文本来推断状态。

**观测约束。** `agent/pre-step` 是 waterfall，监听器必须返回 `next()`，否则会吞掉其它插件的行为；`agent/created` 监听器必须快速返回，**不得**在内部 `await agent.whenIdle()` 或等待自身 dispose（会死锁，已核实 README）。Session 事件订阅的具体入口以 `cordis_inspect_query` 的 `Event` 结果为准；不要自行 append 新类型 Session 事件（F-07）。

#### label 生成规则

固定模板，不做字符串拼接；`zh`/`en` 文案 key 见 9.8。

| 场景 | 条件 | `zh` 模板 | key |
|---|---|---|---|
| 工作中 | 默认 running | 正在工作… | `agent.state.running` |
| 运行测试 | 工具名精确/包含 `test` | 正在运行测试… | `agent.state.test` |
| 构建 | 工具名包含 `build` | 正在构建… | `agent.state.build` |
| 查资料 | `web_search`、`web_fetch` | 正在查找资料… | `agent.state.search` |
| 看文件 | `read`、`grep`、`glob`、`ls`、`view` | 正在查看文件… | `agent.state.read` |
| 改文件 | `write`、`edit`、`apply_patch`、`str_replace` | 正在修改文件… | `agent.state.write` |
| 执行命令 | `bash`、`shell`、`exec` | 正在执行命令… | `agent.state.command` |
| 其它工具 | 未命中以上 | 正在工作… | `agent.state.running` |
| 等待审批 | waiting-user + approval | 需要你确认一项操作 | `agent.state.waiting.approval` |
| 等待回答 | waiting-user + question | 需要你回答一个问题 | `agent.state.waiting.question` |
| 已完成 | completed | 任务完成啦 | `agent.state.completed` |
| 出错 | error | 遇到了一点问题 | `agent.state.error` |
| 空闲 | idle | Agent 空闲 | `agent.state.idle` |

**只按工具名归类，绝不读取或解析工具参数**：解析 bash 命令来判断“是否在跑测试”会把用户命令带进判断路径，既脆弱又触碰隐私红线。工具名不在白名单 → `agent.state.running`。工具名本身不写入快照。

#### waiting-user 检测

- **审批（主路径，已核实可行）。** 不直接监听 `ctx.approval`（它是决策面，返回值会影响审批结果），只读它写入的事件。`ctx.approval.request()` 会先追加 `approval/asked`、再追加 `approval/decided`，两者都是 log-only Session 事件（已核实 `dsh-user-approval` README）。Host 订阅这两个事件即可得到持久、可跨刷新恢复的等待态，不需要拦截别人的审批 waterfall，也不依赖 `ctx.approval` 的私有状态。
- **提问（已实现，2026-10-19）。** `AskUserQuestion` 在 Session 日志中表现为普通 `tool/call`（工具名 `ask_user_question`），未回答期间工具结果不出现；Host 在读到该 `tool/call` 时置 `waiting-user`（`labelKey=agent.state.waiting.question`，`source=question`），读到对应 `tool/result` 后回到 `running`。**2026-10-19 复验收口**：提问时记录该调用的 `callId`（`tool/result` 在 `message.source.callId`）与 turn；只有匹配的结果才关闭等待，同轮其他工具/旧 turn 的结果不清除；`turn/end` 关闭被取消/中止的提问；真实结果不带工具名，不按事件名或问题正文匹配。只匹配工具名/关联字段，不读参数内容。**该检测不依赖 `userQuestions` 投影，也不依赖 `agent.session` 句柄**，因此比原 Spike S-14 方案更稳。若未来工具名变化，增加白名单别名即可。降级方案（保留）：
  1. 只识别审批等待；提问期间保持 `running`，不显示等待入口。这是可接受的 V1 降级，不影响“不打断工作”。
  2. Client 侧补充：Conversation 可见时，注册 `conversation.composer` chain 的 `select` 观察 `pendingInteraction`（类型 `approval | plan-review | question`），写入模块级 store；进入游戏后只作为初始值。**该路径不能覆盖“进入游戏后新出现的提问”**，因为 Conversation 在游戏面板激活时已卸载（F-05），所以只能作补充。
- **优先级。** 同一时刻既有审批又有提问时，`waiting-user` 不变，label 取“等待审批”；不新增第二个状态。

#### 状态优先级与抖动抑制

优先级从高到低：`waiting-user` > `error` > `completed` > `running` > `idle`。优先级只用于**同一时刻**多个信号的冲突裁决；“新 turn 开始”“审批关闭”“用户 ack”“Agent dispose”是显式覆盖事件，不受优先级限制（例如 completed 之后的新 `agent/pre-step` 直接回到 running）。

- **顶层状态不随工具阶段变化。** `tool/result` 只更新 label，不改变 `running`；工具切换不产生新的状态迁移。
- **最短展示。** 任何 label 变化至少间隔 1500ms；后到的变化排队，合并为最后一次。状态迁移本身不受 1500ms 限制，但 `waiting-user`/`completed`/`error` 至少保持到下一次真实事件。
- **turn 间隙合并。** `turn/end` 后 250ms 稳定窗内若出现新的 `agent/pre-step`，视为同一连续工作，不闪 `completed`。
- **去重。** `(state, label)` 未变化时不发事件、不改 `updatedAt`、不递增 `seq`。`since` 只在 `state` 变化时更新。
- **抖动保护。** 同一状态 5s 内反复进出（>3 次）记 `agent-flapping`；仍按最后一次渲染，但不播完成动效。

#### completed 的确认与持久

- `completed` 一直保持，直到满足任一条件：① 用户点击“查看结果”，或通过返回按钮回到该 Session 的 Conversation；② 用户在处理完 waiting-user 后返回游戏并点击继续（视为已读）；③ 绑定的 Session 出现新的 `agent/pre-step`；④ 会话被删除/归档。
- 确认动作由 Client 调 `POST agent-ack`（带 `sessionId` 与 `seq`）；Host 校验 `seq` 后把状态置 `idle` 并持久化 `acknowledgedAt`，防止刷新后再次提醒。
- **不重复催促。** 同一 Session 的 completed 只发一次提醒气泡；之后小鲸鱼保持 completed 姿态，不再播动画、不再弹泡、不播声音。
- 持久化只保存终止态（`completed`/`error`/`waiting-user`）与 ack 时间；`running` 不落盘。最多保留 200 条、7 天，超出按最旧淘汰。

#### 多 Session（D-006）

- `POST launch` 时把 `instanceId → { gameId, dshSessionId, playSessionId }` 写入 Host 内存；该实例的 `GET agent-state` 只返回这个 `dsSessionId` 的快照。其它 Session 的事件仍进入内存映射，但**不推给这个游戏实例**，也不触发它的提醒。
- 绑定在一次游戏打开期间不变：用户切到别的 Conversation、别的 Session 开始工作，都不影响当前游戏。
- 未绑定（从 Market 直接进入且无活跃 Session）时返回 `idle` + `sessionId: null`；入口 chip 不显示，Agent Presence 保持安静。绑定成功后不得静默改绑；只能通过退出再进入重新绑定。
- **从侧栏/Market 直接进入、不经过 header chip 时如何确定“当前 DSH Session”待验证（Spike S-12）**：候选实现是读 Client `sessions` 服务的 retain/mainView 信息；降级为“最近一次 chip 捕获的 Session”，再降级为 `null`（不显示等待入口，不丢失游戏功能）。
- 绑定 Session 被删除/归档 → 状态 `idle`，诊断记 `session-gone`，不弹错误。

#### Host 内存态 vs 持久态

- 内存态是权威：`Map<sessionId, GameAgentState>` + `Map<instanceId, binding>`，随 Host 进程存在。
- 持久态只用于重启恢复：`agent-state.json` 记录终止态与 ack（见 8.6 的存储目录）。Host 重启后：`running` 一律回落 `idle`；`completed`/`error` 若未 ack 且 <7 天则恢复，`source: 'restore'`；`waiting-user` 若 <30 分钟则恢复，否则视为过期置 `idle`。**待验证（Spike S-13）**：能否从会话末尾事件/投影恢复 `running`，避免重启后“入口消失直到下一个事件”；降级即上述“重启后 idle 起步”。
- 客户端通过 `hostEpoch` 识别 Host 重启：`GET agent-state` 与 `POST launch` 都带 `hostEpoch`；不一致时丢弃旧轮询结果并立即重取快照，**不重建 iframe**（除非它尚未 `ready` 或实例记录已丢失），避免把上一进程的状态当成当前。

#### 时序与延迟预算

| 链路 | 预算 | 组成 |
|---|---|---|
| 运行入口出现（D-001：running ≥5s） | ≤1.5s（p95） | 事件→快照 ≤100ms；轮询 ≤1000ms；渲染 ≤150ms；抖动合并 ≤250ms |
| 完成提醒 | ≤1.5s | `turn/end`→快照 ≤100ms；稳定窗 ≤250ms；轮询 ≤1000ms；渲染 ≤150ms |
| 等待提醒 | ≤1.5s | `approval/asked`→快照 ≤100ms；轮询 ≤1000ms；渲染 ≤150ms |
| 入口消失（idle） | ≤2.0s | 允许一个轮询周期 + 1500ms 最短展示 |

若轮询失败退避到 8s，允许超出预算，但必须在诊断面板显示“状态延迟”；UI 不得显示过期状态超过 10s 而不标记。

#### 轮询与快照语义

- 快照是**整份替换**，不是增量；`seq` 单调递增，`ETag: W/"<hostEpoch>:<seq>"`。
- `GET agent-state` 只读、无副作用；不触发“已读”，ack 必须走 POST。
- 轮询间隔、退避、可见性规则见 8.5；V1 不做 SSE（S-17）。
- 客户端合并规则：同一 `sessionId` 只接受 `seq` 更大的快照；`hostEpoch` 不同则整份替换；乱序旧包丢弃。

#### 隐私红线

以下内容**禁止**进入快照、日志、诊断导出、错误 `details`：prompt/系统提示、用户与 Assistant 消息正文、工具参数与命令、文件路径、模型名与 token 数、Session 标题、Workspace 名、任何凭据。允许的只有：`state`、固定模板 `label`、`sessionId`、时间戳、`source`、`seq`。

**验收用例。** 在测试 Session 中发送含唯一 canary 的 prompt 与命令，触发 running/waiting/completed；断言 `GET agent-state`、诊断面板、导出 JSON、Host 日志中均不出现该 canary。该用例必须进 CI。

### 8.10 安全规范

#### 威胁模型

| 资产 | 攻击者 | 入口 | 最坏影响 | 主对策 |
|---|---|---|---|---|
| DSH 宿主与用户文件 | 恶意游戏包 | 游戏 HTML/JS | 读文件、执行命令、改宿主 | sandbox + CSP + 无 Host API |
| 用户 Credential | 恶意游戏包 | 页面脚本、网络 | 窃取 Cookie/凭据 | opaque origin + `connect-src 'none'` + HttpOnly |
| 其它游戏数据 | 恶意游戏包 | 存档 API | 读/写他人存档 | `gameId` 由 launch 绑定，请求不可指定 |
| Market 完整性 | 被篡改 Registry/包 | 下载、更新 | 装恶意包、降级攻击 | HTTPS + SHA-256 + fail-closed |
| 用户注意力/工作流 | 恶意游戏 | 提醒、全屏、音频 | 伪装 Agent 提醒、劫持 | 平台自绘 Presence、游戏不能发通知/全屏 |
| 用户存档 | 恶意/损坏存档 | 磁盘、手工替换 | 注入 HTML/污染原型 | 只存 JSON、不渲染、拒绝危险 key |

**不在威胁模型内：** 已安装的其它 DSH 插件。它们在 Host 进程内运行，拥有与 Game Market 同级的权限；本插件无法防御，也不承诺防御。**本地其它网页**：由宿主 `/api` 信任栅栏（Host/Origin/Cookie/Sec-Fetch-Site）防御，见 8.5。

#### 信任边界

```text
DSH Host（可信）
  └─ Game Market Host Service（可信）
       └─ /api 信任栅栏：Cookie + Host + Origin + Sec-Fetch-Site + owner peer
Client（半可信：我们自己的代码，但运行在共享页面）
  └─ Runtime（可信）
       └─ postMessage（校验 source/nonce/结构）
            └─ sandbox iframe（不可信，opaque origin）
                 └─ Game Package
```

- **Host 可信**：唯一能写磁盘、读 Registry、看 Session 事件的地方。
- **Runtime 可信**：能读 DSH Client 服务、能决定发什么消息给游戏；但它渲染的 DOM 与宿主共享，因此不能把第三方 HTML 直接插进 Client DOM。
- **iframe 不可信**：所有输入都按恶意处理；不把 DSH 对象、路径、凭据、Cookie 传进去。
- **Client 半可信**：它是我们的代码，但一旦被 XSS 或第三方脚本污染，就等于 Runtime 被攻破；因此 Market UI 不渲染游戏提供的 HTML（封面只接受图片，描述按纯文本），游戏只能在 iframe 里运行。

#### 能力矩阵

| Capability | V1 允许 | 默认 | 说明 |
|---|---|---|---|
| `storage` | 自己游戏的 save/load/remove，≤1MB、≤32 key | 拒绝 | 未声明调用 → `GM-4032` |
| `score` | 自己游戏的 submit/getBest | 拒绝 | meta ≤2KB，不解释 |
| `agent`、`lifecycle`、`session` | 始终可用 | — | ambient 面；不写用户数据、不授予额外权限，与 8.2 一致 |
| `network` / `fs` / `shell` / `credential` / `tools` / `workspace` / `clipboard` / `notifications` / `fullscreen` | **V1 不存在** | 拒绝 | Manifest 声明未知能力 → 安装拒绝（8.2 的 `E_PKG_CAPABILITY_*`，映射 `GM-4221`） |

- **默认拒绝**：Manifest 中 `capabilities` 缺失等同空数组；空数组的游戏仍能玩，只是存档/分数被拒。
- **平台能力不受 Capability 约束**：小鲸鱼、Agent Presence、完成提醒由 Runtime 自动提供，游戏无法关闭，也无法伪造（游戏不能发通知、不能画 Presence）。
- **无隐式授予**：任何未声明能力一律拒绝，包括只读调用。

#### iframe 沙箱与 CSP

- `sandbox="allow-scripts"` 是**唯一**允许的 sandbox 值。**禁止 `allow-same-origin`**：与 `allow-scripts` 同时存在时，iframe 文档与父页面同源，脚本可以读 `parent.document`、移除 `sandbox` 属性、调用宿主页面 API，隔离完全失效。opaque origin 同时让 `localStorage`/`IndexedDB`/`document.cookie` 对游戏不可用，这是特性不是缺陷。
- V1 不授予 `allow-forms`（防 CSRF 表单）、`allow-popups`（防钓鱼窗口）、`allow-modals`（防 `alert` 阻塞）、`allow-downloads`、`allow-top-navigation*`、`allow-pointer-lock`、`allow-presentation`、`allow-storage-access-by-user-activation`。
- `allow="autoplay"`；不授予 `fullscreen`。
- **入口 HTML 的 CSP**（由 `/entry` 路由设置，D-023）：

```text
default-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline';
img-src data: blob:;
font-src data:;
media-src data: blob:;
connect-src 'none';
frame-src 'none'; child-src 'none'; worker-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none';
frame-ancestors <hostOrigin>;
```

单文件内联使 CSP 不需要引用宿主 origin：entry 不加载任何外部子资源，`script-src 'unsafe-inline'` 只对游戏自己的内联脚本放行；游戏内容本身已由 sandbox 隔离，允许 inline script 不扩大宿主攻击面。`frame-ancestors <hostOrigin>` 的 origin 从请求 URL 取（如 `http://127.0.0.1:19387`）。**待验证（Spike S-16）**：真实 DSH 中 CSP 响应头是否作用到 sandbox iframe、`frame-ancestors` 是否放行宿主内嵌；降级为去掉 `frame-ancestors`（sandbox 已阻断顶层导航与弹窗）。

- **为什么这里允许 iframe，而 DSH 插件 UI 不允许（F-09）。** 插件 UI 是受信代码，必须继承宿主主题、locale、焦点与布局，iframe 会切断这些继承，所以插件 UI 用 Slot 渲染 React。游戏是**不可信内容**，需要的不是视觉一致，而是隔离边界；iframe 是浏览器唯一成熟的“不可信内容”边界。两者目的不同，不矛盾。游戏 iframe 属于内容层，不属于插件 UI 层。

#### postMessage 校验

接收方必须同时满足：`event.source` 是当前 iframe 的 `WindowProxy`；`event.data` 是对象且 `v === 1`；`kind` 合法；`method`/`event` 在表内；`instanceId`/`nonce` 匹配本次 launch；payload ≤1.2MB、深度 ≤32；速率 ≤200 条/秒。任一失败丢弃并计数，不回复。`event.origin` 在 sandbox 下为 `"null"`，**不得**用它做认证，也不得因它是 `"null"` 就拒绝消息。nonce 每次 launch 重新生成，32 hex，只通过 URL 传给该 iframe；它防的是“别的 frame/旧实例冒充”，不是防游戏本身（游戏总能读到自己的 nonce）。

#### Game Package 校验

安全相关的最小集合（完整 Manifest 规则见 8.2、安装流水线见 8.7）：

1. 单文件校验拒绝：空文件、非 UTF-8、含 BOM、HTML 不可解析（`E_PKG_HTML_INVALID`）。
2. 单文件 ≤20 MiB；manifest 文本 ≤64 KiB；`icon` data URI 解码后 ≤256 KiB（与 8.2.2 一致）。
3. 内嵌 manifest 必须存在且全文恰好一处（`E_PKG_MANIFEST_MISSING` / `E_PKG_MANIFEST_DUPLICATE`），解析后按 §8.2.3 严格校验字段。
4. 自包含静态检查：禁止外部 `script/link/img/audio/video/source` 的 `src`/`href` 指向 `http(s)`/协议相对/`file:`/相对路径，禁止 `@import`、`<iframe>`，禁止 `fetch`/XHR/WebSocket/EventSource/`sendBeacon` 等网络调用（`E_PKG_ENTRY_NOT_SELF_CONTAINED`）。
5. Manifest 严格校验：未知字段允许但记录；`id`/`version`/`capabilities`/`sdkVersion`/`runtimeVersion` 类型与取值必须合法；`capabilities` 只允许 V1 白名单；旧字段（`author` 字符串、`category`、`entry`、`cover`、`screenshots`）拒绝（`E_PKG_LEGACY_FIELD`）。
6. **不静态审查 HTML/JS 逻辑**：V1 不做代码扫描与语义分析，沙箱是边界；静态检查只服务于 manifest 定位与自包含判定，审核只做人工清单（见下）。
7. 安装阶段**不执行**任何脚本：不跑 `npm/pnpm`、不跑 `postinstall/prepare`、不启动浏览器、不 `eval` 包内容。只做哈希、HTML/manifest 解析、自包含检查与原子落盘。
8. 启动前重新读取 `entry.html` 的内嵌 manifest 并复核 `id`/`version`（§8.2.7）；registry 源同时校验 entry 文件 SHA-256（安装时记录），local/dev 源无记录哈希、只做 manifest 一致性复核；不符 `GM-5014` / `GM-5037`，拒绝启动。

#### Registry 与更新完整性

- Registry 与包只经 HTTPS 获取（本地 file Registry 除外）；host 受 allowlist 或「与 Registry 同 host」规则约束（8.8），Host 不接受请求参数里的任意 URL。
- 下载后先校验 Registry 给出的 SHA-256，再做 HTML/内嵌 manifest 解析；哈希不符立即删除临时文件并保留旧版本（fail-closed）。
- 更新前校验 `runtimeVersion`/`sdkVersion` 兼容（8.11）；不兼容不自动升级。
- V1 不允许静默降级；显式安装旧版本仅作为开发/回滚手段，并在 UI 标注。
- Registry 不可达时，已安装游戏仍可离线启动；Market 列表用最近缓存并标注“可能不是最新”。

#### 存档隔离与大小

- 存档路径由 Host 按 `gameId` 派生，**永远不接受游戏/Client 传入的路径**；游戏只能读写自己的命名空间。
- 只存 JSON 文本；不存 HTML、不存可执行内容；读取后由游戏自己 `JSON.parse`（Host 返回对象，不返回字符串拼接的脚本）。
- 拒绝 `__proto__`/`constructor`/`prototype` key；Host 用 `Object.create(null)` 或 `JSON.parse` 后不合并到共享对象，避免原型污染。
- 上限 1MB/游戏、256KB/值、32 key；超限 `GM-4131/4132`，不做截断。
- 损坏存档隔离为 `*.corrupt`，回退到上一份备份；UI 提示“存档损坏，已恢复上一份”，不静默清空。

#### 恶意行为检测与用户提示

| 行为 | 检测 | 处理 |
|---|---|---|
| 卡死/死循环 | 心跳连续 3 次丢失（15s） | 提示“游戏无响应”，提供“重载/结束”；不自动杀进程 |
| 消息洪水 | >200 条/秒或 >50 条非法/10s | 丢弃 + 计数；持续 10s 终止 iframe（`GM-5004`） |
| 存档滥用 | 超限/高频 save | 拒绝 + `GM-4131/4290`；连续 20 次记诊断 |
| 反复崩溃 | 5 分钟 ≥3 次 | 停止自动重载，提示“该游戏可能有问题”，提供卸载 |
| 越权调用 | 未声明能力/未知 method | `GM-4032/4004`；不泄露内部信息 |
| 诱导外链/弹窗 | sandbox 已阻断 | 记诊断；不弹宿主对话框 |

所有提示都是非阻塞的，禁止由游戏内容触发宿主级 Modal。检测只记录计数与错误码，不记录游戏内容。

#### 凭据不可达

游戏无法获得：宿主 Cookie（`HttpOnly` + opaque origin）、`localStorage`（opaque origin 抛错）、DSH 环境变量、凭据文件、Host 路径、Agent 对象、Tool 定义。CSP `connect-src 'none'` 阻断一切网络；`allow-same-origin` 缺失阻断 DOM 访问；`sandbox` 阻断表单/弹窗/下载。Runtime 不得把 launch 细节（除 nonce）写进可被游戏读取的 DOM 属性。

#### 日志脱敏

禁止记录：存档内容、prompt/消息、工具参数、文件路径、Cookie/token、nonce 原值、完整 URL query（含 nonce）、Session 标题。允许记录：`gameId`、`playSessionId`、`sessionId` 的哈希前缀（8 位）、错误码、耗时、字节数、计数。日志中的用户可控字符串必须 `JSON.stringify` 并截断到 200 字符。

#### 发布审查清单（V1 人工逐项）

- [ ] 内嵌 manifest 通过 8.2 校验；`id` 与包文件名 `<id>-<version>.html` 一致；版本合法且无 `+`。
- [ ] 单文件包 ≤20 MiB；UTF-8 无 BOM；manifest 文本 ≤64 KiB 且全文恰好一处。
- [ ] 自包含检查通过：无外部子资源、无网络调用、无 `<iframe>`；所有资源为 inline 或 `data:` URL。
- [ ] `icon` 为 data URI；封面/截图只存在于 Registry 条目，不引用包内文件。
- [ ] Manifest 使用 `author` 对象与 `categories` 数组；无 `entry`/`cover`/`screenshots` 旧字段。
- [ ] `capabilities` 只含 `storage`/`score`；无网络代码（`fetch`/XHR/WebSocket）。
- [ ] 无 `parent.document`、无 `top.location`、无 `window.open`、无 `eval` 依赖。
- [ ] 音频在首次手势前静音；暂停时停止循环与声音。
- [ ] `before-save` 已实现并在 800ms 内完成保存。
- [ ] `storage.load` 在启动时恢复；无存档时能正常新开。
- [ ] `session.start/end` 在正确时机调用；结束局传 `outcome`。
- [ ] 分数是有限数；meta ≤2KB；无 prompt/路径。
- [ ] 未把 `label` 当逻辑输入；未依赖 `source` 枚举。
- [ ] 断网可玩；无外部字体/CDN/图片。
- [ ] 明/暗主题下可读；`prefers-reduced-motion` 下无强制动画。
- [ ] 键盘可操作；焦点可见；无全局按键劫持。
- [ ] 无自动跳转/自动关闭；退出只能由用户触发。
- [ ] 诊断面板无敏感信息；日志抽查通过 canary 测试。

#### 已知限制与 V2 方向

**V1 已知限制：** 不扫描 JS；无签名；Host 单点；无法阻止资源耗尽；无法检测“活着但白屏”；无联网；只支持单文件自包含 HTML 包。

**V2 方向：** 包签名（Ed25519，Registry 公钥）与发布者身份；静态扫描 + 动态沙箱观测；每游戏独立 origin/进程（更强隔离）；CSP report-only 收集违规；网络能力作为显式 Capability 重新评审（D-014）；多文件资源服务（若宿主提供公开静态路由或独立 origin）。

#### 攻击 → 验证方法

| 攻击 | 测试用例 | 期望 |
|---|---|---|
| 沙箱逃逸 | 游戏内执行 `parent.document.body.innerHTML`、`top.location='…'`、移除 `sandbox` | 抛 `SecurityError` / 无效果；父页面 DOM 不变 |
| 网络外联 | 游戏内 `fetch('https://example.com')`、`new WebSocket`、`sendBeacon`、`<img src=https://…>` | 全部被 CSP 阻断；无 DNS/连接 |
| Cookie 窃取 | 游戏读 `document.cookie`、`localStorage` | 空/抛错；不得出现宿主 Cookie |
| 越权存档 | 调 `storage.save` 时伪造 `gameId`/路径；或未声明 `storage` | 请求被 Host 忽略/拒绝 `GM-4032`；A 游戏读不到 B 游戏 |
| 外部资源/网络调用 | 构造引用 CDN 脚本、外链图片、`fetch`/WebSocket 的包 | 安装拒绝 `GM-4225`；运行时 CSP 阻断 |
| 超大单文件 | 构造 21 MiB HTML | 安装拒绝 `GM-4135`，不落盘 |
| 伪造多份 manifest | 在 HTML 中放置多份 `id="dsh-game-manifest"` | 安装拒绝 `GM-4221`，不落盘 |
| Registry 篡改 | 替换包但保留旧 hash | 校验失败，拒绝安装，旧版本仍可用 |
| 原型污染 | 存档含 `__proto__`/`constructor` | 写入拒绝 `GM-4134`；宿主对象原型不变 |
| 消息伪造 | 其它 frame 发 `init`/`storage.save`；旧 nonce 重放 | 丢弃并计数；无副作用 |
| 提醒伪造 | 游戏尝试发通知/改 Presence | 无 API 可达；Presence 只由 Host 状态驱动 |
| 日志泄露 | 触发 canary prompt 后导出诊断 | 导出物与日志均无 canary |

### 8.11 兼容性与版本策略

#### 8.11.1 三层版本与依赖方向

系统里实际有四个版本号，但只有三层兼容边界：

```text
DSH 0.2.x                     ← engines.dsh（插件包的约束）
   │
Game Market / Runtime 1.x     ← RUNTIME_VERSION（平台自身，V1 为 1.x）
   │  ├─ Adapter（DSH 适配层，随 Runtime 一起发版）
   │
Game SDK 1.x                  ← SDK_VERSION（游戏可见的 API 面，V1 为 1.x）
   │
Game 1.2.0                    ← 内嵌 manifest 的 version + 声明的 range
```

| 层 | 版本来源 | 谁检查 | 检查失败的表现 |
|---|---|---|---|
| DSH ↔ Game Market | `package.json` 的 `engines.dsh` | DSH 安装/启动 | 插件不加载（DSH 自身机制） |
| Game Market Runtime ↔ SDK | `RUNTIME_VERSION` 与 `SDK_VERSION` 常量 | Runtime 启动时自检 | Host 拒绝服务，日志 `E_COMPAT_INTERNAL` |
| Game ↔ Runtime/SDK | 内嵌 manifest 的 `runtimeVersion`/`sdkVersion` | 安装、启动、更新 | Play 禁用 + 原因 |

`engines.dsh` 是唯一由 DSH 自己执行的检查（§5.1）；其余两层都由 Game Market 自己执行，因为 DSH 不认识 Game Package（单文件 HTML）。

#### 8.11.2 semver 范围规则

只接受四种形式，其余一律拒绝：

| 形式 | 示例 | 语义 |
|---|---|---|
| caret | `^1.2.0` | `>=1.2.0 <2.0.0` |
| tilde | `~1.2.0` | `>=1.2.0 <1.3.0` |
| exact | `1.2.0` | 精确相等 |
| bounded | `>=1.2.0 <2.0.0` | 显式上下界，必须同时给上下界 |

拒绝：`*`、`latest`、`1.x`、`1`、`||`、`-` 预发布范围（如 `>=1.0.0-rc.1`）、git URL、npm tag。理由是这些形式要么无法静态判定，要么会让"兼容"变成不可预测。

预发布规则：`1.2.0-rc.1` 只匹配"精确相同的预发布版本"或显式包含它的范围；`^1.2.0` **不匹配** `1.3.0-rc.1`。

#### 8.11.3 兼容匹配算法

```ts
type Ver = { major: number; minor: number; patch: number; pre: string[] }

function satisfies(version: Ver, range: Range): boolean {
  if (version.pre.length > 0) {
    // 预发布版本只接受精确匹配或显式包含它的 bounded range
    return range.exact?.pre.length > 0 ? eq(version, range.exact) : false
  }
  switch (range.kind) {
    case 'caret':   return gte(version, range.min) && version.major === range.min.major
    case 'tilde':   return gte(version, range.min)
                        && version.major === range.min.major
                        && version.minor === range.min.minor
    case 'exact':   return eq(version, range.exact)
    case 'bounded': return gte(version, range.min) && lt(version, range.max)
  }
}
```

游戏兼容 = 三个条件同时成立：

```text
compatible(game) =
  satisfies(RUNTIME_VERSION, game.runtimeVersion)
  ∧ satisfies(SDK_VERSION,     game.sdkVersion)
  ∧ game.capabilities ⊆ SUPPORTED_CAPABILITIES(RUNTIME_VERSION)
```

示例（当前 `RUNTIME_VERSION = 1.0.3`、`SDK_VERSION = 1.0.5`）：

| `runtimeVersion` | 结果 | 原因 |
|---|---|---|
| `^1.0.0` | ✅ 兼容 | 同 MAJOR 且 ≥ 1.0.0 |
| `~1.0.0` | ✅ 兼容 | 同 MINOR |
| `1.0.3` | ✅ 兼容 | 精确 |
| `^1.1.0` | ❌ `E_COMPAT_RUNTIME` | 1.0.3 < 1.1.0 |
| `>=1.0.0 <2.0.0` | ✅ 兼容 | 落在区间 |
| `^2.0.0` | ❌ `E_COMPAT_RUNTIME` | MAJOR 不符 |
| `*` | ❌ `E_PKG_RANGE_SYNTAX` | 形式不允许 |

#### 8.11.4 检查时机与不兼容时的行为

| 时机 | 检查内容 | 失败处理 |
|---|---|---|
| 安装前 | 版本范围 + capabilities | 拒绝安装，`E_COMPAT_*` |
| 每次启动游戏 | 版本范围 + capabilities + 存档 schema | 禁用 Play，说明原因 |
| 更新前 | 新版本范围 | 更新按钮置灰 |
| Game Market 升级后首次启动 | 对**所有已安装游戏**重算，写回 `installations.compatibility` | 不兼容的标为禁用，其余不受影响 |

不兼容时的用户可见行为，必须同时满足：

1. My Games 卡片保留可见（不隐藏、不删除），Play 置灰。
2. 详情页给出具体原因："该游戏需要 Game SDK ^1.1.0，当前 1.0.5"。
3. 提供"检查更新"按钮（若 Registry 有兼容的新版本，直接引导更新）。
4. **绝不自动升级**、绝不静默降级 Runtime、绝不"忽略并强制运行"。

#### 8.11.5 DSH breaking change 时的承诺与回归清单

> **DSH 变了只改 Adapter，不让游戏生态跟着迁移。**

Adapter 是 `host/` 中唯一 import DSH 服务、监听 DSH 事件、读写 DSH 目录的代码集合。承诺：DSH breaking change 导致的改动范围**限制在 Adapter 与 `engines.dsh` 两处**；`packages/runtime`、`packages/sdk`、`games/**` 不改。若做不到，说明 Adapter 边界漏了，属于设计缺陷而不是版本策略问题。

每次 DSH 升级必须跑的回归清单（10 项，全部可自动化或半自动化）：

1. 插件能安装、启用、停用、卸载，无 failed 行。
2. `main` 面板可注册、可 `selectPanel`、可 `selectPanel(null)` 返回。
3. `sidebar.panellist` 图标出现在正确位置。
4. `conversation.header.leading` chip 只在 Agent 运行 ≥5s 后出现（D-001）。
5. Host 路由可访问，Client 同源 `fetch` 返回预期 JSON。
6. Agent 事件仍能产出 `running/waiting-user/completed/error` 四态。
7. 切到游戏面板后返回，Conversation 的草稿与滚动位置仍保留（F-05 的宿主兜底）。
8. `$DSH_HOME/storages/` 仍可写，跨重启数据仍在。
9. 明/暗主题下平台 UI 无硬编码颜色。
10. 停用插件后无残留 slot、无 console error、无遗留定时器。

#### 8.11.6 本地数据与存档的向后兼容

| 数据 | 版本字段 | 谁迁移 | 规则 |
|---|---|---|---|
| 平台文件（`installations` 等） | `schemaVersion` | 平台 | 只向前；更高版本 → 只读（§8.6.11） |
| 游戏存档 | `saveSchemaVersion` | **游戏** | 平台不解析 `data`，只在加载前比对 |
| Registry 缓存 | `schemaVersion` | 平台 | 不匹配直接丢弃重拉（无价值数据） |

存档的三条硬规则：

1. **平台不迁移游戏存档**。`data` 是游戏私有结构，平台迁移必然出错。平台只做信封层面的读写与大小限制。
2. **禁止降级读**：若 `current.saveSchemaVersion > manifest.save.schemaVersion`，拒绝加载并返回 `E_SAVE_SCHEMA_NEWER`，提示"存档来自更新版本的游戏，请更新后再玩"。这防止旧版游戏读到新版存档后写坏数据。
3. **升级路径由游戏自己实现**：SDK 把 `saveSchemaVersion` 一并交给游戏，游戏在 `load` 后自行迁移并立即 `save` 回写新版本；模板必须提供这段骨架代码（§8.2.9）。

#### 8.11.7 游戏降级与回滚

| 场景 | 允许 | 条件 |
|---|---|---|
| 更新失败自动回退 | ✅ | 磁盘已落位但索引写入失败，自动回退到 `previousVersion` |
| 用户主动回滚 | ✅ | 只有 `previousVersion` 存在时可回滚；最多保留 1 个旧版本 |
| 回滚到更旧版本 | ❌ | 需要重新安装（走 `E_INSTALL_VERSION_CONFLICT` 提示先卸载） |
| 回滚且存档版本更高 | ⚠️ 默认阻止 | 提供"备份存档并回滚"：先把 `current.json` 复制为 `current.pre-rollback-<ts>.json`（保留 7 天），再回滚 |

回滚后必须重新跑兼容性检查：若旧版本的 `runtimeVersion` 不满足当前 Runtime，回滚同样被禁用并说明原因。

> 待验证（Spike S-06）：保留旧版本的"回滚"在真实运行时是否可用——包括 iframe 静态资源是否会被浏览器缓存串版本、`previousVersion` 目录在更新清理中是否会被误删、回滚后存档备份能否正常还原。
> 验证方法：装 1.1.3 → 更新 1.2.0 → 连续回滚/再更新 10 次，每次断言 iframe 加载的内嵌 manifest 版本与预期一致（对比网络面板的 `x-game-version` 响应头或 entry 文件哈希），并断言 `packages/` 下始终只剩 2 个版本目录。
> 降级方案：若缓存无法可靠失效，回滚后在 `/entry` 的 URL 上追加内容哈希参数（如 `&h=<sha256 前 8 位>`），以 URL 变化强制失效缓存。


#### 8.11.8 兼容性矩阵

Runtime / SDK 与游戏声明的对应关系（✅ 完整可用；⚠️ 可玩但禁用新安装；❌ 拒绝）：

| 游戏 `runtimeVersion` | Runtime 1.0.3 | Runtime 1.1.0 | Runtime 2.0.0 |
|---|---|---|---|
| `^1.0.0` | ✅ | ✅ | ❌ 需更新 |
| `^1.1.0` | ❌ 需更新 | ✅ | ❌ 需更新 |
| `>=1.0.0 <2.0.0` | ✅ | ✅ | ❌ 需更新 |
| `1.0.3` | ✅ | ❌ | ❌ |
| `^2.0.0` | ❌ | ❌ | ✅ |

存档版本兼容（游戏自身视角）：

| 存档 `saveSchemaVersion` | 游戏声明 `save.schemaVersion` | 结果 |
|---|---|---|
| 1 | 1 | ✅ 直接加载 |
| 1 | 2 | ✅ 加载，游戏负责迁移 |
| 2 | 2 | ✅ 直接加载 |
| 2 | 1 | ❌ `E_SAVE_SCHEMA_NEWER`（禁止降级读） |
| 3 | 2 | ❌ 同上 |

DSH 版本与插件的关系：

| DSH | `engines.dsh` | 表现 |
|---|---|---|
| 0.2.x | `>=0.2.0 <0.3.0` | ✅ 正常 |
| 0.3.x | 同上 | ❌ DSH 拒绝加载插件，提示升级 Game Market |
| 0.1.x | 同上 | ❌ 同上 |

#### 8.11.9 未来新增的版本字段与向前兼容

新增任何字段都必须满足"旧客户端读到新数据不崩、新客户端读到旧数据不缺省"：

| 未来字段 | 出现位置 | 兼容策略 |
|---|---|---|
| `capabilities` 新值（`network`、`workspace-context`） | manifest | 旧 Runtime 报 `E_PKG_CAPABILITY_UNSUPPORTED` 并拒绝安装——**正确行为**，不能降级为忽略 |
| `permissions` 非空 | manifest | V1 已预留字段并显式拒绝；V2 起逐项定义 scope 与提示文案 |
| `manifestVersion: 2` | manifest | 只在破坏性变更时提升；旧客户端报 `E_PKG_MANIFEST_VERSION` 并提示升级 |
| `score.mode`（如计时/连击） | manifest | 新增可选枚举，缺省视为 `points`；旧客户端遇到未知值应拒绝该能力而不是猜 |
| `save.migrations`（声明式迁移表） | manifest | 可选；缺失时游戏自己迁移（保持现状） |
| `signature`（包签名） | Registry | 可选；缺失时退回 SHA-256；新增不改变已有字段语义 |
| `minWindow` / `inputs`（输入设备要求） | manifest | 可选，未知值忽略并回退默认 |
| Registry 新字段（`rating`、`downloads`） | Registry | Client 严格白名单渲染，未知字段忽略；不因为多一个字段就整份失效 |

四条通用规则：

1. **新增一律可选 + 给默认值**；必填字段的变更等于 `manifestVersion + 1`。
2. **未知枚举值要区分"安全"与"不安全"**：能力、权限类未知值必须拒绝；展示类未知值可忽略。
3. **Registry 容忍未知字段，manifest 不容忍未知能力**。
4. **每新增一个字段，同步更新 §8.2.3 表、§8.2.7 校验表与 §8.11.8 矩阵**，否则视为文档未完成。

### 8.12 可观测性与诊断

#### 日志

| 项 | 规则 |
|---|---|
| 前缀 | `[game-market/host]`、`[game-market/client]`、`[game-market/runtime]`、`[game-market/sdk]` |
| 级别 | `error`：用户可见故障；`warn`：可恢复异常/降级；`info`：安装、启动、退出、状态迁移；`debug`：Bridge 消息摘要（仅开发模式） |
| 字段 | `event`、`gameId`、`playSessionId`、`sessionIdHash`（8 位）、`code`、`durationMs`、`bytes`、`count`、`hostEpoch` |
| 采样 | 错误 100%；状态迁移 100%；Bridge 消息 debug 1%（固定采样，不按内容）；性能计数每 30s 聚合一条 |
| 输出 | Host 走 `ctx.logger`（存在时）；Client 走 `console`；两者都不得写文件、不得上报网络 |
| 禁止 | 存档内容、prompt/消息、工具参数、文件路径、Cookie/token、nonce 原值、完整 query、Session 标题 |

日志行示例（已脱敏）：

```text
[game-market/host] info launch gameId=2048 instance=7c1a… session=ab12cd34 durationMs=42
[game-market/runtime] warn save-retry gameId=2048 code=GM-5021 attempt=2 bytes=61234
[game-market/client] error agent-poll-failed code=GM-5031 retryInMs=4000
```

#### 错误码与用户文案

| 错误码 | 用户文案（zh） | 恢复动作 |
|---|---|---|
| `GM-4042` | 这个游戏不存在或已下架 | 返回市场 |
| `GM-4091` | 正在安装另一个游戏，请稍后再试 | 自动重试按钮 |
| `GM-4131/4132` | 存档空间已满 | 清理/重试；不丢旧档 |
| `GM-4260/4261` | 这个游戏与当前版本不兼容 | 返回市场/检查更新 |
| `GM-4290` | 操作太频繁，请稍后再试 | 自动退避 |
| `GM-5001/5011` | 游戏加载超时 | 重试/返回 |
| `GM-5012/5013` | 游戏没有响应 | 重载/结束游戏 |
| `GM-5014` | 游戏文件损坏，请重新安装 | 重装 |
| `GM-5021` | 存档失败，请稍后重试 | 重试；保留旧档 |
| `GM-5031/5032` | 服务暂时不可用 | 自动退避；显示延迟标记 |

文案 key 与 zh/en 全文由 9.8 维护（`error.generic` 为兜底 key）；本书列用户可见高频项，其余回退 `error.generic`；构建期检查不得存在未映射的用户可见错误码。

#### 开发模式诊断面板

开启方式：`localStorage['dsh-game-market:debug'] === '1'`，或 URL 带 `?gm-debug=1`；V1 不做隐藏手势。只在开发模式出现，不进生产默认 UI。

| 区域 | 内容 |
|---|---|
| 包信息 | `gameId`、版本、包来源（registry/local/dev/builtin）、包 SHA-256 前 12 位、单文件字节 |
| 启动 | `launch` 耗时、`firstFrameMs`、握手耗时、`init`/`ready` 原文（脱敏、可折叠） |
| Bridge | 最近 50 条消息摘要：方向、method/event、id、耗时、结果码、payload 字节；**不含 payload 内容** |
| 存档 | 最近保存时间、耗时、字节、`revision`、失败次数、`autoSaveSkipped` 次数 |
| Agent | 当前 state、`source`、`seq`、`since`、绑定 `sessionIdHash`、最近 10 次迁移（state/label key/时间） |
| 运行时 | `hostEpoch`、`runtimeVersion`、`sdkVersion`、`protocolVersion`、capabilities、CSP 是否生效、sandbox 值 |
| 计数 | 丢弃消息数、非法消息数、重载次数、崩溃次数、轮询失败次数 |

面板只读；提供“复制摘要”按钮（复制的是脱敏文本，不含内容）。

#### 导出诊断信息

- 入口：错误页与诊断面板的“导出诊断信息”；生成 JSON 文件本地下载，不上传。
- 内容：版本、平台、`hostEpoch`、游戏元数据、最近 100 条日志、性能计数、最近 20 条 Bridge 摘要、存档元数据（不含量）、Agent 迁移（只保留 label key）。
- 脱敏：所有用户可控字符串做 canary 检查；`sessionId` 只留哈希前缀；nonce/Cookie/路径一律移除；导出文件 ≤256KB。
- 文件名：`dsh-game-market-diagnostics-<ISO 时间>.json`；写入临时 Blob 后立即 revoke。

#### 性能计数

| 指标 | 采集点 | 目标 |
|---|---|---|
| `loadMs` | `launch` → `ready` | 本地 ≤1500ms（p95） |
| `firstFrameMs` | iframe 创建 → SDK 首个 rAF | ≤800ms |
| `fps` | Runtime 侧 rAF 采样（不进入游戏） | ≥50（144Hz 屏按比例） |
| `saveMs` | Bridge 请求 → Host 提交 | ≤300ms（p95），≤2000ms 上限 |
| `bridgeRttMs` | 请求发出 → 响应 | ≤50ms（p95） |
| `agentLatencyMs` | 事件 → Client 渲染 | ≤1500ms（p95） |
| `pollFailures` | 连续失败数 | 0（正常） |
| `droppedMessages` | 非法/超限丢弃 | 0（正常） |

计数只在内存环形缓冲（每项 120 个样本），页面关闭即丢；不落盘、不上报。

#### 遥测

**V1 明确不采集遥测、不上报任何网络请求。** 无 analytics、无崩溃上报、无使用统计。Host 的 Registry 拉取是功能请求，不是遥测；诊断导出只在用户点击时本地生成。V2 若引入遥测，必须单独评审并默认关闭。

#### 故障排查手册

| 现象 | 检查顺序 | 常见原因 |
|---|---|---|
| 等待入口不出现 | 运行 ≥5s？`agent-state` 为 running？绑定正确？轮询未停？ | 短任务；未绑定；Host 重启后无新事件 |
| 进入游戏白屏 | `entryUrl`/HTTP 状态、403/404、CSP、握手超时 | entry 未自包含；CSP 未生效（S-16）；栅栏拒绝导航 |
| 能开但存档不生效 | `storage` 声明？`before-save` 实现？key 合法？超 1MB？ | `GM-4032`；未在 800ms 内 save |
| Continue 不出现 | 有未结束 Session？有 Save？`canContinue`？ | 从未 save；误调 `end`；卸载清档 |
| Agent 状态不更新 | `hostEpoch` 变？Session 在？轮询报错？ | Host 重启；Session 归档；退避到 8s |
| 游戏没有声音 | 首手势前静音？`allow` 在？音量？ | 自动播放策略（S-19） |
| 键盘无响应 | iframe 获焦？全局 keydown？Modal？ | 焦点在平台按钮；Esc 被占 |
| 反复重载 | 重载/崩溃计数、哈希、包是否被改 | 资源损坏；启动即崩 |
| 安装失败 | `health` 的 registry/storage、hash、磁盘、并发锁 | 409；哈希不符；空间不足 |
| 诊断导出含敏感信息 | 跑 canary；查字段白名单 | 新日志字段未脱敏 |

### 8.13 错误码映射与对外文案

> 目的：§8.2、§8.6、§8.7、§8.8 用 `E_*` 作为 Host 内部常量名，§8.1、§8.3、§8.5、§8.9 用 `GM-*` 作为对外错误码。实现与联调只认 `GM-*`；`E_*` 只出现在代码常量、内部日志的 `source` 字段与排障文档中。**本表是唯一映射来源**；新增或修改错误码必须同时更新本表与 §8.1 登记。

#### 8.13.1 约定

- 对外错误体固定为 `{ code, message, retryable, details? }`：`code` 必须是 `GM-*`；`message` 为英文诊断，不直接展示给用户；用户文案由 Client 按 `code` 映射（文案表见 9.8）。
- Host 日志同时记录 `code`（GM）与 `source`（`E_*`），便于排障；HTTP 响应与 Bridge 消息只返回 GM 码。
- SDK 面错误码直接使用 GM（见 8.3），不出现 `E_*`。
- 无法识别的内部错误一律对外 `GM-5000 INTERNAL`，并记录 `E_*` 到日志；不得把内部堆栈或路径放进 `details`。

#### 8.13.2 包与 Manifest（对应 §8.2）

| 内部常量 | 对外 GM | 含义 | HTTP |
|---|---|---|---|
| `E_PKG_HTML_INVALID` | `GM-4222` | 文件不是合法 UTF-8 HTML（空文件/非 UTF-8/含 BOM/不可解析） | 422 |
| `E_PKG_MANIFEST_MISSING` | `GM-4221` | 未找到内嵌 manifest | 422 |
| `E_PKG_MANIFEST_DUPLICATE` | `GM-4221` | 内嵌 manifest 出现多于一处 | 422 |
| `E_PKG_MANIFEST_JSON` | `GM-4228` | manifest JSON 语法错误或重复键 | 422 |
| `E_PKG_MANIFEST_TOO_LARGE` | `GM-4229` | manifest 文本超过 64 KiB | 422 |
| `E_PKG_MANIFEST_VERSION` | `GM-4230` | manifestVersion 不受支持 | 422 |
| `E_PKG_FIELD_MISSING` | `GM-4231` | 必填字段缺失 | 422 |
| `E_PKG_FIELD_TYPE` | `GM-4232` | 字段类型错误 | 422 |
| `E_PKG_FIELD_RANGE` | `GM-4233` | 字段长度/数值越界 | 422 |
| `E_PKG_ID_INVALID` | `GM-4234` | id 语法不合法 | 422 |
| `E_PKG_ID_RESERVED` | `GM-4235` | id 与系统保留名冲突 | 422 |
| `E_PKG_VERSION_INVALID` | `GM-4236` | 版本号非允许的 semver 子集 | 422 |
| `E_PKG_LEGACY_FIELD` | `GM-4237` | 使用已废弃字段（author 字符串/category/entry/cover/screenshots） | 422 |
| `E_PKG_CATEGORY_UNKNOWN` | `GM-4238` | categories 含未知枚举 | 422 |
| `E_PKG_CAPABILITY_UNKNOWN` | `GM-4239` | 未知 capability 名 | 422 |
| `E_PKG_CAPABILITY_UNSUPPORTED` | `GM-4240` | 已知但当前版本未开放的 capability | 422 |
| `E_PKG_CAPABILITY_DUPLICATE` | `GM-4241` | capability 重复声明 | 422 |
| `E_PKG_PERMISSION_UNSUPPORTED` | `GM-4242` | 声明了非空 permissions | 422 |
| `E_PKG_SCORE_RANGE` | `GM-4243` | 分数范围配置非法 | 422 |
| `E_PKG_SAVE_SCHEMA` | `GM-4244` | 存档 schemaVersion 非法 | 422 |
| `E_PKG_RANGE_SYNTAX` | `GM-4245` | 版本范围写法不支持 | 422 |
| `E_PKG_ICON_FORMAT` | `GM-4247` | icon data URI 类型不受支持 | 422 |
| `E_PKG_ICON_TOO_LARGE` | `GM-4248` | icon 解码后超过 256 KiB | 422 |
| `E_PKG_ENTRY_NOT_SELF_CONTAINED` | `GM-4225` | 引用外部子资源或网络调用 | 422 |
| `E_PKG_TOO_LARGE` | `GM-4135` | 单文件包超过 20 MiB | 413 |

> **已废弃、V1 不再产生也不再分配的 `E_*`：** `E_PKG_ZIP_*`（含 `E_PKG_ZIP_UNSUPPORTED`、`E_PKG_ZIP_BOMB`）、`E_PKG_ENTRY_UNSUPPORTED`、`E_PKG_JUNK_ENTRY`、`E_PKG_TOO_MANY_FILES`、`E_PKG_FILE_TOO_LARGE`、`E_PKG_DIR_TOO_WIDE`、`E_PKG_PATH_TOO_LONG`、`E_PKG_PATH_TOO_DEEP`、`E_PKG_ASSET_MISSING`、`E_PKG_ASSET_ANIMATED`；原归档模型下的 `E_PKG_STRUCTURE`、`E_PKG_PATH_UNSAFE`、`E_PKG_ENTRY_MISSING` 也一并退出。它们只能出现在历史代码与迁移说明中。
>
> **随之退役的 GM 号：** `GM-4223`（原 zip 不支持）、`GM-4224`（原归档条目类型）、`GM-4226`（原 entry 缺失）、`GM-4227`（原垃圾条目）、`GM-4246`/`GM-4249`（原资源缺失/动图）、`GM-4136`–`GM-4141`（原文件数/单文件/压缩炸弹/目录宽度/路径长度/深度）。这些 GM 号不再产生新语义，也不复用于其它错误。

#### 8.13.3 安装、更新、卸载与 Registry（对应 §8.7、§8.8）

| 内部常量 | 对外 GM | 含义 | HTTP |
|---|---|---|---|
| `E_INSTALL_URL_REJECTED` | `GM-4034` | 下载地址不在允许列表 | 403 |
| `E_REGISTRY_URL` | `GM-4035` | Registry 地址不被信任 | 403 |
| `E_MARKET_DISABLED` | `GM-4036` | Game Market 已停用 | 403 |
| `E_NOT_IN_REGISTRY` | `GM-4044` | 游戏已下架/不在索引中 | 404 |
| `E_INSTALL_VERSION_CONFLICT` | `GM-4094` | 版本冲突，需要卸载或回滚 | 409 |
| `E_INSTALL_VERSION_MISMATCH` | `GM-4095` | 包版本与 Registry 记录不一致 | 409 |
| `E_UPDATE_GAME_RUNNING` | `GM-4096` | 游戏运行中禁止更新 | 409 |
| `E_UNINSTALL_BUSY` | `GM-4097` | 有安装/卸载任务进行中 | 409 |
| `E_UNINSTALL_BUILTIN` | `GM-4038` | 内置游戏不可卸载 | 403 |
| `E_INSTALL_DISK_FULL` | `GM-4142` | 磁盘空间不足 | 413 |
| `E_INSTALL_HASH_MISMATCH` | `GM-5015` | 包 SHA-256 与 Registry 不符 | 500 |
| `E_INSTALL_IO` | `GM-5036` | 安装写入/落盘失败 | 503 |
| `E_INSTALL_CORRUPT` | `GM-5037` | 安装产物不完整 | 503 |
| `E_INSTALL_DOWNLOAD_FAILED` | `GM-5034` | 下载失败 | 503 |
| `E_INSTALL_DOWNLOAD_TIMEOUT` | `GM-5035` | 下载超时 | 503 |
| `E_REGISTRY_UNAVAILABLE` | `GM-5032` | Registry 不可达（已有定义） | 503 |

#### 8.13.4 存储、会话、成绩与兼容性（对应 §8.6、§8.11）

| 内部常量 | 对外 GM | 含义 | HTTP |
|---|---|---|---|
| `E_STORE_BAD_GAME_ID` | `GM-4005` | gameId 不合法或不属于当前调用方 | 400 |
| `E_SCORE_OUT_OF_RANGE` | `GM-4006` | 分数超出 manifest 声明范围 | 400 |
| `E_CAPABILITY_DENIED` | `GM-4032` | 未声明该 capability（已有定义） | 403 |
| `E_STORE_PATH_ESCAPE` | `GM-4037` | 路径越界/穿越 | 403 |
| `E_SAVE_TOO_LARGE` | `GM-4131` | 单游戏存档总量超过 1 MiB（已有定义） | 413 |
| `E_STORE_SCHEMA_NEWER` | `GM-4098` | 数据文件 schemaVersion 高于当前实现 | 409 |
| `E_SAVE_SCHEMA_NEWER` | `GM-4099` | 存档 schemaVersion 高于当前游戏版本 | 409 |
| `E_STORE_IO` | `GM-5024` | 存储读写失败 | 500 |
| `E_STORE_READONLY` | `GM-5025` | 存储目录不可写（只读模式） | 500 |
| `E_COMPAT_RUNTIME` | `GM-4260` | runtimeVersion 不满足（已有定义） | 409 |
| `E_COMPAT_SDK` | `GM-4261` | sdkVersion 不满足（已有定义） | 409 |
| `E_COMPAT_INTERNAL` | `GM-5026` | 兼容性检查内部错误 | 500 |

#### 8.13.5 与 HTTP 状态码、文案表的关系

- HTTP 状态由 GM 码前三位决定（`GM-4xxx` → 4xx，`GM-50xx`/`GM-502x`/`GM-503x` → 5xx，`GM-501x` 见 §8.5 表）；个别码的例外以 §8.5 表为准。
- 用户文案键按 GM 码登记，见 9.8；`E_*` 不进入文案表。
- 测试断言应**同时**断言 GM 码与 HTTP 状态；只断言 `E_*` 的测试视为未覆盖对外契约。
- 8.10 安全测试中的自包含类攻击（外部子资源/网络调用）对应 `E_PKG_ENTRY_NOT_SELF_CONTAINED`（`GM-4225`）；超大单文件对应 `E_PKG_TOO_LARGE`（`GM-4135`）；非法 manifest 对应 `E_PKG_MANIFEST_*`（`GM-4221`）；不得为同一语义分配第二个 GM 码。

## 9 界面与交互规格（实现级）

第 9 章把第 2、3、6 章的产品与视觉描述落成可实现的交互规则：每个入口、状态、文案、动效时长与无障碍要求都可以直接对照开发与验收。**本章与第 6 章冲突时以本章为准。**

### 9.1 等待入口

#### 9.1.1 组成与数据来源

等待入口由两个原生挂载点组成，共享 **Host Agent 快照（见 8.9）** 一个事实源；各自计时会立刻不一致：

| 组成 | 宿主位置 | 渲染条件 | 备注 |
|---|---|---|---|
| 会话头部 chip | `conversation.header.leading`（single/root，标题前靠左） | 当前会话存在 `running` 或 `waiting-user`，或存在本会话的暂停游戏 | 不占用会话标题；blank session 也渲染该槽位（F-03） |
| Sidebar 状态点 | `sidebar.panellist` 的 `id: dsh-game-market` 图标内 | 同上，但 `running` 需已过 5s 阈值 | 图标始终存在，状态点只是叠加层 |

Client 在模块级维护快照 store：visible 时每 **1000ms** 拉取（D-015）；页面 hidden 时**停止轮询**，转 visible 立即刷新一次（与 8.5 一致）。`fetchedAt` 超过 5000ms 视为陈旧，chip 与状态点全部隐藏（宁可少提醒，不可误报）。

#### 9.1.2 显示条件、状态与优先级

chip 有四个状态，优先级从高到低：`waiting` > `resume` > `running` > `hidden`。

| 状态 | 触发条件 | 文案 | 点击 | 退出 |
|---|---|---|---|---|
| `waiting` | 当前会话 `state === 'waiting-user'` | 需要你处理 | 幂等 `selectPanel(null)` 切回会话，再打开 popover（见 9.1.5） | 状态离开 waiting-user，或用户处理完毕 |
| `resume` | 当前会话存在由本插件暂停且未结束的游戏，且距暂停 ≤ **10 分钟** | 继续游戏 | 打开菜单，第一项为“继续上一局” | 进入游戏、用户忽略、或超过 10 分钟 |
| `running` | `state === 'running'` 且 `now - since ≥ 5000ms`，且本 turn 未被忽略 | 有可继续存档：`Agent 正在工作 · 继续上一局`；无：`Agent 正在工作 · 选择一个游戏` | 打开菜单（见 9.1.5） | 状态离开 running、本 turn 被忽略、或快照陈旧 |
| `hidden` | 其余情况 | — | — | — |

硬性规则：

1. 5 秒阈值以快照 `since`（Host 侧）为准，不以客户端挂载或首渲染时间计；刷新、重开窗口、切换面板都不重新计时，只有新 turn 产生新的 `since` 才重新计时。
2. `waiting-user` **没有 5 秒门槛**，出现即显示，并可覆盖“本次忽略”。
3. `resume` 不要求 Agent 正在运行；暂停游戏在 10 分钟窗口内就显示。
4. “是否有可继续存档”以 Host 的 `resumable` 为准：未结束 Session **且** 有可读存档（D-004），任一缺失即否。
5. 短任务（`running < 5s`）不出现 chip、状态点或菜单，也不留动画残影。

#### 9.1.3 chip 规格

| 项 | 值 |
|---|---|
| 高度 | 视觉 28px；点击热区 32px（上下用透明 padding 各扩 2px，不改变布局） |
| 水平内边距 | 10px；图标与文字间距 6px |
| 圆角 | 8px（chip 是控制，不做胶囊；胶囊只给真正短文本的状态 Pill） |
| 字体 | 12px / 16px 行高 / 字重 500，跟随 `--dsw-font-*` |
| 最大宽度 | 280px；超出时截断尾部，`title` 给全文 |
| 位置 | 会话标题之前，`margin-inline-end: 8px`，垂直居中对齐标题行；不绝对定位 |
| 图标 | 14px 线框手柄图标（`currentColor`），running 态附 5px 状态点 |
| 拖拽区 | 位于 `.headerLeading` 内，macOS 下已是 `no-drag`（见 8.1 的 F-10），无需处理 |

状态：

| 状态 | 规格 |
|---|---|
| 默认 | 背景透明，1px `--dsw-alias-border-l1`，文字 `--dsw-alias-label-secondary` |
| 悬停 | 背景 `--dsw-alias-interactive-bg-hover`，文字 `--dsw-alias-label-primary`，边框不变；120ms |
| 焦点 | `outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color)`，`outline-offset: 2px`；不使用颜色以外的弱提示 |
| 按下 | 保持悬停背景，叠加 4% 前景压暗；**不做缩放和位移** |
| 禁用 | 不适用。chip 不会禁用：条件不满足时直接移除，避免留下一个不可点的灰块 |
| 加载 | 不适用。快照首次加载期间不渲染占位，避免“闪一下又消失” |
| 空 | 不渲染 |
| 错误 | 不渲染；错误只体现在数据层与诊断日志，不在会话头顶报警 |

#### 9.1.4 菜单

| 项 | 值 |
|---|---|
| 锚点 | chip 下方 4px 左对齐；用 chip 的 `getBoundingClientRect()` 配合 `position: fixed`，避免被 header 裁切（**待验证 Spike S-20**；降级为 `shell.overlay` 自绘菜单） |
| 尺寸 | 宽 248px，最大高 320px，圆角 12px，内边距 6px；行高 36px，图标 16px，主文案 13px，次行 11px |
| 材质 | `--dsw-alias-bg-overlay` + 12px 模糊 + 1px `--dsw-alias-border-l1` + 轻阴影；**同一屏只允许这一个玻璃浮层** |
| 动效 | 进入 140ms（opacity + translateY(-4px)），退出 100ms |

菜单项（顺序固定）：

| # | 文案 | 出现条件 | 行为 |
|---|---|---|---|
| 1 | 继续上一局／次行：《{gameName}》 · 上次 {relativeTime} | 存在可继续存档或暂停游戏 | `selectPanel('dsh-game-market')`，页面状态进入 Runtime 并恢复存档 |
| 2 | 选择游戏 | 总是 | 进入 Market 首页，不自动打开任何游戏 |
| 3 | 忽略此次 | `running` 或 `resume` 态 | 关闭菜单，写入忽略标记 |

键盘：`ArrowUp/Down` 循环，`Home/End` 首尾，`Enter/Space` 执行，`Esc` 关闭并把焦点还给 chip；点击菜单外任意位置关闭；菜单打开时 chip 标 `aria-expanded="true"`。**任何菜单项都不在 hover 时自动展开下一级。**

菜单项状态：默认透明；悬停与焦点用 `--dsw-alias-interactive-bg-hover`，焦点另加 2px 内嵌环；按下再加深 4%；不可用项直接不渲染，不显示灰项；加载、空、错误态不适用。

#### 9.1.5 不自动打开、忽略频控与等待态 popover

- **不自动打开游戏**是硬约束。chip 只打开菜单；菜单第 2 项只进 Market 首页；除用户明确点击“继续上一局”外，任何状态变化都不会导致 `selectPanel('dsh-game-market')`。
- 忽略标记按 `{sessionId, turnKey}` 存储，`turnKey` 取 `turnId`，缺失时用 `since`。忽略后 chip 与 `running` 点隐藏，直到新 `turnKey`；`waiting-user` 与“完成未读”不受影响。
- 忽略时给 **1600ms** 轻提示“本次不再提醒”，不提供撤销；主动入口永远可用。
- V1 不提供长期“少提醒”偏好（不做设置项）；若内测反馈打扰，V1.5 再评估按天/按类型的抑制规则。
- 等待态 chip 点击先幂等执行 `selectPanel(null)`，再打开 236px popover：标题“Agent 在等你”，正文按类型区分，主按钮“回到会话处理”，次按钮“稍后处理”（只关闭，状态保持）。**不聚焦其它插件的原生控件**（**待验证 Spike S-22**；降级为只保留说明与“回到会话”）。

#### 9.1.6 Sidebar 状态点

`sidebar.panellist` 图标按 `order: 40` 注册（最终值以 S-21 实测为准）。状态点画在自己的图标组件内，不假设宿主提供 badge API。

| 状态 | 形状 | 颜色 | 动效 | 清除时机 |
|---|---|---|---|---|
| `running`（已过 5s，未忽略） | 5px 实心圆，位于图标右上角内缘 | `--dsw-alias-label-secondary` | 无 | 离开 running、被忽略、或用户进入 Game Market 面板 |
| `waiting-user` | 8px 圆环（2px 描边，中心透明），外扩到图标右上角外缘 2px | `--dsw-alias-brand-primary` | 2.4s 呼吸（透明度 0.65→1）；reduce-motion 下静止 | 状态离开 waiting-user |
| 完成未读 | 6px 实心圆 + 1px 同色外环，落在图标右上角外缘 | `--dsw-alias-brand-primary`（若主题提供正向语义色则优先） | 无 | 用户打开会话（`selectPanel(null)`）或点击 chip 后 1s |

- 三种状态形状不同（实心点／圆环／带环实心点），不只靠颜色；同时更新 `aria-label`。
- 面板为 `dsh-game-market` 时不叠加 `running` 点；`waiting-user` 与“完成未读”仍显示（此时没有小鲸鱼）。
- 多 Session 下状态点**只反映当前选中 Session** 的绑定状态（D-006），不做跨 Session 聚合；切换 Session 时 200ms 内更新。
- 图标可聚焦（`tabindex="0"`，`Enter/Space` 等同点击）。若宿主容器不接受内部状态点或焦点（**待验证 Spike S-21**），降级为描边变色 + `aria-label`／tooltip，不新增 DOM。

#### 9.1.7 与主动入口、Market 面板、多 Session 的关系

- **主动入口不受抑制。** Sidebar 图标永远可点，忽略、短任务、快照陈旧都不影响。
- **用户已在 Game Market 面板时 chip 不显示**：`main` 只渲染当前 key，Conversation 连同 header 卸载（F-05）。Runtime 内由小鲸鱼承担；Market／My Games／详情浏览态由 9.2.7 的 32px 等待提示条承担（D-025），其余状态只留 Sidebar 状态点。
- **多 Session：只显示绑定 Session。** chip 跟随当前会话；状态点跟随当前选中 Session；其它 Session 即使进入 waiting-user 也不显示、不播报、不切面板（D-006）。当前面板为 Market 时，“当前 Session”仍是进入前的那个（F-04）。
- **边界：** 侧栏折叠时 chip 仍在（属于会话头），状态点随图标隐藏；系统通知、Dock 角标、菜单栏图标均**不在 V1 范围**。

#### 9.1.8 键盘、焦点与动效

- Tab 顺序：会话标题前先到 chip（DOM 在标题之前），再到会话头其余控件；chip 是唯一新增的 Tab 停靠点。
- chip 出现**不抢焦点**；chip 消失时若焦点在 chip 上：先关闭菜单，再把焦点移到侧栏 Game Market 图标（我们自己的可聚焦元素）；图标不可聚焦时退化为 `document.body` 并播报“等待入口已关闭”（降级路径需与 S-21 一起验证）。
- 动效：出现 160ms（淡入 + 下移 4px），消失 120ms；内容切换 240ms 交叉淡入、宽度 180ms；reduced-motion 统一 100ms 淡入淡出。
- `aria-live`：chip 出现与完成点都不播报；`waiting` 切换用 assertive 播报一次。

### 9.2 Agent 需要用户

#### 9.2.1 完整旅程与时间预算

前置：用户正在 Game Runtime 中；当前 Session 的 Agent 进入 `waiting-user`。所有耗时为目标值（p95），不是平均值。

| # | 步骤 | UI | 文案 | 预算 |
|---|---|---|---|---|
| 0 | Host 识别 | 无 UI | — | Host 侧 ≤ 300ms；Client 轮询最多 +1000ms |
| 1 | 小鲸鱼醒来 | 一次性 600ms 抬升 + 光环出现，不循环弹跳 | 气泡展开前 120ms 先出现光环 | 720ms |
| 2 | 气泡展开 | 从鲸鱼左上方 220ms 展开，宽 ≤ 260px | “Agent 在等你” / “需要你确认一项操作” / “需要你回答一个问题” | 220ms |
| 3 | 用户点击 | 鲸鱼与气泡整体是按钮，热区 56×56，气泡文本区也可点 | 主行动“去处理” | — |
| 4 | 暂停 + 保存 | 气泡切换为“正在保存本局…”；鲸鱼保持等待姿态，**不显示全屏遮罩** | “正在保存本局…” | 暂停事件送达 ≤150ms（无需回包）；保存 ≤800ms（硬超时 1500ms） |
| 5 | 切回会话 | `selectPanel(null)`；面板交叉过渡 240ms | — | ≤ 1050ms |
| 6 | 原生审批/提问 | DSH 原生 UI，本插件不重绘、不覆盖、不代答 | 原生文案 | 由用户决定 |
| 7 | 处理完毕 | 快照离开 waiting-user（≤1s）后，会话头 chip 变为“继续游戏” | 继续游戏 | ≤ 1160ms |
| 8 | 点击 chip | 回 Game Market → Runtime，重新加载游戏并读档 | 加载态“正在加载《{gameName}》” | ≤ 1200ms（热）/ ≤ 2500ms（冷） |
| 9 | 恢复 | 存档应用后显示平台暂停遮罩“已恢复上一局 / 继续游戏”，**不自动 resume**；用户点击后才开始（D-024） | “已恢复上一局” | 存档读取 ≤ 150ms；点击后 ≤ 100ms 开始 |

点击到看见原生审批 UI 目标 ≤ 1.2s；任何一步 > 2.5s 必须有可见进度说明。

**恢复策略区分：** 首次从 Market／等待入口进入游戏时正常自动开始（开场逻辑由游戏负责）；只有从“处理 Agent”或“查看结果”离开后返回时进入暂停恢复态。Runtime 用 `launch.mode = 'resume-paused'` 区分两条路径，不靠路径猜测。

#### 9.2.2 离开协议：暂停与保存

Runtime 收到“离开”意图（点击鲸鱼、点击“保存并返回工作”、面板切换、窗口失焦、`visibilitychange`）后执行同一套协议：

1. 发送 `pause` 生命周期事件；不等待回包（见 8.4 事件表），最多等待 150ms 后继续保存流程。
2. 发送 `before-save` 事件，由游戏在该窗口内调用 `storage.save`；平台最多等 1500ms，上限 1MB（D-005）。Runtime 读不到游戏内部状态，不能替游戏判断是否 dirty。
3. 成功写入 `pausedGame` 后才导航；失败则**默认不导航**，走失败处理。

| 失败情形 | UI | 可选操作 | 默认焦点 |
|---|---|---|---|
| 游戏未响应 `pause` 但保存成功 | 不打断，直接切走；诊断记录 `pause-unacked` | — | — |
| 保存失败／超时（游戏仍响应） | 对话框：“暂时无法保存”／“当前进度没有保存成功。现在离开可能丢失最近 30 秒的进度。” | 重试保存（主）／留在游戏／仍然离开 | 重试保存 |
| 游戏完全无响应（暂停与保存都超时） | 同上，但正文改为“游戏没有响应。现在离开可能丢失本局进度。” | 留在游戏（主）／仍然离开 | 留在游戏 |
| iframe 已崩溃或包已失效 | 无需保存，直接切走；返回时按加载失败处理 | — | — |
| `waiting-user` 期间保存失败 | 同上，**不因“Agent 着急”而自动切走** | 重试／仍然离开 | 重试 |

- **禁止带病切走**：除用户显式点“仍然离开”外，任何自动路径都不得在保存未确认时离开。点击鲸鱼后按钮进入 500ms busy 态，吸收重复点击。
- “仍然离开”写入 `saveGap` 诊断，下次进入时提示一次“上次未能保存，已从更早的存档恢复”。
- 若游戏不支持 storage 能力（Manifest 未声明），跳过保存，只暂停。
- “继续游戏”只在 `pausedGame` 存在时出现；10 分钟后过期，但**存档与未结束 Session 仍在**，My Games 的 Continue 不受影响（D-004）。

#### 9.2.3 用户在游戏中忽略提示

| 行为 | 规则 |
|---|---|
| 气泡是否保持 | 保持。等待态是最高优先级，气泡不会自动消失 |
| 位置 | 固定在鲸鱼左上方，不随游戏内容滚动、不跟随鼠标、不重复居中弹出 |
| 尺寸 | 宽 ≤ 260px，高 ≤ 96px；不因状态更新而改变大小，避免遮挡变化 |
| 重复提示 | 不重复弹、不重复播报、不再播放提示音（出现时最多 1 次、音量 ≤ 60%，且仅在用户已有交互后） |
| 45 秒后 | 气泡收拢为鲸鱼旁的 56×28 胶囊“需要你”，文本与 `aria-label` 保留；点击恢复展开 |
| 游戏操作 | 气泡不拦截游戏输入（除气泡自身区域），不暂停游戏，不改游戏焦点 |
| 状态更新 | 若等待类型从 approval 变为 question，只更新气泡正文，不重播动画，不重置 45 秒计时 |
| 用户处理完 | 气泡 240ms 收起，鲸鱼回到 running；不弹“已完成”类提示 |

#### 9.2.4 处理完但不回游戏

- chip 保持“继续游戏” 10 分钟，之后回到 `hidden`；期间用户可正常继续工作。
- 会话内没有小鲸鱼，不做提醒。
- 下次进入 My Games，该游戏仍显示 **Continue**（未结束 Session + 存档，D-004）。
- 若 Agent 在同一 turn 内再次进入 waiting-user，chip 重新变回“需要你处理”，并重新计时。
- 点击“继续游戏”后：加载 + 读档 → 显示暂停遮罩 → 用户再点“继续”才开始（D-024），避免突然出声或突然开始计时。

#### 9.2.5 对照：Agent 完成后从游戏返回

| 对比项 | 需要用户（本旅程） | 任务完成 |
|---|---|---|
| 触发 | `waiting-user` | `completed` |
| 游戏 | 必须暂停并保存后才离开 | **不自动暂停**，游戏继续跑 |
| 鲸鱼 | 醒来、光环、持续等待 | 240ms 柔和变化，气泡“任务完成啦 / 查看结果” |
| 离去方式 | 点击后立即执行离开协议 | 点击“查看结果”才执行同一套离开协议 |
| 返回后 chip | “继续游戏”，10 分钟 | “继续游戏”，10 分钟（同样由 `pausedGame` 驱动） |
| 重复提醒 | 不重复 | 不重复催促；气泡 12s 后收为“任务完成”胶囊，点击可再展开 |
| 强制力 | 无，用户可继续玩 | 无，用户可继续玩 |

#### 9.2.6 无障碍

- 等待态用 `aria-live="assertive"` 播报一次；气泡 `role="status"`，鲸鱼 `aria-label` 随状态更新。
- 状态切换不重建 DOM，鲸鱼始终是同一个可聚焦元素。
- 保存失败的对话框 `role="alertdialog"`，焦点默认在“重试保存”，`Esc` 等同“留在游戏”。
- 45 秒收拢后不重复播报，`aria-label` 保持完整。

#### 9.2.7 Market 面板内的等待提示（D-025）

用户正在 Market／My Games／游戏详情浏览时，Agent 进入 `waiting-user`，由面板顶部一条 32px 提示条承担提醒；游戏中仍由小鲸鱼承担，不显示该提示条。

- 位置：面板内容顶部、sticky header 之下；高度 32px；通栏到内容区内边距。
- 内容：左侧小鲸鱼轮廓图标 + “Agent 需要你处理一下” + 右侧文字按钮“去处理”。
- 点击“去处理”：执行 9.2.2 的离开协议（Market 无运行中游戏，因此只需 `selectPanel(null)`），切回 Conversation。
- 出现动效：120ms 淡入 + 4px 下移；不抢焦点、不遮挡内容（内容区整体下移 32px）；`aria-live="polite"` 播报一次。
- 只显示 `waiting-user`：`running` 不显示（由 Sidebar 状态点表达），`completed` 不显示（Market 内不重复提醒）。
- 收起：状态离开 `waiting-user` 自动收起；切换页签/滚动不消失；不提供“忽略”（等待用户是最高优先级，但仍不阻塞浏览）。

### 9.3 Market 首页

#### 9.3.1 页面结构

面板占满 Main 区，自行滚动，不嵌套滚动容器。顶部是 52px 的 sticky 头部，其余按顺序（等待用户时，头部下方额外插入 9.2.7 的 32px 提示条，不计入下列结构）：

```
Header（52px）：返回会话 · 标题 · Market／My Games 切换 · 搜索 · 同步状态
Hero / Continue Playing（组合区）
Recently Played
Quick Play
Popular
New
全部游戏（分类筛选 + 网格）
页脚状态（同步时间、离线条）
```

`Hero / Continue Playing` 合并：有可继续存档时 Hero 是该游戏的横向大卡，没有时变成平台介绍位。

#### 9.3.2 栅格与首屏

尺寸按 1rem = 16px 给出、实现用 rem；面板根节点用容器查询（`container-type: inline-size`），断点按**主列宽度**。

| 主列宽度 | 列数 | 间距 | 卡片封面比例 | Hero |
|---|---|---|---|---|
| ≥ 1080px | 4 | 20px | 3:2 | 1120×248，封面 340×191 在左 |
| 840–1079px | 3 | 20px | 3:2 | 高度 232，封面 300×169 |
| 600–839px | 2 | 16px | 3:2 | 封面置顶、信息在下，总高 ≤ 320 |
| < 600px | 1 | 16px | 16:9（减少纵向占用） | 同上，封面 16:9 |

1440×900、侧栏展开 280px 时的首屏：

- 主列 1160px，左右留白 20px，内容宽 1120px（上限 1120px）。
- Header 52 + 顶部 24 + Hero 248 + 区间距 44 + 区块标题 28 + 12 + 卡片 205 ≈ 613px。
- 首屏可见 Hero、Quick Play 整行、Popular 标题与第一行上半部分；**不**在首屏塞入 New 或全部分类。
- 页面级留白：区块之间 44px，标题与内容 12–14px，左右 20px；不使用分隔线或卡片外框划分区块。

#### 9.3.3 区块数据与排序

| 区块 | 数据来源 | 排序 | 数量 | 空状态 |
|---|---|---|---|---|
| Hero / Continue | 本机未结束 Session + 存档（D-004） | `lastPlayedAt` 倒序，取第一条 | 1 | 平台介绍：“挑一个游戏，等 Agent 的时候玩” + “浏览游戏” 按钮 |
| Recently Played | 本机 `installations.lastPlayedAt`（已安装且玩过） | `lastPlayedAt` 倒序 | 8 | 整块隐藏，不显示空文案 |
| Quick Play | Registry `quickPlay: true`（人工标记）；已安装游戏优先 | 累计 `playCount` 倒序 → 上架时间 → 名称 | 8 | 整块隐藏，不显示空文案 |
| Popular | Registry `featured: true`（人工精选；V1 不采集下载量） | 编辑顺序 → `publishedAt` 倒序 | 8 | Registry 无 featured 时整块隐藏 |
| New | Registry `publishedAt` 近 90 天 | 倒序 | 8 | 整块隐藏 |
| 全部游戏 | Registry + 本机安装信息合并 | 已安装优先 → 名称（`Intl.Collator`） | 全部 | “暂时没有可显示的游戏” + 重试 |

字段名以 8.2／8.8 为准。

- Hero 与 Quick Play 不重复；Popular 与 New 可以重复，不做去重。
- 任意区块的已安装游戏都带“已安装”标记，有更新时带“有更新”（见 9.3.4）。
- 排序不因 Hover、过滤、窗口变化而重排；筛选只作用于“全部游戏”。

#### 9.3.4 游戏卡片

| 元素 | 默认 | 悬停 | 焦点 | 按下 | 加载 | 禁用／错误 |
|---|---|---|---|---|---|---|
| 封面 | 3:2，圆角 14px，1px 8% 边框，无阴影 | 放大 1.02（160ms），阴影加深一档 | 整卡 2px focus ring，offset 2px | 缩放 0.995（90ms） | 同尺寸骨架块 | 加载失败显示占位渐变 + 名称，仍可点进详情 |
| 名称 | 14px / 600，单行截断 | 保持 | 保持 | 保持 | 12px 灰条 | 保持 |
| 辅助信息 | 12px secondary，单行：`作者 · 类型` | 保持 | 保持 | 保持 | 10px 灰条 | 保持 |
| 已安装标记 | 封面右上角 16px 勾形圆点，`aria-label="已安装"` | 同左 | 同左 | 同左 | — | — |
| 更新标记 | 封面左上角 8px 圆点 + hover 时“有更新”文字 | 显示“有更新” Pill | 保留 Pill | 保留 Pill | — | — |
| 悬停操作 | 不显示 | 封面右下角 32px 玻璃圆钮：已安装→Play／Continue 图标；未安装→箭头（进详情） | 常显（焦点在卡片上） | 按下态 | — | — |

- 点击整卡进详情；悬停圆钮只在已安装时直接启动，未安装不提供一键安装。
- 卡片文本最多两行（名称 + 一行元信息），**任何情况下不超过三行**。
- 卡片是链接语义（`<a>` 或 `role="link"`），可访问名称为“游戏名，作者，类型，已安装／有更新”。
- Hover 只改变封面与阴影，不做整卡上浮超过 2px，不做旋转、倾斜、持续漂浮。

#### 9.3.5 搜索与分类

- 入口在 header 右侧：默认 200px 宽输入框；宽度 < 840px 时折叠为 32px 图标，点击展开为覆盖式 280px 输入。
- 输入防抖 **150ms**，在本地 catalog 上过滤：名称、作者、类型、标签，大小写不敏感，支持前缀与子串；不做分词与拼音。
- 输入 ≥1 字符即进入结果态：隐藏 Hero/Quick/Popular/New，显示“全部游戏”网格与结果计数“N 个结果”。清空后 120ms 恢复原结构。
- 无结果：“没有找到相关游戏” + “清除搜索”按钮；搜索框保持焦点。
- `Esc` 第一次清空，第二次失焦；`/` 在非输入状态下聚焦搜索框（DSH 内不抢占已聚焦的输入框）。
- 搜索框状态：默认 placeholder；聚焦 2px ring + `--dsw-alias-bg-layer-1`；有输入时显示清除按钮；无结果见空态；不提供禁用态。
- 分类筛选：`全部` + Manifest `categories` 枚举（Arcade / Puzzle / Card / Idle / Action / Strategy / Trivia / Sandbox），单选 chip，作用于“全部游戏”。`DSH-native` 类内容 V1 不在首发名单（见 7.3），暂不设分类。选中态用背景 + 文字 + 左侧 4px 指示条三重表达，不只靠颜色。
- 分类 chip 键盘：左右箭头移动，`Enter/Space` 选中，`Home/End` 首尾。

#### 9.3.6 加载、空、离线与错误

| 情形 | 表现 | 恢复 |
|---|---|---|
| 首次加载 | Header 立即可用；内容区 8 张卡片骨架，1.4s 循环微光；**延迟 300ms 才显示骨架**，避免闪白 | 数据到达后 160ms 淡入 |
| 加载 > 800ms | 骨架下方出现“正在加载游戏列表”，不阻断滚动 | — |
| 加载失败 | 内容区错误块：“游戏列表加载失败” + “重试”；已安装游戏列表照常显示 | 手动重试；不自动重试 |
| 离线 | 内容区顶部 32px 条幅：“离线模式，仅显示已安装游戏” + “重试”；Hero 仍可用（本地数据）；Popular/New 隐藏 | 重新联机后自动刷新一次 |
| 无已安装且离线 | 空态：“还没有安装任何游戏” + “重试” | — |
| Registry 部分字段缺失 | 该游戏从对应区块剔除，不显示“未知”占位；本地已安装游戏不受影响 | 下次同步修正 |

离线条幅不 sticky 在 header 下方遮挡内容，随内容滚动；header 右上角保留一个 6px 的离线状态点作为持续提示。

#### 9.3.7 键盘与红线

- Tab 顺序严格等于视觉顺序：返回会话 → Market/My Games → 搜索 → Hero 主按钮 → 各区块卡片 → 分类 chip → 页脚重试。区块标题不可聚焦。
- 网格内 `Arrow` 四向移动焦点，`Home/End` 行首行尾，`Enter` 打开详情；从卡片按 `Tab` 回到正常文档顺序。
- 红线（违反即视为设计不通过）：

1. 卡片不超过 3 行文本；不展示价格、评分星、文件大小、权限、更新时间。
2. 不做自动轮播、自动播放预告片、视差滚动。
3. 一屏内主色 CTA 不超过 2 个（Hero 的 Continue 与搜索态除外）。
4. 不用边框把每个 Section 封成卡片；只靠标题、间距、对齐分组。
5. 不以毛玻璃作为内容层材质；玻璃只出现在菜单、浮层、悬停圆钮。
6. 首屏区块不超过四个，不堆排行榜与推荐理由。
7. 不做“更多类似游戏”“标签云”“评测摘要”。

### 9.4 My Games

#### 9.4.1 排序

等待用户时，列表上方插入 9.2.7 的 32px 提示条。固定顺序，不提供用户切换（V1）：

1. 有未完成 Session 的游戏（D-004），按 `lastPlayedAt` 倒序。
2. 其余已安装游戏，按 `lastPlayedAt` 倒序。
3. 从未游玩的，按 `installedAt` 倒序。
4. 完全同值时按名称 `Intl.Collator` 升序。

更新与安装中状态不改变排序；新装游戏插入第 3 段，不置顶。

#### 9.4.2 行结构与信息

| 元素 | 规格 |
|---|---|
| 行高 | 72px（< 600px 时 80px，两行布局） |
| 封面 | 64×48（4:3），圆角 10px |
| 名称 | 14px / 600，单行 |
| 进度摘要 | 12px secondary，单行；有分数能力且上一局有分数时“上一局 {score} 分”，否则“继续上次进度”（V1 不要求游戏上报自定义进度文本） |
| 最近游玩 | 12px tertiary，相对时间（“2 小时前”），绝对时间放 `title` |
| 个人最高分 | 12px，仅在存在时显示“最高 {score}” |
| 更新标记 | 名称后 8px 圆点 + “可更新至 {version}”，12px |
| 主按钮 | 高 32px，宽 ≥ 76px；Continue 为填充主色，Play 为描边 |
| 更多菜单 | 28×28 图标按钮，位于行尾；`aria-label="更多操作"` |
| 行状态 | 默认透明；悬停 `--dsw-alias-interactive-bg-hover`；焦点 2px ring 包围整行；按下背景加深 4%；安装中显示进度条替代按钮；更新中按钮变“更新中…”并禁用 |

#### 9.4.3 Continue / Play 切换（对齐 D-004）

| 条件 | 主按钮 | 次按钮／附加 |
|---|---|---|
| 未结束 Session + 可读存档 | **Continue** | 更多菜单里“重新开始”（二次确认，明确会覆盖当前进度） |
| 已安装、无未结束 Session | **Play** | — |
| 有更新 | **Continue / Play 保持主按钮** | 名称旁“更新”文字按钮（ghost，32px 高） |
| 更新与当前 Runtime 不兼容 | 主按钮保持 | “更新”禁用，`title` 说明需要更新的 Runtime 版本 |
| 安装中 | 无主按钮，行内进度条 | 可取消（见 9.5） |
| 包缺失／损坏 | **重新安装** | 更多菜单“卸载” |

- 中文只在这两组词间切换，**不混用**：My Games 用“继续／开始”，详情用“继续游戏／开始游戏”；英文对应 Continue／Play。
- 点击直接进入 Runtime；加载失败回到列表并保留滚动位置。

#### 9.4.4 卸载、删除数据与更新

- **卸载**：菜单 →“卸载”，弹窗标题“卸载《{gameName}》？”、正文“存档和最高分会保留…”，主按钮“卸载”（destructive），默认不删数据。
- 弹窗内提供勾选项“同时删除存档与成绩”，默认**不勾选**；勾选后正文追加“此操作不可撤销”，主按钮文案变为“卸载并删除数据”。
- **删除游戏数据**：菜单 →“删除游戏数据…”，弹窗标题“删除《{gameName}》的游戏数据？”、正文“存档、最高分和历史成绩将被永久删除，无法恢复。”；主按钮“永久删除”，二次点击才执行。
- **更新**：点击后按钮进入“更新中…”，行内显示百分比；成功后 1600ms toast“《{gameName}》已更新至 {version}”；失败恢复“更新”按钮并显示“更新失败”文字 4s。
- **内置游戏**（如 `snake`）：菜单不显示“卸载/删除游戏数据”，或显示为禁用并注明“内置游戏不可卸载”。
- 菜单键盘：`Shift+F10` 或右方向键打开，`Esc` 关闭并把焦点还给菜单按钮。

#### 9.4.5 空、加载、错误与键盘

| 状态 | 表现 |
|---|---|
| 空 | 插画位（48px 小鲸鱼轮廓）+ “我的游戏还是空的” + “去市场看看” 主按钮；不显示排序控件 |
| 加载 | 6 行骨架（64×48 + 两条文本条），延迟 250ms 显示 |
| 错误 | 行区域错误块：“游戏库加载失败” + “重试”；不隐藏已缓存的行 |
| 安装中 | 行内 2px 进度条 + 阶段文案，行不可点击进入详情（避免半装状态启动） |

键盘：Tab 只经过行内主按钮 → 更多菜单，行本身不进 Tab 序列；主按钮上 `ArrowUp/Down` 跨行移动；`Delete` 不绑定删除。焦点从详情返回时回到原行。

### 9.5 游戏详情与安装

#### 9.5.1 页面结构

```
Sticky 顶栏（52px）：返回 · 面包屑（Market / 游戏名） · 更多（卸载、删除数据）
Hero：16:9 或 21:9 封面，最高 320px，底部 64px 渐隐遮罩
内容两栏（≥ 900px）：左主栏（最大 680px） / 右操作栏（320px，sticky top 72px）
  左：标题 28/600 · 作者 13 · 简介 15/1.7 · 预览图（最多 3 张） · 类型与标签
  右：唯一 Primary Action 40px · 版本/大小/更新时间 · 权限 · 本地排行榜预览
```

- 等待用户时，页面顶部插入 9.2.7 的 32px 提示条，Hero 下移。
- 主列 < 900px 时操作栏移到标题下方，变成 64px sticky 底栏。
- 简介超过 6 行折叠，出现“展开”；用渐变遮罩 + 120ms 展开，避免高度跳变。
- 预览图点击打开 90% 视口浮层，左右箭头切换，`Esc` 关闭，焦点回到原图。
- 排行榜预览只显示本地 Personal Best 与最近 3 条成绩；没有成绩时整块隐藏，不显示空榜。

#### 9.5.2 唯一 Primary Action 状态矩阵

| 游戏状态 | Primary Action | 次要操作 | 禁止／说明 |
|---|---|---|---|
| 未安装 | **安装**（填充） | 无 | 点击立即开始安装，不弹确认（V1 无危险权限） |
| 安装中（下载） | **取消安装**（同一按钮变描边，右侧显示百分比） | 无 | 按钮不可再次触发安装；进度条在按钮下方 2px |
| 安装中（校验/落位） | **取消安装** | 无 | 取消后清理半成品目录 |
| 安装失败 | **重试** | “查看原因”（ghost） | 显示失败阶段与诊断编号 |
| 已安装、无未结束 Session | **开始游戏** | 更多菜单：卸载、删除数据 | — |
| 已安装、有未结束 Session + 存档 | **继续游戏** | 更多菜单：重新开始 | 重新开始必须二次确认 |
| 有更新 | **更新** | “先玩当前版本”（ghost 文字按钮） | 更新期间主按钮变“更新中…”并禁用 |
| 更新不兼容 | **开始游戏／继续游戏** | “更新不可用”（禁用） | 禁用原因：“需要 Game Runtime {version} 或更高版本” |
| 不兼容（首次安装） | **不兼容**（禁用） | “检查更新” | 主按钮下方 12px 说明原因；不提供绕过 |
| 包缺失／损坏 | **重新安装** | 卸载 | 存档保留提示 |
| 加载中 | 160×40 骨架按钮 | — | 详情内容也显示骨架 |
| 已在本会话暂停该游戏 | **回到游戏** | 更多菜单 | 优先于上一行；与“继续游戏”同义，仅补充“已暂停”状态行 |

硬性规则：

1. 右栏（或窄屏底栏）**只有一个**主按钮；其它操作降级为文字按钮或收进更多菜单。
2. 主按钮撑满 320px 栏，高 40px，文字 14px / 600，加载态宽度不变。
3. 主按钮不因 Hover 放大；悬停提亮一档，按下压暗 4%。
4. 禁用按钮对比度 ≥ 4.5:1，且必须同时给出原因文本。
5. 安装动作不得自动开始游戏，完成后由用户点“开始游戏”。
6. 内置游戏（`source: 'builtin'`）不提供卸载与删除数据入口，详情页只保留“开始游戏/继续游戏”。

#### 9.5.3 安装流程与阶段

| 阶段 | 显示 | 进度 | 超时 |
|---|---|---|---|
| 准备 | “准备中…” | 不确定 | 10s（等安装锁） |
| 下载 | “下载中 {percent}%” | 有 `Content-Length` 时确定；否则“下载中…” | 总 120s；20s 无字节增长 → 失败 |
| 校验 | “校验中…” | 不确定 | 15s |
| 落位 | “正在安装…” | 不确定 | 30s |
| 完成 | 按钮变“开始游戏” | 100% 停留 240ms | — |

- 进度条用 `transform: scaleX()` 而非 `width`，避免布局；数字每 200ms 最多更新一次。
- 下载阶段可取消；校验与落位阶段取消按钮仍可用，但文案变为“取消并清理”。
- 安装失败文案按阶段区分：“下载中断，请重试”／“文件校验未通过”／“安装包写入失败”；保留诊断编号。
- 安装进度不弹全局通知或 Modal。
- **待验证 Spike S-24**：Host 下载是否提供字节级进度回调。没有时全部阶段显示不确定进度，并用“正在下载…”替代百分比，总时长按包大小给出“约 {size} / 预计 {seconds} 秒”。

#### 9.5.4 权限展示

- 权限是详情页固定信息，不折叠进“更多”，位于元数据下方。
- V1 只有 `storage` 与 `score`，展示一行：“可保存游戏进度与成绩”，下方 11px 说明：“不访问文件、网络或对话内容。”（D-011／D-014）
- 没有额外能力时显示“不需要额外权限”。
- **安装时不弹权限确认**：V1 无危险权限，弹窗只增加摩擦；未来出现网络、Agent 上下文等能力时必须改为安装前确认页（V1.5）。
- 若本地已有游戏的 Manifest 能力声明与当前 Runtime 不匹配（典型情况是 Runtime 降级后打开）：详情页显示“此游戏需要更新版本的 Game Market”，主按钮禁用；安装期这类包已在 8.2.7 被拒绝，不会进入 Market。

#### 9.5.5 完成反馈、返回与错误

- 安装完成：按钮 200ms 交叉淡入为“开始游戏”；右上角 3000ms toast“《{gameName}》已安装 · 开始游戏”（可点击），不自动跳转。
- 返回：返回按钮、`Esc`、窄屏底栏都可回上一页；**保留来源列表滚动位置**（模块级 store + `requestAnimationFrame` 恢复，无动画），也保留搜索词与结果。
- 详情页 `h1` 是焦点入口（`tabindex="-1"`），进入时聚焦但不显示 ring。
- 错误：游戏不存在／已下架 → “游戏不存在或已下架” + “返回市场”；离线且未安装 → “离线状态下只能查看已安装游戏” + “重试”；已安装但包缺失 → 仍展示详情，主按钮“重新安装”。
- 加载失败不整页白屏：保留 Hero 骨架与返回按钮，错误块出现在内容区。

#### 9.5.6 键盘与焦点

- 进入详情：焦点到 `h1`；`Tab` 顺序为返回 → 更多 → 预览图 → 展开简介 → 主按钮 → 次要操作 → 权限说明。
- `Esc`：先关闭预览浮层；没有浮层时返回列表。
- 安装开始后焦点停留在原按钮（label 改变，DOM 不重建），并把阶段变化以 `aria-live="polite"` 播报，最多每 5s 一次。
- 安装失败时焦点移到错误块的“重试”，但不抢在用户阅读前反复移动。
- 返回列表后焦点回到来源卡片；来源卡片已被过滤掉时，焦点到列表容器。

### 9.6 Game Runtime 运行态

#### 9.6.1 布局与游戏画布

- Runtime 占满 Main Panel，左侧 Sidebar 保留；**不注册新面板**，只切换插件内部页面状态，状态放在组件外（F-05）。
- **全出血舞台（V1.1）**：iframe 直接铺满 Main Panel，无舞台内边距、无圆角黑框、无 letterbox；不再按 Manifest `viewport` 做 `contain` 等比缩放。游戏负责绘制完整视口背景（亮/暗主题都要覆盖）。
- 顶部按 `--dsh-frame-top-clearance`（macOS 48px，其它 0）只用于**悬浮控件**定位；控件直接叠在游戏画面上，不额外占据黑色安全带。
- 平台悬浮控件安全区：**顶部全宽 112px** 放返回/暂停，**右下 96×96** 放 Agent Presence；游戏应将关键 HUD 移出这些区域。开发者规范见 `docs/developer-guide.md` §4.4。
- iframe 填满舞台：`sandbox` 按 8.4 定义，无 `allow-same-origin`；`referrerpolicy="no-referrer"`；不接收平台 header、不注入脚本到游戏内。
- `manifest.viewport` 仅作为推荐设计分辨率（`init.viewport` 为实际容器尺寸）；游戏必须响应 `resize` / SDK `viewport`，不硬编码 960×540，也不在内部再留黑边。

#### 9.6.2 悬浮控件与自动隐藏

| 控件 | 位置 | 尺寸 | 内容 |
|---|---|---|---|
| 返回 | 舞台左上，距安全带 12px | 32×32 玻璃圆钮 | 返回 Market（非会话）；长按／右键无菜单 |
| 保存状态 | 顶部右侧，手动保存左侧 8px | 高度 28px 胶囊 | “已保存”／“保存中…”／“保存失败”；失败时可点击重试 |
| 手动保存 | 保存状态右侧 | 28×28 图标钮 | 立即保存；成功后状态点闪一次 |
| 更多／暂停 | 最右 | 28×28 图标钮 | 打开 Pause 菜单 |
| 小鲸鱼 | 右下，距边缘 24px | 48×48（热区 56） | 见 9.7 |

- 自动隐藏：鼠标静止 **3000ms** 且焦点不在任何悬浮控件内、Pause 菜单未打开时，顶部控件以 160ms 淡出；鼠标移动 ≥8px 或触摸时 120ms 淡入。**小鲸鱼永不自动隐藏**。
- 悬浮控件状态：默认 70% 不透明玻璃；悬停 90%；焦点 2px ring；按下压暗 4%；无禁用态；隐藏时不接收指针事件，`Tab` 进入即显现。
- 顶部不常驻 Market 导航、排行榜、游戏介绍、Agent 日志；Runtime 中一律不存在。
- 保存胶囊不显示文件大小与路径；失败时展开 3 行说明与“重试”。

#### 9.6.3 Pause 菜单与 Esc

Pause 菜单为居中 320px 面板（非全屏遮罩，背景只做 24% 压暗，不做模糊）：

| 项 | 行为 |
|---|---|
| 继续 | 关闭菜单并触发 `resume` 生命周期；`Esc` 同效 |
| 手动保存 | 就地保存，行内显示“已保存”，菜单不关闭 |
| 保存并返回工作 | 执行 9.2.2 离开协议 → `selectPanel(null)` |
| 退出到市场 | 执行离开协议 → 回到 Market 首页（不切回会话） |
| 游戏声音说明 | 11px 灰字：“游戏内声音由游戏控制。”（V1 不提供全局静音，见 D-026） |

Esc 规则（必须精确，否则会与游戏冲突）：

| 焦点位置 | `Esc` 归属 |
|---|---|
| 平台悬浮控件、Pause 菜单、平台对话框 | Runtime 处理：菜单开→关；对话框→取消；无浮层时**不**打开 Pause 菜单（避免误触） |
| iframe 内 | 完全归游戏。父页面收不到该按键，**Runtime 不监听、不拦截、不通过 postMessage 抢** |
| 舞台容器（聚焦但未进 iframe） | Runtime 处理：打开 Pause 菜单 |

- 进入 Runtime 时焦点给舞台容器（`tabindex="0"`），不自动聚焦 iframe；首屏 2s 提示“点击画面开始，Esc 打开菜单”。
- 点击 iframe 后焦点进入游戏；回到平台控件需点击画面外或 `Tab`。跨 iframe 顺序无法保证时（**待验证 Spike S-25**），降级为舞台左上常显 1px 热区唤出控件，暂停只由按钮触发。

#### 9.6.4 生命周期

| 事件 | 动作 |
|---|---|
| 进入 Runtime（首次） | 加载包 → `ready` → 读档 → 应用状态 → 触发 `resume`（自动） |
| 进入 Runtime（从 waiting-user／查看结果返回） | 加载包 → `ready` → 读档 → 应用状态 → **暂停遮罩“已恢复上一局 / 继续游戏”**；用户点击后才 `resume`（D-024） |
| 窗口失焦 | 300ms 宽限后 `pause`；不强制保存，除非距上次保存 > 5s |
| `visibilitychange` → hidden | 立即 `pause`，2s 内完成保存 |
| 切面板／返回工作 | 离开协议（9.2.2），强制保存 |
| 30s 定时 | 发送 `before-save`，由游戏决定是否写盘（D-005） |
| 关键节点 | `waiting-user`、Agent 完成、Game Over、手动保存、窗口关闭前，各保存一次 |
| 游戏结束（`session.end`） | 结束该游戏的 Session 记录；不删除存档 |

- 自动保存失败：胶囊变“保存失败”，不弹窗；每 30s 重试，3 次后升级为一次非阻断 toast。
- 同一 gameId 只允许一个 Runtime 实例；再次启动先保存并关闭旧实例。

#### 9.6.5 加载与错误

| 状态 | 表现 | 操作 |
|---|---|---|
| 加载 < 500ms | 舞台显示游戏封面模糊底图，不显示 spinner（避免闪烁） | — |
| 加载 ≥ 500ms | 中央 24px spinner + “正在加载《{gameName}》” | 10s 后可取消 |
| 加载 10s | 文案变“加载时间有点久” + “继续等待 / 返回市场” | 不自动失败 |
| 硬超时 20s | 错误态 | 重试／返回 |
| 包缺失 | “游戏文件缺失” + “重新安装后可以继续，存档会保留。” | 重新安装／返回市场 |
| 版本不兼容 | “此游戏需要更新版本的 Runtime” | 返回市场；详情页“检查更新” |
| iframe 崩溃 | 连续 3 次心跳丢失（每 5s 一次，协议见 8.4）判崩溃：“游戏意外停止” | 重新加载（读档恢复）／返回市场 |
| 存档损坏 | “存档损坏，无法恢复” + “开始新游戏” | 开始新游戏（旧存档改名保留，不静默删除） |
| 保存失败 | 胶囊变红字 + 可重试；离开时进入 9.2.2 协议 | 重试／仍然离开 |

错误块统一为：标题、一句原因、主操作、次操作、诊断编号与复制按钮；所有错误都能返回 Market。

#### 9.6.6 Game Over、尺寸、音频、焦点与 reduced-motion

- **Game Over 由游戏决定**：平台不弹结算、不覆盖、不自动暂停。游戏 `score.submit`／`session.end` 后，仅显示 1600ms 鲸鱼旁 toast“本局已记录 · 最高 {score}”。
- 用户不结束 Session 就离开，Session 保持未结束，Continue 继续可用（D-004）。
- 尺寸变化：ResizeObserver 防抖 120ms，仅重算舞台与 iframe 尺寸，**不重载、不重置存档**；`resize` 事件是否响应由 SDK 决定。
- 音频：平台不放背景音乐；提示音最多 1 次且须用户已交互；游戏首次发声由手势触发。V1 不做平台级静音（iframe 跨域），要求游戏自带开关。
- 焦点：舞台 → 平台控件 → Pause 菜单的 Tab 顺序固定；Pause 菜单打开时焦点锁在菜单内，关闭后回到触发按钮；错误块出现时焦点移到错误标题。
- `prefers-reduced-motion`：悬浮控件不做位移动画（只透明度）；Pause 菜单 120ms 淡入；鲸鱼见 9.7；游戏内部动效由游戏自行尊重，平台不强制。

#### 9.6.7 返回工作与再次进入

- 返回会话走 `selectPanel(null)`；会话的 Session、草稿、阅读位置由宿主保留，但 DOM 选区与 IME 状态会丢（F-05），因此**不承诺光标位置**。
- Runtime 组件被卸载，所有页面状态必须在模块级 store：`{ gameId, paused, lastSaveAt, saveVersion, viewportSize, teardownReason }`。
- 再次进入一律“重新加载 + 读档”，不做 iframe 复用、不做 BFcache 依赖。读档成功后：首次进入直接开始并显示 1200ms“已恢复上一局”；从等待用户／查看结果返回时停在暂停遮罩“已恢复上一局 / 继续游戏”，用户点击“继续”后才触发 `resume`（D-024），避免突然出声或计时。
- 期间游戏被更新则按新版本读档（失败按存档损坏处理）；被卸载则提示“游戏已卸载”并回 Market。

### 9.7 小鲸鱼状态机

#### 9.7.1 状态与优先级

状态：`idle` / `running` / `tool-stage` / `waiting-user` / `completed` / `error`。优先级：

| 优先级 | 状态 | 说明 |
|---|---|---|
| 100 | `waiting-user` | 最高，覆盖其它一切；出现即中断正在播放的气泡 |
| 80 | `error` | 需要用户知道的异常 |
| 60 | `completed` | 任务完成，持续到用户处理 |
| 40 | `tool-stage` | 有意义的阶段变化，短暂显示 |
| 30 | `running` | 默认工作态 |
| 10 | `idle` | 无进行中任务 |

`tool-stage` 是 `running` 的视觉子状态，不新增顶层 GameAgentState（见 8.9）；同一时刻只渲染一个状态，低优先级事件在高优先级持续期间到达，只更新内部记录，不改变视觉。

#### 9.7.2 状态表

| 状态 | 姿态／视觉 | 气泡 | 停留 | 点击 | 持续 |
|---|---|---|---|---|---|
| `idle` | 静止，眼睛半闭，无光环，颜色降饱和 10% | “Agent 空闲” + “返回工作”（点击展开） | 4s 自动收起 | 展开气泡 | 直到有任务 |
| `running` | 4s 呼吸（body scale 1→1.012），1.6s 状态点呼吸；不晃、不跳 | “正在工作…” + “返回工作”（点击展开） | 4s | 展开气泡 | 持续 |
| `tool-stage` | running 的视觉子状态：状态点换成阶段图标（终端/放大镜/锤子等） | 固定文案来自 9.8 的 `agent.state.test/build/search/read/write/command`，**不由前端拼接、不显示工具名**；未命中用“正在工作…” | 4s 后自动收起，回 running | 展开气泡 | 单次 ≤ 6s |
| `waiting-user` | 醒来：600ms 抬升 + 光环；之后静止，光环 2.4s 呼吸 | “Agent 在等你”／“需要你确认一项操作”／“需要你回答一个问题” + “去处理” | 持续；45s 后收为胶囊“需要你” | 直接执行离开协议（不先进菜单） | 直到状态离开 |
| `completed` | 一次 240ms 柔和上浮 + 颜色回暖，之后静止 | “任务完成啦” + “查看结果” | 12s 后收为胶囊“任务完成” | 展开气泡（若收拢） | 直到用户处理或离开 |
| `error` | 一次 240ms 轻微下沉 + 描边变警示色；不闪烁 | “遇到了一点问题” + “查看” + 11px 原因 | 15s 后收为胶囊“有问题” | 展开气泡 | 直到用户处理 |

- 气泡内容永远只有“一句状态 + 一个行动”，不放长文本、不滚动、不嵌套按钮组。
- 等待态点击直达，不让用户点第二次；完成／错误态点击只展开气泡。
- 同一状态不重复播放进入动画；等待回到 running 时只平静回落。

#### 9.7.3 尺寸、位置与安全区

- 48×48，热区 56×56；悬停不放大，只提高 8% 光晕。
- 距舞台右、下边缘各 24px；舞台圆角内缘再留 8px；窗口宽度 < 600px 时距边缘 16px。
- 气泡：宽 180–260px，内边距 10×12，圆角 14px，距鲸鱼 8px，默认在左上方展开；超出视口时自动翻转到上方或左侧。
- 气泡最大高度 96px；不覆盖暂停菜单与顶部控件；与顶部控件的最小距离 12px。
- 游戏关键内容安全区：顶部全宽 112px 与右下 96×96 为常驻控件避让区；鲸鱼展开气泡可临时覆盖右下 254×184。游戏从 iframe CSS 像素边缘量起，无需访问父页 CSS 变量；V1 不提供 Manifest 自定义安全区字段。

#### 9.7.4 动效红线

1. 不持续晃动、不循环弹跳、不做旋转与摇摆。
2. 允许的循环只有两种：running 的呼吸（4s，幅度 ≤ 1.2%）与 waiting 的光环（2.4s，透明度 ≤ 0.35 变化）；其余都是一次性动画。
3. 任意 10 秒窗口内主动作不超过 1 次；不因轮询刷新重复播放。
4. 不使用音效作为状态变化的主要提示；提示音最多 1 次。
5. 不用颜色单独表达：等待=抬升+光环+文本，完成=上浮+文本，错误=下沉+描边+文本。

#### 9.7.5 reduced-motion

- 呼吸与光环停止，改为静态光晕与静态光环。
- 状态切换只做 100ms 透明度；不做抬升、上浮、下沉、缩放。
- 气泡改为直接出现（60ms 淡入），不做展开位移；收拢为瞬时替换。
- 完成与错误仍靠文案、形状、颜色三通道表达，不因降级丢信息。

#### 9.7.6 V0 占位 SVG 规格（D-007）

| 项 | 规格 |
|---|---|
| 文件 | `packages/client/assets/whale-v0.svg`，单文件，无外部引用 |
| 画布 | `viewBox="0 0 48 48"`，默认渲染 48×48，可无损缩到 24×24（侧栏与 toast 用） |
| 结构 | `<g id="whale-body">` 主体；`<g id="whale-spout">` 水柱；`<g id="whale-eye">` 眼睛；`<g id="whale-halo">` 光环（默认 `display:none`，等待态由 CSS 打开） |
| 颜色 | 全部 `currentColor` 或 `var(--game-whale-*)`；不写死品牌色，跟随明暗主题 |
| 锚点 | 视觉重心在 (24, 30)，右下角留 4px 安全边；CSS 定位以外层 56×56 容器为准 |
| 动效 | 只用 CSS 作用在外层容器与上述 `<g>`，不使用 SMIL、不内联 `<script>` |
| 可替换性 | 官方素材只需同名同 viewBox、保留 4 个 id；替换不改组件代码与状态机 |
| 验收 | 24px 下眼睛与轮廓仍可辨；灰度下能区分运行／等待／完成／错误四种状态 |

#### 9.7.7 隐藏条件

- 只在 Runtime 内渲染；离开（回 Market、回会话、切面板）即卸载。
- Market／My Games／详情页**没有**小鲸鱼；这些页面的状态由 chip、状态点与页面内状态表达。
- Pause 菜单打开时鲸鱼仍在，但降低到 70% 不透明度，避免与菜单争抢；菜单关闭后恢复。
- 错误态鲸鱼不自动消失，直到用户处理或离开 Runtime。

### 9.8 文案表（zh/en）

变量以 `{name}` 标注，均支持插值；`{count}` 为整数，`{relativeTime}` 由 `Intl.RelativeTimeFormat` 生成，`{score}` 按 locale 千分位。

| Key | 中文 | English | 场景 | 备注 |
|---|---|---|---|---|
| `entry.chip.running.resume` | Agent 正在工作 · 继续上一局 | Agent working · Resume last game | 等待 chip，有可继续存档 | 无变量 |
| `entry.chip.running.choose` | Agent 正在工作 · 选择一个游戏 | Agent working · Pick a game | 等待 chip，无可继续存档 | 无变量 |
| `entry.chip.resume` | 继续游戏 | Resume game | 离开游戏后 10 分钟内 | 无变量 |
| `entry.chip.waiting` | 需要你处理 | Needs you | Agent 等待用户 | 最高优先级 |
| `entry.menu.resume` | 继续上一局 | Resume last game | 菜单第一项 | — |
| `entry.menu.resume.meta` | 《{gameName}》 · 上次 {relativeTime} | {gameName} · Last played {relativeTime} | 菜单副行 | `{gameName}` `{relativeTime}` |
| `entry.menu.choose` | 选择游戏 | Choose a game | 菜单第二项 | — |
| `entry.menu.dismiss` | 忽略此次 | Not now | 菜单第三项 | — |
| `entry.toast.dismissed` | 本次不再提醒 | Hidden for this task | 忽略后 1.6s | — |
| `entry.waiting.title` | Agent 在等你 | Agent is waiting for you | 等待 popover 标题 | — |
| `entry.waiting.approval` | 需要你确认一项操作 | Needs your approval | popover 正文 | — |
| `entry.waiting.question` | 需要你回答一个问题 | Has a question for you | popover 正文 | — |
| `entry.waiting.action` | 回到会话处理 | Go to conversation | popover 主按钮 | — |
| `entry.waiting.later` | 稍后处理 | Later | popover 次按钮 | — |
| `entry.a11y.chip.running` | Agent 正在工作。按下打开游戏菜单 | Agent is working. Press to open the game menu. | chip aria-label | — |
| `entry.a11y.chip.waiting` | Agent 需要你处理。按下回到会话 | Agent needs you. Press to return to the conversation. | chip aria-label | — |
| `entry.a11y.sidebar.running` | Game Market，Agent 正在工作 | Game Market, agent working | 侧栏状态点 | — |
| `entry.a11y.sidebar.waiting` | Game Market，需要你处理 | Game Market, needs you | 侧栏状态点 | — |
| `entry.a11y.sidebar.done` | Game Market，有未查看的结果 | Game Market, unread result | 侧栏状态点 | — |
| `agent.state.running` | 正在工作… | Working… | 鲸鱼气泡 | 无变量 |
| `agent.state.idle` | Agent 空闲 | Agent idle | 运行态气泡兜底 | — |
| `agent.state.test` | 正在运行测试… | Running tests… | 阶段气泡 | — |
| `agent.state.build` | 正在构建… | Building… | 阶段气泡 | — |
| `agent.state.search` | 正在查找资料… | Searching the web… | 阶段气泡 | — |
| `agent.state.read` | 正在查看文件… | Reading files… | 阶段气泡 | — |
| `agent.state.write` | 正在修改文件… | Editing files… | 阶段气泡 | — |
| `agent.state.command` | 正在执行命令… | Running a command… | 阶段气泡 | — |
| `agent.state.saving` | 正在保存本局… | Saving your run… | 离开游戏时的保存提示 | — |
| `agent.state.waiting.approval` | 需要你确认一项操作 | Needs your approval | 等待气泡 | — |
| `agent.state.waiting.question` | 需要你回答一个问题 | Has a question for you | 等待气泡 | — |
| `agent.state.waiting.generic` | Agent 在等你 | Agent is waiting for you | 等待气泡兜底 | — |
| `agent.state.completed` | 任务完成啦 | Task complete | 完成气泡 | 语气与 §6.7 一致 |
| `agent.state.error` | 遇到了一点问题 | Something went wrong | 错误气泡 | — |
| `agent.action.results` | 查看结果 | View result | 完成气泡行动 | — |
| `agent.action.view` | 查看 | View | 错误气泡行动 | — |
| `agent.action.answer` | 去处理 | Handle it | 等待气泡行动 | — |
| `agent.action.returnWork` | 返回工作 | Back to work | 运行态气泡行动 | — |
| `error.generic` | 出了点问题，请重试 | Something went wrong. Try again. | 未映射错误的兜底文案 | — |
| `agent.pill.waiting` | 需要你 | Needs you | 收拢胶囊 | — |
| `agent.pill.completed` | 任务完成 | Done | 收拢胶囊 | — |
| `agent.pill.error` | 有问题 | Issue | 收拢胶囊 | — |
| `agent.toast.saved` | 本局已记录 · 最高 {score} | Run saved · Best {score} | Game Over 后 1.6s | `{score}` |
| `agent.a11y.whale` | Agent 状态：{state}。按下{action} | Agent status: {state}. Press to {action}. | 鲸鱼 aria-label | `{state}` `{action}` |
| `market.tab.market` | 市场 | Market | 顶部切换 | — |
| `market.title` | Game Market | Game Market | 页面标题与 h1 | 品牌名，不翻译 |
| `market.tab.mygames` | 我的游戏 | My Games | 顶部切换 | — |
| `market.backToChat` | 返回会话 | Back to conversation | 头部返回 | — |
| `market.section.continue` | 继续游戏 | Continue playing | Hero 标题 | — |
| `market.section.quick` | 快速一局 | Quick play | 区块标题 | — |
| `market.section.popular` | 热门 | Popular | 区块标题 | — |
| `market.section.new` | 新上架 | New | 区块标题 | — |
| `market.section.all` | 全部游戏 | All games | 区块标题 | — |
| `market.hero.empty.title` | 挑一个游戏，等 Agent 的时候玩 | Pick a game for the next wait | Hero 空态标题 | — |
| `market.hero.empty.body` | 安装后就能在这里直接继续上一局。 | Install one and pick up where you left off. | Hero 空态正文 | — |
| `market.hero.empty.action` | 浏览游戏 | Browse games | Hero 空态按钮 | — |
| `market.hero.continue` | 继续 | Continue | Hero 主按钮 | — |
| `market.hero.lastPlayed` | 上次 {relativeTime} | Last played {relativeTime} | Hero 元信息 | `{relativeTime}` |
| `market.search.placeholder` | 搜索游戏 | Search games | 搜索框 | — |
| `market.search.results` | {count} 个结果 | {count} results | 搜索结果计数 | `{count}` |
| `market.search.empty` | 没有找到相关游戏 | No games found | 搜索空态 | — |
| `market.search.clear` | 清除搜索 | Clear search | 搜索空态按钮 | — |
| `market.filter.all` | 全部 | All | 分类 chip | — |
| `market.offline` | 离线模式，仅显示已安装游戏 | Offline. Showing installed games only. | 离线条幅 | — |
| `market.retry` | 重试 | Retry | 通用重试 | — |
| `market.loading` | 正在加载游戏列表 | Loading games | 加载提示 | — |
| `market.error.title` | 游戏列表加载失败 | Could not load games | 错误块标题 | — |
| `market.empty.all` | 暂时没有可显示的游戏 | No games to show yet | 全部游戏空态 | — |
| `market.card.installed` | 已安装 | Installed | 卡片标记 | — |
| `market.card.update` | 有更新 | Update available | 卡片标记 | — |
| `market.card.play` | 开始游戏 | Play | 悬停按钮 | — |
| `market.card.continue` | 继续游戏 | Continue | 悬停按钮 | — |
| `market.footer.synced` | 更新于 {relativeTime} | Updated {relativeTime} | 页脚 | `{relativeTime}` |
| `mygames.title` | 我的游戏 | My Games | 页面标题 | — |
| `mygames.progress.score` | 上一局 {score} 分 | Last run {score} | 进度摘要 | `{score}` |
| `mygames.progress.generic` | 继续上次进度 | Continue where you left off | 进度摘要兜底 | — |
| `mygames.best` | 最高 {score} | Best {score} | 最高分 | `{score}` |
| `mygames.lastPlayed` | {relativeTime}玩过 | Played {relativeTime} | 最近游玩 | `{relativeTime}` |
| `mygames.neverPlayed` | 还没玩过 | Not played yet | 最近游玩 | — |
| `mygames.update.available` | 可更新至 {version} | Update to {version} | 更新标记 | `{version}` |
| `mygames.action.continue` | 继续 | Continue | 行主按钮 | — |
| `mygames.action.play` | 开始 | Play | 行主按钮 | — |
| `mygames.action.update` | 更新 | Update | 更新按钮 | — |
| `mygames.action.updating` | 更新中… | Updating… | 更新中 | — |
| `mygames.action.updateFailed` | 更新失败 | Update failed | 更新失败行内提示 | — |
| `mygames.menu` | 更多操作 | More actions | 行菜单按钮 | — |
| `mygames.menu.restart` | 重新开始 | Start over | 行菜单 | 需确认 |
| `mygames.menu.uninstall` | 卸载 | Uninstall | 行菜单 | — |
| `mygames.menu.deleteData` | 删除游戏数据… | Delete game data… | 行菜单 | — |
| `mygames.empty.title` | 我的游戏还是空的 | Your library is empty | 空态标题 | — |
| `mygames.empty.action` | 去市场看看 | Browse the market | 空态按钮 | — |
| `mygames.error.load` | 游戏库加载失败 | Could not load your library | 错误块 | — |
| `mygames.uninstall.title` | 卸载《{gameName}》？ | Uninstall {gameName}? | 确认弹窗 | `{gameName}` |
| `mygames.uninstall.body` | 存档和最高分会保留，重新安装后可继续。 | Saves and best scores are kept for reinstall. | 确认弹窗正文 | — |
| `mygames.uninstall.deleteData` | 同时删除存档与成绩 | Also delete saves and scores | 勾选项 | 默认关闭 |
| `mygames.uninstall.warning` | 此操作不可撤销 | This cannot be undone | 勾选后追加 | — |
| `mygames.uninstall.confirmDelete` | 卸载并删除数据 | Uninstall and delete data | 勾选删除后主按钮 | — |
| `mygames.deleteData.title` | 删除《{gameName}》的游戏数据？ | Delete game data for {gameName}? | 确认弹窗 | `{gameName}` |
| `mygames.deleteData.body` | 存档、最高分和历史成绩将被永久删除，无法恢复。 | Saves, best scores and history will be permanently deleted. | 确认弹窗正文 | — |
| `mygames.deleteData.confirm` | 永久删除 | Delete permanently | 危险按钮 | — |
| `common.cancel` | 取消 | Cancel | 通用 | — |
| `detail.back` | 返回 | Back | 详情顶栏 | — |
| `detail.action.install` | 安装 | Install | 主按钮 | — |
| `detail.action.cancelInstall` | 取消安装 | Cancel install | 主按钮 | — |
| `detail.install.cancelCleanup` | 取消并清理 | Cancel and clean up | 校验/落位阶段取消 | — |
| `detail.action.play` | 开始游戏 | Play | 主按钮 | — |
| `detail.action.continue` | 继续游戏 | Continue | 主按钮 | — |
| `detail.action.update` | 更新 | Update | 主按钮 | — |
| `detail.action.playCurrent` | 先玩当前版本 | Play current version | 次操作 | — |
| `detail.action.updating` | 更新中… | Updating… | 主按钮 | — |
| `detail.action.updateUnavailable` | 更新不可用 | Update unavailable | 禁用按钮 | — |
| `detail.action.incompatible` | 不兼容 | Not compatible | 禁用按钮 | — |
| `detail.action.reinstall` | 重新安装 | Reinstall | 主按钮 | — |
| `detail.action.checkUpdate` | 检查更新 | Check for updates | 不兼容时次操作 | — |
| `detail.action.resume` | 回到游戏 | Back to game | 主按钮 | — |
| `detail.incompatible.reason` | 需要 Game Runtime {version} 或更高版本 | Requires Game Runtime {version} or later | 禁用原因 | `{version}` |
| `detail.meta.version` | 版本 {version} | Version {version} | 元数据 | `{version}` |
| `detail.meta.size` | {size} | {size} | 元数据 | `{size}` |
| `detail.meta.updated` | 更新于 {relativeTime} | Updated {relativeTime} | 元数据 | `{relativeTime}` |
| `detail.permissions.title` | 权限 | Permissions | 权限标题 | — |
| `detail.permissions.none` | 不需要额外权限 | No extra permissions | 权限 | — |
| `detail.permissions.storageScore` | 可保存游戏进度与成绩 | Can save progress and scores | 权限 | — |
| `detail.permissions.note` | 不访问文件、网络或对话内容。 | No access to files, network or conversations. | 权限说明 | — |
| `detail.permissions.unknown` | 此游戏请求了未知权限 | This game requests unknown permissions | 权限异常 | 主按钮禁用 |
| `detail.leaderboard.title` | 本地排行 | Local leaderboard | 排行榜预览 | — |
| `detail.leaderboard.best` | 个人最高 {score} | Personal best {score} | 排行榜 | `{score}` |
| `detail.preview` | 预览 | Preview | 预览区标题 | — |
| `detail.expand` | 展开 | Show more | 简介折叠 | — |
| `detail.collapse` | 收起 | Show less | 简介展开 | — |
| `detail.loading` | 正在加载 | Loading | 详情加载 | — |
| `detail.error.missing` | 游戏不存在或已下架 | Game not found or removed | 详情错误 | — |
| `detail.error.missing.action` | 返回市场 | Back to market | 详情错误按钮 | — |
| `detail.error.offline` | 离线状态下只能查看已安装游戏 | Offline. Only installed games are available. | 详情错误 | — |
| `detail.install.stage.preparing` | 准备中… | Preparing… | 安装阶段 | — |
| `detail.install.stage.downloading` | 下载中 {percent}% | Downloading {percent}% | 安装阶段 | `{percent}`；无进度时用 `detail.install.stage.downloadingUnknown` |
| `detail.install.stage.downloadingUnknown` | 下载中… | Downloading… | 安装阶段 | 无 Content-Length |
| `detail.install.stage.verifying` | 校验中… | Verifying… | 安装阶段 | — |
| `detail.install.stage.installing` | 正在安装… | Installing… | 安装阶段 | — |
| `detail.install.done` | 《{gameName}》已安装 | {gameName} installed | Toast | `{gameName}` |
| `detail.install.done.action` | 开始游戏 | Play | Toast 行动 | — |
| `detail.install.failed` | 安装失败 | Installation failed | 错误块 | — |
| `detail.install.failed.download` | 下载中断，请重试 | Download interrupted. Try again. | 失败原因 | — |
| `detail.install.failed.verify` | 文件校验未通过 | File verification failed | 失败原因 | — |
| `detail.install.failed.write` | 安装包写入失败 | Could not write the game package | 失败原因 | — |
| `runtime.loading` | 正在加载《{gameName}》 | Loading {gameName} | 加载态 | `{gameName}` |
| `runtime.loading.cancel` | 取消 | Cancel | 加载态 | — |
| `runtime.loading.slow` | 加载时间有点久 | This is taking a while | 10s | — |
| `runtime.loading.wait` | 继续等待 | Keep waiting | 10s | — |
| `runtime.loading.back` | 返回市场 | Back to market | 10s | — |
| `runtime.action.back` | 返回市场 | Back to market | 悬浮控件 aria-label | — |
| `runtime.action.save` | 手动保存 | Save now | 悬浮控件 | — |
| `runtime.action.more` | 暂停菜单 | Pause menu | 悬浮控件 | — |
| `runtime.save.saved` | 已保存 | Saved | 保存状态 | — |
| `runtime.save.saving` | 保存中… | Saving… | 保存状态 | — |
| `runtime.save.failed` | 保存失败 | Save failed | 保存状态 | 可点击重试 |
| `runtime.save.failed.body` | 当前进度没有写入。可以重试，或留在游戏中继续。 | Progress was not saved. Retry, or keep playing. | 保存失败展开 | — |
| `runtime.pause.title` | 已暂停 | Paused | Pause 菜单 | — |
| `runtime.pause.resume` | 继续 | Resume | Pause 菜单 | — |
| `runtime.pause.saveReturn` | 保存并返回工作 | Save and return to work | Pause 菜单 | — |
| `runtime.pause.exitMarket` | 退出到市场 | Exit to market | Pause 菜单 | — |
| `runtime.pause.audioNote` | 游戏内声音由游戏控制。 | In-game audio is controlled by the game. | Pause 菜单 | — |
| `runtime.leave.blocked.title` | 暂时无法保存 | Can’t save right now | 离开失败弹窗 | — |
| `runtime.leave.blocked.body` | 当前进度没有保存成功。现在离开可能丢失最近 30 秒的进度。 | Your progress was not saved. Leaving now may lose the last 30 seconds. | 离开失败弹窗 | — |
| `runtime.leave.blocked.unresponsive` | 游戏没有响应。现在离开可能丢失本局进度。 | The game is not responding. Leaving now may lose this run. | 离开失败弹窗 | — |
| `runtime.leave.retry` | 重试保存 | Retry save | 弹窗主按钮 | — |
| `runtime.leave.stay` | 留在游戏 | Stay in game | 弹窗次按钮 | — |
| `runtime.leave.force` | 仍然离开 | Leave anyway | 弹窗危险按钮 | — |
| `runtime.error.package` | 游戏文件缺失 | Game files are missing | 错误块 | — |
| `runtime.error.package.body` | 重新安装后可以继续，存档会保留。 | Reinstall to continue. Your save is kept. | 错误块正文 | — |
| `runtime.error.incompatible` | 此游戏需要更新版本的 Runtime | This game needs a newer Runtime | 错误块 | — |
| `runtime.error.uninstalled` | 游戏已卸载 | Game uninstalled | 再次进入时 | — |
| `runtime.error.crashed` | 游戏意外停止 | The game stopped unexpectedly | 错误块 | — |
| `runtime.error.crashed.body` | 可以重新加载，最近的存档会恢复。 | Reload to restore the latest save. | 错误块正文 | — |
| `runtime.error.saveCorrupt` | 存档损坏，无法恢复 | Save data is corrupted | 错误块 | — |
| `runtime.error.saveCorrupt.body` | 可以开始新的一局。 | You can start a new run. | 错误块正文 | — |
| `runtime.error.newGame` | 开始新游戏 | Start new game | 错误块按钮 | — |
| `runtime.error.reload` | 重新加载 | Reload | 错误块按钮 | — |
| `runtime.toast.resumed` | 已恢复上一局 | Resumed your last run | 1.2s toast | — |
| `runtime.toast.saveGap` | 上次未能保存，已从更早的存档恢复 | Last save failed; restored an earlier save | 再次进入时提示一次 | — |
| `runtime.toast.narrow` | 窗口较小，放大窗口体验更好 | A larger window works better | 窄窗提示 | 每次进入一次 |
| `runtime.hint.start` | 点击画面开始，Esc 打开菜单 | Click to start. Esc opens the menu. | 进入提示 | 2s |
| `runtime.diagnostic` | 问题编号 {code} | Issue ID {code} | 错误块 | `{code}` |
| `runtime.diagnostic.copy` | 复制问题编号 | Copy issue ID | 错误块 | — |
| `a11y.installed` | 已安装 | Installed | 屏幕阅读器 | — |
| `a11y.updateAvailable` | 有可用更新 | Update available | 屏幕阅读器 | — |
| `a11y.installProgress` | 安装进度 {percent}% | Installation {percent}% | 进度条 | `{percent}` |
| `a11y.live.waiting` | Agent 需要你处理。按下按钮回到会话。 | Agent needs you. Press the button to return to the conversation. | aria-live assertive | — |
| `a11y.live.completed` | Agent 已完成任务。 | Agent finished the task. | aria-live polite | — |
| `a11y.live.error` | Agent 遇到问题。 | The agent ran into a problem. | aria-live polite | — |
| `a11y.live.returned` | 已返回会话。 | Back in the conversation. | 返回会话 | — |

### 9.9 动效与响应

#### 9.9.1 原则（实现口径）

- 动效只解释“从哪里来、到哪里去、发生了什么”，不承担装饰。
- **动画不得阻塞操作**：导航在状态写入同一帧生效，动画只是后续视觉过渡；不允许 `await animationend` 后才允许点击。
- 位移用 `transform`，透明度用 `opacity`；除进度条外不对 `width/height/top/left` 做动画。
- 同一时刻只允许一个浮层玻璃做 `backdrop-filter`，避免合成层爆炸。

#### 9.9.2 时长与缓动

| 场景 | 进入 | 退出 | 缓动 |
|---|---|---|---|
| Conversation ↔ Game Market 面板 | 240ms | 200ms | `cubic-bezier(0.2, 0, 0, 1)` |
| 卡片 → 详情（共享元素） | 280ms | — | `cubic-bezier(0.2, 0, 0, 1)`；V1 可降级为 160ms 淡入 + scale 0.98 |
| 详情 → 返回列表 | — | 200ms | 同上；滚动位置瞬时恢复，不参与动画 |
| Market / My Games 切换 | 180ms 交叉淡入 | — | `ease-out` |
| chip 出现 / 消失 | 160ms | 120ms | `ease-out` / `ease-in` |
| chip 内容切换（running → waiting） | 240ms | — | `ease-in-out` |
| 菜单 / popover | 140ms | 100ms | `ease-out` |
| 小鲸鱼状态变化 | 240ms | 240ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| 气泡展开 / 收拢 | 220ms | 140ms | 同上 |
| Pause 菜单 | 180ms | 140ms | `ease-out` |
| 安装进度条 | 200ms 线性跟随 | — | `linear`；数字 200ms 节流 |
| 骨架屏微光 | 1400ms 循环 | — | `ease-in-out`；reduce-motion 下静止 |
| Toast | 180ms | 140ms | `ease-out` |
| Hover（按钮／卡片） | 120–160ms | 同 | `ease-out` |
| 按下反馈 | 90ms | 90ms | `ease-out` |

#### 9.9.3 reduced-motion 全局降级

`@media (prefers-reduced-motion: reduce)` 下：

- 所有位移、缩放、共享元素、呼吸、光环、微光停止；保留 ≤120ms 的透明度过渡。
- 面板切换改为 120ms 交叉淡入；卡片到详情改为直接切换（0ms）+ 120ms 淡入。
- 鲸鱼只保留静态状态差异与文本；气泡瞬时出现。
- 进度条不做过渡，数字仍更新；骨架屏静态灰块。
- **不**通过 JS 读取系统偏好另造一套逻辑；以 CSS 媒体查询为准，避免闪烁。

#### 9.9.4 性能红线

- 动画期间元素保持可点击；不出现全屏 `pointer-events:none` 遮罩（Pause 菜单压暗层可点击关闭，但不阻止键盘）。
- 单帧主线程预算 ≤ 8ms；连续掉帧超过 3 帧时，放弃共享元素动画，直接切换。
- `will-change` 同时最多 3 个元素，动画结束后移除。
- 不在滚动容器内做 `backdrop-filter`；不在卡片 Hover 时改变布局（只改 transform / shadow / opacity）。
- 页面切换后 100ms 内必须可交互；骨架屏不锁定滚动。

#### 9.9.5 禁止使用的动效

1. 弹跳、回弹过冲（spring overshoot）用于按钮或卡片。
2. 旋转、摇摆、持续漂浮、呼吸以外的高频循环。
3. 自动轮播、自动播放视频、视差滚动。
4. 完成时的撒花、全屏闪光、屏幕震动。
5. 从屏幕顶部砸下的 Toast；所有提示必须从触发元素附近出现。
6. 用假进度条或循环进度模拟未知进度。
7. 页面整体淡出到黑再淡入。
8. 以“动画没放完”为由禁用按钮或延迟导航。
9. 每个状态变化都播放音效。
10. 在 reduce-motion 下仍然执行位移或循环动画。

### 9.10 无障碍与键盘

#### 9.10.1 键盘路径

| 界面 | 按键 | 行为 |
|---|---|---|
| 等待 chip | `Tab` / `Shift+Tab` | 到达／离开；chip 在会话标题之前 |
| | `Enter` / `Space` | 打开菜单或 popover |
| | `ArrowDown` | 直接打开菜单并聚焦第一项 |
| 菜单／popover | `ArrowUp/Down`、`Home/End` | 移动 |
| | `Enter/Space` | 执行 |
| | `Esc` | 关闭并回焦 chip |
| | `Tab` | 关闭菜单并继续文档顺序（不困在菜单里） |
| Market 头部 | `/` | 聚焦搜索（非输入态） |
| 卡片网格 | `Arrow` 四向 | 移动焦点 |
| | `Home/End` | 行首／行尾 |
| | `Enter` | 打开详情 |
| 分类 chip | `ArrowLeft/Right`、`Home/End` | 移动；`Enter/Space` 选中 |
| 详情 | `Tab` | 返回 → 更多 → 预览 → 展开简介 → 主按钮 → 次操作 |
| | `Esc` | 关预览；无预览时返回 |
| My Games 行 | `Shift+F10` / `ArrowRight` | 打开更多菜单 |
| Runtime | `Tab` | 舞台 → 顶部控件 → 鲸鱼；不进入隐藏控件 |
| | `Esc` | 仅焦点在平台控件时生效（见 9.6.3） |
| 对话框 | `Tab/Shift+Tab` | 焦点锁在对话框内 |
| | `Esc` | 取消（危险确认同样取消） |

#### 9.10.2 焦点管理

- 面板切换：焦点移到目标页 `h1`（`tabindex="-1"`），不显示焦点环。
- 进入详情：焦点到 `h1`；返回：焦点回来源卡片；来源不存在时到列表容器。
- 安装完成：焦点不动（仍在主按钮），只更新 label 与 `aria-live`。
- 卸载／删除确认：焦点到“取消”，关闭后回触发按钮。
- Runtime 进入：焦点到舞台；离开：有 chip 则回 chip，否则回 `body` 并播报“已返回会话”。
- **不抢占**：异步状态变化（完成、更新可用）不移动焦点，只更新 `aria-live`。
- 焦点不得被 sticky 头部或浮层遮挡：滚动时 `scroll-margin-top: 64px`。

#### 9.10.3 Esc 行为总表

| 场景 | 结果 |
|---|---|
| 菜单／popover 打开 | 关闭，回焦触发元素 |
| 预览浮层 | 关闭，回焦原图 |
| 搜索框聚焦且有内容 | 清空 |
| 搜索框聚焦且为空 | 失焦 |
| 详情页无浮层 | 返回列表 |
| Runtime 焦点在平台控件且菜单开 | 关闭菜单并恢复游戏 |
| Runtime 焦点在平台控件且菜单关 | **不动作**（不打开菜单） |
| Runtime 焦点在 iframe 内 | 归游戏，平台不处理 |
| 对话框 | 取消（等同次要按钮） |
| IME 组字中 | 一律忽略，不关闭任何层 |

#### 9.10.4 ARIA 与播报

| 元素 | 角色／属性 |
|---|---|
| chip | `<button aria-haspopup="menu" aria-expanded>`；等待态改为 `aria-haspopup="dialog"` |
| 菜单 | `role="menu"` / `role="menuitem"`；分隔线 `role="separator"` |
| 小鲸鱼 | `<button aria-label>`，label 含状态与动作；不使用 `aria-live` 自身 |
| 气泡 | `role="status"`（等待态 `role="alert"` 仅一次） |
| 状态播报 | 页面级隐藏区域 `aria-live="polite"`；等待与保存失败用独立 `aria-live="assertive"` |
| Market/My Games 切换 | `role="tablist"` / `tab` / `tabpanel`，`aria-selected` |
| 搜索 | `role="searchbox"` + `aria-label="搜索游戏"`；结果数用 polite 播报 |
| 卡片 | 链接语义；可访问名含名称、作者、类型、安装与更新状态 |
| 安装进度 | `role="progressbar"`；有百分比时 `aria-valuenow`，否则 `aria-valuetext="下载中"` |
| 对话框 | `role="dialog"` / `alertdialog`，`aria-modal="true"`，`aria-labelledby` 指向标题 |
| 错误块 | `role="alert"`，标题 `tabindex="-1"` 供聚焦 |
| 空态 | 文案在 DOM 中，不用背景图承载信息 |

播报去重：同一状态 10s 一次；进度每 5s 一次；等待态只播报一次，收拢不重复。

#### 9.10.5 对比度、状态与点击区域

- 正文（14px 及以下）对比度 ≥ 4.5:1；大字号（≥18px 或 14px 粗体）≥ 3:1；图标、边框、焦点环 ≥ 3:1。
- 明暗主题分别验证；深色下不使用纯黑背景配纯白文字，保持 DSH 主题 token。
- 玻璃气泡必须有不透明底衬（≥ 86% 不透明度）再叠模糊，保证叠在任意游戏画面上仍满足 4.5:1。
- 状态不只靠颜色：安装=勾形+可访问文本，更新=圆点+Pill，等待=形状+光环+文本。
- 最小点击区域：密集头部 28×28；常规控件 32×32；主按钮高 40；小鲸鱼热区 56×56；相邻可点元素间距 ≥ 8px。
- 焦点环宽度取 `--dsw-focus-ring-width`（默认 2px），offset 2px，不被 `overflow: hidden` 裁掉。

#### 9.10.6 窄窗口、放大字号与屏幕阅读器

- < 600px 降为单列；200% 字号下无横向滚动，名称最多两行。
- 主列 < 480px 时标签文字隐藏只留图标（保留 `aria-label`）；详情操作栏变底部 sticky。
- 屏幕阅读器文案避免符号与表情：不朗读“🐳”，用 `aria-label` 替代；`·` 不作为唯一分隔信息的手段。
- 遵循 `prefers-reduced-motion`（见 9.9.3），动画降级不丢状态信息；对比度在 Light／Dark／System 三种模式下回归 9.10.5。

## 10 验收标准与测试

本章回答三个问题：**怎么算做完了、怎么证明、坏了怎么办。** 第 8、9 章定义"做成什么样"，本章定义"如何验收"。任何"看起来能用"都不算验收通过，必须有可复现的步骤与证据。

### 10.1 验收原则与证据要求

**分级。** 每条验收项标记优先级：

- **P0**：阻塞发布。任何一条不过，对应版本不能交付。
- **P1**：允许带着已知问题发布，但必须记录在发布说明与已知问题清单中。

**证据。** 每条 P0 验收保留以下至少两类证据：

1. 可复现操作步骤（环境、前置数据、操作序列）；
2. 运行证据：录屏或连续截图（禁止用设计稿/mock 截图替代）、关键日志片段、或页面内可观察结果（DOM/控制台/文件内容）；
3. 环境信息：DSH 版本、操作系统、插件版本、游戏包版本与 hash。

**测试环境。** V0 至少覆盖 macOS 桌面；V1 发布前必须覆盖 macOS + Windows 桌面，以及 DSH 声明的其它 Web 运行形态（若支持）。每条验收在干净 profile 与干净存储目录下至少跑一遍，再在"已有存档 + 已装游戏"的升级环境跑一遍。

**Windows 专项检查（V1 前必须补跑）：** 文件权限位与 `rename` 原子性、路径分隔符与大小写不敏感、CSP/iframe 行为、窗口失焦/最小化时的 `visibilitychange`、以及无 macOS 拖拽带时的顶部布局。macOS 专属项（`--dsh-frame-top-clearance`、drag 带）不要求 Windows 复现。

**测试数据。** 准备以下固定夹具：一个 3–5 秒完成的短任务、一个 ≥30 秒的长任务、一个会触发审批的任务、一个会触发提问的任务、一个会失败的任务、两个并发 Session、一个 5 MiB/19 MiB/21 MiB 的单文件测试游戏包（正常/边界/超限）、一个引用外部子资源/网络调用的恶意测试包、一个 manifest 缺失或重复的测试包。

### 10.2 V0 验收清单

V0 只证明一条链路：**Agent 工作 → 进入游戏 → Agent 找你 → 回去工作 / 继续玩。** 以下全部为 P0。

| 编号 | 验收项 | 操作步骤 | 通过标准 |
|---|---|---|---|
| V0-01 | 插件安装与启用 | 通过 Plugins 页或开发态 patch 行安装 `dsh-game-market` | 插件行状态为已启用；无 failed/overridden；页面刷新后 Sidebar 出现 Game Market 图标；停用后图标消失、无残留样式、无 slot crash |
| V0-02 | 主面板切换 | 点击 Sidebar 图标；点击返回 | `main` 面板切到 `dsh-game-market`，左侧 Sidebar 保持；返回后回到原 Conversation，Session 不变 |
| V0-03 | 草稿与阅读位置 | 在 Conversation 输入一段草稿并滚动到中部；进入市场再返回 | 草稿文字仍在；聊天恢复到离开前的语义位置（不要求像素级一致）；明暗主题正常 |
| V0-04 | 等待入口出现 | 发起 ≥30 秒任务；观察会话头部 | Agent 持续运行满 5 秒后出现 chip；3 秒内完成的任务不出现；忽略后同一 turn 不再出现；下一次任务重新计时 |
| V0-05 | 等待入口内容 | 分别在有未完成 2048 存档 / 无存档时触发入口 | 有存档显示"继续上一局"；无存档显示"选择一个游戏"；点击后打开菜单且**不自动进入游戏** |
| V0-06 | Sidebar 状态点 | Agent 运行、需要用户、完成未读三种情况 | 图标状态点与状态一致；完成后保持"未读"直到用户查看游戏或完成提醒被处理 |
| V0-07 | 游戏加载与操作 | 从入口或 My Games 进入 2048 | 游戏占满 Main Panel 有效区域；键盘方向键有效；加载完成 ≤2 秒；除悬浮控件与小鲸鱼外无常驻平台 UI |
| V0-08 | Agent Presence 运行态 | 游戏进行中，绑定 Session 的 Agent 正在工作 | 小鲸鱼显示运行态（低频、不打扰）；不弹完成气泡；游戏操作不受影响 |
| V0-09 | Agent 完成提醒 | 游戏进行中 Agent 完成任务 | 小鲸鱼切换完成态并展开"任务完成啦 / 查看结果"；**游戏不暂停、不结束、不关闭**；点击查看结果返回 Conversation |
| V0-10 | 需要用户 → 切回处理 → 返回游戏 | 游戏中触发审批/提问 | 小鲸鱼进入等待态并提示；点击后游戏 Pause + Save，切回 Conversation 并显示 DSH 原生审批/提问 UI；处理完成后出现"继续游戏"入口；点击后回到游戏，显示暂停遮罩，确认后棋盘/分数与离开前一致（D-024） |
| V0-11 | 自动保存与 Continue | 玩到一半离开 → 关闭 DSH → 重启 → 打开 2048 | My Games 显示 Continue 与上一局分数；进入后完整恢复；存档文件 ≤1MB；保存过程无 UI 卡顿 |
| V0-12 | 保存原子性与恢复 | 在写入过程中强杀进程（或制造半写文件）；重启 | 恢复为上一份完整存档（`.bak`），不出现空档或解析错误；有明确日志 |
| V0-13 | 错误与恢复 | 构造存档损坏、包缺失、iframe 崩溃/加载超时三种情况 | 均显示可读错误态与恢复操作（重开一局 / 重新加载 / 返回）；不出现无限 loading（“活着但白屏”按 S-18 能力边界只保证无响应可恢复，见 8.10） |
| V0-14 | 多 Session 绑定 | 两个 Session：A 运行任务，进入游戏时绑定 A；B 同时运行并完成 | 小鲸鱼只反映 A 的状态；B 不触发提醒；A 完成时正常提醒 |
| V0-15 | 插件停用清理 | 游戏打开时停用插件 | 页面回到 Conversation；无残留 slot 条目、无样式残留、无报错；重新启用后存档仍在 |

**V0 退出标准：** 以上全部通过；无 P0 缺陷；至少 3 名未参与开发的用户能在无引导情况下完成 V0-04 → V0-11 全流程；已知限制写入 README。

### 10.3 V1 用户链路验收

对应 §7.5 的用户链路，拆成可执行脚本。全部 P0，除特别标注。

| 编号 | 步骤 | 预期结果 |
|---|---|---|
| U-01 | 全新 profile 安装 `dsh-game-market`，不做任何配置，打开 Market | Market 正常打开；首屏有 Continue/Quick Play/Popular/New（可为空态）；无报错 |
| U-02 | 在 Market 浏览并搜索、切换分类 | 本地过滤即时生效（≤150ms）；无结果有明确空态；滚动与返回保持位置 |
| U-03 | 打开游戏详情，点击 Install | 展示下载/校验/安装阶段进度；失败可重试；成功后按钮变为 Play；My Games 出现该游戏 |
| U-04 | 发起 ≥30 秒 Agent 任务，5 秒后点击等待入口 | 入口菜单正确；进入游戏后小鲸鱼显示运行态 |
| U-05 | 游戏过程中 Agent 完成 | 小鲸鱼完成提醒；用户选择继续玩或查看结果；两种选择都无阻塞 |
| U-06 | 触发审批，点击小鲸鱼 | 游戏暂停并存档；切回 Conversation；原生审批可处理；完成后可一键回到游戏；加载读档后显示暂停遮罩，确认后继续（D-024） |
| U-07 | 游戏中触发保存（30 秒定时/暂停/切后台） | 保存指示短暂出现；不打断操作；存档文件更新 |
| U-08 | 离开游戏、关闭 DSH、重新打开 | My Games 优先显示 Continue 与进度/最高分；恢复位置与分数正确 |
| U-09 | 完成一局并 Game Over | 分数被记录；Personal Best 正确更新；历史成绩有记录；若刷新纪录给出轻量反馈 |
| U-10 | 更新：测试 Registry 发布新版本 | Market/My Games 显示 Update；安装更新后游戏可运行；旧存档兼容；不兼容版本不自动升级并说明原因 |
| U-11 | 卸载游戏 | 二次确认；包目录清理；**默认保留**存档与成绩；重新安装后 Continue 恢复；"同时删除数据"可彻底清除 |
| U-12 | 离线（断网）打开 Market | 展示缓存列表与离线横幅；已安装游戏可正常进入；安装/更新按钮禁用并说明 |
| U-13 | 明暗主题切换、窄窗口、放大字号 | 所有页面与状态正常；无溢出/遮挡；对比度达标 |
| U-14 | 只用键盘完成：打开 Market → 进入详情 → 安装 → 开始游戏 → 暂停 → 返回 | 完整可达；焦点可见且在预期位置；Esc 行为一致 |
| U-15 | 开启系统"减少动态效果" | 空间动效降级；信息不丢失；小鲸鱼不再持续动效 |

### 10.4 V1 开发者链路验收

| 编号 | 步骤 | 预期结果 |
|---|---|---|
| DEV-01 | 在空目录执行 `npx create-dsh-game my-game --template vanilla` | 生成可运行项目；含 SDK、manifest、生命周期与自动保存示例、README；无需任何 DSH 配置 |
| DEV-02 | 本地启动 Runtime Simulator | 可切换 running / waiting-user / completed / paused / resume / clear-save；Bridge 消息可观察；游戏不依赖真实 Agent |
| DEV-03 | 修改游戏逻辑后本地预览 | 热更新或刷新后生效；控制台无 SDK 报错 |
| DEV-04 | 执行 `dsh-game build && dsh-game validate && dsh-game pack` | 产出单文件自包含 `dist/index.html` 与 `dist/<id>-<version>.html`；校验器能明确指出内嵌 manifest/包大小/自包含/版本错误；退出码非 0 时错误可读 |
| DEV-05 | 将包放入测试 Registry 并在 Market 安装 | 安装后可玩；Save/Score/Continue 均正常；SDK 握手版本正确 |
| DEV-06 | 故意制作违规包（缺 manifest、多份 manifest、外部子资源、超 20 MiB、错误 capability、旧字段） | validate 或安装阶段拒绝，并给出可操作的错误信息；不产生部分安装残留 |
| DEV-07 | 以外部开发者身份（非项目作者）从零完成到发布一个游戏 | 记录总耗时与卡点；目标 ≤30 分钟完成模板游戏到安装运行（P1） |

### 10.5 性能与资源预算

以下为目标值，测量方法为 macOS 参考机 + DSH Desktop；V1 发布前需记录实测值。

| 指标 | 目标 | 测量方式 |
|---|---|---|
| Market 面板首屏可交互 | ≤500ms（本地已缓存） | 从点击图标到首屏可见/可点击的时间戳 |
| Registry 刷新 | ≤2s（本地网络） | 从打开 Market 到列表更新 |
| 游戏包安装（5 MiB） | ≤5s | 点击 Install 到 installed 状态 |
| 2048 加载到可操作 | ≤1500ms；Snake ≤2000ms（与 8.12 的 `loadMs` 对齐） | 面板切换 → 首帧可操作 |
| 面板切换 | ≤200ms 完成视觉切换 | Performance API / 录屏逐帧 |
| Agent 状态延迟 | 入口 ≤5.5s；完成/等待提醒 ≤1.5s | Agent 事件时间 → UI 变化时间 |
| 自动保存（≤1MB） | ≤300ms（p95，与 8.12 的 `saveMs` 对齐），无明显掉帧 | 保存期间录制帧率与主线程长任务 |
| 游戏帧率 | ≥50 FPS（首发四款，参考机） | 连续 60 秒采样 |
| 暂停时 CPU | 游戏 iframe 暂停后插件空闲 CPU ≤2% | Activity Monitor/Profiler |
| 插件 Client 内存增量 | ≤50MB（不含游戏 iframe） | 关闭/打开面板对比 |
| 单游戏 iframe 内存 | ≤150MB（首发游戏） | 30 分钟游玩采样 |
| 存档容量 | 单游戏 ≤1 MiB（≤32 key、单值 ≤256 KiB）；单游戏磁盘占用 ≤40 MiB（当前版本 + 1 个回滚版本，单文件 ≤20 MiB，见 8.6.10） | 文件系统检查 |

### 10.6 失败模式与恢复测试

| 编号 | 故障 | 预期行为 |
|---|---|---|
| FM-01 | Registry 不可达/超时 | 使用缓存；显示离线横幅；已安装游戏可玩；不阻塞启动 |
| FM-02 | 下载中断/超时 | 安装失败并可重试；临时文件清理；不产生半安装 |
| FM-03 | SHA-256 不匹配 | 拒绝安装；提示完整性错误；保留旧版本 |
| FM-04 | Manifest 非法 | 安装前拒绝；给出字段级错误 |
| FM-05 | 非自包含（外部子资源/网络调用）、超大单文件、非法 manifest | 安装阶段拒绝；记录日志；不写入目标目录以外任何位置 |
| FM-06 | Runtime/SDK 版本不兼容 | 安装拒绝或 Play 禁用并说明；不自动降级/升级 |
| FM-07 | 存档写入失败（磁盘满/权限） | 游戏内可见提示；重试；阻止无提示地离开；保留上一份存档 |
| FM-08 | 存档损坏/半写 | 优先 `.bak` 恢复；失败则提供"重置存档"并保留损坏副本供诊断 |
| FM-09 | iframe 崩溃/加载超时（活着但白屏仅按无响应可恢复，见 S-18） | 检测后显示错误覆盖层；提供重新加载（恢复存档）与退出 |
| FM-10 | Host 重启/页面刷新（游戏中） | Client 重连；游戏重新加载并恢复存档；Agent 状态重新同步 |
| FM-11 | 插件被停用（游戏中） | 优雅退回 Conversation；不留残余 UI；状态已保存 |
| FM-12 | Agent Session 异常结束 | 小鲸鱼进入 error 态；游戏不受影响；可查看结果 |
| FM-13 | 并发安装同一游戏 | 串行化；第二次请求幂等返回进行中/已完成，不产生重复目录 |
| FM-14 | 磁盘空间不足 | 安装前检查并提示所需空间；失败清理临时文件 |

### 10.7 安全验收

| 编号 | 攻击/测试 | 通过标准 |
|---|---|---|
| SEC-01 | 游戏尝试访问 `window.parent` / `top.document` / 宿主 DOM | 被跨源边界阻止；控制台报错但宿主不受影响 |
| SEC-02 | 游戏尝试 `fetch`/XHR/WebSocket 访问外网或宿主 API | 被 CSP 与沙箱阻止；无网络请求成功 |
| SEC-03 | 游戏尝试读写宿主 `localStorage`/Cookie/IndexedDB | 不可达（隔离源） |
| SEC-04 | 游戏伪造 `postMessage`（错误 source/nonce/格式） | Runtime 丢弃并记录；不触发任何动作 |
| SEC-05 | 恶意包：外部子资源/网络调用、超大单文件、非法 manifest/非法 id | 安装阶段拒绝；无文件写出目标目录 |
| SEC-06 | 篡改包内容但复用旧 hash | 校验失败拒绝 |
| SEC-07 | 游戏伪造平台 UI（审批/完成提醒/小鲸鱼） | 平台级 UI 始终由 Runtime 渲染；游戏无法覆盖或伪造 |
| SEC-08 | 诊断导出/日志包含 Prompt、路径、工具参数 | 检查日志与导出文件，确认已脱敏/不含敏感内容 |
| SEC-09 | 卸载/更新操作被构造为删除任意路径 | 仅允许操作插件管理目录内的目标；路径校验生效 |
| SEC-10 | 游戏入口引用外部子资源、CDN 或远程接口 | 安装校验拒绝（E_PKG_ENTRY_NOT_SELF_CONTAINED）；运行时 CSP 阻断外链 |

### 10.8 验证指标（内测参考，非阻塞发布）

V0/V1 本质上是在验证一个产品假设，建议在内部试用中记录以下指标，避免"功能做完了但没人玩"：

| 指标 | 建议目标 | 说明 |
|---|---|---|
| 长任务入口点击率 | ≥30% | 运行 ≥30 秒的任务中，用户点击等待入口的比例 |
| 有存档用户 Continue 使用率 | ≥50% | 有未完成存档的进入中，选择 Continue 的比例 |
| 完成提醒后 2 分钟内返回工作 | ≥60% | 验证"提醒但不打断"是否被正确使用 |
| 等待场景游戏时长中位数 | 60–180 秒 | 与等待时长匹配；过长说明场景不匹配 |
| 次日回访（内测用户） | ≥25% | 验证是否形成"下一次等待继续玩"的习惯 |
| 开发者首个游戏完成时间 | ≤30 分钟 | V1.5 前的外部开发者验证 |

指标低于目标时应优先调整入口、游戏选择与等待体验，而不是增加功能。

---

## 11 任务拆解与里程碑

### 11.1 工作流划分

| 工作流 | 负责范围 | 主要产物 |
|---|---|---|
| W0 基座 | Bundle 骨架、Slot 注册、面板切换、Client 状态、开发态安装 | 可安装、可切面板、可返回的空壳 |
| W1 Host | Registry、安装、存档、Session、成绩、Agent 适配、HTTP API | Host 服务与路由 |
| W2 Market UI | Market、My Games、详情、安装交互 | 可浏览/安装/管理的界面 |
| W3 Runtime/SDK | iframe 加载、Bridge、SDK、生命周期、自动保存、模拟器 | 可运行受控游戏 |
| W4 Presence | 小鲸鱼、等待入口、Agent 状态同步、切回处理流程 | Agent 联动体验 |
| W5 开发者 | `create-dsh-game`、`dsh-game` CLI、模板、首发游戏 | 开发者可接入、可发布 |
| W6 安全/质量 | 沙箱、CSP、安全测试、性能、无障碍、验收 | 可发布的验收证据 |
| W7 发布 | Registry 托管、安装文档、发布说明 | 可交付版本 |

### 11.2 V0 任务

| 编号 | 任务 | 工作流 | 依赖 | 规模 |
|---|---|---|---|---|
| V0-T01 | Bundle 骨架：`package.json` + `cordis.patch.yml` + Host `apply` + Client `client.js` + locale + icon | W0 | — | S |
| V0-T02 | 注册 `main` key `dsh-game-market` 与 `sidebar.panellist` 图标；实现 `selectPanel` 进入/返回 | W0 | T01 | S |
| V0-T03 | Client 模块级 store + 页面路由（Market/My Games/Runtime 内部状态），验证面板卸载后状态不丢 | W0 | T02 | M |
| V0-T04 | Host HTTP 路由骨架（health + 游戏列表） + Client fetch 封装 | W1 | T01 | S |
| V0-T05 | 存储骨架：`$DSH_HOME/storages/dsh-game-market/`、原子写工具、`.bak` 恢复 | W1 | T01 | M |
| V0-T06 | Agent State Adapter V0：running / waiting-user / completed / error + 当前 Session 绑定 | W1 | T01 | M |
| V0-T07 | Client Agent 状态轮询（1s）+ 状态 store | W1/W4 | T06 | S |
| V0-T08 | 内置 2048：游戏本体 + 存档/继续 + 分数展示（本地） | W5 | T05 | M |
| V0-T09 | Game Runtime：加载内置游戏、sandbox iframe、Pause/Resume、退出 | W3 | T02/T04 | M |
| V0-T10 | SDK V0 + Bridge：ready/storage/lifecycle/agent/session 最小集 | W3 | T09 | M |
| V0-T11 | 自动保存：30 秒定时 + 暂停/隐藏/离开强制保存 + 失败提示 | W3 | T05/T10 | S |
| V0-T12 | 小鲸鱼占位 SVG + 六视觉状态（顶层 5 态 + running 的 tool-stage 子状态）+ 气泡 + 点击行为 | W4 | T07 | M |
| V0-T13 | 等待入口 chip（5 秒阈值、两种文案、菜单、频控）+ Sidebar 状态点 | W4 | T07 | M |
| V0-T14 | 需要用户完整流程：暂停存档 → 切回 → 原生处理 → "继续游戏" → 重载恢复 | W4 | T06/T10/T11 | M |
| V0-T15 | V0 验收执行与证据归档（10.2 全表） | W6 | 全部 | S |

**V0 建议顺序：** T01 → T02/T04/T05 并行 → T03/T06 → T07/T08/T09 → T10 → T11/T12/T13 → T14 → T15。

### 11.3 V1 任务

| 编号 | 任务 | 工作流 | 依赖 | 规模 |
|---|---|---|---|---|
| V1-T01 | Registry 客户端：拉取、校验、6h 缓存、离线回退、手动刷新 | W1 | V0-T04 | M |
| V1-T02 | 安装器：下载、SHA-256、HTML/内嵌 manifest 校验、原子落位、失败回滚 | W1 | V1-T01/V0-T05 | L |
| V1-T03 | 卸载 / 更新 / 版本回滚 / 并发锁 | W1 | V1-T02 | M |
| V1-T04 | 存档与 Session 完整模型：Session start/end、Continue 判定、配额、恢复 | W1 | V0-T05 | M |
| V1-T05 | 成绩与本地排行榜：Personal Best、历史成绩、排序方向 | W1 | V1-T04 | S |
| V1-T06 | Agent State Adapter V1：label 模板、tool 阶段、等待态健壮性、延迟预算 | W1 | V0-T06 | M |
| V1-T07 | Market 首页：分区、卡片、搜索、分类、骨架/空/离线/错误态 | W2 | V0-T03/V1-T01 | L |
| V1-T08 | My Games：Continue 优先排序、进度摘要、更新、卸载、删除数据 | W2 | V0-T03/V1-T04 | M |
| V1-T09 | 游戏详情：状态矩阵、截图、权限、安装进度、排行榜预览 | W2 | V1-T02/V1-T07 | M |
| V1-T10 | SDK V1 定稿 + 错误码 + 版本协商 + 类型声明 + 文档 | W3 | V0-T10 | M |
| V1-T11 | Runtime V1：暂停菜单、错误覆盖、崩溃恢复、焦点、减少动效、主题传递 | W3 | V0-T09 | L |
| V1-T12 | `create-dsh-game` 模板（Vanilla/Canvas、React） | W5 | V1-T10 | M |
| V1-T13 | `dsh-game` CLI：build / validate / pack / publish + 校验器（单文件 HTML 产物） | W5 | V1-T10 | L |
| V1-T14 | Local Runtime Simulator | W5 | V1-T10 | M |
| V1-T15 | 首发游戏：snake（内置打磨）、jump、2048、breakout 四款（DSH-native Demo 不阻塞 V1） | W5 | V1-T10 | L |
| V1-T16 | 安全加固：CSP、sandbox、消息校验、路径防护、安全测试 | W6 | V1-T02/V0-T09 | M |
| V1-T17 | 性能与无障碍达标（10.5/10.3 U-13/U-14/U-15） | W6 | V1-T11 | M |
| V1-T18 | Registry 托管（registry/games.json + Releases 单文件 .html）+ 安装文档 + 发布说明 | W7 | V1-T01/V1-T13 | S |
| V1-T19 | V1 验收：10.3/10.4 全表 + 证据归档 | W6 | 全部 | M |

### 11.4 Spike 验证任务

Spike 是"先花半天确认能不能做"，不是功能。每个 Spike 必须在对应实现任务开始前完成，结论写回 12.2。**S-04、S-10、S-11、S-17 属于 V1.5 前置，不阻塞 V1**（V1 用单文件自包含包规避了多文件与解压问题；S-04 归档方案、S-10/S-11 多文件能力留待 V1.5；SSE 由 S-17 评估）。

| 编号 | 问题 | 最晚完成时机 |
|---|---|---|
| S-01 | 存储根目录、`DSH_HOME`、写权限与 profile 共享 | V0-T05 前 |
| S-02 | 原子写 / `.bak` 恢复在 macOS、Windows 的行为 | V0-T05 前 |
| S-03 | GitHub Release 包下载可达性、TLS、302、限速、代理 | V1-T01 前 |
| S-04 | （V1 不需要）原 zip 读取器验证；V1 为单文件包、无解压步骤，V1.5 多文件资源时再评估归档方案 | V1.5 前 |
| S-05 | 用户对"卸载默认保留数据"的预期与二次确认措辞 | V1.5（V1 按 D-019 执行） |
| S-06 | 保留旧版本与回滚在真实运行时是否可用 | V1-T03 前 |
| S-07 | Registry 缓存 TTL 与本地合并规则 | V1-T01 前 |
| S-08 | 本地数据 schemaVersion 迁移策略 | V1-T04 前 |
| S-09 | 20 MiB 单文件包加载性能 | V1-T02 前 |
| S-10 | sandbox iframe 子资源请求能否通过 `/api` 栅栏（多文件能力） | V1.5 前 |
| S-11 | 逐文件精确路由的注册开销（多文件能力） | V1.5 前 |
| S-12 | 从侧栏/Market 直接进入时如何确定"当前 DSH Session" | V0-T06 前 |
| S-13 | Host 重启/页面刷新后 Agent 状态重建 | V1-T06 前 |
| S-14 | `userQuestions` 投影与 approval 的 waiting-user 观测 | V0-T06 前 |
| S-15 | `turn/end` 错误/取消结果字段名 | V1-T06 前 |
| S-16 | `/entry` 响应上的 CSP 是否作用于 sandbox iframe、`frame-ancestors` 是否放行 | V0-T09 前 |
| S-17 | SSE / 长轮询在 `connection.fetch` Response 上是否可行 | V1.5（V1 用轮询） |
| S-18 | 心跳 + 首帧信号能否覆盖"活着但白屏" | V1-T11 前 |
| S-19 | DSH Electron 中 `allow="autoplay"` 的实际效果 | V1-T11 前 |
| S-20 | chip 菜单 `position: fixed` 几何与 header 裁切 | V0-T13 前 |
| S-21 | `sidebar.panellist` 图标内部状态点与焦点能力 | V0-T13 前 |
| S-22 | waiting popover 是否可聚焦其它插件原生控件（只验证，不依赖） | V0-T14 前 |
| S-23 | Runtime 顶部是否与窗口 chrome 重叠；clearance 实测 | V0-T09 前 |
| S-24 | Host 下载是否提供字节级进度回调 | V1-T09 前 |
| S-25 | 跨 iframe 焦点顺序与平台控件可达性 | V1-T17 前 |

### 11.5 依赖关系与里程碑

```text
M0 基座可用（约 1 周）
  V0-T01/T02/T04/T05 + S-01/S-02/S-16
        ↓
M1 V0 闭环（约 2–3 周）
  V0-T03、T06–T15
        ↓
M2 V1 用户闭环（约 4–5 周）
  V1-T01–T05 + V1-T07/T08/T09 + V1-T16
        ↓
M3 V1 开发者闭环（约 2–3 周）
  V1-T10/T11 + V1-T12–T15 + V1-T18
        ↓
M4 V1 发布验收（约 1 周）
  V1-T17/T19 + V1 全链路演示
```

**人力假设：** 1–2 名工程师 + 1 名设计/产品支持。以上为粗略估计，不含第三方开发者游戏制作与审核时间；Spike 失败导致的返工不计入。若只有 1 名工程师，建议严格按 M0 → M1 → M2 → M3 串行，不要在 V0 闭环前并行铺开 Market。

**里程碑验收：**

- **M0**：空壳插件可安装、可切面板、可返回、Host 路由与存储 smoke 通过。
- **M1**：V0 验收 10.2 全过；可录一条 2 分钟完整演示（Agent 工作 → 2048 → 完成提醒 → 返回 → 继续）。
- **M2**：V1 用户链路 U-01–U-15 过；Market/My Games/详情可用。
- **M3**：开发者链路 DEV-01–DEV-07 过；首发四款（snake/jump/2048/breakout）可在 Market 安装运行。
- **M4**：性能、无障碍、安全测试达标；发布说明与已知问题清单完成。

---

## 12 决策日志与风险清单

### 12.1 已定决策

| 编号 | 决策 | 理由 | 来源 | 状态 |
|---|---|---|---|---|
| D-001 | 等待入口在 Agent 连续运行满 5 秒后出现 | 覆盖绝大多数长任务，短任务不打扰 | 用户 | 已定 |
| D-002 | 等待入口放 `conversation.header.leading` chip；Sidebar 图标带状态点 | 唯一可用的会话顶部原生槽位；Sidebar 是标准全局入口 | 用户 | 已定 |
| D-003 | 需要用户时切回 Conversation 处理，游戏暂停并存档，处理完一键回游戏 | 复用 DSH 原生审批/提问，风险最低 | 用户 | 已定 |
| D-004 | Continue 由 SDK 显式 Session start/end 判定 | 避免把已结束的一局误判为可继续 | 用户 | 已定 |
| D-005 | 30 秒定时 + 关键节点 + 离开强制保存；单游戏存档总量 ≤1MB（≤32 key、单值 ≤256KB） | 崩溃最多丢 30 秒；本地小游戏足够 | 用户 | 已定 |
| D-006 | 进入游戏时绑定当前 Session，只跟随它 | 语义清楚，避免多 Session 状态噪声 | 用户 | 已定 |
| D-007 | V0 用简化占位 SVG 小鲸鱼 | 不阻塞状态机与动效开发 | 用户 | 已定 |
| D-008 | UI↔Host 使用 `connection.fetch` HTTP 路由，不用 `ctx.remote` | 第三方 bundle 无法新增 Remote（本机已验证结论） | 技术修正 | 已定 |
| D-009 | Host 使用自有存储目录 + JSON 原子写；V1 不依赖 `storageDomain` | `storageDomain.defineDomain` 对第三方未验证 | 技术修正 | 已定 |
| D-010 | `.dshgame` 为 zip；单包 ≤20MB、≤2000 文件；SHA-256 校验 | 静态产物、易校验、控制安装成本 | 技术取舍 | 已由 D-034 取代 |
| D-011 | SDK 只开放 ready/storage/session/score/lifecycle/agent/runtime | 保持开发者心智简单，减少攻击面 | 技术取舍 | 已定 |
| D-012 | V0 只做内置 2048，不做真实安装/Registry/CLI | 先验证核心体验，避免提前造平台 | 产品取舍 | 已定 |
| D-013 | V1 Registry 用 `registry/games.json` + GitHub Releases 单文件 `.html` 包 | 无需后端即可验证分发 | 产品取舍 | 已定 |
| D-014 | V1 不开放游戏联网（CSP `connect-src 'none'`） | 降低安全与审核成本；联网未来作为显式 Capability | 安全取舍 | 已定 |
| D-015 | Agent 状态由 Host 维护快照，游戏页 1 秒轮询；SSE 作为后续优化 | 已验证通道下最稳的 MVP 方案；接口语义不依赖传输 | 技术取舍 | 已定；SSE 由 S-17 在 V1.5 评估 |
| D-016 | 注册 `main` key + `sidebar.panellist`；`selectPanel` 进入，`selectPanel(null)` 返回 | 本机参考实现已跑通 | 技术事实 | 已定 |
| D-017 | Client 文案走 `ctx.locale`，V1 提供 zh/en | 符合 DSH 插件惯例，避免硬编码 | 技术取舍 | 已定 |
| D-018 | 第 8–12 章为开发权威来源，与第 0–7 章冲突时以第 8–12 章为准 | 避免产品叙事与实现规格互相打架 | 文档约定 | 已定 |
| D-019 | 卸载默认保留存档与成绩，另提供"同时删除数据" | 存档很小，保留利于重装后继续；删除需显式确认 | 产品取舍 | 已定 |
| D-020 | 排行榜方向由内嵌 manifest 的 `score.direction` 声明；V1 只做本地 | 不同游戏"高分"定义不同；全球榜不在 V1 | 产品取舍 | 已定 |
| D-021 | 同一时间只允许一个安装任务；安装串行化 | 简化状态与磁盘竞争 | 技术取舍 | 已定 |
| D-022 | 安装阶段绝不执行游戏代码或安装脚本 | 第三方内容不可信 | 安全原则 | 已定 |
| D-023 | V1 游戏包必须是自包含单文件 HTML（JS/CSS/图片/字体内联）；Host 只服务 entry 与 Registry 缓存 preview 素材 | sandbox opaque origin 下多文件子资源无法稳定通过 `/api` 栅栏；单文件最稳、可验证 | 技术取舍（S-10/S-11 后 V1.5 再评估多文件） | 已定 |
| D-024 | 从"处理 Agent / 查看结果"返回游戏时默认停在暂停遮罩，由用户点击继续；首次进入正常自动开始 | 避免突然出声或计时；符合"用户决定何时继续" | 产品取舍 | 已定 |
| D-025 | Market / My Games / 详情在 waiting-user 时显示 32px 顶部提示条 | 用户不在游戏内时仍需最高优先级提醒，但不抢注意力 | 产品取舍 | 已定 |
| D-026 | V1 不提供平台级静音，暂停菜单只给说明 | iframe 跨域无法可靠控制游戏音量；要求游戏自带开关 | 技术限制 | 已定；V1.5 评估 |
| D-027 | V1 不做长期"少提醒"偏好，只保留单 turn 频控 | 范围控制；先验证打扰程度 | 产品取舍 | 已定；V1.5 评估 |
| D-028 | Host 写接口一律 POST；不使用 PUT/PATCH/DELETE | `connection.fetch` 仅允许 GET/HEAD/POST | 技术事实 | 已定 |
| D-029 | 关闭 DSH 时尽力保存；进程被强杀时最多丢 30 秒 | pagehide 无法保证 1MB 同步落盘 | 能力边界 | 已定，写入 8.4 |
| D-030 | 对外错误码统一 `GM-*`；`E_*` 仅作内部常量并在 §8.13 映射 | 避免两套错误码进入 API/文案 | 一致性 | 已定 |
| D-031 | 宿主基线版本统一为 **0.2.1-rc.2** | 本机实际安装版本；0.2.x 插件契约一致 | 事实 | 已定 |
| D-032 | zip 解压由 Host 自研最小读取器（node:zlib，stored/deflate）完成；全包路径强制 ASCII | Host 不能 import 第三方包；文件名需可寻址 | 技术取舍 | V1 不需要（单文件包），V1.5 多文件时重新评估 |
| D-033 | 多 profile 共享 `$DSH_HOME/storages/dsh-game-market/`，用跨进程锁串行化写入 | 实测 storage 在 profile 目录之外；共享体验更好 | 技术取舍 | 已定；S-01 复核 |
| D-034 | V1 包格式 = 单文件自包含 HTML + 内嵌 manifest v1（`<script type="application/json" id="dsh-game-manifest">`，全文恰好一处、文本 ≤64 KiB）；不引入 zip/归档/解压；取代 D-010/D-032 | 单文件最易校验、运行最稳；多文件资源 V1.5 再评估 | 用户决策（2026-10-18） | 已定 |
| D-035 | 目录/命名统一：`packages/<id>/<version>/entry.html`；Registry 索引 `registry/games.json`（`registryVersion: 1`）；保留当前 + 1 个 previousVersion；Registry 包 URL host allowlist（`github.com`/`raw.githubusercontent.com`/`objects.githubusercontent.com` + 可配置 `allowedHosts`），重定向 ≤5 且不得降级 http | 统一契约、避免实现分歧 | 用户决策（2026-10-18） | 已定 |
| D-036 | V1 首发只做四款：`snake`（内置）/`jump`/`2048`/`breakout`；DSH-native Demo 由用户亲自带人后续推进，不阻塞 V1 验收/发布 | 收敛范围、保证首发质量 | 用户决策（2026-10-18） | 已定 |
| D-037 | Runtime 舞台全出血（edge-to-edge），删除黑色舞台背景/letterbox/舞台内边距；`viewport` 仅作推荐设计分辨率；SDK viewport 为实际容器尺寸，不再驱动平台缩放；游戏铺满视口并遵守顶部全宽 112px、右下 96×96 安全区；开发包规范写入开发者指南 §4.4/模板 | 消除黑边、统一第三方接入规范 | 用户决策（2026-10-19） | 已定 |

### 12.2 待验证项（Spike 清单）

> S-04、S-10、S-11、S-17 是 V1.5 前置，不阻塞 V1；其余在对应任务前完成。每个 Spike 的结论必须回填本表（通过/降级/失败）。

| 编号 | 待验证问题 | 影响 | 验证方法 | 通过标准 | 未通过降级 |
|---|---|---|---|---|---|
| S-01 | `DSH_HOME` 是否在所有启动路径设置、目录可写、profile 共享 | 持久化根基 | 探针插件记录 env、realpath、写权限；desktop/web 各跑一次 | 可写、路径稳定、重启后存在 | 只读模式 + 明确提示；可配置存储根 |
| S-02 | fsync + rename + `.bak` 在 macOS/Windows 的行为 | 存档可靠性 | 写入中断/杀进程/断电模拟 | 不出现损坏主存档 | 校验和 + 双份轮换 |
| S-03 | GitHub Release 下载可达性、超时、代理 | 安装可用性 | 国内网络下载 5/20 MiB 包 | 超时/错误可预期 | 镜像或本地导入 |
| S-04 | （V1 不需要）多文件资源/归档方案；V1 为单文件包、无解压 | V1.5 多文件 | 归档方案对比 + 20 MiB 内压测 | 方案可维护、加载可控 | 保持单文件 |
| S-05 | 用户对"卸载默认保留数据"的预期 | 产品决策 | 5 人可用性测试 + 文案理解 | ≥4 人理解并认可 | 改为卸载前逐游戏询问 |
| S-06 | 保留旧版本 + 回滚 | 更新恢复 | 装 v1→v2→回滚 10 次 | 回滚可用、存档兼容 | 不提供回滚，只允许重装 |
| S-07 | Registry 缓存 TTL 与合并 | 离线体验 | 断网/改 index/版本更新 | 离线可用、更新可见 | 延长 TTL + 手动刷新 |
| S-08 | 本地数据 schemaVersion 迁移 | 升级兼容 | 构造旧格式文件 | 可迁移或明确报错 | 版本号 + 拒绝未知版本 |
| S-09 | 20 MiB 单文件包加载性能 | 首帧体验 | 大包加载计时 | ≤2s 首帧（参考机） | 降低包体上限 |
| S-10 | sandbox iframe 子资源是否通过 `/api` 栅栏 | V1.5 多文件 | 构造多文件游戏，观察 403/401 | 子资源可加载且不泄露宿主 | 保持单文件；或公开静态路由/独立 origin |
| S-11 | 逐文件精确路由注册开销（2000 文件） | V1.5 多文件 | 注册/teardown 计时与内存 | 注册 ≤500ms、无泄漏 | 限制可服务文件 ≤512 |
| S-12 | 从侧栏/Market 直接进入时的当前 Session 归属 | 多 Session 绑定 | 两个 Session 下从 Market 进入 | 绑定正确 | 回退"最近一次 chip 捕获"，再回退 null |
| S-13 | Host 重启后 Agent 状态重建 | 跨重启一致性 | 重启 DSH 后进入游戏 | 显示正确状态 | 显示"未知"，等下次事件 |
| S-14 | `userQuestions` 投影/approval 的等待态观测 | 提醒可靠性 | 触发提问/审批，200ms 内读投影 | 1.5s 内到达 waiting-user | 仅提示"可能等待"，由 Sidebar 状态点兜底 |
| S-15 | `turn/end` 错误/取消的结果字段 | 错误态准确性 | 制造失败任务并读事件 | 能区分 error/cancel | 一律按 completed + 日志 |
| S-16 | `/entry` 的 CSP 是否作用于 sandbox iframe、frame-ancestors 放行 | 沙箱可行性 | 真机加载 entry，查 CSP 违规与加载结果 | 无外网、无宿主访问、正常渲染 | 去掉 frame-ancestors；改用 srcdoc 注入 |
| S-17 | SSE/长轮询能否在 fetch Response 上长期保持 | Presence 传输 | 保持连接 10 分钟并观察 | 稳定、可取消、无内存增长 | 保持 1s 轮询 |
| S-18 | 心跳 + 首帧能否覆盖"活着但白屏" | 错误恢复 | 制造白屏但响应 ping 的页面 | 10s 内检测 | 只保证无响应可恢复，白屏手动重载 |
| S-19 | `allow="autoplay"` 在 DSH Electron 的实际效果 | 音频体验 | 首次手势前/后播放测试 | 行为可预期 | 默认静音 + "点击开始" |
| S-20 | chip 菜单 fixed 定位与 header 裁切 | 入口体验 | 真机测量 1440/窄窗 | 不裁切、不遮挡标题 | 用 `shell.overlay` 自绘菜单 |
| S-21 | Sidebar 图标内部状态点/焦点 | 状态可见性 | 注册后真机观察 | 可显示三态、可聚焦 | 描边变色 + tooltip |
| S-22 | waiting popover 对原生控件的聚焦 | 体验 | 真机尝试聚焦审批控件 | 不聚焦也不影响处理 | 只给"回到会话"按钮 |
| S-23 | Runtime 顶部与窗口 chrome 是否重叠 | 布局 | 真机截图测量 | 不遮挡、控件可点 | 固定 clearance 值 |
| S-24 | 下载是否有字节级进度回调 | 安装体验 | 观察 fetch Response 流 | 可显示百分比 | 不确定进度 + 预计时长 |
| S-25 | 跨 iframe 焦点顺序 | 无障碍 | 纯键盘走 Runtime | 平台控件可达 | 常显 1px 热区/按钮 |

### 12.3 风险与缓解

| 编号 | 风险 | 概率/影响 | 缓解措施 |
|---|---|---|---|
| R-01 | waiting-user 状态观测不可靠，用户错过 Agent 等待 | 中/高 | 双通道（Host seam + Client pending）；S-14；降级为"可能存在等待"提示 + 侧栏状态点；验收覆盖 U-06 |
| R-02 | sandbox iframe 的 CSP 不生效或 `/entry` 被栅栏拒绝 | 中/高 | V1 单文件 entry 已规避子资源问题；S-16 在 V0 前验证；备选 srcdoc 注入或去掉 frame-ancestors |
| R-03 | 切走游戏导致 Conversation 卸载，用户感到中断 | 高/中 | 明确草稿/滚动由宿主恢复；返回游戏走重载+存档；UI 给出"游戏已暂停并保存"提示；不承诺 DOM 选区 |
| R-04 | 没有第三方游戏供给，市场空转 | 中/高 | 首发四款官方游戏（snake/jump/2048/breakout）；模板与文档；V1.5 指标是"首个外部开发者发布" |
| R-05 | 大型引擎（Three.js）包体与首帧超标；单文件内联放大体积 | 中/中 | V1 不首发大引擎模板；20 MiB 上限；首帧预算与 S-09 |
| R-06 | 用户根本不玩，等待场景假设不成立 | 中/高 | 10.8 指标监控；V0 先验证再扩；不提前造平台 |
| R-07 | DSH 升级 breaking change | 中/高 | Adapter 隔离；engines.dsh；8.11 兼容策略与回归清单 |
| R-08 | 存档损坏/丢失（含强杀进程最多丢 30 秒） | 低/高 | 原子写 + `.bak` + 校验和；FM-07/FM-08；D-029 写入文档 |
| R-09 | 恶意游戏包绕过沙箱 | 低/高 | 默认拒绝、能力矩阵、S-01–S-09 安全测试、人工审核清单；V1 无网络 |
| R-10 | 安装第三方 bundle 需 Full access，用户不敢装 | 中/中 | README 说明权限与风险；提供开发态本地加载方式；最小依赖 |
| R-11 | 键盘/焦点冲突导致游戏不可操作 | 中/中 | S-25；进入游戏提示"点击画面获得焦点"；Esc 规则明确 |
| R-12 | 多语言/主题适配成本被低估 | 中/低 | 文案与 token 从 V0 就按规范做；9.8 文案表强制中英 |
| R-13 | 性能预算不达标（低端机） | 中/中 | 10.5 预算；V1 前实测；必要时降低动效/分辨率 |
| R-14 | 产品范围膨胀（V1 塞入排行榜、社交等） | 中/高 | 以 7.4 与 12.4 为准；新增需求必须绑定验证假设 |

### 12.4 延期决策（按版本触发）

以下问题当前**不做决定**，写明触发条件，避免开发中反复讨论：

| 编号 | 问题 | 触发版本 | 触发条件 |
|---|---|---|---|
| O-01 | 游戏内嵌原生 Conversation / 审批浮层 | V1.5 | 用户反馈"切回处理"打断明显；S-14 显示可稳定观测；原生嵌入方案验证可行 |
| O-02 | 游戏联网 Capability | V2 | 有真实游戏需要联网且完成安全评审；否则保持默认拒绝 |
| O-03 | 全球排行榜 / 账号体系 | V2 | 本地留存与 Personal Best 验证成立；有跨设备需求 |
| O-04 | 官方鲸鱼素材替换占位 SVG | V1 视觉打磨阶段 | 官方素材交付；替换不影响状态机 |
| O-05 | Developer Console / 自动审核 | V2 | Registry 出现足够多第三方提交 |
| O-06 | 游戏评分/评论/社交 | V2 | 游戏数量与用户量达到需要发现效率的阶段 |
| O-07 | Cloud Save | V2 | 多设备用户比例与需求验证成立 |
| O-08 | 多文件游戏资源（S-10/S-11 通过后） | V1.5 | 单文件限制成为真实开发者的主要抱怨；或首发游戏需要多文件资源 |
