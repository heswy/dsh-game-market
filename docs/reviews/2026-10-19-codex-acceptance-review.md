# codex 验收文档

日期：2026-10-19（Asia/Shanghai）  
项目：[heswy/dsh-game-market](https://github.com/heswy/dsh-game-market)  
验收基线：`main@ff99c7489525728363a263bac7b1e7f6dbd602f1`  
审查范围：首次 review 的 `ac136ec`，以及 `ac136ec → ff99c74` 的增量。

## 1. 结论与边界

**本轮结论：建议修复下列问题并完成回归后，再决定是否发布 `v1.0.0`。**

V1 的 Host、Client、Runtime、SDK、CLI 和四款游戏主要实现已经落地。新增材料补充了桌面交互、提问提醒、应用重启续玩等验收证据，但默认分发、数据删除、运行实例生命周期和验收脚本判定仍有缺口。

本文件是 review 发现与后续验收清单，不代表问题已经修复，也不代表已批准发布。两轮审查期间未修改实现；本次仅按用户授权新增本文件。后续实现、验证、修复和 PR 由用户指定的开发 Agent 承担，本会话负责复核与验收意见。

通用开发、分支和验证约定引用 [PROJECT_MEMORY.md](./PROJECT_MEMORY.md)，接口与行为参考 [V1-CONTRACTS.md](./docs/V1-CONTRACTS.md)。本文件只增加本次问题的范围与验收标准，不另建一套通用开发规则。

## 2. 已执行的验证

| 检查 | 结果 | 说明 |
|---|---|---|
| 本地与远程 main 核对 | 一致 | 第二轮均为 `ff99c74` |
| 第二轮开始和结束时 Git 工作区 | 干净 | 本文件新增前 |
| `node scripts/check.mjs` | 21 项通过 | 第一轮执行；第二轮增量未修改构建产物 |
| `node --test --test-reporter=tap` | 768 tests / 768 pass / 0 fail | 第二轮全量复跑 |
| Host、Runtime requests、V1 契约定向测试 | 167 tests / 167 pass / 0 fail | 第二轮复跑 |
| SDK 删除存档行为 | 问题复现 | 实际服务与内存存储组合，无仓库文件写入 |
| 实例超时、跨窗口释放行为 | 问题复现 | 实际 Entry 服务与模拟时钟；只读游戏产物 |
| 提问等待被无关结果清除 | 问题复现 | 实际 Agent Adapter 与内存事件序列 |
| 验收日志是否纳入 Git | 缺失 | `git ls-tree` 确认 logs 目录受控文件数为 0；日志被 `*.log` 忽略 |

本轮没有执行 build、重装游戏、修改用户 DSH profile 或操作桌面应用。已有真机结果来自仓库材料和本地证据的审阅，不是本轮重新执行的真机验收。上述测试通过不等于本文件列出的边界问题已被覆盖。

## 3. 问题总表

优先级：P1 为高优先级功能缺口；P2 为需要修复的正确性或验收可靠性问题。下列各项当前均为**待修复、待复验**。

| 编号 | 优先级 | 问题 | 来源 |
|---|---|---|---|
| CR-01 | P1 | 默认 Registry 文件缺失，全新环境无法发现另外三款游戏 | 第一轮，第二轮仍存在 |
| CR-02 | P2 | 卸载删除数据遗留备份，重装后旧数据可能恢复 | 第一轮，第二轮仍存在 |
| CR-03 | P2 | `storage.remove()` 写入 null，未删除 key 或释放配额 | 第一轮，第二轮仍存在 |
| CR-04 | P2 | 十分钟后仍在运行的实例失去更新／卸载保护 | 第一轮，第二轮仍存在 |
| CR-05 | P2 | 单窗口退出释放同款游戏的全部实例 | 第一轮，第二轮仍存在 |
| CR-06 | P2 | 无关工具结果提前清除提问等待 | 第二轮新增 |
| CR-07 | P2 | 文档引用的验收日志未进入 Git | 第二轮新增 |
| CR-08 | P2 | 验收脚本遇到失败仍可返回成功退出码 | 第二轮新增 |
| CR-09 | P2 | 性能采样将外壳出现当成市场可交互 | 第二轮新增 |

## 4. 问题详情与验收标准

### CR-01：默认 Registry 缺失

位置：[config.js](./packages/host/src/config.js) 的 `defaultRegistryPath()`；根 [package.json](./package.json) 的 `files`；[build.mjs](./scripts/build.mjs)。

默认配置指向仓库内 `registry/games.json`，但该文件未纳入当前提交，构建脚本也不生成它。新环境没有缓存、没有额外 Registry 配置时，只能看到内置 Snake。根包分发白名单也没有包含 `registry/**`。

建议提供可用的默认静态索引及其包资源，或明确配置可访问的默认远程索引，并校验最终分发产物。

验收标准：

- 从空插件存储启动，使用随包默认配置，市场能发现 Snake、Jump、2048、Breakout。
- 另外三款游戏可从默认市场安装、启动；包版本、文件名、大小和 SHA-256 一致。
- 验收使用最终分发目录，不能依赖开发者本地 fixture、现有安装或缓存。
- 默认源不可用时，界面准确显示失败或离线状态，并支持恢复后的重试。

### CR-02：删除数据后备份仍可恢复

位置：[install.js](./packages/host/src/install.js) 的 `uninstallLocked()`；[storage.js](./packages/host/src/storage.js) 的 `readJson()` 和备份写入逻辑。

卸载删除数据只处理 `scores/<id>.json`、`sessions/<id>.json` 等主路径，遗漏这些文件的 `.bak`。存储层在主文件缺失时会读取备份。因此用户确认删除后，重新安装可能恢复旧成绩和 Session。部分删除错误被吞掉，仍返回 `dataDeleted:true`。

建议把主文件、备份及相关可恢复数据作为完整删除集合，准确返回删除失败或部分失败。

验收标准：

- 先产生至少两次成绩和 Session 写入，确认存在备份，再卸载并删除数据。
- 重装后个人最高分、历史 Session、存档均符合全新安装状态；重启 Host 后也不恢复旧数据。
- 注入删除失败时，不得返回完全删除成功；保留可诊断信息和重试路径。
- 不勾选删除数据的卸载，仍保留既有进度与成绩。

### CR-03：SDK 删除存档不释放 key

位置：[requests.js](./packages/runtime/src/requests.js) 的 `storageRemove()`；[saves.js](./packages/host/src/saves.js) 的 `saveLocked()`。

Runtime 在没有 `api.removeSave` 时调用 `setSave({ gameId, key, data:null })`，Host 将 null 当作正常值写入。复现结果：remove 返回 `removed:true`，随后 load 返回包含 `data:null` 的记录；满 32 个 key 后，删除一个再保存新 key，仍返回 `GM-4132`。

建议贯通真正的删除操作；如需扩展 API，按项目契约变更流程同步文档、客户端和测试。

验收标准：

- `save → remove → load` 后，load 返回 null，且 Host 中不再存在该 key。
- 删除释放 key 数量和字节配额；32 个 key 删除一个后可写入新 key。
- 正常保存 JSON null 与删除操作有明确、可测试的区别。
- 重复删除、删除不存在 key 的返回行为明确；写队列中的顺序保持一致。

### CR-04：入口 TTL 被用作运行状态有效期

位置：[entry.js](./packages/host/src/entry.js) 的 `hasActiveInstance()`；[constants.js](./packages/shared/src/constants.js) 的 `entryBindingTtlMs`。

入口绑定十分钟到期后，`hasActiveInstance()` 删除绑定，没有持续游玩时的续期机制。模拟时钟复现：启动后返回 true，推进 600001ms，未退出也返回 false。更新／卸载依赖此判断，因此长时间游玩后保护失效。

建议区分入口凭证有效期和运行实例生命周期，设计存活确认及异常退出回收机制。

验收标准：

- 持续游玩超过十分钟，另一客户端更新／卸载仍被运行保护拒绝。
- 正常退出后，更新／卸载及时恢复可用。
- 客户端崩溃、断开或 Host 重启后的回收行为明确，不永久占用。
- 分别测试入口凭证到期和活跃实例过期，避免两者相互替代。

### CR-05：退出按 gameId 释放全部实例

位置：[entry.js](./packages/host/src/entry.js) 的 `releaseGame()`；[routes.js](./packages/host/src/routes.js) 的 Runtime release 路由；[runtime.js](./packages/client/src/components/runtime.js) 的释放调用。

release 只传 gameId，Host 删除同一游戏的所有绑定。复现中，创建两个实例后，一次 release 返回释放两个实例，第二个仍在玩的客户端随即失去运行保护。

建议按具体实例释放，并校验实例与游戏的绑定关系。

验收标准：

- 两个窗口运行同款游戏，退出 A 仅释放 A，B 保持有效。
- B 仍运行时更新／卸载继续被拒绝；全部退出后允许操作。
- 重复释放幂等；错误实例标识不得释放其他实例。

### CR-06：提问等待没有关联对应工具结果

位置：[agent-adapter.js](./packages/host/src/agent-adapter.js) 的 `ingestSessionEvent()`，特别是 `tool/result` 分支。

当前只要快照是 `waiting-user` 且 `source=question`，任意 `tool/result` 都关闭等待。内存复现：turn 3 发起提问后，注入 turn 2、不同工具调用的结果，快照由 waiting-user 变为 running。真实环境若有并行工具或迟到结果，提醒可能提前消失；本轮未重新执行该场景的桌面真机验证。

建议在提问调用时记录待回答的调用标识、turn 等关联信息，根据 DSH 实际结果结构匹配收尾，不能仅凭当前快照来源判断。

验收标准：

- 对应提问结果到达后，提醒正确消失。
- 其他工具、旧 turn 或其他 Session 的结果，不得清除当前提问等待。
- 覆盖同轮多个工具结果、重复结果，以及取消／中止提问后的状态收尾。
- 保留真实 `tool/result` 不带工具名的兼容性，不读取问题正文来识别调用。

### CR-07：验收证据未完整归档

位置：[.gitignore](./.gitignore) 的 `*.log`；[AUTOMATED-EVIDENCE.md](./docs/verification/v1/AUTOMATED-EVIDENCE.md) 中的日志引用。

当前本地可读取部分日志，但 Git 提交内 logs 目录受控文件数为 0。全量测试、稳定性、减少动效、性能等文档链接，在全新 clone 中无法核查。

建议将经过脱敏的验收日志纳入版本控制，或提供固定、可访问、关联提交的外部归档。

验收标准：

- 全新 clone 后，文档引用的证据均可访问，不依赖原机器的忽略文件。
- 证据注明被测提交、环境、命令、时间和结论。
- 发布前检查凭据、用户路径和业务内容；不得直接提交未脱敏运行日志。
- 统一文档中的状态：已通过项不再同时出现在“未执行”清单；保留必要历史并注明时间。

### CR-08：采集脚本缺少失败判定

位置：[stability.mjs](./scripts/verification/stability.mjs) 的 `finish()`、异常处理和结果记录；[host-e2e.mjs](./scripts/verification/host-e2e.mjs) 的场景异常处理与脚本末尾。

stability 捕获异常后最终仍 `process.exit(0)`，且未将启动成功、持续状态、异常数转为通过断言。host-e2e 也可能仅将错误或 `unexpected:accepted` 写入结果，然后正常退出。因此进程成功退出不能作为验收通过依据。

建议区分采集、断言和汇总：失败时保留证据，汇总标记失败，并返回非零退出码。五分钟验证还应检查游戏内部推进，不能只看 Runtime 外壳为 playing。

验收标准：

- 正常运行返回 0，且逐项断言通过。
- 注入启动失败、非法包被错误接受、Runtime 异常、超时等情况，返回非零退出码。
- 五分钟场景确认游戏实际启动并推进，记录期间的状态及异常。
- 无论成功失败，都关闭本轮创建的浏览器和宿主进程，并输出可定位失败项的结果。

### CR-09：性能指标与探针含义不一致

位置：[perf.mjs](./scripts/verification/perf.mjs) 的 Market 计时循环；[AUTOMATED-EVIDENCE.md](./docs/verification/v1/AUTOMATED-EVIDENCE.md) §8。

当前 Market 计时只等待 `.dgm-root` 存在，却将结果描述为“首屏可交互 122ms”。外壳存在不证明目录加载完成、卡片可见或按钮可操作。现有值只能作为当前探针测得的外壳出现时间。

建议修正指标名称，或改为以明确的市场就绪条件作为终点，并记录冷／热缓存前提。

验收标准：

- 指标名称、计时起点、终点和环境一致，区分外壳出现、目录就绪与可操作。
- 点击失败、超时或未进入目标页面时，采样失败，不能记录正常耗时。
- 可交互测量确认卡片和关键按钮可用；游戏启动测量区分平台 playing 与游戏实际就绪。
- 多次采样报告样本数和分布，不以一次热缓存值代表桌面最终性能。

## 5. 建议处理顺序

1. 完成 CR-01 的默认分发闭环，以及 CR-02、CR-03 的数据删除语义。
2. 合并设计 CR-04、CR-05 的实例生命周期方案，统一更新／卸载保护和退出回收。
3. 修复 CR-06，补工具结果关联与取消场景的回归测试。
4. 完成 CR-07、CR-08、CR-09，使验收结论可复查、脚本可判断失败、性能指标含义准确。
5. 开发 Agent 按项目规则提交修复与证据后，由主会话复核问题关闭情况，再给出发布意见。

本轮建议先完成上述收口，再评估新功能扩展。

## 6. 复验交付要求

每个关闭的问题应提供：修复提交、改动范围、对应回归用例、实际执行结果及未覆盖项。涉及接口变更时，同时提供契约变更说明。

复验应以新的明确提交为基线；自动化检查按项目现有规则执行，并补本文件对应的边界场景。桌面手工确认、隔离 headless、模拟时钟和纯单测须分别标注，不互相替代。

只有实际满足验收标准的条目才改为“已关闭”。未完成或决定延期的条目，保留原因、影响和处置结论，不能仅以测试总数通过代替问题关闭。
