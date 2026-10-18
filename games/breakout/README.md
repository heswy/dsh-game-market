# Breakout · 打砖块（V1 首发）

经典街机弹球：移动挡板反弹球，击碎普通与坚硬砖块，在 5 个手工关卡里清屏、过关、拿分。支持鼠标与纯键盘、暂停/恢复、自动保存、Continue、个人最高分。

- 单文件自包含包：`dist/index.html`（内嵌 manifest v1 + SDK + JS + CSS + data URI，无外部资源）
- manifest 源：`game.json`（构建期读取并内嵌）
- 零第三方依赖、零网络请求、无 `@font-face`
- 纯逻辑由 `node --test` 覆盖，构建确定性（连续构建 sha256 一致）

## 1. 目录与交付物

```text
games/breakout/
├── game.json               # 构建期 manifest v1 源（无 entry/cover/screenshots）
├── build.mjs               # 零依赖构建：单文件 HTML + 内嵌 SDK/manifest/脚本/CSS
├── src/
│   ├── logic.js            # 纯逻辑：物理、碰撞、砖块、关卡、计分、生命、存档编解码
│   ├── render.js           # Canvas 渲染：HUD、砖块、挡板、球、粒子、主题、动效
│   ├── game.js             # 输入/生命周期/存档/Continue/分数提交/界面
│   └── index.html.tpl      # 页面骨架、CSS、manifest 与内联脚本占位符
├── test/
│   ├── logic.test.js       # 碰撞/砖块/计分/关卡/生命/暂停/确定性
│   ├── save.test.js        # 存档往返、损坏存档、归一化、Continue
│   └── stability.test.js   # 5 分钟固定步长回放稳定性
├── dist/index.html         # 构建产物（提交）
└── README.md
```

## 2. 玩法与操作

| 操作 | 输入 |
|---|---|
| 移动挡板 | 鼠标移动，或 `←` / `→`、`A` / `D` |
| 开始游戏 / 重开 | `Enter` / `Space`（在开始与结算界面） |
| 发射球 | `Space` / `Enter`，或点击画布 |
| 暂停 / 恢复 | `P`（游戏内）；平台暂停/恢复事件同样生效 |
| 返回/平台菜单 | `Esc` **不拦截**，留给 Runtime |

- 开局与掉命后球停在挡板上，按 `Space`/`Enter` 或点击发射，不会自动开球。
- 暂停会立即停止 `requestAnimationFrame` 物理推进并保存；暂停时长不计入球速/计时。
- 结算界面（Game Over / 全部通关）可用 `Enter` 或按钮重开。

## 3. 规则

### 3.1 关卡

| # | 名称 | 球速倍率 | 特点 |
|---|---|---|---|
| 1 | 初次接触 / First Contact | 1.00 | 4 行基础布局，含 2 块 2 HP 硬砖 |
| 2 | 双塔 / Twin Towers | 1.08 | 左右硬砖双塔 + 中央普通砖 |
| 3 | 蜂巢 / Honeycomb | 1.16 | 交错棋盘、硬砖与 1 块不可破坏砖 |
| 4 | 要塞 / Fortress | 1.24 | 上下不可破坏边墙 + 中央堡垒 |
| 5 | 终局 / Last Stand | 1.32 | 高密度混合布局 |

- 清屏（所有**可破坏**砖块消失）后进入 1.2s 清关过渡，随后自动进入下一关并发射新球。
- 最后一关清屏 → `won`；命耗尽 → `over`；两种终局都只结算一次。

### 3.2 砖块与计分

| 类型 | 耐久 | 分数 | 视觉 |
|---|---|---|---|
| 普通 `normal` | 1 | 击碎 +10 | 青色带内框 |
| 坚硬 `hard` | 2 | 每击 +10；击碎额外 +20（合计 +30） | 琥珀色，2 条竖纹；受损后出现裂纹 |
| 不可破坏 `solid` | — | 0 | 蓝灰色斜纹 + 中央锁条；反弹但不计分 |

