# DSH Game Market 开发者指南（V1）

本文是「从空目录到可安装游戏」的可执行教程，对应 PRD v2.2 §4、§8.2.7–§8.2.9、§8.3，
以及 `docs/V1-CONTRACTS.md` §2（包格式）、§3（manifest v1）、§4（校验职责）、§6（本地安装）、
§8（SDK v1）。CLI 的完整参数表见 [developer-cli.md](developer-cli.md)。

> V1 的 Game Package 是**一个自包含单文件 HTML**（UTF-8、无 BOM、≤20 MiB）。没有 zip、没有
> 多文件资源、没有 install 脚本；游戏在 sandbox iframe 中运行，只能通过 Game SDK 使用
> `storage` / `score` 两种能力。

---

## 0. 前置条件

- Node.js **≥ 20**（仓库基线为 20+）。
- 一个 `dsh-game-market` 仓库 checkout；CLI 不需要 `npm install`（零第三方依赖）。
- 生成 **vanilla** 模板不需要 `npm install`；**react** 模板需要 `npm install`（Vite/React 工具链）。
- V1 CLI 为离线工具：build / validate / pack / publish 都不联网。

MVP 的入口是仓库内脚本：

```bash
node scripts/cli/dsh-game.mjs --help
node scripts/cli/create-dsh-game.mjs --help
```

`npx dsh-game` / `npx create-dsh-game` 需要根 `package.json` 的 `bin`（由 Lead 维护，本分支未修改）；
生成工程不写机器相关 CLI 路径：运行模板里的 `npm run ...` 前需设置
`DSH_GAME_CLI=/path/to/dsh-game-market/scripts/cli/dsh-game.mjs`（或在同一 shell 里
export 后执行 create）；`dsh-game.config.json` 只记录 manifest/template/entry/out。

---

## 1. 五分钟跑通

```bash
# 1) 在空目录创建工程（id 即目录名；--dir 指定父目录）
export DSH_GAME_CLI="$PWD/scripts/cli/dsh-game.mjs"
node scripts/cli/create-dsh-game.mjs my-game --template vanilla --dir /tmp/games

cd /tmp/games/my-game

# 2) 构建单文件
npm run build
# built .../dist/index.html (NNNN bytes)
#   sha256: ...
#   manifest: my-game@1.0.0

# 3) 本地校验（CI 用同一个命令）
npm run validate
# OK  .../dist/index.html (NNNN bytes)

# 4) 本地 Runtime Simulator（不需要真实 DSH Agent）
npm run dev
# Game Runtime Simulator: http://127.0.0.1:4321/

# 5) 打包 + 生成 Registry 条目
npm run pack
npm run publish -- \
  --url https://github.com/<you>/<repo>/releases/download/v1.0.0/my-game-1.0.0.html \
  --cover https://raw.githubusercontent.com/<you>/<repo>/main/cover.png
```

产物：

```text
dist/index.html                      构建产物（开发/校验用）
dist/my-game-1.0.0.html              可安装包（Registry 包名）
dist/my-game-1.0.0.html.sha256       shasum 兼容摘要
dist/registry-entry.json             可直接粘进 registry/games.json 的条目
dist/upload-plan.md                  上传目标与 gh 命令
dist/review-checklist.md             自动 + 人工审核清单
```

安装到 Market：Game Market → My Games → **Install local**，选择
`dist/my-game-1.0.0.html` 并确认（本地包不可验证，Market 会二次确认），随后即可在
sandbox Runtime 中游玩。

---

## 2. 工程结构

### 2.1 Vanilla（无框架、无构建依赖）

