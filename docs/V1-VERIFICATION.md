# DSH Game Market · V1 验证记录（骨架）

> **状态：骨架，尚未执行任何 V1 验证，未填写任何结果。**
> 本文件只定义验证环境、自动化证据位、真机证据表结构与截图槽位；所有"实际/结果/证据"字段均为待填占位。
> 填表纪律见 §5：**不预填通过、不复制 V0 证据冒充 V1、不伪造截图/日志**。没有执行就写"未执行"，没有真机就写"未验证"并给出复现步骤。
>
> 配套文档：[`V1-CONTRACTS.md`](./V1-CONTRACTS.md)（契约）、[`V1-GAME-ACCEPTANCE.md`](./V1-GAME-ACCEPTANCE.md)（游戏验收）。
> 未来截图/日志目录：`docs/verification/v1/`（本文件只引用，不创建、不预置文件）。

## 1. 验证环境

### 1.1 执行前必须填写的环境表

> 基线来自 `PROJECT_MEMORY.md` §4.1（V0 验证环境，V1 复用）；实际执行时以本节实测值留档。"待填"字段在执行验证时由执行者填写，不允许默认值直接当作已确认。

| 项 | 基线 / 要求 | 本次实测值（待填） |
|---|---|---|
| DSH 版本 | Desktop `0.2.1-rc.2`（与 V0 基线一致） | 待填 |
| 宿主启动方式 | 从同一 `app.asar` 解出运行时代码，用**隔离 `DSH_HOME`** 启动 `dsh web`；不触碰用户日常 `~/.dsh/profiles/desktop` | 待填 |
| `DSH_HOME` | 建议 `/tmp/dsh-verify-v1-home`（隔离；可重建） | 待填 |
| 宿主命令 | `dsh web --no-open --port 57999 --host 127.0.0.1`（示例；实际端口待填） | 待填 |
| 插件加载 | 开发态 profile patch 指向本次待验分支的绝对路径 `index.js`（`devMode: true`） | 分支/commit：待填 |
| 浏览器 | headless Chrome（CDP 9333，视口按用例） | 版本/视口：待填 |
| Node | ≥20（V0 基线 v24.14.0） | 待填 |
| 系统 | macOS（Windows 仅冒烟） | 待填 |
| 测试 Registry（本地） | 仓库内 `registry/games.json` 或临时夹具目录 | 路径：待填 |
| 测试 Registry（HTTPS） | 静态托管（如 GitHub Raw / Pages），含 `jump`/`2048`/`breakout` 包 | URL：待填 |
| Agent 状态模拟 | `POST /api/game-market/dev/agent-state`（仅 devMode） | — |
| 执行人 / 日期 | — | 待填 |
| 截图/日志目录 | `docs/verification/v1/`（建议按用例编号命名） | 待填 |

### 1.2 环境安全规则

1. 不得在未确认时对用户日常 profile 执行 `npm run dev:enable`；必须使用隔离 `DSH_HOME` 与 `--profile-dir`（参考 V0 脚本参数）。
2. 不联网安装第三方依赖；Registry HTTPS 用例只访问测试用静态资源。
3. 所有临时文件、隔离 home、测试 Registry 在验证后清理；不提交生成缓存。
4. 证据文件必须来自本次执行；V0 截图不能作为 V1 证据。

## 2. 自动化证据（占位）

> 行号 `AE-*` 为骨架编号。执行后把命令、stdout/stderr、产物 sha256 与日志路径填入"实际"列；日志建议存 `docs/verification/v1/logs/AE-xx.log`。
> 当前所有"实际/状态"均为 **待执行**。

