# 制作方法发布与 CS2 原片编辑接口检查 · 2026-10-21

## 发布结果

本地和云端均已部署 `rikoko@0.1.28`。沿用两个仓库的已有分支，没有创建分支、提交或推送。此前未发布的工作台、官网及云存储改动未混入云端镜像。

- 本地运行时：`.data/releases/20261021-production-method/runtime`；4310 主服务保留 192 条任务，4311 验证服务也已升级。
- Codex、Hermes、Claude Code、Claude Desktop 的现有配置已更新；分别以新 stdio 连接验证通过。已打开的宿主会话可能缓存旧工具列表，需要重连 rikoko MCP 才显示 `production_method_resolve`。
- 云端镜像：`video-workbench-cloud:20261021-production-method-v1`。通过既有数据库任务准入锁切换，切换前后 125 条任务、0 个活动任务；数据库容器未变，模型配置哈希未变，Compose 只改应用镜像。
- 运行时归档：`artifacts/production-method-release-2026-10-21/runtime-pack/rikoko-0.1.28.tgz`。
- SHA-256：`9eaf20cf9005ec9914569e23565a5e5625708ea727110a84518eb825596f04b7`。
- 平台工作区的 vendor 包、依赖版本和相应 lockfile 条目已同步升级；其他已有改动保留。安装包校验通过。

发布基于已部署的 0.1.27，仅覆盖制作方法及其镜头参考选择依赖，共 19 个运行时文件和版本号。平台代码、前端构建、Python 媒体模块及数据库迁移的 54 个文件与旧镜像逐项相同。首次归档携带的 macOS AppleDouble 元数据边文件已在候选目录中识别并清除后重建，正式镜像的比对结果为完全一致。

旧镜像及受限权限的配置、数据库备份保留。云端回滚前仍需确认没有活动任务并取得相同准入锁，不能直接覆盖数据库或移除容器卷。

## 验证

- 候选运行时：7 个测试文件、68 项检查通过；源码类型检查通过。平台运行时、准备流程及 O3 合同共 3 个测试文件、10 项通过。平台首次使用系统 Python 时缺少媒体依赖；指定已有 `MEDIA_PYTHON=/Users/west/project/rikoko-mcp/python/.venv/bin/python` 后通过，未改动媒体代码。
- 新镜像：关闭网络、只读文件系统下完成真实 FFmpeg 渲染，3 个交付附件，0 次模型调用；新版方法入口、指南和原片参数继承验证通过。
- 公网 HTTPS、鉴权生成协议以及原片和方法约束验证通过。非法的原片编辑时长计划返回 `INVALID_PRODUCTION_PLAN`，未创建任务。
- 真实 CS2 素材经新入口返回 `source_edit`，继承 854×480、17042 ms、两张角色参考，状态为 `capability_gap`，没有回退到参考生成。
- 本次没有上传素材到新供应商或提交视频生成，未验证任何新模型的实际人物、动作和镜头保真效果。

## 接口检查

检查范围为 rikoko 当前本地/云端配置、已有 fal 凭据，以及当前可访问的 Pollo 连接。没有搜索其他项目的凭据。只读鉴权查询不能证明模型推理权限、余额足够或最终质量。

| 接口 | 实际连接证据 | 对本片的判断 |
| --- | --- | --- |
| fal Seedance 2.5 `bytedance/seedance-2.5/reference-to-video`，固定 `task=editing` | 当前云端 fal 凭据查询模型价格 HTTP 200 | 优先接入候选。公开合同支持原片编辑、图片参考、480p，编辑模式自动继承时长和比例；854×480、24 fps、17.042 秒符合公开视频尺寸/帧率/时长范围。尚未配置进运行目录，未试生。 |
| fal Kling O3 Pro `fal-ai/kling-video/o3/pro/video-to-video/edit` | 现有适配代码；相同凭据查询价格 HTTP 200 | 真正的原片编辑，但要求源片 3–15 秒、边长至少 720。完整 CS2 原片时长及高度均不满足；不应自动拆片或放大来冒充符合原要求。 |
| Pollo `wan-v3-0` / `wan-v3-0-prime` video-edit | 目录和账户查询成功；目录接受 video、多张 images、480p、adaptive | 有潜力的备用路径，但返回合同没有给出原片时长上限或精确时长继承保证。账户仅 3 credits、Free，生成可用性及额度是否足够未验证；也未接入 rikoko 网关。 |
| Pollo Runway Gen-4 Aleph | 目录可读，支持视频与最多 4 张图片 | 返回合同没有足够的时长/尺寸继承信息，本次不据此选为完整 17 秒方案。 |
| 当前 rikoko MiniMax H3 配置 | 当前在线目录可用，有图生视频、首尾帧和参考生成 | 不具备当前目录声明的原片编辑合同；不能为了默认模型偏好退回普通参考生成。 |
| HiAPI Seedance 2.5 | rikoko 运行环境没有配置 HiAPI 凭据 | 公开文档可读，实际账户权限未验证，不列为已接通。 |

### Seedance 接入前的具体缺口

fal 要求 `video_urls: [原片 URL]`。rikoko 的 `generationInputSchema` 当前把 `source_video` 的必需绑定限定为非数组；离线使用真实资产元数据验证时明确返回 `Source video must be required`。因此不能只填模型名或把数组字段伪装成字符串字段。

后续接入应允许“必须恰好一条原片，但传输形式为数组”的绑定，并固化 `task=editing`，不可让宿主切回默认 `reference`。角色图通过 `image_urls` 传输，图1对应前方恐怖分子、图2对应后方警察；源视频通过 `video_urls` 传输。继续使用原片时长合同与 1 倍速合成，最终画布为 854×480。按实际输出检查时长和画面；若关闭生成音频，应在最终合成中复用原片音轨，不能把新生成音轨当作原声。

现有本地单素材 20 MiB、总参考 40 MiB 限制可继续保守使用；不需要因为供应商上限较高而直接放开。帧率和宽高比还需按供应商合同校验。示意配置保存在 `seedance-edit-profile.draft.json`，明确是未启用、未完成适配且无有效费用上限的草稿，不应复制为在线可用模型。

fal 只读查询返回 Seedance 单价 0.0214 USD / 1000 tokens、Kling 0.14 USD / 秒；这不是本次视频报价，也不能据此推定余额、总价或开通权限。没有使用空请求或无效推理提交来探测权限。

## 证据与来源

本地证据目录：`artifacts/production-method-release-2026-10-21/`。主要文件包括 `candidate-scope.json`、`runtime-tests.log`、`candidate-verification.json`、`image-diff.json`、`activation.log`、`host-verification.json`、`cloud-live-verification.json`、`cs2-live-method-resolution.json`、`fal-readonly-connectivity.json`、`pollo-readonly-connectivity.json`、`offline-edit-compatibility.json`。

- [fal Seedance 2.5 API 合同](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api)
- [fal 编辑模式说明](https://fal.ai/learn/tools/how-to-create-multi-angle-video-seedance-2-5)
- [fal Kling O3 编辑合同](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit/api)
- [fal 只读价格查询](https://fal.ai/docs/platform-apis/v1/models/pricing)
- [HiAPI Seedance 2.5 接口说明](https://www.hiapi.ai/en/blog/seedance-2-5-reference-to-video-api-guide)