```text
my-game/
├── manifest.json           # 构建期 manifest v1 源文件（不进入 dist 的独立文件）
├── index.html              # HTML 模板；build 注入 manifest/SDK/内联资源
├── dsh-game.config.json    # manifest/template/entry/out（可移植，无 CLI 路径）
├── src/
│   ├── main.js             # 启动、循环、SDK 生命周期、分数/Session
│   ├── render.js           # canvas、DPR/缩放、HUD/遮罩
│   ├── storage.js          # 纯同步 serialize/deserialize（Continue）
│   ├── i18n.js             # zh / en 文案
│   └── styles.css          # 构建时内联为 <style>
├── scripts/
│   ├── cli.mjs             # 找到本地 dsh-game CLI（DSH_GAME_CLI 可覆盖）
│   ├── build.mjs           # npm run build
│   ├── dev.mjs             # npm run dev（Runtime Simulator）
│   ├── validate.mjs        # npm run validate（build + validate）
│   ├── pack.mjs            # npm run pack
│   └── publish.mjs         # npm run publish
├── sdk/index.d.ts          # @dsh-game/sdk v1 公开类型
└── README.md
```

### 2.2 React（说明性模板）

```text
react-game/
├── manifest.json
├── index.html
├── vite.config.ts          # React + vite-plugin-singlefile + manifest 注入插件
├── src/
│   ├── main.tsx
│   ├── App.tsx             # 只承载 UI chrome；游戏状态放 useRef
│   ├── sdk.ts              # 类型化的 SDK 访问
│   └── game/{loop,render,storage,i18n}.ts
├── vendor/dsh-game-sdk.js  # 离线 SDK bundle（create-dsh-game 生成）
└── sdk/index.d.ts
```

React 模板仓库内不参与 `npm run verify`（需要 `npm install`），但 `create-dsh-game`
会生成完整、可 `npm install && npm run build` 的工程。

---

## 3. manifest v1

构建期源文件是 `manifest.json`；`build` 会把它序列化后写入包内**恰好一处**：

```html
<script type="application/json" id="dsh-game-manifest">{ ... }</script>
```

必填字段（`docs/V1-CONTRACTS.md` §3.1）：

```json
{
  "manifestVersion": 1,
  "id": "my-game",
  "name": "My Game",
  "version": "1.0.0",
  "author": { "name": "Your Name" },
  "description": "One or two sentences.",
  "categories": ["arcade"],
  "capabilities": ["storage", "score"],
  "sdkVersion": "^1.0.0",
  "runtimeVersion": "^1.0.0",
  "save": { "schemaVersion": 1 },
  "score": { "direction": "higher-better", "min": 0, "max": 1000000, "integer": true }
}
```

规则速查：

| 项 | 规则 |
|---|---|
| `id` | `^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$`，3–48 字符，禁止 `--` 与保留字 |
| `version` | 严格 semver 子集，禁止 `+build`；包文件名使用原样版本 |
| `categories` | 1–3 个：`arcade/puzzle/card/idle/action/strategy/trivia/sandbox` |
| `capabilities` | 仅 `storage` / `score`，不可重复；声明 `storage` 必须有 `save`，声明 `score` 必须有 `score` |
| `sdkVersion` / `runtimeVersion` | `^1.0.0`、`~1.0.0`、精确值或 `>=1.0.0 <2.0.0`；`0.1.x` 走 V0 legacy 窗口 |
| `entry` / `cover` / `screenshots` | **不属于** V1 包 manifest；出现即 `E_PKG_LEGACY_FIELD`（GM-4237） |
| `icon` | 可选 `data:image/(png\|webp\|jpeg);base64,...`，解码 ≤256 KiB |
| `permissions` | 仅允许省略或 `{}` |
| `viewport` | 可选 `{ width, height, fit?: 'contain' }`；**V1.1 起仅作为推荐设计分辨率（不是 SDK viewport 初值）**，平台不再按它做 letterbox/等比缩放（见 §4.4） |
| 未知字段 | warning `W_PKG_UNKNOWN_FIELD`；实验字段用 `x-` 前缀 |

`cover` / `screenshots` 只存在于 Registry 条目；`publish --cover` 负责它们。

---

## 4. SDK v1 用法

构建时 SDK 会以全局 `DSH_GAME_SDK` 注入；公开类型见 `packages/sdk/src/index.d.ts`
（生成工程内为 `sdk/index.d.ts`）。

