# M5 首版验收

> **2026-10-30 rc.3 真实桌面验收已通过。** 三个存档迁移问题（导入与 `deleteData` 卸载并发、`meta.json` 写失败返回与实际提交不一致、近配额存档导出/导入界限）由 `8c1eeae` 修复，新增回归测试 10/10；完整 `npm run verify` 1570/1574（4 skip、0 fail）、`CHECK OK (44)`。rc.1 的产物已被修复改变，不能继续作为安装候选；重建 rc.3：R `cf39f571adf6027f712b27a04505dea3a6620e9c`、P `23f753c5bb293065caf704c46e9f171f34c2307c`，4 次隔离构建字节一致，`release:verify` 通过。rc.3 已在真实 Desktop `0.2.1-rc.3` 的隔离资料中完成干净安装、1.3.0→rc.3 连续更新、存档导出/导入/重启续玩、完整 120 秒与累计 355617ms 实玩，以及外部作者 1.0.1 发布包的安装与实玩（见下方 [2026-10-30 rc.3 真实桌面重跑](#2026-10-30-rc3-真实桌面重跑通过)）。M5 仅剩**两台实体机之间的跨机迁移**未实测；正式 tag、Release 与 stable 推广需全部门槛通过并经用户明确授权，当前未发布。

M4 已经用户授权通过 PR #10 合并，main 合并提交为 `e700eea445e3982adfb80dacf4efc9f6c60c702e`。本轮从该提交独立开展 M5，不将旧 1.3.0 发行候选当作当前代码身份。**除两台实体机跨机迁移外，M5 正式对外验收已通过**：平台 [PR #11](https://github.com/heswy/dsh-game-market/pull/11) 已按 rc.3 通过复核并合并为 `be8f6105cc46e84eb0ea564cb51e7917ed09dcfc`，内容 [PR #6](https://github.com/heswy/dsh-game-registry/pull/6) 已合并为 `1d2abc3`；生产发布尚未授权/执行。

## 要做哪些

1. 正式候选的精确安装与持续更新，确认 Host、Client、版本和存档一致。
2. 实际桌面完整 120 秒与累计五分钟玩法、持久化重开、受控存档迁移。
3. 独立外部作者多文件包投稿、审核、安装、更新、撤下与权限分离。
4. 确定性发行包、内容仓库工具链 pin、公网两代目录、发行说明与恢复流程。

## 做了哪些

- M4 合码完成；没有修改日常 DSH profile 或安装的 App。
- 新增可信市场内的游戏进度导出、导入、导出导入前备份入口。文件只包含游戏标识、版本、存档 schema、键值及 SHA-256 校验和。校验和用于检测损坏，不代表作者签名或真实性认证。
- Host 校验 gameId、schema、大小/键/值配额、校验和和目标 revision；同游戏运行中拒绝导入，导入期间拒绝并发启动；覆盖前先持久化备份。迁移不复制 session、账号或凭据。
- 真实安装的 DSH Desktop `0.2.1-rc.3`，原生 `dsh-app://app`，已完成 A 环境真实游戏存档→界面导出→全新 B 环境界面导入→关闭 App→重开 B→游戏 Continue。见 `raw/m5/M5-migration-2026-10-26T15-*.json` 中最近一次通过记录；早期失败记录保留。
- 这证明同一台机器上的独立资料环境间迁移与真实 App 重开；尚未在两台实体机器之间搬运验证，不称为物理跨机实测。测试游戏通过开发行加载，不能替代正式候选包安装。

## 2026-10-30 复核阻塞与修复

复核复现并记录了三个阻塞，用户指派主会话直接修复；修复提交 `8c1eeaece80dfb233ed022772521c0a4a2b67aab`：

1. 导入与“卸载并删除数据”并发：Host 在导入与 `deleteData` 卸载之间做双向互斥，冲突返回可重试 `GM-4091`，卸载完成后不会被进行中的导入重新创建存档。
2. 元数据写失败语义：`current.json` 为权威，`meta.json` 写失败降级为成功并返回 `warnings: ['save-meta-write-failed']`，前端显示“部分导入”，不再出现“接口失败但存档已提交”。
3. 传输界限：导出、客户端文件门禁、请求体与 `/save-import` 统一使用共享预算（存档配额 + 4 KiB 载荷、+ 8 KiB 请求），导出改为紧凑 JSON；近配额合法存档可导出且不超过导入界限。

验证：`node --test tests/v1.5-save-transfer.test.js` **10/10**；`npm run verify` **1570/1574、0 fail、4 skip、CHECK OK (44)**，重建后工作区干净。新增回归在修复前快照为 6 pass/4 fail，修复后 10/10。

rc.1 的 R `07f2ef1de6aea2b3857bc7e2983f7f083db7eb99` 与 P `0ca0aacc4501f313776f4ea1e0683255cb14e62b` 仍保留为历史证据，但其产物与当前源码不一致。重建候选：版本提交 P `23f753c5bb293065caf704c46e9f171f34c2307c`（`1.5.0-rc.3`），发布提交 R `cf39f571adf6027f712b27a04505dea3a6620e9c`，93 文件 / 3.29 MiB，`sha256-tree-v1 8d9cb0a3e88cc63684aa7c26f7020c0096ff43a72022402849985938a1d0567a`，4 次隔离构建字节一致，`release:verify` OK；`release:promote --channel test` dry-run 生成指向 R 的索引且零写入。rc.3 的真实桌面重跑已在下方完成并通过。

## 2026-10-30 rc.3 真实桌面重跑（通过）

全部在已安装的 DeepSeek Harness Desktop `0.2.1-rc.3` 的隔离资料中进行；日常 profile 未被修改。GitHub 安装与更新走真实公网（`M3_NETWORK_MODE=real-github`），更新索引仍由隔离 TLS 夹具提供，生产 stable 通道未被改动。

| 项目 | 环境与结果 | 证据 |
|---|---|---|
| rc.3 干净安装 | real-Desktop，全新资料无产品依赖，原生管理器从公开 Git 精确安装 R `cf39f57…`；Host 报告 `1.5.0-rc.3`、提交与 R 一致；随包 ZIP 真实初始化并经真实键盘推进；**12/12**，exit 0 | [安装记录](./raw/m5/M5-clean-install-2026-10-30T09-10-40-727Z.json)、[截图](./raw/m5/M5-clean-install-2026-10-30T09-10-40-727Z.png) |
| 1.3.0→rc.3 连续更新 | real-Desktop，公开 Git 精确安装 `1.3.0`（`f8244cf`）后经界面更新到 rc.3；两次实际退出/重开，Host R/Client P 绑定一致，更新前存档逐值保留，旧游戏真实读档，候选 ZIP 实际推进；**22 项 required 全 PASS**，exit 0 | [两跳记录](./raw/m5/M5-native-update-2026-10-30T09-35-41-086Z.json)、[截图](./raw/m5/M5-native-update-2026-10-30T09-35-41-086Z.png) |
| 受控存档迁移 | real-Desktop，A 资料真实游玩→界面导出→全新 B 资料界面导入→关闭→重开 B→Continue 恢复 elapsed/score；便携文件仅含进度字段；**11/11**，exit 0 | [迁移记录](./raw/m5/M5-migration-2026-10-30T09-39-48-534Z.json)、[截图](./raw/m5/M5-migration-2026-10-30T09-39-48-534Z.png) |
| 完整实玩与五分钟 | real-Desktop，rc.3 源码开发行，真实键盘与时间、无状态注入；完整 120 秒自然结算（`shift-complete`），5 个会话累计 **355617ms** 有效游戏，**34/34 required**，exit 0 | [实玩记录](./raw/m5/M5-Desktop-orbit-courier-2026-10-30T09-56-24-427Z.json) |
| 外部作者发布包 | real-Desktop，外部账号发布并已撤下的 1.0.1 发布资产（sha256 `05194feb…`、418059 B）经真实市场 UI 本地 ZIP 点击路径安装到全新隔离资料，Host 记录 `version=1.0.1`、`format=asset-zip-v2`、sha256 一致，ZIP 达到 ready 并经真实 Enter 推进；**15/15**，exit 0 | [外部包记录](./raw/m5/M5-external-package-2026-10-30T09-57-55-018Z.json)、[截图](./raw/m5/M5-external-package-2026-10-30T09-57-55-018Z.png) |

外部包证据边界：公开目录在 P01 撤下后为空，因此这次不是“线上目录下载”，而是对**外部作者同一发布资产**的真实桌面安装与实玩；公网投稿/上架/更新/撤下与权限分离已由 P01 记录单独覆盖。两者合起来关闭 P01 的桌面空白，但不把它写成“无关第三方真人作者”。

## 2026-10-28 补充验证

| 项目 | 环境与结果 | 证据 |
|---|---|---|
| 自动检查 | automated，rc.1 产品源码与生成产物；固定源码 `d2ca694` 干净检出重新 `npm ci --ignore-scripts` + `npm run verify` exit 0，1570/1570，零失败/跳过，CHECK OK (44)，构建后工作区无变化 | [干净检出日志](./raw/m5/M5-fresh-checkout-verify.log)；[首轮日志](./raw/m5/M5-automated-verify.log) |
| 确定性包 | automated，从 P 固定源码 dry-run，4 次独立构建一致，93 文件/3449879 字节，摘要与 R 一致；release:verify 与 test 通道推广 dry-run 均 exit 0，无生产写入 | [发行身份与构建](./raw/m5/M5-candidate-build-verification.json) |
| 完整实玩 | real-Desktop，实际 rc.3 Electron，真实键盘与时间，无游戏状态注入，完整 120 秒自然结算；累计 **407031ms** 有效游戏，**34/34 required**，exit 0，零 CSP 错误 | [通过记录](./raw/m5/M5-Desktop-orbit-courier-2026-10-28T03-02-53-267Z.json) |
| 干净安装 | real-Desktop，全新资料没有产品依赖，由真实管理器直接从公开 R 安装 rc.1，没有 clone/开发行/全局 pnpm 代替；两端身份正确，随包 ZIP 真实初始化与键盘推进；**10/10 required**，exit 0 | [直接安装记录](./raw/m5/M5-clean-install-2026-10-28T03-51-35-782Z.json) |
| 连续更新 | real-Desktop，公开 Git 精确安装 1.3.0，同一资料通过界面更新到 rc.1，再到 rc.2；两次实际退出/重开，Host R/Client P 与各自发行绑定一致，操作 updated、存档不变、旧游戏真实读档，最后启动 ZIP 实际推进；**33/33 required**，exit 0 | [两跳完整记录](./raw/m5/M5-native-update-2026-10-28T03-47-09-185Z.json) |
| 内容工具链 | candidate-public，PR #6 已固定 R、生成 v2、补锁定依赖安装；连接 GitHub 应用成功应用工作流，最新受检 head `b1bae24bbd81d90c6cde6fde241d5b00fb22124f` CI success | [内容 PR](https://github.com/heswy/dsh-game-registry/pull/6)；[CI](https://github.com/heswy/dsh-game-registry/actions/runs/40624607364/job/122606429396) |

rc.1 安装 R 为 `07f2ef1de6aea2b3857bc7e2983f7f083db7eb99`，构建 P 为 `0ca0aacc4501f313776f4ea1e0683255cb14e62b`；第二跳测试候选 rc.2 的 R 为 `fe181461c12b850ee0a3dc23abfaf4154f25f454`、P 为 `9b4a9c59c8e6bf78e35a1d2fd562154488ede0e5`，只保留在隔离测试分支，不合入本产品 PR。

早期五分钟失败记录（210481ms、245368ms）保留。2026-10-28 仅增加故障诊断并单独运行真实桌面测试后通过，没有降低阈值；不能仅凭此次通过断言早期丢失 iframe 的唯一原因。测试游戏采用候选相同产物的开发行，不能将该项当成公开 Git 安装证明。2026-10-28 时内容 PR 尚未合入、目录为空；2026-10-30 已合并，但撤下后目录仍为空。

2026-10-30 rc.3 重跑保留的失败记录：clean-install 首两次分别因本地 git 镜像缺失、`/tmp` asar 运行库未解包而失败；native-update 两次因验证代理的固定 IP 对 codeload 返回 404 失败，显式 `M3_PREFER_PROXY=1` 改走真实代理后通过；一次后台运行的证据写入被工具沙箱拒绝，改前台执行后完整落盘。均为本机工具/网络环境问题，未修改产品代码或降低任何阈值。

## 还要做哪些

- 平台 PR #11 已合并为 `be8f610`，内容 PR #6 已合并为 `1d2abc3`；rc.3 真实桌面安装、更新、迁移、长局与外部发布包桌面安装/实玩均已通过（见上表）。
- **唯一未通过门槛**：两台实体机器间搬运未实测；已交付并重跑同机双资料的受控 JSON 迁移兼容流程。
- **P01 已补桌面证据**：外部账号 `Orangeheswy`（350164273，非内容仓库 collaborator）的公网投稿 Issue #7 → 上架 PR #8 → 更新 Issue #9 / PR #10 → 撤下 PR #11 已取证；其 1.0.1 发布资产已在真实 Desktop 隔离资料中安装并实玩。公开目录撤下后为空，因此桌面安装走真实市场 UI 的本地 ZIP 路径，不是线上目录下载；该账号由用户本人创建并授权复用，不等于无关第三方真人作者。证据见 [外部作者验收手册](./m5-external-author.md)、[原始记录](./raw/community-p01/2026-10-30-identity-and-links.json) 与 [桌面安装记录](./raw/m5/M5-external-package-2026-10-30T09-57-55-018Z.json)。
- 正式 tag、GitHub Release、stable 索引推广必须等两台实体机门槛关闭或用户明确豁免，并经用户发布授权。当前不发布。

## 测试边界与失败记录

两跳安装内容来自真实公开 GitHub 提交，安装由实际 rc.3 Desktop 的插件管理器执行，没有产品开发行、镜像替换或复制 node_modules 作为安装证明。测试模型与诊断插件仅用于隔离资料中的观测。固定索引 URL 通过隔离 TLS 夹具提供候选，不修改生产索引；pnpm 包流量仍走真实 GitHub。测试通道显式配置，stable 通道不被偷偷切换。

Host 的运行提交是安装 R，Client 嵌入源码 P；二者通过 release.json 绑定。两跳之间不清空资料、不删存档、不切换 profile。rc.2 仅为第二跳探针，不是 PR #11 的产品发行版本。

早期连续更新脚本的异步就绪、通道缓存刷新、R/P 断言和恢复确认层退出问题都有原始失败记录。最后一项已经按可见“退出到市场”按钮修正，整链路重新 exit 0；未删除失败记录或手改其 passed 字段。欢迎页与原生主窗口并存时，采集器现在优先连接 `dsh-app://app/`，另有只读实测记录。干净检出检查针对产品相同的固定源码；随后只改验收脚本、文档和证据，产品文件与不可变 R 保持一致。

最终测试清理证明见 [端口与宿主进程检查](./raw/m5/M5-final-cleanup.json)：9495/9496/9497 均关闭，最后的两份隔离 Host 进程均已退出。诊断资料暂留在测试目录便于复查，不包含日常 DSH 资料。
