# V1.5 支持矩阵（M0 冻结草案）

> 状态：**M0 冻结草案（已按 M0 探针校准；2026-10-20 追加 M3 更新能力行，V1/V2 证据落地前状态为 not-run）**。
> 每条给出实测依据或明确标注「未验证」。
> 对应指南 §3「正式支持的 DSH 矩阵」与 §5.1/§5.3 的更新能力边界；契约细节见 `docs/V1.5-CONTRACTS.md`。
>
> 记录日期：2026-10-19。基线 `v1.2.0@f422e8d`，开发分支 `feat/v1.5-m0`。
> **M3 追加（2026-10-20）**：§9 = M3 平台插件持续更新能力矩阵；§10 = M0 未验证项在 M3 的去向
> （resolved / pending / residual）；§11 = M3 残留未验证项。M0～M2 行保持原实测依据不变；
> M3 行只有拿到 committed 原始证据后才允许把状态改为「通过」。

## 1. 实测环境身份

| 项 | 值 | 依据 |
|---|---|---|
| 宿主 App | `/Applications/DeepSeek Harness.app`，`@deepseek-ai/dsh-desktop` **0.2.1-rc.2** | ASAR 内 `package.json` |
| 宿主运行包 | `@deepseek-ai/dsh-desktop-runtime` **0.2.1-rc.2** | ASAR 内 `dsh/package.json` |
| `pluginManager` | `@deepseek-ai/dsh-plugin-manager` **0.2.1-rc.2** | ASAR 内包 `package.json` |
| 隔离复现方式 | 只读解包 `app.asar` → `/tmp/dsh-v15/asar`；`DSH_HOME=/tmp/dsh-v15/home-*`；`node <dsh bin.js> web --no-open --port <p> --host 127.0.0.1` | `scripts/verification/v1.5/lib/harness.mjs` |
| 未触碰 | `~/.dsh/profiles/desktop`、App 内任何文件、生产索引、tag | 各探针脚本约束 |

## 2. 能力面（运行期判定，不是安装形态）

| 能力 | 判定来源 | 真实 DSH Desktop | 隔离 `dsh web` CLI | 显式禁用 `hmr` 的 profile |
|---|---|---|---|---|
| `hmr` 服务 | Loader 树稳定后对 `ctx.get('hmr')` 超时轮询采样 | **有**（见 §3） | **有**（实测 t=0 无 → t≈0.5–2s 有） | 无（构造用于对照） |
| `installBundle` 覆盖安装（git URL + 精确 commit） | 实测 Remote Result | **可行**：`application:"applied"`、`changed:true`、新版本**无需重启**生效（`/health` 报新版本） | 同左 | `application:"restart-required"` + `restartReason:"no-hmr"`（需重启） |
| 连续第二次更新 | 实测 A→B→C | **可行且可重复**（两次都 `applied`） | 同左 | 同左 |
| 同目标重复点击（记录串相同） | `specPackageName` L1373 + 实测 | `application:"failed"` / `error.code:"already-installed"`、`changed:false`、不跑 pnpm | 同左 | 未单独测 |
| 同目标重复点击（URL 形态） | 实测 | `application:"failed"` / `error.code:"ambiguous-install"`、`changed:false`、pnpm exit 0、依赖串与 live 版本不变 | 同左 | 未单独测 |
| 更新后是否需重启 | `change()` L2373–2400 | HMR：`applied`（在线替换，bundle row dispose + 新 fiber）；非 HMR：`restart-required` | 同左 | 必须重启 |
| 官方 `FishLogo` 模块解析 | 隔离宿主 + headless Chrome 真实 `require` | **可解析**（种子表含 primitives，288 exports） | 同左 | 同左 |
| open/blocking 问答原地结算 | `uiSession.sessionStatus` → 活 `PendingQuestion` → `answer(batch)` | **可行（de facto）**：游戏面板选中、原生 composer 卸载时仍可结算，原生 Session 同 `callId` 记录 `tool/result` | 同左 | 同左 |
| 多文件资源（opaque origin） | 真实浏览器 iframe | **可行**：独立资源 origin + 匿名 CORS + 严格 CSP；但**不能复用 DSH `/api`** | 同左 | 同左 |

