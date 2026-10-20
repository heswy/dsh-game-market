# V1.5 M0 · S-B1 正式标志探针记录（2026-10-19）

> 结论先行：**当前 DSH 0.2.1-rc.2 允许本项目这类第三方 `dsh.client` 包在运行时解析宿主提供的
> `@deepseek-ai/dsh-client-ui-primitives`，并直接使用官方 `FishLogo`（`currentColor`，随明暗主题变色）。**
> 因此 V1.5 的首选路径是**复用宿主正式标志、不复制官方图形资产**；本地后备资产只在宿主版本超出支持矩阵时启用。
> 所有断言均有原始证据、命令与退出码，未验证项在 §7 明确标注。

- 分支：`feat/v1.5-m0`，固定 head `689b5b9407844f1b77991676657d72e2f8d303cf`（未提交；Lead 统一提交）
- 宿主：本机 `/Applications/DeepSeek Harness.app`，`@deepseek-ai/dsh-desktop` / `@deepseek-ai/dsh-desktop-runtime` / `@deepseek-ai/dsh-plugin-manager` 均 `0.2.1-rc.2`
- 隔离方式：只读解包到 `/tmp/dsh-v15/asar`；探针 home `/tmp/dsh-v15/home-brand`；未读写 `~/.dsh/profiles/desktop`，未修改 App 内任何文件
- 探针：`scripts/verification/v1.5/brand/b1-fishlogo.mjs`（`node scripts/verification/v1.5/brand/b1-fishlogo.mjs` → **exit 0，23/23 断言通过**）

## 1. 结论（4 条）

| # | 结论 | 级别 |
|---|---|---|
| 1 | 第三方 `dsh.client` 包在真实页面中 `require('@deepseek-ai/dsh-client-ui-primitives')` **成功**（288 个导出，含 `FishLogo`/`FISH_LOGO_PATH`/`FISH_LOGO_VIEWBOX`）；未声明的未知 specifier 仍抛错（负控制通过） | 实测（隔离宿主 + headless Chrome） |
| 2 | 官方标志的权威实现随 `@deepseek-ai/dsh-web-frontend` 构建产物进入 App，**MIT**；`FishLogo` = `viewBox 0 0 23.16 17.04` + 3448 字符官方轮廓，`fill:"currentColor"` | 实测（ASAR 字节 + 运行时 sha256 比对一致） |
| 3 | 浅色/深色均由宿主主题令牌驱动：浅色 `rgb(15,17,21)`（平均亮度 0.065）、深色 `rgb(249,250,251)`（0.980），**同一路径、同一 3625 个墨迹像素**，形状不随主题变形 | 实测（页面内 canvas 采样 + 截图） |
| 4 | 本项目自研 bundler **当前拒绝**该 bare import（`Unsupported bare import …`），需在 M1 增加受审的外部 allowlist；`react-dom/client` 同样需要 | 实测（调用 `bundleModuleLoader`） |

## 2. 模块解析：为什么能解析

宿主页面启动时把一张**冻结的模块种子表**交给模块系统（`@deepseek-ai/dsh-client-modules` 的
惰性 CJS 表），第三方 bundle 的 `require(spec)` 首先命中该表，因此**平台基线模块不需要声明
`dsh.client.external`**。

- 种子表代码位置（ASAR，MIT）：`<asar>/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-CN7NIWNw.js`
  - sha256 `4bc914bfbb6adbdd63953a29f63835eb7127defd2a973149d64cdab489f1a9a5`（939,867 B）
  - 注入点：`__ModuleLoader__.create({ boot: __DSH_BOOT__, staticModules: SZ(), … })`
  - 种子 specifier（实测解出 10 个）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、
    `@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、
    `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`
- 解析顺序依据（包内 README，`@deepseek-ai/dsh-client-modules`）：platform seed table → 已 memo 的记录 →
  boot graph 行 → 已注册 factory；都不命中则抛错——探针的负控制实测到了这条错误文本：
  `client-modules: require("@deepseek-ai/dsh-probe-does-not-exist") missed the module table — not a platform seed word, not a materialized module, and no registered package factory`
- 探针本身是一个**普通第三方包**（`scripts/verification/v1.5/brand/fixtures/probe-client/`）：
  `package.json` 只声明 `dsh.client = { platform:'web', inject:[], immediately:true }` + `exports['./client']`，
  由隔离 profile 的托管行加载，与 `dsh-game-market` 的包形态一致（根 `package.json` 同字段）。

运行时实测（`b1-report.json#runtime.measurements.resolution`）：

