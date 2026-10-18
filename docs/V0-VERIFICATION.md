# V0 验证记录

- 日期：2026-10-18
- 版本：`dsh-game-market@0.0.0`（V0）
- 目标：证明 PRD §7.1 的核心链路在真实 DSH 0.2.1-rc.2 宿主中成立
- 结论：**V0 核心链路验证通过**；自动化测试与真机 UI 验证均完成（详见下文"未覆盖项"）

## 1. 验证环境

| 项 | 值 |
|---|---|
| DSH | Desktop `0.2.1-rc.2`（与用户当前桌面端一致；从本机 `app.asar` 读取） |
| 宿主运行方式 | 从同一 `app.asar` 解出 DSH runtime，用**隔离的 `DSH_HOME`**（`/tmp/dsh-verify-home`）启动 `dsh web`，不触碰用户 `~/.dsh/profiles/desktop` |
| 浏览器 | Google Chrome 155 headless（CDP 9333），视口 756×469 |
| 插件加载 | 开发态 profile patch 指向仓库绝对路径 `index.js`（`devMode: true`） |
| Agent 状态模拟 | Host `POST /api/game-market/dev/agent-state`（仅 devMode）模拟 running / waiting-user / completed；UI 链路与真实事件共用同一 Adapter 输出 |
| Node | v24.14.0 |
| 截图 | 仓库 [`docs/verification/v0/`](./verification/v0/) 下 7 张关键截图 |

> 说明：本次 UI 验证使用同一版本 `app.asar` 的 Web 宿主 + headless Chrome，而不是桌面窗口本身；Client/Host/游戏代码完全一致。桌面端的窗口 chrome / 拖拽带属于同一宿主实现，本次不涉及改动的部分。

## 2. 自动化结果

```text
npm run build     → client.js 306,872 bytes；snake dist 92,815 bytes；连续构建 sha256 一致
npm run check     → CHECK OK (13 checks)
npm test          → 312 tests / 312 pass / 0 fail
```

覆盖：
- Host：路由/信封/错误码、存储原子写与损坏恢复、save 配额与冲突、session 幂等、score、preferences、agent adapter 五态、launch/entry CSP、dev 路由（73 tests）
- Client：store/reducer、chip 状态机（5s/忽略/优先级）、轮询与 ETag、pausedGame→resume、locale 完整性、launch 守卫、Runtime adapter（52 tests）
- Runtime/SDK：桥协议校验、握手/超时、请求限额、自动保存调度、resume-paused 状态迁移、SDK 全 API、Runtime↔SDK loopback（123 tests）
- 集成：`tests/v0-flow.test.js` 走通 health→games→launch→entry→save→session→Continue→score→preferences→agent→ack→end

## 3. V0 验收清单（PRD §10.2）

| 编号 | 验收项 | 结果 | 证据 |
|---|---|---|---|
| V0-01 | 插件安装/启用/停用清理 | **通过** | 隔离 profile 加载成功；停用并重启后 `Game Market` 按钮为 0、`[class*="dgm-"]` 节点为 0 |
| V0-02 | 主面板切换、Sidebar 保留 | **通过** | 点击 Sidebar 图标进入 Market；返回 Conversation（截图 01/02） |
| V0-03 | Conversation 草稿保留 | **通过** | 输入 `draft-check-42` → 进入 Market → 返回，草稿仍在 |
| V0-04 | 等待入口 5s 阈值 | **通过** | running 后 2s 无提示，6.5s 会话头出现「游戏」提示（V0.1 起位于标题右侧） |
| V0-05 | 入口菜单与忽略频控 | **通过** | 菜单含继续/选择/暂时忽略；忽略后同 turn 不再出现，新 turn 重新出现 |
| V0-06 | Sidebar 状态点 | **通过** | running / waiting / completed 均出现对应状态点（截图 05/08/10） |
| V0-07 | 游戏加载与键盘 | **通过** | sandbox iframe 正常加载；点击画布后方向键可移动蛇、吃食物逻辑运行（截图 04） |
| V0-08 | Agent Presence 运行态 | **通过** | 鲸鱼 aria-label `Agent 状态：正在工作…。按下返回工作`；完成后切换完成态 |
| V0-09 | 完成提醒不打断 | **通过** | 游戏继续运行，鲸鱼展示 `任务完成啦 / 查看结果`（截图 08），未暂停/关闭游戏 |
| V0-10 | 需要用户 → 切回处理 → 返回游戏 | **通过** | 鲸鱼等待态 → 点击后暂停并存档 → 回到 Conversation → 页面显示 `已恢复上一局` → 返回游戏；未开始的棋盘会显示明确的「继续上一局 / 开始游戏」入口（V0.1 修复卡住问题） |
| V0-11 | 自动保存 / Continue / 跨重启 | **通过** | 存档文件 revision 递增、`.bak` 存在；退出→市场显示 Continue；重启 Host 后 Continue 仍可恢复 |
| V0-12 | 存档原子性与恢复 | **通过（自动化）** | Host 测试覆盖 tmp→fsync→.bak、损坏恢复、只读模式；Live 额外观测到多次 revision 与备份文件 |
| V0-13 | 错误与恢复 UI | **通过** | 集成测试覆盖错误码；Live 中真实观测到 `游戏加载超时 / 问题编号 GM-5001` 错误卡与返回路径（CSP 问题修复前） |
| V0-14 | 多 Session 绑定 | **通过** | 新开 Session B 后只跟随 B；旧 Session A 设 running 不显示 chip；B 设 running 才显示 |
| V0-15 | 插件停用清理 | **通过** | 同 V0-01；无残留 DOM/样式/按钮 |

