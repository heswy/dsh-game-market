# M3 真机验收执行记录（Lead 代执行，2026-10-19）

> 执行方式：在用户的 DSH Desktop `0.2.1-rc.2` 真实窗口中，用辅助控制（CoreGraphics 鼠标/键盘事件 + `screencapture`）按
> `REAL-MACHINE-CHECKLIST.md` 操作。**未重启应用、未中断当前会话**；系统深色模式改动已恢复；窗口已恢复全屏。
> 截图：`docs/verification/v1/screenshots/real-*.jpg`（27 → 18 张，去重/压缩）。

## 1. 通过项（真机）

| 用例 | 结果 | 说明 / 证据 |
|---|---|---|
| U-02 浏览/搜索/分类 | 通过 | Market 4 卡、分类 chips、搜索框正常；`real-market-header.jpg` |
| U-03 详情 + 本地安装 | 通过 | 文件选择器 → 确认弹窗 → 安装 Jump/Breakout 成功；详情显示版本/大小/权限/卸载；`real-local-install-dialog.jpg`、`real-U-03-detail-jump.jpg`、`real-my-games-4.jpg` |
| A-03/A-04 四款可启动可操作 | 通过（计时未测） | 2048（Continue）、Jump（Continue）、Breakout（Start）、Snake（Start）均进入并可操作；`real-U-08-resumed.jpg`、`real-jump-runtime.jpg`、`real-breakout-runtime.jpg`、`real-breakout-playing.jpg` |
| A-05 平台暂停 | 通过 | 四款游戏点平台暂停：**只有平台一个弹窗**，游戏层无暂停面板；`real-A-05-pause-single.jpg`（2048）、`real-A-05-pause-jump.jpg`、`real-A-05-pause-breakout.jpg`、`real-A-05-pause-snake.jpg`（Snake 场景为结算页+平台暂停，属结果页非暂停弹窗） |
| A-08 Continue 恢复 | 通过 | 2048/Jump 进入时平台「已恢复上一局」单层，游戏层无二次确认；`real-A-08-resume-confirm.jpg` |
| V1-22 会话 Game tab 直连恢复 | 通过 | 返回工作后点「游戏」tab：直接进入 2048 继续，**无确认弹窗**；`real-V1-22-tab-resume.jpg` |
| V1-23 暂停 UI 归属 | 通过 | 四款平台暂停均只有平台弹窗（含上面四张） |
| U-08（面板级） | 通过 | 离开游戏（保存并返回工作）→ 再进入，Continue 正常；**应用级关闭重开见阻塞项** |
| U-09 完成一局（部分） | 通过（Snake） | Snake 撞墙 Game Over：得分 10 记录、最高 220 不变（正确）；`real-U-09-snake-gameover.jpg` |
| U-11 卸载确认 | 通过（对话框） | 「卸载《Jump》？存档和最高分会保留，重新安装后可继续」+ 同时删除存档勾选；未实际卸载以保留验收环境；`real-U-11-uninstall-confirm.jpg` |
| U-04 游戏内 Agent presence | 通过（真实 Agent） | 本会话 Agent 正在运行时进入 Jump 游玩，鲸鱼浮层显示「正在执行命令… / 返回工作」；`real-U-04-agent-presence.jpg` |
| A-13 窄窗 | 通过 | 窗口约 760px 宽：hero 重排、卡片自适应、无横向滚动；`real-A-13-narrow-760.jpg` |
| U-05 Agent 完成提醒 | 通过（用户截图） | 2048 游玩中右下角出现「任务完成啦 / 查看结果」，不打断游戏；`real-U-05-agent-completed.jpg`（用户提供） |
| U-13 深色主题 | 通过（用户截图） | DSH 深色主题下 2048/Market 对比度正常；`real-U-13-dark-theme.jpg`（用户提供） |

## 2. 阻塞 / 部分 / 未执行（需后续或用户本人）

| 项 | 状态 | 原因 |
|---|---|---|

| U-06 审批返回 | 阻塞（提问路径已修复） | 审批弹窗被禁用，无法触发真实审批；**提问（AskUserQuestion）已实现 waiting-user 提示（Host `tool/call` 映射，2026-10-19 修复，待重载 Host 后复测）**；dev 模拟方式见 `AUTOMATED-EVIDENCE.md` |
| U-08 关闭 DSH 重开 | 阻塞 | 退出应用会终止承载验收的 Agent 会话；隔离宿主已验证 storage 持久化与 Continue（`AE-10-15-host.json`）；建议用户后续手动做一次关闭重开 |

| U-13 放大字号 | 未执行 | 系统级字号会影响用户其他应用，未代改 |
| U-14 纯键盘全流程 | 部分 | 游戏内键盘可玩已覆盖；Market→安装→焦点完整 Tab 流程未做 |
| U-15 减少动效 | 未执行 | 需改系统辅助功能设置，未代改 |
| A-11 连续 5 分钟 | 部分 | 各游戏短时游玩无崩溃/白屏；未连续 5 分钟压测 |
| A-07/U-09 PB 更新反馈 | 部分 | Snake 覆盖 Game Over 记录；2048 新纪录反馈未触发 |
| 性能（启动/FPS/CPU/内存） | 未测 | 需录屏/Instrument 采样，本轮未测 |
| DEV-03 热更新 / DEV-07 外部开发者 | 未执行 | 前者需改代码实时观察；后者需真人从零体验 |

## 3. 环境恢复

- 应用窗口已恢复全屏；系统深色模式已恢复（未变更）。
- 已通过平台暂停「保存并返回工作」回到会话；游戏进度已保存。
- 验收新增本地安装：**Jump、Breakout**（保留，符合预期；如不需要可在 My Games 卸载）。
- 未执行任何卸载/删除数据操作。

## 4. 结论

真机自动化验收覆盖了 **安装/详情/四款启动/暂停单层/Continue/Game-tab 直连恢复/游戏内 Agent presence/Game Over/卸载确认/窄窗** 共 13 项；
剩余 10 项因「会终止当前 Agent 会话 / 需系统级设置 / 需回合结束后观察」而阻塞或未执行，已在 `V1-VERIFICATION.md` §3.0 与 §5 标注。
这些阻塞项不影响自动化证据已覆盖的契约；封板前建议补：U-05/U-06（真实 Agent 或模拟标注）、U-08 应用重启、深色主题/字号/减少动效、性能实测。
