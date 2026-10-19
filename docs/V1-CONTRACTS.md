# DSH Game Market · V1 契约（M0 冻结）

> 本文是 V1 M0 地基阶段的**实现级契约**，供 Host / Client / Runtime / SDK / CLI / 游戏作者直接照着实现与验收。
> 权威口径：用户 2026-10-18 锁定的 V1 契约口径（本文逐条落笔）。`PROJECT_MEMORY.md` §2.1、§4.1 提供范围、术语与验证环境；若两者与本契约冲突，以本契约（即用户锁定口径）为准。
> 本文不写"已验证结果"，只写"必须成立的行为"。验证记录见 `docs/V1-VERIFICATION.md`（骨架）。

## 0. 范围、术语与冻结状态

### 0.1 覆盖范围

| 章节 | 内容 | 主要读者 |
|---|---|---|
| §1 | 版本与标识 | 全体 |
| §2 | 单文件包格式与自包含规则 | 游戏作者 / CLI / Host |
| §3 | manifest v1 字段 | 游戏作者 / CLI / Host / Market |
| §4 | 校验规则与 `E_*`→`GM-*` 映射 | CLI / Host / Runtime |
| §5 | Registry schema、URL 准入、缓存与离线 | Host / CLI 发布 / Market |
| §6 | 存储目录、`installations.json`、安装/更新/卸载流程 | Host / Client / Market |
| §7 | HTTP API 路由表 | Host / Client |
| §8 | SDK v1 签名、语义、超时、错误码、版本协商 | SDK / 游戏作者 |
| §9 | Agent 桥与多 Session 绑定 | Host / Client / Runtime |
| §10 | 首发四款游戏契约摘要 | 游戏作者 / 验收 |
| §11 | V1 明确不做 | 全体 |

不在本文范围：Market 视觉规范/设计稿、Agent Presence（小鲸鱼）视觉细节、PRD 全文、V1.5 的多文件包设计。

### 0.2 术语

| 术语 | 定义 |
|---|---|
| Bundle | `dsh-game-market` 插件包；包含 Host / Client / Runtime / SDK / CLI / 内置游戏 |
| Host | Bundle 的 Node 半，实现 `/api/game-market/*`、存储、Registry、安装、Session/分数、Agent 适配 |
| Client | `dsh.client` 浏览器半，渲染 Market/My Games/Runtime 外壳、暂停遮罩、鲸鱼，调用 Host API |
| Runtime | 可信 iframe 层：创建 sandbox iframe、持有 Bridge、自动保存调度、暂停/恢复 |
| SDK | 游戏 iframe 内通过 `DSH_GAME_SDK` 使用的客户端库（构建时内联进游戏） |
| 游戏包 / package | 单文件自包含 `.html`，文件名 `<id>-<version>.html`，内嵌 manifest v1 |
| manifest | 包内 `<script type="application/json" id="dsh-game-manifest">` 中的 JSON 对象 |
| Registry | 静态索引 JSON（默认 Bundle 内 `registry/games.json`），不提供服务端 |
| Registry 条目 / RegistryGame | `games[]` 中的一条元数据 + 包下载信息 |
| 安装记录 | `installations.json.games[id]`，见 §6.2 |
| Play Session | 一次"开局→结束"记录（`ps_*`），用于 Continue/分数归属 |
| Runtime 实例 / instance | 一次 `POST /launch` 产生的 `instanceId` + `nonce` 绑定 |
| 内置游戏 | 随 Bundle 分发的游戏（V1 仅 `snake`），不可卸载 |
| 本地安装 | 用户选择的本地 `.html` 包，`source:'local'`，无 sha256 |
| 开发模式 | `config.devMode === true`，扫描 `devGameRoots`，不复制包 |

### 0.3 与既有资料的关系

1. **只读参考**：`PROJECT_MEMORY.md`（§2.1 V1 范围、§2.1.6 M0 契约冻结记录、§4.1 验证环境）、`packages/shared/src/*.js`（**M0 已落地的契约实现**）、`packages/host/src/*.js`（V0 实现事实）。
2. **M0 已冻结的实现模块**（本文与它们必须一致）：
   - `packages/shared/src/manifest.js`：包/manifest v1 校验、内嵌 manifest 提取、自包含扫描；
   - `packages/shared/src/registry.js`：Registry schema、包 URL 准入、缓存校验、allowlist；
   - `packages/shared/src/installation.js`：存储布局常量、`installations.json` 校验、保留版本清理；
   - `packages/shared/src/constants.js` / `errors.js` / `contracts.js`：版本、限制、`GM-*`/`E_*` 映射、V1 路由表；
   - 契约测试：`tests/v1-contracts.test.js`。
3. **以本文为准的冲突**（V0 记忆/PRD 旧稿中与本契约不同之处；PRD v2.2 已统一到单文件口径，见 `PROJECT_MEMORY.md` §2.1.6）：
   - Registry 索引 = `registry/games.json`（不是 `registry.json`）；`registryVersion: 1`（不是 `schemaVersion`）。
   - 安装落位 = `packages/<id>/<version>/entry.html`（不是 `installed/<id>/<version>/`）。
   - V1 继续单文件、**无 zip**（旧记忆 D-032 的 zip 读取器已废弃）。
   - `/install-local` 上限 20 MiB（不是旧记忆的 4 MB）。
4. **变更规则**：`PROJECT_MEMORY.md` §2.1.6 已把 `docs/V1-CONTRACTS.md` + `packages/shared` 定为契约细节来源；`tests/v1-contracts.test.js` 锁定跨模块表面，改常量/错误码/路由必须同步更新本文与记忆（由 Lead 执行）。

### 0.4 冻结与变更流程

- 本契约随 M0 冻结：字段/路由/错误码/存储布局的任何改动都必须回到 Lead，走契约变更（更新本文 + `packages/shared` 常量 + 契约测试），不得在 M1 分支中私自扩展。
- 允许**向后兼容**的增量：新增可选 API 响应字段、新增可选 manifest 字段（需升 `manifestVersion`，V1 不新增）、新增 `GM-*` 错误码。
- 不允许：改名/删除既有字段与路由、改变错误码语义、改变存储路径语义。

### 0.5 推断项（M0 裁决状态）

下表是本文作者为实现所需、在用户锁定口径之外补充的细节；**M0 已由 Lead 在 `packages/shared` 落地**的条目直接以代码为准，未落地/仍需裁决的保留为 TBD：

| 编号 | 事项 | M0 状态 | 依据/取值 |
|---|---|---|---|
| TBD-01 | id 保留字清单 | **已冻结** | `manifest.js#RESERVED_GAME_IDS`（13 个，见 §1.2） |
| TBD-02 | `i18n` 字段结构 | **已冻结** | `{ default: string, locales: Record<tag, {name?, description?}> }`，≤16 locale（§3.6） |
| TBD-03 | Registry 预览图形态 | **已冻结（Lead 裁决）** | **仅绝对 https URL**（PRD v2.2 §8.8.1）；Host 下载缓存到 `preview-cache/` 后由 `/preview` 提供；包内 manifest `icon` 用 data URI，仅用于已安装/本地/开发来源（§5.1） |
| TBD-04 | `allowedHosts` 匹配规则 | **已冻结** | 精确主机名、大小写不敏感、不支持通配（`registry.js#allowedHostSet`） |
| TBD-05 | CSP `frame-ancestors` 默认 allowlist 与配置键名 | **已冻结（Lead 裁决，S-16 真机复核）** | 配置键 `config.security.frameAncestors: string[]`；默认 `["'self'","http://127.0.0.1:*","http://localhost:*"]`，Host 再按绑定地址追加 loopback origin；V0 的 `*` 不再使用，真机不符时只能通过配置追加，不回落 `*` |
| TBD-06 | `GM-4225` 新增错误码 | **已冻结** | `errors.js#GM.ENTRY_NOT_SELF_CONTAINED = 'GM-4225'`，HTTP 422 |
| TBD-07 | 安装全局锁实现 | **已冻结（M1a 实现）** | 进程内串行队列 + 跨进程锁文件 `staging/.install.lock`（心跳 5s、30s 无心跳可接管）；`installLockWaitMs=10s` 后返回 `GM-4091`；安装/卸载互斥冲突返回 `GM-4097` |
| TBD-08 | `/install` 是否同步 | **已冻结（同步）** | 无异步 job 查询路由；Host 内部有 job 状态机，API 同步等待结果（§6.3） |
| TBD-09 | 内置游戏是否写 `installations.json` | **已冻结（Lead 裁决：不写）** | 内置 `snake` 由 Host 内置目录 `games/snake` 直接服务；Market 列表合成为 `source:'builtin'` 记录；不写 `installations.json`，不参与安装/更新/卸载 |
| TBD-10 | `/entry` 绑定有效期 | **已冻结（Lead 裁决）** | `TIMING.entryBindingTtlMs = 10 分钟`；Host 内存维护 launch 绑定（instance/nonce/gameId/version），退出/卸载/超时即失效 |
| TBD-11 | 存档删除语义 | **已冻结（V0 语义保留）** | `POST /save` 中 `data:null` 表示删除该 key |
| TBD-12 | 手动刷新 Registry 节流 | **已冻结** | `registryRefreshThrottleMs = 5 分钟`；节流时 `GM-4290` |
| TBD-13 | 内置游戏入口文件名 | **已冻结（沿用 V0）** | Bundle 内 `games/snake/dist/index.html`；Registry 包必须 `<id>-<version>.html` |
| TBD-14 | 安装子阶段超时 | **已冻结** | `installVerifyMs=15s`、`installMoveMs=30s`（`constants.js#TIMING`） |

---

## 1. 版本与标识

### 1.1 契约版本矩阵

| 名称 | V1 值 | 载体 | 说明 |
|---|---|---|---|
| `manifestVersion` | `1` | manifest | 游戏清单格式版本；V1 只接受 1 |
| 包格式 | `html-single-file-v1` | 包文件 | 单文件自包含 HTML |
| `protocolVersion` | `1` | Bridge 信封 `v` | Runtime↔SDK postMessage 协议 |
| `RUNTIME_VERSION` | `1.0.0` | Host/Runtime | Runtime 语义版本 |
| `SDK_VERSION` | `1.0.0` | SDK | SDK 语义版本 |
| `registryVersion` | `1` | `registry/games.json` | Registry 索引 schema |
| Registry 缓存 `schemaVersion` | `1` | `registry-cache.json` | 缓存文件 schema |
| 安装记录 `schemaVersion` | `1` | `installations.json` | 安装记录 schema |
| 偏好 `schemaVersion` | `1` | `preferences.json` | 与 V0 一致 |
| 存档信封 `schemaVersion` | `1` | `saves/<id>/current.json` | 与 V0 一致 |
| Play Session `schemaVersion` | `1` | `sessions/<id>.json` | 与 V0 一致 |
| 分数 `schemaVersion` | `1` | `scores/<id>.json` | 与 V0 一致 |
| 安装记录支持版本 | `1` | `installations.json` | `SUPPORTED_INSTALL_SCHEMA_VERSION = 1` |
| 回滚保留版本数 | `1` | `installations.json` | `KEPT_PREVIOUS_VERSIONS = 1`（current + 1 previous） |
| `LEGACY_V0_VERSION` | `0.1.0` | Host 兼容层 | V0 游戏 `0.1.x` 范围继续接受（V1-07，见 §8.6） |
| 多文件资源/zip | 不支持 | — | V1.5 再设计 |

### 1.2 标识符

| 标识 | 规则 | 生成方 | 备注 |
|---|---|---|---|
| 游戏 `id` | `^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$`（3–48 字符），禁止 `--`，禁止保留字 | 作者 | 同时用于目录名、文件名、存档目录 |
| 保留 id | `conversation`、`plugins`、`schedules`、`dsh-game-market`、`game-market`、`main`、`sidebar`、`api`、`assets`、`static`、`health`、`launch`、`dsh`（`manifest.js#RESERVED_GAME_IDS`） | 平台 | 命中 → `E_PKG_ID_RESERVED` / `GM-4235` |
| 游戏 `version` | semver 子集：`^(0\|[1-9]\d*)\.(0\|[1-9]\d*)\.(0\|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$`；**禁止 `+`**（无 build metadata） | 作者 | 预发布标识允许；包文件名使用原样版本 |
| `playSessionId` | `^ps_[a-f0-9]{24}$` | Host | 见 `packages/host/src/ids.js` |
| `instanceId` | 32 位小写 hex | Host | 一次 launch |
| `nonce` | 32 位小写 hex | Host | 一次 launch；与 instance 绑定 |
| `requestId` | `^req_[a-f0-9]{16}$` | Host | 每个 API 响应 |
| `hostEpoch` | `^he_[a-f0-9]{16}$` | Host | Host 进程随机标识；重启变化 |
| `jobId` | `^job_[a-f0-9]{16}$` | Host | `staging/<jobId>/` |
| `operationId` | `^[A-Za-z0-9._:-]{1,128}$` | Client/SDK/Runtime | 幂等键 |
| Registry `etag` | 字符串（HTTP ETag 原样，可含引号）或 `null` | Registry 服务器 | 缓存协商 |
| 存储 key | `^[a-z0-9][a-z0-9._-]{0,63}$`，禁止 `__proto__`/`constructor`/`prototype` | 游戏 | 单游戏 ≤32 个 key |

### 1.3 版本范围与兼容判定

| 项 | 规则 |
|---|---|
| 允许的范围语法 | `^<version>`、`~<version>`、精确 `<version>`、`>=<v> <<v>`（仅 manifest 的 `sdkVersion`/`runtimeVersion`；V1 官方推荐 `^1.0.0`） |
| 不支持的语法 | `*`、`x`、`latest`、`>1`、`1.2`、区间并集、`+build` → `GM-4221`（manifest） |
| `^1.0.0` | 匹配 `>=1.0.0 <2.0.0`（semver caret） |
| `~1.0.0` | 匹配 `>=1.0.0 <1.1.0`（semver tilde） |
| 当前平台版本 | Runtime `1.0.0`、SDK `1.0.0`；V1 期间平台只发 `1.x` patch/minor |
| 不满足时 | 安装阶段拒绝（`GM-4260`/`GM-4261`）；已安装游戏在 Play 前再次校验，不满足则 Play 禁用并说明原因 |
| V0 兼容窗口 | `0.1.x` 范围（`^0.1.0` / `0.1.0` / `~0.1.0`）视为合法旧范围并放行（`LEGACY_V0_VERSION='0.1.0'`，Host `isLegacyV0Range`）；V0 方法名/语义不变，因此旧游戏无需重新发布 |
| 自动升降级 | **禁止**。平台不得为运行游戏而改变自身 Runtime/SDK 版本，也不得静默改写 manifest 范围 |