| 编号 | 命令 / 操作 | 覆盖范围 | 预期 | 实际（待填） | 证据路径（待填） | 状态 |
|---|---|---|---|---|---|---|
| AE-01 | `npm run verify` | build + check + `node --test` 全量 | 全部通过；失败数 0 | 待填 | 待填 | 待执行 |
| AE-02 | `npm run build` 连续执行 2 次并比较产物 sha256 | 构建确定性 | 两次产物字节一致 | 待填 | 待填 | 待执行 |
| AE-03 | `node scripts/check.mjs` | 语法/产物/manifest/单文件约束检查 | CHECK OK | 待填 | 待填 | 待执行 |
| AE-04 | `node --test` | 单测 + 集成测试全量 | 全通过；记录 tests/pass/fail 数 | 待填 | 待填 | 待执行 |
| AE-05 | `node --test "tests/v1-*.test.js"` | V1 契约测试（manifest/包/Registry/安装/API/SDK，见契约 §4.5） | 全通过 | 待填 | 待填 | 待执行 |
| AE-06 | `node --test "games/snake/test/*.test.js"` | snake V0 逻辑测试保留且通过 | 全通过（断言未被放宽） | 待填 | 待填 | 待执行 |
| AE-07 | `node --test "games/jump/test/*.test.js"`（及 2048/breakout 同） | 四款游戏纯逻辑测试 | 全通过 | 待填 | 待填 | 待执行 |
| AE-08 | CLI：临时空目录 `init → build → validate` | 开发者 CLI 产物与校验 | 生成单文件包；违规包被拒并给出 `E_*` | 待填 | 待填 | 待执行 |
| AE-09 | CLI：`publish` 更新本地测试 Registry | 发布协议（sha256/size/字段） | Registry 条目正确；Market 可安装 | 待填 | 待填 | 待执行 |
| AE-10 | Host 集成：本地 file Registry 安装 `jump`/`2048`/`breakout` | 安装/更新/卸载全链路 | 全部成功；存档保留；重装 Continue | 待填 | 待填 | 待执行 |
| AE-11 | Host 集成：HTTPS 静态 Registry 安装 | 远程 Registry + URL 准入 + 重定向限制 | 安装成功；非法 host/重定向被拒 | 待填 | 待填 | 待执行 |
| AE-12 | 安全用例：sha256 不匹配、非 HTML、超 20 MiB、非法 manifest、自包含违规、路径穿越 | 安装拒绝且无半安装残留 | 对应 `GM-5014/4150/4131/4221/4225/5033` | 待填 | 待填 | 待执行 |
| AE-13 | 安全用例：并发安装、同 operationId 重放、运行中更新/卸载 | 锁/幂等/冲突 | 409 `GM-4091`；幂等结果一致；运行中拒绝 | 待填 | 待填 | 待执行 |
| AE-14 | `/entry` 响应头断言（CSP/no-store/nosniff/referrer/sha256） | 资源安全头 | 与契约 §7.4 完全一致；`frame-ancestors` 为配置 allowlist | 待填 | 待填 | 待执行 |
| AE-15 | 存档：1 MiB/256 KiB/key 上限、revision CAS、损坏恢复 | 平台存档契约 | 越界拒绝；`.bak` 恢复；损坏隔离 | 待填 | 待填 | 待执行 |
| AE-16 | SDK/Runtime：ready 超时、写串行、能力拒绝、协议校验 | SDK v1 契约 | 错误码与超时符合契约 §8 | 待填 | 待填 | 待执行 |
| AE-17 | 自包含扫描器：对四款游戏构建产物扫描 | 无外部资源/网络 API | 0 命中 | 待填 | 待填 | 待执行 |
| AE-18 | 包/存档/日志脱敏检查（SEC-08 自动化辅助） | 无 Prompt/绝对路径/存档值 | 0 命中 | 待填 | 待填 | 待执行 |

### 2.1 自动化结果汇总（待填）

```text
V1 自动化汇总（执行后填写，不得预填）
- 命令：
- tests / pass / fail：
- 构建产物 sha256（client.js / 各游戏包）：
- 失败用例与原因：
- 结论：待填（通过 / 失败 / 阻塞）
```

## 3. 真机证据表（占位）

