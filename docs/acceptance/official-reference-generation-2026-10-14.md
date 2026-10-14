# 官方参考生成修复 · 2026-10-14

## 原因

旧客户端在发出请求前拒绝任何 references、mode 或 storyboard。云端没有用户参考素材上传入口，独立 GenerationWorker 也未解析并传递参考素材。服务器只读检查另外确认：未配置 CLOUD_FAL_KEY、CLOUD_MODELS_FILE 或 CLOUD_PROVIDERS_FILE，付费开关关闭。这是协议与配置问题，不是供应商对用户内容作出的审核拒绝。

## 修复

- 官方客户端先校验本地素材归属、字节哈希与分镜审阅，再上传真实字节。只向配置的同一官方 origin 发送凭据，拒绝重定向。
- 云端提供认证的 `/v1/reference-uploads` 与二进制 PUT 接口；要求 write 权限，在读取正文前检查素材意图归属，限制真实长度、并发、有效期，使用真实媒体探测。只返回 ID/哈希/长度/类型，不返回存储路径。
- 上传映射按本地账户、官方 origin、凭据摘要和素材内容隔离并持久化；报价保存云端输入和本地快照，提交不重新上传或更换素材。相同业务幂等键复用任务。
- 分镜工具读取官方模型目录，支持已有兼容模型的 image_edit、image_to_video、first_last_frame、reference_to_video 等声明模式，不降级到自有供应商。分镜工具自动编排范围仍是图编辑、首帧或多参考视频。
- 分镜及审阅保留本地，在报价及正式提交前检查。云端使用已确认的素材快照；任务提交后的审阅变更不会撤回已采购任务，需要显式取消。
- 本地与云端共用参考解析逻辑。云端 worker 向供应商传入有序参考、使用 R2 短时签名 URL，或在适配器声明支持时使用有界 data URI。解析结束后再次检查取消与租约。
- 公共运行时升级 0.1.3；媒体执行器从自身安装包定位 Python，避免平台运行目录导致找不到媒体模块。云镜像增加 FFmpeg、Python、Pillow 和 jsonschema，临时盘提高到 384 MiB 以支持受限上传探测。

## 验证

- RED：客户端 4 个用例复现原拒绝；云端认证上传入口返回 404。已在原 main 创建范围明确的检查点提交，未新建分支。
- MCP 全量覆盖率：42 文件、296 项通过；语句 88.66%、分支 82.83%、函数 89.56%、行 89.67%。类型检查与构建通过。
- 平台类型检查及最终云端全量 4 文件、28 项测试通过；Python 媒体 4 项通过。
- 新增验证覆盖：跨账户和只读拒绝、实际上传字节、哈希不符、报价后素材变更、分镜版本变更、官方目录选模、上传复用、桥接重建、重复提交、本地不扣官方额度。
- 云端使用真实 PNG 与媒体探测，供应商任务使用明确模拟响应；不代表供应商账号已接通或生成质量已验收。

## 范围

本次修复参考素材生成及分镜生成通道。官方参考视频语义分析、动态生成参数、支付和公共安装发行未在本次实现。现有 fal 可提供 MiniMax 图生视频和参考生视频接口，不需要因本次协议问题更换供应商；具体端点、账号权限、价格和预算仍需上线前核对。没有实际购买生成。

上游资料：[fal MiniMax H3 产品说明](https://fal.ai/minimax-h3)、[H3 Max 图生视频接口](https://fal.ai/models/minimax/h3-max/image-to-video/api)、[H3 Max 参考生视频接口](https://fal.ai/models/minimax/h3-max/reference-to-video/api)。旧 H3 具体路径本轮未得到可靠直接文档响应，不能据此认定其账号可用性。

## 部署与真实存储验证

- MCP 本机后端已在保留原进程配置的情况下正常停止、备份 PGlite 并重启，原有 32 个已完成任务保留。`pnpm clients doctor codex` 真实 stdio 连接通过，48 个工具可用；用户已打开的连接仍需重连以刷新已加载代码。
- 测试云平台已从提交 `92799d9` 部署，运行时为 `rikoko@0.1.3`。发布目录 `/opt/video-workbench-cloud/releases/20261014-reference-92799d9/`；镜像 `video-workbench-cloud:20261014-reference-92799d9`。公网 HTTPS 健康接口通过，仅更新 cloud 服务，未重启数据库和代理。
- PostgreSQL 备份为 `/opt/video-workbench-cloud/backups/workbench_cloud-20261014-before-reference.dump`，`pg_restore --list` 验证通过。旧 Compose 保存在发布目录的 `compose.application.before.json`；恢复该文件并只重建 cloud 服务可回滚。
- 真实服务器验收使用临时零额度账户和原创 PNG，完成鉴权上传、真实媒体探测、R2 写入与哈希回读、供应商短时签名 URL 下载校验、重复上传复用。没有使用公共模板桶发布用户素材。测试账户、数据库记录和 R2 测试对象已清理。
- 云端回读模型目录仍为 0，扣款和预留均为 0。服务器 SSH 权限已可用；剩余上游缺项是凭据、模型档案以及真实生成测试预算，已向用户请求凭据配置位置和预算，不要求在对话粘贴密钥。
- 本次创建的 Git 提交仅在当前 main，未推送远程；云端通过已提交源码归档部署。平台无关官网改动保留。
- 脱敏证据：`rikoko-platform/artifacts/releases/20261014-reference-fix/verification.json`；本机备份与重启记录在 `.data/releases/20261014-reference-fix/`。