**判定纪律**：HMR 能力必须按「树稳定后采样」判定，**不得**用 UA、版本字符串，或插件 `apply()` 时的单次读取。
Lead 实测反例：`apply()` 时读得 `hmr=false`（`Service.init` 未完成，row `fiber.state=1`），t≈2s 后为 `true`（`state=2`）；probe-update 独立复现（t=0 false → t≈0.5s true）。
原始证据：`docs/verification/v1.5/raw/host-capability/hmr-census-*.json`、`raw/plugin-update/s-u2-hmr/boot1/boot.json`。

## 3. 为什么真实 Desktop 是 HMR 能力开启

1. `dsh-base/cordis.patch.yml` 无条件插入 `- id: hmr` 行，只在**没有 profileContext** 时 disabled（`!!js "!ctx.get('profileContext')"`）。真实 Desktop 有 profileContext。
2. 实测真实桌面进程命令行：Electron 主进程带 `--expose-internals` 运行 `dsh-desktop-host/lib/index.js`，并且**就是监听 GUI 端口的那个 PID**（即 profile 在 Electron 主进程内运行，不是子进程）。
3. 用户 `~/.dsh/profiles/desktop/cordis.patch.yml` 中**没有**对 `hmr` 行的禁用覆盖；bundles 含 `@deepseek-ai/dsh-base`。
4. 隔离复现：`node --expose-internals <bin.js> web` 与不带该 flag 的采样结果一致（稳定后均为 `true`），说明 `--expose-internals` 不是 HMR 服务存在的唯一条件。

> 该结论**推翻**了开发指南 §3/§5.3 中「非 HMR Desktop 是首版必须实证的一键更新路径」的前提。M3 的更新设计必须以本矩阵为准，具体更新语义见 `docs/V1.5-CONTRACTS.md`。

## 4. 安装来源与 spec 形态

| spec 形态 | HMR 下「包已是 dependency」时 | 说明 |
|---|---|---|
| 裸包名 / `name@version`（registry） | **被拒** `already-installed` | `specPackageName` 对 registry 形态直接返回包名 |
| 本地目录 / `file:`（path） | **被拒**（同 name 已是 dependency 时） | `specPackageName` 读该目录 manifest 的 `name` |
| **git HTTPS URL + 完整 40 位 commit** | **放行**（只要与 profile 已记录依赖串不逐字相等） | 正式发行推荐形态；`known=undefined` |
| 与 profile 已记录依赖串逐字相同的 spec | 被拒 `already-installed` | 作为「同目标重复点击不重复安装」的幂等保护 |
| 浮动 tag / `#main` / 分支名 | **不支持** | 不可变安装目标原则（指南 §5.1） |

**发行形态**：DSH plugin-market-index 格式 1，`source.type=git` + 本平台仓库 HTTPS URL + 完整 40 位发布 commit；包内已带构建产物，不运行 prepare/postinstall。

## 5. 平台/包格式支持面