> 表格编号沿用 V1 验收条目范围：`U-01..U-15`（用户旅程）、`DEV-01..DEV-07`（开发者体验）、`FM-01..FM-14`（失败模式）、`SEC-01..SEC-10`（安全）。
> **条目场景标题为验证骨架占位**，最终由 Lead 按 V1 验收条目/PRD 校对；本文件不声称任何条目已执行、已通过。
> 结果列只能填：`通过` / `失败` / `阻塞` / `未执行`；填"通过"必须同时填证据（截图文件名或日志路径）。
> 环境：§1.1 的隔离 DSH 0.2.1-rc.2 + headless Chrome；Agent 状态无真实 Agent 时用 dev 路由模拟，并在备注注明"模拟"。

### 3.1 用户旅程 `U-01..U-15`

| 编号 | 场景（骨架） | 前置/步骤摘要 | 实际结果（待填） | 证据（截图/日志槽位） | 备注 |
|---|---|---|---|---|---|
| U-01 | 全新 profile 首次打开 Market | 清空隔离 `DSH_HOME` 的插件存储；打开 Market | 待填 | 待填 | — |
| U-02 | 浏览 / 搜索 / 分类 | 输入关键词、切分类、验证空态与位置保持 | 待填 | 待填 | — |
| U-03 | 详情页 + 安装 | 打开详情 → Install → 进度/失败重试 → Play/My Games | 待填 | 待填 | — |
| U-04 | Agent 工作中进入游戏 | 发起 ≥30s Agent 任务（或 dev 模拟 running），从入口进入游戏 | 待填 | 待填 | — |
| U-05 | 游戏中 Agent 完成 | Agent 完成，确认鲸鱼提醒不打断游戏 | 待填 | 待填 | 区分真实/模拟 |
| U-06 | 审批等待 → 返回游戏 | 触发审批（或 dev 模拟 waiting-user）→ 暂停存档 → 原生审批 → 回游戏 | 待填 | 待填 | 真实审批优先 |
| U-07 | 自动保存 | 30s 定时/暂停/切后台；观察保存指示与存档 revision | 待填 | 待填 | — |
| U-08 | 离开 / 关闭 DSH / 重开 | 离开面板、重启宿主，确认 Continue 与进度/最高分 | 待填 | 待填 | — |
| U-09 | 完成一局 | Game Over → 分数/PB/历史/破纪录反馈 | 待填 | 待填 | — |
| U-10 | 更新版本 | 测试 Registry 发布新版本 → Market 显示 Update → 安装 → 存档兼容 | 待填 | 待填 | 含不兼容版本不自动升级 |
| U-11 | 卸载 | 二次确认 → 包清理 → 默认保留存档 → 重装 Continue；`deleteData` 路径 | 待填 | 待填 | — |
| U-12 | 离线 | 断网打开 Market：缓存列表/离线横幅/安装禁用/已安装可玩 | 待填 | 待填 | — |
| U-13 | 主题 / 窄窗 / 字号 | 明暗切换、窄窗、放大字号，检查溢出/遮挡/对比度 | 待填 | 待填 | — |
| U-14 | 纯键盘全流程 | Market → 详情 → 安装 → 游戏 → 暂停 → 返回 | 待填 | 待填 | 焦点可见 |
| U-15 | 减少动效 | 系统开启 reduced motion，检查动效降级与信息不丢 | 待填 | 待填 | — |

### 3.2 开发者体验 `DEV-01..DEV-07`

| 编号 | 场景（骨架） | 前置/步骤摘要 | 实际结果（待填） | 证据（截图/日志槽位） | 备注 |
|---|---|---|---|---|---|
| DEV-01 | 空目录 `init` | 在空目录生成可运行项目（含 SDK/manifest/生命周期/自动保存示例/README） | 待填 | 待填 | 记录总耗时 |
| DEV-02 | 本地开发预览/模拟器 | 切换 running/waiting-user/completed/paused/resume/clear-save；Bridge 可观察 | 待填 | 待填 | — |
| DEV-03 | 修改逻辑后预览 | 改动生效；控制台无 SDK 报错 | 待填 | 待填 | — |
| DEV-04 | `build` / `validate` / `pack` | 产物单文件自包含；错误可读且退出码非 0 | 待填 | 待填 | 命令名以 M1b 交付为准 |
| DEV-05 | 包进入测试 Registry 并在 Market 安装 | 安装后可玩；Save/Score/Continue；SDK 握手版本正确 | 待填 | 待填 | — |
| DEV-06 | 故意违规包 | 缺 manifest/路径穿越/超 20 MiB/错误 capability 被拒且无残留 | 待填 | 待填 | 记录错误码 |
| DEV-07 | 外部开发者从零到发布 | 记录耗时与卡点；目标 ≤30 分钟（P1） | 待填 | 待填 | 不计入红线 |