---

## 2. 单文件包格式与自包含规则

### 2.1 文件级约束

校验实现：`packages/shared/src/manifest.js#validatePackageHtml`（CLI/Host/契约测试共用）。

| 约束 | 值 | 失败错误 |
|---|---|---|
| 文件数量 | 恰好 1 个 `.html` 文档（V1 无 zip、无多文件） | `E_PKG_HTML_INVALID` → `GM-4222` |
| 文件名 | Registry/本地 file Registry 包 URL 末段必须 `<id>-<version>.html`；内置产物为 Bundle 内部文件（V0 沿用 `dist/index.html`），不受命名约束 | 索引校验 `E_REGISTRY_INVALID` → `GM-5032`；安装期 URL 准入 `E_INSTALL_URL_REJECTED` → `GM-4034` |
| 编码 | UTF-8，**无 BOM**；BOM → 拒绝。非法 UTF-8 由读取/解码层拒绝 | `E_PKG_HTML_INVALID` → `GM-4222`；解码失败 `GM-4150` |
| 大小 | ≤ **20 MiB（20,971,520 字节）** | `E_PKG_TOO_LARGE` → `GM-4135` |
| 文档形态 | 必须含 `<html>` 标签（大小写不敏感） | `E_PKG_HTML_INVALID` → `GM-4222` |
| MIME（本地安装） | `Content-Type: text/html`（允许 `;charset=utf-8`） | `GM-4150` |
| MIME（远端下载） | Host 策略：接受 `text/html`、`text/plain`、`application/octet-stream`，按 UTF-8 HTML 解析 | `GM-4150` |
| 内嵌 manifest | 恰好 1 处；脚本文本（不含标签）≤ **64 KiB（65,536 字节）**；必须为 JSON 对象 | 缺失 `E_PKG_MANIFEST_MISSING`/重复 `E_PKG_MANIFEST_DUPLICATE` → `GM-4221`；非 JSON `E_PKG_MANIFEST_JSON` → `GM-4228`；超限 `E_PKG_MANIFEST_TOO_LARGE` → `GM-4229` |
| 外部资源 | 不允许外部/相对路径资源（见 §2.4） | `E_PKG_ENTRY_NOT_SELF_CONTAINED` → `GM-4225` |
| 可执行内容 | 仅内联 `<script>`（无 `src`）与内联 `<style>`；第三方库必须整体打包进单文件（平台不再单独分发依赖） | `GM-4225` |
| 压缩/加密 | 不允许；明文 HTML 直接可解析 | `GM-4221` / `GM-4150` |

### 2.2 HTML 文档结构（规范形态）

```html
<!doctype html>
<html lang="zh-CN" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark light" />
    <title>Game Title</title>
    <!-- 内嵌 manifest：必须恰好一处，放在 <head> 内（扫描器全文搜索，不依赖位置） -->
    <script type="application/json" id="dsh-game-manifest">
      { "manifestVersion": 1, "id": "demo", "version": "1.0.0", "...": "..." }
    </script>
    <style>/* 内联样式，禁止 @import 与外部 url() */</style>
  </head>
  <body>
    <div id="app"></div>
    <script>/* 内联 SDK（构建时注入 DSH_GAME_SDK）与游戏逻辑；无 src */</script>
  </body>
</html>
```

### 2.3 内嵌 manifest 提取规则

实现：`manifest.js#extractManifest`（HTML 正则扫描；提取后 manifest 脚本本身不参与自包含扫描）。

1. 查找 `<script ... id="dsh-game-manifest" ...>…</script>`：属性名/标签名大小写不敏感；`id` 属性值精确匹配 `dsh-game-manifest`（大小写敏感）；`type` **不强制**校验，但规范要求 `type="application/json"`。
2. **必须恰好 1 处**：0 处 → `E_PKG_MANIFEST_MISSING` → `GM-4221`；≥2 处 → `E_PKG_MANIFEST_DUPLICATE` → `GM-4221`。
3. 脚本文本去首尾空白后必须非空、且 UTF-8 字节 ≤64 KiB；超限 → `E_PKG_MANIFEST_TOO_LARGE` → `GM-4229`。
4. 必须是合法 JSON；否则 → `E_PKG_MANIFEST_JSON` → `GM-4228`；JSON 不是对象 → 同上（`E_PKG_MANIFEST_JSON`）。
5. 校验通过后用 `validateManifest` 校验字段（§3）。V0 的独立 `game.json` 不进入包：**V1 包内没有独立 manifest 文件**。

### 2.4 自包含规则（E_PKG_ENTRY_NOT_SELF_CONTAINED → GM-4225）

实现：`manifest.js#checkSelfContained`（静态启发式；Host 在安装/启动时复检，Runtime 的 sandbox + CSP 是运行期兜底）。

扫描对象：解出的 UTF-8 HTML 原文，**剔除内嵌 manifest 脚本后**。命中任一条即违规，错误 `E_PKG_ENTRY_NOT_SELF_CONTAINED` → `GM-4225`；`details` 为 `{field:'entry', violations:[...]}`（最多按实现给出的条目，不含整段文件内容）。

| # | 扫描面 | 违规形态 |
|---|---|---|
| SC-01 | HTML | 出现 `<iframe`（任意属性/`srcdoc`） |
| SC-02 | CSS | 出现 `@import`（任意形式，含 `<style>` 与内联样式） |
| SC-03 | HTML 资源标签 | `script`、`link`、`img`、`audio`、`video`、`source`、`track`、`input`、`use` 的首个 `src`/`href`/`xlink:href` 值非空、非 `data:`、非 `#` |
| SC-04 | CSS | `url(...)` 参数非 `data:`、非 `#` |
| SC-05 | 内联脚本/全文 | 命中 `fetch(`、`XMLHttpRequest`、`WebSocket(`、`EventSource(`、`sendBeacon(`、`serviceWorker`（词边界；字符串/注释中的命中同样视为违规，作者应避免这些标识符） |

明确允许：

| 允许 | 说明 |
|---|---|
| `data:` 图片（png/webp/jpeg） | `<img src="data:image/png;base64,...">`、CSS `background-image:url(data:image/...)` |
| 内联 `<script>` / `<style>` / `style=""` | 无外部引用即可 |
| Canvas / WebAudio / Web Storage 替代实现 | 不使用网络 API；持久化必须走 SDK `storage` |
| 系统字体 | V1 CSP 下无 `font-src data:`，使用系统字体栈（`ui-sans-serif`、`-apple-system`、`PingFang SC` 等）；不使用 `@font-face` |
| `#anchor` | 仅用于页内锚点 |

实现提示与边界：

1. 这是**静态启发式**，不是完整 HTML 解析器：可能对字符串/注释中的关键字产生误报（按违规处理）；Host 的复检与 Runtime 的 CSP 是纵深防御。
2. M0 扫描器**未**单独检查 `<base>`、`<form action>`、`<meta http-equiv=refresh>`、`<object>/<embed>`、动态 `document.createElement('script')`；这些在 Runtime CSP（`default-src 'none'`、`base-uri`/`form-action` 由实现补齐）与安装后人工安全用例中覆盖（见 `V1-VERIFICATION.md` SEC 表）。
3. CLI 与 Host 使用同一实现，保证"CLI 放行 = Host 放行"；同一输入必须确定性输出。

---

## 3. manifest v1

manifest 是包内 JSON 对象，字段名大小写敏感。校验实现：`packages/shared/src/manifest.js#validateManifest`，返回 `{ok, errors, warnings, manifest}`：

- **errors** 阻止安装/运行；
- **warnings** 不阻止，但 CLI 必须打印：`W_PKG_UNKNOWN_FIELD`（未知字段；`x-*` 扩展字段放行）、`W_PKG_IGNORED_FIELD`（未声明对应能力时 `score`/`save` 被忽略）；
- 已移除字段 `entry`/`cover`/`screenshots`、V0 遗留的 `author` 字符串/`category` 单值 → `E_PKG_LEGACY_FIELD` → `GM-4237`（拒绝）。

### 3.1 字段总表

| 字段 | 必填 | 类型 / 约束 | 错误（E_* → GM-*） |
|---|---|---|---|
| `manifestVersion` | 是 | 数字，必须 `=== 1` | `E_PKG_MANIFEST_VERSION` → `GM-4230` |
| `id` | 是 | 字符串，`^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$`，禁 `--`，禁保留字（§1.2） | `E_PKG_ID_INVALID` → `GM-4234`；保留字 `E_PKG_ID_RESERVED` → `GM-4235` |
| `name` | 是 | 字符串，1–64 码点；禁止控制字符 | 缺失 `GM-4231`；类型 `GM-4232`；范围 `GM-4233` |
| `version` | 是 | semver 子集（§1.2），无 `+`；≤64 字符 | `E_PKG_VERSION_INVALID` → `GM-4236` |
| `author` | 是 | 对象 `{name, url?}`；`name` 1–64 码点；`url` 可选 https（≤约 300 字符） | 类型/范围 `GM-4232`/`GM-4233`；V0 字符串 `GM-4237` |
| `description` | 是 | 字符串，1–280 码点；禁止控制字符 | 缺失 `GM-4231`；类型/范围 `GM-4232`/`GM-4233` |
| `categories` | 是 | 数组，1–3 项，枚举 `arcade`/`puzzle`/`card`/`idle`/`action`/`strategy`/`trivia`/`sandbox`；不允许重复 | 未知 `E_PKG_CATEGORY_UNKNOWN` → `GM-4238`；数量/重复 `GM-4233` |
| `capabilities` | 是 | 数组，可为空；仅 `storage`/`score`；不允许重复 | 未知 `E_PKG_CAPABILITY_UNKNOWN` → `GM-4239`；已登记但 V1 不支持 `E_PKG_CAPABILITY_UNSUPPORTED` → `GM-4240`；重复 `E_PKG_CAPABILITY_DUPLICATE` → `GM-4241` |
| `sdkVersion` | 是 | 字符串，§1.3 范围语法 | `E_PKG_RANGE_SYNTAX` → `GM-4245`；Host 兼容性检查 `GM-4261` |
| `runtimeVersion` | 是 | 字符串，§1.3 范围语法 | `E_PKG_RANGE_SYNTAX` → `GM-4245`；Host 兼容性检查 `GM-4260` |
| `icon` | 否 | data URI：`data:image/(png\|webp\|jpeg);base64,…`；解码后 ≤256 KiB | 格式 `E_PKG_ICON_FORMAT` → `GM-4247`；超限 `E_PKG_ICON_TOO_LARGE` → `GM-4248` |
| `tags` | 否 | 数组，≤8 项；每项 `^[a-z0-9][a-z0-9-]{0,23}$`；不允许重复 | 范围/重复 `GM-4233` |
| `preferredTheme` | 否 | 枚举 `system`/`light`/`dark`/`game-defined` | 范围 `GM-4233` |
| `viewport` | 否 | 对象 `{width, height, fit?}`；`width/height` 整数 1–3840；`fit` 仅 `"contain"` | 类型 `GM-4232`；范围 `GM-4233` |
| `score` | 条件 | 声明 `score` 能力时**必填**；对象见 §3.4 | 缺失 `GM-4231`；范围 `E_PKG_SCORE_RANGE` → `GM-4243` |
| `save` | 条件 | 声明 `storage` 能力时**必填**；对象见 §3.5 | 缺失 `GM-4231`；非法 `E_PKG_SAVE_SCHEMA` → `GM-4244` |
| `permissions` | 否 | 只接受**省略**或**空对象 `{}`** | `E_PKG_PERMISSION_UNSUPPORTED` → `GM-4242` |
| `homepage` | 否 | https URL（≤约 300 字符） | 范围 `GM-4233` |
| `repository` | 否 | https URL（≤约 300 字符） | 范围 `GM-4233` |
| `license` | 否 | SPDX 风格：`^[A-Za-z0-9.+-]{1,64}$` | 范围 `GM-4233` |
| `i18n` | 否 | 对象，见 §3.6 | 类型 `GM-4232`；范围 `GM-4233` |
| 其他未知字段 | — | warning `W_PKG_UNKNOWN_FIELD`（不阻止）；`x-*` 前缀允许且平台忽略 | 仅警告 |

**V1 明确不存在的 manifest 字段**：`entry`、`cover`、`screenshots`。出现在包内 manifest 中 → `E_PKG_LEGACY_FIELD` → `GM-4237`。`entry` 由包格式隐含（包本身即入口）；`cover`/`screenshots` 只存在于 Registry 元数据（§5.1）。

规范化后的 TypeScript 形态（M0 契约测试锁定其中跨模块字段；类型本体由 `manifest.js` 运行时校验）：

```ts
interface Manifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  author: { name: string; url?: string };
  description: string;
  categories: Array<'arcade' | 'puzzle' | 'card' | 'idle' | 'action' | 'strategy' | 'trivia' | 'sandbox'>;
  capabilities: Array<'storage' | 'score'>;
  sdkVersion: string;
  runtimeVersion: string;
  icon?: string;                                    // data URI
  tags?: string[];
  preferredTheme?: 'system' | 'light' | 'dark' | 'game-defined';
  viewport?: { width: number; height: number; fit?: 'contain' };
  score?: { direction?: 'higher-better' | 'lower-better'; min: number; max: number; integer?: boolean };
  save?: { schemaVersion: number };
  permissions?: Record<string, never>;              // 仅允许 {}
  homepage?: string;
  repository?: string;
  license?: string;
  i18n?: { default: string; locales: Record<string, { name?: string; description?: string }> };
}

// 安装记录里的 manifest 快照：保存 manifest 的 icon data URI（≤256 KiB，非权威快照）
type ManifestSnapshot = Manifest;
```

### 3.2 条件字段规则

| 条件 | 行为 |
|---|---|
| `capabilities` 含 `score` 且缺 `score` | error `E_PKG_FIELD_MISSING` → `GM-4231` |
| `capabilities` 含 `score` 且有 `score` | 按 §3.4 校验 |
| `capabilities` 不含 `score` 但带 `score` | warning `W_PKG_IGNORED_FIELD`（忽略该字段，不报错） |
| `capabilities` 含 `storage` 且缺 `save` | error `E_PKG_FIELD_MISSING` → `GM-4231` |
| `capabilities` 含 `storage` 且有 `save` | 按 §3.5 校验 |
| `capabilities` 不含 `storage` 但带 `save` | warning `W_PKG_IGNORED_FIELD`（忽略） |
| 能力枚举非法 | 见 §3.1 `capabilities` 行（`GM-4239/4240/4241`） |
| 平台侧能力 | Host/Runtime 只对声明的能力放行；未声明时调用 → `GM-4032` |

