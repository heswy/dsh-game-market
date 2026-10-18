# 跳跃 / Jump

> DSH Game Market V1 首发游戏 · 单文件自包含 · Game SDK v1

- id：`jump`；版本：`1.0.0`；分类：`arcade`
- 逻辑画布：`540 × 960`（9:16 竖屏，`contain`）；无限向上世界
- 能力：`storage` / `score`；分数方向 `higher-better`，范围 `0 – 1,000,000` 的整数
- 产物：`dist/index.html`（内嵌 manifest v1、SDK、样式、脚本、图标 data URI）
- 零第三方依赖、无网络请求、无外部资源；`dist/index.html` 约 195 KiB

---

## 1. 玩法

玩家在纵向无限延伸的平台世界中自动弹跳，用 `←` / `→`（或 `A` / `D`）左右移动，
落到平台顶部后自动再次弹起。平台由种子化随机算法程序化生成，越往上分数越高。

| 平台 | 行为 |
|---|---|
| `normal` | 普通平台，稳定承接一次弹跳 |
| `moving` | 左右往复移动，碰到边界反向 |
| `fragile` | 落地弹起后碎裂，不能再次承接（视觉上会掉落） |
| `spring` | 带弹簧，弹起高度约为普通平台的 2.6 倍 |

- **计分**：从起跳位置开始，玩家到达的最高点每 `10` 个逻辑像素记 `1` 米；
  `score = floor((maxHeight - startY) / 10)`，单调不减，封顶 `1,000,000`。
  分数即高度（米），不需要吃道具也会持续增长。
- **结束**：玩家掉出相机下沿 `40px` 后本局结束；本局分数冻结。
- **相机**：只向上跟随（玩家到达屏幕约 38% 高度后开始滚动），永不回退；
  掉出底部即结束。
- **目标感**：每 100 米有横向刻度；跨过 100 米整数倍时顶部弹出里程碑提示；
  超过个人最高分时 HUD 出现 `NEW` 徽标，结束时显示“新纪录”。

### 操作

| 键 | 行为 |
|---|---|
| `←` / `→` 或 `A` / `D` | 左右移动；在开始界面按下也会直接开局 |
| `Space` / `Enter` | 开始、继续、重开；游戏中 `Space` 也可暂停 |
| `P` | 暂停 / 恢复（游戏内兜底） |
| `Esc` | **游戏不拦截**，交由 Runtime / 宿主处理 |

> V1 Runtime 的暂停遮罩是权威路径：`lifecycle.on('pause')` 到达时游戏立即停 rAF、
> 保存并显示暂停说明；`resume` 到达后直接继续（不再二次确认，对齐 D-024）。
> `P` 是平台暂停没有到达时的本地兜底；平台暂停期间按 `P` 不会解除平台暂停。

---

## 2. 构建与测试

```bash
# 构建单文件（会打印字节数与 sha256）
node games/jump/build.mjs

# 仅本游戏测试
node --test games/jump/test/*.test.js

# 仓库全量验证（会包含本游戏测试）
npm run verify
```

### 确定性构建验收

```bash
node games/jump/build.mjs
shasum -a 256 games/jump/dist/index.html
node games/jump/build.mjs
shasum -a 256 games/jump/dist/index.html
```

当前产物（2026-10-18）：

```text
198887 bytes
sha256 cddd834590f75f461030aa49c414abc1d7557774bc68ba4676209ed0fda1ea77
```

两次连续构建的 sha256 必须一致；`build.mjs` 不写时间戳、机器路径或随机 id，
manifest 使用固定键序序列化，SDK/游戏 bundle 由 `scripts/bundle-lib.mjs` 按固定顺序内联。

---

## 3. 单文件包与 manifest

`game.json` 是**构建期 manifest 源**，没有 `entry` / `cover` / `screenshots` 字段；
`build.mjs` 读取它、补上 `src/icon.png` 的 data URI，以内嵌方式写入：

```html
<script type="application/json" id="dsh-game-manifest">{ ... }</script>
```

构建结果：

- 单文件、UTF-8 无 BOM、无外部 `<script src>` / `<link href>` / 远程图片或字体；
- 所有 CSS、JS 内联；图标是 manifest 内的 PNG data URI（解码后约 22 KiB）；
- 内嵌 manifest 恰好一处，约 31 KiB（上限 64 KiB）；
- 构建最后调用 `packages/shared/src/manifest.js#validatePackageHtml`
  校验 manifest v1、字段合法性、自包含与 20 MiB 上限；失败则构建退出非 0；