### 3.3 失败模式 `FM-01..FM-14`

| 编号 | 场景（骨架） | 前置/步骤摘要 | 实际结果（待填） | 证据（截图/日志槽位） | 备注 |
|---|---|---|---|---|---|
| FM-01 | Registry 不可达/超时 | 断网或指向不可达 URL；检查缓存/离线横幅/已安装可玩 | 待填 | 待填 | — |
| FM-02 | 下载中断/超时 | 安装中中断连接；检查失败提示、重试、临时文件清理 | 待填 | 待填 | 10s/20s/120s |
| FM-03 | SHA-256 不匹配 | 篡改包或错误 sha；检查拒绝与旧版本保留 | 待填 | 待填 | GM-5014 |
| FM-04 | Manifest 非法 | 缺字段/未知字段/条件字段缺失；检查字段级错误 | 待填 | 待填 | GM-4221 |
| FM-05 | 恶意包/超大文件/路径穿越 | 构造违规包；检查拒绝、无目标目录外写入 | 待填 | 待填 | 无 zip（V1） |
| FM-06 | Runtime/SDK 版本不兼容 | manifest 范围不满足；安装拒绝或 Play 禁用并说明 | 待填 | 待填 | GM-4260/4261 |
| FM-07 | 存档写入失败 | 只读/磁盘满；检查可见提示、重试、旧档保留 | 待填 | 待填 | — |
| FM-08 | 存档损坏/半写 | 破坏 current.json；检查 `.bak` 恢复与重置/隔离 | 待填 | 待填 | — |
| FM-09 | iframe 崩溃/加载超时 | 构造挂起/崩溃页面；检查错误覆盖层、重载恢复 | 待填 | 待填 | GM-5011/5012/5013 |
| FM-10 | 更新失败回滚（占位） | 更新安装中途失败；旧版本仍可玩、记录未破坏 | 待填 | 待填 | 标题待 Lead 校对 |
| FM-11 | 并发安装/幂等（占位） | 并发两次安装；第二次 409 `GM-4091`；同 operationId 重放 | 待填 | 待填 | 标题待 Lead 校对 |
| FM-12 | 存档 schema 过新/降级（占位） | 新版本 save.schemaVersion 升高/降级；提示与 GM-4099 | 待填 | 待填 | 标题待 Lead 校对 |
| FM-13 | Registry 索引损坏/超限/截断（占位） | 非法索引、>500 条、>2 MiB；检查拒绝/截断提示 | 待填 | 待填 | 标题待 Lead 校对 |
| FM-14 | 存储只读/安装失败（占位） | 存储根只读/写入失败；检查 GM-5025/5033 与恢复 | 待填 | 待填 | 标题待 Lead 校对 |

> 说明：`FM-10..FM-14` 仅按 V1 失败面给出占位场景，实施前由 Lead 按验收条目校正标题与步骤；不得据此预填"通过"。

### 3.4 安全 `SEC-01..SEC-10`