- 过关奖励 `100 × 关卡序号`，单调可复现。
- 分数方向 `higher-better`，整数，`min 0`、`max 10000000`（见 §8 契约备注），实现内 clamp 到上限。
- 球速 = `360 × 关卡倍率 + min(160, 击打数 × 4) + min(90, floor(关卡耗时/10s) × 10)`，上限 760 px/s。
- 挡板反弹角与落点相关，最大 ±60°，保证竖直分量 ≥ 0.5×速度，避免水平锁死。

### 3.3 状态机

```text
boot -> ready -> playing -> paused -> playing
                  |  \-> level-clear (1.2s) -> playing (next level)
                  |  \-> over / won -> ready (新局)
```

- `paused` 由 `P` 或平台 `pause` 触发；物理冻结、球/砖/分数不回退。
- 暂停中清关计时同样冻结。
- `ready` 时挡板可移动、球跟随挡板；不发射就不消耗生命。

## 4. 存档与 Continue

- 存档 key：`current`；内嵌 `save.schemaVersion`：`1`；存档自身 `version`：`1`。
- 存储形态（`serialize()`，全部为 JSON 值）：

```json
{
  "version": 1,
  "seed": 123456,
  "rngState": 123456,
  "level": 2,
  "lives": 2,
  "score": 830,
  "status": "playing",
  "paddle": { "x": 430 },
  "ball": { "x": 512, "y": 300, "vx": 120, "vy": -160, "launched": true },
  "bricks": [{ "row": 0, "col": 0, "type": "hard", "hp": 2 }],
  "levelHits": 2,
  "elapsedMs": 5000,
  "clearTimer": 0
}
```

- 单局体量约 2–4 KiB（远低于 32 KiB 目标 / 1 MiB 上限）。
- 保存时机：`before-save`（平台 30s/暂停/隐藏/离开）、`pause`、`resume`、启动新局、掉命、清关/过关、隐藏。
- 恢复规则：
  - 结构化损坏 → `deserialize` 返回 `null`，游戏提示后开始新局，不崩溃；
  - 球已掉底/速度非法/坐标越界 → 归一化到安全发球位；
  - 清关过渡中保存 → 恢复时直接进入下一关；
  - 终局存档不参与 Continue（Host 同时要求未结束 Session）。
- 暂停中保存的 `status: "paused"` 会在 Continue 后恢复飞行；`ready` 存档恢复后仍需发射。

## 5. SDK v1 集成

```js
const game = DSH_GAME_SDK.createGameSDK();
```

- 启动：注册 `lifecycle.on('pause'|'resume'|'hidden'|'visible'|'before-save')` 与 `agent.on('status')`，然后 `await game.ready()`；`ready` 失败显示带错误码的致命覆盖层，可重试。
- `ready` 后：`game.session.start()`（幂等；Runtime 已自动开始时 `adopted:true`）。
- 读档：`const saved = await game.storage.load('current')` → `deserialize` → 开始界面显示「继续上一局」。
- 存档：`game.storage.save('current', serialize(state))`；失败显示 `GM-*` 代码与「重试」，不静默丢档。
- 结束：`game.score.submit(score)` **一次** + `game.session.end({ outcome: 'completed', score })` **一次**；`best/isBest` 回填最高分与新纪录提示。
- 暂停/恢复：平台事件优先级最高；`before-save` 处理器同步发起保存（Runtime 最多等待 1.5s）。
- 主题/减少动效/语言：读取 `game.runtime.theme`、`game.runtime.reducedMotion`、`game.runtime.locale`；每帧同步活视图。

## 6. 构建与测试

```bash
# 构建单文件包（打印字节数与 sha256）
node games/breakout/build.mjs

# 确定性校验（与已提交 dist 比较）
node games/breakout/build.mjs --check

# 纯逻辑测试
node --test games/breakout/test/*.test.js

# 根工程全量验证（build + check + test）
npm run verify
```

