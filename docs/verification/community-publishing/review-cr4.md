# PR #4 CR4-01..06 复核修复记录

> 2026-10-19 最终状态：Codex 在 `c93a85a` 复核通过，CR4-01～06 全关闭；用户授权后 PR #4 已以 `2b45b2ec004fa622f9d4567b65d4b978a13a4e90` 合入 main。固定 head 独立复跑 verify 835/835、CHECK OK (37)、registry 28/28；真实 ref lock 复现正确报告回滚失败。合并提交与验收 head 文件树一致。未发布、未打新 tag；M4 与下列真实环境边界继续待验收。

复核基线：`2b5e1ed`；本轮修复分支 `feat/community-publishing`（提交见 PR #4）。

| 编号 | 级别 | 复现要点 | 修复证据 |
|---|---|---|---|
| CR4-01 | P1 | 非法候选目录在 Release 发布后才被拒绝，且本地目录已被写入 | `scripts/registry/lib/prepare.mjs`：`stageCandidate()` 在临时副本生成/校验完整 catalog + index + 历史基线，dry-run 与 execute 都先执行；通过后才 upload/publish；commit 前失败回滚文件 + Git index + 临时分支，回滚失败显式抛出 `E_PUBLISH_ROLLBACK_FAILED`；`resetPaths`/`deleteBranch` 非零退出即抛异常，不会被返回值静默吞掉。测试：`dry run rejects...`、真实 Git pre-commit hook 拒绝后可干净重试、真实 branch-ref lock 冲突返回 `E_PUBLISH_ROLLBACK_FAILED`、fake adapter 回滚失败显式报告 |
| CR4-02 | P1 | 恢复 draft 仅按文件名跳过上传，错误字节先 publish 后被公开校验发现 | `inspectDraftAssets()`：认证接口下载已有附件并核对 size/sha；不匹配抛 `E_PUBLISH_DRAFT_ASSET_MISMATCH` 且不 publish；上传完成后、publish 前再次 `requireAll` 校验完整性。测试：`a resumed draft with mismatched asset bytes is never published` |
| CR4-03 | P1 | 目录 CI 只看当前快照，可回退版本/换 owner/改历史 review | `validateAgainstBase()` + `validate-catalog --base-dir`：版本递增、同版本 release/source/author/publishedAt 不变、owner 不变、历史 review 不变；**撤下后仍独立遍历基线全部 owners/reviews**，删除/改写审计记录即失败；撤下 ID 重新上架必须同 owner 且版本高于已审核版本；模板 CI checkout PR base sha 后传入；`prepare --execute` 总是 fetch 并 materialize 最新 `origin/main` 作为基线，恢复旧分支时要求基于最新 base。测试：`catalog.test.js` 历史/撤下连续操作用例 + `prepare.test.js` stale resume |
| CR4-04 | P1 | fresh 但空官方目录被当成失败，回退 seed，撤下全部无法生效 | `registry-layered.js`：官方快照 state fresh/stale/offline 即 authoritative（与 count 无关）；`refresh` 成功空目录不再抛错。测试：`a valid empty official index is authoritative and does not fall back to seed` |
| CR4-05 | P2 | 官方请求挂起时，seed 已就绪但首屏仍等待 | 启动先 await seed，官方后台刷新（settle 上限 250ms）；新增 `localReady()`，`games.buildAll()` 先等待本地内容。测试：`bundled seed serves list/install while the official request hangs` |
| CR4-06 | P2 | HTML 注释中的 `0xff` 通过发布校验，但 Host fatal UTF-8 会拒绝 | `validatePackageBytes()` 改为 `TextDecoder('utf-8',{fatal:true})`，失败返回 `E_PUBLISH_PACKAGE_UTF8`。测试：`invalid UTF-8 package bytes are rejected by publishing validation` |

## 回归结果

- `npm run verify`：835/835，`CHECK OK (37)`（`logs/full-verify.log`）
- registry 工具/契约/历史测试：28/28（`logs/registry-tests.log`）
- Host 全量：155/155（`logs/host-tests.log`）
- 构建确定性：client + 4 games + 随包 registry 字节一致（`logs/build-determinism.log`）

## 独立评估与剩余边界

- C-21/C-22 已由独立评估补齐：见 [`skill-evaluation-c21-c22.md`](./skill-evaluation-c21-c22.md)
- 仍未验证：真实 Host 安装/持久化、完整真实 120 秒流程、Host GM-4006 独立安装路径运行证据、跨机 save 传输
- M4 外部配置：真实内容仓库、GitHub 权限、公网资产、投稿→更新→撤下闭环