### 3.3 `author` / `viewport` 子结构

```ts
interface ManifestAuthor {
  name: string;        // 1–64 码点
  url?: string;        // https，≤约 300 字符
}

interface ManifestViewport {
  width: number;       // 整数 1–3840，默认 960
  height: number;      // 整数 1–3840，默认 540
  fit?: 'contain';     // 默认 'contain'（V1 唯一取值）
}
```

### 3.4 `score` 子结构

| 字段 | 必填 | 约束 | 默认 |
|---|---|---|---|
| `direction` | 否 | `higher-better` / `lower-better` | `higher-better` |
| `min` | 是 | 有限数字；`min < max`；`max - min ≤ 1e9` | — |
| `max` | 是 | 有限数字；同上 | — |
| `integer` | 否 | 布尔；`true` 时提交分数必须为安全整数 | `true` |

### 3.5 `save` 子结构

| 字段 | 必填 | 约束 | 默认 |
|---|---|---|---|
| `schemaVersion` | 是 | 整数 1 – 2,147,483,647 | 无默认（必填） |

语义：`schemaVersion` 描述游戏存档内容版本，不是平台存档信封版本（信封固定 `schemaVersion:1`）。
平台读取存档时若 `saved saveSchemaVersion > 当前游戏 manifest.save.schemaVersion` → `GM-4099`，由游戏/用户决定降级或重置。

### 3.6 `i18n`（V1 只透传）

```ts
interface ManifestI18n {
  default: string;                              // 必填；必须是 locales 的 key
  locales: Record<string, {                     // 1–16 个 locale
    name?: string;                              // 1–64 码点
    description?: string;                       // 1–280 码点
  }>;
}
```

规则：locale tag `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$`；V1 **不**用 i18n 覆盖 Runtime 下发的 `locale`，也不做运行时文案切换；Market 详情页可优先展示当前 locale 的 `name/description`；Registry 条目可携带 `i18n` 但不参与 manifest 校验。

### 3.7 完整示例

```html
<script type="application/json" id="dsh-game-manifest">
{
  "manifestVersion": 1,
  "id": "star-catcher",
  "name": "星之捕手",
  "version": "1.0.0",
  "author": { "name": "Demo Studio", "url": "https://example.com/studio" },
  "description": "在流星雨里收集星星，避开陨石。一局约 3 分钟。",
  "categories": ["arcade", "action"],
  "capabilities": ["storage", "score"],
  "sdkVersion": "^1.0.0",
  "runtimeVersion": "^1.0.0",
  "icon": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAA...",
  "tags": ["casual", "one-more-run", "keyboard"],
  "preferredTheme": "game-defined",
  "viewport": { "width": 960, "height": 540, "fit": "contain" },
  "score": { "direction": "higher-better", "min": 0, "max": 1000000, "integer": true },
  "save": { "schemaVersion": 1 },
  "permissions": {},
  "homepage": "https://example.com/games/star-catcher",
  "repository": "https://github.com/example/star-catcher",
  "license": "MIT",
  "i18n": {
    "default": "zh-CN",
    "locales": {
      "zh-CN": { "name": "星之捕手", "description": "在流星雨里收集星星，避开陨石。" },
      "en-US": { "name": "Star Catcher", "description": "Catch falling stars and dodge meteors." }
    }
  }
}
</script>
```

### 3.8 最小示例（全部必填字段）

```json
{
  "manifestVersion": 1,
  "id": "minimal-demo",
  "name": "Minimal Demo",
  "version": "1.0.0",
  "author": { "name": "Demo Studio" },
  "description": "最小 V1 游戏包示例：只有一个可移动方块。",
  "categories": ["sandbox"],
  "capabilities": [],
  "sdkVersion": "^1.0.0",
  "runtimeVersion": "^1.0.0"
}
```

对应包文件名：`minimal-demo-1.0.0.html`。此包不声明 `storage`/`score`，因此不得保存存档或提交分数。

### 3.9 manifest 字段级错误速查

| 场景 | E_* | GM-* | `details` |
|---|---|---|---|
| 缺必填字段 | `E_PKG_FIELD_MISSING` | `GM-4231` | `{field}` |
| 字段类型错误 | `E_PKG_FIELD_TYPE` | `GM-4232` | `{field}` |
| 字段长度/格式/枚举/重复 | `E_PKG_FIELD_RANGE` | `GM-4233` | `{field}` |
| id 格式非法 | `E_PKG_ID_INVALID` | `GM-4234` | `{field:'id'}` |
| id 为保留字 | `E_PKG_ID_RESERVED` | `GM-4235` | `{field:'id'}` |
| version 非 semver 子集 | `E_PKG_VERSION_INVALID` | `GM-4236` | `{field:'version'}` |
| V0 遗留字段/`entry`/`cover`/`screenshots` | `E_PKG_LEGACY_FIELD` | `GM-4237` | `{field}` |
| 未知 category | `E_PKG_CATEGORY_UNKNOWN` | `GM-4238` | `{field:'categories', value}` |
| 未知 capability | `E_PKG_CAPABILITY_UNKNOWN` | `GM-4239` | `{field:'capabilities', value}` |
| 已登记但 V1 不支持（network 等） | `E_PKG_CAPABILITY_UNSUPPORTED` | `GM-4240` | `{field:'capabilities', value}` |
| 能力重复 | `E_PKG_CAPABILITY_DUPLICATE` | `GM-4241` | `{field:'capabilities', value}` |
| permissions 非空 | `E_PKG_PERMISSION_UNSUPPORTED` | `GM-4242` | `{field:'permissions'}` |
| score 范围/方向非法 | `E_PKG_SCORE_RANGE` | `GM-4243` | `{field:'score'}` |
| save.schemaVersion 非法 | `E_PKG_SAVE_SCHEMA` | `GM-4244` | `{field:'save.schemaVersion'}` |
| sdk/runtime 范围语法非法 | `E_PKG_RANGE_SYNTAX` | `GM-4245` | `{field}` |
| icon 非 data URI/MIME 非法 | `E_PKG_ICON_FORMAT` | `GM-4247` | `{field:'icon'}` |
| icon 解码 >256 KiB | `E_PKG_ICON_TOO_LARGE` | `GM-4248` | `{field:'icon'}` |
| manifestVersion ≠ 1 | `E_PKG_MANIFEST_VERSION` | `GM-4230` | `{field:'manifestVersion'}` |
| 内嵌 manifest 非 JSON/非对象 | `E_PKG_MANIFEST_JSON` | `GM-4228` | — |
| 内嵌 manifest >64 KiB | `E_PKG_MANIFEST_TOO_LARGE` | `GM-4229` | — |
| 内嵌 manifest 缺失/重复 | `E_PKG_MANIFEST_MISSING` / `E_PKG_MANIFEST_DUPLICATE` | `GM-4221` | `{field:'manifest'}` |
| 未知字段 | —（warning） | — | `W_PKG_UNKNOWN_FIELD` |
| 未声明能力但带 score/save | —（warning） | — | `W_PKG_IGNORED_FIELD` |
| 版本范围不满足当前 Runtime/SDK | — | `GM-4260` / `GM-4261` | `{required, actual}` |

> `E_*` 不跨 API/Bridge；Host/CLI 用 `errors.js#gmForInternal` 翻译为 `GM-*`（`INTERNAL_TO_GM`）。

---

## 4. 校验规则与三阶段职责

### 4.1 阶段职责总表

| 阶段 | 组件 | 负责 | 不负责 |
|---|---|---|---|
| 开发/发布 | CLI（`dsh-game build/validate/publish`，M1b 冻结命令细节） | 生成单文件包、按 §2/§3 全量校验、计算 sha256/size、写 Registry 条目（`publish`） | 网络分发、信任其校验结果 |
| 安装 | Host | 重新下载/读取包，按 §2/§3/§5 全量复验（不复用 CLI 结果）、版本/兼容性、落盘与事务 | 解释游戏内容、执行游戏代码 |
| 运行 | Runtime | 再次校验安装记录与入口摘要、CSP/sandbox、Bridge 协议、ready 超时、能力边界 | 重新解析 manifest（使用安装时快照） |
| 展示 | Client | 呈现错误码/文案、重试、二次确认（本地安装/删除数据） | 安全判定（不得仅靠 Client 校验） |

原则：**CLI 校验是开发者体验，Host 校验是安全边界，Runtime 校验是运行边界**；三者使用同一套规则实现（共享模块），但 Host 必须独立复验。

### 4.2 校验清单

| 编号 | 阶段 | 检查 | 规则 | E_* | GM-* |
|---|---|---|---|---|---|
| V-01 | CLI/Host | 包大小 | ≤20 MiB | `E_PKG_TOO_LARGE` | GM-4135 |
| V-02 | CLI/Host | 文档结构/编码 | 非空 HTML、含 `<html>`、无 BOM | `E_PKG_HTML_INVALID` | GM-4222 |
| V-03 | CLI/Host | manifest 提取 | 恰好 1 处、≤64 KiB、合法 JSON 对象 | `E_PKG_MANIFEST_MISSING`/`E_PKG_MANIFEST_DUPLICATE` / `E_PKG_MANIFEST_JSON` / `E_PKG_MANIFEST_TOO_LARGE` | GM-4221 / GM-4228 / GM-4229 |
| V-04 | CLI/Host | manifest 字段 | §3 全量 schema（含警告） | `E_PKG_*`（§3.9） | GM-4230–GM-4248 |
| V-05 | CLI/Host | 文件名与 id/version | Registry 包名/相对路径末段 `<id>-<version>.html` | 索引：`E_REGISTRY_INVALID`；安装：`E_INSTALL_URL_REJECTED` | GM-5032 / GM-4034 |
| V-06 | CLI/Host | 自包含 | §2.4 全表 | `E_PKG_ENTRY_NOT_SELF_CONTAINED` | **GM-4225** |
| V-07 | Host | 下载完整性与大小 | sha256 与 `package.sha256` 一致；字节数与 `package.size` 一致；≤20 MiB | `E_INSTALL_HASH_MISMATCH` / `E_INSTALL_CORRUPT` / `E_PKG_TOO_LARGE` | GM-5015 / GM-5037 / GM-4135 |
| V-08 | Host | URL 准入 | §5.2 | `E_INSTALL_URL_REJECTED` / `E_REGISTRY_URL` / `E_REGISTRY_INVALID` | GM-4034 / GM-4035 / GM-5032 |
| V-09 | Host | Registry schema | §5.1；单条非法跳过、整体非法拒绝 | `E_REGISTRY_INVALID` | GM-5032 |
| V-10 | Host/CLI | Runtime/SDK 兼容 | 范围满足当前 `1.x`；`0.1.x` 走 legacy 窗口 | `E_COMPAT_*`（Host 直接 GM） | GM-4260 / GM-4261 |
| V-11 | Host | 能力枚举 | 仅 `storage`/`score`；运行时能力边界 | `E_PKG_CAPABILITY_*` | GM-4239/4240/4241；调用未声明能力 GM-4032 |
| V-12 | Host | Registry 一致性 | manifest.id/version 必须与条目一致 | `E_INSTALL_VERSION_MISMATCH` | GM-4095 |
| V-13 | Runtime | 入口摘要 | 服务入口时重算 sha256 与安装记录/包摘要一致 | `E_INSTALL_HASH_MISMATCH` / `E_PKG_HTML_INVALID` | GM-5015 / GM-4222 |
| V-14 | Runtime | 实例绑定 | instance+nonce+game+version 匹配且未过期 | （Host 参数校验） | GM-4002 |
| V-15 | Runtime | 协议 | Bridge `v===1`、信封结构、source/nonce | （V0 常量） | GM-5002 / GM-5004 |
| V-16 | Runtime | ready | 10s 内完成握手，否则失败 | （V0 常量） | GM-5001 |
| V-17 | Runtime | 能力边界 | 未声明 storage/score 的调用拒绝 | （V0 常量） | GM-4032 |
| V-18 | SDK | 写入前校验 | key/JSON/大小/嵌套深度/危险键 | （V0 常量） | GM-4131/4132/4133/4134 |
| V-19 | Host | 安装事务 | 失败不产生半安装；旧版本保留；版本冲突/运行中拦截 | `E_INSTALL_*` | GM-4091/4094/4096/5034/5035/5036/5037 |
| V-20 | Host | 卸载安全 | 只操作管理目录内目标；内置不可卸载；忙时拒绝 | `E_UNINSTALL_BUILTIN` / `E_UNINSTALL_BUSY` / `E_STORE_PATH_ESCAPE` | GM-4038 / GM-4097 / GM-4037 |

### 4.3 `E_*` → `GM-*` 映射表

> `E_*` 只用于内部日志/CLI 输出与测试断言，**绝不跨 HTTP/Bridge 边界**。映射由 `packages/shared/src/errors.js#INTERNAL_TO_GM` + `gmForInternal` 冻结；CLI 打印 `E_*` 与 `GM-*` 两个码，Host/Client 只使用 `GM-*`。
> **M0 期间新增码仍在由 Lead 收敛**：下表为 M0 冻结候选快照，实施前以 `errors.js` 当前导出为准；任何改码必须同步 `tests/v1-contracts.test.js` + 本文 + `PROJECT_MEMORY.md`。用户锁定项 `E_PKG_ENTRY_NOT_SELF_CONTAINED → GM-4225` 不变。

**包 / manifest**

| E_*（内部） | GM-*（对外） | 含义 |
|---|---|---|
| `E_PKG_HTML_INVALID` | GM-4222 | 非空 HTML 校验失败（含 BOM/缺 `<html>`/包无效） |
| `E_PKG_MANIFEST_MISSING` / `E_PKG_MANIFEST_DUPLICATE` | GM-4221 | 内嵌 manifest 缺失/重复 |
| `E_PKG_MANIFEST_JSON` | GM-4228 | 内嵌 manifest 非 JSON 或非对象 |
| `E_PKG_MANIFEST_TOO_LARGE` | GM-4229 | manifest >64 KiB |
| `E_PKG_MANIFEST_VERSION` | GM-4230 | manifestVersion ≠ 1 |
| `E_PKG_FIELD_MISSING` | GM-4231 | 缺必填字段/条件字段 |
| `E_PKG_FIELD_TYPE` | GM-4232 | 字段类型错误 |
| `E_PKG_FIELD_RANGE` | GM-4233 | 长度/格式/枚举/重复 |
| `E_PKG_ID_INVALID` | GM-4234 | id 正则/`--` 违规 |
| `E_PKG_ID_RESERVED` | GM-4235 | id 为保留字 |
| `E_PKG_VERSION_INVALID` | GM-4236 | version 非 semver 子集 |
| `E_PKG_LEGACY_FIELD` | GM-4237 | V0 遗留字段/已移除字段 |
| `E_PKG_CATEGORY_UNKNOWN` | GM-4238 | 未知 category |
| `E_PKG_CAPABILITY_UNKNOWN` | GM-4239 | 未知 capability |
| `E_PKG_CAPABILITY_UNSUPPORTED` | GM-4240 | 已登记但 V1 不支持（`network` 等） |
| `E_PKG_CAPABILITY_DUPLICATE` | GM-4241 | capability 重复 |
| `E_PKG_PERMISSION_UNSUPPORTED` | GM-4242 | permissions 非空 |
| `E_PKG_SCORE_RANGE` | GM-4243 | score 范围/方向非法 |
| `E_PKG_SAVE_SCHEMA` | GM-4244 | save.schemaVersion 非法 |
| `E_PKG_RANGE_SYNTAX` | GM-4245 | 版本范围语法非法 |
| `E_PKG_ICON_FORMAT` | GM-4247 | icon 非图片 data URI |
| `E_PKG_ICON_TOO_LARGE` | GM-4248 | icon 解码 >256 KiB |
| `E_PKG_ENTRY_NOT_SELF_CONTAINED` | **GM-4225** | §2.4 违规（用户锁定） |
| `E_PKG_TOO_LARGE` | GM-4135 | 包 >20 MiB |

