# 向 DSH Game Market 投稿游戏

本指南面向游戏作者，不需要阅读平台源码。流程：用 `dsh-game-developer` Skill
开发/验证 → 准备投稿资料 → 开 Issue Form 或资料 PR → 维护者试玩与审核 →
维护者运行上架工具、合并 catalog PR → 用户刷新市场即可看到。

## 1. 准备工具链

- 平台仓库 checkout（版本见 `package.json`），Node.js ≥20、零 npm 依赖；
- 从平台仓库使用 `scripts/cli/create-dsh-game.mjs` 生成 Vanilla/React 工程；
- AI 开发可直接加载 `skills/dsh-game-developer/`（目录或打包的
  `dsh-game-developer-<version>.tar.gz`），它不会替你发布。

```bash
export DSH_GAME_CLI=/path/to/dsh-game-market/scripts/cli/dsh-game.mjs
node "$DSH_GAME_CLI" create my-game --dir /tmp/games --template vanilla
cd /tmp/games/my-game
npm run build && npm run validate && npm run pack
```

## 1.1 在 AI 客户端里使用开发 Skill

Skill 是自包含目录/归档，不依赖维护者机器路径或私有 Skill：

- 方式 A（通用）：把 `skills/dsh-game-developer/` 目录（或
  `dsh-game-developer-<version>.tar.gz` 解出的目录）作为附件/技能上下文交给 AI，
  让 AI 先读 `SKILL.md`，再按需读 `references/`。
- 方式 B（DSH 等支持技能目录的宿主）：把该目录放入宿主的用户技能目录（具体目录
  由宿主版本决定；本版不假设统一路径）。若宿主不支持，使用方式 A。
- 归档生成：`node scripts/registry/pack-skill.mjs` → `dist/dsh-game-developer-<version>.tar.gz`
  + `manifest.json`；`VERSION` 是 Skill 版本，`SKILL.md` 声明支持的平台/工具获取方式。

Skill 不会授予发布权限，也不能代替维护者审核。

## 2. 你必须交付

- `dist/<id>-<version>.html` + `.sha256`；
- 真实封面（建议 16:9）和 1–5 张真实截图（PNG/WebP/JPEG）；
- 公开源码仓库 + **固定 commit** + 可复现构建说明；
- `submission.json`（字段见 `docs/community-publishing-contracts.md` §2.1）；
- 自测报告（ready/pause/resume/before-save/Continue、键盘、窄窗、主题、
  全出血/安全区、无外网请求、真实玩法推进）；
- 许可：代码许可证、素材来源/许可证、允许官方归档与分发的确认。

缺身份、源码 URL、公开包地址、许可或素材时必须写“待补”，不要编造。

## 3. 自测命令

```bash
npm run build
npm run validate   # 与平台相同的 shared validator
npm run pack
npm run dev        # 本地 Runtime Simulator；真实玩几局并测 Continue/暂停/主题
```

运行时契约：单文件自包含、无外部请求、`await game.ready()`、全出血、顶部
112px/右下 96×96 平台安全区。详见开发 Skill 的 references。

## 4. 投稿

1. 打开内容仓库的 “Submit a game” Issue Form，完整填写；
   或提交资料 PR（同一数据契约，不获得写权限）。
2. 维护者会下载**你声明的确切字节**校验并试玩；Issue 关闭/CI 通过不代表审核通过。
3. 通过后维护者记录 approval（绑定包/每张素材 SHA 与字节数）并运行上架工具；
   合并 catalog PR 后市场才可见。
4. 更新：递增版本，重新提交完整资料与 changelog/旧存档兼容说明。同版本不能
   替换字节；已发布版本永久保留。

维护者流程见 `docs/community-operations.md`。
