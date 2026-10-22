# 官方综合 API 套餐与 config 自有接入

工作台提供两种运行方式。官方套餐由网关鉴权、预留和结算额度；自有服务由用户在 config 中声明连接和模型，直接使用自己的供应商账户。不提供“我的模型服务”交互设置页，也不自动在两种付费来源之间切换。

## 多模型与指令入口

当前产品模型接口统一通过 **fal.ai** 接入。Seedance Mini、MiniMax、Kling 等是模型选择，统一通道由 fal 承接；官方模式通过官方计费网关访问上游，自有模式使用自己的 fal Key。用户不需要为每个模型品牌配置原生 Key。

Agent 使用 `/rikoko models` 查看实际目录、`/rikoko model <ID>` 选择模型；工作台使用 `/models`、`/model <ID>`，输入 `/` 可发现更多指令。模型分为视频、图片、语音和其他音频，各类型独立保留选择，例如生图、视频和配音可分别使用不同模型。选择模型本身不会提交生成任务。无人脸视频默认匹配兼容的 Seedance Mini；涉及人脸或人脸状态不明时禁止全部 Seedance 系列，推荐 MiniMax，也可选 Kling，并与用户确认。显式模型选择不能绕过此限制；模型不可用时需说明原因，不静默替换。

时长和画幅通过自然语言表达，例如“做一条 15 秒、9:16 竖屏的视频”，不设独立指令。Agent 按任务类型整理参数：视频时长/画幅、图片画幅/分辨率、语音文案/语言/音色，并区分成片总时长与单段生成时长。目录的 `fixedParameters` 仅公开允许展示的固定规格，未知字段不推断为任意可用。当前生成服务按固定参数档案报价，Agent 匹配对应模型 ID，服务端将档案参数提交给 fal；`generate.parameters` 仍为空，不接受客户端任意覆盖价格相关参数。工作台直接生成沿用所选固定规格，描述本身不能改变规格；复杂要求由 Agent 编排。

新增模型时，在 fal 连接内添加独立且唯一的模型档案，核对真实 endpoint、固定参数、参考输入映射与费用上限，再启用。目录通过 `capabilities.providers` 动态发布，指令菜单无需为品牌添加分支。Seedance 2 尚未在本次改动中接通，也未预置供应商接口或价格。画幅和时长目标必须与具体档案匹配，不能靠提示词覆盖固定参数。

历史 Replicate、原生 Gemini 适配器仍为兼容既有自部署配置保留，不作为当前产品模型接入或自动回退方案。

## Kling O3 原视频编辑

新增 `kling-o3-video-edit`，复用 fal 队列端点 `fal-ai/kling-video/o3/pro/video-to-video/edit`。它用于修改原视频中的人物、物体、环境和风格；普通剪切、字幕、配音与整片合成继续使用本地编辑器。无人脸视频默认 Seedance Mini；人脸任务默认推荐 MiniMax，用户也可明确选择兼容的 Kling O3。

`generationInput.mode=video_to_video` 要求一个 `source_video`，映射到 `video_url`；可选的 0–4 张人物/产品/场景/风格/构图图片按请求中的相对顺序映射到 `image_urls`。提示词使用 `@Video1`、`@Image1` 等。当前接入不声明 `elements` 嵌套角色绑定；不要在提示词中虚构 `@Element`。`keep_audio=true` 为服务端固定参数，并公开到 `fixedParameters`。更换音频保留策略需要独立档案及新报价。

O3 使用 `outputDurationSource=source_video`，不填写固定 `outputDurationMs`，也不发送接口未声明的 `duration`、`resolution` 或 `aspect_ratio`。采用本地保守上限：原视频 3–15 秒、20 MiB、宽高各 720–3840 像素、实际容器 MP4/MOV；图片每张 10 MiB，全部素材合计 40 MiB。上传时由 FFprobe 与文件头识别实际容器，旧素材缺少容器元数据时需重新导入。WebM、未知容器、过长原片或不符合尺寸的素材在报价前失败，不自动压缩、裁剪、放大或拆段。

