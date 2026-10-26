# V1.5 M3 插件持续更新验证

更新日期：2026-10-26。**当前候选、逐项结果和未验证边界以 [M3 重启验收](./m3-restart-acceptance.md) 为准**。本文件取代此前混用不同候选、not-run 和单跳成功的工作记录；历史原始 JSON 保留，不追认通过。

## 产品与证据范围

- 平台从固定官方插件索引发现精确版本/commit，只向 DSH pluginManager 传递本项目绑定的精确 Git target；不自行覆盖插件文件，不先卸载自己。
- Host 持久化 operation/requestId/目标/旧身份，保存协调与准入屏障通过后才安装；安装结果不是实际生效，需 Host + Client 身份共同确认。
- 已暂停实例的失败保存需要真实重试；协调后的 Runtime 不能恢复、重载或重新 launch。权限修复后显式更新重试重新探测存储；盘点失败关闭；安装保留禁用状态。
- 更新后保留上一操作结果；更高版本仍可再次更新，包含上一结果为 already-at-target 的情况。开发态加载不得借用正式安装身份或被静默迁移。

本轮使用当前安装 App 的只读 DSH rc.3 + 隔离 dsh web + headless Chrome；包安装是真实 GitHub 精确 commit 传输，索引是隔离夹具。它证明隔离真实 Host/Client 路径，不代表 Electron 窗口或生产 stable 发布。

## 验证入口

```bash
M3_PREFER_PROXY=1 node scripts/verification/v1.5/m3/run-m3-serial.mjs \
  --mode real-github \
  --scenarios v2-edges,two-hop,v2-save,nonhmr,v2-windows,selfcheck,smoke
```

默认候选固定在串行 runner 中；显式 `--a/--b/--final` 可复跑旧证据但不得混称新候选。网络依赖本机可用上游代理；mirror 模式还需要完整预热的 pnpm store，仅有 bare Git mirror 不足以离线安装。失败应非零退出；不得运行中修改 runner、无依据删除锁、宽泛杀进程或改日常 profile。

| 场景 | 证明范围 |
|---|---|
| two-hop | 同 profile A→B→C、两次真实点击、双端身份、数据保留；第二跳接受后丢 HTTP 响应仍恢复 |
| nonhmr | 安装待重启时旧代码仍在运行；真实 Host 重启后确认新双端身份 |
| v2-windows | 独立页面并发/重复点击、同 operation、两端收敛与单次包变更 |
| v2-save | 两个真实游戏实例 + 第三页更新；各游戏目录真实权限故障、阻断、修复、真实重新保存及更新 |
| v2-edges | 取消及 too-late 后继续观察、原生 ambiguous/already-installed、非法索引/任意目标拒绝、可信缓存不变、恢复、dev row 不迁移 |
| selfcheck | runner 语法、import、超时与清理约束 |
| smoke | 干净隔离 profile 安装、真实页面与构建身份、检查更新按钮和清理 |

原生 RPC 响应丢失、waitForInstall null、磁盘满、未知 HMR 能力等分支的自动化证据与真实浏览器证据分开报告。强制未知 HMR 的真实环境用例没有可用受支持注入点，保持 not-run，不改为通过。

## 历史审计与检查点

- [2026-10-21 独立审计](../../reviews/2026-10-21-m3-progress-audit.md)：AUD-01～03 的原始缺陷与 AUD-04 同 profile 两跳要求。
- [最新交接](./M3-HANDOFF.md)：当前执行入口与剩余项。
- `raw/m3/M3-v1-single-hop-2026-10-21*.json`：两个不同 fresh profile 的历史单跳，不能替代连续更新。
- `raw/m3/M3-v1-two-hop-2026-10-25T14-39-43-535Z.json`：原 P1 修复候选的 54/54，两跳真实通过，仍不能替代后续候选。
- 2026-10-26 保存/边界的失败 JSON 原样保留；新报告说明其原因和对应修复/测试准备调整。

真实 Electron、正式干净桌面安装/升级、生产 stable 索引推广与外部作者正式流程仍属于 M5/发布授权范围；本轮不写成通过。
