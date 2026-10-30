# M5 外部作者验收手册

2026-10-30：已用用户新建的独立账号 `Orangeheswy` 执行受控 P01，公网投稿/上架/更新/撤下与权限分离通过；真实 DSH Desktop 外部包安装与实玩尚未运行。下方手册保留为完整外部作者的执行标准。

## 作者准备

使用独立 GitHub 身份，在自己的仓库中按 [开发指南](../../developer-guide.md) 与 [投稿契约](../../community-submission.md) 生成 `asset-zip-v2` 多文件游戏。至少包含独立 ESM、CSS 和本地资源；准备 1.0.0 与保留旧存档兼容的 1.0.1。禁止把 token、个人配置、外部可变 URL 写入包或证据。

使用项目提供的 CLI 验证并保留版本、不可变 Release/asset URL、zip SHA-256、filesDigest、submission.json 和许可证。按投稿契约提交内容仓库 PR。作者不应拥有内容仓库维护权限；不得给作者维护者 token。

## 维护者与验收人

1. 核对作者独立身份及实际仓库权限，归档公开可核验的权限证据；不得仅凭口头自称独立。
2. 按 [维护流程](../../community-operations.md) 审核、试玩、验证不可变资源与 ZIP 清单；先 dry-run，检查差异后生成内容 PR。记录作者提交与维护者审核各自的身份、PR 和提交 SHA。
3. 合入后核验公网 v1/v2 投影；新包只进入符合格式的投影。真实 DSH 干净资料安装，实际运行并保存。
4. 作者独立发布 1.0.1，重新投稿与审核；真实 DSH 更新后 Continue 恢复 1.0.0 的进度。
5. 维护者撤下，核验两个公网目录均不再提供新安装，既有归属、审核与发布历史保留；已有安装行为按契约验证。
6. 保存准确命令、exit code、宿主版本、平台 P/R SHA、作者资产 SHA、所有 PR/Release 链接、截图和未覆盖项。原始记录先脱敏再入库。

## 2026-10-30 受控独立账号执行记录

- 独立账号：`Orangeheswy`（350164273，2026-10-30 注册），不是 `heswy/dsh-game-registry` collaborator（当前 collaborators 仅 `heswy`）。
- 新投稿 Issue #7 → 上架 PR #8（1.0.0）→ 更新 Issue #9 / PR #10（1.0.1）→ 撤下 PR #11；全部由维护者 `heswy` 复核并合并。
- 包：`asset-zip-v2` 24 文件；1.0.0 SHA-256 `05328d64…`，1.0.1 SHA-256 `05194feb…`。
- Host 隔离验收：公开资产安装 1.0.0 → 刷新发现 `latestVersion=1.0.1`、`updateAvailable=true` → 更新安装 1.0.1；见 [install-update](./raw/community-p01/2026-10-30-install-update.json)。
- 撤下后公网 v1/v2 目录均为空，`owners/external-orbit.json` 与两份 review 保留。
- 未覆盖：真实 DSH Desktop 干净资料安装该外部包、实际游玩/Continue。该账号由用户本人创建并授权复用，属于受控独立账号，不等同于无关第三方真人作者。

## 完成判据

必须同时具备独立作者身份、维护者权限分离及上述整条真实公网链路。自有受控仓库、模拟器、本地目录、dry-run 或自动化单元测试均只能覆盖各自部分，不能勾选 P01 总项。