直接使用 `generate` → `quote_create` → 价格确认 → `job_submit`，无需走先审图再生视频的 `reference_storyboard_quote`。如作品只使用素材的一部分，先渲染并导入该片段，再提交为原视频，不能把镜头的裁切时间误当成已发送给模型。生成完成后复核实际时长，在最新作品版本上替换指定镜头并保留独立配音、字幕和音乐，再本地导出。

跨镜头复用相同人物/产品/风格参考并审阅相邻镜头，可减少外观和风格漂移；模型本身不保证动作和切点无缝。内置及自有配置示例的费用上限均为占位，默认不启用 O3 付费执行；官方测试目录在平台仓库维护。目录和协议测试通过不等于真实生成质量验收。

接口依据：[fal O3 Pro 编辑文档](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit/api)。

## 声音流程

视频优先保留所选模型实际生成的原生声音，不默认额外生成配音。独立 TTS 用于后期修改、替换和明确要求的旁白，默认 `elevenlabs-voice`（ElevenLabs Eleven v3）；`tts.engine` 仅接受 `fal`，不再支持本地配音。

内置及自有示例新增 `elevenlabs-music-30s`（ElevenLabs Music，30 秒纯器乐）、`elevenlabs-sound-5s`（Sound Effects V2，5 秒）、`minimax-voice-clone`（10–60 秒参考音频）和 `minimax-cloned-speech`（兼容克隆音色复用）。新档案的费用均为占位，默认未确认费用，需核价后启用。音乐和音效通过现有 `generate` 报价和任务流程；克隆使用 `mode=voice_clone` 和 owned `voice` 音频参考，返回试听与 `provenance.voiceClone`。后续复用通过 `tts` 的 `voiceAssetId`、专属 `voice` ID 和匹配 `model` 验证，不能把 MiniMax 音色传给 Eleven v3。官方路径绑定原官方来源与音色素材 ID。详见[声音流程与调用](../speech.md)。

## 官方套餐

一行安装版会自动创建 `config/models.json`，内置本次发行的官方 API 与模板源；用户无需填写 URL。首次安装可绑定自己的官方用户 Key。安装版从本机 0600 的 `config/credentials.json` 读取当前模式所需凭据，再注入后端进程；自有供应商同样通过这两份 config 文件接入。详见 [安装说明](installation.md)。以下环境变量方式继续用于手动运行源码。

复制 `config/models.official.example.json` 为 `config/models.local.json`，将 `official.url` 改为实际网关 origin，通过 `RIKOKO_OFFICIAL_KEY` 环境变量注入官方用户 Key，设置 `RIKOKO_CONFIG_FILE=config/models.local.json` 启动工作台。

`official.url` 只接受 HTTPS origin，本机开发允许 loopback HTTP。`keyEnv` 是环境变量名，不是 Key 本身。工作空间登录 Key 保护本地项目；官方套餐 Key 仅由本地服务发送到官方网关，两者不能互换。

也可只用 `GENERATION_API_URL` / `GENERATION_API_KEY` 配置官方生成。显式 config 的 mode 和 official 优先。指定生成地址却未提供 Key 时，官方调用返回配置错误，不会回退到个人供应商。

## 模板更新独立配置

官方云服务限于模板分发和统一模型 API 收费。本地项目、剪辑、渲染和模板更新不消耗官方 API 额度。