```js
const game = DSH_GAME_SDK.createGameSDK();

// 1) 在 ready 之前注册生命周期（事件会缓冲并在 ready 后重放）
game.lifecycle.on('pause', () => stopLoop());
game.lifecycle.on('resume', () => startLoop());
game.lifecycle.on('before-save', () => saveNow()); // 必须在这里调用 storage.save

// 2) 等待握手；失败显示错误态，不能白屏
const info = await game.ready();          // 默认 10s
applyTheme(info.theme);
const i18n = createI18n(info.locale);

// 3) 读档（需要 storage 能力）；缺失返回 null，不抛错
const saved = await game.storage.load('current');
state = saved ? deserialize(saved.data) : newState();

// 4) 开始时调用一次；Runtime 已自动开始时 adopted=true，幂等
await game.session.start();

// 5) 结束时提交分数并结束 Session
await game.score.submit(score).catch(handleScoreError);
await game.session.end({ outcome: 'completed', score });
```

### 4.1 约束与超时

| 能力 | 约束 |
|---|---|
| `ready()` | 默认 10s；传入更大的值不会延长；iframe 外立即 `GM-5003` |
| `storage` key | `^[a-z0-9][a-z0-9._-]{0,63}$`；≤32 key；单值 ≤256 KiB；单游戏 ≤1 MiB |
| JSON 值 | 纯 JSON；深度 ≤32；禁止 `undefined`/函数/Date/Map/Set/TypedArray/循环引用 |
| 写操作 | SDK 内按调用顺序串行（Runtime 也串行）；队列上限 32，超出 `GM-4291` |
| 读操作 | 可并发；`storage.load` 缺失返回 `null` |
| 超时 | save 6s / load 3s / session.start 4s / session.end 6s / score 4s / agent 2s |
| 错误 | 统一 reject `GameError`：`code` 为 `GM-*`、`retryable`、可选 `details` |
| 生命周期 | `pause`/`resume`/`hidden`/`visible`/`before-save`；回调异常被隔离 |
| Agent | `agent.getStatus()` / `agent.on('status')` 只读；未绑定 Session 返回 idle |

### 4.2 存档与 Continue

平台判定 Continue 需要**同时**满足：

1. 存在该游戏进行中的 Play Session；
2. 存在 Game Save；
3. Save 的 `revision > 0`。

因此：

- 暂停、切后台、离开游戏**不会**结束 Session；
- 只有游戏调用 `session.end()`、卸载、包更新时才结束 Session；
- 存档必须由游戏在 `before-save`（以及暂停路径）主动调用 `storage.save` 写入；
- 结束一局后建议让 `deserialize` 返回 `null`（本模板写入 `gameOver:true` 并在读取时拒绝），
  避免“已完成的对局”被 Continue。

### 4.3 错误处理

```js
try {
  await game.storage.save('current', state);
} catch (error) {
  if (!DSH_GAME_SDK.isGameError(error)) throw error;
  if (error.code === 'GM-4131' || error.code === 'GM-4132') {
    await game.storage.remove('replay');
    await game.storage.save('current', state);
  } else if (error.retryable) {
    showToast('保存失败，请重试');
  } else {
    showFatal(error.code);
  }
}
```

`score.submit` 的 `GM-4006`（分数超出 manifest 范围）必须可见处理，不能静默吞掉。

---

### 4.4 Runtime 呈现与安全区（V1.1 规范）

Runtime 是**全出血（edge-to-edge）**的：iframe 铺满整个 Main Panel，平台不绘制黑色
letterbox、不做 `contain` 等比缩放、不加舞台内边距。游戏必须自己把整个视口画满，
不能依赖平台给一个固定比例的画框。

**硬性要求：**

1. `html, body, #app` 铺满视口（`width/height: 100%`，推荐 `100dvh`/flex/grid），
   不写固定像素外层，不出现透明/空白边缘。
2. 背景由游戏负责：亮/暗主题都要覆盖整个画布；不允许在游戏内部再套一层“舞台边框/
   黑边/阴影框”（模板已按此更新）。
3. 响应式：监听窗口 `resize`，并在 ready 后/布局更新时读取只读快照 `game.runtime.viewport`；不要把 960×540 当硬性
   分辨率，也不要为保持比例在内部留黑边。竖屏/横屏、窄窗都应正常布局。
