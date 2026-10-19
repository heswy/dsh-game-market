# 社区投稿与官方内容目录契约（V1.2 · 2026-10-19）

本文件是 community publishing MVP 的实现契约。运行时包/Registry/安装/SDK
仍以 `docs/V1-CONTRACTS.md` 和 PRD §8 为准；本文件只定义**投稿、审核、归属、
官方内容仓库、维护者上架工具和默认目录源**。

## 1. 两个仓库

| 仓库 | 职责 | 不承载 |
|---|---|---|
| 平台仓库 `heswy/dsh-game-market` | Host/Client/Runtime/SDK、shared 校验器、CLI、Skill、维护者工具、内容仓库模板、测试 | 社区生产目录数据 |
| 内容仓库（建议 `heswy/dsh-game-registry`，待配置） | `catalog/`、`owners/`、`reviews/`、生成的 `registry/games.json`、Issue/PR 模板、只读 CI | 平台代码、工具算法副本 |

随包 `registry/` 仍是首发游戏的离线种子，由 `scripts/build-registry.mjs`
确定性生成；**不得把社区目录写进随包生成物**。

## 2. 数据契约

全部为 `schemaVersion: 1`；实现校验器在
`packages/shared/src/community.js`，脚本与内容仓库 CI 共用，不维护第二套规则。

### 2.1 `submission.json`（作者）

必填：

- `submissionType`: `new` | `update`；
- `game`: `id`（包 ID 规则，非保留 ID）、`name`、`version`（严格 semver）、
  `description`、1–3 个 `categories`、`capabilities`（V1 仅 storage/score）、
  `sdkVersion`、`runtimeVersion`；可选 tags/homepage/repository/license；
- `author`: GitHub `login`、**数字** `githubUserId`、公开 `sourceRepo`、固定
  `sourceCommit`（7–40 hex）、`buildInstructions`、可选 contact；
- `package`: 公开 HTTPS URL（末段 `<id>-<version>.html`）、`sha256`、`size`、
  `.sha256` URL；
- `media`: `cover` 1 张 + `screenshots` 1–5 张，每张 `url`/`sha256`/`size`/
  `type`（png/webp/jpeg）；
- `licensing`: `codeLicense`、`assetLicense`、`archivePermission: true`；
- `selfTest`: ready/pauseResume/beforeSave/continuePlay/keyboard/narrowWindow/
  theme/fullBleed/safeArea/noNetwork 全部 `true`；
- 更新投稿必须带 `update.changelog`、`update.saveCompatibility`
  （compatible/incompatible/not-applicable）。

**Draft 与 final**：投稿工具/CI 只接受 final（完整、`pending` 为空）。作者尚未拿到
GitHub 身份/公网 URL 时，可交付 `submission.draft.json`：把未完成字段留空并放进
`pending[]`。`pending[]` 支持字段路径（author.login/githubUserId/sourceRepo、
package.url/sha256Url、media 各 URL，截图可用 `media.screenshots[].url` 批量表示）
和自由文本待办说明；`validateSubmission(draft, {mode:'draft'})` 可通过，但 final
仍会拒绝所有 pending。补齐后必须重新以 final 校验。

Issue Form 与资料 PR 使用同一字段；Issue 关闭/作者 CI 通过不等于审核通过。

### 2.2 `review`（维护者）

发布前必须存在 `reviews/<id>/<version>.json`，`decision: "approved"`，并绑定：

- `gameId`、`version`、`sourceCommit`；
- `package.sha256` + `package.size`；
- `media.coverSha256` + `media.screenshotSha256s[]`；
- `reviewer`（login + 数字 `githubUserId`）、`reviewedAt`、`testEvidence`（至少 1 条）、
  可选 source issue/PR URL。

校验器要求 review 与 submission 的提交/包/素材摘要完全一致；任一处变化 approvals
失效。作者自填的 reviewer/approved 字段没有任何授权效力。

### 2.3 `owners/<id>.json`

```json
{
  "schemaVersion": 1,
  "gameId": "orbit-catch",
  "owner": { "login": "example-author", "githubUserId": 123456 },
  "createdAt": "2026-10-19T12:00:00.000Z"
}
```

更新作者必须匹配稳定的 GitHub 数字 ID，不能只匹配 login/display name。ID 转让/回收
由维护者线下处理，本版不做自助转让。

### 2.4 `catalog/<id>.json`

内容仓库的源记录：`game`（展示/兼容字段）、`author`（数字身份）、`release`
（tag、固定 package/media HTTPS URL 与摘要）、`source`（repo/commit/issue/pr）、
`review`（审核人/时间/包摘要）、`selfTest`、时间戳、可选 changelog。

`registry/games.json` 由 `catalog/*.json` **生成**，不是手写文件：

- 按 `id` 排序；`generatedAt` 取源记录中最大的固定更新时间（不是构建当前时间）；
- 同一输入字节一致；≤500 条、≤2 MiB、全部通过现有 Registry schema；
- 客户端只看到 registry 条目，不包含 owner/review/selfTest 等运营元数据；
- `catalog`/`registry` 必须在同一个 PR 中更新，不能等待一次可能失败的部署。