**Registry / 安装 / 存储**

| E_*（内部） | GM-*（对外） | 含义 |
|---|---|---|
| `E_REGISTRY_FIELD_MISSING` / `E_REGISTRY_FIELD_TYPE` / `E_REGISTRY_FIELD_RANGE` / `E_REGISTRY_INVALID` | GM-5032 | Registry 索引/缓存/包 URL 非法或不可用（整份索引拒绝并回退缓存） |
| `E_REGISTRY_URL` | GM-4035 | Registry 索引 URL 非法/不可达配置 |
| `E_MARKET_DISABLED` | GM-4036 | Market 被配置禁用 |
| `E_NOT_IN_REGISTRY` | GM-4044 | 请求的 id 不在 Registry |
| `E_UNINSTALL_BUILTIN` | GM-4038 | 内置游戏不可卸载 |
| `E_INSTALL_URL_REJECTED` | GM-4034 | 包 URL 准入失败（host/scheme/重定向） |
| `E_INSTALL_DISK_FULL` | GM-4142 | 磁盘空间不足 |
| `E_STORE_PATH_ESCAPE` | GM-4037 | 存储路径越界 |
| `E_INSTALL_VERSION_CONFLICT` | GM-4094 | 已安装版本冲突（同版本不同包/降级策略） |
| `E_INSTALL_VERSION_MISMATCH` | GM-4095 | manifest 版本与 Registry 条目不一致 |
| `E_UPDATE_GAME_RUNNING` | GM-4096 | 游戏运行中禁止更新/卸载 |
| `E_UNINSTALL_BUSY` | GM-4097 | 安装/卸载进行中 |
| `E_INSTALL_HASH_MISMATCH` | GM-5015 | 包 SHA-256 与 Registry 不一致 |
| `E_INSTALL_DOWNLOAD_FAILED` | GM-5034 | 下载失败（网络/HTTP 状态） |
| `E_INSTALL_DOWNLOAD_TIMEOUT` | GM-5035 | 下载超时（连接/整体/无数据） |
| `E_INSTALL_IO` | GM-5036 | 安装落盘/事务 I/O 失败 |
| `E_INSTALL_CORRUPT` | GM-5037 | 安装结果不完整/记录损坏 |
| `E_STORE_SCHEMA` / `E_STORE_SCHEMA_NEWER` | GM-4098 | 存储文件 schema 不兼容 |

**V0 既有 GM 码（Host 直接使用）**：`GM-4091`（安装进行中，409）、`GM-4092`（存档 revision 冲突）、`GM-4093`（Session 状态冲突）、`GM-4002`（参数/策略拒绝）、`GM-4005`、`GM-4031/4032/4033`、`GM-4041/4042/4043`、`GM-4131/4132/4133/4134`、`GM-4150`、`GM-4260/4261`、`GM-4290/4291`、`GM-5001/5002/5003/5004/5005`、`GM-5011/5012/5013/5014`、`GM-5021–5025`、`GM-5031/5032/5033`。

HTTP 状态族：`400x→400`、`403x→403`、`404x→404`、`409x→409`、`413x→413`、`414x→413`（磁盘满按 413/507 由 Host 定）、`415x→415`、`422x→422`、`429x→429`、`5000–5029→500`、`5030+→503`；Host 最终状态码以 `host/src/errors.js#statusForGm` 为准（契约要求与 PRD §8.5 一致，`GM-4225`=422）。

### 4.4 `details` 约定（安全）

- 只允许：字段名、枚举值、限制值（bytes/count/version 字符串）、数量、`reason` 枚举、`requestId`、`retryable`。
- 禁止：绝对路径、主机名/IP、堆栈、原始 HTML 片段、游戏存档内容、Prompt/工具参数。
- `message` 是英文诊断短句，不面向最终用户；Client 按 `code` 映射本地化文案。
- 新增错误码的 `details` 约定：manifest 校验带 `field`（如 `score.min`）与可选 `value`；安装类带 `gameId`/`version`/`reason`，不带 URL 与路径。
- HTTP 状态映射见 §4.3；`GM-4225` 必须为 422。

### 4.5 契约测试矩阵

| 测试文件 | 覆盖 | 状态 |
|---|---|---|
| `tests/v1-contracts.test.js` | M0 已冻结表面：版本/路由表/限制/E→GM 映射/legacy V0 兼容/端到端包校验 | **M0 已落地**（见仓库） |
| `tests/v1-manifest.test.js` / `v1-package.test.js` | §3 全字段/条件字段/错误码；§2 文件级约束、manifest 提取、§2.4 扫描 | 建议 M1 补齐（Host/CLI 分支） |
| `tests/v1-registry.test.js` | §5 schema、URL 准入、缓存 TTL/陈旧/离线/截断/304/节流 | 建议 M1 补齐（M1a） |
| `tests/v1-install.test.js` | §6 安装/更新/回滚/卸载/本地安装/并发锁/幂等/失败回滚 | 建议 M1 补齐（M1a） |
| `tests/v1-api.test.js` | §7 路由、信封、状态码、参数校验、幂等 | 建议 M1 补齐（M1a） |
| `tests/v1-sdk.test.js` | §8 签名、ready 时序、写串行、超时、错误码、版本协商 | 建议 M1 补齐（M1b） |
| `games/<id>/test/*.test.js` | §10 + 每款游戏纯逻辑/save roundtrip | M1c |

---

## 5. Registry（静态索引）

实现：`packages/shared/src/registry.js`（校验/URL 准入/allowlist/缓存校验） + Host Registry 服务（拉取/缓存/离线）。Registry 无服务端：一个静态 JSON + 静态包文件。

### 5.1 Registry 索引

| 项 | 规则 |
|---|---|
| 默认位置 | Bundle 内 `registry/games.json`（`REGISTRY_FILE='games.json'`；本地 file Registry） |
| 可配置 | `config.registryUrl`：HTTPS URL 或本地文件路径；默认指向 Bundle 内索引 |
| 大小 | ≤2 MiB（`LIMITS.registryBytes`） |
| 拉取超时 | 连接 10s / 无数据 20s / 整体 120s（与包下载一致） |
| 重定向 | ≤5 跳；每跳重新准入；不得降级 http |
| 编码 | UTF-8 无 BOM，JSON |
| 条目数 | 1–500；>500 → 整个索引非法（`E_REGISTRY_INVALID` → `GM-5032`）；`truncated` 仅作上游已截断标记 |
| 刷新节流 | 用户手动刷新最短间隔 5 分钟（`registryRefreshThrottleMs`），否则 `GM-4290` |

```ts
interface RegistryIndex {
  registryVersion: 1;
  generatedAt: string;          // ISO-8601 UTC，如 "2026-10-18T12:00:00.000Z"
  truncated?: boolean;          // 上游已截断时为 true（可选）
  games: RegistryGame[];
}

interface RegistryGame {
  id: string;                   // §1.2
  name: string;                 // 1–64 码点
  version: string;              // §1.2，无 +
  description: string;          // 1–280 码点，纯文本
  author: { name: string; url?: string };
  categories: string[];         // 1–3，枚举同 manifest
  tags?: string[];              // ≤8，规则同 manifest
  capabilities: Array<'storage' | 'score'>;
  sdkVersion: string;           // 范围语法
  runtimeVersion: string;       // 范围语法
  preferredTheme?: 'system' | 'light' | 'dark' | 'game-defined';
  package: {
    url: string;                // https 或（file Registry）安全相对路径；末段 <id>-<version>.html
    sha256: string;             // 64 位小写 hex，必填
    size: number;               // 整数 1–20971520
    releasedAt: string;         // ISO-8601 UTC
  };
  icon?: string;                // 绝对 https URL（≤1000 字符；Host 缓存）
  cover: string;                // 绝对 https URL；上架必填
  screenshots?: string[];       // ≤5，均为绝对 https URL
  homepage?: string;            // https，≤约 300 字符
  repository?: string;          // https，≤约 300 字符
  license?: string;             // SPDX 风格：^[A-Za-z0-9.+-]{1,64}$
  changelog?: string;           // 纯文本 ≤2000 码点
  featured?: boolean;           // 默认 false
  quickPlay?: boolean;          // 默认 false
  publishedAt: string;          // ISO-8601 UTC，必填
  updatedAt: string;            // ISO-8601 UTC，必填
  i18n?: object;                // 透传（结构见 manifest §3.6）
}
```

规则补充：

1. `id` 在索引内唯一；同一 `id` 只允许一个版本（最新版）。历史版本只通过安装记录/保留目录存在，不出现在 Registry。
2. **整份索引严格校验、不做"跳过坏条目"**（PRD v2.2 §8.8.1）：任一条目的 id/version/sha256/size/url 非法、顶层结构非法、版本/时间戳非法、条目数 >500、重复 id → 整个索引拒绝（`E_REGISTRY_INVALID` → `GM-5032`）并回退到缓存；不接受宽容解析。
3. Registry 元数据与包 manifest 的关系：安装时以 **manifest 为准**；`id`/`version` 必须一致（否则 `E_INSTALL_VERSION_MISMATCH` → `GM-4095`）；`name/description/author/categories/capabilities/sdkVersion/runtimeVersion` 不一致时以 manifest 覆盖并记录 warning，不阻断安装。
4. `featured`/`quickPlay` 只影响排序/入口呈现。
5. 预览资源（icon/cover/screenshots，**仅绝对 https URL**）**不直接交给 Renderer**：Host 下载/解码后写入 `preview-cache/`，由 `/preview` 提供；失败时降级为无图（详情页用 manifest `icon` data URI 或首字母占位）。**下载策略（M1a 落地）**：预览素材只做绝对 https + 公网 IP/SSRF 校验，不套用包下载的 host allowlist；file Registry 不抓取远程预览（离线优先，`/preview` 由已安装 manifest icon 兜底）。
6. `isUpdateAvailable(registryVersion, installedVersion)` 只表示"版本不同、需要新包"；Market 显示 Update 时 Host 用 semver 比较判定更高版本，降级仅允许回到 `previousVersion`（§6.4）。

### 5.2 包 URL 准入

实现：`registry.js#validatePackageUrl` + Host 下载层加固。

| # | 检查 | 规则 | 失败 |
|---|---|---|---|
| U-01 | 来源类型 | `sourceType:'https'`：绝对/相对 https URL；`sourceType:'file'`：仅安全相对路径 | 索引：`E_REGISTRY_INVALID` → `GM-5032`；安装期：`E_INSTALL_URL_REJECTED` → `GM-4034` |
| U-02 | scheme（https Registry） | 解析后必须 `https:`；禁止 `http:`、`file:`、`data:` | `GM-4034` |
| U-03 | userinfo | 禁止 `user:pass@` | `GM-4034` |
| U-04 | 路径末段 | `pathname` 末段必须精确 `<id>-<version>.html` | `GM-5032` / `GM-4034` |
| U-05 | host | 默认 allowlist（精确、大小写不敏感）：`github.com`、`raw.githubusercontent.com`、`objects.githubusercontent.com`；或与 Registry 索引 `sourceUrl` 同 host；或 `config.allowedHosts` 追加 | `GM-4034` |
| U-06 | file Registry 路径 | 安全相对路径：不以 `/` 开头、不含 `\\`、任一段不为 `..`/`.`，末段文件名匹配 | `GM-5032` |
| U-07 | 长度 | 包 URL ≤1000 字符 | `GM-4034` |
| U-08 | 重定向 | ≤5 跳（`PACKAGE_REDIRECTS_MAX`）；初始 URL 执行 U-01..U-07；重定向逐跳复验 scheme/凭据/host/长度（文件名只校验初始 URL）；不得降级 http | `GM-4034` / `GM-5034` |
| U-09 | 下载加固（Host） | 解析后 IP 拒绝回环/私网/链路本地（`devMode:true` 时允许 `127.0.0.1`/`localhost`）；禁止携带凭据；限制并发 | `GM-4034` / `GM-5034` |
| U-10 | 大小/sha | `package.size` 与实际一致且 ≤20 MiB；sha256 与 `package.sha256` 一致（64 位小写 hex） | `GM-5037` / `GM-4135` / `GM-5015` |

> 说明：共享校验器只冻结 scheme/凭据/文件名/host/长度；直连 IP 私网、重定向逐跳、HTTP 状态、超时由 Host 下载层实现（M1a）。`package.url` 的 query/fragment 不参与文件名判定，Host 可按安全策略拒绝。

### 5.3 缓存、TTL 与离线

缓存文件：`registry-cache.json`（原子写 + `.bak`）。

```ts
interface RegistryCacheFile {
  schemaVersion: 1;
  fetchedAt: string;        // 最近一次成功获取或 304 的时间
  sourceUrl: string;        // HTTPS URL 或 file Registry 绝对路径
  etag: string | null;
  lastModified: string | null;
  truncated: boolean;       // 必填
  games: RegistryGame[];    // ≤500
}
```