4. 平台悬浮控件的安全区固定如下，关键 HUD/按钮不要放进去：
   - **顶部 112px（整个视口宽度）**：返回 / 暂停、保存状态和 macOS 顶部偏移。
     平台将控件偏移限制在 0–48px；游戏无需读取父页面 CSS 变量。
   - **右下 96×96**：小鲸鱼常驻按钮；以 iframe CSS 像素计，从视口边缘量起。
   - 这些是关键 UI 的避让区域，不是游戏背景的 padding：背景仍需铺满视口。
     玩法物体可以经过这些区域，但分数、生命、操作按钮应保持可见。
   - 小鲸鱼展开的消息气泡属于临时覆盖层，可延伸到右下 254×184 区域；
     96×96 不承诺覆盖展开气泡，游戏不要在这里放唯一可操作入口。
5. `manifest.viewport.width/height` 只表达推荐设计分辨率；`fit` 仅为兼容字段
   （唯一取值 `contain`），不驱动平台缩放。`init.viewport` 和 ready 后的
   `game.runtime.viewport` 是 Runtime 测得的实际容器 CSS 宽高与 DPR；窗口/容器
   改变时由平台更新快照，尺寸与 manifest 可以不同。`viewport` 不是可订阅的
   lifecycle 事件，模板用窗口 `resize` 重新测量 canvas。

**反例（不要再这样做）：** 在 `body` 上给固定 `padding: 14px`，再给 canvas 加
`border + border-radius + box-shadow`，看起来像“平台舞台边框”，在不同窗口比例下
就会出现大块黑边/白边。Vanilla 与 React 模板均提供全出血示例，HUD 从安全带下方开始。

---

## 5. 本地预览 / Runtime Simulator

```bash
npm run dev                 # 构建并按格式加载最新产物
npm run dev -- --port 4400
npm run dev -- --no-build   # 直接服务已构建的 dist/ 产物
npm run dev -- --save-out /tmp/game.save.json   # 每次存档写一份 JSON（dev only）
npm run dev -- --seed-save /tmp/game.save.json  # 从该 JSON 启动 fake storage（dev only）
```

模拟器（`scripts/cli/dev-server.mjs` + `scripts/cli/lib/dev-harness.mjs`）扮演可信 Runtime，
按 `package.format` 走两条不同的入口：

- **`html-v1`**：单层 iframe 加载 `dist/index.html`，可用 `curl http://127.0.0.1:4321/game` 取到构建产物；
- **`asset-zip-v2`**：**两层 iframe** —— 外层是资源 origin 上的平台 wrapper（不 sandbox），
  内层是 `sandbox="allow-scripts"` 的游戏文档；入口是 `/wrapper?src=<resource URL>`，
  包内文件通过 `/res/<instance>/<token>/<path>` 提供；该模式下 `/game` **故意返回 404**。
  `curl /health` 可确认当前 `format`（zip 还包含 `fileCount`）。
- 无论哪种格式都完成 `hello → init → ready` 握手，并实现 storage/session/score/agent 的 fake Host；
- 页面右侧可切换 **Agent Running / Waiting user / Completed / Error / Idle**；
- **Pause / Resume / before-save / Export save / Import save / Clear save / Reload**；主题、locale、视口、Ping；
- **存档导入/导出（dev-only）**：`--save-out <file>` 每次 `storage.save/remove` 后把最新 fake save 写成 JSON；
  `--seed-save <file>` 用该 JSON 初始化 fake storage；页面按钮 `Export save` / `Import save` 等价于
  `GET /dev/save/export` 与 `POST /dev/save/import {save}`。生产 Host 不暴露这两个端点。
- 每条 Bridge 消息同时显示在页面日志与浏览器 console；
- 保存内容、revision、Session、最高分实时可见。

推荐回归顺序：

