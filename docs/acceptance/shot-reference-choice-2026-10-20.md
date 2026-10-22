# 每镜参考选择与阶段首帧检查

日期：2026-10-20。根据用户认可的汉堡阶段首帧版及质量波动排查，完成本地流程修改。未部署、提交或新增媒体生成。

## 行为

每个媒体镜头可保存 `referenceChoice={strategy,reason}`，理由最多 240 字符：

| 选择 | 使用条件 | 是否强制生图 |
|---|---|---|
| `motion_reference` | 动作或镜头迁移是重点，传入实际动作视频 | 否 |
| `stage_first_frame` | 需要固定工序起点、数量、位置 | 否，优先复用合适图片或实际上一镜末帧 |
| `direct` | 当前外观参考或文字足够，无动作视频或首帧绑定 | 否 |

`production_plan_validate.referenceChecks`、`production_shot_prompts.referenceCheck`、`generation_prepare.referenceCheck` 将选择暴露给宿主。新计划的指南要求逐镜记录；旧计划保留兼容，缺少选择时返回 `choose_before_generation`，不会自动补选或生成图片。该兼容路径也意味着服务不会硬性拒绝所有未填写选择的计划。

已记录选择时，本地和云客户端的 video preparation 核对模式及有效参考角色，不匹配返回 `SHOT_REFERENCE_CHOICE_MISMATCH`。图片阶段不要求首帧已经存在，允许先制作所需图片。已有模型兼容性、计划绑定、素材哈希和来源校验继续适用。

选用 `stage_first_frame` 时，通过同一次 `media_inspect` 和 `media_review` 记录：

- `stage`：工序阶段。
- `count`：关键物体数量。
- `arrangement`：位置和相互关系。
- `support`：承托与后续动作空间。

每项使用状态和最多 240 字符的简短理由。stage、arrangement 必须通过；count、support 可说明不适用。未知或失败不能接受为正确起始图。检查绑定图片哈希及当前 project/scope/shot；通用产品图检查不能替代它。有效记录复用，后续未知或拒绝撤销旧通过状态。没有新增付费视觉模型调用、最终视频审查或自动重生成。

参考选择、检查项和检查理由均留在宿主流程记录，不进入 `productionShotDirection` 或 provider prompt。原编译器及生成提示词组织方式保持不变。

## 验证

- `pnpm build`：通过，包含指南校验、TypeScript 检查和两个前端构建。构建有两个字体路径在运行时解析的提示，未阻断构建。
- 14 个相关测试文件、122 项测试通过。覆盖新选择、旧计划兼容、无生图路径、模式不匹配、精确首帧检查、未知检查、复用、后续撤销、云同步前拦截、提示词不膨胀，以及现有准备、连续性、工序和直接交付流程。
- 修改的 TypeScript 文件 Prettier 检查通过；`git diff --check` 通过。
- 新增测试使用合成证据并禁止生成网络调用；这些结果证明流程约束，不代表新增视频质量实测。
- 更新指南 manifest：`b6e5228316147b5f696c19f769c5fb66e532fa3de94621e70cb8ad0237c7a5ab`。

测试命令：

```sh
pnpm exec vitest run tests/shot-reference-choice.test.ts tests/critical-image-review.test.ts tests/concise-direction.test.ts tests/director-guidance.test.ts tests/director-workflow.test.ts tests/generation-preparation.test.ts tests/cloud-preparation.test.ts tests/source-video-delivery.test.ts tests/production-continuity.test.ts tests/production-process.test.ts tests/production-enforcement.test.ts tests/direct-delivery.test.ts tests/mcp-only-guidance.test.ts tests/host-guides.test.ts
```

## 文件及发布边界

核心新逻辑在 `packages/core/src/shot-reference-choice.ts`；接入计划 schema、MCP 返回、准备校验、图片检查、图片 review 和云客户端。指南更新位于 video-direction、visual-review 与 MCP 顶层指令。

工作区已有大量其他未发布改动，本次保留。部署时需同时包含本地/云端 schema 与校验，并更新指南包及 manifest，旧会话需要刷新工具 schema。当前运行中的 0.1.27 未因本次修改自动更新。没有创建 Git 分支。