| 维度 | V1.5 支持 | 备注 |
|---|---|---|
| 包格式 | `html-v1`（沿用）+ `asset-zip-v2`（新增） | 两代并存；同 id/version 字节不可变 |
| Registry | `/registry/games.json`（v1，只含 HTML）+ `/registry/v2/games.json`（联合） | 旧客户端读 v1 不失败 |
| DSH 版本 | `engines.dsh = >=0.2.0 <0.3.0`（沿用）；V1.5 实测基线 0.2.1-rc.2 | 见 §2 能力面 |
| Client 外部模块 | `react`、`react-dom/client`、`@deepseek-ai/dsh-client-ui-primitives`（新增，需 M1 扩 bundler allowlist） | 实测：现 bundler 拒绝 bare import |
| 危险工具审批 | 不在游戏内批准；走原生处理入口 | 指南 §6.4 |
| 游戏联网 | 不支持（V1 起） | D-014 |
| 资源服务 origin | **独立 loopback 资源 origin**（不复用 DSH `/api`） | S-A1 实测：`/api` 前缀围栏拒绝 opaque-origin 子资源（`Origin:null` → 403；no-cors `<img>` 因 `sec-fetch-site: cross-site` → 403） |
| `html-v1` CSP | 沿用现状（含 `'unsafe-inline'`） | 不回归 |
| `asset-zip-v2` CSP | 显式资源 origin，**不含 `'unsafe-inline'`**；v2 validator 拒绝内联 `<script>`/`<style>`/`on*=`/`javascript:` | Lead 裁决 3（从严；放宽是加法，收紧会破坏已发布作者包） |
| entry 凭证 | 首导航携带一次性 launch；reload/重试一律用资源凭证 URL | S-A1 实测：重放 launch URL = 410，去掉 launch = 200 |
| **导航边界** | **平台自服务的同源 wrapper** 用 `frame-src <resourceOrigin>` 阻断游戏自导航到包外 origin | CR-P1 实测：host 页无 CSP 时外泄；wrapper 方案在 Chromium 155 阻断，且**同一 wrapper 去掉该 CSP 即外泄**（C3/C3c 对照）→ 可归因给 wrapper 自身策略，不依赖 host 页面 |
| **包外网络** | 子资源由 `connect-src <resourceOrigin>` 阻断（CSP **按 origin 匹配**，不是按「绝对 vs 相对」）；**子文档自导航**由上面的 wrapper `frame-src` 阻断 | CR-P1：子文档自身 CSP 拦不住它自己的导航（负对照实测外泄） |
| ZIP 条目上限 | **总条目（含 `dsh-package.json`）≤512 → `files[]` ≤511** | Lead 裁决（统一口径，禁止「512+1」歧义） |
| 更新终态 | `updated` 仅在 **Host 与 Client 双端**版本匹配 target 且健康检查通过后进入；`applied` 是中间态，核验前不得报成功 | 契约 §9.5.1 状态机（复核修正轮统一） |

## 6. 明确不支持 / 明确边界

- HMR 能力**不可靠探测**时不展示可执行更新按钮（能力缺失 → 禁用 + 原生恢复入口）。
- 不支持调用系统 `unzip`/shell 执行作者内容。
- 不支持去除 iframe `sandbox="allow-scripts"` 或加 `allow-same-origin`。
- **不假设 host 页面带 `frame-src` 策略**：导航阻断必须由平台自服务的同源 wrapper 提供（CR-P1）；仅靠子文档 CSP 无法阻止自导航。
- 不支持 `link:`/`file:` dev 载入被静默替换为正式包（显示「开发模式，前往插件管理切换安装来源」）。
- 不支持把 continued RPC 当作 open 问题的提交接口。
- 不支持“先卸载自己再靠自身完成安装”的更新流程。

## 7. 未验证项（M0 结束时仍开放，不得写成已支持）

| 项 | 需要什么证据 |
|---|---|
| 真实 DeepSeek 模型发起的提问 | 隔离 profile 无模型凭据；S-Q1/S-Q2 用**本地脚本模型**驱动真实 `dsh-agent-loop` + 原生 `ask_user_question` 工具，真实模型路径未验证 |
| 真实 Game Market 面板内的问答 | S-Q1/S-Q2 用同形探针面板（同一 slot/key/`selectPanel` 机制），非仓库真实 UI；属 M4 真机项 |
| headed Desktop / 真实 Electron 窗口 | 全部探针在隔离 `dsh web` + headless Chrome 中执行 |
| `plan-review` / `approval/request` | 只覆盖 `ask_user_question` 普通问答；敏感审批路径未验证 |
| domain teardown delegation | 需运行时卸载原生 `dsh-client-ui-user-questions` 触发 teardown，未做 |
| 客户端半在 bundle 替换时的销毁时序、RPC 响应丢失 | 需浏览器侧更新探针；v1.2.0 无更新 UI |
| 多窗口/profile 更新锁、多窗口并发 renew/release | 未做 |
| 字体 `@font-face`、非 Chromium 引擎、WebSocket/beacon 等外发向量 | S-A1 未验证项，M1 补测 |
| 2000 文件路由注册开销（PRD S-11） | 未做（只验证了 10 文件包的加载正确性） |
| 直接启动用户 `desktop` profile 的探针 | 未直接启动（合规：不碰日常 profile） |
| 本地后备品牌资产的启用 | S-B1 已给来源与许可，但首选路径可用，后备未启用、未验证 |
| 导航阻断的跨引擎 / 真实 DSH 页面接入 | CR-P1 只在 Chromium 155 验证；wrapper 方案接入真实 DSH 页面后必须补一条自导航回归（正例：包内导航成功；反例：包外导航被阻断且不产生请求） |
| 更新状态机 `updated` 的双端核验实测 | 契约 §9.5.1 已冻结语义，但 Host/Client 版本双端核验与 `verification-failed`/`stale-runtime` 分支属 M3 实测项 |