1. `npm run build && npm run dev`；
2. 按空格/点击开始 → 玩几秒；
3. `before-save` → 看到 `storage.save` 与存档 key；
4. `Reload` → 应出现 Continue 提示（存档恢复）；
5. `Pause` → 循环停止、立即保存；`Resume` → 暂停时长不计入游戏时间；
6. `Waiting user` → 游戏暂停 + Agent 状态；`Completed` → **不暂停**；
7. `Clear save` → `Reload` → 首次启动流程；
8. 打开/关闭主题与 locale，检查画布/文案与 DPR；
9. **升级路径（1.0.0 → 1.0.1）**：在 1.0.0 上 `--save-out /tmp/game.save.json`、触发一次 before-save；
   切到 1.0.1 后用 `--seed-save /tmp/game.save.json` 启动，验证 Continue/deserialize 与 schemaVersion 升级。

---

## 6. 构建、校验、打包、发布

```bash
npm run build       # -> dist/index.html（确定性单文件）
npm run validate    # build + 全量校验
npm run pack        # dist/<id>-<version>.html + .sha256
npm run publish -- --url <https package URL> --cover <https cover URL>
```

构建规则（PRD §8.2.8）：

- 输入：`manifest.json` + `index.html` + `src/`；
- 输出：单文件 `dist/index.html`，内嵌 manifest v1、SDK、JS、CSS、图片 data URI；
- **逐字节确定性**：固定拼接顺序、固定 manifest 键序、无时间戳/随机 id/机器路径/sourcemap；
  同一输入连续 build 两次 sha256 必须相同；
- 不允许外部 `<script src>` / `<link href>` / 图片 / 字体 / `@import` / `<iframe>` /
  `fetch` / XHR / WebSocket / `srcset`（构建/校验会拒绝）；
- 系统字体；图片用 `data:` URI。

`pack` 复制已验证的字节，生成：

```text
<64 位小写 hex>  <id>-<version>.html
```

`publish` 不联网，输出 Registry 条目、上传清单、审核 checklist；可加
`--registry-dir <dir>` 直接合并到本地 `registry/games.json`。

---

## 7. 在 Market 中安装与运行

### 7.1 本地安装

1. `npm run pack`；
2. Game Market → My Games → Install local；
3. 选择 `dist/<id>-<version>.html`；
4. 确认（本地来源不可验证）；
5. 在 My Games 中启动；存档按 `<id>` 隔离，卸载默认保留存档。

### 7.2 静态 Registry

1. 把 `<id>-<version>.html` 上传到 GitHub Release（或 allowlist 内的 https host），
   URL 末段必须是 `<id>-<version>.html`；
2. 把 `dist/registry-entry.json` 合并进 `registry/games.json`（`registryVersion:1`），
   或 `publish --registry-dir <registry-repo>`；
3. 更新 `generatedAt` 并提 PR；
4. Host 拉取 Registry 后即可在 Market 看到并安装；Host 会重新下载并复验 sha256、
   manifest、自包含与版本兼容性（CLI 的校验结果不被信任）。

### 7.3 社区投稿（V1.2）

官方首发目录之外的游戏通过 GitHub 内容仓库投稿，而不是直接修改平台 `registry/`：

- 作者流程/字段/自测：`docs/community-submission.md`；
- 维护者审核与上架（dry-run/execute）：`docs/community-operations.md`；
- 数据契约/幂等/默认源与 seed：`docs/community-publishing-contracts.md`；
- AI 开发：`skills/dsh-game-developer/`（不授予发布权限）。

`scripts/registry/prepare.mjs --execute` 只会创建 catalog PR，不会自动合并；合并
才是上架。

### 7.4 版本与兼容

- 更新版本 = 修改 `manifest.json` 的 `version`，重新 build/pack/publish；
- 平台只在 Registry 版本更高时显示 Update，不自动更新；
- 已安装游戏运行前会再次校验 `sdkVersion`/`runtimeVersion`；不满足则禁止启动并说明；
- `^1.0.0` 是 V1 推荐范围；V0 的 `0.1.x` 范围仍可运行（legacy 窗口）。

---

## 8. 常见错误与修复

