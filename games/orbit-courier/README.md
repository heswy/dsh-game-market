# 轨道信使 · Orbit Courier

> V1.5 M2 的新内置游戏：**短局街机**，一局约 **120 秒**；键盘可玩、鼠标/触屏可选；
> 它是本项目第一款 **`asset-zip-v2` 资源包内置游戏**（独立 ESM/CSS/PNG/WAV/关卡 JSON，全部真实加载）。

在三层环行星轨道间穿梭：**收取货舱 → 穿过顶部站门交付 → 躲开碎岩**。
交付越快、连击越长，分数越高；船体只有 3 格，撞坏就提前结束这一班。

- 游戏类型：arcade（reflex / 短局）
- 语言：中文 UI（英文名 Orbit Courier）
- 输入：键盘（方向键 / WASD）为主，鼠标/触屏拖动 + 轻点换轨为辅
- 分数：`higher-better`，0 – 1,000,000,000（整数）
- 存档：`save.schemaVersion = 1`（进度自动保存，可从「继续上一班」恢复）

## 怎么玩

| 操作 | 键盘 | 鼠标 / 触屏 |
|---|---|---|
| 沿轨道旋转 | `←` / `→` 或 `A` / `D` | 围绕行星中心拖动 |
| 切换轨道（内 / 外） | `↑` / `↓` 或 `W` / `S` | 轻点某一层轨道 |
| 暂停 / 继续 | `Space` 或 `P`（`Esc` 暂停） | 右上角 `II` 按钮 |
| 静音切换 | `M` | 右上角 🔊 按钮 |

- 同一条轨道上靠近货舱即自动收取（货舱满时不能再收）。
- 载着货舱经过**顶部站门**（任意轨道）即交付。
- 同一轨道上撞到碎岩会损失 1 格船体，并获得 1.5 秒无敌闪烁。
- 交付后 **4.2 秒内**再交付会提升连击（最高 **×5**）；撞一次或超时连击归 1。
- 载货 **6 秒内**交付算「快速交付」，额外 +5 分。
- 每跨过一个航段有清段奖励；一局打完还有「完成奖励」（按交付数与剩余船体结算）。

## 120 秒一局的设计参数

数据源：`src/levels/shift-01.json`（运行时通过**相对路径 `fetch`** 加载，不是内联进代码）。

| 航段 | 时间 | 主题 | 货舱生成 | 同屏货舱 | 碎岩 | 碎岩速度 | 清段奖励 |
|---|---|---|---|---|---|---|---|
| 1 | 0–40 s | 近地轨道 | 2.3 s / 个 | 2 | 1 | 0.85 rad/s | +25 |
| 2 | 40–80 s | 碎石带 | 1.9 s / 个 | 3 | 2 | 1.15 rad/s | +35 |
| 3 | 80–120 s | 夜航深空 | 1.5 s / 个 | 3 | 3 | 1.50 rad/s | +50 |

- 第三段每 **12 秒**追加一次「碎岩突袭」（2 颗、7 秒后消散，画面上有红色警示环）。
- 难度曲线：生成密度 +30%，碎岩数量 ×3，速度 +76%；玩家侧不变（角速度 1.85 rad/s、换轨冷却 170 ms），
  所以压力来自「更频繁的换轨决策」，而不是操作变迟钝。
- 计分：交付 = `10 × 连击`（+5 快速交付）；清段 25/35/50；完成奖励 = `2 × 交付数 + 50 × 剩余船体`。
- 每局时长固定 120 秒（`durationSeconds`），到点结算；船体 3 格耗尽则提前以「船体报废」结束（已得分保留）。

## 包结构（`asset-zip-v2`，与 Host/M1 契约对接）

```text
games/orbit-courier/
  game.json                 # 清单源（attach 到 dist/game.json）
  src/
    index.html              # 入口（外链 CSS + ESM，无内联脚本/样式/事件）
    main.js                 # 启动：加载关卡、选择平台/离线 adapter
    game.js                 # 帧循环、HUD、覆盖层、SDK 生命周期
    logic.js                # 纯规则（生成/碰撞/计分/航段/存档序列化，可单测）
    render.js               # Canvas 2D 渲染（星球/轨道/站门/货舱/碎岩/飞船/粒子）
    input.js                # 键盘 + 指针输入
    audio.js                # WebAudio 一次性音效（首次手势后解锁 + 静音持久化）
    resume.js               # 存档 / 继续 / 最高分
    offline.js              # 脱离宿主时的 localStorage adapter（本地预览用）
    styles/game.css
    levels/shift-01.json    # 关卡数据（3 航段）
  assets-src/generate.mjs   # 确定性 PNG/WAV 生成器（无二进制源文件）
  build.mjs                 # 确定性构建 → dist/
  test/                     # 规则测试 + 包契约/确定性/ZIP 安装测试
  dist/
    dsh-package.json        # formatVersion 2, entry, gameManifest, files[]（排序、不含自身）
    game.json
    index.html
    scripts/**.js           # 含 scripts/vendor/dsh-sdk.js（由 packages/sdk 打包，单文件）
    styles/game.css
    assets/*.png            # courier-ship / cargo-pod / asteroid
    levels/shift-01.json
    audio/*.wav             # collect / deliver / deliver-fast / hit / act / end
```

