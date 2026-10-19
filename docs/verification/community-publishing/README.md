# 社区投稿与 GitHub 上架 MVP · 验证记录

基线：`main@c106ac1`（v1.1.0）→ 分支 `feat/community-publishing`。
方案：`docs/plans/2026-10-19-community-publishing-mvp.md`；契约：
`docs/community-publishing-contracts.md`。

## 1. 本轮本地证据（可复现）

| 项 | 命令 | 结果 | 日志/产物 |
|---|---|---|---|
| 全量回归 | `npm run verify` | **821/821**，`CHECK OK (37)` | `logs/full-verify.log` |
| 社区组件/工具/Skill 单元与集成测试 | `node --test scripts/registry/test/*.test.js` | **18/18** | `logs/registry-tests.log` |
| Host 默认源分层测试 | `node --test packages/host/test/index.js --test-name-pattern=layered` | 153/153（pattern 过滤后仍全量执行文件） | `logs/host-layered.log` |
| 构建确定性 | `npm run build` ×2 + sha256 列表比较 | 4 游戏 + client + 随包 registry 全部一致 | `logs/build-determinism.log` |
| 内容仓库初始化/校验 CLI | `init-content-repo.mjs` → `validate-catalog.mjs` | 初始化成功、空目录合法 | `logs/init-content-repo.log`、`logs/validate-content-repo.log`、`artifacts/content-repo-init/` |
| 可移植生成工程 | Vanilla + React `create → build → validate → pack → validate(packed)` | 均通过；生成 config 不含机器相关 CLI 路径，使用 `DSH_GAME_CLI` | `logs/portable-templates.log`、`logs/react-template.log` |
| Skill 分发归档 | `node scripts/registry/pack-skill.mjs --out …` | 5,435 bytes，sha256 `5069aed5…`，manifest 文件哈希齐全 | `artifacts/dsh-game-developer-1.0.0.tar.gz`、`artifacts/manifest.json`、`logs/skill-pack.log` |

测试日志中的 `tests` 计数是 Node test runner 的真实输出；没有把模拟写成公网成功。

## 2. 验收项映射（C-01..C-22）

| 编号 | 本地状态 | 证据/说明 |
|---|---|---|
| C-01 外部开发者入门 | 通过（本地） | Vanilla + React 真实 `create → (npm install) → build → validate → pack → validate(packed)` 通过；生成工程可移植（`DSH_GAME_CLI`），见 `logs/portable-templates.log`；Skill 独立评估见 §4 |
| C-02 投稿完整性 | 通过（本地） | `validateSubmission` 字段级错误测试；无效/缺失字段拒绝 |
| C-03 包与目录检查 | 通过（本地） | shared validator + catalog/my-game 测试；README 明确拒绝规则 |
| C-04 预演 | 通过（本地） | `prepare` dry-run 测试断言 0 次 GitHub/git mutation、文件快照不变 |
| C-05 人工批准绑定 | 通过（本地） | 改包/改封面/改截图后 review 失败测试 |
| C-06 正式上架 | **模拟通过，真实待 M4** | fake GitHub adapter：draft→upload→publish→public verify→catalog→PR；未在真实内容仓库执行 |
| C-07 版本隔离 | 通过（本地） | tag `${id}-v${version}`；同版本不同字节 `E_PUBLISH_VERSION_IMMUTABLE`；1.0.0→1.0.1 发布测试生成两个版本资产、owner 不变；CI 禁用同版本覆盖 |
| C-08 失败重试 | 通过（本地） | upload failure 不改目录/不建 PR；public verify failure/PR failure 可重试且只建一个 PR；draft/分支复用 |
| C-09 并发 | 部分 | 多游戏 catalog 并存与撤下测试；同分支重试/单 PR 测试；真实并发 PR 需 M4 |
| C-10 冷启动离线 | 通过（本地） | `official fetch 503/invalid` → seed，安装 Jump 成功，不写 remote cache |
| C-11 线上与缓存 | 部分 | 官方 fresh 包安装测试、invalid fallback；stale/expired/304 由既有 Registry 测试覆盖；真实公网待 M4 |
| C-12 配置兼容 | 通过（本地） | 显式 env/config/file 既有测试保持；默认才走 layered |
| C-13 元数据展示 | 部分 | catalog 生成 index 保留 cover/screenshots；真实 UI 刷新待 M4 |
| C-14 更新保留数据 | 部分 | 既有安装/更新测试；发布工具 1.0.1 流程未真实执行 |
| C-15 撤下语义 | 通过（本地 catalog） | 删除 catalog 条目后生成索引移除，owner/review 保留；真实缓存/已安装行为待 M4 |
| C-16 权限边界 | 部分 | 工具只调用参数数组；不打印 token；内容仓库 CI 只读/固定 commit；真实权限矩阵待 M4 |
| C-17 首发全量回归 | 通过 | `npm run verify` 819/819；四款游戏/安装/更新既有测试不回归 |
| C-18 开发包呈现 | 通过（文档/模板） | 全出血/112px/96×96 写入 Skill references + 模板；浏览器实测在之前 V1.1 证据 |
| C-19 Skill 可获取 | 通过（本地） | 目录 + 确定性归档 + manifest + VERSION；`skill.test.js`；React/Node 工具获取路径见 `docs/community-submission.md` |
| C-20 Skill 实际开发 | 通过（独立评估） | 独立 AI 仅凭 Skill 产出 Ember Drift 1.0.0（156,912 bytes, sha256 `f882e1…`）+ submission/report/media；浏览器 QA 与提交材料见 `skill-evaluation.md` 与 `artifacts/skill-eval/` |
| C-21 Skill 纠错/证据 | 部分 | 真实 QA/错误记录已归档；提交草稿/待补字段已通过新的 draft 契约验证；独立评估未覆盖“非法包输入→修复重验”专项，待补 |
| C-22 Skill 更新/权限 | 部分 | 平台发布工具 1.0.0→1.0.1 测试通过；独立 AI update 评估未覆盖；Skill 明确不授予发布权限；evaluator 报告已归档 |

## 3. 外部待配置（M4，无法由本会话完成）

1. 创建/指定内容仓库 `owner/name`（建议 `heswy/dsh-game-registry`，**尚未建立**）；
2. 设置 main 分支保护/必需 CI、维护者 `gh` 权限、不可变 Release 策略；
3. 发布真实公网 `registry/games.json`、正式包与封面，并验证默认 URL；
4. 验证 GitHub Release 实际重定向域名在 Host allowlist（不在则精确 host + 拒绝测试）；
5. 真实完成一次非首发投稿（Skill 指导）、1.0.0 发布、1.0.1 更新、撤下目录
   的完整公网闭环；
6. 真实 Skill 安装/调用方式按目标 AI 宿主验证。

在 1–6 完成前，默认 remote 不可达时 Host 使用随包 seed，Market 不白屏；上架工具只
以 mock GitHub/HTTP 验证，不能宣称已真实上线。

## 4. Skill 独立评估

- 输入、产物路径、包摘要、浏览器 QA 见 [`skill-evaluation.md`](./skill-evaluation.md)；
- 游戏包/QA JSON/截图归档在 `artifacts/skill-eval/`；
- 独立评估在 `/tmp` 的仓库外目录完成，未修改平台仓库、未执行发布；
- 未覆盖：C-21 非法包输入→修复重验、C-22 独立 AI 1.0.1 更新/权限边界；这两项
  仍需补一次独立评估，不能用平台单测替代。
