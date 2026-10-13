# 官方综合 API 套餐与 config 自有接入

工作台提供两种运行方式。官方套餐由网关鉴权、预留和结算额度；自有服务由用户在 config 中声明连接和模型，直接使用自己的供应商账户。不提供“我的模型服务”交互设置页，也不自动在两种付费来源之间切换。

## 官方套餐

一行安装版会自动创建 `config/models.json`，内置本次发行的官方 API 与模板源；用户无需填写 URL。首次安装可绑定自己的官方用户 Key。安装版从本机 0600 的 `config/credentials.json` 读取当前模式所需凭据，再注入后端进程；自有供应商同样通过这两份 config 文件接入。详见 [安装说明](installation.md)。以下环境变量方式继续用于手动运行源码。

复制 `config/models.official.example.json` 为 `config/models.local.json`，将 `official.url` 改为实际网关 origin，通过 `HYPIT_OFFICIAL_KEY` 环境变量注入官方用户 Key，设置 `HYPIT_CONFIG_FILE=config/models.local.json` 启动工作台。

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

复制 `config/models.custom.example.json` 为 `config/models.local.json`，按各连接的 `keyEnv` 注入凭证。模型 ID 在所有连接中必须唯一。

| adapter     | 凭证                | 当前支持范围                                                                 |
| ----------- | ------------------- | ---------------------------------------------------------------------------- |
| `fal`       | fal API Key         | 队列端点；图片、视频、音频，保留分析与翻译能力                               |
| `replicate` | Replicate API Token | 官方 owner/model prediction 端点；返回单个 URL 或 URL 数组的图片、视频、音频 |

通过 fal 使用某品牌模型，需要 fal Key，不能使用该品牌的原生 Key。Google、OpenAI、MiniMax、ElevenLabs 原生协议尚未各自实现；ComfyUI、Replicate 自定义版本/deployment 不在本次适配范围。新增供应商应实现 `MediaProvider`，不能只换 base URL 假定协议兼容。

示例包含 Nano Banana、MiniMax H3、ElevenLabs 配音和 FLUX 档案。示例的 `maxCostCents=100` **只是占位值，不是供应商价格或已确认上限**。示例连接默认 `enabled=false`，模型 `hardBoundConfirmed=false`。核对账号权限、固定参数和最大费用后，填写实际费用上限及 `priceVersion`，再显式开启这两个字段。

- `parameters` 固定尺寸、时长、数量、音色等参数；客户端不能覆盖，不同规格创建不同模型 ID。
- `promptField` 默认 `prompt`，配音可设为 `text`。
- `name`、`description` 控制模型选择器中的名称与规格说明。
- `kind=image|video|audio` 决定预览；音频可额外设置 `category=speech|music|sound`。
- 当前生成入口是文字生成；参考图、首尾帧和视频编辑输入仍需相应操作契约和素材授权路径。
- 密钥只读取服务端环境，不放进 config、浏览器或模型目录响应。
- 配置在重启时加载。项目不会自动读取 `.env`，需由启动器注入环境变量。

```sh
HYPIT_CONFIG_FILE=config/models.local.json pnpm dev
```

自有服务不要求平台余额，也不预留或扣除官方额度。本地 Key 预算上限仍有效；未知实际费用保留在本地预算记录里，需按供应商账单核对。该记录不代表供应商余额。自有模式面向用户自己的可信运行环境，共享该工作空间的使用者会共用进程配置的供应商账户。

## 官方上游与销售价

云端可用 `CLOUD_PROVIDERS_FILE` 指向同结构的 `mode=custom` 上游配置。旧 `CLOUD_MODELS_FILE` / `CLOUD_FAL_KEY` 仍保留。云端仅接受 `generate` 操作和 image/video/audio 模型，本地 TTS、转录、分析及翻译不经过该网关。

新配置使用每个连接的 `enabled` 开关；`CLOUD_ENABLE_PAID_PROVIDERS` 只控制旧的单一 fal 配置。设置 `CLOUD_PROVIDERS_FILE` 后，旧模型文件和旧凭证不再参与模型路由。

`maxCostCents` 是核查过的供应商费用上限。官方售卖模型可另设 `creditPriceCents`，作为该固定规格成功生成一次消耗的官方 API 额度（美元分）。生成前预留，成功后按报价快照结算。`providerActualCostCents` 与 `providerCostStatus` 独立记录上游成本，未知时保持未知。自有模式忽略官方销售价，只使用供应商费用上限控制本地预算。

固定售价成功任务按 `chargedCents` 扣款；上游费用未知不阻塞用户结算。管理员随后可独立核对 `providerActualCostCents`，不会再次扣除用户余额。供应商超过已核查上限时记录 `providerCostOverrunCents`，不追加用户售价。

已接单但失败、取消或结果不明的任务暂保留预留，确认失败/取消后释放用户固定售价预留；实际发生的供应商成本由运营侧记录，不代表上游退款。未设销售价的旧档案仍按供应商费用上限预留和人工核对。提交超时不重买。连接、Key 或档案变化后，旧任务可能需恢复原配置才能查询，不会发往另一供应商。

内部 `providerMaxCostCents` 与用户报价分开。公开报价使用 `maxChargeCents`，用量接口返回最近 100 次调用的预留、扣款和状态，不返回供应商成本或用户提示词。旧 `maxCents`、`actualCostCents` 字段保留兼容，后者表示用户账面支出，不应解释成供应商实收。

## 套餐目录与支付边界

`CLOUD_PLANS_FILE` 配置云端套餐，通过公开 `GET /v1/plans` 发布。官方模式工作台读取它；`HYPIT_PLANS_FILE` 可覆盖本地展示目录。`/plans` 展示套餐，登录工作空间后从网关读取余额；自有模式只标明费用来源，不把本地余额显示为官方余额。

`config/plans.example.json` 默认没有套餐。单个条目需包含：`id`、`name`、`description`、`priceMinor`（售价最小货币单位）、`currency`（USD/CNY）、`allowanceCents`（API 额度美元分）、`features`（字符串数组）、`purchaseUrl`（真实 HTTPS 购买链接）。不配置时显示“暂未开放购买”，不填充虚构价格。

**本次没有实现支付订单创建、支付回调、自动发放/续充、订阅周期或额度到期规则。**购买按钮跳转外部购买地址；平台仓库中的 `pnpm cloud:account` 可在运维侧创建账户和设置初始额度。发布销售前需提供真实套餐与支付渠道，接入验签、幂等发放和账户关联。展示套餐目录不代表支付已开通。

## 验证

`model-config`、`model-runtime`、`model-billing`、`service-info` 和 cloud 测试覆盖配置优先级、凭证隔离、路由绑定、错误不切换、两种计费、云端音频与销售价结算。`pnpm exec tsx scripts/verify-model-services.ts` 使用临时数据库、模拟供应商任务和本地合成素材，验证真实 API/浏览器的三类预览、套餐展示和移动端布局，不访问供应商或支付地址。

协议依据：[fal 队列](https://fal.ai/docs/documentation/model-apis/inference/queue)、[Replicate HTTP API](https://replicate.com/docs/reference/http/)、[Nano Banana 端点](https://fal.ai/models/fal-ai/nano-banana-2/api)、[ElevenLabs 配音端点](https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3/api)。文档核对不等于真实付费生成验收。
