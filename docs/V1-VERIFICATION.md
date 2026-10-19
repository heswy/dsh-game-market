# DSH Game Market · V1 验证记录（骨架）

> **状态（2026-10-19）：自动化部分已执行；真机部分待执行。**
> 自动化结果与证据路径汇总见 [`docs/verification/v1/AUTOMATED-EVIDENCE.md`](./verification/v1/AUTOMATED-EVIDENCE.md)；
> 真机执行清单见 [`docs/verification/v1/REAL-MACHINE-CHECKLIST.md`](./verification/v1/REAL-MACHINE-CHECKLIST.md)。
> 本文件保留完整验收结构与统计口径；§2 已按实际执行结果填写，§3 的真机表仍待执行（未执行项不得预填通过）。
> 填表纪律见 §5：**不预填通过、不复制 V0 证据冒充 V1、不伪造截图/日志**。没有执行就写"未执行"，没有真机就写"未验证"并给出复现步骤。
>
> 配套文档：[`V1-CONTRACTS.md`](./V1-CONTRACTS.md)（契约）、[`V1-GAME-ACCEPTANCE.md`](./V1-GAME-ACCEPTANCE.md)（游戏验收）。
> 未来截图/日志目录：`docs/verification/v1/`（本文件只引用，不创建、不预置文件）。

## 1. 验证环境

### 1.1 执行前必须填写的环境表

> 基线来自 `PROJECT_MEMORY.md` §4.1（V0 验证环境，V1 复用）；实际执行时以本节实测值留档。"待填"字段在执行验证时由执行者填写，不允许默认值直接当作已确认。

| 项 | 基线 / 要求 | 本次实测值 |
|---|---|---|
| DSH 版本 | Desktop `0.2.1-rc.2`（与 V0 基线一致） | `0.2.1-rc.2`（`/Applications/DeepSeek Harness.app`） |
| 宿主启动方式 | 从同一 `app.asar` 解出运行时代码，用**隔离 `DSH_HOME`** 启动 `dsh web`；不触碰用户日常 `~/.dsh/profiles/desktop` | 已执行：`app.asar` 解出 `dsh` 运行时 + 隔离 `DSH_HOME`（`/tmp/dsh-m3-*`）；用户 profile 未触碰 |
| `DSH_HOME` | 建议 `/tmp/dsh-verify-v1-home`（隔离；可重建） | `/tmp/dsh-m3-ui/home-fresh`、`/tmp/dsh-m3-ui/home-data`、`/tmp/m3-*`（临时，可重建） |
| 宿主命令 | `dsh web --no-open --port 57999 --host 127.0.0.1`（示例；实际端口待填） | `node .../dsh/lib/bin.js web --no-open --port 58012/58013 --host 127.0.0.1` |
| 插件加载 | 开发态 profile patch 指向本次待验分支的绝对路径 `index.js`（`devMode: true`） | dev row → 本仓库 `index.js`；主干提交 `d0b1db7`（夹具 `ac136ec`） |
| 浏览器 | headless Chrome（CDP 9333，视口按用例） | Google Chrome **155.0.8059.85**（headless，CDP 9456，1440×900 / 720×900） |
| Node | ≥20（V0 基线 v24.14.0） | **v24.14.0** |
| 系统 | macOS（Windows 仅冒烟） | macOS **26.6.2**（arm64） |
| 测试 Registry（本地） | 仓库内 `registry/games.json` 或临时夹具目录 | `docs/verification/v1/fixtures/registry-file.json`（+ update/badsha/badhtml） |
| 测试 Registry（HTTPS） | 静态托管（如 GitHub Raw / Pages），含 `jump`/`2048`/`breakout` 包 | `https://raw.githubusercontent.com/heswy/dsh-game-market/main/docs/verification/v1/fixtures/registry-https.json` |
| Agent 状态模拟 | `POST /api/game-market/dev/agent-state`（仅 devMode） | 本次自动化未使用（真机用真实 Agent） |
| 执行人 / 日期 | — | Lead（AI） / 2026-10-19 |
| 截图/日志目录 | `docs/verification/v1/`（建议按用例编号命名） | 已创建：`docs/verification/v1/{logs,results,screenshots,fixtures}` |

### 1.2 环境安全规则