| 编号 | 场景（骨架） | 前置/步骤摘要 | 实际结果（待填） | 证据（截图/日志槽位） | 备注 |
|---|---|---|---|---|---|
| SEC-01 | 游戏访问 parent/top/宿主 DOM | 恶意包读取 `window.parent`/`top.document` | 待填 | 待填 | 跨源边界 |
| SEC-02 | 游戏发起网络请求 | fetch/XHR/WebSocket/EventSource/sendBeacon | 待填 | 待填 | CSP+扫描 |
| SEC-03 | 游戏访问宿主 storage/cookie/IndexedDB | 尝试读取宿主存储 | 待填 | 待填 | 隔离源 |
| SEC-04 | 伪造 postMessage | 错误 source/nonce/格式/方法 | 待填 | 待填 | Runtime 丢弃 |
| SEC-05 | 恶意包（路径穿越/超大/怪异文件） | 构造包；检查安装拒绝与目录边界 | 待填 | 待填 | V1 无 zip |
| SEC-06 | 篡改包复用旧 hash | 改内容沿用旧 sha；检查完整性拒绝 | 待填 | 待填 | GM-5014 |
| SEC-07 | 游戏伪造平台 UI | 包内绘制审批/鲸鱼/错误覆盖层 | 待填 | 待填 | 平台 UI 不可伪造 |
| SEC-08 | 日志/诊断脱敏 | 检查 `logs/market.log`/错误 details | 待填 | 待填 | 无 Prompt/路径/存档值 |
| SEC-09 | 卸载/更新路径注入 | 构造 gameId/路径穿越请求 | 待填 | 待填 | 仅管理目录内 |
| SEC-10 | URL 准入/重定向降级/预览图来源（占位） | 非法 host、http 降级、私网、外部预览图 | 待填 | 待填 | 标题待 Lead 校对 |

### 3.5 真机结论（待填）

```text
V1 真机结论（全部条目执行后填写）
- 环境：
- 通过 / 失败 / 阻塞 / 未执行 数量：
- 失败条目与 GM 码：
- 未覆盖条目及原因：
- 总体结论：待填（通过 / 不通过 / 阻塞）
```

## 4. 截图 / 日志槽位

> 目录：`docs/verification/v1/`（未来创建；本文件只登记槽位）。截图必须来自本次执行环境，建议统一 1440×900 或窄窗 720×900 视口，并在文件名中包含用例编号。

| 槽位 | 建议文件名（`docs/verification/v1/…`） | 内容 | 关联条目 | 状态（待采集） |
|---|---|---|---|---|
| SC-01 | `market-first-run.png` | 全新 profile 首次打开 Market（空态/Quick Play） | U-01 | 待采集 |
| SC-02 | `market-discover.png` | 浏览/搜索/分类 | U-02 | 待采集 |
| SC-03 | `market-detail.png` | 游戏详情页（作者/版本/大小/预览） | U-03、U-10 | 待采集 |
| SC-04 | `install-progress.png` | 安装进度/阶段 | U-03 | 待采集 |
| SC-05 | `install-failed-retry.png` | 安装失败与重试 | U-03、FM-02/03/04 | 待采集 |
| SC-06 | `my-games.png` | 我的游戏（Continue/更新/卸载入口） | U-08、U-10、U-11 | 待采集 |
| SC-07 | `update-available.png` | 可更新状态 | U-10 | 待采集 |
| SC-08 | `uninstall-confirm.png` | 卸载二次确认 + 删除数据确认 | U-11 | 待采集 |
| SC-09 | `offline-banner.png` | 离线横幅/缓存列表/安装禁用 | U-12 | 待采集 |
| SC-10 | `runtime-snake.png` | snake 游玩画面 | A-03、U-09 | 待采集 |
| SC-11 | `runtime-jump.png` | jump 游玩画面 | A-03、U-09 | 待采集 |
| SC-12 | `runtime-2048.png` | 2048 游玩画面 | A-03、U-09 | 待采集 |
| SC-13 | `runtime-breakout.png` | breakout 游玩画面 | A-03、U-09 | 待采集 |
| SC-14 | `continue-restore.png` | Continue 恢复 + 平台暂停遮罩 | U-08、A-08 | 待采集 |
| SC-15 | `pause-overlay.png` | 游戏内暂停态 | U-07、A-05 | 待采集 |
| SC-16 | `agent-waiting-in-game.png` | 游戏内鲸鱼 waiting-user | U-06 | 待采集（真实/模拟注明） |
| SC-17 | `agent-completed-reminder.png` | 游戏内完成提醒（不打断） | U-05 | 待采集 |
| SC-18 | `dark-theme.png` / `light-theme.png` | 明暗主题 | U-13、A-14 | 待采集 |
| SC-19 | `narrow-window.png` | 窄窗布局 | U-13、A-13 | 待采集 |
| SC-20 | `reduced-motion.png` | 减少动效设置下 | U-15、A-16 | 待采集 |
| SC-21 | `keyboard-focus.png` | 纯键盘焦点可见 | U-14、A-15 | 待采集 |
| SC-22 | `error-overlay.png` | 加载/运行错误覆盖层（含 GM 码） | FM-09、A-17 | 待采集 |
| SC-23 | `security-csp-block.png` | CSP 阻止外联/宿主访问 | SEC-01/02/03 | 待采集 |
| SC-24 | `security-invalid-package.png` | 违规包拒绝（manifest/自包含/sha） | SEC-05/06、FM-03/04 | 待采集 |
| SC-25 | `dev-cli.png` | CLI init/build/validate/publish 输出 | DEV-01..DEV-07 | 待采集 |