| 项 | 规则 |
|---|---|
| TTL | 6 小时（`registryTtlMs`）内 fresh |
| 陈旧上限 | 14 天（`registryStaleMs`）；6h–14d 为 stale（可用 + 离线横幅）；>14d 为 expired（不展示远程目录，仅已安装/内置） |
| 离线回退 | 拉取失败保留旧缓存；Market 显示离线横幅；已安装游戏可玩；安装/更新按钮禁用并说明 |
| 无缓存 | `registry.state='missing'`；仅展示内置/已安装；不阻塞启动 |
| 条件请求 | 保存并发送 `If-None-Match`/`If-Modified-Since`；304 只刷新 `fetchedAt` 并重置 TTL |
| 刷新时机 | Host 启动：缓存缺失或超过 TTL → 后台刷新一次（不阻塞）；`POST /registry-refresh` 强制（受 5 分钟节流）；Market stale 时 Client 触发一次 |
| 并发 | 同一时刻一个刷新；并发请求合并同一 Promise；跨进程用 HostStorage 锁 |
| 校验 | 读取缓存时用 `validateRegistryCache`；非法缓存按 `GM-5032` 离线处理，不删除文件 |
| 写入失败 | 保留旧缓存；错误进日志；`/health.registry.lastError` 只放 GM 码 |
| 失效 | 卸载不删缓存；`registryUrl` 变更时清空缓存并重新拉取 |

### 5.4 Host 配置项（V1 全集）

```ts
interface GameMarketConfig {
  devMode?: boolean;                 // 默认 false；开启 devGameRoots 与 /dev/agent-state
  dataRoot?: string;                 // 默认 $DSH_HOME/storages/dsh-game-market
  builtinGamesRoot?: string;         // 默认 Bundle 内 games/
  registryUrl?: string;              // 默认 Bundle 内 registry/games.json（file Registry）
  allowedHosts?: string[];           // 追加包/预览 host；精确匹配；默认 DEFAULT_ALLOWED_HOSTS
  frameAncestors?: string[];         // CSP frame-ancestors allowlist；默认见 TBD-05
  devGameRoots?: string[];           // 仅 devMode
}
```

配置非法时不阻止插件启动：逐项回退默认值，并在 `/health` 的 `configIssues` 与日志中给出错误（不含敏感路径内容）。

### 5.5 本地 file Registry

| 项 | 规则 |
|---|---|
| 触发 | `config.registryUrl` 指向本地 `games.json`（默认 Bundle 内文件） |
| 包路径 | 只允许 Registry 目录内安全相对路径（U-06）；Host resolve 后必须仍在 Registry 目录内（realpath 防符号链接） |
| 校验 | 与远程 Registry 相同：sha256/size/文件名校验；索引 ≤2 MiB、≤500 条 |
| 刷新 | 读取文件 mtime/内容；`/registry-refresh` 重新读取；无网络也可用 |
| sourceUrl | 缓存中记录绝对文件路径；不参与 allowlist 判定 |

## 6. 存储与安装模型

实现：`packages/shared/src/installation.js`（布局常量/记录校验/清理规则） + Host 存储服务（M1a）。

### 6.1 目录树（固定布局）

根：`$DSH_HOME/storages/dsh-game-market/`（默认 `~/.dsh/storages/dsh-game-market/`；`$DSH_HOME` 缺省时为 `~/.dsh`；目录权限 0700）。

```text
$DSH_HOME/storages/dsh-game-market/
├── installations.json                       # 安装记录（schemaVersion:1）
├── preferences.json                         # 平台 UI 偏好（schemaVersion:1）
├── registry-cache.json                      # Registry 缓存（schemaVersion:1）
├── preview-cache/<id>/<version>/            # 预览图缓存（icon/cover/screenshot-N）
├── packages/<id>/<version>/entry.html       # 已安装单文件包（只读）
├── saves/<id>/current.json                  # 存档信封（原子写 + .bak）
├── saves/<id>/meta.json                     # 存档元信息（Continue 判定）
├── sessions/<id>.json                       # Play Session 记录
├── scores/<id>.json                         # 个人最高分与历史
├── staging/<jobId>/entry.html.part          # 安装临时文件（下载中；job 状态见 §6.3）
├── staging/.install.lock                    # 全局安装锁（内部文件；建议实现，TBD-07）
├── trash/<id>-<ts>/                         # 卸载/清理的软删除目录（<ts>=UTC compact）
└── logs/market.log                          # 运行日志（JSON Lines，轮转）
```

布局常量（`installation.js`，Host 必须复用，不得自行拼字符串）：

| 常量 | 值 |
|---|---|
| `PACKAGES_DIR` / `ENTRY_FILE` | `packages` / `entry.html` |
| `SAVES_DIR` / `SESSIONS_DIR` / `SCORES_DIR` | `saves` / `sessions` / `scores` |
| `PREVIEW_CACHE_DIR` / `STAGING_DIR` / `TRASH_DIR` / `LOGS_DIR` | `preview-cache` / `staging` / `trash` / `logs` |
| `INSTALLATIONS_FILE` / `PREFERENCES_FILE` | `installations.json` / `preferences.json` |
| `LOG_FILE` | `market.log` |
| `INSTALLATIONS_SCHEMA_VERSION` | `1` |
| `KEPT_PREVIOUS_VERSIONS` | `1`（current + 1 previous） |
| `INSTALL_SOURCES` | `registry` / `local` / `dev` / `builtin` |
| `INSTALL_JOB_STATES` | `queued` / `downloading` / `verifying` / `installing` / `installed` / `failed`（Host 内部进度状态） |
| `COMPAT_STATUSES` | `ok` / `incompatible` / `broken` |

约束：

- 所有路径由 Host 在根内 resolve；越界目标 → `GM-4002`/`GM-4222`/`GM-5036`，绝不写到根外。
- `packages/`、`saves/`、`sessions/`、`scores/`、`trash/`、`staging/` 均拒绝符号链接入口。
- `logs/market.log` 单文件 ≤2 MiB，轮转为 `market.log.1`；遵循 §4.4 脱敏（无 Prompt、无绝对路径、无存档值）。

### 6.2 `installations.json`

```ts
interface InstallationsFile {
  schemaVersion: 1;
  updatedAt: string;                                  // ISO-8601 UTC
  games: Record<string, InstallationRecord>;          // key = id
}

interface InstallationRecord {
  // ---- 校验器强制字段（installation.js#validateInstallationsFile）----
  id: string;
  version: string;                                    // 当前生效版本，semver
  source: 'registry' | 'local' | 'dev' | 'builtin';
  packagePath: string;                                // 必须 === "<id>/<version>"（相对 packages/）
  sha256: string | null;                              // registry 必填 64 位小写 hex；local/dev/builtin 为 null
  sizeBytes: number;                                  // 0..20 MiB
  previousVersion: string | null;                     // 回滚保留的上一版本（仅 1 个）
  compatibility: {
    status: 'ok' | 'incompatible' | 'broken';
    sdkVersion?: string;                              // 安装时平台实际版本
    runtimeVersion?: string;
    sdkRange?: string;                                // manifest 范围
    runtimeRange?: string;
    checkedAt?: string;
    reasons?: string[];
  };
  update: {
    available: boolean;                               // 是否有可用更新（Host 判定更高版本）
    latestVersion?: string | null;
    checkedAt?: string | null;
    reason?: string | null;                           // 'incompatible' 等
  };
  lastPlayedAt: string | null;
  playCount: number;                                  // ≥0 整数
  totalPlayMinutes: number;                           // ≥0 数字

  // ---- Host 可补充字段（校验器保留、不强制）----
  installedAt?: string;
  updatedAt?: string;
  manifest?: ManifestSnapshot;                        // 安装时规范化的 manifest（icon 置 null）
  iconPath?: string | null;                           // preview-cache 内的相对路径
}
```

规则：

1. `entry.html` 路径由 `entryStoragePath(id, version)` 派生，不写进记录；`packagePath` 只是 `<id>/<version>`（防止包内路径注入）。
2. `manifest` 快照保存 manifest 的 `icon` data URI（≤256 KiB，非权威快照）；Registry 封面/截图只在安装时记缓存文件名（`cover`），不内联；`installations.json` 读取上限 8 MiB。
3. 顶层 `schemaVersion` 高于 `SUPPORTED_INSTALL_SCHEMA_VERSION` → 只读/拒绝（`E_STORE_SCHEMA_NEWER` → `GM-4098`），不迁移、不丢数据。
4. 同一 id 只保留**当前版本 + 1 个旧版本**（`previousVersion`）；清理用 `versionsToPrune`（current + 1）。
5. 内置游戏（`snake`）**不写** installations.json（TBD-09 裁决）；dev 游戏**也不写** installations.json（与 §6.7 一致）：Host 扫描 `devGameRoots` 并在 `/games` 合成 `source:'dev'`、`dev:true` 条目，`/installed` 不含 dev；内置不可卸载/更新。
6. 本地/dev 安装 `sha256:null`；V1 不对本地包做完整性承诺，Client 必须二次确认。

### 6.3 安装流程（`POST /install`，registry 来源）

Host 内部 job 状态机：`queued → downloading → verifying → installing → installed|failed`（不暴露查询路由，TBD-08）。

| 步 | 动作 | 关键规则 | 失败映射 |
|---|---|---|---|
| 1 | 请求校验 | `gameId`/`operationId`/可选 `version`；JSON ≤1 MiB | `GM-4001/4002/4005` |
| 2 | 幂等/锁 | 同 operationId 已完成 → 返回缓存结果；全局安装锁忙 → 排队最多 10s（`installLockWaitMs`），仍忙 → `GM-4091` | `GM-4091` |
| 3 | 解析条目 | 从缓存/Registry 解析目标条目与版本；不存在 → `GM-4044`；版本策略冲突 → `GM-4094` | `GM-4044/4094` |
| 4 | 预检 | 已安装同版本同 sha256 → 幂等成功（`changed:false`）；**活跃 Runtime 实例**存在时更新 → `GM-4096`（未结束 Session 不算）；兼容性检查 | `GM-4096/4260/4261` |
| 5 | URL 准入 | §5.2 全表；创建 `staging/<jobId>/` | `GM-4034/4035/5032` |
| 6 | 下载 | 连接 10s / 无数据 20s / 整体 120s；写入 `entry.html.part`，边下边算 sha256；≤20 MiB；重定向 ≤5 | `GM-5034/5035/4135/4034` |
| 7 | 暂存 rename | `entry.html.part` → `staging/<jobId>/entry.html`（同目录 rename） | `GM-5036` |
| 8 | 完整性/格式 | sha256 与 Registry 一致；大小与 `package.size` 一致；UTF-8 无 BOM/HTML 文档 | `GM-5015/5037/4221/4150` |
| 9 | 解析与校验 | manifest 提取/schema §3、自包含 §2.4、id/version 与条目一致、能力、兼容性 | `GM-4221/4225/4228/4229/4230–4248/4260/4261/4095` |
| 10 | 原子落位 | rename 到 `packages/<id>/<version>/entry.html`；目录 fsync；预算 30s（`installMoveMs`） | `GM-5036` |
| 11 | 写安装记录 | 原子写 `installations.json`（含 §6.2 字段；`previousVersion` 更新；保留策略见 §6.4）；预算 15s（`installVerifyMs`） | `GM-5036/4092` |
| 12 | 清理 | 删除 staging、超保留策略旧版本、写日志、释放锁 | 清理失败进 `trash/`，下次启动重试 |

说明：V1 的 `/install` 为**同步**调用（无异步 job 路由）；Client 展示不确定进度，请求超时建议 130s。失败时不得产生半安装：`packages/` 无新目录、`installations.json` 不变、staging 清理。

### 6.4 更新与回滚

| 规则 | 内容 |
|---|---|
| 更新判定 | `isUpdateAvailable(registryVersion, installedVersion)` = 版本不同；Market 仅在 Registry 版本**更高**时显示 Update（Host 用 semver 比较），不自动安装 |
| 更新前提 | 该游戏无 `outcome:'running'` 的 Play Session，且本进程无活跃 Runtime 实例；否则 `GM-4096` |
| 同版本冲突 | 已安装同版本但 Registry sha256 不同 → `GM-4094`（除非重新安装本地包） |
| 保留策略 | 成功后保留 current + 1 previous（2 个版本目录）；更旧目录删除（`versionsToPrune`） |
| `previousVersion` | 写入被替换的版本字符串；回滚/降级目标只能是该版本 |
| 存档 | 更新不删存档/成绩；`save.schemaVersion` 升高 → 安装响应 `warnings:['save-schema-upgrade']`，Market 需在安装前二次确认 |
| 存档版本过高 | 若 `saves/<id>/meta.json.saveSchemaVersion > 新版本 save.schemaVersion` → `warnings:['save-schema-too-new']`，允许安装但该存档可能 `GM-4099` |
| 失败回滚 | 安装事务任一失败 → 旧版本目录/记录保持可用；新版本目录清理；staging 清理 |
| 手动回滚 | V1 无独立回滚 API/UI；允许重新安装 `previousVersion`（Registry 指向旧版本或 `/install-local` 旧包）；仅允许降到 `previousVersion`，其他降级 `GM-4094` |
| 降级限制 | 存档 schema 高于目标游戏 → 运行前提示；不自动迁移/删除存档 |

### 6.5 卸载（`POST /uninstall`）

| 规则 | 内容 |
|---|---|
| 内置游戏 | 不可卸载（`E_UNINSTALL_BUILTIN` → `GM-4038`，`reason:'builtin'`） |
| 运行中 | **活跃 Runtime 实例**（`/launch` 后未收到 `/runtime-release`）→ `GM-4096`；**未结束的 Play Session 不算运行中**（它是 Continue 的依据，不阻塞更新/卸载）；其他安装/卸载进行中 → `GM-4097` |
| 默认行为 | 删除安装目录与安装记录；**保留** `saves/`、`scores/`、`sessions/` 与 `preferences` 历史；重新安装后可 Continue |
| `deleteData:true` | 需二次确认：请求必须带 `confirmDataDeletion:true`；否则 `GM-4002`；确认后删除该游戏存档/成绩/Session/预览缓存 |
| 软删除 | 目录先移动到 `trash/<id>-<ts>/`，`installations.json` 原子更新后再清理 trash；清理失败保留 trash，下次启动清理超过 7 天的 trash |
| 幂等 | 未安装的游戏 → 200 `{removed:false, ignored:true}`（不报错）；同 operationId 重复 → 返回同一结果 |
| 缓存 | Registry 缓存不因卸载变化；`preferences.lastPlayedGameId` 若指向被删游戏则清空 |

### 6.6 本地安装（`POST /install-local`）

| 项 | 规则 |
|---|---|
| Content-Type | `text/html`（允许 `;charset=utf-8`），否则 `GM-4150` |
| 大小 | ≤20 MiB（stream 限制；超限 `GM-4135`） |
| 参数 | query：`operationId`（可选但建议）；包内 manifest 提供 id/version |
| 来源 | `source:'local'`；`sha256:null`；`sizeBytes` 记录实际字节 |
| 校验 | 与 registry 安装相同的文件级/manifest/自包含/兼容性校验；**不**做 SHA/size 与 Registry 比对 |
| 二次确认 | Client 必须先弹确认（本地文件来源不可验证）；Host 不强制校验确认 |
| 重复安装 | 同 id+version 本地重装 → 原子覆盖，`changed:true`；版本不同走 §6.4 规则 |
| 离线 | 可用（不需要网络） |
| 文件名 | 不强制 `<id>-<version>.html`（内容 manifest 为准）；但仍拒绝路径类输入（raw body 无文件名） |