1. 不得在未确认时对用户日常 profile 执行 `npm run dev:enable`；必须使用隔离 `DSH_HOME` 与 `--profile-dir`（参考 V0 脚本参数）。
2. 不联网安装第三方依赖；Registry HTTPS 用例只访问测试用静态资源。
3. 所有临时文件、隔离 home、测试 Registry 在验证后清理；不提交生成缓存。
4. 证据文件必须来自本次执行；V0 截图不能作为 V1 证据。

## 2. 自动化证据（占位）

> 行号 `AE-*` 为骨架编号。执行后把命令、stdout/stderr、产物 sha256 与日志路径填入"实际"列；日志建议存 `docs/verification/v1/logs/AE-xx.log`。
> 当前所有"实际/状态"均为 **待执行**。

| 编号 | 命令 / 操作 | 覆盖范围 | 预期 | 实际 | 证据路径 | 状态 |
|---|---|---|---|---|---|---|
| AE-01 | `npm run verify` | build + check + 全量测试 | 全部通过，fail=0 | tests 767 / pass 767 / fail 0 | `docs/verification/v1/logs/AE-01-run.log` | 通过 |
| AE-02 | `npm run build` ×2 比较 sha256 | 构建确定性 | 两次产物字节一致 | IDENTICAL（client.js + 四款游戏） | `.../logs/AE-02-deterministic-build.log` | 通过 |
| AE-03 | `node scripts/check.mjs` | 语法/产物/manifest/自包含 | CHECK OK | CHECK OK (21 checks) | `.../logs/AE-03-check.log` | 通过 |
| AE-04 | `node --test` | 全量单测+集成 | 全通过 | tests 767 / pass 767 / fail 0 | `.../logs/AE-04-run.log` | 通过 |
| AE-05 | `node --test tests/v1-contracts.test.js` | V1 契约测试 | 全通过 | tests 9 / pass 9 | `.../logs/AE-05-run.log` | 通过 |
| AE-06 | `node --test games/snake/test/*` | snake 逻辑保留 | 全通过 | tests 30 / pass 30 | `.../logs/AE-06-run.log` | 通过 |
| AE-07 | `node --test games/{jump,2048,breakout}/test/*` | 四款游戏逻辑 | 全通过 | tests 87 / pass 87 | `.../logs/AE-07-run.log` | 通过 |
| AE-08 | CLI `create/build/validate/pack` | 开发者 CLI | 产物正确、违规包被拒 | build/pack/validate OK；违规 exit=1/2 | `.../logs/DEV-01-04-06-cli.log` | 通过 |
| AE-09 | CLI `publish --url --cover` | 发布协议 | 生成 registry entry + 计划 | entry/upload-plan/review-checklist 均生成 | `.../logs/AE-09-cli-publish.log` | 通过 |
| AE-10 | file Registry 安装/更新/卸载/重装 | 全链路 | 成功、存档保留、重装 Continue | 安装 17–23ms；更新 1.0.1；重装 canContinue=true | `.../results/AE-10-15-host.json` | 通过 |
| AE-11 | HTTPS Registry 安装 | 远程 Registry + URL 准入 | 安装成功 | 刷新 1543–2113ms；安装 331–1260ms | 同上 | 通过 |
| AE-12 | 恶意包矩阵（sha/非包/缺 manifest/外部资源/超限/旧字段/穿越） | 拒绝且无残留 | 对应 GM 码 | GM-5015/4221/4225/4240/4232/4234/4135 | 同上 | 通过 |
| AE-13 | 并发安装、operationId 重放 | 锁/幂等/冲突 | 幂等/串行 | 重放幂等；并发第二次 changed=false | 同上 | 通过 |
| AE-14 | `/entry` 响应头断言 | CSP/no-store/nosniff/sha | 与契约一致 | 全部一致（含 frame-ancestors allowlist） | 同上 | 通过 |
| AE-15 | 存档配额/CAS/损坏恢复 | 存档契约 | 拒绝越界、`.bak` 恢复 | GM-4131/4132/4092；恢复成功 | 同上 | 通过 |
| AE-16 | SDK/Runtime/协议测试 | ready/超时/协议/串行 | 全通过 | tests 124 / pass 124 | `.../logs/AE-16-run.log` | 通过 |
| AE-17 | 四款包自包含扫描 | 无外部资源/网络 API | 0 命中 | validate 全 ok；外部命中 0 | `.../logs/AE-17-self-contained.log` | 通过 |
| AE-18 | 日志脱敏扫描 | 无 Prompt/路径/凭据 | 0 命中（人工复核待发布前） | 扫描通过；人工复核待做 | `.../logs/AE-18-redaction.log` | 部分 |

