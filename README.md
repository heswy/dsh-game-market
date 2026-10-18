# DSH Game Market

在 DeepSeek Harness（DSH）里，把 Agent 执行长任务时的等待时间变成一局小游戏：游戏占满主工作区，右下角的小鲸鱼负责维持 Agent 的存在感，任务完成时提醒但不打断。

当前仓库正在实现 **V0（核心体验验证版）**，验证游戏是 **贪吃蛇（snake）**。

- 权威规格：[`PRD｜DSH Game Market.md`](./PRD｜DSH%20Game%20Market.md)（第 8–12 章为实现权威来源）
- 项目记忆与协作/分支/验证规则：[`PROJECT_MEMORY.md`](./PROJECT_MEMORY.md)（**唯一项目记忆文件**）
- 基线：DSH Desktop `0.2.1-rc.2`，Node ≥ 20，**零第三方依赖**

## V0 包含什么

| 能力 | 状态 |
|---|---|
| Bundle 安装形态（Host 半 + `dsh.client` 半） | 开发中 |
| `main` 面板 + Sidebar 入口；进入/返回不丢会话草稿 | 开发中 |
| Agent 运行 ≥5s 的会话头等待入口（chip） | 开发中 |
| Agent Presence 小鲸鱼（running / waiting-user / completed / error） | 开发中 |
| sandbox iframe Runtime + 自动保存 + Continue | 开发中 |
| 需要用户：暂停存档 → 切回处理 → 一键回游戏 | 开发中 |
| 内置贪吃蛇（键盘、分数、Personal Best、Continue） | 开发中 |
| 真实安装 / Registry / Developer CLI / 排行榜 UI | **V0 不做** |

## 目录结构

```text
package.json            # DSH Bundle 根（dsh.bundle.patch + dsh.client）
cordis.patch.yml        # Bundle patch
index.js                # Host 入口（re-export packages/host/src/plugin.js）
client.js               # Client 构建产物（提交进仓库）
packages/shared/        # 跨模块契约（constants / errors / protocol / api-client / contracts）
packages/host/          # DSH Host：HTTP 路由、存储、Session/Score、Agent Adapter、内置游戏服务
packages/client/        # dsh.client：面板、Sidebar、等待 chip、Market/My Games、小鲸鱼
packages/runtime/       # Trusted Runtime：iframe、Bridge、自动保存、暂停/恢复
packages/sdk/           # 游戏内 SDK（构建时内联进游戏）
games/snake/            # 内置贪吃蛇（dist/index.html 为自包含单文件）
scripts/                # 零依赖构建/检查/开发态加载脚本
tests/                  # 跨模块集成测试
```

## 常用命令

```bash
npm run build      # 构建 client.js 与 games/snake/dist/index.html
npm run check      # 检查 bundle 元数据、JS 语法、产物是否自包含
npm test           # node --test（Host/Client/Runtime/SDK/游戏逻辑 + 集成测试）
```

代码格式/提交/分支规范见 [`PROJECT_MEMORY.md`](./PROJECT_MEMORY.md)。功能分支完成且检查通过后由 Lead 合并到 `main`。

## 在 DSH 中加载（开发态）

开发态通过修改当前 profile 的 `cordis.patch.yml` 加载本地插件；Host 代码改动需要重启 DSH，Client 改动刷新页面即可。

```bash
npm run build
npm run dev:enable -- --dry-run     # 预览将要写入的 patch
npm run dev:enable -- --yes         # 备份后写入托管块
# 重启 DSH（或停用/启用插件行），然后刷新 DSH 页面
```

卸载开发行：

```bash
npm run dev:disable -- --yes
```

> 该脚本只改动 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中带 managed 标记的块，并自动备份；不会碰 profile 里的其它插件。

## V0 人工验收（贪吃蛇）

1. 侧栏出现 Game Market 图标；点击打开 Market（只有内置 Snake + Continue）。
2. 点开 Snake，方向键/WASD 可玩；暂停、返回、再进入后进度还在。
3. 让 Agent 跑一个 ≥5 秒的任务：会话头顶部出现等待 chip；点击可继续游戏。
4. 游戏中 Agent 完成：右下角小鲸鱼提示“任务完成啦 / 查看结果”，游戏不被暂停或关闭。
5. 用 dev 模式模拟 `waiting-user`（见下）：小鲸鱼提示后点击 → 游戏暂停并存档 → 切回会话 → 出现“继续游戏” → 回到游戏并恢复棋盘。
6. 关闭 DSH 再打开：Snake 显示 Continue 与上一局分数，进入后继续。
7. 停用插件：侧栏与面板消失，无残留样式；重新启用后存档仍在。

没有真实 Agent 时可使用 dev-only 接口（需 Host `config.devMode: true`，`dev:enable` 默认开启）：

```bash
curl -s -X POST http://127.0.0.1:56891/api/game-market/dev/agent-state \
  -H 'content-type: application/json' \
  -d '{"sessionId":"dev-session","state":"waiting-user"}'
```

> 端口以当前 DSH Web GUI 为准（运行时注入）。该接口在 `devMode: false` 时不会注册。

## 已知限制（V0）

- 没有第三方游戏安装、Registry、开发者 CLI。
- 贪吃蛇是自包含单文件；多文件游戏资源要等 V1.5。
- 平台提示音/静音、长期“少提醒”设置不在 V0。
- Agent 等待态依赖 DSH `approval/asked` 等持久事件；提问投影仍需真机 Spike（PRD S-14）。
- UI 视觉验收需在 DSH 内人工完成；仓库提供自动化逻辑测试与检查。