- 输出 `games/jump/dist/index.html`；Registry 打包时由 CLI/Lead 生成
  `jump-1.0.0.html`（包名规则属于打包步骤，不改变本文件内容）。

manifest 关键字段：

```json
{
  "manifestVersion": 1,
  "id": "jump",
  "version": "1.0.0",
  "categories": ["arcade"],
  "capabilities": ["storage", "score"],
  "sdkVersion": "^1.0.0",
  "runtimeVersion": "^1.0.0",
  "preferredTheme": "game-defined",
  "viewport": { "width": 540, "height": 960, "fit": "contain" },
  "score": { "direction": "higher-better", "min": 0, "max": 1000000, "integer": true },
  "save": { "schemaVersion": 1 }
}
```

> 竖屏 `540×960` 是跳跃类玩法的有意选择（任务允许自定 viewport）；
> `docs/V1-GAME-ACCEPTANCE.md` §3.1 中“960×540”是旧文案，需 Lead 统一（见 §9）。

---

## 4. SDK 行为

| SDK | 用法 |
|---|---|
| `game.ready()` | 启动只握手一次；失败显示带 `GM-*` 码的错误卡片与“重新加载” |
| `game.runtime` | 读取 `theme`、`reducedMotion`、`locale`；主题/减少动效支持运行中切换 |
| `lifecycle.on('pause')` | 停 rAF、停计时、保存、显示暂停遮罩；不自行恢复 |
| `lifecycle.on('resume')` | 重置固定步长累加器后继续，暂停时长不计入 `elapsed` |
| `lifecycle.on('hidden'/'visible')` | 隐藏即停循环并保存；可见时恢复渲染/循环 |
| `lifecycle.on('before-save')` | 在 Runtime 的 1.5s 窗口内 `storage.save('current', state)` |
| `storage.load/save` | 只使用 key `current`；启动读档，30s 自动保存由 Runtime 触发 |
| `session.start()` | 首次进入 `playing` 时调用一次（Restore/Resume 时接管已有 Session） |
| `session.end({outcome:'completed', score})` | 本局结束时调用；暂停/离开不结束 Session |
| `score.getBest()` | 启动展示 Personal Best；失败不阻塞游玩 |
| `score.submit(score)` | 本局结束时提交一次；失败显示 `GM-*` 码与“重试” |
| `agent.on('status')` | 底部轻量显示 Agent 等待/完成提示（不阻塞游戏） |

- 持久化调用点：开局、`P` 暂停、平台 `pause`、`hidden`、`before-save`、本局结束。
- 保存失败不会清空上一份存档，并在底部显示带错误码的可重试提示；
- 读档失败/损坏会显示提示并开始新局，不崩溃、不静默丢档；
- 分数提交失败可重试；结束前的最终保存与 `session.end` 保持串行。

---

## 5. 存档 schema

- key：`current`
- 存档版本：`version: 1`（与 manifest `save.schemaVersion: 1` 对应）
- 典型大小：20 个平台约 **1.1–1.4 KiB**；平台上限 64，远低于 256 KiB/1 MiB 限制
- 只在屏幕下方 2 屏范围内保留平台，避免存档膨胀

