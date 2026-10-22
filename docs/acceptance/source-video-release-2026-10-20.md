# 原片参考链路与安装更新：0.1.26

日期：2026-10-20。已完成云端、本地安装更新及旧版本清理。当前已有 main 分支，无新分支、提交、推送或付费生成；保留原有工作区改动。

## 修复范围

- 镜头新增 sourceVideo 决策：reference 必须绑定实际生成用 motion/source_video 素材；reconstruct 必须有明确原因且不得同时声称传入视频。新请求绑定且含原视频的 source-linked media 镜头必须作出决策。旧无请求绑定计划保持可读兼容。该校验不判断所选片段是否在语义上合适，也不能代替用户视觉判断。
- generation_prepare 返回 referenceDelivery 清单：真实资产 ID、SHA-256、视频时长、provider field/index、视频数量，以及 analysis_only 参考。明确标记 prepared_not_submitted，不能将准备记录当作实际供应商收件或生成遵从证明。
- 指南优先考虑对应原片动作片段＋目标产品图；不能把分析报告当成已传视频，不应静默改用 i2v。保留边界状态控制等合理重建路线。
- 包含此前已本地验证的当前请求附件绑定、关键图片检查、提示词与剪辑文案隔离、保留片段端点连续性校验和诚实交付状态。导演指南由 MCP 后端统一读取。
- 暂缓发布的工作台界面与 Hermes handoff 不纳入本次运行时。先前本地 0.1.25 与云端 0.1.25 的前端原本不一致，候选因此重新打包，最终统一采用已部署云端的前端字节。

## 核验

- 独立候选全量：716 项通过、1 项新测试夹具缺少 target 导致失败、1 项既有跳过；补齐夹具后该文件 4 项全通过，最终 717 项有效通过、1 项跳过。产品代码未为此放宽校验。类型检查、格式与指南 manifest 校验通过。
- 云平台：首次 39 项通过，Python 环境未指定导致媒体相关失败/跳过；使用 MEDIA_PYTHON 指定现有环境后相关 4 文件 34 项通过，合并为全部 46 项通过。平台类型与固定 runtime 校验通过。
- 新测试贯穿云端声明、文件哈希绑定与 FalProvider HTTP 请求体，确认产品字节进入 image_urls、原片字节进入 video_urls，错误片段被拒绝；供应商为模拟，不产生费用。
- 安装包在隔离环境完成真实 FFmpeg 合成渲染及三附件交付，finalReady=true、reviewAccepted=false，模型调用 0。未进行新的真实视频质量试验。

## 本机额外发现

Hermes 配置原先排除了 78 个 rikoko 原生工具。其 learned Skill 包含以亮度/边缘统计判断物体删除、将图片块改为文件路径的旧脚本指导。更新需恢复原生工具，归档旧 Skill 并让新会话读取 MCP 指南，不能只替换源码。不会因此宣称 DeepSeek 当前模型获得视觉能力。

## 制品

- runtime：rikoko-0.1.26.tgz，231 文件。
- SHA-256：435df24dd44f2848c3f6e61dddf75e0f1970ef8155e9e3c673c7d1cc7a22756c。
- 本地运行时目录：.data/releases/20261020-source-video/runtime。
- 执行日志与脱敏证据：artifacts/source-video-release-2026-10-20/。
- 本次没有公开发布 npm 或 GitHub 安装器。

## 实际激活与清理

- 云端应用镜像：`video-workbench-cloud:20261020-source-video-v1`。公网 HTTPS `/health` 返回 `runtimeVersion=0.1.26`；真实认证接口识别并拒绝缺少实际 motion 绑定的 sourceVideo 声明。
- 激活前后云端任务数均 99，活动任务 0；数据库容器与模型配置哈希不变。切换使用已有数据库任务准入锁并保存数据库/Compose 备份，未执行 orphan/container/volume 全局清理。
- 最终镜像与旧云端在平台源码、两套前端、Python 和数据库迁移共 54 个文件上逐字节一致。镜像在禁网、只读容器完成真实 FFmpeg 渲染和交付，模型调用 0。
- 本地默认 4310 服务切换前后 158 条任务保留；随后只增加一条免费合成渲染验收任务，最终 159 条。此前 4311 验证服务也更新为同一运行时，7 条任务与汉堡验证素材保留。
- Codex、Hermes、Claude Code、Claude Desktop 配置均指向新的隔离运行时；各自真实新 stdio 连接、工具 schema、后端指南哈希、错误绑定拒绝均通过。四个 `clients doctor --media` 检查通过，指南版本/运行时一致；真实宿主模型看图能力仍未据此宣称验证。
- Hermes 旧的 78 工具排除列表已移除，并在 Desktop 刷新/重新连接；界面实际显示新路径及“79 tools all on”。其 learned Skill 和额外脚本完整归档到宿主扫描目录外。Codex 和共享 Claude 的官方旧 Skill 也已归档；共享父目录和其他 Skill 未动。
- 本地停止 7 个仍引用旧安装路径的 MCP 进程，移除 3 个旧运行时目录、43 个旧包文件（含发布候选中的旧依赖归档）和 26 个旧安装依赖目录。源码历史证据、用户项目/素材/任务、数据库与配置备份保留。
- 云端清理 20 个旧/被否决候选镜像、19 个旧构建目录和当前构建源中的一个不用的旧归档；数据库、配置和备份保留。未清理其他产品镜像或任何数据库卷。
- 清理后再次核验云端 HTTPS、认证协议、两套本地服务、四个配置路径、旧 Skill 缺席、新固定依赖完整性，均通过。证据在 `cloud-live-verification.json`、`host-verification.json`、`final-local-check.json`、`cleanup-local.json`、`cleanup-cloud.json` 和相应 doctor 日志。

## 会话与质量边界

已有 Codex/Claude 对话可能缓存旧工具定义，须重连 MCP 或开启新会话。Hermes Desktop 已刷新连接；旧对话里过去生成的错误文字不会被软件升级自动擦除，后续制作应读取新指南。此次完成的是原片输入/宿主路径和版本落地验证，不证明生成画面已经超过 Hypit。没有新增付费图片/视频/视觉模型调用，原先 10 美元授权的保守占用记录仍为 9.92 美元，不重置也不追加。

