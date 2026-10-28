# M5 首版验收

M4 已经用户授权通过 PR #10 合并，main 合并提交为 `e700eea445e3982adfb80dacf4efc9f6c60c702e`。本轮从该提交独立开展 M5，不将旧 1.3.0 发行候选当作当前代码身份。

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

## 2026-10-28 补充验证

| 项目 | 环境与结果 | 证据 |
|---|---|---|
| 自动检查 | automated，rc.1 产品源码与生成产物，`npm run verify` exit 0，1570/1570，零失败/跳过，CHECK OK (44) | [完整日志](./raw/m5/M5-automated-verify.log) |
| 确定性包 | automated，从 P 固定源码 dry-run，4 次独立构建一致，93 文件/3449879 字节，摘要与 R 一致；release:verify 与 test 通道推广 dry-run 均 exit 0，无生产写入 | [发行身份与构建](./raw/m5/M5-candidate-build-verification.json) |
| 完整实玩 | real-Desktop，实际 rc.3 Electron，真实键盘与时间，无游戏状态注入，完整 120 秒自然结算；累计 **407031ms** 有效游戏，**34/34 required**，exit 0，零 CSP 错误 | [通过记录](./raw/m5/M5-Desktop-orbit-courier-2026-10-28T03-02-53-267Z.json) |
| 内容工具链 | candidate-public，PR #6 已固定 R、生成 v2、补锁定依赖安装；连接 GitHub 应用成功应用工作流，最新受检 head `b1bae24bbd81d90c6cde6fde241d5b00fb22124f` CI success | [内容 PR](https://github.com/heswy/dsh-game-registry/pull/6)；[CI](https://github.com/heswy/dsh-game-registry/actions/runs/40624607364/job/122606429396) |

rc.1 安装 R 为 `07f2ef1de6aea2b3857bc7e2983f7f083db7eb99`，构建 P 为 `0ca0aacc4501f313776f4ea1e0683255cb14e62b`；第二跳测试候选 rc.2 的 R 为 `fe181461c12b850ee0a3dc23abfaf4154f25f454`、P 为 `9b4a9c59c8e6bf78e35a1d2fd562154488ede0e5`，只保留在隔离测试分支，不合入本产品 PR。

早期五分钟失败记录（210481ms、245368ms）保留。2026-10-28 仅增加故障诊断并单独运行真实桌面测试后通过，没有降低阈值；不能仅凭此次通过断言早期丢失 iframe 的唯一原因。测试游戏采用候选相同产物的开发行，不能将该项当成公开 Git 安装证明。内容 CI 当前目录为空，已安装 ZIP 校验依赖，但没有真实作者 ZIP 资产可验；PR 未合入，不代表生产 main 已提供 v2。

## 还要做哪些

- 正在完成真实桌面精确安装与同一资料的连续两次更新；不以旧 M3 证据代替本轮候选验收。
- 两台实体机器间搬运仍未实测；已交付可执行的受控 JSON 迁移兼容流程。
- **P01 未通过**：用户明确本轮只有自己的账号，没有现成独立作者。同一账号下受控作者仓库只能证明技术流程，不能证明独立身份与维护权限分离。可交接材料见 [外部作者验收手册](./m5-external-author.md)。
- 正式 tag、GitHub Release、stable 索引推广必须等全部正式门槛通过及用户发布授权。当前不发布，不将 M5 总体验收标为通过。
