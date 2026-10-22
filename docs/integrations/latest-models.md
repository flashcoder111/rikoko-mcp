# 新一代模型接入（2026-10-21）

根据 [fal 当前目录](https://fal.ai/explore) 重新选型，新增 5 组模型、12 个档案。
上一批兼容档案保留，新档案使用独立 ID，避免让已有请求悄悄切换模型。

| 模型 | 新档案 ID | 接入能力 |
| --- | --- | --- |
| FLUX 3 Max | `flux-3-max-text` / `flux-3-max-first-frame` / `flux-3-max-first-last` | 文生视频、首帧、首尾帧；5–20 秒，720p/1080p，原生音频 |
| MiniMax H3 Max | `minimax-h3-max-text` / `minimax-h3-max-first-frame` / `minimax-h3-max-first-last` | 文生视频、首帧、首尾帧；1–15 秒，可用小数；480P/768P/1080P |
| Seedance 2.5 US | `seedance-2-5-text` / `seedance-2-5-first-frame` / `seedance-2-5-first-last` | 文生视频、首帧、首尾帧；4–30 秒，480p/720p/1080p，原生音频 |
| Nano Banana 2.1 | `nano-banana-2-1-text` / `nano-banana-2-1-edit` | 文生图、1–4 张参考图编辑；单张输出，1K/2K/4K |
| Krea 3 Berry | `krea-3-berry` | 文生图；质量版本，固定单张 1024×1024 PNG |

[FLUX 3 Max 官方说明](https://fal.ai/flux-3-max) 标注其接口信息更新于 2026-10-18；
[Nano Banana 2.1 官方介绍](https://fal.ai/nano-banana-2.1) 明确区分新版本与 Nano Banana 2。
这里的“新一代”按本次核查的服务商目录认定，不承诺永久为各品牌最新版。
H3 Max 和 FLUX 3 Max 均为 fal 后训练版本，保留准确来源署名。

## 参数和参考素材

直接核对 fal OpenAPI 的实际类型，不能只凭网页显示的枚举文本推断：

- FLUX 3 Max：`duration: 10`，整数；1 秒步进。使用 `reasoning_level=low`，上游仍可能改写提示词。
- H3 Max：`duration: 4.5`，数字；关闭 `prompt_expansion_mode`，保留供应商安全检查。
  输出可能比请求长约 0.7 秒；此接入不自动变速裁时。
- Seedance 2.5：`duration: "10"`，字符串；排除 `auto`，使用 H.264 和标准码率。
  首帧和首尾帧的 `aspect_ratio` 固定为 `auto`，文本接口允许显式选比例。
- Nano Banana 2.1：提示词至少 3 个字符；固定单张、minimal thinking、关闭联网搜索和同步 data URI 返回。
  本次未接入视频/PDF 上下文。
- 首尾帧分别绑定 `image_url` / `end_image_url`，要求比例匹配。首帧接口不开放画幅覆盖，
  以便与 rikoko 从首帧推导画幅的预检保持一致。单张参考最多 10 MiB，首尾总计最多 20 MiB；
  Nano 编辑每张最多 4096² 像素、总计最多 40 MiB。这些是本项目的保守范围。

完整 API schema 来源为
`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint>`。
`tests/fixtures/fal-latest-schemas.json` 保存本次直接获取的 9 个接口约束快照，
只包含字段类型、枚举、必填项和数值/长度限制。测试将实际提交 payload 与独立快照比较，
不使用运行时档案本身作为唯一正确性依据。

## 费用上限与可用状态

| 档案组 | `hardBoundConfirmed` | 费用说明 |
| --- | --- | --- |
| FLUX 3 Max（3 个） | true | 按非促销 1080p $0.29/秒 × 20 秒，预留 580 美分 |
| H3 Max（3 个） | true | 按非促销 1080P $0.16/秒 × 16 秒，预留 256 美分，覆盖约 0.7 秒输出浮动 |
| Krea 3（1 个） | true | $0.025/输出 MP；1024² 保守向上取至 2 MP，预留 5 美分 |
| Seedance 2.5（3 个） | false | 按实际输出像素、时长和 Token 收费；5000 美分仅为待审核占位，不是报价 |
| Nano Banana 2.1（2 个） | false | 输入、图像输出、文本/思考 Token 分别计费；100 美分仅为待审核占位，不是报价 |

价格来源：[FLUX 3 Max](https://fal.ai/models/blackforestlabs/flux-3-max/text-to-video)、
[H3 Max](https://fal.ai/models/minimax/h3-max/text-to-video)、
[Krea 3](https://fal.ai/models/krea/v3/text-to-image/api)、
[Seedance 2.5](https://fal.ai/models/bytedance/seedance-2.5/us/text-to-video)、
[Nano Banana 2.1](https://fal.ai/models/google/nano-banana-2.1)。
FLUX 与 H3 的价格取促销结束后的标准价，促销结束不会使本地上限突然不足。

Seedance 公布的是按输出尺寸计算 Token 的公式，当前档案未证实所有比例的最大实际输出像素；
Nano 公布的单图示例费用不是文本/思考 Token 的硬上限。不能把这些示例值标记成已核查上限。
两组接口已完成参数和参考素材适配，但必须由运营核对账号计费范围及可执行的费用上限，
更新 `maxCostCents`、`priceVersion` 并确认 `hardBoundConfirmed` 后才允许付费调用。
未确认时 `available=false`，有 Key 和付费开关也不能提交。

所有档案仍受有效凭证、账号权限、付费开关和单次请求授权约束。示例连接保持关闭。
费用预留上限不是供应商实收；结果收集继续将未知成本记为 null。

## 接入位置与验证边界

- 内置目录：`packages/providers/src/latest-models.ts`，已注册到本地运行时。
- 自有配置：`config/models.custom.example.json` 包含全部 12 个档案。
- 已指定 `RIKOKO_CONFIG_FILE` / `FAL_MODELS_FILE` / 云端上游文件时，需合并新档案并按现有流程重新加载。
  不覆盖现有连接或切换进行中的任务。
- 无人脸任务仍默认兼容的 Seedance Mini；Seedance 2.5 也受全部 Seedance 人脸禁用规则约束。
  人脸存在或未知时继续仅允许 MiniMax/Kling 并确认具体选择，FLUX 3 Max 不绕过该规则。
- 本次不修改实际连接、密钥或运行中服务；没有部署、付费试生成或生成质量验收。