### 6.7 开发模式（`devGameRoots`）

| 项 | 规则 |
|---|---|
| 开关 | `config.devMode === true` 且 `config.devGameRoots` 非空；否则忽略 |
| 结构 | 每个 root 下每个子目录 `<id>/` 最多一个 `.html`（推荐 `<id>-<version>.html`）；manifest 必须内嵌 |
| 行为 | **不复制**到 `packages/`、不写 `installations.json`；每次 `/games`、`/launch` 读取并校验 manifest |
| 展示 | `/games` 返回 `source:'dev'`, `dev:true`；`/installed` 不含 dev 条目 |
| 服务 | `/entry` 直接服务 dev 根内文件；仍执行 manifest/自包含/兼容性/CSP/摘要计算 |
| 安全 | root 必须存在；文件 resolve 后必须落在 root 内；不跟随符号链接越界 |
| 模拟 | `POST /dev/agent-state` 仅在 devMode 注册 |

### 6.8 并发、幂等与失败回滚

| 主题 | 规则 |
|---|---|
| 全局安装串行锁 | 所有安装/卸载（registry/local）串行：进程内队列 + 跨进程锁（建议 `staging/.install.lock`，TBD-07）；排队 10s 后仍忙 → 409 `GM-4091`（retryable）；安装/卸载互斥时另一请求 → `GM-4097` |
| operationId 幂等 | 安装/卸载/分数/存档/Session 写操作均支持：同 operationId 且参数一致 → 返回首次成功结果；参数不一致 → `GM-4002`；缓存内存 LRU ≤200 条、TTL 10 分钟；重启后靠"同版本同 sha256 幂等"兜底 |
| 同版本同 sha256 | 已安装 → 不重复下载/落盘，返回 `{changed:false}` |
| 失败不留半安装 | 校验/下载/落位任一失败 → staging 清理、`packages/` 无新目录、`installations.json` 不变 |
| 崩溃恢复 | Host 启动清理超过 24h 的 staging；trash 超 7 天清理；目录与记录不一致（有目录无记录）→ 移入 trash 并记日志 |
| 多 profile 共享 | 同一 `$DSH_HOME` 多 Host 进程共享目录：写操作走 HostStorage 跨进程锁；安装走全局安装锁（D-033） |

### 6.9 内置游戏（`snake`）

| 项 | 规则 |
|---|---|
| 来源 | Bundle `games/snake/`；V1 构建产物为单文件含内嵌 manifest（`sdkVersion:"^1.0.0"`） |
| 安装记录 | **不写** `installations.json`（TBD-09 裁决）；内置游戏由 Host 从 `games/snake` 直接服务，列表合成为 `source:'builtin'`、不可卸载/更新 |
| 入口 | `/entry` 服务 Bundle 内 `games/snake/dist/index.html`（V0 构建产物，V1 沿用；内置产物无 Registry 包命名要求） |
| 更新 | 随 Bundle 版本更新，不走 Registry；Registry 可放同名 `snake` 包用于安装流程测试，但 Host 拒绝覆盖内置（`GM-4002`） |
| 一致性 | 内置 manifest 与内嵌 manifest 必须一致（构建检查） |

## 7. HTTP API

### 7.1 通用规则

| 项 | 规则 |
|---|---|
| base | `/api/game-market`（同源，相对路径 `api/game-market/...`） |
| 方法 | 仅 `GET`/`HEAD`/`POST`；写操作一律 POST；其他方法 → `GM-4004`（HTTP 400；V0 既有映射） |
| 路由匹配 | 精确 pathname；参数走 query/body |
| 成功信封 | `{ "ok": true, "data": <payload>, "requestId": "req_*", "serverTime": "<ISO>" }` |
| 失败信封 | `{ "ok": false, "error": { "code": "GM-*", "message": "...", "retryable": bool, "details"?: {...} }, "requestId": "...", "serverTime": "..." }` |
| JSON body | 默认 ≤1 MiB（`application/json`）；超限 `GM-4131`；非法 JSON `GM-4001` |
| 例外 | `POST /install-local` 为 raw `text/html` ≤20 MiB，**不**走 JSON body 解析（实现需对该路由特判，先于通用 JSON 读取） |
| 响应头 | JSON：`content-type: application/json; charset=utf-8`、`cache-control: no-store`、`x-request-id` |
| 资源路由 | `/entry`、`/preview` 返回原始字节（非 JSON 信封），错误仍返回 JSON 信封 |
| 重试 | `retryable:true` 时 Client 可重试；429/503 带 `retry-after: 1` |
| 鉴权 | V1 无鉴权，依赖 DSH Host 同源/本地边界；不新增 CORS 放开 |

### 7.2 路由总表

| 方法与路径 | 参数 | 成功 `data` | 幂等 | 客户端超时建议 | 主要错误 |
|---|---|---|---|---|---|
| `GET /health`（HEAD 同） | — | `HealthSnapshot`（§7.3） | 是（只读） | 3s | GM-5031 |
| `GET /games` | `q?`(≤100) `category?`(枚举) `cursor?` `limit?`(1–50, 默认 20) | `{items: GameSummary[], nextCursor: string 或 null, source: 'builtin' / 'market' / 'merged', refreshedAt: string}`（Host 可追加 `registry` 状态供离线横幅） | 是 | 5s | GM-4002、GM-5032（离线仍返回数据） |
| `GET /game` | `id`(必填) | `{game: GameDetail, installed: InstallationView 或 null, canContinue, bestScore, activePlaySession, registry: RegistryGame 或 null}`（§7.3） | 是 | 5s | GM-4005、GM-4042 |
| `GET /installed` | — | `{items: GameSummary[]}`（不含 dev；含 builtin） | 是 | 5s | GM-5024/5025 |
| `POST /install` | body `{gameId, version?, operationId}` | `{gameId, version, sha256: string 或 null, installedAt, changed: boolean}`（Host 可追加 `installation`/`warnings`） | operationId；同版本同 sha256 幂等 | 130s | GM-4034/4035/4044/4091/4094/4095/4096/4097/4135/4221/4222/4225/4228/4229/4230–4248/4260/4261/5015/5032/5034–5037 |
| `POST /install-local` | query `operationId?`；body raw `text/html` ≤20 MiB | `{gameId, version, installedAt, changed: boolean, source:'local'}`（Host 可追加 `installation`/`warnings`） | operationId | 30s | GM-4002/4135/4150/4221/4225/4228/4229/4230–4248/4260/4261/5036/5037 |
| `POST /uninstall` | body `{gameId, deleteData?, confirmDataDeletion?, operationId}` | `{gameId, removed: boolean, dataDeleted: boolean}` | operationId；未安装幂等 | 10s | GM-4002/4037/4038/4096/4097/5036 |
| `POST /registry-refresh` | body `{operationId?, force?}` | `{refreshedAt, count, etag: string 或 null, source: string}`（Host 可追加 `truncated`/`changed`） | 并发合并；5 分钟节流 | 30s | GM-4290（节流）、GM-5032 |
| `GET /save` | `gameId` `include?`（`data`） | `{gameId, keys, bytes, revision, updatedAt, values?}` | 是 | 3s | GM-4041/4098/5024/5025 |
| `POST /save` | body `{gameId, key, data, expectedRevision?, operationId}`；`data:null`=删除 key | `{gameId, key, keys, bytes, revision, updatedAt, removed?}` | operationId + `expectedRevision` CAS | 6s | GM-4092/4131/4132/4133/4134/4099/5024/5025 |
| `POST /session` | body `{gameId, action:'start' 或 'end', dshSessionId?, playSessionId?, outcome?, score?, operationId}` | start：`{playSessionId, startedAt, adopted}`；end：`{playSessionId, startedAt, endedAt, outcome, score, ignored}` | operationId；start 采用未结束 Session；end 对已结束幂等 | 4s/6s | GM-4002/4093/4042 |
| `GET /scores` | `gameId` | `{best: {value, achievedAt, playSessionId, meta?} 或 null, history: [...], direction}` | 是 | 3s | GM-4005/4042/5022 |
| `POST /score` | body `{gameId, score, meta?, playSessionId?, operationId}` | `{best, isBest, submittedAt}` | operationId | 4s | GM-4006/4032/4002/4131/4092 |
| `GET /preferences` | — | `Preferences`（V0 schema 1） | 是 | 5s | GM-5024/5025 |
| `POST /preferences` | body partial Preferences | 合并后的 `Preferences` | 合并写（无需 operationId） | 5s | GM-4002/4098/5024/5025 |
| `GET /agent-state` | `sessionId`(必填) | `AgentSnapshot`（§9.1），支持 ETag/304 | 是 | 3s | GM-4002 |
| `POST /agent-ack` | body `{sessionId, seq}` | `{state, seq}` | 是（seq 幂等） | 3s | GM-4002 |
| `POST /launch` | body `{gameId, version?, dshSessionId?, mode?: 'start' 或 'resume-paused'}` | `LaunchInfo`（§7.3） | 否（每次新 instance） | 5s | GM-4042/4043/4260/4261/4093 |
| `POST /runtime-release` | body `{gameId}` | `{gameId, released}` | 是（重复 release 幂等） | 2s | GM-4002 |
| `GET /entry`（HEAD 同） | `gameId` `version` `instance` `nonce` | raw HTML + 安全头（§7.4） | 是（只读；绑定校验） | 20s | GM-4002/4042/4043/4221/4225/5015 |
| `GET /preview`（HEAD 同） | `gameId` `version?` `file`（icon/cover/screenshot-N） | 图片字节（png/webp/jpeg）+ 头 | 是 | 10s | GM-4043/4002 |
| `POST /dev/agent-state`（仅 devMode） | body `{sessionId, state, label?, labelKey?, turnId?}` | `AgentSnapshot` | 否（状态写入） | 3s | GM-4002/GM-4042（非 devMode 路由不存在） |

### 7.3 关键数据结构

```ts
interface HealthSnapshot {
  ok: boolean;
  version: string;                 // Bundle 版本
  hostEpoch: string;               // he_*
  devMode: boolean;
  storage: { ok: boolean; root: string; readOnly: boolean };
  uptimeMs: number;
  registry: {
    state: 'fresh' | 'stale' | 'expired' | 'missing' | 'offline';
    sourceUrl: string | null;
    fetchedAt: string | null;
    truncated: boolean;
    count: number;
    lastError: string | null;      // GM code，不含路径
  };
  installations: { count: number; updateAvailable: number };
  sessions: { running: number; staleRunningPreserved: true };
  configIssues?: string[];
}

interface GameSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  author: { name: string; url?: string };
  categories: string[];
  tags: string[];
  capabilities: Array<'storage' | 'score'>;
  sdkVersion: string;
  runtimeVersion: string;
  icon: string | null;             // /api/game-market/preview?... URL 或 null
  cover: string | null;            // /api/game-market/preview?... URL 或 null
  screenshots: string[];           // /api/game-market/preview?... URL 列表
  homepage: string | null;
  repository: string | null;
  license: string | null;
  changelog: string | null;
  featured: boolean;
  quickPlay: boolean;
  publishedAt: string | null;      // builtin/dev 为 null
  updatedAt: string | null;
  source: 'builtin' | 'registry' | 'local' | 'dev';
  dev: boolean;
  installedVersion: string | null;
  updateAvailable: boolean;
  canContinue: boolean;
  bestScore: number | null;
  lastPlayedAt: string | null;
  compatibility: { ok: boolean; reason: string | null }; // 当前平台能否安装/运行
}

interface GameDetail extends GameSummary {
  activePlaySession: { playSessionId: string; startedAt: string } | null;
  saveInfo: { saveSchemaVersion: number; savedAt: string | null } | null;
  preferredTheme: 'system' | 'light' | 'dark' | 'game-defined';
  i18n: object | null;                        // 透传 Registry/manifest 的 i18n
}

interface CompatibilitySnapshot {
  status: 'ok' | 'incompatible' | 'broken';
  sdkVersion?: string;
  runtimeVersion?: string;
  sdkRange?: string;
  runtimeRange?: string;
  checkedAt?: string;
  reasons?: string[];
}

interface UpdateSnapshot {
  available: boolean;
  latestVersion?: string | null;
  checkedAt?: string | null;
  reason?: string | null;
}

interface InstallationView {
  id: string;
  version: string;
  source: 'registry' | 'local' | 'dev' | 'builtin';
  packagePath: string;              // "<id>/<version>"（相对 packages/；entry=packages/<id>/<version>/entry.html）
  sha256: string | null;            // local/dev/builtin 为 null
  sizeBytes: number;
  previousVersion: string | null;
  installedAt: string;
  updatedAt: string;
  manifest: ManifestSnapshot;
  compatibility: CompatibilitySnapshot;
  update: UpdateSnapshot;
  warnings: string[];
}

interface LaunchInfo {
  instanceId: string;              // 32 hex
  nonce: string;                   // 32 hex
  entryUrl: string;                // /api/game-market/entry?...
  preview: { icon: string | null; cover: string | null };   // 均指向同源 /preview URL；无则 null
  runtimeVersion: string;          // 1.0.0
  sdkVersion: string;              // 1.0.0
  protocolVersion: 1;
  gameId: string;
  gameVersion: string;
  capabilities: Array<'storage' | 'score'>;
  limits: { saveBytes: number; saveKeys: number; scoreMetaBytes: number };
  viewport: { width: number; height: number; fit: 'contain' };
  hostEpoch: string;
  mode: 'start' | 'resume-paused';
  entrySha256: string;             // 启动前计算的包摘要
}
```

### 7.3.1 `/runtime-release`（运行态归属）

- Client 在 Runtime 卸载/离开（返回工作、返回市场、面板被替换、插件停用）时调用 `POST /runtime-release {gameId}`，Host 删除该游戏的 live instance 绑定。
- 语义：`/launch` 产生的实例在 release 前视为“运行中”，阻止更新/卸载；未结束的 Play Session 只是 Continue 依据，**不再**阻止更新/卸载。
- 幂等：重复 release 返回 `released: 0`；Host 重启后实例表为空。

### 7.3.2 `launchMode` 随 init 显式下发（M1 hotfix）

