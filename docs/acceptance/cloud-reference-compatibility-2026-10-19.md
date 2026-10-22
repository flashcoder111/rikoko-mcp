# 官方云端参考分析兼容修复（2026-10-19）

## 根因

Hermes 的汉堡复刻会话已导入产品图片、下载参考视频并保存四段 recreate 分析计划。四次 `reference_analyze` 在报价前返回 `REFERENCE_MODEL_POLICY`。

本地 Gemini 交接代码要求模型目录声明 `referenceUnderstanding.upstreamModel`；线上实际运行 0.1.19，没有该字段。线上模型档案确认仍使用 `google/gemini-3.8-flash`。因此本次是本地与云端发布不同步，并非用户输入错误或实际切换了分析模型。此前平台固定的 0.1.21 包也尚未包含这组交接改动；后续云端准备路由同样未上线。

## 修复与发布范围

- Gateway 在模型目录阶段识别缺失的 upstream 声明，返回明确的 `ANALYSIS_PROTOCOL_MISMATCH` 和恢复已保存计划的提示。实际非 Gemini 上游仍返回 `REFERENCE_MODEL_POLICY`。不删除 detail/focus，不改用宿主总结，不切换计费线路。
- 以固定的 0.1.21 运行时为基础，叠加 31 个相关共享源码文件，形成 0.1.22 包。同步分析声明、Gemini 交接、目标计划/生成准备及其依赖。原工作台前端构建保持 0.1.21；未将官网修改或打包后并行任务新增的宿主指南改动纳入发布。
- 平台依赖更新为 `file:vendor/rikoko-0.1.22.tgz`。云端接入已在工作区完成的准备路由、报价/任务绑定和执行前复核。
- 包 SHA-256：`edfb4d70c59efcf19e6564a26deddb2ac12a8775f1699f3742caf6cae83fe80a`。
- 最终镜像：`video-workbench-cloud:20261019-reference-contract-v2`。初次镜像遗漏发布后台静态文件，收尾时已补齐；最终主页、admin.js、style.css 的 HTTP 响应哈希与原部署一致。
- 切换前确认无活跃生成任务，保存数据库备份与旧 compose；只替换应用容器。数据库容器 ID 和启动时间未变。模型档案哈希未变，已有 67 个云端任务完整保留。未创建 Git 分支，未提交或推送。

## 验证证据

- 打包时源码快照：78 个文件、598 项测试通过，TypeScript 检查通过。
- 固定运行时包暂存目录：TypeScript 检查通过；分析/交接/准备/附件相关 81 项测试通过，制作约束另 16 项通过。暂存包不含源码发布脚本，补充测试辅助脚本后复验；源码导出测试在这组包内检查中明确跳过，已由前述源码全量测试覆盖。
- 平台：45 项原有云端测试通过；新增真实 FalVideoProvider → 认证模型目录 → 已安装 Gateway 的契约测试通过。测试使用显式模拟模型凭据，不调用供应商。修正了旧分析测试未配置 Gemini 的替身、O3 测试未经过准备步骤及示例引用语法。
- 平台 TypeScript、安装包校验和差异空白检查通过。
- 容器内校验：0.1.22、Gemini upstream 声明、`rikoko-cloud-preparation-v1`、`rikoko-remake-handoff-v1` 及云端应用加载成功。
- 真实 MCP capabilities 返回分析模型可用、正确 upstream，且 `generationPreparation.cloudSupported=true`。
- 用 Hermes 已安装配置启动真实 stdio 连接，复用原计划的四个 exact input，全部获得 `quote_required` 和有效 quote；保留 `detail=recreate`、focus、language、原片段 ID。四段 `maxCents=0`、`billingSource=testing`。
- 没有调用 `job_submit`，没有执行 Gemini 推理或视频生成。报价成功只证明阻塞解除，不表示分析质量或复刻成片已验收。

本地详细证据：`.data/cloud-compat-20261019/`，包括源码覆盖清单、固定包测试、四段恢复报价和部署脚本。线上回退点保存在 `/opt/video-workbench-cloud/releases/20261019-reference-contract-v1/backup/`；最终镜像的备份和验收位于对应 `v2` 目录。回退原 0.1.19 会重新出现本地新合同不兼容，只有出现生产回归时才使用。

## 恢复创作

Hermes 可刷新 capabilities，读取已保存计划并沿原官方连接继续。报价有有效期，过期后对相同输入重新报价；模型调用仍遵循宿主的报价与用户授权流程。本次没有向 Hermes 会话发送消息或代替创作 Agent 提交任务。