日志建议：

| 槽位 | 建议文件名 | 内容 |
|---|---|---|
| LG-01 | `logs/AE-*.log` | 自动化命令输出（按 AE 编号） |
| LG-02 | `logs/market-host.log` | 隔离宿主 + Host 运行日志（脱敏后） |
| LG-03 | `logs/runtime-console.log` | 浏览器控制台（错误/警告） |
| LG-04 | `logs/registry-fixture.json` | 本次使用的测试 Registry 快照 |

## 5. 未覆盖项与已知限制（骨架）

> 执行验证后按实际情况增删；以下为 V1 计划的"预期不覆盖/滚动项"，不是结论。

### 5.1 计划不覆盖

| 项 | 原因 / 处置 |
|---|---|
| Windows 完整视觉验收 | V1 仅冒烟；完整验收为后续项 |
| 桌面 Electron 窗口 chrome/拖拽带 | 使用同版本 Web 宿主 + headless Chrome；不动窗口层 |
| 服务端 Registry / 账号 / 云存档 / 全球榜 | V1 明确不做 |
| 多文件包（zip/图片/音效文件） | V1.5 再做 |
| 多 profile 并发强一致（跨进程 CAS） | V1 沿用文件锁 + last-write-wins，列为滚动项 |
| 真实 question（提问）等待事件 | V0 遗留；V1 滚动项，不阻塞 |
| 保存失败三次退避 backoff | V0 遗留；V1 保持失败提示 + 重试，列为滚动项 |

### 5.2 已知限制与待确认

| # | 项 | 状态 |
|---|---|---|
| 1 | 本文件为骨架，尚无任何执行结果 | 待执行 |
| 2 | `FM-10..FM-14`、`SEC-10` 场景标题为占位，需 Lead 校对 | 待确认 |
| 3 | 测试用 HTTPS Registry 的托管位置与 URL | 待确认 |
| 4 | CSP `frame-ancestors` 默认 allowlist 是否覆盖实际 DSH 宿主 origin | 待真机确认（见契约 TBD-05） |
| 5 | headless Chrome 版本与视口 | 待填 |
| 6 | 截图目录 `docs/verification/v1/` 尚未创建 | 待执行时创建 |

### 5.3 填表纪律（强制）

1. 只有实际执行并通过的条目才能写"通过"；"通过"必须附证据路径。
2. 不允许把 V0 的截图/日志/测试计数复制到 V1 记录中。
3. 不允许用 dev 模拟结果冒充真实 Agent 结果；模拟必须标注"模拟"。
4. 失败条目必须记录：复现步骤、预期/实际、GM 码、`requestId`、控制台错误、存档 revision。
5. 未执行就写"未执行"；无法执行写"阻塞"并说明原因与所需条件。

## 6. 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-10-18 | 初稿：V1 验证骨架（环境/自动化占位/真机表/截图槽位/未覆盖项），不填任何结果 | contract-docs |
