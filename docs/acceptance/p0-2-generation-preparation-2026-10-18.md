# P0-2：本地生成准备记录与请求绑定

后续状态：云端合同和正式制作范围已在同日后续批次补齐，见 [后续验收记录](p0-2-cloud-scope-2026-10-18.md)。下文保留首次本地批次的历史边界，不代表当前云端能力。

日期：2026-10-18。状态：本地实现与验证；P0-2 整体尚未验收。继续由宿主 Agent 决定目标、参考职责和修复动作。本批沿用 `main`，保留工作区原有修改，未创建分支、提交、推送、部署、重启服务或更新宿主安装，未调用付费生成。

## 本批实现

- `generation_prepare` 保存 `generation-preparation` 记录，返回 `preparedRequestId`、请求哈希和包含该 ID 的完整逻辑 operation。保存精确提示词、原模板文本、模板/编译器版本、手写覆盖原因、参考资产哈希与元数据、存储位置摘要、模型配置/连接摘要和预期输出规格。准备只写本地记录，不上传、报价、预留费用或生成。
- `generation_prompt_preview` / `production_shot_prompts` 返回规范化 `direction` 和不可直接提交的草稿标记。准备时检查提示词模式、角色及顺序；手写或改写提示词必须有 `promptOverride.reason`，原因不能解除结构约束。引用支持 `usage=analysis_only`，不会进入 Provider 输入。
- 可用 `plan={planId,expectedVersion,shotId}` 绑定已保存目标计划。计划版本、动作、起止状态、参考职责和目标尺寸必须匹配；视频生成继承计划镜头的时长下限，客户端不能用更小的下限弱化它。计划修改后需要重新准备。本批不重写目标计划结构，阶段化动作、正式制作范围等完整扩展仍在方案待办中。
- `providerRequest` 展示真实 prompt 字段、参考字段/数组下标、引用编号和公开输出参数；编号与 Provider 分组顺序不一致时拒绝。它不是含凭据的原始 HTTP 报文：非公开配置仅保存摘要，短期签名链接和 data URI 在执行时解析，不进入准备记录。仓库内 MiniMax H3 档案的完整模拟请求捕获已有回归。
- `quote_create`、`job_submit` 的公共 Service 路径绑定准备 ID、请求哈希及模板版本，并核对计划、素材和模型依赖。worker 在解析素材前及实际发送前再次检查；不会重新编译已保存提示词。已存在作业的同一幂等键仍返回原作业，不因后来计划变更重复购买。
- `reference_storyboard_quote` 可接收准备 ID，并沿用被冻结的 operation，不重新拼接文字；仍执行分镜版本、已审核图片、模式和时长检查。`record_get` / `records_list` 可读取准备记录，便于宿主重连后恢复。
- 在发送前确认失败的请求会失败并释放预留额度；不会仅因 worker 已进入 submitting 阶段就误报未知支出。已实际发送或结果不明的请求继续保留既有对账边界。
- `capabilities.generationPreparation` 公布协议和支持边界。旧的未准备请求保留兼容，但不视为已绑定目标制作计划；全入口正式制作约束仍属 P0-3。

## 云端兼容边界

本仓库的 gateway 尚无远端 prepared-request 合同。云端 `generation_prepare` 的旧目录预检返回 `preflightOnly=true`、`readyForSubmission=false` 和 `PREPARATION_PROTOCOL_UNSUPPORTED`；结构化计划准备及已绑定记录的云端报价/提交会在上传、远端报价或生成前拒绝。不会删除准备 ID、退化成普通提交或切换供应商。

rikoko-platform 仍需同步准备记录协议、远端参数/参考映射和执行前重验，之后才能宣称云端链路通过 A07。本批没有修改该仓库，也没有验证线上模型配置或宿主当前安装版本。

## 工具使用顺序

1. 宿主保存目标计划，调用 `production_shot_prompts`，或用 `generation_prompt_preview` 生成草稿。
2. `generation_prepare` 接收 `input`、草稿的 `direction`、可选计划引用，以及必要的 `promptOverride.reason`。输出包括完整的规范化 `input` 和记录 ID。
3. 对 `readyForSubmission=true` 的本地结果，原样传递 `input` 给 `quote_create`，取得已有规则要求的费用同意后再 `job_submit`。分镜路径可使用 `reference_storyboard_quote(preparedRequestId=...)`。
4. worker 对依赖再次检查。准备过期于依赖变更时，宿主修正计划或输入并重新预览、准备和报价；已经提交的作业继续查询原 ID。
5. 生成后的画面审核继续使用 P0-1 工具；本批不自动评价创作质量。

仓库 `skills/rikoko/references/video-direction.md` 已同步合同说明。已安装到各宿主的副本未更新。

## 验证

- 先写失败回归，再接入实现；初始 7 项测试失败于旧工具不接受方向/计划字段。最后复查新增两项反例，确认计划镜头时长未继承、仅分析参考误选图片编辑两个问题后修复。
- 五个定向测试文件 **61 项通过**，其中新增 `generation-preparation.test.ts` **23 项**。覆盖持久化和重新读取、请求篡改、跨账号和只读权限、计划版本/状态/尺寸/时长冲突、模板升级不重编译、实际参数与引用绑定、analysis-only 排除、素材变动、排队及发送前重验、幂等恢复、分镜转接和云端拒绝。
- `pnpm typecheck`、`pnpm build` 通过。构建仍提示既有两款 Noto 字体 URL 运行时解析，本批未修改字体配置。
- 修改文件 Prettier 检查和相对批次开始快照的差异空白检查通过；operation JSON Schema 只增加准备 ID 字段。
- 新增 `generation-preparation.ts` 定向覆盖率：语句 **94.39%**、分支 **92%**、函数 **94.44%**、行 **94.17%**。这是该模块的覆盖率，不是全仓覆盖率。报告目录为 `/tmp/rikoko-p0-2-final-coverage`。
- 最终代码全量测试 `pnpm test`：**73 个测试文件、524 项全部通过**，耗时 127.16 秒。

测试仅使用本地数据库、合成媒体合同记录和模拟 Provider 网络响应。MiniMax H3 测试使用仓库内档案并捕获实际适配器请求，不是实付上游调用，不能证明生成质量、在线规格或真实宿主接图能力。

## 对方案验收标准的覆盖

| 标准 | 本批结论 |
| --- | --- |
| A04 目标计划 | 复用已有目标状态并绑定版本；多阶段动作、制作范围等完整结构仍待扩展 |
| A05 模式与参考 | 本地模式/职责/编号/Provider 字段对应和 analysis-only 排除已有回归；多 Provider 真实生成仍未验证 |
| A06 参数与输出 | MiniMax H3 档案的模拟适配器请求、动态参数及现有比例预检通过；真实生成及产物实测仍待授权后的样例 |
| A07 请求一致性 | 本地准备→报价→提交→worker 及分镜引用有回归；云端依赖明确阻断，未宣称全链路完成 |
| A11 跨入口约束 | 通用 Service 对携带准备 ID 的请求重验；旧无 ID 请求与正式项目范围的统一约束留给 P0-3 |

后续先补齐 P0-2 的正式目标计划范围和云端合同，再推进 P0-3 的剪辑锚点与正式交付检查。该记录只描述本批工作，不覆盖工作区其他未提交改动。
