# platform-updates — 平台插件发布入口（维护者）

本目录有两个**语义完全不同**的 JSON 文件：

| 文件 | 性质 | 谁产生 | 是否可变 |
|---|---|---|---|
| `release.json` | 包内**发布身份**（不可变安装目标 R 的一部分） | `npm run release:prepare --write` 自动生成 | 随每个 release commit 一次性写入；禁止手改 |
| `plugins.json` | DSH 官方插件索引（**可变发现入口**，plugin-market-index 格式 1） | `npm run release:promote --write --out platform-updates/plugins.json --production-index` 生成后由维护者在**独立 commit/PR I** 提交 | 可变（每次推广新版本更新），但必须独立于 release commit |

- `release.json` 声明 `clientBuildCommit = P`（构建产物所基于的版本提交），让安装后的 Client/Host 能互相核验身份；它**不包含**自身所在 release commit 的哈希（文件无法自引用）。
- `plugins.json` 把插件 `dsh-game-market` 精确钉到一个完整 40 位 commit R；绝不能把索引写进 R 本身（工具会拒绝，`scripts/check.mjs` 也会校验）。
- 本 M3 轮次**不提交** `plugins.json`：该文件不存在是预期状态（固定官方索引 URL 此时不可用/离线，不阻塞游戏与市场）。
- 生成/校验/回滚流程见 `docs/plugin-update-release.md`。