```json
{
  "version": 1,
  "seed": 7777,
  "platforms": [
    { "id": 0, "x": 206, "y": 120, "w": 128, "type": "normal" },
    { "id": 1, "x": 14, "y": 229, "w": 115, "type": "normal" },
    { "id": 2, "x": 320, "y": 338, "w": 108, "type": "moving", "vx": 70, "dir": -1 },
    { "id": 3, "x": 110, "y": 451, "w": 100, "type": "fragile", "broken": true }
  ],
  "player": { "x": 270, "y": 545.5, "vy": -320 },
  "camera": { "y": 0 },
  "score": 40,
  "elapsed": 12.4,
  "maxHeight": 545.5,
  "startY": 141,
  "rngState": 123456,
  "platformSeq": 4,
  "status": "ready"
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `version` | 游戏存档 schema 版本，固定 `1` |
| `seed` | 本局种子（uint32） |
| `rngState` | 后续平台生成的 RNG 状态；保证 Continue 后世界一致 |
| `platforms` | 按 `y` 升序的平台快照；`moving` 带 `vx/dir`，碎裂平台带 `broken` |
| `player` | 玩家中心 `{x,y,vy}`（逻辑像素、像素/秒） |
| `camera.y` | 屏幕下沿的世界 Y；只增不减 |
| `score` | 已结算的米数（整数 0–1,000,000） |
| `elapsed` | 本局游戏时间（秒，不含暂停） |
| `maxHeight` / `startY` | 最高点与起跳点，用于恢复计分 |
| `platformSeq` | 平台 id 序列号，恢复后继续单调生成 |
| `status` | 存档时只写 `ready` 或 `over`；进行中的帧快照保存为 `ready`，读档后等待玩家继续 |

恢复规则：

- `playing` 快照存为 `ready`，读档后**不会自动推进物理**；Continue 确认后才开始；
- 保留 `player.vy`，因此可以在半空中恢复原来的抛物线；
- 保留 `rngState` / `platformSeq` / 平台类型与碎裂状态，Continue 后世界一致；
- 损坏、字段缺失、版本不符、非有限数、越界平台等一律 `deserialize → null`，
  由游戏提示并新开一局；上一份真实存档不被删除；
- `serialize → JSON → deserialize → serialize` 逐字段等价（测试覆盖）。

---

## 6. 目录

```text
games/jump/
├── game.json                  # 构建期 manifest v1 源（无 entry/cover/screenshots）
├── build.mjs                  # 零依赖单文件构建 + 校验 + 确定性输出
├── README.md
├── src/
│   ├── logic.js               # 纯逻辑：RNG/平台生成/物理/碰撞/相机/计分/存档
│   ├── game.js                # canvas 渲染、输入、HUD/遮罩、SDK 生命周期
│   ├── index.html.tpl         # 单文件模板（内联样式/UI）
│   └── icon.png               # 256×256 图标，构建时转为 manifest data URI
├── test/
│   ├── logic.test.js          # 生成/物理/碰撞/相机/计分/结束/确定性（17）
│   └── save.test.js           # 存档回环/损坏/体积/恢复（13）
└── dist/
    └── index.html             # 构建产物（提交）
