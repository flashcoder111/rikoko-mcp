# rikoko 宿主导演能力升级验收

最终版本：**0.1.19**。日期：2026-10-18。

已修改代码、部署云端运行时、重启本地服务，并更新 Hermes 的 Skill 与参考文档。架构仍由宿主 Agent 负责导演、选材、看图和决定修复；MCP 负责执行、参数校验、证据与状态存储。没有新增内部自主导演或付费视觉评审服务，没有新增计费产品功能。

## 对同事建议的落实与扩展

| 原建议             | 本次实现                                                                                                                                | 通用化处理                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 保留动作收尾       | 替换视频默认使用完整素材；显式 `selected_range` 裁切或 `fit_target` 整段变速；报告丢弃尾段                                              | 新增 `full_asset / selected_range / fit_target` 时间策略，沿用 0.25–4 倍速度限制；不绑定具体商品或参考片秒数                    |
| 按镜头传画幅、时长 | 模型描述增加 `allowedParameters`，参数经过允许列表校验后进入实际 Fal/Replicate 请求；`generation_prepare` 返回精确操作                  | 目标画幅严格匹配、明确 contain/crop 策略、首帧画幅继承、首尾帧一致性、输出实际尺寸与时长偏差检查                                |
| 导演经验与固定模板 | 原创的视频导演、图片导演、实物流程 B-roll、视觉验收文档；新增提示词编译预览                                                             | 区分文生、首帧、首尾帧、参考、动作迁移、运镜迁移等提示词；不复制第三方措辞；预览不生成                                          |
| 参考输入分工       | 原片构图默认不作为生成输入；motion 明确 action/camera/rhythm 和排除项；提示词工具报告已声明的动作类型冲突                               | 每个输入只承担指定职责；保留旧分镜流程，同时提供独立目标分镜流程                                                                |
| 跨镜头状态表       | `production_plan_validate/save` 保存开头状态、主要动作、结尾状态；检查跨镜头冲突、重复 ID 和未解释跳转                                  | 目标镜头不依赖原片镜头数量；支持可选来源证据、未知状态、解释过的时间跳转；`production_shot_prompts` 将状态写入图片及视频提示词  |
| 看图与交付验收     | `media_inspect` 返回真实 MCP 图片块、采样网格、源哈希与时间；`media_review` 保存宿主判断；`workspace_validate` 返回裁切、尾段和占位检查 | 审核绑定素材字节与成片版本；明确区分 completed 和 accepted；`workspace_result purpose=final` 拦截缺少当前验收或仍有占位图的成片 |

新增 8 个 MCP 工具：`generation_prompt_preview`、`generation_prepare`、`production_plan_validate`、`production_plan_save`、`production_shot_prompts`、`media_inspect`、`media_review`、`workspace_validate`。

首尾帧路径已接入 `reference_storyboard_quote`：起始图仍需分镜审核，尾帧需要 `media_inspect` 和有效 `media_review`，随后在报价及提交前重新验证。显式 `visualKind=graphic` 渲染作者指定背景与文字，不再使用默认的 LOCAL COMPOSITION 装饰图；未声明的无素材镜头继续被视为占位。

## 验证

- MCP 仓库：71 个测试文件、**480 项测试通过**；TypeScript 与差异空白检查通过。
- 新能力定向验证：**42 项测试通过**；覆盖率：语句 90.36%、分支 86.68%、函数 94.82%、行 92.35%。
- 独立运行时：在 0.1.16 发布包上叠加本次改动；45 项原有及新能力测试通过，后续云端兼容修复的 9 项工具测试单独通过，独立类型检查通过。
- 平台仓库：**39 项云端测试通过**，类型检查与运行时压缩包校验通过。本机测试显式使用已配置的 Python 环境；容器使用其内置 FFmpeg/Python/Pillow/jsonschema。
- 使用 Hermes 的真实配置启动 MCP stdio，导入本地原创 FFmpeg 测试视频，收到 1 个真实图片块（3 帧网格），并实际查看了该网格。
- 真实宿主→本地服务→云端报价链：`duration=7`、`aspect_ratio=9:16` 和目标 720×1280 完整保留；16:9 与竖屏严格目标不符时返回 `GENERATION_ASPECT_MISMATCH`。
- 局部运动测试触发 `STATIC_CLAIM_CONTRADICTED`。帧差同时考虑平均变化和显著变化像素比例，避免只看全画面平均值时漏掉局部动作。
- 实际联调发现并修复了公开模型描述中 `references` 到内部 `bindings` 的转换问题，已新增回归测试。
- **未提交任何付费生成任务**；这次证明的是能力和工作流，不是模型画质或真实广告成片质量提升。

## 云端与 Hermes

- 云端最终镜像：`video-workbench-cloud:20261018-production-v3`；运行时版本 **0.1.19**，健康检查通过。
- 线上已有 H3 Max 接口继续使用，未切换模型。当前公开 schema 支持的整数时长子集配置为 1–15 秒；参考生视频可选画幅包含 9:16。H3 普通版内置档案配置为其公开 schema 的 5–15 秒。
- 已增加线上 `minimax-storyboard-first-last` 档案，使用现有 H3 Max 图生视频端点的 `end_image_url`。4 个相关生成档案的在线可用性已读取验证。
- 发布只重建应用容器。数据库容器仍保留 2026-10-12 的启动时间；激活前无排队/运行中的任务，原有云端 40 个任务与本地 91 个任务记录保留。
- 已备份旧应用镜像配置、模型档案和本地数据库；发布包从已部署版本叠加本次修改，未将工作区其他未完成功能打入云端包。
- Hermes 的 SKILL.md 和 4 个参考文档与仓库逐字节一致；安装器现在复制参考文档并备份被替换的本地版本。原有凭据、其他 MCP 服务配置保留。真实新连接已通过检查；已打开且缓存工具列表的会话需要重连 rikoko 或新开会话。
- 两个仓库均沿用已有 `main`；未创建分支，未提交或推送混有其他任务的工作区改动。

运行时包 SHA-256：`7c517b39f8c850999c6daae9279302f1dc4328a7b613f52ed09d27ef161d99df`。

## 能力边界

状态校验检查的是宿主声明的状态一致性，不会自动理解所有物理规律或推断食材/零件顺序。动作类型冲突检查需要宿主提供动作类型。画幅拦截需要操作携带目标规格；旧调用可以不携带以保持兼容。

`media_inspect` 每次最多采样 12 帧，不是全帧播放；`claimedStatic=true` 才执行静止结论的警告判定。低帧差不能证明整个时间段完全静止。最终画面、动作完成、产品事实与剪辑合理性仍由能看图的宿主或用户判断。

预览仍可导出，供迭代检查；严格交付检查由 `purpose=final` 启用。没有以工具运行成功代替人工/宿主验收，也没有自动重试付费生成。

证据目录：`artifacts/production-upgrade-2026-10-18/`，含真实连接验证、云端验证、测试日志、采样网格及相对任务开始快照的独立补丁。

接口范围核验来源：[H3 Max 图生视频 OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-max/image-to-video)、[H3 Max 参考生视频 OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3-max/reference-to-video)、[H3 文生视频 OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3/text-to-video)。