## 8. M0 已裁决（Lead 仲裁，写进 V1.5-CONTRACTS）

| # | 决策 | 依据 |
|---|---|---|
| A1 | M1 资源服务用**独立 loopback 资源 origin**，不复用 DSH `/api`；并向 DSH 上游提出「`/api` 之外的公开 route seam」作为后续替代项 | S-A1 实测硬约束 |
| A2 | CSP **只在入口文档发送**，用**显式资源 origin**，不用 `'self'`；`frame-ancestors` 精确到 DSH web origin | S-A1 实测（`'self'` 是实现细节、跨引擎未验证） |
| A3 | `asset-zip-v2` 必须外链：CSP 不含 `'unsafe-inline'`，validator 拒绝内联脚本/样式/事件处理器/`javascript:` URL；`html-v1` 不回归 | 严格 CSP 可被自动断言；从严后放宽是加法 |
| A4 | 首次导航带一次性 launch；此后 reload/重试用资源凭证 URL；复用已消费 launch → 明确错误 | S-A1 实测 410/200 |
| A5 | 无 CSP 时 CORS 挡不住 no-cors 外发 → **CSP 是必需的外发边界**，契约必须含 `child-src/worker-src/frame-src 'none'`、`object-src 'none'`、`base-uri 'none'`、`form-action 'none'` | S-A1 S-A1-17 实测 |
| A6 | **子文档自导航**不由子文档自身 CSP 约束；导航阻断 MUST 由嵌入文档的 `frame-src` 提供，首选**平台自服务的同源 wrapper**（含 `frame-src/child-src <resourceOrigin>`），实现**不得假设 host 页面有该策略**；Runtime 仍须把非预期导航/心跳中断当失败处理（纵深防御，不能替代阻断） | CR-P1 实测（C1 泄漏 / C2、C3 阻断 / C4 负对照泄漏，均带 boot beacon 正向对照） |
| A7 | CSP **按 origin 匹配**：`connect-src <resourceOrigin>` 是运行时权威边界；validator 对绝对/协议相对 URL 的拒绝是**创作期可移植性规则，不是安全证明** | CR-P1 复核修正 |
| A8 | ZIP 条目口径以**总条目**为准（含 `dsh-package.json`）≤512 → `files[]` ≤511 | 复核意见 + Lead 裁决（消除「512+1」歧义） |
| A9 | 更新终态唯一：`inspecting → installing → applied → activating → updated`；`applied` 为中间态，核验前不得显示「已更新」；非成功分支含 `pending-restart`/`already-at-target`/`verification-failed`/`stale-runtime`/`cancelled`/`failed`（`too-late` 不是回滚） | 复核意见 + 契约 §9.5.1 |

## 9. M3 平台插件持续更新能力矩阵

> 证据级别同 M3：`automated` / `isolated-host`（隔离 `dsh web` + 真实插件服务）/ `isolated-browser`（CDP + 真实 DSH 页面）/
> `isolated transport fixture` / `real-Desktop` / `not-run`。状态列只按 `docs/verification/v1.5/raw/m3/` 的 committed 证据
> 与 `plugin-update-m3.md` 的结果填；V1/V2 未跑前一律 not-run。骨架/门禁见 `acceptance-matrix.md` §13–§21。