```

### 纯逻辑设计

- 固定 60 Hz 步长（`STEP_SECONDS = 1/60`）；渲染帧率与实际 delta 只影响追帧，
  单帧最多补 5 步，切后台/暂停恢复不会瞬移；
- 随机数使用 Mulberry32，状态 `rngState` 可存档；同 seed + 同输入序列逐字节可复现；
- 平台纵向间距 84–142px，普通弹跳最大上升约 277px；
  水平步进 ≤210px，弹跳水平可达距离约 376px，生成留足可达余量（测试断言）；
- 碰撞只从上方跨过平台顶面时吸附，从下方穿过不吸附；
- 相机只向上跟随，平台在相机下方 420px 外裁剪；最多保留 64 个平台；
- `stepGame` 对 `ready/over` 状态返回同一引用，测试可直接断言“不推进”。

---

## 7. 验证记录（本次交付）

| 项 | 结果 |
|---|---|
| 本游戏单测 | `node --test games/jump/test/*.test.js` → **30/30 pass** |
| 仓库全量 | `npm run verify` → **375/375 pass**，build + check 通过 |
| 构建 | `node games/jump/build.mjs` → `198887 bytes`，sha256 `cddd83…ea1ea77` |
| 构建确定性 | 连续两次构建 sha256 完全一致（见 §2） |
| 单文件校验 | 共享 `validatePackageHtml` 通过；1 处内嵌 manifest；0 外部资源 |
| 真 SDK 桥接 | 本地桥接 harness：`ready`、`agent.getStatus`、`score.getBest`、`storage.load`、`session.start`、`storage.save`、`pause/resume`、`before-save`、`theme` 全部成功，0 错误 |
| 键盘 | Space 开始；←/→ 移动；P 暂停/恢复；Space/Enter 重开；Esc 不拦截；暂停/恢复 elapsed 冻结/继续 |
| 存档/错误 | 暂停、hidden、before-save、结束均保存；读/写/分数失败提示带 GM 码与“重试”；损坏存档起新局 |
| 多视口/主题 | headless Chrome 实测 1440×900（506×900 contain）、540×960、700×900、756×900、420×800；light/dark 均可读 |
| 减少动效 | `prefers-reduced-motion` 与 `runtime.reducedMotion` 均生效（粒子/抖动/星星闪烁/过渡关闭） |
| 稳定性 | 加速 harness 连续 **360 秒游戏时间**（60 Hz 固定步长）+ 周期 before-save：0 未捕获异常、存档稳定（约 1.2 KiB） |
| 启动 | 本机 headless 首帧 <1s；DSH 0.2.1-rc.2 真机时间未测（见 §8 风险） |

> “真机”未执行说明：本次子智能体没有启动隔离 DSH 桌面端；上述 UI/键盘/SDK
> 证据来自本地 headless Chrome + 真 SDK 桥接 harness。DSH 真机记录仍需按
> `docs/V1-VERIFICATION.md` 补测，不能以本文件替代验收文档。

---

## 8. 验收对照（`docs/V1-GAME-ACCEPTANCE.md` §1 / §3）

| 项 | 状态 | 说明 |
|---|---|---|
| A-01 单文件自包含 | ✅ | 构建校验通过；无外部资源/网络 API |
| A-02 大小/manifest | ✅ | 198,887 B；manifest v1 合法 |
| A-03 启动 ≤1.5s | ⚠️ | headless <1s；DSH 真机待测 |
| A-04 键盘可玩 | ✅ | Space/Enter/←/→/A/D/P；Esc 不拦截 |
| A-05 暂停/恢复 | ✅ | rAF 停止；elapsed 冻结；恢复不重置局面 |
| A-06 离开自动保存 | ✅ | pause/hidden/before-save 均 `storage.save('current')`，显示“已保存” |
| A-07 分数/最高分 | ✅ | 结束一次 `score.submit`；getBest 展示；NEW/新纪录反馈 |
| A-08 Continue | ✅ | 读档显示高度/最高；继续后从原世界/速度恢复 |
| A-09 存档 ≤1 MiB | ✅ | 典型 1.1–1.4 KiB，平台上限 64 |
| A-10 无外网 | ✅ | 构建扫描 + 运行无网络 API |
| A-11 5 分钟无崩溃 | ⚠️ | 加速 harness 360s 游戏时间 0 错误；真机 5 分钟待测 |
| A-12 1440 宽 | ✅ | 9:16 contain 居中，506×900，无裁切 |
| A-13 窄窗 | ✅ | 420/700/756 宽实测无横向溢出 |
| A-14 暗色主题 | ✅ | 读取 runtime.theme；light/dark 两套 artifact |
| A-15 纯键盘可达 | ✅ | 焦点落在主按钮/游戏画布；Space/Enter/P 全流程 |
| A-16 减少动效 | ✅ | runtime.reducedMotion + media query；粒子/抖动关闭 |
| A-17 错误可恢复 | ✅ | ready 失败重载；读/写/分数失败提示 GM 码与重试；旧档不删 |
| A-18 无第三方依赖 | ✅ | 零 npm 依赖；无外部字体/库 |

---

## 9. 需要 Lead / 集成处理

1. **根构建接入**：根 `scripts/build.mjs` 只构建 snake，`npm run build` 不会生成
   `games/jump/dist/index.html`；请把 `node games/jump/build.mjs` 加入根构建/CI
   （本任务写范围只允许 `games/jump/**`，未改根脚本）。
   根 `npm run verify` 的测试发现已自动包含本游戏 30 个测试。
2. **打包/Registry**：Registry 包名应为 `jump-1.0.0.html`；本文件产物为
   `dist/index.html`（与 V0/内置约定一致）。请由 Lead/CLI 的 pack 步骤复制并登记 sha256。
3. **viewport 文案冲突**：`docs/V1-GAME-ACCEPTANCE.md` §3.1 仍写“960×540 逻辑分辨率”，
   本游戏按任务允许使用 `540×960` 竖屏；A-12 的“960×540 contain”措辞需统一，
   避免验收时按横屏检查。建议在验收文档中将 jump 的 viewport 改为 540×960。
4. **DSH 真机补测**：启动耗时、5 分钟真实运行、平台暂停弹层与焦点、
   暗色/窄窗/减少动效的桌面端截图，需要 Lead 在隔离 DSH 0.2.1-rc.2 上补
   `docs/V1-VERIFICATION.md`。
5. **可选**：`scripts/check.mjs` 目前只检查 snake；可将 jump 的
   `validatePackageHtml` 检查加入根 check。

---

## 10. 参考

- `PRD｜DSH Game Market.md` v2.2 §8.2（单文件包/manifest）、§8.3（SDK）
- `docs/V1-CONTRACTS.md` §2（单文件包/自包含）、§3（manifest v1）、§8（SDK v1）
- `docs/V1-GAME-ACCEPTANCE.md` §1（A-01..A-18）、§3（jump）
- 决策：D-023 / D-034（单文件自包含）、D-024（恢复不二次确认）、D-005（保存时机）