| specifier | 结果 |
|---|---|
| `react` | ok，`version 18.3.1` |
| `react-dom/client` | ok，`createRoot` 为函数 |
| `@deepseek-ai/dsh-client-ui-primitives` | ok，288 exports，`FishLogo` 为函数，`FISH_LOGO_PATH` 为字符串（3448），`FISH_LOGO_VIEWBOX = {23.16, 17.04}` |
| `@deepseek-ai/dsh-probe-does-not-exist` | 抛错（负控制） |

## 3. 正式标志的来源与许可

| 项 | 值 |
|---|---|
| 语义来源 | `@deepseek-ai/dsh-client-ui-brand-official/lib/client.js` 的 `OfficialBrandMark` 调用 `FishLogo`（sha256 `22bb7e181a8d93372e1d14927b201612b09a02c84ea3d0f36933cfff1de47d71`） |
| 该包许可 | **MIT**，`LICENSE` sha256 `ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be`，`Copyright (c) 2026 DeepSeek` |
| 图形实现 | 随 `@deepseek-ai/dsh-web-frontend`（MIT，0.2.1-rc.2）构建产物分发；`@deepseek-ai/dsh-client-ui-primitives` **不是** App 内独立安装的包（`devDependency`，被编译进前端 bundle） |
| 官方轮廓字节 | `FISH_LOGO_PATH`，3448 字符，sha256 `5bee701f39229e6dbb3950e8ed7fe69aedc6de462df916ace5e84563715abc47`（`raw/brand/fish-logo-path.txt`） |
| 组件签名（实测反解） | `function FishLogo({size=24,className}) → <svg width=size height=size*17.04/23.16 viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path d=PATH fill="currentColor"/></svg>` |
| 另一份官方 SVG 文件 | `<asar>/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg`（MIT，`viewBox 0 0 50 50`，1 个 path，3634 B，sha256 `9e983b4f649c25c6ca0623a50be1a6e705fd8f49f756638b980fa13b40575ab6`） |
| App 许可 | `app.asar/package.json` = `@deepseek-ai/dsh-desktop 0.2.1-rc.2`，`license: MIT` |

**许可结论（供 Lead 复核）**：图形代码与轮廓数据来自 MIT 许可的 DSH 发行包，代码层面可复用/再分发（保留版权与许可声明）。
但鲸鱼形象同时是 DeepSeek 的**品牌标识**，商标/品牌使用权与 MIT 代码许可不是同一件事；本项目不声称官方发行背书
（与指南 §6.1 一致）。**因此本阶段首选"运行时 require 宿主模块、不复制资产"**，把再分发问题留到确有必要时再单独裁决。

## 4. 浅色 / 深色表现（实测）

同一页面会话内用 CDP `Emulation.setEmulatedMedia` 驱动宿主主题服务（默认偏好 `system`，`ThemeRuntime` 依
`prefers-color-scheme` 解析），断言 `body[data-ds-dark-theme]` 实际翻转后才采样：

| 主题 | `body[data-ds-dark-theme]` | 计算色 `getComputedStyle(svg).color` | 墨迹像素 | 平均亮度 | 平均 RGB |
|---|---|---|---|---|---|
| 浅色 | 无 | `rgb(15, 17, 21)` | 3625 | 0.0649 | (15, 17, 21) |
| 深色 | 有 | `rgb(249, 250, 251)` | 3625 | 0.9803 | (249, 250, 251) |

- 采样方式：把渲染出的 `<svg>`（`currentColor` 已解析为主题色）序列化为 data URI，画进 canvas 后读像素统计；
  两主题墨迹像素数完全相同，证明**只有颜色变化、轮廓几何不变**。
