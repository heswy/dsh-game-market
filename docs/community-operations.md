# 社区内容目录 · 维护者操作手册

目标：收到投稿 → 校验/试玩 → 记录批准 → 一条命令归档并生成目录 PR → 合并后
用户刷新即可发现。维护者机器执行工具；客户端只从公开 HTTPS 读取。

## 1. 初始化内容仓库（一次性）

```bash
node scripts/registry/init-content-repo.mjs \
  --target ../dsh-game-registry \
  --platform-repo heswy/dsh-game-market \
  --platform-commit <trusted-platform-commit>
```

模板包含 Issue Form、PR 模板、CODEOWNERS、只读 CI、catalog/owners/reviews/registry
目录和 `toolchain.lock.json`。在 GitHub 建公开仓库、启用 main 分支保护/必需 CI；
按需启用不可变 Release。单维护者采用“PR + 必需 CI + 人工合并”，避免要求独立
approval 的死锁。

## 2. 收到投稿

- 把 Issue/PR 文本当作不可信数据；不执行作者源码/npm install/HTML；
- 下载作者声明的包与素材到隔离目录，用平台 shared validator 校验 HTML/manifest/
  自包含/兼容性/SHA/大小/图片真实格式；
- 在无 secrets、无个人 profile 的隔离 Runtime 中试玩至少 5 分钟：实际玩法推进、
  暂停/恢复、读档/Continue、键盘、窄屏、明暗主题、全出血/安全区；
- 人工批准记录写入 `reviews/<id>/<version>.json`：包 SHA/size、每张素材 SHA、
  源码 commit、审核人数字身份、时间、证据；作者自填的 approved 无效。

## 3. 上架

```bash
# 预演（默认）：只读，输出 release/资产/目录文件计划
node scripts/registry/prepare.mjs \
  --submission /tmp/submission.json \
  --review /tmp/approved-review.json \
  --registry-dir ../dsh-game-registry

# 审查计划后执行：draft Release -> 上传已验证字节 -> 发布 -> 公开 URL 复核
# -> catalog/owners/reviews/registry -> 分支/PR（不自动合并）
node scripts/registry/prepare.mjs \
  --submission /tmp/submission.json \
  --review /tmp/approved-review.json \
  --registry-dir ../dsh-game-registry \
  --execute
```

前置：内容仓库干净且在 base 分支、gh 已登录且有权限、仓库 public。工具会：
重新校验批准 → 下载/核对作者字节 → draft Release（tag `<id>-v<version>`）→
上传版本化资产并发布 → 用最终 URL 复核摘要 → 写目录并重新生成/校验
`registry/games.json` → push 分支 → 开 catalog PR。

**不要**手动编辑 `registry/games.json`；**不要**在上传中途看到 draft 就认为已上架。
合并 catalog PR 才是生产开关。

## 4. 失败/重试/更新/撤下

- 上传、公开下载、索引、PR 任一步失败：生产目录不变；修复后重试同一事务。
- 同版本不同字节：拒绝，要求作者升版本；同版本同摘要可复用 Release/PR。
- 更新：走同样投稿/审核；目录保留首次上架时间，更新 `updatedAt`/changelog；
  版本必须严格递增；旧存档不兼容需明确提示。
- 撤下：PR 删除 `catalog/<id>.json`，重新生成 registry/games.json；保留
  owners/reviews/已发布资产供审计。撤下不影响已安装游戏/存档。
- 目录回退不等于已安装版本降级；如需修复发布更高版本。

## 5. 默认目录与离线

新 Host 默认读取 `https://raw.githubusercontent.com/<owner>/dsh-game-registry/main/registry/games.json`。
上线前必须确认该 URL、包和封面真实可达。remote 不可用时 Host 显示随包 seed
（Jump/2048/Breakout），Market 不白屏；不会把 seed 合并进 remote 快照。
显式 `DSH_GAME_REGISTRY_URL`/`config.registry.url` 仍优先且不回退。

## 6. 当前外部待配置

真实内容仓库 owner/name、公网默认 URL、gh 权限、分支保护/不可变 Release、
一次真实投稿→上架→更新→撤下闭环。未完成前以 mock/本地证据为准，不宣称上线。