## 3. 默认官方目录与离线兜底

Host 默认源（无显式配置时）：

1. 若 remote 有 fresh/stale 可用快照：**仅使用 remote**（不与随包种子合并）；
2. 冷启动无可用 remote（无缓存/过期/网络不可用/索引非法）：显示随包
   `registry/games.json` + `registry/packages/` 种子，状态 `seed`；
3. remote 恢复后刷新成功即切回 remote，不把 seed 写入 remote cache；
4. 显式 `DSH_GAME_REGISTRY_URL` 或 `config.registry.url` 保持原有单源语义
   （不自动回退官方/种子）。

实现：`packages/host/src/registry-layered.js`，在现有单一 Registry 服务上组合，
不修改原有校验/下载/安装算法。状态字段（health/registry snapshot）至少包含
`state: missing|fresh|stale|expired|offline|seed`、`activeSource: official|seed`、
`fallback: boolean`、`official`/`seed` 摘要。

Market UI：`seed` 状态显示“正在显示随包游戏，官方目录暂不可用。”+ 重试；
不得恢复常驻“更新于 xx”文案。手动刷新入口：header 刷新按钮；成功后重新加载目录。

## 4. 维护者上架工具

```bash
node scripts/registry/prepare.mjs \
  --submission /path/submission.json \
  --review /path/approved-review.json \
  --registry-dir /path/content-repo
# 默认 dry-run；确认后加 --execute
```

### 4.1 预演（默认）

只读：校验 submission/review/owner/version，下载并校验作者声明字节（package/media
SHA+size+真实格式），检查兼容性和现有目录；输出 release tag、资产名、最终 URL、
摘要、要写的文件与目录 diff。**不写远端、不改本地文件、不建分支。**

### 4.2 执行

前置：Node、Git、`gh` 已登录且对内容仓库有权限；内容仓库干净、在 base 分支；
仓库 public；`gh auth status`/repo view 检查通过。

步骤：重新校验批准 → 下载/保存 exactly-once 临时字节 → 创建 draft Release
（tag `<id>-v<version>`，资产 `<id>-<version>.html`、`.sha256`、版本化
cover/screenshots）→ 上传完整 → 发布 Release → 通过公开 URL 重新校验摘要/大小 →
写 `catalog/owners/reviews/registry` 并本地重新生成/校验索引 → 建分支、提交、push →
开 catalog PR。工具不自动合并 PR；**合并 PR 才改变生产市场**。

### 4.3 幂等与失败

- 事务标识：仓库 + ID + version + 批准 SHA。
- 同版本同摘要：可复用已存在 Release/PR；已上架则直接报告 alreadyPublished。
- 同版本不同摘要：失败（`E_PUBLISH_VERSION_IMMUTABLE`），要求升版本。
- 版本必须高于当前 catalog；更新必须匹配 owner。
- 上传/公开校验/索引/PR 任一步失败：生产目录保持不变；可修复后重试；不覆盖旧资产、
  不重复开 PR；draft/已发布 Release 可能留下，属于允许的未入目录归档。
- 不执行 `git reset/clean`；不覆盖用户未提交文件。

## 5. 内容仓库 CI 与权限

- `.github/workflows/validate-catalog.yml` 只读 checkout 内容仓库，再按
  `toolchain.lock.json` 固定 commit checkout 平台工具链；不使用
  `pull_request_target` 执行投稿代码；第三方 Action 固定完整 commit SHA。
- CI 运行 `scripts/registry/validate-catalog.mjs --registry-dir .` 校验
  catalog/owner/review/生成索引，再运行 `validate-assets.mjs --registry-dir .`
  重新下载正式包/封面/截图并核对摘要与真实格式；不执行作者构建、不读 secrets。
- 内容仓库 main 通过 PR 更新；合并是唯一生产开关。单维护者可“PR + 必需 CI + 人工
  点击合并”；有第二位维护者后再加独立 approval/CODEOWNERS。
- 维护者本机执行上架工具（`gh`），不要求投稿机器 CI 持有写权限或机器人。

## 6. 待外部配置（M4）

以下不能由软件单测证明，也未在本分支执行：

- 内容仓库真实 owner/name（默认建议 `heswy/dsh-game-registry`，**尚未建立**）；
- 默认官方 URL 的公网可达与真实 `registry/games.json`；
- `gh` 维护者账号对内容仓库的权限、分支保护/ruleset、不可变 Release 设置；
- 至少一次真实投稿（含 Skill 指导 AI 从玩法到打包）、真实 1.0.0 发布、1.0.1 更新
  和目录撤下的公网闭环；
- GitHub Release 资产域名是否在 Host allowlist（若不在，需实测后加精确 host +
  拒绝测试，不能泛化）。

在上述完成前，默认 remote 不可达时 Host 使用随包 seed，Market 不白屏；工具仅以
模拟 GitHub/HTTP 适配器验证，不得宣称已上线。
