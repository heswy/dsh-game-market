# `dsh-game` CLI 参考（V1 / M1b）

零第三方依赖、Node ≥20、完全离线。入口：

```bash
node scripts/cli/dsh-game.mjs <command> [options]
node scripts/cli/create-dsh-game.mjs <id> [options]   # = dsh-game create
```

生成工程内的 `npm run build|validate|pack|publish|dev` 只是对上述入口的薄包装；
CLI 路径记录在 `dsh-game.config.json.cli`，可用 `DSH_GAME_CLI` 覆盖。

> 根 `package.json` 的 `bin`（`npx dsh-game` / `npx create-dsh-game`）由 Lead 维护，
> 本分支未修改。MVP 请直接使用 `node scripts/cli/...`；在 DSH 仓库外的工程中，
> 把 `DSH_GAME_CLI` 指向本仓库的 `scripts/cli/dsh-game.mjs` 即可。

## 退出码

| 码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 校验 / 兼容性 / 作者可修复的构建错误 |
| `2` | 用法或配置错误（参数、缺失文件、端口占用、非空目录…） |
| `3` | 内部错误（IO 或未预期异常） |
| `4` | 网络 / Registry 错误（V1 只有 Host 安装流程使用；CLI 不产生） |

所有命令支持 `--help`；`--json` 把机器可读结果写到 stdout（错误也保持 JSON），
人类可读输出在 `--quiet` 下静默（错误仍然输出）。

---

## `create` / `init`

```bash
node scripts/cli/create-dsh-game.mjs my-game --template vanilla
node scripts/cli/create-dsh-game.mjs my-game --template react --dir ~/games
```

| 选项 | 说明 |
|---|---|
| `--template <vanilla\|react>` | 默认 `vanilla` |
| `--dir <parent>` | 父目录；目标为 `<parent>/<id>`，默认当前目录 |
| `--name <display name>` | 展示名；默认由 id 推导（`my-game` → `My Game`） |
| `--description <text>` | manifest 描述 |
| `--author <name>` | manifest 作者，默认 `Your Name` |
| `--force` | 允许写入非空目录（不删除其它文件） |
| `--dry-run` | 只打印将生成的文件 |
| `--json` | 输出 `{ok,id,template,targetDir,files,nextSteps,...}` |

行为：

- 校验 id（`^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$`、禁止 `--`、禁止保留字）；
- 复制模板，替换 `__GAME_*__` 占位符；
- 生成 `manifest.json`、`package.json`、`dsh-game.config.json`；
- 复制 SDK 类型到 `sdk/index.d.ts` 与 `sdk/VERSION`；
- React 模板额外生成离线 `vendor/dsh-game-sdk.js`；
- 在 `dsh-game.config.json.cli` 记录相对本仓库 CLI 的路径（使用 realpath，兼容 `/tmp` 符号链接）。

生成工程示例：

```text
my-game/
├── manifest.json
├── index.html
├── dsh-game.config.json
├── src/...
├── scripts/{build,dev,validate,pack,publish}.mjs + cli.mjs
├── sdk/index.d.ts
└── README.md
```

---

## `build`

```bash
node scripts/cli/dsh-game.mjs build [projectDir] [--out dist/index.html] [--no-sdk] [--json]
```

| 选项 | 说明 |
|---|---|
| `[projectDir]` | 默认当前目录 |
| `--out <file>` | 输出文件；默认 `config.out` 或 `dist/index.html` |
| `--no-sdk` | 不注入 SDK（高级：工程自带 runtime bundle） |
| `--json` | `{ok,out,bytes,sha256,manifest,warnings}` |

项目约定（`dsh-game.config.json` 均可覆盖）：

| 配置键 | 默认 | 说明 |
|---|---|---|
| `manifest` | `manifest.json`（回退 `src/manifest.json`） | build-time manifest v1 |
| `template` | `index.html`（回退 `src/index.html`） | HTML 模板 |
| `entry` | — | 当模板没有 `<script src>` 时追加的入口 |
| `out` | `dist/index.html` | 输出路径 |
| `sdk` | `true` | 是否在 `<head>` 注入 SDK |

构建做的事：

1. 校验 `manifest.json` 与版本兼容性（失败退出 1，不写产物）；
2. 注入 `<script type="application/json" id="dsh-game-manifest">`（恰好一处）；
3. 在 `<head>` 注入 `var DSH_GAME_SDK = ...`（zero-dep bundle）；
4. `<link rel="stylesheet">` → `<style>`，CSS `url()` 内联为 `data:`；
5. `<img>/<source>/<audio>/<video>/<track>/<input>` 的 `src` 与 `<link rel="icon">` 的
   `href` 内联为 `data:`；