- `TEMPLATE_API_URL` 只设置模板源，不启用官方生成，也不关闭自有模型。
- config 中可用 `templates: {"url": "https://templates.example.com"}` 覆盖模板地址，或 `templates: false` 关闭同步连接。示例地址需换成实际服务；不使用模板源时设为 false。
- 模板地址优先级为 config.templates → TEMPLATE_API_URL → 旧 CLOUD_API_URL → 官方生成地址；后者保留同域部署兼容性。
- 兼容旧的 `CLOUD_API_URL` / `CLOUD_API_KEY`。只有同时设置两者才隐式启用官方生成；仅设置 URL 时只连接模板源。`mode=custom` 优先保持自有生成，模板源不会触发套餐查询。
- 模板目录只在手动更新时请求，官方生成 Key 不发送到模板服务。原项目固定模板快照，云端更新不改写已有作品。

## 自有服务

2026-10-21 追加 FLUX 3 Max、MiniMax H3 Max、Seedance 2.5 US、Nano Banana 2.1、Krea 3，
共 12 个新档案，参见 [新一代模型目录](../integrations/latest-models.md)。其中 Seedance 2.5 与
Nano Banana 2.1 尚待确认 Token 计费硬上限，接口已适配但保持 `available=false`。

新增的 Kling 3.0 Pro、Wan 2.6、MiniMax Hailuo 2.3 与 FLUX.2 Pro 共 9 个档案，
参见 [扩展模型目录与费用依据](../integrations/expanded-models.md)。内置目录与自有服务示例均已包含；
已有显式配置需合并所需档案后重新加载。

复制 `config/models.custom.example.json` 为 `config/models.local.json`，按各连接的 `keyEnv` 注入凭证。模型 ID 在所有连接中必须唯一。

| adapter     | 凭证                | 当前支持范围                                                                 |
| ----------- | ------------------- | ---------------------------------------------------------------------------- |
| `fal`       | fal API Key         | 队列端点；图片、视频、音频，保留分析与翻译能力                               |
| `replicate` | Replicate API Token | 官方 owner/model prediction 端点；返回单个 URL 或 URL 数组的图片、视频、音频 |
| `fal-video` | fal API Key | `openrouter/router/video` + `google/gemini-3.8-flash`，参考视频分析，结构化 v2 报告 |
| `gemini` | Google Gemini API Key | 原生音视频参考分析；Files 上传与 Interactions 后台任务，输出结构化 v2 报告 |

通过 fal 使用某品牌模型，需要 fal Key，不能使用该品牌的原生 Key。Google 原生协议现支持参考视频分析；OpenAI、MiniMax、ElevenLabs 原生协议尚未各自实现；ComfyUI、Replicate 自定义版本/deployment 不在本次适配范围。新增供应商应实现 `MediaProvider`，不能只换 base URL 假定协议兼容。

默认自有服务示例统一使用 fal，包含 Seedance Mini、Nano Banana、MiniMax H3、ElevenLabs 配音、扩展模型目录和通过 fal 接入的独立 Gemini 3.8 Flash 视频分析档案。旧示例中 `priceVersion` 为占位版本、`hardBoundConfirmed=false` 的费用 **不是供应商价格或已确认上限**；核对账号权限、固定参数和最大费用后，填写实际费用上限及 `priceVersion`，再确认上限。扩展目录中的 9 个档案带有已核查公开价格的版本和上限。所有示例连接仍默认 `enabled=false`，需要显式启用。

- `parameters` 固定尺寸、时长、数量、音色等参数；客户端不能覆盖，不同规格创建不同模型 ID。
- `promptField` 默认 `prompt`，配音可设为 `text`。
- `name`、`description` 控制模型选择器中的名称与规格说明。
- `kind=image|video|audio` 决定预览；音频可额外设置 `category=speech|music|sound`。
- `generate` 支持文字生成及声明了 `generationInput` 的图生图、首帧、首尾帧、多参考与视频输入。参考素材使用当前账户的 `assetId`，服务端按角色映射和报价快照传给供应商；不能通过 `parameters` 注入 URL。参考 [参考图驱动生成](../tutorials/参考图驱动生成.md) 和 `config/models.reference.example.json`。分镜流程先审阅目标图，再报价生成视频；官方通道会先经鉴权上传真实素材字节，云端校验 SHA-256、长度和媒体类型，再将云端素材 ID 绑定到报价。分镜与审阅留在本地，提交前重新检查版本和已接受图片；云端按已确认输入执行。
- 密钥只读取服务端环境，不放进 config、浏览器或模型目录响应。
- 配置在重启时加载。项目不会自动读取 `.env`，需由启动器注入环境变量。

