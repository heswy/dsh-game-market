# V1.5 维护者发布流程（平台插件持续更新）

- 适用版本：V1.5 M3 起
- 工具：`scripts/release/prepare.mjs`、`promote.mjs`、`verify.mjs`（零依赖，只用 `node:child_process` 调本地 git；不联网、不 push、不 tag、不建 Release）
- 相关冻结决策：`docs/verification/v1.5/m3-decisions.md` §5；方案 `docs/plans/2026-10-19-v1.5-public-launch.md` §5.4；契约 `docs/V1.5-CONTRACTS.md` §9.4
- 本文只描述维护者操作；用户侧更新体验见契约 §9 与 `docs/verification/v1.5/plugin-update-m3.md`

> **本轮（M3）红线**：不写生产索引 `platform-updates/plugins.json`、不打 tag、不发布 GitHub Release、不合并 main。
> `release:promote` 默认 dry-run，只能显式 `--write --out <path>` 写工作区文件，且写生产索引路径还需 `--production-index` 明确确认；工具自身永不提交/推送。

## 1. 三个身份：P、R、I（以及为什么不能自引用）

一次发布涉及三个**互不相同**的 commit：

| 身份 | 是什么 | 谁产生 | 内容 |
|---|---|---|---|
| **P**（version commit） | 本次发布的版本提交：`package.json` 版本 + 代码/游戏/资源变更 | 维护者正常 PR → 合并 main | 可 review、可测试；**构建产物基于 P** |
| **R**（release commit） | 不可变安装目标，索引只认它 | `npm run release:prepare --write` | 在 P 之上只新增/更新 `platform-updates/release.json`（`clientBuildCommit = P`）+ 重新构建的 `client.js`、`games/**`、`registry/**` |
| **I**（index commit） | 可变发现入口 | `npm run release:promote --write --out ...` 生成文件后，**由维护者在另一个提交/PR** 中提交 | `platform-updates/plugins.json`（DSH plugin-market-index 格式 1），把 `dsh-game-market` 精确钉到 R |

为什么 R 里写的是 `P` 而不是 `R` 自己：**一个文件无法包含包含它的 commit 的哈希**（自引用死循环）。所以：

- `release.json.clientBuildCommit = P`（构建产物所基于的版本提交，构建前已知）；
- Client bundle 在构建时把 `{version, buildCommit=P}` 编进 `client.js`（`scripts/build-client.mjs`），并只按自己 bundle 里的身份上报；
- Host 运行 R 时从**自己包内的** `release.json` 读取期望的 Client 身份 `{version, P}`；
- 双端核验（契约 §9.5.1）：Host `loadedVersion==target.version && buildCommit==R`，Client `buildVersion==version && buildCommit==P`。

**禁止**把索引塞进 R：`release:promote` 会拒绝「R 内含指向 R 的索引」（自引用）以及「R 中新增/修改索引」（索引必须是独立提交）。R 只作为子提交从 main 继承**旧的**索引文件是允许的（不引入新索引内容）。

## 2. 前置条件

- Node.js ≥ 20（`engines.node`），`git` 在 PATH；仓库 `origin` 必须是 `https://github.com/heswy/dsh-game-market(.git)`（工具会规范化校验）；
- 工作区**干净**（`git status --porcelain --untracked-files=all` 为空）；HEAD 必须是分支（不能 detached）；
- `package.json` 版本已经在 P 中 bump 好：**工具不会替你 bump 版本**；`--version` 只做断言；
- `package.json` `files` 必须包含：`client.js`、`games/**`、`registry/**`、`platform-updates/release.json`、`scripts/release/**`（安装后的 bundle 才能自证身份）；
- 发布前先跑完整验证（独立于发布工具）：`npm run verify`（构建 + check + 全部测试）；CI 亦须全绿；
- 严格语义：**工具只做发布身份/不可变目标校验，不代替完整验收**。

## 3. 一次完整发布（dry-run 优先）

### 步骤 1：准备版本提交 P

```bash
# 1. 版本号只在这一步改（例如 1.3.0）
git checkout -b release/v1.3.0
# 编辑 package.json version、更新兼容性矩阵/说明等
npm run build          # 提交构建产物（client.js、games/dist、registry）
npm run verify         # 全量验证（CI 同样要跑）
git add -A && git commit -m "chore(release): prepare v1.3.0"
# 走 PR、CI，合并到 main；记下 merge 后的版本提交 P
git rev-parse HEAD     # P
```

要求：P 的树里 `package.json.version === 1.3.0`；`npm run build` 在这棵树上可重复（两次构建字节一致）；P 是可 review 的普通代码提交。