- 浏览器渲染的 `d` 属性 sha256 与 ASAR 中 `FISH_LOGO_PATH` 的 sha256 **完全一致**（`5bee701f…`），证明运行时用的就是宿主正式轮廓。
- 截图（证据）：`raw/brand/b1-fishlogo-light.png`、`raw/brand/b1-fishlogo-dark.png`。
  两张截图中，探针左下角渲染的标志与宿主侧栏自身的 `deepseek HARNESS` 标志形状一致、明暗同步——这是对"官方轮廓"的独立交叉印证。

## 5. 构建工具差距（M1 待办，已实测）

`scripts/verification/v1.5/brand/b1-fishlogo.mjs` 直接调用现网 `scripts/bundle-lib.mjs`：

- `import React from 'react'` → 仍可打包，产物形如 `window.__ModuleLoader__.load({ id, factory: function (require) { … require('react') … } })`。
- `import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'` → **抛错**：
  `Unsupported bare import "@deepseek-ai/dsh-client-ui-primitives" in no.js; only relative imports and "react" are allowed`

结论（写入契约 §12）：M1 必须把 `bundle-lib.mjs` 的"仅 react 外部"扩展为**受审的最小外部 allowlist**，
至少包含 `@deepseek-ai/dsh-client-ui-primitives` 与 `react-dom/client`，并按现有 react 分支生成
`const X = require("<specifier>")`。探针的 client bundle 就是按该形状手写并实测通过的（fixture 目录内）。

## 6. 后备资产生冻（不进生产，仅冻结来源与做法）

触发条件（任一）：支持矩阵内的 DSH 版本不再把 primitives 放进种子表；宿主模块导出面变化；
品牌标记需要在宿主页面之外（如外部推广页）使用。

已冻结内容（`docs/verification/v1.5/raw/brand/fish-logo-path.txt` + `b1-asar-facts.json`）：

1. **来源**：`FISH_LOGO_PATH` / `FISH_LOGO_VIEWBOX`（ASAR 内 `dsh-web-frontend` 构建产物，MIT）；
   备选 `dsh-web-frontend/dist/favicon.svg`（官方 50×50 SVG 文件，MIT）。
2. **生成方式**（可复现，不含任何手绘）：从 ASAR 只读提取 → 取 `FISH_LOGO_VIEWBOX` + `FISH_LOGO_PATH` →
   生成 `<svg viewBox="0 0 23.16 17.04" fill="none"><path d="…" fill="currentColor"/></svg>`，
   与宿主组件逐字节同源（sha256 见上）。**不得热链网页 Logo、不得换成占位鲸鱼。**
3. **许可结论**：MIT 代码许可允许再分发（保留 DeepSeek 版权与 MIT 声明）；商标/品牌使用需 Lead 与用户单独确认；
   后备资产的启用必须记录在发布说明中，且不得暗示官方背书。
4. 本阶段**不把该资产提交为生产资源**（首选路径已实证可用），避免不必要的再分发。

## 7. 未验证 / 风险

| 项 | 状态 | 说明 |
|---|---|---|
| 真实 DSH Desktop 窗口 | **未验证** | 本探针用隔离 `dsh web` + headless Chrome（同一 0.2.1-rc.2 构建）。Electron 桌面端渲染同一前端 bundle，但未在 GUI 中截图 |
| 种子表是否属公开稳定 API | **已裁决（Q-2/D-I）** | 批准为「运行期探测能力」而非契约保证：首选运行时 require，失败降级到已冻结本地官方轮廓；契约 §11.1/§12.2 已按此写 |
| `dsh.client.external` 声明 primitives 的行为 | 未验证 | 基线已可解析，无需声明；若未来移出基线，需要按 README 用 `external` 声明（M1 需补测） |
| reduced-motion / 四态动效 / 气泡 | 未验证 | 属 M4 视觉验收（B01），不在 S-B1 范围 |
| 深色主题下的真实桌面截图 | 未验证 | 同上，headless 已覆盖主题令牌解析路径 |
| 探针只证明"第三方包可解析"，未改 `packages/client` | 设计如此 | 生产代码改动属 M1/M4；本探针不修改任何 `packages/**` |

### 环境备注（已闭环）

