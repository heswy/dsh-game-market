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
模板里的 `npm run ...` 已通过 `dsh-game.config.json` 记录本地 CLI 路径，可正常使用。

---

## 1. 五分钟跑通

```bash
# 1) 在空目录创建工程（id 即目录名；--dir 指定父目录）
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
├── dsh-game.config.json    # manifest/template/entry/out 与本地 CLI 路径
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

## 5. 本地预览 / Runtime Simulator

```bash
npm run dev                 # 从源码构建并在 /game 提供最新产物
npm run dev -- --port 4400
npm run dev -- --no-build   # 直接服务已构建的 dist/index.html
```

模拟器（`scripts/cli/dev-server.mjs` + `scripts/cli/lib/dev-harness.mjs`）扮演可信 Runtime：

- 用 `sandbox="allow-scripts"` 的 iframe 加载 `dist/index.html`；
- 完成 `hello → init → ready` 握手，并实现 storage/session/score/agent 的 fake Host；
- 页面右侧可切换 **Agent Running / Waiting user / Completed / Error / Idle**；
- **Pause / Resume / before-save / Clear save / Reload**；主题、locale、视口、Ping；
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
8. 打开/关闭主题与 locale，检查画布/文案与 DPR。

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

### 7.3 版本与兼容

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
