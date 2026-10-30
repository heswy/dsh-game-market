# M5 首版验收

> **2026-10-30 复核阻塞已修复并重建 rc.3 候选。** 三个存档迁移问题（导入与 `deleteData` 卸载并发、`meta.json` 写失败返回与实际提交不一致、近配额存档导出/导入界限）已由 `8c1eeae` 修复，新增回归测试 10/10；完整 `npm run verify` 1570/1574（4 skip、0 fail）、`CHECK OK (44)`。rc.1 的产物已被修复改变，不能继续作为安装候选；本轮重建 rc.3：R `cf39f571adf6027f712b27a04505dea3a6620e9c`、P `23f753c5bb293065caf704c46e9f171f34c2307c`，4 次隔离构建字节一致，`release:verify` 通过。PR #11/#6 已按 rc.3 重新固定，但 rc.3 的真实桌面重装/更新/迁移尚未重跑，M5 正式对外验收仍未通过，发布未放行。下方通过记录仍是旧候选和对应场景的历史证据，不代表 rc.3 已通过或 M5 可以合并。

M4 已经用户授权通过 PR #10 合并，main 合并提交为 `e700eea445e3982adfb80dacf4efc9f6c60c702e`。本轮从该提交独立开展 M5，不将旧 1.3.0 发行候选当作当前代码身份。**本机工程验收已补齐，M5 正式对外验收未全部通过**：仍缺独立外部作者与两台实体机间迁移实测，生产发布尚未授权/执行。平台 [PR #11](https://github.com/heswy/dsh-game-market/pull/11) 与内容 [PR #6](https://github.com/heswy/dsh-game-registry/pull/6) 分别交付复核。

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

rc.1 的 R `07f2ef1de6aea2b3857bc7e2983f7f083db7eb99` 与 P `0ca0aacc4501f313776f4ea1e0683255cb14e62b` 仍保留为历史证据，但其产物与当前源码不一致。重建候选：版本提交 P `23f753c5bb293065caf704c46e9f171f34c2307c`（`1.5.0-rc.3`），发布提交 R `cf39f571adf6027f712b27a04505dea3a6620e9c`，93 文件 / 3.29 MiB，`sha256-tree-v1 8d9cb0a3e88cc63684aa7c26f7020c0096ff43a72022402849985938a1d0567a`，4 次隔离构建字节一致，`release:verify` OK；`release:promote --channel test` dry-run 生成指向 R 的索引且零写入。**rc.3 的真实桌面干净安装、连续更新、进度迁移与长局尚未重跑**，不能沿用 rc.1 结果作为 rc.3 通过。

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

早期五分钟失败记录（210481ms、245368ms）保留。2026-10-28 仅增加故障诊断并单独运行真实桌面测试后通过，没有降低阈值；不能仅凭此次通过断言早期丢失 iframe 的唯一原因。测试游戏采用候选相同产物的开发行，不能将该项当成公开 Git 安装证明。内容 CI 当前目录为空，已安装 ZIP 校验依赖，但没有真实作者 ZIP 资产可验；PR 未合入，不代表生产 main 已提供 v2。

## 还要做哪些

- PR #11 与内容 PR #6 已按 rc.3 重新固定，待复核合入；rc.3 真实桌面重跑与公开生产目录推广仍未执行。
- 两台实体机器间搬运仍未实测；已交付可执行的受控 JSON 迁移兼容流程。
- **P01 未通过**：用户明确本轮只有自己的账号，没有现成独立作者。同一账号下受控作者仓库只能证明技术流程，不能证明独立身份与维护权限分离。可交接材料见 [外部作者验收手册](./m5-external-author.md)。
- 正式 tag、GitHub Release、stable 索引推广必须等全部正式门槛通过及用户发布授权。当前不发布，不将 M5 总体验收标为通过。

## 测试边界与失败记录

两跳安装内容来自真实公开 GitHub 提交，安装由实际 rc.3 Desktop 的插件管理器执行，没有产品开发行、镜像替换或复制 node_modules 作为安装证明。测试模型与诊断插件仅用于隔离资料中的观测。固定索引 URL 通过隔离 TLS 夹具提供候选，不修改生产索引；pnpm 包流量仍走真实 GitHub。测试通道显式配置，stable 通道不被偷偷切换。

Host 的运行提交是安装 R，Client 嵌入源码 P；二者通过 release.json 绑定。两跳之间不清空资料、不删存档、不切换 profile。rc.2 仅为第二跳探针，不是 PR #11 的产品发行版本。

早期连续更新脚本的异步就绪、通道缓存刷新、R/P 断言和恢复确认层退出问题都有原始失败记录。最后一项已经按可见“退出到市场”按钮修正，整链路重新 exit 0；未删除失败记录或手改其 passed 字段。欢迎页与原生主窗口并存时，采集器现在优先连接 `dsh-app://app/`，另有只读实测记录。干净检出检查针对产品相同的固定源码；随后只改验收脚本、文档和证据，产品文件与不可变 R 保持一致。

最终测试清理证明见 [端口与宿主进程检查](./raw/m5/M5-final-cleanup.json)：9495/9496/9497 均关闭，最后的两份隔离 Host 进程均已退出。诊断资料暂留在测试目录便于复查，不包含日常 DSH 资料。