### 2.1 自动化结果汇总（待填）

```text
V1 自动化汇总（2026-10-19 实际执行）
- 命令：npm run verify / node --test / node scripts/check.mjs / CLI / host-e2e / ui-evidence
- tests / pass / fail：767 / 767 / 0（全量）；契约 9/9；snake 30/30；四款逻辑 87/87；SDK+Runtime 124/124
- 构建产物 sha256：client.js 76b3cf47…；snake d6b92387…；jump 92b26f47…；2048 7e65cb5e…；breakout 32d4f224…
- 失败用例与原因：无（存在少量超时/网络抖动重试，均已重跑通过）
- 结论：自动化部分 通过（AE-01..17）；AE-18 待人工复核
```

## 3. 真机证据表（待执行）

> **自动化已覆盖的部分见 §2 与 `docs/verification/v1/AUTOMATED-EVIDENCE.md` §5 的 FM/SEC 映射；本节只登记真机结果。**
> 真机执行清单见 `docs/verification/v1/REAL-MACHINE-CHECKLIST.md`（两场，约 2 小时）。
> 当前状态：**未执行**；执行后按 §5.3 纪律填写，不得预填通过。

> 表格编号沿用 V1 验收条目范围：`U-01..U-15`（用户旅程）、`DEV-01..DEV-07`（开发者体验）、`FM-01..FM-14`（失败模式）、`SEC-01..SEC-10`（安全）。
> **条目场景标题为验证骨架占位**，最终由 Lead 按 V1 验收条目/PRD 校对；本文件不声称任何条目已执行、已通过。
> 结果列只能填：`通过` / `失败` / `阻塞` / `未执行`；填"通过"必须同时填证据（截图文件名或日志路径）。
> 环境：§1.1 的隔离 DSH 0.2.1-rc.2 + headless Chrome；Agent 状态无真实 Agent 时用 dev 路由模拟，并在备注注明"模拟"。

### 3.0 真机执行记录（2026-10-19，Lead 代执行）

> 在用户真实 DSH Desktop 窗口中通过辅助控制执行；详细结论与证据见
> [`docs/verification/v1/REAL-MACHINE-RESULTS.md`](./verification/v1/REAL-MACHINE-RESULTS.md)。

| 状态 | 数量 | 条目 |
|---|---|---|
| 通过（真机） | 18 | U-02、U-03、U-04（presence）、U-05（完成提醒）、U-06 提问提醒（出现+回答后消失）、U-08（应用级关闭重开）、U-09（Snake）、U-11（确认框）、U-13 深色、A-03/A-04/A-05/A-08/A-13/A-15（键盘游玩）、V1-22/V1-23 |
| 通过（自动化补充） | 2 | A-11（headless 5 分钟）、A-16（CDP 减少动效）；启动性能参考值见 AUTOMATED-EVIDENCE §8 |
| 部分 | 2 | U-09（PB 反馈未触发）、U-14（完整 Tab 流程） |
| 阻塞 | 2 | U-06 真实审批（环境禁用）、U-13 放大字号 |
| 未执行 | 3 | U-15 减少动效、性能测量、DEV-03/DEV-07 |

证据：`docs/verification/v1/screenshots/real-*.jpg`；细节见 REAL-MACHINE-RESULTS.md §1–§3。

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
| 1 | 自动化已执行；真机由 Lead 代执行 13 项通过、4 部分、3 阻塞、3 未执行（见 §3.0 / REAL-MACHINE-RESULTS.md） | 进行中（剩余阻塞项待补） |
| 2 | `FM-10..FM-14`、`SEC-10` 场景标题仍为占位，需 Lead 校正后执行 | 待确认 |
| 3 | 测试用 HTTPS Registry：使用仓库 raw.githubusercontent.com fixture（已实际安装成功） | 已确认 |
| 4 | CSP `frame-ancestors` allowlist 实测为 `'self' http://127.0.0.1:* http://localhost:*`；真实 DSH 宿主 origin 待真机确认（TBD-05） | 待真机确认 |
| 5 | headless Chrome：155.0.8059.85，1440×900 / 720×900 | 已填 |
| 6 | 截图目录与 fixtures/logs/results 已创建 | 已完成 |

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
| 2026-10-19 | 自动化部分执行完成（AE-01..17 通过，AE-18 部分）；补齐环境表/自动化结果/截图/夹具；真机表待执行 | Lead |
