# fal 视频分析接入验收 · 2026-10-14

## 实现结果

新增 `fal-video` 适配器，通过 fal 的 `openrouter/router/video` 固定选择 `google/gemini-3.8-flash`。自定义配置示例已改为该路线，可复用现有 `MY_FAL_KEY`；不需要 Google 或 OpenRouter Key。分析服务独立于宿主对话模型，MiniMax 视频生成默认选择不变。

本地视频按 fal 官方上传协议进入 CDN，再提交分析队列。已接入报价、源文件限制、任务检查点、重启恢复、取消、结构化结果校验和逐镜头改编。仅保存允许的 Token 用量字段与原始 `cost`，费用单位未经核实，不自动转换或结算。原生 Google 适配器保持兼容，不进行跨供应商自动重试。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| RED | 新适配器缺失导致测试导入失败；提交 `65a6447` |
| GREEN | 6 个相关套件共 60 项测试通过；提交 `a3c7a45` |
| `pnpm test:coverage` | 35 个测试文件、227 项测试全部通过 |
| 覆盖率 | 语句 88.28%、分支 81.35%、函数 87.77%、行 89.35% |
| `pnpm typecheck` | 通过 |
| `pnpm build` | TypeScript、Studio 和 MCP card 构建通过 |
| 示例配置解析 | 通过；缺少凭据及费用确认时保持禁用 |
| `git diff --check` | 通过 |

集成测试使用模拟供应商响应，验证报价 → 上传 → 提交队列 → 新 Worker 恢复 → 分析报告 → 分镜改编。断言只提交一次分析任务、使用指定 fal 路由和模型、用量保留、费用待对账，没有调用 Google 原生接口。既有真实 FFmpeg 媒体测试也在全量回归中通过；这些检查不能证明真实供应商可用性或模型准确率。

## 接口与安全审查

- fal 没有公开该接口的 FPS、API 裁剪或 JSON Schema 请求参数。报告如实保存未知 FPS、供应商控制采样和提示词区间；实际上传范围记录完整源片。
- JSON Schema 通过提示词提供，并由本地严格校验输出；不把提示词约束冒充供应商原生结构化输出保证。
- 上传 URL 限定为 fal 媒体 HTTPS 域名，拒绝重定向。签名 PUT 不携带 fal Key，签名上传地址不进入任务记录。
- 上传请求设置 24 小时对象生命周期；CDN 地址仍可被持有链接者访问，不承诺已经删除或私有鉴权。
- 上传前限制整个文件的字节数和时长；示例为 60 秒、80 MiB，输出最多 8192 tokens。限制与模型配置绑定，调用方不能覆盖。
- 提交结果不明时进入核对状态，不自动再次购买；已知请求使用原票据恢复。

## 当前未验证项

没有发起真实 fal 计费请求。当前任务环境未注入 `FAL_KEY` 或 `MY_FAL_KEY`，也未发现默认本地模型配置；这不代表用户在其他位置没有凭据。已请求用户提供现有配置路径或变量名，不要求粘贴 Key。

示例 `maxCostCents=100` 仍为占位值，`enabled=false`、`hardBoundConfirmed=false`。账号模型权限、有效费用上界与真实样片效果需实际确认。没有配置生产凭据、修改 rikoko-platform、启用官方套餐分析、推送或部署。沿用现有 main 分支，保留用户原有模板和素材库等改动。

## 来源与使用说明

- [fal 视频接口与模型参数](https://fal.ai/models/openrouter/router/video/api)
- [fal 官方上传实现](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/storage.ts)
- [fal 文件存储](https://fal.ai/docs/documentation/model-apis/fal-cdn)
- [本地配置与完整调用流程](../tutorials/参考视频分析.md)
