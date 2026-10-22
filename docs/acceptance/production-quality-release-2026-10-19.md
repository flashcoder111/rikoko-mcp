# 通用生产质量能力上线验收：0.1.24

2026-10-19 已完成云端发布、本地服务重启、Hermes Skill 同步和当前 Desktop 会话的 MCP 重载。没有创建分支、提交、推送、发布 npm/安装器版本或调用付费生成。

## 发布结果

| 项目 | 结果 |
| --- | --- |
| 云端运行时 | `0.1.24`，公网 HTTPS `/health` 返回 `status=ok` |
| 应用镜像 | `video-workbench-cloud:20261019-production-quality-v1` |
| 上一镜像 | `video-workbench-cloud:20261019-host-adaptation-v1` |
| 运行时包 | `rikoko-0.1.24.tgz`，214 个文件 |
| 包 SHA-256 | `45c0ee4ed39c52034f916f07286637a77aa6c7e8b3f608b6f3e875525de931fa` |
| 本地服务 | 原参数和环境重启成功，重启前后 134 条任务记录保留；之后新增合成素材测试渲染 |
| Hermes Skill | 入口及 13 份 references 同步；`production-quality` 指引哈希与源码相同 |

云端候选以已经部署的 0.1.23 为基线，选择性叠加本次质量能力，共 20 个文件新增或变化；两套前端构建产物共 40 个文件逐字节保持一致。未把工作区其他诊断、工作台交接或界面功能打入此次云端包。平台应用和管理页面源码沿用已部署版本，平台仓库中的 runtime 包、依赖和锁文件已固定到 0.1.24；其他已有改动保留。

## 实际工具与规则验证

使用已安装 Hermes YAML 配置建立真实 stdio 连接，经实际本地服务执行 **24 项验证，全部通过**。素材是 FFmpeg 本地生成的几何画面和音调，标记为测试夹具；没有为它们记录虚构的视觉或听感验收。

| 场景 | 实际结果 |
| --- | --- |
| 新工具、能力及指南 | 发现 `production_editing_preview`；`productionQuality` 字段完整；指南哈希一致 |
| 提示词编译 | 返回 `rikoko-direction-v3` 与逐工序验收项 |
| 跨镜头状态重置 | `PROCESS_STATE_DISCONTINUITY` |
| 动作阶段重叠 | `PROCESS_PHASE_ORDER` |
| 卡点正常 / 偏移 300ms | 正常时间线通过；偏移返回 `MUSIC_SYNC_MISMATCH` |
| 音频文件哈希变化 | `AUDIO_SOURCE_CHANGED` |
| 删除已有质量契约 | `PRODUCTION_QUALITY_REQUIRED` |
| 缺少逐工序验收 / 稀疏动作证据 | `PRODUCTION_QUALITY_REVIEW_REQUIRED`，旧通用检查中的“不适用”不能绕过 |
| 成片验收未提交当前作用域 hash | `PRODUCTION_SCOPE_CHANGED` |
| 用截图或音频数值分析代替试听 | `PRODUCTION_QUALITY_REVIEW_REQUIRED` |
| 广告停留 500ms，要求 1500ms | `PRODUCTION_QUALITY_REVIEW_REQUIRED` |
| 已完成真实渲染，但未获得必要验收 | `finalReady=false`；最终交付返回 `FINAL_REVIEW_REQUIRED` |

实际 `media_inspect` 返回了原生 MCP 图片块，保存的三帧网格已由本次代理查看。实际 FFmpeg 渲染也成功完成；这证明媒体处理与门禁调用链工作，不是生成模型的质量评估。

公网 HTTPS 上的实际认证接口另有 **6 项验证通过**：健康版本、准备协议、保存增强工序/收尾计划、禁止计划删除契约、禁止作用域切换到无契约计划、拒绝错误动作时序。云端仅新增隔离的测试镜像记录，没有报价或生成任务。

新镜像还在禁网、只读文件系统的临时容器中通过工具/schema/指南检查和缺失质量验收拒绝检查。初次辅助 smoke fixture 漏填 `product_brand` 所需的品牌文字，被现有 `ENDING_INTENT_INCOMPLETE` 正确拒绝；补全测试夹具后通过，未放宽业务规则。

## Hermes 当前会话

调用 Desktop 已有原生 `reload.mcp {confirm:true}` 和 `skills.reload`，均成功。Desktop 后端 PID 不变，旧 MCP 子进程被新子进程替换；live registry 的 rikoko 工具由 79 增至 80，当前已有会话的工具目录也出现新工具。

Hermes 会延迟加载 MCP 工具，模型前置数组只有 19 项；新工具经 `tool_search` 发现，不应以这 19 项列表判断更新失败。另行执行 `hermes mcp test rikoko`，原始 MCP 发现 78 个工具；Desktop registry 与原始协议使用不同计数口径，本次分别保留实测值。`pnpm clients doctor hermes --media` 的真实 FFmpeg 提取检查通过。

没有向 Hermes 发送 LLM 消息，也没有测试真实模型的看图、试听或聊天附件送达。`hostVisionVerified` / `hostDeliveryVerified` 仍为 false，不能用连接检查代替这些能力验证。

## 发布验证与数据保护

- 原工作区已有 685 项测试通过、1 项跳过。独立发布候选的 645 项测试在补齐验证专用资源后通过：全量运行通过 644 项，1 项源代码导出测试因运行时包不含源文件而失败；补齐该验证资源后，其所在文件 17 项全部通过。发布包不因此增加源码资源。
- 平台 46 项云端测试在补齐测试示例配置后通过：初次 44 项通过、2 项缺少示例配置；对应 2 个文件重跑 4 项通过。类型检查及 runtime 包校验通过。
- 代码、Python 运维脚本和 TypeScript 验证脚本均经过专项审查；独立 artifact 类型检查修复了 SDK 参数数量问题。没有未处理的发布阻断项。
- 切换应用前确认云端无活动任务，保存数据库 dump 和原应用 compose；激活前后云端任务数均为 75，活动任务为 0，数据库容器及模型配置哈希保持不变。管理页面及静态文件通过 HTTP 字节校验。
- 服务端回滚快照位于 `/opt/video-workbench-cloud/releases/20261019-production-quality-v1/backup/`。恢复其中原 compose 后，只重启 cloud 服务即可回退；无需恢复或重建数据库。本次未实际执行回滚。
- 本地保存独占的私有备份目录、原进程参数/环境及离线数据库备份；启动失败时可恢复先前已部署运行时。凭据未写入公开报告或制品。

脱敏证据位于 `artifacts/production-quality-release-2026-10-19/`：`hermes-quality-verification.json`、`hermes-live-verification.json`、`cloud-quality-verification.json`、`image-verification.json`、`runtime-diff.json` 及验证日志。

本次证明新协议和验收规则在实际部署中生效。是否改善 MiniMax 对真实广告的动作、物理表现和音乐效果，仍需要后续实际生成与逐项观看/试听；本次没有产生付费生成费用。