- 构建零依赖，复用根仓库 `scripts/bundle-lib.mjs`（只读）与 `packages/shared/src/manifest.js` 校验器。
- 构建期会调用 `validatePackageHtml` 校验 manifest、自包含、网络 API、体积、BOM、LF 等。
- 确定性：不写时间戳、随机 id、机器路径；manifest 使用固定键序；两次构建 sha256 必须一致。

## 7. 体验与可访问性

- 960×540 逻辑分辨率，16:9 `contain` 缩放；1440 宽、640–756 窄窗、横竖比例均无横向滚动。
- 暗色/浅色两套 canvas 调色板与 DOM 主题；文本对比度 ≥ 4.5:1（关键标签使用高对比前景）。
- `reducedMotion` / `prefers-reduced-motion`：关闭粒子、球尾迹、脉冲与卡片动画，保留状态反馈。
- 键盘完整可达：开始/发射/移动/暂停/重开；按钮有可见焦点环，画布有柔和焦点边界；`Esc` 不拦截。
- 错误可恢复：存档失败、分数提交失败、会话结束失败、读档失败均显示带 GM 码的 toast，可重试；启动失败显示覆盖层。
- 5 分钟稳定性：固定 1/120s 步长、帧累计上限、粒子上限 160、无额外计时器；`stability.test.js` 回放 5 分钟游戏时间。

## 8. 契约备注（交给 Lead 裁决）

1. **P 暂停**：任务说明写「P 暂停由 Runtime 处理」，但当前 Runtime 的键盘暂停只绑定 `Escape`（`packages/client/src/components/runtime.js`），P 没有平台级处理。为满足验收 A-04「纯键盘暂停/恢复」与 §5.1「P 暂停/恢复」，本游戏在 iframe 内处理 P；`Escape` 保持不拦截，平台仍可通过暂停菜单/`Escape` 触发 `pause`/`resume`。若 Lead 决定 P 必须完全交给 Runtime，删除 `handleKeyDown` 中的 P 分支即可，其余生命周期逻辑不变。
2. **分数上限**：本任务书写 `score.max = 10000000`，`docs/V1-GAME-ACCEPTANCE.md` §5.4/§6 写 0–1,000,000。本实现按任务书写 10,000,000（实际单局远低于 1,000,000）。请 Lead 统一文档或确认改回 1,000,000。
3. **真机验证**：本次提交完成了构建、纯逻辑测试、根 `npm run verify`，并用隔离 mock Runtime 在 headless Chrome 里验证了启动、Continue、暂停/恢复、before-save、Game Over、分数提交与 Enter 重开；**未在 DSH 0.2.1-rc.2 真机宿主中执行** A-03/A-11/A-12/A-13 的最终取证，需在 M3 隔离宿主补录 `docs/V1-VERIFICATION.md`。

## 9. 人工验收清单（对应验收文档 §5.7）

1. 从 Market/Registry 安装并进入；鼠标移动与 `←`/`→` 都能控制挡板。
2. 击碎普通/硬砖，确认硬砖需要两击、分数不同；过关后球速提升。
3. 故意掉球：扣命、球与挡板重置、分数与砖块保留；命耗尽 → Game Over 并只提交一次分数。
4. 玩到一半按 `P` 暂停 → 离开 → Continue，确认关卡/命/砖块/分数/球速恢复。
5. 清屏进下一关，确认 1.2s 过关提示与关卡变化；返回 Market 再进入恢复正确。
6. 切后台 30s 再回来，确认暂停/保存/恢复，无穿墙/瞬移。
7. 暗色/浅色、1440/窄窗、减少动效各扫一遍；Network 面板 0 外联。
8. 连续玩 5 分钟（含多关）无崩溃、无卡死、无白屏。

## 10. 已知限制

- 无音效（V1 单文件包不引入音频资源；避免额外体积与自动播放限制）。
- 无排行榜 UI；分数与最高分走平台 `score` 能力，由 Market/Agent 侧展示。
- 无触控专用手势；鼠标/指针移动与键盘已覆盖，触摸屏点击可发射。