```sh
RIKOKO_CONFIG_FILE=config/models.local.json pnpm dev
```

自有服务不要求平台余额，也不预留或扣除官方额度。本地 Key 预算上限仍有效；未知实际费用保留在本地预算记录里，需按供应商账单核对。该记录不代表供应商余额。自有模式面向用户自己的可信运行环境，共享该工作空间的使用者会共用进程配置的供应商账户。

## 独立参考视频分析

`reference_analyze` 使用服务器配置的独立分析档案；默认示例通过 fal 调用 Gemini 3.8 Flash，使用与 fal 生成连接相同的 `MY_FAL_KEY`，无需 Google Key。宿主即使采用纯文本模型也能获取带源时间、镜头、事件和证据的结果。先返回缓存、已有任务或报价；只有报价获同意后通过 `job_submit` 才上传和分析。结果由 `reference_analysis_get` 分页读取，`reference_analysis_query` 支持局部证据检索和另行报价的定向复查，`reference_adapt` 将镜头结构映射为可编辑 composition。生成模型配置与此独立。

详见 [参考视频分析配置与调用](../tutorials/参考视频分析.md)。本版本支持自定义供应商模式；官方网关目前仅接受生成操作，未宣称官方分析已上线。

## 官方上游与销售价

云端可用 `CLOUD_PROVIDERS_FILE` 指向同结构的 `mode=custom` 上游配置。旧 `CLOUD_MODELS_FILE` / `CLOUD_FAL_KEY` 仍保留。云端仅接受 `generate` 操作和 image/video/audio 模型，本地 TTS、转录、分析及翻译不经过该网关。

新配置使用每个连接的 `enabled` 开关；`CLOUD_ENABLE_PAID_PROVIDERS` 只控制旧的单一 fal 配置。设置 `CLOUD_PROVIDERS_FILE` 后，旧模型文件和旧凭证不再参与模型路由。

`maxCostCents` 是核查过的供应商费用上限。官方售卖模型可另设 `creditPriceCents`，作为该固定规格成功生成一次消耗的官方 API 额度（美元分）。生成前预留，成功后按报价快照结算。`providerActualCostCents` 与 `providerCostStatus` 独立记录上游成本，未知时保持未知。自有模式忽略官方销售价，只使用供应商费用上限控制本地预算。

固定售价成功任务按 `chargedCents` 扣款；上游费用未知不阻塞用户结算。管理员随后可独立核对 `providerActualCostCents`，不会再次扣除用户余额。供应商超过已核查上限时记录 `providerCostOverrunCents`，不追加用户售价。

已接单但失败、取消或结果不明的任务暂保留预留，确认失败/取消后释放用户固定售价预留；实际发生的供应商成本由运营侧记录，不代表上游退款。未设销售价的旧档案仍按供应商费用上限预留和人工核对。提交超时不重买。连接、Key 或档案变化后，旧任务可能需恢复原配置才能查询，不会发往另一供应商。

内部 `providerMaxCostCents` 与用户报价分开。公开报价使用 `maxChargeCents`，用量接口返回最近 100 次调用的预留、扣款和状态，不返回供应商成本或用户提示词。旧 `maxCents`、`actualCostCents` 字段保留兼容，后者表示用户账面支出，不应解释成供应商实收。

## 套餐目录与支付边界

`CLOUD_PLANS_FILE` 配置云端套餐，通过公开 `GET /v1/plans` 发布。官方模式工作台读取它；`RIKOKO_PLANS_FILE` 可覆盖本地展示目录。`/plans` 展示套餐，登录工作空间后从网关读取余额；自有模式只标明费用来源，不把本地余额显示为官方余额。