- Runtime 在 `init` 事件中额外发送 `launchMode`（等于 `/launch` 的 `mode`）；SDK 暴露为 `game.runtime.launchMode`。
- 原因：平台 `resume-paused` 启动会额外发 `pause` 生命周期事件，但桌面端（Electron）存在事件时序差异；游戏不能只靠 `pause` 判断是否隐藏自己的“继续/开始”界面。
- 规约：`launchMode === 'resume-paused'` 时，平台弹窗是**唯一**确认层；游戏应直接恢复存档并保持暂停，等平台 `resume` 后开玩。`start` 时按原逻辑展示游戏自己的开始界面。

### 7.4 资源路由：`/entry` 与 `/preview`

**`GET|HEAD /entry`** 查询参数：`gameId`、`version`、`instance`（32 hex）、`nonce`（32 hex）。

复合校验（全部通过才返回 200）：

1. **绑定**：`instance` 必须由本 Host 最近一次 `/launch` 创建，且 `nonce`、`gameId`、`version` 与绑定记录一致；绑定默认 10 分钟过期（TBD-10）；无效 → `GM-4002`。
2. **摘要**：读取 `packages/<id>/<version>/entry.html`（或 dev/builtin 对应文件），重算 SHA-256；与安装记录 `sha256` 比较（local/dev 无记录 sha 时跳过与记录比较，但仍计算响应头）；不一致 → `GM-5015`。
3. **大小/存在性**：≤20 MiB（`GM-4135`）；读取失败/文件缺失 → `GM-4043`。

响应头（V1 精确要求）：

```http
content-type: text/html; charset=utf-8
content-length: <bytes>
cache-control: no-store
x-content-type-options: nosniff
referrer-policy: no-referrer
content-security-policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-ancestors <allowlist>
x-entry-sha256: <sha256 lowercase hex>
x-entry-version: <version>
```

- `frame-ancestors` 来自 `config.frameAncestors`（可配置 allowlist；禁止 `*`、`data:`、`blob:`；每项 ≤256 字符，≤16 项）。V0 的 `*` 在 V1 收紧；默认值见 TBD-05。
- 该 CSP 比 V0 更严：不允许 `blob:`、外部 `font-src`/`media-src`；游戏必须用系统字体、data URI 图片、WebAudio。
- `HEAD` 返回与 GET 相同的头，无 body。
- 错误响应仍为 JSON 信封（含 requestId），不返回空 500。

**`GET|HEAD /preview`** 查询参数：`gameId`、`version?`、`file`（`icon` | `cover` | `screenshot-1`…`screenshot-5`）。

| 项 | 规则 |
|---|---|
| 来源 | `preview-cache/<id>/<version>/`（Registry 预览图缓存）或已安装包 manifest.icon；不得直接代理远程 URL |
| 类型 | `image/png`、`image/webp`、`image/jpeg` |
| 大小 | 单图 ≤2 MiB（与 V0 preview 上限一致） |
| 响应头 | `content-type`、`cache-control: public, max-age=31536000, immutable`（按版本内容寻址）、`x-content-type-options: nosniff`、`referrer-policy: no-referrer`、`etag` |
| 错误 | `GM-4043`（不存在/未声明） |
| 安全 | file 参数必须在白名单内；resolve 后必须在 preview-cache/packages 内；不读取任意文件 |

### 7.5 示例

**成功信封（`GET /health`）**

```json
{
  "ok": true,
  "data": {
    "ok": true,
    "version": "1.0.0",
    "hostEpoch": "he_0123456789abcdef",
    "devMode": false,
    "storage": { "ok": true, "root": "/Users/<user>/.dsh/storages/dsh-game-market", "readOnly": false },
    "uptimeMs": 123456,
    "registry": {
      "state": "fresh",
      "sourceUrl": "https://raw.githubusercontent.com/heswy/dsh-game-market/main/registry/games.json",
      "fetchedAt": "2026-10-18T12:00:00.000Z",
      "truncated": false,
      "count": 3,
      "lastError": null
    },
    "installations": { "count": 1, "updateAvailable": 0 },
    "sessions": { "running": 0, "staleRunningPreserved": true }
  },
  "requestId": "req_0123456789abcdef",
  "serverTime": "2026-10-18T12:00:01.000Z"
}
```

**失败信封（sha256 不匹配）**

```json
{
  "ok": false,
  "error": {
    "code": "GM-5014",
    "message": "Game files failed integrity check",
    "retryable": true,
    "details": { "reason": "sha256", "expected": "…", "actual": "…" }
  },
  "requestId": "req_abcdef0123456789",
  "serverTime": "2026-10-18T12:00:02.000Z"
}
```

**安装成功（节选）**

```json
{
  "ok": true,
  "data": {
    "changed": true,
    "warnings": [],
    "installation": {
      "id": "jump",
      "version": "1.0.0",
      "source": "registry",
      "packagePath": "jump/1.0.0",
      "sha256": "64f1…",
      "sizeBytes": 482133,
      "previousVersion": null,
      "installedAt": "2026-10-18T12:01:00.000Z",
      "updatedAt": "2026-10-18T12:01:00.000Z",
      "compatibility": { "status": "ok", "sdkVersion": "1.0.0", "runtimeVersion": "1.0.0", "sdkRange": "^1.0.0", "runtimeRange": "^1.0.0", "checkedAt": "2026-10-18T12:01:00.000Z", "reasons": [] },
      "update": { "available": false, "latestVersion": "1.0.0", "checkedAt": "2026-10-18T12:01:00.000Z", "reason": null }
    }
  },
  "requestId": "req_…",
  "serverTime": "2026-10-18T12:01:00.000Z"
}
```

**本地安装请求**

```http
POST /api/game-market/install-local?operationId=local-20261018-1
Content-Type: text/html; charset=utf-8
Content-Length: 123456

<!doctype html>…
```

---

## 8. SDK v1

### 8.1 公开面

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type Capability = 'storage' | 'score';
type LifecycleEvent = 'pause' | 'resume' | 'hidden' | 'visible' | 'before-save';
type ScoreDirection = 'higher-better' | 'lower-better';

interface GameRuntimeInfo {
  readonly sdkVersion: string;          // '1.0.0'
  readonly protocolVersion: number;     // 1
  readonly runtimeVersion: string | null; // '1.0.0'；ready 前为 null（PRD §8.3）
  readonly gameId: string;
  readonly gameVersion: string;
  readonly launchMode: 'start' | 'resume-paused'; // init 显式下发；见 §7.3.2
  readonly locale: string;              // 随 DSH 界面语言，如 'zh-CN' / 'en-US'
  readonly theme: 'light' | 'dark';
  readonly reducedMotion: boolean;
  readonly capabilities: readonly Capability[];
  readonly viewport: Readonly<{ width: number; height: number; dpr: number }>; // 可用内容区（fit 后）
  readonly ready: boolean;              // ready() 完成后为 true
}

interface StorageSaveResult { key: string; bytes: number; revision: number; updatedAt: string | null }
interface StorageLoadResult { key: string; data: JsonValue; revision: number; updatedAt: string | null }
interface StorageRemoveResult { key: string; removed: true; revision: number }

interface SessionStartResult { playSessionId: string | null; startedAt: string | null; adopted: boolean }
interface SessionEndResult {
  playSessionId: string;
  startedAt: string;
  endedAt: string;
  outcome: 'completed' | 'lost' | 'abandoned' | 'quit';
  score: number | null;
  ignored: boolean;
}

interface ScoreSubmitResult { best: number | null; isBest: boolean; submittedAt: string | null }
interface ScoreBestResult { score: number; achievedAt: string | null; meta: JsonValue | null }

interface AgentSnapshot {
  state: 'idle' | 'running' | 'waiting-user' | 'completed' | 'error';
  label: string;                        // 本地化展示文案（游戏不得解析）
  labelKey: string | null;              // 稳定 key（V1 提供）
  sessionId: string | null;
  updatedAt: string;
  source: 'turn' | 'tool' | 'approval' | 'question' | 'lifecycle' | 'restore';
  seq: number;
  since: string;
  turnId: string | null;
}

interface GameSDK {
  readonly runtime: GameRuntimeInfo;
  ready(timeoutMs?: number): Promise<GameRuntimeInfo>;                   // 默认 10000
  readonly storage: {
    save(key: string, data: JsonValue): Promise<StorageSaveResult>;
    load(key: string): Promise<StorageLoadResult | null>;
    remove(key: string): Promise<StorageRemoveResult>;
  };
  readonly session: {
    start(): Promise<SessionStartResult>;
    end(options?: { outcome?: SessionEndResult['outcome']; score?: number | null }): Promise<SessionEndResult | null>;
  };
  readonly score: {
    submit(score: number, meta?: JsonValue): Promise<ScoreSubmitResult>;
    getBest(): Promise<ScoreBestResult | null>;
  };
  readonly lifecycle: {
    on(event: LifecycleEvent, handler: (payload: LifecyclePayload) => void): () => void;
  };
  readonly agent: {
    getStatus(): Promise<AgentSnapshot>;
    on(event: 'status', handler: (snapshot: AgentSnapshot) => void): () => void;
  };
}

// 每个 payload 都带 `event` 字段（与 PRD §8.3 一致；V1 SDK 已实现，V0 兼容）。
type LifecyclePayload =
  | { event: 'pause'; reason: 'user' | 'hidden' | 'leave' | 'waiting-user'; at: number }
  | { event: 'resume'; reason: 'user' | 'visible'; at: number }
  | { event: 'hidden' | 'visible'; at: number }
  | { event: 'before-save'; reason: string; deadlineMs: number };
```

**V0 兼容附加项（不得移除）**：`game.onError(handler)`、`game.isGameError(error)` 继续存在；V1 规范不依赖它们，但 V0 游戏可能使用。

### 8.2 初始化与 ready 时序

| 阶段 | 行为 |
|---|---|
| 脚本执行 | `DSH_GAME_SDK.createGameSDK()` 可立即调用；此时除 `ready`/`lifecycle.on`/`agent.on`/`runtime` 外调用 → 同步抛 `GM-4031` |
| 握手 | SDK 向 parent 发 `hello`（每 250ms，最多 30 次）→ Runtime 回 `init`（Runtime 信息）→ `/ready` 请求 → 回 `ready` 结果 |
| 超时 | `ready()` 默认 10s；有效超时 = `min(入参, 10s)`（下调允许、上调无效）；超时 `GM-5001` |
| 事件缓冲 | `lifecycle`/`agent-status` 在 ready 前到达会缓冲；`ready()` 后按序重放（≤64 条） |
| ready 前订阅 | 允许并推荐：`game.lifecycle.on(...)`、`game.agent.on('status', ...)` 在 `ready()` 前注册 |
| 失败 | 握手/协议错误走 `onError`，后续所有调用抛同一 `GameError`（`GM-5001/5002/5004/5005`） |
| ready 后 | `game.runtime.ready === true`；`game.runtime` 字段反映最终值（theme/locale/viewport 等） |

### 8.3 写操作串行与并发上限

- Runtime 对**写操作**（`storage.save`/`storage.remove`、`session.start`/`session.end`、`score.submit`）维护单一 FIFO 队列：同一时刻只有一个 Host 写请求在途，其余按调用顺序排队。
- 读操作（`storage.load`、`score.getBest`、`agent.getStatus`）可并发。
- 队列深度上限 32；超过 → 立即拒绝 `GM-4291`（backpressure，retryable）。
- Bridge 同时在途请求上限 32；非法消息限速（V0 既有：10s 内 >50 条非法即断连）。
- 结果语义：写操作按调用顺序完成；后一次 `storage.save` 覆盖同 key；`remove` 在队列中生效顺序与调用一致。

### 8.4 方法语义与错误

| 方法 | 参数约束 | 成功返回 | 关键错误 | 超时 |
|---|---|---|---|---|
| `ready()` | `timeoutMs?` 正数 | `GameRuntimeInfo` | GM-4031（未 ready 调其他）、GM-5001/5002/5004 | 10s |
| `storage.save(key,data)` | key `^[a-z0-9][a-z0-9._-]{0,63}$`；data 可 JSON 序列化，单值 ≤256 KiB，总 ≤1 MiB，≤32 keys | `{key,bytes,revision,updatedAt}` | GM-4131/4132/4133/4134/4092/4032 | 6s |
| `storage.load(key)` | key 同上 | `{key,data,revision,updatedAt}` 或 `null` | GM-4032/4133/5022/5024 | 3s |
| `storage.remove(key)` | key 同上 | `{key,removed:true,revision}` | GM-4032/4133 | 3s |
| `session.start()` | 无 | `{playSessionId,startedAt,adopted}`；未绑定 DSH Session 时仍可用（`dshSessionId:null`） | GM-4002/4093 | 4s |
| `session.end({outcome,score?})` | outcome 默认 `completed`；score 有限数 | API end 结果；无活动 Session → `null` | GM-4002/4093 | 6s |
| `score.submit(score,meta?)` | 需 `score` 能力；score 有限数且在 manifest 范围；meta JSON ≤2 KiB | `{best,isBest,submittedAt}` | GM-4032/4006/4131 | 4s |
| `score.getBest()` | 需 `score` 能力 | `{score,achievedAt,meta}` 或 `null` | GM-4032/5022 | 3s |
| `lifecycle.on(event,handler)` | event 五选一；handler 抛错不影响其它监听者 | 取消订阅函数 | GM-4002（未知事件） | 同步 |
| `agent.getStatus()` | 无 | `AgentSnapshot`（未绑定 Session 时 idle） | — | 2s |
| `agent.on('status',handler)` | event 只能是 `'status'` | 取消订阅函数；订阅后触发一次 backfill | GM-4002 | 同步 |
| `game.runtime` | 只读视图；不可写 | — | 写入抛错/无效 | 同步 |

> `storage.save` 的 `revision` 为平台存档 revision（单调递增），游戏可用它调试，不作为幂等键。
> 错误均以 `GameError` reject（`code` 为 `GM-*`、`retryable`、可选 `details`）；同步校验错误也抛 `GameError`，不抛原生 Error 文本。

### 8.5 生命周期事件语义

| 事件 | 触发时机 | 游戏必须做什么 |
|---|---|---|
| `pause` | 用户暂停、切后台/隐藏、离开面板、Agent 需要用户（`waiting-user`） | 停止游戏循环/计时；渲染暂停态；不要继续计分；不得自行恢复 |
| `resume` | 用户确认恢复、页面重新可见 | 恢复循环/计时；处理焦点与输入；不得重置局面 |
| `hidden` | 页面隐藏/切 tab | 立即停循环；可保存 |
| `visible` | 页面重新可见 | 可恢复渲染，但循环恢复以 `resume` 为准 |
| `before-save` | Runtime 每 30s、暂停/隐藏/离开前的强制保存窗口 | 在 `deadlineMs`（默认 1500ms）内调用 `storage.save`；不阻塞 UI |

细节：

- `pause`/`hidden` 事件可能在 `ready` 完成前到达：SDK 缓冲并重放；游戏应注册监听早于 `ready()`。
- Runtime 等待 `before-save` 对应的 `storage.save` 完成，最长 `saveTimeoutMs`（1500ms）；超时记录 `saveStale`，不删除旧存档。
- Agent `completed` **不得**暂停游戏（鲸鱼提示由平台覆盖层展示）。
- 游戏自身不得吞掉/伪造平台生命周期事件。

### 8.6 版本协商与 V0 → v1 兼容

| 项 | 规则 |
|---|---|
| 协商输入 | 包内 manifest `sdkVersion`/`runtimeVersion` 范围 |
| 协商结果 | 安装时校验一次；`/launch` 前再校验；不满足 → 安装拒绝（`GM-4260`/`GM-4261`）或 Play 禁用并说明 |
| 不自动升降级 | 平台不改变自身 Runtime/SDK，不改写 manifest 范围 |
| 运行时下发 | `init`/`ready` 下发实际 `sdkVersion`、`runtimeVersion`、`protocolVersion:1` |
| V0 游戏 | 方法名与语义不变；V0 的 `0.1.x` 范围走 **legacy 兼容窗口**（`LEGACY_V0_VERSION='0.1.0'`，Host `isLegacyV0Range`）→ 无需重新发布即可运行；重新发布时迁移为 `^1.0.0` |
| 不满足的新范围 | `^2.0.0` 等 → 安装拒绝（`GM-4261`/`GM-4260`）或 Play 禁用；不自动降级/升级 |
| `snake` | V1 迁移为 `sdkVersion:"^1.0.0"`、`runtimeVersion:"^1.0.0"`，保留既有逻辑测试；构建期源 manifest（V0 为 `game.json`）在 build 时内嵌进单文件 HTML |
| 协议 | `v:1` 信封；不兼容版本 → `GM-5002`（协议不匹配）/`GM-5004`（非法消息） |

### 8.7 错误码（SDK 侧关注）

| GM | 场景 | 游戏建议处理 |
|---|---|---|
| GM-4031 | ready 前调用受限 API | 先 `await ready()` |
| GM-4032 | 未声明能力 | 检查 manifest capabilities |
| GM-4033 | 未绑定 DSH Session（仅特定语义） | 不阻塞游戏；可重试 |
| GM-4131/4132/4133/4134 | 存档超限/配额/key/不可序列化 | 修正存档内容，提示并保留旧档 |
| GM-4092 | 存档 revision 冲突 | 重新 load 后合并再 save（平台串行下少见） |
| GM-4006 | 分数超范围 | 修正分数/检查 manifest.score |
| GM-5011/5012/5013 | 加载超时/无响应/崩溃 | 由平台错误覆盖层处理（游戏侧无需处理） |
| GM-5005 | Bridge 请求超时 | 可重试（幂等读操作）；写操作谨慎重试 |

### 8.8 最小游戏骨架

```js
const game = DSH_GAME_SDK.createGameSDK();

