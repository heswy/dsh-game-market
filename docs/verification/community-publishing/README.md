# 社区投稿与 GitHub 上架 MVP · 验证记录

> 2026-10-19 发布收口：PR #4（`2b45b2e`）与 PR #5（`e247b93`）已合入，纳入平台 v1.2.0。CR4-01～06 与 PR #5 两项 P2 全关闭；PR #5 固定 head `f862650` 复跑 verify 840/840、CHECK OK (38)、registry 31/31。受控 M4 公网闭环已完成，真实 DSH App 等边界仍保留；见[发布说明](../../releases/v1.2.0.md)。

基线：`main@c106ac1`（v1.1.0）→ 分支 `feat/community-publishing`。
方案：`docs/plans/2026-10-19-community-publishing-mvp.md`；契约：
`docs/community-publishing-contracts.md`。

## 1. 本轮本地证据（可复现）

| 项 | 命令 | 结果 | 日志/产物 |
|---|---|---|---|
| 全量回归 | `npm run verify` | **840/840**，`CHECK OK (38)` | `logs/full-verify.log` |
| 社区组件/工具/Skill 单元与集成测试 | `node --test scripts/registry/test/*.test.js` | **31/31** | `logs/registry-tests.log` |
| Host 全量测试 | `node --test packages/host/test/index.js` | **156/156** | `logs/host-tests.log` |
| 构建确定性 | `npm run build` ×2 + sha256 列表比较 | 4 游戏 + client + 随包 registry 全部一致 | `logs/build-determinism.log` |
| 内容仓库初始化/校验 CLI | `init-content-repo.mjs` → `validate-catalog.mjs` | 初始化成功、空目录合法 | `logs/init-content-repo.log`、`logs/validate-content-repo.log`、`artifacts/content-repo-init/` |
| 可移植生成工程 | Vanilla + React `create → build → validate → pack → validate(packed)` | 均通过；生成 config 不含机器相关 CLI 路径，使用 `DSH_GAME_CLI` | `logs/portable-templates.log`、`logs/react-template.log` |
| Skill 分发归档 | `node scripts/registry/pack-skill.mjs --out …` | 5,948 bytes，sha256 `a9cef3de…`，manifest 文件哈希齐全 | `artifacts/dsh-game-developer-1.0.0.tar.gz`、`artifacts/manifest.json`、`logs/skill-pack.log` |

测试日志中的 `tests` 计数是 Node test runner 的真实输出；没有把模拟写成公网成功。

## 2. 验收项映射（C-01..C-22）

| 编号 | 本地状态 | 证据/说明 |
|---|---|---|
| C-01 外部开发者入门 | 通过（本地） | Vanilla + React 真实 `create → (npm install) → build → validate → pack → validate(packed)` 通过；生成工程可移植（`DSH_GAME_CLI`），见 `logs/portable-templates.log`；Skill 独立评估见 §4 |
| C-02 投稿完整性 | 通过（本地） | `validateSubmission` 字段级错误测试；无效/缺失字段拒绝 |
| C-03 包与目录检查 | 通过（本地） | shared validator + catalog/my-game 测试；README 明确拒绝规则 |
| C-04 预演 | 通过（本地） | `prepare` dry-run 测试断言 0 次 GitHub/git mutation、文件快照不变 |
| C-05 人工批准绑定 | 通过（本地） | 改包/改封面/改截图后 review 失败测试 |
| C-06 正式上架 | **受控公网通过** | 内容仓库 PR #3/#4 完成 1.0.0 / 1.0.1 上架；真实外部作者生产流程待验收，见 `m4-public-loop.md` |
| C-07 版本隔离 | 通过（本地） | tag `${id}-v${version}`；同版本不同字节 `E_PUBLISH_VERSION_IMMUTABLE`；1.0.0→1.0.1 发布测试生成两个版本资产、owner 不变；CI 禁用同版本覆盖 |
| C-08 失败重试 | 通过（本地） | upload failure 不改目录/不建 PR；public verify failure/PR failure 可重试且只建一个 PR；draft/分支复用 |
| C-09 并发 | 部分 | 多游戏 catalog 并存与撤下测试；同分支重试/单 PR 测试；真实并发 PR 需 M4 |
| C-10 冷启动离线 | 通过（本地） | `official fetch 503/invalid` → seed，安装 Jump 成功，不写 remote cache |
| C-11 线上与缓存 | 部分 | 官方 fresh 包安装测试、invalid fallback；stale/expired/304 由既有 Registry 测试覆盖；受控公网安装已完成；真实生产环境待验收 |
| C-12 配置兼容 | 通过（本地） | 显式 env/config/file 既有测试保持；默认才走 layered |
| C-13 元数据展示 | 部分 | catalog 生成 index 保留 cover/screenshots；真实 UI 刷新待 M4 |
| C-14 更新保留数据 | 部分 | 既有安装/更新测试；发布工具公网 1.0.1 已执行；真实 Host 更新/数据保留仍待验收 |
| C-15 撤下语义 | 通过（受控公网） | 内容仓库 PR #5 撤下后索引为空、owner/review 保留；真实缓存/已安装行为仍待验收 |
| C-16 权限边界 | 部分 | 工具只调用参数数组；不打印 token；内容仓库 CI 只读/固定 commit；真实权限矩阵待 M4 |
| C-17 首发全量回归 | 通过 | `npm run verify` 840/840；四款游戏/安装/更新既有测试不回归 |
| C-18 开发包呈现 | 通过（文档/模板） | 全出血/112px/96×96 写入 Skill references + 模板；浏览器实测在之前 V1.1 证据 |
| C-19 Skill 可获取 | 通过（本地） | 目录 + 确定性归档 + manifest + VERSION；`skill.test.js`；React/Node 工具获取路径见 `docs/community-submission.md` |
| C-20 Skill 实际开发 | 通过（独立评估） | 独立 AI 仅凭 Skill 产出 Ember Drift 1.0.0（156,912 bytes, sha256 `f882e1…`）+ submission/report/media；浏览器 QA 与提交材料见 `skill-evaluation.md` 与 `artifacts/skill-eval/` |
| C-21 Skill 纠错/证据 | 通过（独立评估） | 两个独立非法包（重复 manifest `GM-4221`、外链脚本 `GM-4225`）被真实 CLI 拒绝，按 Skill 修复后 build/validate/pack/sha 全部通过；见 `skill-evaluation-c21-c22.md` 与 `artifacts/skill-eval/c21-c22/` |
| C-22 Skill 更新/权限 | 通过（独立模拟） | 独立 AI 完成 1.0.1 更新并注入 1.0.0 save 验证 Continue/score/lives/saveVersion；为本地模拟，真实 DSH App 更新/存档仍待验收；Skill 不授予发布权限 |

