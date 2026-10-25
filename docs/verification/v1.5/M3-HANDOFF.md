# M3 交接（2026-10-25）

分支 `feat/v1.5-platform-update`，worktree：`dsh-game-market-worktrees/v1.5-platform-update`。
审计依据：`docs/reviews/2026-10-21-m3-progress-audit.md`（在主目录，未入库）。

## 1. 一句话状态

**3 个 P1 已修并提交，门禁全绿；端到端（真实 DSH + 浏览器）验证一次都还没在新候选上跑通。M3 未收口，不能合并。**

## 2. 已完成（读代码 / 跑测试确认）

| 项 | 结果 | 提交 |
|---|---|---|
| AUD-01 恢复记录写失败仍安装 | `persistCritical` 失败即抛 `GM.STORE_IO`，释放锁与屏障，`installBundle` 调用 0 次 | `4ab04df` |
| AUD-02 保存失败后 paused 被当作已保存 | Runtime 按 launch generation 维护 `saveStale`，再次 pause 做真实保存；Client 要求 `saveStale === false` | `4ab04df` |
| AUD-03 盘点后无准入屏障 | 新增 `packages/host/src/update-admission.js`（82 行），入口拦 launch/resume，协调后与关键写入后重新枚举 | `4ab04df` |
| 发布工具 4 个失败用例 | 根因是测试夹具构造的篡改提交是悬空的，先撞上可达性检查。夹具现在给篡改提交建分支引用；"非直接子提交"用例改为 P 仍是祖先但不是第一父 | `77e27b7` |
| 完整门禁 | `npm run verify`：1531 tests / 1527 pass / 0 fail / 4 skipped，`CHECK OK (44 checks)` | 提交 `77e27b7` 前跑的 |
| 验证脚本入库 | 串行 runner、同 profile 两跳 runner、`check-runners.mjs`、`network-env.mjs` | `6e65d7c` |

注：`verify` 是在 `77e27b7` 之后、候选提交之前跑的。候选只改了 `package.json`/`package-lock.json`/`client.js`/`platform-updates/release.json`，未重跑 verify。

## 3. 新候选（含 P1 修复，已推送到 origin）

| 角色 | 版本 | R（安装目标） | P（版本提交） |
|---|---|---|---|
| A | 1.2.1 | `8fdd599a67b4c344d75b65d47801cd4ef8a4b6ec` | `dad8cf7a9d4a65c1c956b3ebce9fe7b156d24cdc` |
| B | 1.2.2 | `0ba9f5006fa874c7e98d0238ccb04804183b4ce2` | `1d76e8ed5aa93e9fa4d7f15864ec8f275e8dbd7c` |
| final | 1.3.0 | `a9d94a2486746a44163b990389aae789eb207e84` | `3a341bede2d967a0eef30c56ab57b7e5a54e8239` |

- 生成方式：每个版本 `staging` 提交（改 version、删 `release.json`、`npm run build`）+ `npm run release:prepare -- --version X --write`。A 的 dry-run 确认 4 次构建字节一致、产物 93 文件。
- 已 `git push origin feat/v1.5-platform-update`（快进 `b0a35ca..a9d94a2`，经用户确认）。
- **旧候选 A2/B4/R_final7 不含 P1 修复**，不能用来证明修复；runner 的默认值仍指向它们，运行时必须显式传 `--a --b --final`。
- 没有打 tag、没有写生产索引 `plugins.json`、没有开 PR、没有合并。

## 4. 未完成

1. **同一 profile 的 A→B→C 连续更新（AUD-04）**：`run-v1-two-hop.mjs` 已写好，未在新候选上跑通。
2. 多窗口 41/42 仍是 FAIL，需要等权威状态后重采，不能改断言。
3. V2：保存失败阻断、响应丢失恢复、取消、边界。
4. 非 HMR 重启链路在新候选上的复跑。
5. 文档收尾：`docs/verification/v1.5/plugin-update-m3.md` 中旧的 not-run / 已完成矛盾语句、`PROJECT_MEMORY.md` 工作日志、V1-xx 条目。
6. 最终 PR head 重跑 `npm run verify`，再开 draft PR（不合并、不发布）。

## 5. 卡在哪：验证环境（本轮的主要时间损耗）

在新候选上跑 `run-m3-serial.mjs --scenarios smoke`，**两种网络模式都失败，且都不是产品缺陷**：

- **mirror 模式**：`/tmp/m3-mirror.git`、`/tmp/m3-mirror-gitconfig` 与 pnpm 离线预热 store 已被清掉。我重建了 bare mirror 和 gitconfig（commit 可 `ls-remote`、可按 SHA 取），但 pnpm 仍报 `ERR_PNPM_NO_OFFLINE_TARBALL`——它走 codeload tarball 路径，离线 store 里没有这些 commit。没有找到当初预热 store 的脚本。
- **real-github 模式**：`fixture.mjs` 里 `PINNED_RESOLVES` 把 `codeload.github.com` 钉到 `140.82.112.3`，该 IP 对 tarball 返回 404（`ERR_PNPM_FETCH_404`）。用本机代理 `127.0.0.1:7897` 直接 curl 同一 tarball 是 200（仓库为 PUBLIC）。
- 我给 `fixture.mjs` 加了开关 `M3_PREFER_PROXY=1`：隧道优先走上游代理（`DEFAULT_UPSTREAM_PROXY`，已核对默认值就是 `http://127.0.0.1:7897`）。该改动已提交，**但带此开关的 smoke 在被叫停时才刚启动，结果未知**。

继续时先验证这一点：

```bash
cd dsh-game-market-worktrees/v1.5-platform-update
rm -f /tmp/dsh-v15/m3/m3-serial.lock
M3_PREFER_PROXY=1 node scripts/verification/v1.5/m3/run-m3-serial.mjs --mode real-github \
  --a 8fdd599a67b4c344d75b65d47801cd4ef8a4b6ec --b 0ba9f5006fa874c7e98d0238ccb04804183b4ce2 \
  --final a9d94a2486746a44163b990389aae789eb207e84 --scenarios smoke
```

smoke 通过后再依次跑 `two-hop`、`nonhmr`、`v2-windows`、`v2-save`、`v2-edges`（单 run 串行，不要并发，不要在运行中改 harness，改完先 `node scripts/verification/v1.5/m3/check-runners.mjs`）。

## 6. 注意事项

- `docs/verification/v1.5/raw/m3/M3-v1-preflight-2026-10-25T03-27-39-891Z.json` 是 mirror 不可用时的**失败**记录（untracked，未入库）。可删，或在最终证据里作为环境失败说明，不要当通过证据。
- smoke 运行在 "required 失败后" 时 serial driver 会挂住不退出，需要手动 `pkill -f run-m3-serial.mjs` 并清理 `/tmp/dsh-v15/m3/m3-serial.lock`；这是 harness 的小缺陷，未修。
- 隔离 DSH 进程路径带 `/tmp/dsh-v15/m3/`；清理只杀这一类，不要 broad `pkill chrome`。
- 已知残余限制（契约 §17.6）：屏障只在单个 Host 进程内有效；已确认实例被用户在 Client 侧恢复而不产生新 launch/report 时 Host 感知不到；实例关闭无事件订阅。
- 与 npm 渠道的讨论结论：本轮继续用 Git commit target。DSH master 在 2026-10-19 合入了 `updateBundle`/`listVersions`，但 `0.2.1-rc.2`、`0.2.1-rc.3` 及本机 App 均不含；发布后再评估是否加 npm 渠道，保存协调与 operation 恢复与渠道无关。