6. `<script type="module" src>` → 用仓库 bundler 打包后内联（相对导入 + 显式 `.js`，
   仅命名导出）；`</script` 会被转义；
7. 统一 LF、UTF-8 无 BOM、结尾一个换行；
8. 用 `packages/shared/src/manifest.js#validatePackageHtml` 全量复验，失败退出 1。

确定性：固定资源顺序、固定 manifest 键序、无时间戳/随机 id/机器路径/sourcemap；
同一输入两次 build 的字节与 sha256 必须一致（测试覆盖）。

限制/拒绝：

- `srcset` 直接拒绝（避免绕过自包含扫描）；外部 `src`/`href`/`@import`/`<iframe>`/
  `fetch`/XHR/WebSocket/EventSource/sendBeacon/serviceWorker 由最终校验拒绝；
- 不允许 `manifest.json` 之外再手写内嵌 manifest；
- 不支持 TS/JSX 源码经 CLI 构建（React 模板用 Vite 构建，再用 CLI validate/pack/publish）。

---

## `validate`

```bash
node scripts/cli/dsh-game.mjs validate <path> [--json] [--quiet]
```

`<path>` 可以是：

- `dist/index.html` / `dist/<id>-<version>.html` 等单文件；
- 工程目录：**在内存中构建**后校验，不写 `dist/`。

校验内容（`docs/V1-CONTRACTS.md` §4.2）：

- 文件级：≤20 MiB、UTF-8 合法、无 BOM、含 `<html>`；
- 内嵌 manifest：恰好一处、≤64 KiB、JSON 对象；
- manifest v1 全字段/条件字段/警告；
- 自包含扫描（SC-01～SC-05）；
- `sdkVersion` / `runtimeVersion` 范围语法与当前平台兼容（legacy `0.1.x` 放行）；
- 若文件名形如 `<id>-<version>.html`，必须与 manifest 的 id/version 一致
  （`E_INSTALL_VERSION_MISMATCH` → GM-4095）。

人类可读输出：

```text
FAIL  dist/index.html (442 bytes)
  1. E_PKG_CAPABILITY_UNSUPPORTED (GM-4240) capabilities: capability is known but unsupported in V1: network
     hint: This capability is known but disabled in V1. Remove it; …
  warnings (1):
    - W_PKG_IGNORED_FIELD save: save is ignored without the "storage" capability
```

`--json`：

```json
{
  "ok": false,
  "errors": [
    {
      "code": "E_PKG_CAPABILITY_UNSUPPORTED",
      "gm": "GM-4240",
      "path": "capabilities",
      "message": "…",
      "hint": "…",
      "value": "network"
    }
  ],
  "warnings": [
    { "code": "W_PKG_IGNORED_FIELD", "gm": null, "path": "save", "message": "…", "hint": "…" }
  ],
  "truncated": false,
  "manifest": { "id": "demo", "name": "Demo", "version": "1.0.0" },
  "bytes": 442,
  "source": "/abs/path/dist/index.html"
}
```

- 最多 50 条 error / warning，超出 `truncated: true`；
- 同一输入重复执行输出逐字节一致（无耗时字段）；
- `code` 是内部 `E_*`，`gm` 是对外 `GM-*`，`hint` 是作者可执行的修复建议。

退出码：`0` 通过；`1` 校验/兼容失败；`2` 路径缺失/非 `.html`/非目录；`3` 读文件 IO 失败。

---

## `pack`

```bash
node scripts/cli/dsh-game.mjs pack [projectDir|file.html] [--out <dir>] [--input <file>] [--json]
```

- 默认读取 `config.out` / `dist/index.html`；也可传 `dist/index.html` 或已打包文件；
- 先执行完整 `validate`（失败退出 1）；
- 输出 `dist/<id>-<version>.html`（字节完全复制）与
  `dist/<id>-<version>.html.sha256`；
- `.sha256` 为 `shasum -a 256` 兼容格式：

```text
3f9c…（64 位小写 hex）  block-drop-1.2.0.html
```

`--json`：`{ok,id,version,file,digestFile,sha256,bytes,warnings}`。

---

## `publish`

```bash
node scripts/cli/dsh-game.mjs publish [projectDir|file.html] \
  --url <https package URL> \
  --cover <https cover URL> \
  [--registry-dir <dir>] [--file-registry] [--allowed-host <host>]... \
  [--released-at <iso>] [--published-at <iso>] [--updated-at <iso>] \
  [--generated-at <iso>] [--changelog <text>] [--featured] [--quick-play] \
  [--rehash] [--out <dir>] [--json]
```

