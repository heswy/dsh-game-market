# M3 验证夹具（V1）

> 由 `node scripts/verification/make-fixtures.mjs` 生成；`packages/*.html` 是构建产物副本，
> 用于离线/HTTPS Registry 安装与更新验证。不要手改，重新生成即可。

| 文件 | 用途 | 关联用例 |
|---|---|---|
| `registry-file.json` | 本地 file Registry：jump/2048/breakout（+ DEV-01 的 my-game） | AE-10、DEV-05、U-03 |
| `registry-file-update.json` | jump 1.0.1 更新版本 | AE-10、U-10 |
| `registry-https.json` | HTTPS Registry（raw.githubusercontent.com，指向本目录 `packages/`） | AE-11 |
| `registry-badsha.json` | sha256 不匹配 | AE-12、FM-03、SEC-06 |
| `registry-badhtml.json` | 包内容不是合法单文件包 | AE-12、FM-04/05 |
| `packages/` | 注册表引用的包副本（含 jump-1.0.1 更新包、DEV-01 my-game） | 同上 |
| `malicious/` | `install-local` 拒绝矩阵：缺/双 manifest、外部子资源、非法 capability、旧字段、路径穿越 id | AE-12、DEV-06、SEC-05 |

注意：

1. `registry-https.json` 的包 URL 指向本仓库 `main` 分支 raw 地址，**必须先提交并推送**才能被 Host 拉取。
2. `packages/` 与构建产物保持一致；构建变化后重新生成并提交。
3. Registry schema 要求 `cover` 为绝对 https URL；fixture 复用 `docs/verification/v0/market.png`。