- 包内**禁止**内联 `<script>`/`<style>`/`on*=`/`javascript:`/外部 URL；构建时用 M1 校验器
  （`checkHtmlContent({inlineForbidden:true})`、`checkCssContent`、`checkManifestConflict`、
  `validateDescriptor`、`checkZipEntryPath`）自检。
- 构建与测试都会把 dist 真正打成 ZIP，走一次 `packages/host/src/zip.js#extractPackageArchive`，
  证明它能通过 M1 的安装管线。

## 自动化验收探针（只读快照钩子）

自动化验收探针使用只读快照钩子 `window.__ORBIT_PROBE__.snapshot()`，**不影响游戏行为**：
它返回当前渲染/规则状态的一份冻结副本（阶段、时钟、分数、船体、所在轨道、飞船角度、货舱、
碎岩位置/方向/剩余寿命、站门角度、音效状态），没有任何写入/加输入/改分入口；属性本身
`writable:false`、`configurable:false`，快照调用不改变运行状态。

这样验收 bot 能像玩家一样看到碎岩并躲避，从而真实打满 ~120 秒，而不是盲玩撞毁。
读取示例（在游戏 iframe 内）：

```js
const s = window.__ORBIT_PROBE__.snapshot();
// s.phase / s.elapsedMs / s.hull / s.lane / s.stationAngle
// s.asteroids: [{ id, lane, angle, direction, ttlMs }]
// s.cargo:     [{ id, lane, angle, ttlMs, ageMs }]
```

## 构建 / 测试 / 本地预览

```bash
# 构建（确定性：连续两次字节一致）
node games/orbit-courier/build.mjs

# 测试（规则 + 包契约 + 确定性 + 真实 ZIP 安装）
node --test "games/orbit-courier/test/*.test.js"

# 本地直接预览（离线 adapter，不需要 DSH）
python3 -m http.server 8080 --directory games/orbit-courier/dist
# 打开 http://127.0.0.1:8080/
```

`npm run build` 会自动发现并运行 `games/*/build.mjs`，无需额外注册。

## 实现要点

- **只用 SDK**：`game.ready()/storage/score/session/lifecycle`，不直连 Host API；SDK 以
  `scripts/vendor/dsh-sdk.js` 单文件打进包内（契约 §1.10），构建时由 `scripts/bundle-lib.mjs` 生成。
- **宿主返回的是 envelope**：`storage.load(key)` → `{ key, data, revision, updatedAt }`（payload 在 `.data`），
  `score.getBest()` → `{ score, achievedAt, meta }`。所有读取都经 `src/storage-shapes.js` 解包；
  存档只在真实运行开始后写入（菜单/加载态永不落盘），避免 resume-paused 重启时把可继续的存档覆盖成空局。
- **音效/autoplay**：WebAudio context 只在首次用户手势（按键/点击）后创建/恢复，
  之后按需 `fetch` + `decodeAudioData` 加载包内 WAV；静音状态写入 storage（键 `muted`）。
- **无障碍 / 响应式**：HUD 为 DOM（可读屏、可聚焦按钮），`aria-live` 播报状态；375 px 下 HUD 收窄、
  面板变底部 sheet；`prefers-reduced-motion`（及运行时 `reducedMotion`）关闭粒子、屏幕抖动、脉冲与过渡。
- **平台安全区**：顶部 112 px、右下 96×96 不放置任何 HUD/按钮（沿 V1 全出血契约）。
- **确定性**：PNG/WAV 由代码生成（固定 zlib 级别、固定采样、种子化随机），
  构建无时间戳/绝对路径；`dsh-package.json` 文件按码点排序。

## 已知边界

- 内置装载与 `asset-zip-v2` 的 Host 侧支持由 M2 另一条工作流提供（`BUILTIN_GAMES` 注册、资源 origin 服务等）；
  本目录只负责产出冻结布局的 `dist/` 与自检。在 Host 侧接入前，`scripts/check.mjs` 的
  「所有 games 都是 V1 单文件包」假设会让 `npm run check` 对本游戏报错（预期，见任务交接）。
- 独立打开 `dist/index.html`（`file://`）无法 `fetch` 关卡 JSON，请用上面的本地 HTTP 预览。

## 许可

MIT（与平台一致）。清单 `license: "MIT"`。
