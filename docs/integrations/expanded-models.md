# 扩展模型目录（2026-10-21）

本页保留上一批兼容模型记录。后续新增的 FLUX 3 Max、H3 Max、Seedance 2.5、
Nano Banana 2.1 和 Krea 3 见 [新一代模型目录](latest-models.md)。

新增 4 组模型、9 个生成档案，复用 fal 队列适配器。内置运行时与
`config/models.custom.example.json` 均包含这些档案。没有新增原生供应商协议。

| 模型 ID | 输入 | 可调规格 | 单次费用预留上限（美元分） |
| --- | --- | --- | --- |
| `kling-v3-pro-text` | 文本 | 3–15 秒；16:9 / 9:16 / 1:1 | 252 |
| `kling-v3-pro-first-frame` | 首帧 | 3–15 秒；比例继承首帧 | 252 |
| `kling-v3-pro-first-last` | 首尾帧 | 3–15 秒；首尾比例必须一致 | 252 |
| `wan-v2-6-text` | 文本 | 5/10/15 秒；720p/1080p；5 种比例 | 225 |
| `wan-v2-6-first-frame` | 首帧 | 5/10/15 秒；720p/1080p | 225 |
| `minimax-hailuo-2-3-text` | 文本 | 6/10 秒；上游 Standard 768p | 56 |
| `minimax-hailuo-2-3-first-frame` | 首帧 | 6/10 秒；上游 Standard 768p | 56 |
| `flux-2-pro-text` | 文本 | 固定单张 1024×1024 PNG | 5 |
| `flux-2-pro-edit` | 1–4 张图片 | 固定单张 1024×1024 PNG | 17 |

视频时长参数为字符串，例如 `parameters: {"duration":"10"}`。Kling 文生视频与 Wan
文生视频提供 `aspect_ratio`；首帧接口没有这个参数，比例由参考图片确定。
Hailuo 文生视频未声明可控画幅，不能承诺精确匹配目标画幅；有严格画幅要求时选择首帧接口。

Kling 固定开启原生音频，本次不开放 elements、voice control 或 multi_prompt。
Wan 关闭提示词改写与自动分镜，提示词最多 1500 个 UTF-16 码元，超限在提交前拒绝；
没有接入其外部背景音乐输入。Hailuo 关闭提示词优化，不提供音频能力承诺。
FLUX 编辑允许 composition/character/product/scene/style 角色，通过 `image_urls` 传递；
每张参考图最多 1024² 像素、10 MiB，总计最多 40 MiB。该限制是本项目的保守档案范围，
并非宣称覆盖上游全部能力。Wan 首帧限制 240–4096 像素，其他首帧限制 10 MiB。

## 价格依据与启用

以下公开价格和 API 文档于 2026-10-21 核对。`maxCostCents` 是整个允许参数范围的预留上限，
不是每次实际费用，也不是官方 API 售价。收集结果仍保留 `costCents=null`，不虚构供应商结算。

- [Kling 文生视频](https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video) 与
  [首帧接口](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video)：开启音频为
  $0.168/秒，15 秒上限 $2.52。voice control 不在本档案范围。
- [Wan 文生视频](https://fal.ai/models/wan/v2.6/text-to-video) 与
  [首帧接口](https://fal.ai/models/wan/v2.6/image-to-video)：720p 为 $0.10/秒，
  1080p 为 $0.15/秒，15 秒最高 $2.25。
- [Hailuo 文生视频](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/text-to-video) 与
  [首帧接口](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/image-to-video)：
  6 秒 $0.28，10 秒 $0.56。
- [FLUX 文生图](https://fal.ai/models/fal-ai/flux-2-pro) 与
  [图片编辑](https://fal.ai/models/fal-ai/flux-2-pro/edit)：首个输出 MP 为 $0.03，
  额外输入/输出 MP 为 $0.015。按每张 1024² 向上取整到 2 个十进制 MP 做保守预算，
  文生图向上取整为 5 美分；4 张输入加 1 张输出最多 10 MP，为 16.5 美分，向上取整为 17。

API 参数以对应 URL 加 `/api` 的 schema 为准。所有新增档案的公开费用上限已核查，
因此 `hardBoundConfirmed=true`；仍须账号拥有相应模型权限、有效 fal Key、付费开关及请求授权。
示例连接保持 `enabled=false`。价格或允许的输入/参数范围变化时必须重新核查费用上限与版本。

已有 `RIKOKO_CONFIG_FILE`、`FAL_MODELS_FILE` 或云端上游配置会替换内置目录。
在其 fal 连接的 `models` 中合并示例中的所需档案，保持原有 ID、连接与凭证，
按既有流程重新加载服务后才生效。不要直接覆盖现有配置；新建连接或改动旧连接会改变连接版本，
运行中的旧任务应先完成。此变更只修改仓库代码与示例，没有改动实际连接文件、重启服务或部署。

无人脸任务继续优先兼容的 Seedance Mini；涉及人脸或状态不明时，仍仅允许 MiniMax/Kling
并确认当前任务的模型选择。新增 Wan 档案不放宽这一限制。没有实际付费试生成，
接口与模拟测试通过不代表账号权限、供应商可用性或生成质量已经验收。