| 能力 | 判定来源 | 状态（2026-10-20） | 依据 / 缺口 |
|---|---|---|---|
| 官方固定索引发现：URL 常量、HTTPS、≤256 KiB、5s 总超时、重定向 ≤3 且不降级、单飞、启动静默 ≤6h、手动刷新 60s 节流、缓存/离线保留上次 target、同版本不同 commit 异常检测 | 真实 Host 路由 + 隔离传输夹具 | **已实测（isolated-host + isolated transport fixture）** | 发现矩阵 160/160 exit 0（`acceptance-matrix.md` §21）；契约 §17.2 条目 1/3 |
| 格式 1 严格校验 + 官方绑定：插件名 `dsh-game-market`、仓库 `github.com/heswy/dsh-game-market`、`source.type='git'`、完整 40-hex、精确 semver；拒绝 branch/tag/短 SHA/本地路径/`file:`/任意仓库/裸包名 | shared 校验器 + 夹具恶意索引矩阵 | **已实测（automated + fixture）** | 共享契约 13/13；V0 矩阵 `unbound-repo`/`file-source`/`short-sha`/`redirect-http`/`redirect-loop`/畸形 JSON/超限/超时；契约 §17.1 |
| stable 通道默认排除 prerelease；test 通道只能配置显式 opt-in（普通 UI 无一键切换） | shared 选择器 + 夹具 | **已实测（automated + fixture）** | V0 `prerelease-stable`/`test-channel-optin`；契约 §9.4/§17.2 条目 3 |
| HMR 原位更新（A→B→C，无需进程重启，`/health` 报新版本） | M0 Host-only 探针（真实 `pluginManager`，独立操作者） | **Host 层已实测（M0，隔离 profile）**；**M3 真实 Client UI 链路 not-run** | `docs/verification/v1.5/plugin-update.md` §1/§3 U2-3..U2-8；M3 V1-1 待跑 |
| 非 HMR：`restart-required` + `restartReason:"no-hmr"` → 重启后新版本；重启前磁盘新/运行旧 | M0 Host-only 探针（显式禁用 `hmr` row 的隔离 profile） | **Host 层已实测（M0）**；**M3 链路 not-run** | `plugin-update.md` §3 U1-1..U1-5；M3 V1-5 待跑 |
| 状态机 `inspecting→installing→applied(中间态)→activating→updated` 与非成功分支 | Host 目标测试（假 manager）+ client 状态映射测试 | **实现层通过（automated）**；真实双端核验 **not-run** | 契约 §9.5.1；`packages/host/test/cases/v1.5-platform-update-operations.js` + client 套件；V1 待跑 |
| 双端身份语义：Host 激活冻结 `loadedVersion`/`buildCommit`；Client 只上报自身 `{buildVersion, buildCommit}`；`updated` 需双方 + `/health` 同时匹配 | 契约 §9.5.1 + 目标测试 | **实现层通过（automated）**；真实 **not-run** | 契约 §17.2 条目 7/8/9；V1-1/V1-2 待跑 |
| 重复点击/多窗口幂等：同目标返回同一 `operationId`；不同 target 在途 → `GM-4091`（文案区别于游戏安装） | Host 目标测试 | **实现层通过（automated）**；真实双窗口 **not-run** | 契约 §17.2 条目 13；V2-1 待跑 |
| profile 范围更新锁（跨进程写锁/心跳/陈旧接管/忙码） | Host 目标测试（复用安装锁语义） | **实现层通过（automated）**；跨进程真实竞争 **未验证** | 契约 §17.3 未验证项 3 |
| 活跃实例保存协调：包变更前必须所有实例 pause+save 确认；失败/超时中止且无包变更；`idle` 窗口不带实例 | Host 目标测试（假实例表） | **实现层通过（automated）**；真实游戏实例故障注入 **not-run** | 契约 §17.2 条目 14；V2-2 待跑 |
| 能力 unknown fail-closed：`canBeginUpdate=false`、原因可读、市场/游戏不受影响、原生恢复入口 | Host 目标测试 + M0 时序实测 | **实现层通过**；真实构造 **not-run** | 契约 §9.2；V2-6 待跑 |
| dev row 遮蔽：识别 `stale-runtime(dev-row-shadows-package)`、禁用更新、给原生插件管理指引、不静默迁移 | M0 U2-10 行为实测 + Host 目标测试 | **行为已实测（M0，Host-only）**；真实 M3 阻断 **not-run** | `plugin-update.md` §1.7 / U2-10；V2-7 待跑 |
| RPC 丢失 / Client 刷新 / HMR dispose 恢复：持久记录、重读实际身份、无伪成功 | Host 目标测试（`reopen()` 模拟新激活/重启） | **实现层通过（automated）**；真实浏览器 **not-run** | 契约 §17.2 条目 15；V1-2/V1-3 待跑 |
| 旧 Client + 新 Host → `stale-runtime(client-old)`，刷新后 `updated` | Host 目标测试 | **实现层通过**；真实 **not-run** | 契约 §9.5.1 规则 6；V1-6 待跑 |
| 不伪报已升级：`applied` 中间态；`pending-restart`/`verification-failed`/`stale-runtime` 不得显示成功；无伪百分比 | client 状态映射测试 + Host 目标测试 | **实现层通过（automated）**；真实 UI **not-run** | M3-V1 待跑 |
| 隔离验证环境自证：运行时身份/解包一致性/真实 DSH 页面/端口与进程清理 | V0 harness | **已实测（isolated-browser）** | [M3-V0-harness](raw/m3/M3-V0-harness-2026-10-20T11-48-47-688Z.json) 33/32，exit 0 |
| 验证专用 probe releases 身份（`R_A`=1.2.1 / `R_B`=1.2.2 / `R_final2`=1.3.0）与精确 commit 安装性 | 只读 git 身份核对 + V1 真实安装 | **身份已记录；安装性 not-run** | `acceptance-matrix.md` §14；V1 待跑 |