本探针首次运行时发现：`scripts/verification/v1.5/lib/harness.mjs` 的 `repoRoot` 用 `new URL(import.meta.url).pathname` 计算，
本工作区路径含空格时 `pathname` 会保留 `%20`，导致证据被写进字面量 `/Users/<user>/Orange%20Field/…` 目录树
（误建目录中只有本次探针的 6 个文件，已核对并清理）。
本探针改为 `fileURLToPath` 自行解析根目录；**Lead 随后已在 harness 内修掉 `repoRoot`（改用 `fileURLToPath` 并断言目录存在）**，
本探针保留自身解析以维持对 harness 的独立性（两者结果一致）。

## 8. ZIP 依赖裁决的实测依据（本探针附带产物）

契约 §2 需要在"经 review 的最小归档依赖"和"自写完整解压器"之间做裁决，因此本目录同时提供
`zip-reader-eval.mjs`（12/12 通过，exit 0），实测两个候选的**能力边界**（细节见 `docs/V1.5-CONTRACTS.md` §2）：

- `yauzl@3.4.0`（MIT，唯一传递依赖 `pend@1.2.0`，MIT，安装体积 120 KiB）：暴露每项 `crc32`/`compressedSize`/
  `uncompressedSize`/`compressionMethod`/`generalPurposeBitFlag`/`extraFields`/`externalFileAttributes`/`fileNameRaw`，
  `validateEntrySizes` 默认开启；实测能识别符号链接位（`0120777`）、加密位（GP bit0）、恶意路径逐字节原样返回。
- `fflate@0.8.2`（App 内自带、MIT、零依赖，被 `dsh-session-log-export` 用于导出 ZIP）：**reader 侧不暴露 CRC 字段**，
  且对**被篡改的 Stored 条目照常返回 10240 字节且无错误**——单独使用无法满足本项目"CRC/sha 实测"的契约要求，
  也无法覆盖本地头/中央目录一致性；如选它就必须自己解析中央目录，这正是指南禁止的"自写未经验证解压器"。
- 两者都不是"依赖 DSH 私有 node_modules"的合法来源：`fflate` 虽在 App 内，但属宿主运行时依赖闭包，本项目插件安装时
  不会得到它（这是 §2 拒绝该路径的实测依据）。

## 9. 原始证据索引（全部随 Git 跟踪，`docs/verification/v1.5/raw/brand/`）

| 文件 | 内容 |
|---|---|
| `b1-report.json` | 23 条断言、DSH 身份、运行时解析结果、两主题测量、截图清单、host 日志尾部（已脱敏） |
| `b1-asar-facts.json` | ASAR 内 7 个关键文件路径 + sha256 + 字节数、许可、种子表 specifier、官方轮廓 sha256、favicon.svg 事实 |
| `b1-bundler-capability.json` | 自研 bundler 的 react 通过/primitive 拒绝原始错误文本 |
| `b1-zip-reader-eval.json` / `b1-zip-reader-eval-report.json` | ZIP 候选库实测（含 fflate 不校验 CRC 的反例与 yauzl 传递依赖闭包） |
| `b1-selftest-exit.txt` / `b1-selftest-report.json` | `--self-test-fail` 自测：证明断言失败时 **exit 1**（不是只打印 FAIL） |
| `fish-logo-path.txt` | 官方轮廓原始字节（3448 字符 + 换行） |
| `b1-fishlogo-light.png` / `b1-fishlogo-dark.png` | 浅色/深色页面截图（1280×713） |

复现命令：

```bash
cd "/Users/<user>/…/v1.5-m0"
node scripts/verification/v1.5/brand/b1-fishlogo.mjs          # exit 0，23/23
node scripts/verification/v1.5/brand/b1-fishlogo.mjs --self-test-fail   # exit 1（自测）
npm install --no-save --prefix /tmp/dsh-v15/ziplib --cache /tmp/dsh-v15/npm-cache yauzl@3.4.0
node scripts/verification/v1.5/brand/zip-reader-eval.mjs      # exit 0，12/12
```

前置：Node ≥20（本机 v24.14.0）、`/Applications/DeepSeek Harness.app`（只读）、Google Chrome（headless）、
`/tmp/dsh-v15/` 可写；探针不访问用户日常 profile，不修改 App、不改 `packages/**`、不 commit。