// 1) ready 前注册生命周期/Agent 监听
game.lifecycle.on('pause', () => pauseLoop());
game.lifecycle.on('resume', () => resumeLoop());
game.lifecycle.on('before-save', () => { saveSoon(); });

// 2) 等待 ready
const info = await game.ready();

// 3) 读档（需 storage 能力）
const saved = await game.storage.load('current');
let state = saved ? JSON.parse(saved.data) : newState();

// 4) 开局（在玩家首次输入时调用一次；平台会复用未结束 Session）
await game.session.start();

// 5) 结束一局
game.score.submit(state.score).catch(() => {});
await game.session.end({ outcome: 'completed', score: state.score });

// 6) 保存（30s 定时由平台触发 before-save；离开/暂停路径由平台等待本调用）
await game.storage.save('current', JSON.stringify(state));
```

---

## 9. Agent 桥与多 Session 绑定

### 9.1 Host 快照（沿用 V0 语义）

```ts
interface AgentSnapshot {
  state: 'idle' | 'running' | 'waiting-user' | 'completed' | 'error';
  label: string;               // 本地化短文案（zh 兜底）；游戏不得解析
  labelKey: string | null;     // V1 必须下发（Client 本地化），V0 为 null
  sessionId: string | null;    // 绑定的 DSH Session id
  updatedAt: string;           // ISO
  source: 'turn' | 'tool' | 'approval' | 'question' | 'lifecycle' | 'restore';
  seq: number;                 // hostEpoch 内单调递增
  since: string;               // state 最近变化时间
  turnId: string | null;       // 用于"忽略本轮"
  hostEpoch: string;           // he_*
}
```

- Host 是唯一状态源：游戏/Client 不能伪造；鲸鱼 UI 只读快照。
- 1s 轮询（页面可见且绑定 Session 时）；`ETag`（`W/"<hostEpoch>:<seq>"`）协商，304 不更新 UI。
- Host 事件源：真实 `session/event`（V0.3 修复），映射规则保持 V0（turn/end、approval/asked/decided、tool/call 等）。
- `labelKey` 使用稳定 key（如 `agent.state.waiting.approval`），Client 在 V1 本地化；游戏忽略。
- `completed`/`error` 的未读通过 `POST /agent-ack` 确认；ack 后快照转 idle（当前实现语义）。

### 9.2 多 Session 绑定规则

1. 进入 Game Runtime 时，Client 取**当前主视图 DSH Session id** 作为绑定 session；无主视图 Session → 不绑定（`sessionId:null`，游戏显示 idle/未绑定）。
2. Host 快照按 Session 隔离；游戏内只接收绑定 Session 的快照，其他 Session 的状态不影响当前游戏。
3. 进入游戏后**不随主视图 Session 切换自动重绑**；退出重进时才重新绑定。
4. 页面隐藏时停止轮询；重新可见立即拉一次并恢复 1s 轮询。
5. Host 重启（`hostEpoch` 变化）→ Client 丢弃旧快照并立即重拉；`seq` 按新 epoch 重新计数。
6. 绑定 Session 被关闭/归档 → 快照回到 idle，游戏提示不阻塞。

### 9.3 状态优先级

`waiting-user > error > completed > running > idle`（V0 既有 `AGENT_PRIORITY`）。同一 Session 多来源事件按优先级/新近度归并，Host 输出唯一快照。

### 9.4 dev 模拟

- `POST /api/game-market/dev/agent-state` 仅在 `devMode:true` 注册；body `{sessionId, state, label?, labelKey?, turnId?}`；返回快照。
- 非 devMode 时该路由不存在（404 语义），不得在生产暴露。
- 模拟数据只影响指定 Session，不写真实 Session 状态。

### 9.5 V0 遗留滚动项（不阻塞 V1）

| 项 | 处置 |
|---|---|
| 保存失败重试 backoff | V1 保持"失败提示 + 保留旧档 + 可重试"，PRD 的三次退避列为滚动项 |
| 审批/提问（question）真机补测 | approval 已接；question 投影保持 V0 现状，真机补测列入 V1 验证"未覆盖项" |
| 多 profile 并发写存档 | V1 沿用跨进程文件锁 + last-write-wins；强一致 CAS 列为滚动项 |

---

## 10. 首发四款游戏契约摘要

| 项 | `snake` | `jump` | `2048` | `breakout` |
|---|---|---|---|---|
| 名称（zh/en） | 贪吃蛇 / Snake | 跳跃 / Jump | 2048 / 2048 | 打砖块 / Breakout |
| 版本 | `1.0.0` | `1.0.0` | `1.0.0` | `1.0.0` |
| 包文件名 | 内置构建产物（V0 沿用 `dist/index.html`；Registry 示例包须为 `snake-1.0.0.html`） | `jump-1.0.0.html` | `2048-1.0.0.html` | `breakout-1.0.0.html` |
| `categories` | `["arcade"]` | `["arcade","action"]` | `["puzzle"]` | `["arcade"]` |
| `capabilities` | `["storage","score"]` | 同左 | 同左 | 同左 |
| `sdkVersion` / `runtimeVersion` | `^1.0.0` / `^1.0.0` | 同左 | 同左 | 同左 |
| `viewport` | `960×540 contain` | `540×960 contain`（竖屏） | `720×720 contain` | `960×540 contain` |
| `preferredTheme` | `game-defined` | `game-defined` | `game-defined` | `game-defined` |
| `save.schemaVersion` | `1` | `1` | `1` | `1` |
| `score` | higher-better，0–1,000,000，integer | 同左 | 同左 | 同左 |
| 分发方式 | Bundle 内置（可另放 Registry 示例） | Registry | Registry | Registry |

共同契约：

1. 单文件自包含（§2）、无网络、系统字体、data URI 图片。
2. 必须实现 SDK 调用：`ready`、`runtime` 只读字段、`storage.load/save`、`session.start/end`、`score.submit/getBest`、`lifecycle.on`（至少 `pause`/`resume`/`before-save`）。
3. 存档 key 统一使用 `current`；存档总量 ≤1 MiB（目标 ≤32 KiB）。
4. 分数在单局结束时提交一次；个人最高分通过 `score.getBest` 展示。
5. 暂停/恢复/离开自动保存/Continue 行为见 `docs/V1-GAME-ACCEPTANCE.md`。
6. `snake` 迁移要求：保留 `games/snake/test` 纯逻辑测试；`sdkVersion` 从 `^0.1.0` 改为 `^1.0.0`；视觉/手感打磨不改变逻辑契约。

---

## 11. V1 明确不做

| 项 | 处置 |
|---|---|
| zip / 多文件资源（图片/音效/字体文件） | V1.5；V1 全部内联（data URI + 代码生成） |
| 服务端 Registry / 账号体系 / 付费 | 不做（静态索引 + 本地/远程包） |
| 全球排行榜 / 云存档 / 评论评分 | 不做（仅本地个人最高分） |
| 游戏联网（fetch/XHR/WebSocket/EventSource/sendBeacon） | 禁止（CSP + 自包含扫描） |
| 平台静音 / 长期"少提醒"偏好 | 不做（V0-04/05 既有决策） |
| DSH-native Demo | 由用户亲自带人后续推进，不阻塞 V1 |
| 多文件包签名 / 包加密 | 不做（V1 仅 sha256 完整性） |
| 游戏内多人 / 联机 | 不做 |
| Windows 完整视觉验收 | V1 仅冒烟；完整验收为后续项 |
| 异步安装 job API / 安装队列 UI | 不做（同步 `/install` + 不确定进度） |
| 自动更新 | 不做（用户显式点击更新） |

---

## 附录 A：M0 已冻结的契约模块与常量索引

> M0 已把这些常量/校验器落地到 `packages/shared`（见 `PROJECT_MEMORY.md` §2.1.6）；M1 分支必须 import，不得硬编码。本文与代码不一致时，先修文档/记忆再改代码（契约变更走 Lead）。

| 模块 | 关键导出 |
|---|---|
| `shared/src/constants.js` | `RUNTIME_VERSION='1.0.0'`、`SDK_VERSION='1.0.0'`、`PROTOCOL_VERSION=1`、`LEGACY_V0_VERSION='0.1.0'`；`LIMITS.*`（`packageBytes=20 MiB`、`manifestBytes=64 KiB`、`iconBytes=256 KiB`、`registryBytes=2 MiB`、`registryGames=500`、`entryBytes=20 MiB`、`previewBytes=2 MiB`、存档 1 MiB/256 KiB/32 keys、`jsonBodyBytes=1 MiB`）；`TIMING.*`（`registryTtlMs=6h`、`registryStaleMs=14d`、`registryRefreshThrottleMs=5min`、`downloadConnectMs=10s`、`downloadTotalMs=120s`、`downloadIdleMs=20s`、`installVerifyMs=15s`、`installMoveMs=30s`、`installLockWaitMs=10s`、`agentPollMs=1s`、`autosaveMs=30s`、`saveTimeoutMs=1.5s`、`handshakeTimeoutMs=10s`、`loadSlowMs=10s`、`loadErrorMs=20s`） |
| `shared/src/manifest.js` | `MANIFEST_SCRIPT_ID`、`MANIFEST_VERSION`、`CATEGORIES`、`CAPABILITIES`、`KNOWN_UNSUPPORTED_CAPABILITIES`、`PREFERRED_THEMES`、`SCORE_DIRECTIONS`、`RESERVED_GAME_IDS`、`packageFileName()`、`isPackageFileName()`、`validateManifest()`、`extractManifest()`、`checkSelfContained()`、`validatePackageHtml()` |
| `shared/src/registry.js` | `REGISTRY_FILE`、`REGISTRY_VERSION`、`REGISTRY_CACHE_FILE`、`REGISTRY_CACHE_SCHEMA_VERSION`、`DEFAULT_ALLOWED_HOSTS`、`PACKAGE_REDIRECTS_MAX=5`、`validateRegistryGame()`、`validatePackageUrl()`、`validateRegistry()`、`validateRegistryCache()`、`allowedHostSet()`、`isUpdateAvailable()` |
| `shared/src/installation.js` | 布局常量（`PACKAGES_DIR`/`ENTRY_FILE`/`SAVES_DIR`/`SESSIONS_DIR`/`SCORES_DIR`/`PREVIEW_CACHE_DIR`/`STAGING_DIR`/`TRASH_DIR`/`LOGS_DIR`/`LOG_FILE`）、`INSTALLATIONS_SCHEMA_VERSION`、`INSTALL_SOURCES`、`INSTALL_JOB_STATES`、`COMPAT_STATUSES`、`KEPT_PREVIOUS_VERSIONS=1`、`entryStoragePath()`、`installationPackagePath()`、`validateInstallationsFile()`、`versionsToPrune()` |
| `shared/src/errors.js` | `GM.*`（V0 + V1 全部错误码）、`INTERNAL_TO_GM`、`gmForInternal()`、`httpStatusFor()`、`makeGameError()` |
| `shared/src/contracts.js` | `ROUTES.*`（含 `INSTALL`/`INSTALL_LOCAL`/`UNINSTALL`/`REGISTRY_REFRESH`）、V0/V1 数据形状注释 |
| `tests/v1-contracts.test.js` | 版本/路由/限制/E→GM/legacy V0/端到端包校验断言；改契约必须同步改本文件 + 本文 + 记忆 |

## 附录 B：变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-10-18 | 初稿：按用户锁定口径落 V1 契约；对齐 M0 `packages/shared`（manifest/registry/installation/errors/contracts）与 `tests/v1-contracts.test.js`；TBD-05/07/09/10 仍待 Lead/M1a 裁决 | contract-docs |