### 步骤 2：dry-run 校验并预览 release commit R

```bash
npm run release:prepare -- --version 1.3.0
```

dry-run **零写入**，会做：

1. 工作区干净 / origin 绑定 / 分支 / HEAD 不是 release commit；
2. `package.json` 版本、`private:true`、bundle/client/exports、`engines.node`、`engines.dsh`、`files` 完整性；
3. **在临时副本中构建两次**：`client.js`、`games/**`、`registry/**` 必须字节一致；且构建不得依赖 `release.json` 里 artifacts 之外的字段（防止循环依赖）；
4. 生成 `platform-updates/release.json` 候选（含 artifacts 摘要）并校验 Client bundle 确实嵌入了 `version=1.3.0 buildCommit=<P>`；
5. 打印计划提交信息 `chore(release): v1.3.0 build <P>` 与产物清单。

产物摘要 `artifacts.sha256`（`sha256-tree-v1`）定义：对 roots `["client.js","games","registry"]` 下所有普通文件，按路径排序后取 `sha256("<path>\0<sha256(content)>\0<size>\n")`；`release.json` 自身不在 roots 内（避免自引用）。

### 步骤 3：创建 release commit R（维护者授权）

```bash
npm run release:prepare -- --write
# 输出 RELEASE COMMIT R <40hex>
```

`--write` 会：写 `platform-updates/release.json` → 在工作区重新构建 → 校验产物与 dry-run 摘要一致 → 只 `git add platform-updates/release.json client.js games/ registry/` → 生成 R（P 的子提交）。失败会自动回滚工作区（不留下半成品）；**不需要也不允许手工 amend**。

检查并推送/合并 R（Lead 或授权维护者执行；工具不推送）：

```bash
git show --stat <R>
git show <R>:platform-updates/release.json
git push origin <branch>      # 走 PR/CI，合并 main
```

**R 是不可变安装目标**：一旦进入索引，禁止 amend/rebase/force-push 改写它；同 version 不同 commit 会被工具拒绝。R 合并后 `release:verify` 可随时只读复核：

```bash
npm run release:verify -- --release <R>
```

### 步骤 4：生成并提交插件索引 I（独立提交/PR）

先 dry-run（不写任何文件，打印完整格式 1 索引）：

```bash
npm run release:promote -- --release <R> --channel test     # 测试通道演练
npm run release:promote -- --release <R> --channel stable   # 只有正式版本才允许
```

dry-run 会校验：R 是真实存在、可达（本地 refs 可到达）、完整 40 位小写 SHA；R 内 `package.json.version` 与 `platform-updates/release.json.version` 一致；`clientBuildCommit=P` 是 R 的祖先且 P 的 package version 相同；R 树内 artifacts 摘要与 `release.json` 完全一致；Client bundle 身份自证；R 不含索引；stable 拒绝 prerelease；同 version 不同 commit / 比可信索引更旧的版本一律拒绝。

生成文件（**只写显式 `--out`，不提交**）：

```bash
# 本 M3 轮次：写模板/演练路径，绝不提交生产索引
npm run release:promote -- --release <R> --channel test --write --out release-out/test-plugins.json
```

正式索引 PR（未来的正式发布，需单独授权）：

```bash
git checkout -b index/v1.3.0 main      # 独立分支，基于含 R 的 main
npm run release:promote -- --release <R> --channel stable \
  --write --out platform-updates/plugins.json --production-index
git add platform-updates/plugins.json
git commit -m "chore(release): publish plugin index for v1.3.0 (build <R>)"
# 提交内容只应有 platform-updates/plugins.json；PR 里核对索引 pin 的 commit 就是 R
```

注意：

- `release:promote --write` 只写文件，不做 `git add/commit/push/tag`；`--out` 必须是工作区内路径；写生产索引路径必须带 `--production-index`（防误写）；
- 索引 I 必须**独立于 R**：R 的树里没有新索引；I 的父提交包含 R；CI `scripts/check.mjs` 会校验索引格式与「索引 pin 的 commit 不含该索引文件」；
- 本 M3 轮次不产生生产索引：`platform-updates/plugins.json` 保持不存在（发现路径此时 404/离线是预期状态）。

### 步骤 5：测试通道演练 → 最后才 stable

正式 stable 推广前，至少满足（证据进 `docs/verification/v1.5/plugin-update-m3.md`）：

1. **两个连续版本** A→B（再 B→C）的一键更新真实演练（不是只验证首次安装）；
2. 网络失败/索引获取失败：保留上次目标、显示离线，游戏/市场不受影响；
3. 非 HMR profile：`pending-restart`（已安装、待重启），重启后双端核验 `updated`，存档/配置保留；
4. 旧存档继续可用；旧 Client + 新 Host → `stale-runtime(client-old)`，刷新后 `updated`；
5. 多窗口/重复点击幂等；活跃游戏存档失败必须阻断包变更。