## 3. 受控 M4 结果与剩余验收

1. `heswy/dsh-game-registry` 内容仓库、main/tag 保护、必需 CI、不可变 Release 与 CODEOWNERS 已配置；详情见 [`external-content-repo.md`](./external-content-repo.md)。
2. 受控真实投稿→1.0.0→1.0.1→撤下已完成（内容仓库 PR #3/#4/#5 全部绿色合并），最终为空索引，owner/review 审计保留；见 [`m4-public-loop.md`](./m4-public-loop.md)。
3. 独立 Host 从固定公开目录快照安装/启动成功，包与 `x-entry-sha256` 一致；Release 重定向 `release-assets.githubusercontent.com` 已精确加入 allowlist。两份脱敏网络日志已纳入 Git，并由 `check` 检查。
4. 仍待验收：真实外部作者/维护者生产流程、真实 DSH App 安装/持久化/更新分发、完整 120 秒流程、跨机 save、Host GM-4006 独立安装拒绝路径，以及目标 AI 宿主的 Skill 安装/调用。
5. 平台发版后，内容仓库 toolchain pin 需通过独立 PR 从 `2b45b2e` 提升到新发布提交；本次平台 tag 不自动完成该步骤。

受控 M4 已超出 mock 范围，但不代表全部生产与桌面验收完成。合法空官方目录保持 authoritative；仅无可用官方快照时使用 seed。

## 3.5 CR4 复核修复（PR #4 review）

| 编号 | 问题 | 修复 | 回归 |
|---|---|---|---|
| CR4-01 | 完整目录校验发生在 Release 发布之后 | `prepare` 先在临时目录生成并校验完整候选目录（含历史基线），通过后才允许远端写入；commit 前失败会回滚文件、Git index 与临时分支，回滚失败显式报 `E_PUBLISH_ROLLBACK_FAILED`（Git helper 非零状态会抛异常，调用方不忽略）；程序化测试通过 `historyBaseDir` 指定基线（CLI 无 `--history-base` 参数） | `prepare.test.js`：dry-run 历史冲突零 GitHub 调用；真实 Git 仓库 pre-commit hook 拒绝后 status 干净、分支删除、可直接重试；回滚失败显式报错；真实 Git ref lock 冲突返回 `E_PUBLISH_ROLLBACK_FAILED` 并指出残留分支 |
| CR4-02 | 恢复 draft 只检查文件名 | 发布前用认证接口读取 draft 附件字节并核对大小/SHA；不匹配保持 draft 并拒绝；上传后发布前再次认证校验完整性 | 新增 mismatched draft 资产测试；draft 完整性校验 |
| CR4-03 | 目录 CI 不校验历史约束 | 新增 `validateAgainstBase`：版本只能递增、同版本 release/source/author/publishedAt 不可变、owner 不可替换、历史 review 不可改写；**撤下后仍独立遍历基线全部 owners/reviews 保护审计，撤下 ID 重新上架必须同 owner 且版本高于已审核版本**；CI checkout PR base 并传 `--base-dir`；恢复分支必须基于最新 origin/main | `catalog.test.js` 回退/owner/review/撤下 + 撤下后删除/改写审计与重新上架版本测试；`prepare.test.js` stale resume |
| CR4-04 | 合法空官方目录错误触发 seed | 官方快照成功加载（含空数组）即 authoritative；`refresh` 空目录成功不再报错 | Host 新增“空官方目录不显示 seed”测试 |
| CR4-05 | seed 已加载但首屏等待官方初始化 | 启动先加载 seed，官方后台刷新（最多 250ms settle）；`localReady` 保证列表/安装立即可用；官方完成后自动切换 | Host 新增“官方挂起时列表/seed 安装可用”测试 |
| CR4-06 | 发布校验与 Host 非法 UTF-8 处理不一致 | `validatePackageBytes` 使用 fatal UTF-8 解码，非法字节返回 `E_PUBLISH_PACKAGE_UTF8` | 新增 `0xff` 包拒绝测试 |

详见 [`review-cr4.md`](./review-cr4.md)。

## 4. Skill 独立评估

- 输入、产物路径、包摘要、浏览器 QA 见 [`skill-evaluation.md`](./skill-evaluation.md)；
- 游戏包/QA JSON/截图归档在 `artifacts/skill-eval/`；
- 独立评估在 `/tmp` 的仓库外目录完成，未修改平台仓库、未执行发布；
- C-21/C-22 独立评估已完成：见 [`skill-evaluation-c21-c22.md`](./skill-evaluation-c21-c22.md)；
  仍为本地/模拟证据，真实 Host 安装与完整 120 秒流程待补。