| 错误 | GM | 修复 |
|---|---|---|
| `E_PKG_MANIFEST_MISSING` | GM-4221 | 用 `manifest.json` 工程构建，不要手写包；确认 `id="dsh-game-manifest"` |
| `E_PKG_MANIFEST_DUPLICATE` | GM-4221 | 包内只能有一份内嵌 manifest |
| `E_PKG_MANIFEST_JSON` | GM-4228 | 修 JSON；不要重复键/尾逗号 |
| `E_PKG_ID_INVALID` / `E_PKG_ID_RESERVED` | GM-4234/4235 | 改 id；避免 `--` 与保留字 |
| `E_PKG_VERSION_INVALID` | GM-4236 | 用 `1.0.0` / `1.0.0-beta.1`，不要 `+build` |
| `E_PKG_CAPABILITY_*` | GM-4239/4240/4241 | 只声明 `storage`/`score`，各一次，且配套 `save`/`score` |
| `E_PKG_ENTRY_NOT_SELF_CONTAINED` | GM-4225 | 内联所有资源；移除 fetch/XHR/WebSocket/iframe/@import/srcset |
| `E_PKG_TOO_LARGE` | GM-4135 | 包 ≤20 MiB |
| `E_PKG_LEGACY_FIELD` | GM-4237 | 移除 `entry`/`cover`/`screenshots`，`author` 用对象、分类用数组 |
| `E_COMPAT_SDK` / `E_COMPAT_RUNTIME` | GM-4261/4260 | 降低范围或升级平台 |
| `GM-4031` | — | `await game.ready()` 后再调用受限 API |
| `GM-4131/4132/4133/4134` | — | 修存档大小/key/JSON |
| `GM-5001/5002/5003` | — | ready 超时 / 协议不兼容 / 不在 Runtime iframe |
| `GM-4006` | — | 分数超出 `manifest.score` 范围 |

完整 `E_* → GM-*` 映射见 `docs/V1-CONTRACTS.md` §4.3 / `packages/shared/src/errors.js`。

---

## 9. 参考

- PRD v2.2 §4（开发者体系）、§8.2（包/manifest/校验/CLI/模板）、§8.3（SDK）、§8.8（Registry）。
- `docs/V1-CONTRACTS.md` §2（单文件/自包含）、§3（manifest）、§4（三阶段职责与错误码）、
  §6（本地安装）、§8（SDK v1）。
- `docs/developer-cli.md`：CLI 参数、退出码、JSON 输出。
- `packages/sdk/src/index.d.ts`：SDK 公开类型。
- `templates/vanilla`：零依赖参考实现；`templates/react`：Vite + React 说明性模板。

---

## 10. V1.5 双格式（`html-v1` / `asset-zip-v2`）

V1.5 起同一个 CLI、同一套模板支持两种包格式；**不带 `--format` 时行为与 M1 完全一致**
（单文件 `dist/index.html` → `dist/<id>-<version>.html`，老工程/老命令无需改动）。

### 10.1 选择格式

```bash
# 显式
dsh-game create my-game --template vanilla --format asset-zip-v2
dsh-game build . --format asset-zip-v2
# 或在 dsh-game.config.json 里固定（省略 --format 时读取）
#   "format": "asset-zip-v2"
```

优先级：显式 `--format` > `dsh-game.config.json#format` > `html-v1`。
未知格式值会直接报错（不会静默回退）。

| 命令 | `html-v1`（默认） | `asset-zip-v2` |
|---|---|---|
| `create` | 单文件模板 | 资源包骨架：`manifest.json` + `index.html` + `src/` + `scripts/` + `assets/ levels/ audio/` |
| `build` | `dist/index.html`（内联） | `dist/` 目录树 + `dist/dsh-package.json`（files[] 按 UTF-8 排序，size/sha256）+ `dist/game.json` |
| `validate` | `.html` / 项目目录 | 项目目录 / `dist/` / `.dshgame.zip`；真实调用 Host `extractPackageArchive` |
| `pack` | `dist/<id>-<version>.html` + `.sha256` | `dist/<id>-<version>.dshgame.zip`（确定性、0444 条目）+ `fileCount`/`filesDigest`/self-test |
| `publish` | registry v1 entry | registry v2 语义 entry：`package.format`/`filesDigest`；`--dry-run` 零写入 |
| `dev` | 单文件 iframe | wrapper（resource origin，非 sandbox 外层）+ 沙箱游戏 iframe + `/res/<instance>/<token>/…` 资源 |