## 10. M0 未验证项在 M3 的去向（resolved / pending / residual）

> M0 §7 原表暂不删行：与更新相关的 3 项只有 V1/V2 证据落地后才迁到这里并标注“已由 M3 关闭 → 证据链接”。
> 在此之前两边都不得写成通过。

| M0 未验证项（§7 原行） | M3 去向 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| 客户端半在 bundle 替换时的销毁时序、RPC 响应丢失 | M3 V1-2/V1-3（Client 刷新/丢 RPC/HMR dispose 存活） | **pending（not-run）** | V1 证据提交后改为 closed；当前只有 Host 目标测试（假 manager）作为实现层参考 |
| 多窗口/profile 更新锁、多窗口并发 renew/release | 更新锁 → M3 V2-1/V2-2 + Host 目标测试；**资源凭证 renew/release 竞争仍属 M1 遗留**（M3 不覆盖） | **部分覆盖（实现层）；真实并发 not-run** | 契约 §17.3 未验证项 3；V2 待跑 |
| 更新状态机 `updated` 的双端核验实测 | M3 V1-1/V1-2/V2-1 | **pending（not-run）** | V1 证据提交后改 closed |
| 真实 Desktop / headed Electron 窗口 | M3 仍不碰真实 Desktop（隔离 `dsh web` + headless Chrome） | **residual 未验证** | 见 §11 |
| 非 Chromium 引擎的导航阻断与资源加载 | M3 不覆盖（与更新链路无关） | **residual 未验证** | 见 §11 |
| 其余 M0 项（真实模型问答、真实面板问答、`@font-face`、ENOSPC 等） | 与 M3 更新链路无关 | **residual（保持 §7 原状）** | §7 原行保留 |

## 11. M3 残留未验证项（不得写成已支持）

| 项 | 为什么未验证 / 需要什么证据 |
|---|---|
| 真实 Desktop / Electron 主进程内的发现网络栈、原生窗口 UI、真实用户 profile | 本轮不碰 `~/.dsh`；证据全部来自隔离 `dsh web` + headless Chrome |
| 生产官方索引的真实内容与格式正确性 | 从未抓取/写入生产索引；夹具 body 是验证数据 |
| V1/V2 全部端到端场景（HMR A→B→R_final2、恢复、非 HMR 真实重启、混合态、多窗口、协调、取消、能力 unknown、dev-row、恶意索引、失败恢复） | `not-run`，见 `plugin-update-m3.md` §3/§4 与 `acceptance-matrix.md` §15–§19 |
| 跨进程 profile 更新锁竞争 | 实现复用已验证安装锁；真实两进程压测未做 |
| 真实 ENOSPC/权限/游戏运行中保存失败注入 | 自动化用假 manager/注入；隔离 profile 真实故障归 V2 |
| 非 Chromium 引擎 / headed 窗口 / 长时 soak | 未覆盖 |
| 夹具方法对 Electron 主进程的适用性 | `NODE_USE_ENV_PROXY` 为 Node 24 行为；Electron 主进程未验证 |
| 真实 stable promote / 撤回 / 旧通道用户升级 | 本轮只 dry-run + 身份核对，不写生产索引、不发布、不打 tag |
| `html-v1` wrapper 化 | M3 不涉及；仍为 **M4 前置独立提交**，不得宣称所有格式已阻断包外导航 |