- 输入必须是已 `pack` 的 `dist/<id>-<version>.html`（自动优先选择该文件）与其
  `.sha256`；缺少 `.sha256` 时用 `--rehash` 重新生成；
- `--url`：
  - 默认必须是**绝对 https**，末段必须 `<id>-<version>.html`，host 必须在 allowlist
    （默认 `github.com` / `raw.githubusercontent.com` / `objects.githubusercontent.com`，
    可用 `--allowed-host` 追加）；
  - `--file-registry` 时使用 Registry 目录内的**相对路径**（本地 file Registry）；
- `--cover` 必须是 https（Registry 预览资源只接受绝对 https URL）；
- 时间戳默认当前 UTC（`YYYY-MM-DDTHH:mm:ssZ`）；测试/复现时显式传入；
- 不联网、不调用任何服务端 API。

输出（默认在包所在目录）：

| 文件 | 内容 |
|---|---|
| `registry-entry.json` | 可直接粘进 `registry/games.json.games[]` 的条目 |
| `upload-plan.md` | 包文件名/大小/sha256/目标 URL、`gh release create` 命令、更新索引步骤 |
| `review-checklist.md` | 自动检查 `[x]` + 人工审核 `[ ]`（版权、自包含、Continue、i18n、明暗主题…） |

`--registry-dir <dir>` 会合并/替换 `<dir>/registry/games.json` 中同 id 条目、按 id 排序、
写入 `generatedAt`，并用共享 `validateRegistry` 校验整份索引后落盘。

`--json`：`{ok,id,version,entry,files,registry,sha256,bytes,dates,warnings}`。

失败：

- 缺 `--url`/`--cover`、URL 协议/host/文件名不合法、`.sha256` 缺失 → 退出 2；
- 包校验失败、sha 不匹配、Registry schema 失败（如 host 不在 allowlist）→ 退出 1。

---

## `dev`（Local Runtime Simulator）

```bash
node scripts/cli/dsh-game.mjs dev [projectDir] [--port 4321] [--host 127.0.0.1] [--no-build]
```

- 默认每次请求 `/game` 都从源码重新构建（改 `src/` 后刷新即可看到）；
- `--no-build` 直接服务已有 `dist/index.html`（React 模板使用 Vite 构建后走这个模式）；
- 只监听 `127.0.0.1`（可覆盖），只提供 `/`、`/game`、`/health`、`/favicon.ico`；
- 模拟器行为见 [developer-guide.md §5](developer-guide.md#5-本地预览--runtime-simulator)；
- 构建失败时 iframe 内显示错误页（不是白屏），并在 stderr 打印校验报告；
- 端口占用 → 退出 2。

模拟的 Runtime 方法：`ready`、`storage.save/load/remove`、`session.start/end`、
`score.submit/getBest`、`agent.getStatus`、`ping`（Runtime→game）；事件：
`init`、`agent-status`、`theme`、`viewport`、`pause`、`resume`、`before-save`。
所有消息都做 `v:1`/source/id 检查，日志同时进入页面与 console。

---

## `dsh-game.config.json` 与离线使用

```json
{
  "manifest": "manifest.json",
  "template": "index.html",
  "entry": "src/main.js",
  "out": "dist/index.html",
  "cli": "../../path/to/dsh-game-market/scripts/cli/dsh-game.mjs",
  "sdk": true
}
```

- `create-dsh-game` 会写入 `cli`（相对工程目录，POSIX 分隔符）；
- 移动工程后若路径失效：设置 `DSH_GAME_CLI=/abs/path/scripts/cli/dsh-game.mjs`；
- 生成工程不需要 `npm install`（vanilla）；React 模板需要其自身依赖。

---

## 测试与验证（本仓库）

```bash
node --test scripts/cli/test/*.test.js
node --test packages/sdk/test/sdk.test.js
npm run verify
```

CLI 测试覆盖：validate 拒绝场景（非法 manifest/非自包含/超大/BOM/非法 UTF-8/错误 capability/
错误文件名/版本不兼容/50 条截断）、build 确定性（两次 sha256 相同）、pack 产物与 sha256、
publish 输出结构与 Registry 校验/本地 Registry 合并、create-dsh-game 生成工程结构、
Local Runtime Simulator HTTP 行为。

---

## 明确不做（V1）

- 不联网、不做 `npm install`、不访问 GitHub API；
- 不做 zip/多文件包、不做包签名/加密；
- 不做 Windows 专用构建逻辑（Node 跨平台，路径统一 POSIX 处理）；
- 不产出 sourcemap、不写时间戳/随机 id（保证 sha256 可复现）。