测试通道 opt-in（契约 Q4 待 Codex 裁决）：本工具 `--channel test` 只负责「允许 prerelease + 生成可演练索引」；测试 profile 如何指向测试索引由 Host 配置层负责（不在普通 UI 一键切换）。测试索引建议放独立路径/独立分支，禁止覆盖生产 `plugins.json`。

### 步骤 6：stable 推广（最后一步）

```bash
# 1) dry-run：stable 拒绝 prerelease；同 version 不同 commit 拒绝；比可信索引旧拒绝
npm run release:promote -- --release <R> --version 1.3.0
# 2) 按步骤 4 的正式索引 PR 流程生成 I、提交、校验、合并
# 3) 合并后复核生产索引原始文件（下一次变更前）
curl -fsSL https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json
```

### 步骤 7：内容仓库 toolchain pin（另开 PR）

平台发布 R 合并后，内容仓库的 toolchain pin 要单独 PR 升到 R，并重新生成两代目录/校验资产：

- 改 `templates/registry/toolchain.lock.json` 的占位符数据（`platformRepo`/`commit`/`platformVersion`）；
- 在内容仓库执行 registry 生成与 `validate-catalog`/`validate-assets`，CI 通过后合并；
- 它**不是**插件更新通知：不会给用户更新插件，也不会改变已安装 bundle；用户看到的「社区游戏更新」与「插件更新」是两条链路。

### 步骤 8：回滚与撤回（不重写历史）

- **回滚一次 stable 推广**：新增一个索引提交 I'（不是 revert 历史、更不是 force-push），把 `plugins.json` 指回上一个已验证的精确 R_prev；或直接发布修复版本 R_fix（推荐）。旧 R 永久保留、仍可安装。
- **用户恢复**：在 DSH 原生插件管理器安装**上一个精确 commit**（例如 `https://github.com/heswy/dsh-game-market.git#<R_prev>`）；不会也不应该自动降级已安装版本。
- **不重写 tag**（本流程本来就不打 tag）；R 一旦发布不可变；同 version 不同 commit 永远拒绝。
- 失败安装的恢复：重新读取原生 `pluginManager` 状态与实际版本，按契约 §9.7 区分「失败，旧版本仍运行」与「需恢复旧版本」；必要时经原生链路安装预先记录的旧精确 target。

### 步骤 1 的已知过渡态（第二次及以后发布）

版本提交 P 里通常还带着**上一个 release 的** `platform-updates/release.json`（版本号是旧的）。构建脚本必须把这种「版本不一致的旧身份」当作 stale identity 忽略（`buildCommit:null`），而不是让 `npm run build` 直接失败；真正的严格身份校验发生在发布工具：`release:prepare` 在构建前写入与 P 匹配的 `release.json`，并在 R 上强制要求 `client.js` 嵌入 `version + clientBuildCommit=P`。若 CI 在 P 上因旧 release.json 版本不一致而构建失败，那是 build-client 的过渡态 bug（见 Q2 关联讨论），不是发布流程要求的结果。

## 4. 老用户一次性迁移（v1.2.0 → V1.5）

v1.2.0 **没有更新 UI**，无法事后给它加按钮：

1. 现有 v1.2.0 内部测试用户：在 DSH 原生插件管理器改用精确安装 spec 安装 V1.5 发布 commit（一次性迁移）：
   - 安装 form：`https://github.com/heswy/dsh-game-market.git#<R>`
   - 或索引/install 入口给出的等价 `git+https://github.com/heswy/dsh-game-market.git#<R>`
   - 记录最低 DSH 版本（`engines.dsh`，例如 `>=0.2.0 <0.3.0`）与一次性源配置说明；
2. 从 V1.5 起才享受持续更新（发现 → 更新 → 双端核验）；
3. dev / `link:` / `file:` 来源**不得静默迁移**为正式包：显示「开发模式，前往插件管理切换安装来源」，更新按钮禁用；
4. 正式外部用户从 V1.5 首次安装起走上述持续更新链路；首版不依赖用户已打开 DSH「发现」实验插件。

首次对外需提供：「插件 → 添加插件」的精确安装 spec、最低 DSH 版本、必要的一次性配置说明；最终验收必须由干净用户 profile 完成。

## 5. 命令 / 错误码速查

