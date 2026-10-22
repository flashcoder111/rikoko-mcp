# P0-1：画面证据与审核合同 v2

日期：2026-10-18。状态：本地第一批改动；整体 P0-1 仍待真实宿主与语义验收。沿用已有 `main`，保留其他工作区改动，未提交、推送、部署、重启服务或安装到宿主，未调用付费分析/生成。

## 本批改动

- `media_review` 的四个检查项支持 `pass / fail / unknown / not_applicable`；除 pass 外要求逐项原因。看不到画面的宿主可保存 `unreviewed` 和 unknown，不必伪造证据或布尔通过值。
- 保留布尔输入的解析兼容，保存时规范化为 v2；兼容输入仍需通过同样的证据检查。所有项都不适用、缺失证据或必需项未知都不能接受。
- 视频动作通过需要声明 `actionRanges`，每个区间至少三个不同的请求采样时刻，并覆盖起始、过程和结束，最大请求采样间隔为 250 ms。该值是初版检查策略，不是模型规格，也不保证动作语义正确；快动作仍需宿主请求更密集证据。
- `media_inspect` 新增有序、去重的 `timesMs`，与均匀采样 `count` 二选一；单次最多 12 帧，支持多次检查合并证据。原生 MCP 图片/网格路径保留。
- 返回 `requestedTimeMs`、采样方式和最大间隔，明确 `sourceTimeMs` 是兼容别名，不是已验证的解码帧时间；未采样的区间仍未观察。
- 可审核某个素材区间，但局部接受不能代替整段接受；局部新发现的缺陷或不确定性会使之前的整段/对应成片接受失效。成片 revision 审核必须覆盖其完整渲染产物。
- 历史 v1 accepted 记录继续保留，正式交付需要 v2 复查；不重新生成素材。素材哈希、渲染版本和同一毫秒内的审核顺序均有检查/排序依据。
- `capabilities.visualReview` 返回合同版本、采样策略和能力边界；不宣称当前宿主已具备或已验证视觉能力。仓库的视觉审核指南已同步更新，已安装副本未改动。

## 验证

先添加失败回归再实现，复现了未知状态无法保存、旧三帧审核直接通过、局部新缺陷未撤销成片通过、24 fps 末帧取整误拒绝、单一瞬间被当作动作过程等问题。

- `pnpm typecheck`：通过。
- `pnpm build`：通过。Vite 提示两款 Noto 字体 URL 在运行时解析；本批未改字体或发布配置。
- 六个定向测试文件：**53 项通过**，包含本批新增的 19 项审核合同测试和 2 项指定时刻采样测试。
- 两个修改的核心文件定向覆盖率：语句 **91.58%**、分支 **85.60%**、函数 **98%**、行 **93.10%**。这是这两个文件的覆盖率，不是全仓覆盖率。
- 修改的 TypeScript 文件 Prettier 与相对本批开始快照的差异空白检查通过。
- 最终代码全量测试 `pnpm test`：**72 个测试文件、501 项测试全部通过**，耗时 121.54 秒。

定向命令：`pnpm exec vitest run tests/production-review.test.ts tests/production-tools.test.ts tests/storyboard-generation.test.ts tests/production-upgrade.test.ts tests/delivery.test.ts tests/conversation-delivery.test.ts --coverage --coverage.include=packages/core/src/production-review.ts --coverage.include=packages/core/src/media-inspection.ts`。本地覆盖率输出保存于 `/tmp/rikoko-review-p0-coverage`，测试素材只用于工程验证。

## 验收边界

| 方案标准 | 本批状态 |
| --- | --- |
| A01 原生画面证据 | FFmpeg 真实测试视频、图片数据及 MCP 内存传输集成已覆盖；Codex/Claude/Hermes 实际安装版本到模型的接图路径未在本批验证 |
| A02 关键动作与真实判断 | 请求时刻覆盖、密度、不确定性和单瞬间反例已有工程回归；尚未用真实宿主证明能识别中间错误动作 |
| A03 证据/状态约束 | 错素材、旧哈希、缺证据、未知、不适用原因、局部范围及历史记录复查均有回归 |
| P0-2 目标到生成请求 | 本批未实施服务端 preparedRequest 记录、计划依赖和最终 Provider 请求绑定 |
| P0-3 跨入口正式交付 | 本批完善已有质量计算及 `purpose=final` 的审核依据；所有导出/下载入口统一用途与重验仍属后续工作 |

合同测试使用明确标注的合成记录；媒体集成测试使用本地生成的 FFmpeg 图样。两者均不证明真实广告生成质量、动作自然程度或模板通过率提升。服务端校验的是声明、记录和请求采样覆盖，实际视觉判断继续由宿主 Agent 或用户完成。

下一批按方案推进 P0-2：把目标计划、模板版本、参数和参考映射保存成完整生成准备记录，确保预览、已有报价、提交及 worker 使用同一请求。
