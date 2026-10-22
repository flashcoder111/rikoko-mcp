# UGC 与口播广告导演库首版

2026-10-19。状态：本地源码实现完成；未提交、未部署、未同步宿主安装；没有调用真实图片/视频模型。沿用当前分支并保留原有改动。

## 设计与范围

参考 hypit `0d36de9a9d17562fca0e478969b80eb1c16a7693` 的 Format / Craft / Prompt Kit / Recipe / Source / Run 职责划分，使用原创 rikoko 提示词与实现。未复制第三方媒体或把其 Seedance/GPT Image 使用经验当作 MiniMax 验证。

- 两类整片指南：UGC 产品广告、可见人物口播广告。
- 四个版本化镜头模板，九组配方：人物首帧两组、UGC 演示两组、口播三组、产品 B-roll 两组。
- `director_catalog` 返回用途、固定措辞、配方、参考要求、验收点及局限；全部标记为 candidate，尚无随库发布的真实生成样本。
- `shots[].promptKits.image/video` 分别绑定图片、视频模板；`generation_prompt_preview` 接受 `directorKit`。保存计划、`production_shot_prompts`、`generation_prepare` 使用同一选择，准备记录冻结完整提示词与版本。
- `talking-head-v1` 保存当前镜头的明确台词；准备阶段要求有效 `generate_audio=true`。该条件只拦截明确未启用原生音频的请求，不证明模型会正确念词、保持声音或实现口型同步。
- `director_case_record` 从已有完成/失败任务及可选的真实素材审核记录中保存不可变案例，绑定完整输入指纹、模型配置、素材哈希、提示词、参数、费用与结果。重复完全相同输入复用案例；跨账户、其他任务素材、错误字节审核、成片审核冒充源片审核均拒绝。
- 案例通过 `records_list/record_get(type=director-case)` 读取。没有自动晋级、自动生成实验或模型权重训练；按唯一任务 ID 统计尝试，保留失败与未审核结果。
- 新指南通过 Skill 入口与 `rikoko_guide` 发现，随已有打包流程分发。旧计划不选择模板时继续原编译行为。

## 已完成验证

1. `pnpm exec vitest run tests/director-kits.test.ts tests/director-workflow.test.ts tests/generation-preparation.test.ts tests/production-tools.test.ts tests/production-upgrade.test.ts tests/remake-handoff.test.ts tests/production-enforcement.test.ts tests/production-process.test.ts`：当次 8 文件 / 117 测试通过。
2. 随后新增证据反例与目录能力检查，运行 `tests/director-kits.test.ts tests/director-workflow.test.ts tests/host-guides.test.ts`：3 文件 / 20 测试通过。包含内存 MCP 端到端调用、准备绑定、无外部模型调用、账户隔离、错误归因拦截、负面案例、Skill 可读性与 npm 打包内容检查。与上一项存在重复测试，不相加计算总数。
3. 新模块 `director-kits.ts` / `director-cases.ts` 定向覆盖率：语句 98.18%，分支 93.33%，函数 90%，行 98.03%。覆盖率只表示程序分支，不表示创意成功率。
4. `pnpm typecheck`、`git diff --check` 通过。Skill 官方校验器在临时 uv/PyYAML 环境执行通过，未修改项目 Python 依赖。

## 后续实测如何积累资产

先选择一个有明确事实和参考素材的 UGC 广告，以及一个台词明确的口播广告。每轮只验证具体假设，例如产品持握是否稳定、单步动作是否停止、台词/口型是否正确。先使用已有素材与候选模板；真实生成前明确实际可用模型、输入、调用次数和预算，不把本次实现视为长期实验授权。

固定模型、画幅、输入关系和台词长度等条件，尽量只改一个因素；记录原始结果、可用区间、重试、失败类型、成本及端到端耗时。一次通过保留为单次样本，多次代表性结果经人工审阅后才能记录适用范围。修改固定措辞时创建新模板修订，保留旧版本和历史失败证据。

汉堡旧任务没有使用这些新模板，不能补贴新版本标签并计算为它们的成功样本；可保留为设计研究。截取或变速后的片段需要独立的源文件与时间范围证据，不能把原始整段视频算作通过。

## 尚未验证

真实 UGC/口播输出质量、MiniMax 实际可用的原生语音接口及同步效果、跨项目稳定性、模板效果对照实验、线上部署和宿主刷新均未在本次执行。云端和宿主运行时均须支持新 schema 才能使用；旧端拒绝时应升级，不能删除模板字段绕过。