| 命令 | 作用 | 写入 |
|---|---|---|
| `npm run release:prepare -- [--version X.Y.Z]` | 全量校验 + 双构建确定性 + 预览 release.json/R | 无 |
| `npm run release:prepare -- --write` | 生成 `platform-updates/release.json` + 构建 + 创建 R | 工作区 + R commit（不 push/tag） |
| `npm run release:promote -- --release <40hex> [--channel stable\|test]` | 校验 R，打印格式 1 索引 | 无 |
| `npm run release:promote -- --release <40hex> --write --out <path> [--production-index]` | 只写显式 `--out` 文件 | 仅该文件（不提交/推送） |
| `npm run release:verify -- --release <40hex> [--index <path>]` | 只读复核 R（+索引） | 无 |

所有命令支持 `--json`（机器可读 envelope；失败为非零退出码 + `{ok:false,code,message,guidance?,details?}`）。

常用错误码（失败一律 fail-closed，消息带修复指引）：

| 错误码 | 含义 / 处理 |
|---|---|
| `E_RELEASE_DIRTY` | 工作区不干净：先提交/stash，发布提交只能含 release.json + 产物 |
| `E_RELEASE_VERSION_MISMATCH` | `--version`/`package.json`/`release.json`/P 的版本不一致：在 P 中 bump 后重跑 |
| `E_RELEASE_REPO_MISMATCH` | origin 不是 `heswy/dsh-game-market` |
| `E_RELEASE_ENGINES` | `engines.node`/`engines.dsh` 缺失或非法 |
| `E_RELEASE_FILES_INCOMPLETE` | `package.json files` 未包含发布必需项 |
| `E_RELEASE_ARTIFACTS` / `E_RELEASE_BUILD_FAILED` | 产物缺失/构建失败 |
| `E_RELEASE_NONDETERMINISTIC` | 两次构建不一致（时间戳/随机数/机器路径/依赖 release.json 其它字段） |
| `E_RELEASE_CLIENT_IDENTITY_MISSING` | client.js 未嵌入 `version` + `clientBuildCommit`（检查 build-client.mjs / release.json） |
| `E_RELEASE_HEAD_IS_RELEASE` | HEAD 已是 release commit：先做新的版本提交 P |
| `E_RELEASE_BAD_COMMIT` / `E_RELEASE_UNKNOWN_COMMIT` / `E_RELEASE_UNREACHABLE` | `--release` 必须是完整 40 位小写、存在、可从本地 refs 到达的 commit（不接受分支/tag/HEAD/短 SHA） |
| `E_RELEASE_RELEASE_JSON` | R 缺少或无法解析 `platform-updates/release.json`（不是 release:prepare 产出的提交） |
| `E_RELEASE_ARTIFACT_DIGEST` | R 树内产物与 release.json 摘要不一致（禁止手改产物/identity） |
| `E_RELEASE_PRERELEASE_STABLE` | stable 通道拒绝 prerelease：改用 test 通道演练 |
| `E_RELEASE_SELF_REFERENCE` / `E_RELEASE_INDEX_IN_RELEASE` | R 内包含索引/指向自己的索引：索引必须独立提交 I |
| `E_RELEASE_VERSION_IMMUTABLE` / `E_RELEASE_VERSION_ROLLBACK` | 同 version 不同 commit / 向旧版本回退：发布新版本或新索引提交 |
| `E_RELEASE_PRODUCTION_INDEX_GUARD` | 未明确确认就写生产索引路径：加 `--production-index`（仅授权索引 PR） |
| `E_RELEASE_OUT_REQUIRED` / `E_RELEASE_OUT_INVALID` | `--write` 缺 `--out`，或 `--out` 越界/命中 R 内文件 |

## 6. 本轮（M3）明确不做

- 不生成/提交生产 `platform-updates/plugins.json`；不 push、不打 tag、不发 Release、不合并 main；
- M3 最终 head 会做成 **release 风格** commit（版本 `1.3.0`）**仅用于隔离 profile 的真实安装/更新验证**（不发布、不打 tag）；
- 不写用户 Desktop profile/App 安装目录/生产内容仓库；不实现 M4/M5。

## 7. 待 Codex 裁决的关联问题（不阻塞本文流程）

- Q1 公开解析入口可达性 vs 自有严格校验器（本文工具用自有格式 1 校验器，按公开格式文档实现，不复制 DSH 私有实现）；
- Q2 Client 身份用 `{version, P}` 而非 `R`（文件无法包含自身 commit；两段式 release 是必要代价）；
- Q3 `release.json` 作为包内扩展身份是否可接受（不新增索引外网络依赖）；
- Q4 测试通道 opt-in 的表示方式；
- Q5 手动刷新节流语义（Host 侧，与发布工具无关）。