### 10.2 `asset-zip-v2` 构建产物

```text
dist/index.html          entry（外部引用；禁止内联 script/style/on*=/javascript:）
dist/dsh-sdk.js          平台 SDK（classic script，先于游戏代码）
dist/scripts/main.js     游戏入口 bundle（相对 import）
dist/styles/*.css        外部样式（build 重写 url() 指向 assets/）
dist/assets/…            图片/音频等静态资源
dist/levels/…  dist/audio/…   作者资源目录（config.resources）
dist/game.json           包内权威 manifest（= manifest.json 规范化）
dist/dsh-package.json    descriptor（formatVersion:2, entry, gameManifest, files[]）
```

约束（由 shared `package-v2.js` 与 Host `zip.js` 统一执法，CLI 不复制规则）：
只允许白名单静态类型；禁止内联脚本/样式/事件属性/`javascript:`；禁止外部 URL、`<base>`、
`<iframe>`、`eval`/`new Function`、service worker、`window.open`；包内引用只用相对路径。
Runtime 侧用 `game.runtime.assetUrl('levels/level-01.json')` 读取包内资源。

### 10.3 确定性

同一份源码连续两次 `build`/`pack` 的产物 sha256 相同：

- 构建：文件按 UTF-8 路径排序、固定 JSON 顺序、无时间戳/机器路径/随机 id；
- ZIP：条目按 UTF-8 路径排序、固定 DOS 时间 1980-01-01、STORED（无压缩参数漂移）、
  external attributes 固定 `0444`、UTF-8 名字标志、无 extra/comment/data-descriptor。

`pack` 会做 **round-trip self-test**：把刚生成的 ZIP 再用 Host reader 解包，比较
`fileManifestDigest`/entry/fileCount；`validate` 对 `.dshgame.zip` 亦走同一条真实解包校验。

### 10.4 React 模板（`templates/react`，zip 形态）

`asset-zip-v2` 必须是多文件资源包，**不能** singlefile/inline：模板 `vite.config.ts` 使用
`base: './'`，输出 `dist/assets/*.js|css`（固定文件名），不注入 `dsh-game-manifest`；
SDK 以 `public/dsh-sdk.js`（`var DSH_GAME_SDK = …`）提供，`index.html` 在模块脚本之前加载。
`npm run build` 的执行顺序：`vite:build` → CLI finalize（写 `game.json` + `dsh-package.json`）
→ `pack` → `validate` **最终 ZIP**（不是只看 dist 目录）。react 工程需要在项目内 `npm install`。

### 10.5 发布

`publish` 只做离线产物，不写远端、不重建 catalog：

```bash
dsh-game publish . --format asset-zip-v2 \
  --url https://github.com/<you>/<repo>/releases/download/v1.0.0/<id>-1.0.0.dshgame.zip \
  --cover https://raw.githubusercontent.com/<you>/<repo>/main/cover.png
# 预演（零写入）：追加 --dry-run
```

产物：`registry-entry.json`（`package.format`/`filesDigest`）、`upload-plan.md`、
`review-checklist.md`。提交到内容仓库/生成 v2 目录由 M2-D 工具链
（`scripts/registry/prepare.mjs` 等）负责；`--registry-dir` 合并对 zip 暂未接通（会明确报错）。

### 10.6 本地模拟器

`npm run dev`（zip 工程）启动的模拟器按 Host 真实路径加载：入口 iframe 指向
**平台 wrapper**（resource origin，外层不 sandbox），wrapper 内是 `sandbox="allow-scripts"`
的游戏 iframe，桥消息由 wrapper 点对点转发；资源经 `/res/<instance>/<token>/…` 提供，
SDK 握手/存档/暂停/Agent 状态控制与 html-v1 模式一致。`--no-build` 表示复用已构建产物。