`config/plans.example.json` 默认没有套餐。单个条目需包含：`id`、`name`、`description`、`priceMinor`（售价最小货币单位）、`currency`（USD/CNY）、`allowanceCents`（API 额度美元分）、`features`（字符串数组）、`purchaseUrl`（真实 HTTPS 购买链接）。不配置时显示“暂未开放购买”，不填充虚构价格。

**本次没有实现支付订单创建、支付回调、自动发放/续充、订阅周期或额度到期规则。**购买按钮跳转外部购买地址；平台仓库中的 `pnpm cloud:account` 可在运维侧创建账户和设置初始额度。发布销售前需提供真实套餐与支付渠道，接入验签、幂等发放和账户关联。展示套餐目录不代表支付已开通。

## 验证

`model-config`、`model-runtime`、`model-billing`、`service-info` 和 cloud 测试覆盖配置优先级、凭证隔离、路由绑定、错误不切换、两种计费、云端音频与销售价结算。`pnpm exec tsx scripts/verify-model-services.ts` 使用临时数据库、模拟供应商任务和本地合成素材，验证真实 API/浏览器的三类预览、套餐展示和移动端布局，不访问供应商或支付地址。

协议依据：[fal 队列](https://fal.ai/docs/documentation/model-apis/inference/queue)、[Replicate HTTP API](https://replicate.com/docs/reference/http/)、[Nano Banana 端点](https://fal.ai/models/fal-ai/nano-banana-2/api)、[ElevenLabs 配音端点](https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3/api)。文档核对不等于真实付费生成验收。

## 人脸检查与模型选择（2026-10-21）

`video_model_resolve` 接收宿主/用户对创作要求和实际视觉参考的 `present|absent|unknown` 判断，返回兼容候选及绑定素材 SHA-256 的 `videoPolicy`。所有参考视频生成必须携带完整判断；所有 Seedance 调用（包括纯文本）必须明确无人脸。涉及人脸或状态不明时，仅允许 MiniMax/Kling，并要求 `userChoice` 记录用户对具体模型的选择。确认沿用当前任务已明确的选择，不重复打断。检查不是自动人脸检测，宿主无法观察时必须报告 unknown；不可凭元数据或视频首帧判定全片无人脸。

人物标记不发送给上游；在准备、提交和 Worker 解析素材前校验。云准备保留判断和确认，上传后只映射资产 ID，哈希不变。修改模型或素材后重新准备。为保持既有纯文本 API 兼容，未携带 videoPolicy 的非 Seedance 纯文本调用仍可使用；宿主指南和工作台新流程均执行选择交互。

内置新增 `seedance-mini-text`、`seedance-mini-first-frame`、`seedance-mini-first-last`、`seedance-mini-references`，对应 fal 官方 Mini 文生视频、首尾帧和多参考接口。见 [文本接口](https://fal.ai/models/bytedance/seedance-2.0/mini/text-to-video/api)、[图像接口](https://fal.ai/models/bytedance/seedance-2.0/mini/image-to-video/api)、[参考接口](https://fal.ai/models/bytedance/seedance-2.0/mini/reference-to-video/api)。参数采用固定 5 秒 / 720p 起点，可选择 4–15 秒和 480p/720p。参考档案目前只支持图片和视频；保留本地 20 MiB 单文件、40 MiB 总量的保守限制，不宣称支持上游全部输入组合。视频最短边采用保守 640 像素限制。

新 Seedance 档案 `hardBoundConfirmed=false`，费用为待核价占位，默认不可付费调用；核对实际账号费用及权限后才能启用。`FAL_MODELS_FILE` 或自有配置替换内置目录，需要把对应档案加入实际配置。此代码变更不修改机器上的连接、密钥、余额或服务进程。