## 4. 关键截图

| 截图 | 内容 |
|---|---|
| ![Market](./verification/v0/market.png) | Market 首页（内置 Snake、Continue 状态） |
| ![chip-running](./verification/v0/chip-running.png) | 会话头等待入口（5s 后出现） |
| ![runtime-playing](./verification/v0/runtime-playing.png) | Game Runtime 内运行贪吃蛇 |
| ![runtime-waiting](./verification/v0/runtime-waiting.png) | waiting-user 鲸鱼气泡（游戏内） |
| ![runtime-running](./verification/v0/runtime-running.png) | running 鲸鱼状态（Agent 正在工作） |
| ![runtime-completed](./verification/v0/runtime-completed.png) | 完成提醒（不打断游戏） |
| ![resume-overlay](./verification/v0/resume-overlay.png) | 返回游戏时的“已恢复上一局”暂停遮罩（D-024） |
| ![chip-resume](./verification/v0/chip-resume.png) | 会话头“继续游戏”入口 |

## 4.1 V0.1 反馈迭代（2026-10-18 晚）

根据用户真机反馈做了三项修复，均已重新构建并验证：

1. **等待提示位置与形态**：从输入框 dock 移到会话头标题右侧（`conversation.session.header.actions`），显示短标签「游戏 / Game」（随界面语言）；加入游戏手柄轻摆、星点闪烁、渐变高光与等待态呼吸光晕，全部尊重 `prefers-reduced-motion`。
2. **弹层对齐**：菜单以提示为锚点水平居中，下方空间不足时向上翻转并限制在视口内，不再出现浮动层错位。
3. **返回后游戏卡住**：根因是 `resume-paused` 的 pause/resume 与游戏异步 boot 存在竞态——resume 可能早于存档加载完成；且存档状态为 `ready`（玩家尚未按方向键）时，旧逻辑会隐藏遮罩但棋盘不推进、键盘焦点仍在父页面，形成“静止棋盘”。
   修复：游戏记录提前到达的 resume；新增 `resume.js` 纯策略（running → 恢复运动；ready → 保留游戏自己的开始入口）；恢复后把键盘焦点交还给 canvas。现已覆盖单元测试与真机验证。

| 截图 | 内容 |
|---|---|
| ![v0.1-header-hint](./verification/v0/v0.1-header-hint.png) | 会话头「游戏」提示 |
| ![v0.1-header-menu](./verification/v0/v0.1-header-menu.png) | 居中对齐的菜单 |
| ![v0.1-resume-prompt](./verification/v0/v0.1-resume-prompt.png) | 未开始棋盘恢复后的明确入口（不再静止卡住） |
| ![v0.1-resume-playing](./verification/v0/v0.1-resume-playing.png) | 运行中棋盘恢复后继续游戏 |

自动化：`npm test` → **315 tests / 315 pass**。

## 5. 未覆盖项与已知限制

1. **真实 Agent 事件链路**：验证环境没有模型凭据，无法真实触发 Agent 长任务/审批；UI 用 dev-only 状态接口驱动。Host Adapter 对真实 DSH 事件的映射有单测（含防御式 payload），但 **S-14/S-15 仍需真机验证**。
2. **提问（question）等待**：V0 只保证 approval 类等待可识别；`userQuestions` 投影未接（PRD S-14），等待态通过 dev 路由验证。
3. **深色主题 / Windows**：平台 UI 全部使用 DSH token；Live 仅验证浅色 + macOS Web 宿主。深色主题与 Windows 复测列入 V1 前检查（PRD §10.1）。
4. **保存失败重试 backoff / saveGap 提示**：V0 简化为失败即提示 + `saveStale` 确认，未实现 PRD 的三次退避与“上次未保存”提示。
5. **桌面窗口**：使用同版本 Web 宿主验证；桌面 Electron 窗口的 chrome/拖拽带不影响本次新增 UI 逻辑。
6. **原子写跨进程 CAS**：单 Host 进程场景验证通过；多 profile 并发写同一存档仍是 last-write-wins（V0 无影响，V1 前再收敛）。
7. **CSP `frame-ancestors *`**：V0 为兼容 Host 实际看到的内部 origin 而放宽；游戏内容不可信且受 sandbox 隔离，V1 改为配置化 allowlist（见项目记忆 V0-06）。
