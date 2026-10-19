# 成片直接交付发布验收：0.1.25

2026-10-19 已提交并部署审核／交付策略，更新本机已安装的 Codex、Hermes、Claude Code 和 Claude Desktop 连接。没有创建分支，没有调用付费生成或审核服务。

## 发布内容与范围

- 关键输入图片保留一次快速检查，相同判断的重试不再使 Storyboard 版本持续变化。
- 完成的视频不再需要源视频或最终成片 AI 审核通过。`workspace_result` 默认 final，技术校验通过即交付。
- `reviewAccepted` 与技术 `finalReady` 分离；保留真实的未审核或负面反馈，不自动触发质量重生成。
- 所有权、已绑定范围、素材来源与时间范围、文件完整性等技术检查继续执行。
- 运行时提交 `740f10b`，平台固定依赖提交 `1002fb3`。由于之前部署的生产质量和分镜隔离代码尚未提交，本次提交包含其必要依赖；未发布其他工作台界面、导演库和直接报价提交等独立工作区改动。

云端以既有 0.1.24 及已上线分镜隔离修复为基线，214 个运行时文件中改变 23 个，两套前端、Worker 和 Python 文件保持原字节。平台应用沿用已发布源码，仅固定新的 runtime 包。

## 实际部署

| 项目 | 实测结果 |
| --- | --- |
| 公网 HTTPS 健康 | `status=ok`，`runtimeVersion=0.1.25` |
| 云端镜像 | `video-workbench-cloud:20261019-direct-delivery-v1` |
| 运行时包 SHA-256 | `7f99ed293cf9e683b61083296d2c1f51ad925470469da59c3d8e383e16f44850` |
| 认证准备协议 | `rikoko-cloud-preparation-v1`，实际 HTTPS 请求成功 |
| 云端任务 | 切换前后均 86 条，切换后活动任务 0 |
| 云端配置与数据库 | 模型配置哈希不变；数据库容器 ID 与启动时间不变 |
| 本机服务 | 新 PID 77703；原有 146 条任务保留，配置与凭据保留 |
| 安装位置 | `.data/releases/20261019-direct-delivery/runtime/`，版本 0.1.25 |

部署在数据库任务准入锁下检查空闲并切换应用，仅修改 Compose 的 cloud image 字段。保存原 Compose 与数据库备份；回退点为服务器 `/opt/video-workbench-cloud/releases/20261019-direct-delivery-v1/backup/`。回退应用不需要恢复数据库。没有实际执行回滚。

本机以此前隔离安装的分镜修复版为基线合并本次策略，保留已经安装的媒体诊断修复。修改前备份四个宿主连接配置，仅替换 rikoko stdio 入口路径，保留其他连接和环境配置。Codex、Hermes、Claude Code 同步托管 Skill；Claude Desktop 从 MCP 读取指南。

## 验证证据

- 原开发工作区：716 项通过、1 项跳过，类型检查通过。
- 独立候选：100 项定向检查中最初 16 项因 Python 环境未配置或独立导演库断言不属于此次发布而失败；配置现有 Python 环境并移除该无关断言后，相关 24 项全部通过，其余 84 项此前通过。
- 候选全量运行：659 项通过，2 项失败来自误拷入的未发布工作台交接功能测试。仅从候选中移除这两个无关测试，原工作区保留；对应 workspace 文件重新运行 12 项全部通过。
- 平台固定包：类型检查及 runtime 校验通过，配置现有 Python 环境后 46 项测试全部通过。
- 实际云端镜像：禁网、只读容器中完成真实 FFmpeg 合成卡片渲染并直接交付 3 个附件，无任何审核记录，模型调用 0。
- 四个已安装宿主分别建立真实新 stdio 连接，全部读到 `finalAiReview=off_by_default`、`automaticQualityRegeneration=false`、`finalReviewRequired=false`；工具 schema 默认 final，visual-review 指南哈希与安装文件一致。
- 实际 Codex 配置经真实本地服务完成免费合成渲染和交付：`finalReady=true`、`status=unreviewed`、`reviewAccepted=false`，未新增审核记录。
- Hermes Desktop 已在连接详情执行 Refresh tools，界面显示新安装目录及 78 个工具。当前 Codex 连接直接调用 capabilities 也已返回新后端策略。已有会话缓存的旧工具说明仍应重连后刷新；桌面控制工具不允许操作 Codex 应用，未擅自结束当前会话。

脱敏证据位于 `artifacts/direct-delivery-release-2026-10-19/`：`image-verification.json`、`image-diff.json`、`cloud-live-verification.json`、`host-installation.json`、`host-verification.json`、`local-restart.json` 和测试／部署日志。私有配置备份留在 `.data/releases/20261019-direct-delivery/`，不提交。

本次未发布新的公开 GitHub 安装器或 npm 包。更新对象是现有云端与本机安装；没有以实测合成卡片推断实际生成模型的画面质量或出片时间。
