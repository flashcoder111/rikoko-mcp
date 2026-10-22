# rikoko：取消独立 Skill，统一 MCP 导演指南的改造方案

日期：2026-10-19（Asia/Shanghai）。状态：本地实现与自动化验收已完成，尚未提交、发布或迁移已安装宿主。以下保留实施前方案；实际覆盖范围及限制见 [验收记录](../acceptance/mcp-director-guides-2026-10-19.md)。

## 1. 目标与本次范围

用户只需连接 rikoko MCP，即可由原宿主 Agent 完成需求理解、视频分析、创意设计、生成、编辑和交付。rikoko 不再分发需要宿主单独安装/同步的 Skill。

保留导演方法、案例、模型提示词模板及现有生产合同。导演指南由执行任务的后端运行时提供，经同一个 `rikoko_guide` 工具按需读取。宿主负责创意和决策，内核负责状态、执行与确定性校验。

本轮包含：指南迁移、统一读取路径、指令去重、阶段提示、安装迁移、版本诊断、打包和回归验证。

本轮不包含：新增内部自主导演 Agent、大规模合并工具、整体重写 core/MCP 包、改变计费授权和交付政策、删除历史项目、自动生成或付费质量试验。官网和官方计费入口仍归 rikoko-platform；其运行时升级是独立发布步骤。

## 2. 当前实现与必须解决的问题

- `packages/mcp/src/guides.ts` 在 MCP 注册层直接读取本地 `skills/rikoko/SKILL.md` 和 references，返回 Markdown 与 SHA-256；已经有可复用入口，但不是后端统一读取。
- `packages/mcp/src/stdio.ts` 将业务调用交给 `HostConnection`，指南却由桥接器本地处理。桥接器、后端、宿主 Skill 可处于三个版本。
- `scripts/clients.ts` 的 install 会安装 Skill；sync-skill 是独立命令；doctor 已能读指南，但需增强必需能力和兼容性诊断。
- `package.json`、`public-release.json`、`scripts/pack-runtime.mjs`、`scripts/export-public.ts` 和相关测试依赖 Skill 文件路径。
- `index.ts`、多个 instructions 模块、工具描述和 Skill 重复描述流程。当前版本的 production_shot_prompts 已区分 hostInstructions，应该继续沿用。
- 本机副本存在实际内容差异：Codex 副本仍包含旧报价确认流程，Hermes 副本有本地新增制作经验。不能以一个 managed 注释判断整个目录可删除。

## 3. 职责与决策边界

| 内容 | 宿主 Agent | MCP / 共享内核 |
| --- | --- | --- |
| 用户意图与事实 | 理解目标，识别歧义，决定必要提问 | 保存原始需求、资产和缺失输入 |
| 参考视频 | 解读 Gemini 返回证据，决定保留/改写/自由发挥 | 执行分析，保存来源、报告与证据 |
| 创意 | 编写脚本，选择叙事、镜头、动作、参考职责 | 提供可选指南、案例和模板 |
| 提示词 | 创作目标镜头，选择或调整符合任务的表达 | 编译模板、绑定实际参考和模型语法 |
| 执行 | 根据用户要求决定调用与调整 | 校验参数、权限、准备快照、版本和幂等性 |
| 视觉判断 | 看得到实际图片时作判断；否则保持未知 | 返回真实图片及来源，保存判断记录 |
| 恢复与修改 | 选择补素材、改计划、修编辑或解释限制 | 返回当前状态、错误、可行操作和影响范围 |

硬约束包括：真实资产与所有权、模型兼容、用户明确限制、准备记录有效性、证据绑定、现有关键图片检查、版本和幂等性。保留现有代码执行，不转移为“读过指南即可通过”。

创作建议包括：优先考虑哪种叙事、模板、镜头节奏或导演套件。宿主可以采用、改写或不采用；不因为未选择推荐模板而拒绝合法计划。用户明确要求保留某特点时，该要求仍是项目约束。

复刻继续通过修改目标计划并重新编译来表达创意，不新增绕过证据和准备绑定的任意 promptOverride。现有允许手写提示词的其他路径保持其约束。

## 4. 单一指南源与目录

建议新增一个无 MCP/数据库依赖的内容模块：

```text
packages/guidance/
  src/
    catalog.ts                 # 主题、适用场景与合同要求
    reader.ts                  # 受限主题读取、哈希、兼容性校验
  content/
    overview.md                # 从 SKILL.md 改写，不含 Skill 元数据
    video-direction.md
    directing-examples.md
    image-direction.md
    director-kits.md
    ugc-ads.md
    talking-head-ads.md
    process-broll.md
    production-quality.md
    visual-review.md
    analysis-preflight.md
    media-operations.md
    commands.md
    host-codex.md
    host-claude.md
    host-hermes.md
  manifest.json                # 发布生成的版本、哈希和最低合同要求
```

沿用现有 topic ID，避免旧工具调用失效。Markdown 之间的文件链接改为明确的 `rikoko_guide` topic 调用提示，不假定宿主能访问包内路径。外部真实来源保留署名。

三类内容分开维护：导演方法以 Markdown 为源；模型提示词措辞以现有 core 编译器/套件为源；执行政策以代码合同为源。指南解释后两者，动态政策摘要由合同生成，不再手工维护相互独立的布尔值和流程段落。

新包不是第二个服务或独立产品版本。manifest 从当前内容和运行时发布生成，避免维护一套额外发布流程。

## 5. 统一 rikoko_guide 的读取路径

目标调用路径：

```text
宿主 → 本地 stdio 桥接器 → 当前配置的后端 → guidance 内容模块
宿主 → 后端 HTTP MCP ─────────────────→ 同一内容模块
```

将 `rikoko_guide` 纳入公共工具注册/分发，后端直接读取随自己发布的指南；stdio 通过现有 HostConnection 转发。移除当前单独注册的本地文件读取，防止重名注册。保持工具只读，不上传用户素材、不调用模型、不定价和生成。

保留 `rikoko_guide({topic:"overview"})` 和既有 topic 调用。输入新增项仅在必要时增量加入，首版不增加复杂 stage/problem/version 参数组合。host 适配主题可显式选择；configuredHost 继续由实际连接配置提供，不把宿主标签当成视觉或文件能力证明。

成功结果保留现有 topic、markdown、sha256、availableTopics、configuredHost 等兼容字段，增量加入：

- `guideProtocol`：指南返回合同标识。
- `guideVersion`：当前内容版本。
- `runtimeVersion`：提供这份指南的后端版本。
- `source`：backend 或明确标记的缓存来源。
- `requiredContracts`：本主题实际依赖的能力合同。

`capabilities` 增加 guide 协议、版本和主题目录；doctor 比较桥接器与后端支持的合同和工具，明确报告缺失项。MCP serverInfo 使用真实桥接器/服务版本，不继续固定写 0.1.0。

兼容性按合同判断，不要求桥接器、后端、指南的版本字符串相等。doctor 必须检查全部必需主题及清单：指南工具缺失、主题缺失、哈希不符或必需合同不兼容均报告不完整安装；普通连接成功不能替代指南可用。已兼容的版本差异不强制升级。旧 `GUIDE_UNAVAILABLE` 文案中回退本地 Skill 的建议一并移除。

后端不可用时返回可处理错误；首版不增加隐式本地全文回退，避免再次形成两个政策来源。初始化保留最小诊断和连接引导。可稍后增加绑定后端身份与版本的只读缓存，但缓存不证明当前模型能力、任务状态或执行条件。

指南调整只改变后续读取结果。新增工具/schema 仍需升级桥接器并重连；云端更新不会替换宿主已缓存的指令。本地部署需要升级其后端，不能承诺所有安装立即更新。

## 6. 精简 instructions，保留宿主的创造力

全局 instructions 只保留：产品用途、宿主是创意决策者、能力/指南入口、真实证据边界、现有用户授权与预算边界、恢复/幂等性、原会话交付。

删除其中详细的复刻步骤、音频/字幕教程和逐项导演要求，迁入对应指南。具体工具描述保留用途、关键输入、重要副作用和直接恢复入口，不重复整套导演手册。

将当前约 26,048 字符的全局 instructions 至少缩短 70% 作为工程目标；该基线来自本轮前序本地连接测量，实施前重新测量。缩短不是质量证明，需要结合宿主任务验证。

`rikoko_create/resume` prompts 保留为可选快捷入口，正文引用同一指南导航。普通自然语言请求应完整可用，不依赖 `/rikoko` 技能命令或宿主支持 MCP prompts。

首次相关任务读取 overview 和必要主题。同一会话已读且版本未变时，不要求每个镜头重复阅读。只改字幕不强制加载复刻/UGC 全套指南。

## 7. 让工具提供帮助，而非代替宿主决定

优先增量扩展已有结果，不新增一个万能编排工具。先覆盖 `workspace_snapshot`、`production_plan_validate`、`production_shot_prompts` 和 `generation_prepare`；后续按真实需要扩展。

建议统一可选字段 `guidance`：

```json
{
  "guidance": {
    "stage": "target_planning",
    "blockers": [],
    "decisions": [
      {"kind": "creative_choice", "question": "这一镜头更适合展示使用过程，还是突出成品质感？"}
    ],
    "suggestions": [
      {"tool": "production_plan_validate", "reason": "目标镜头形成后可检查结构和引用"}
    ],
    "guideTopics": ["video-direction"],
    "basedOn": {"planId": "示例计划ID", "planVersion": 3}
  }
}
```

上述为建议合同示例，非当前接口。`blockers` 复用现有校验器的真实问题；`suggestions` 是可选操作；`decisions` 是宿主可自主完成的创意选择，不自动变成向用户提问的清单。仅缺失事实、必要素材或真正影响范围的歧义需要用户补充。

阶段是当前记录的派生视图，允许简单编辑跳过分析/生成，不新建强制线性状态机。对多镜头任务按镜头/阶段报告，不把整个项目压成一个误导性的 nextStep。

建议不自动执行、不证明用户已授权，也不作为放宽校验的依据；真实提交继续检查最新状态。服务端只能验证计划结构和引用，不因字段齐全宣称创意好或画面正确。

## 8. 停止 Skill 分发与旧安装迁移

新安装：`clients install` 只配置 MCP、凭据和原有附件适配；不再写入任何宿主 skills 目录。旧 `sync-skill` 保留一个过渡版本的弃用提示与明确替代命令，不再生成或同步 Skill，也不隐式删除旧文件。

新增可预览、可恢复的迁移操作（建议 `clients migrate-skill <host>`，默认仅诊断，显式 apply 才落盘）：

1. 仅检查已知 rikoko 安装位置，使用文件清单、可信旧版本哈希及安装记录识别官方文件；managed 注释仅为辅助证据。
2. 先验证 MCP-only 新路径、全主题读取和兼容性可用，再停用旧入口。
3. 原样备份完整旧目录/符号链接信息、文件哈希与迁移记录，放在宿主不会发现 Skill 的归档目录。备份失败就不移除入口。
4. 未修改的官方安装可在 apply 后移出宿主发现目录；重复执行不重复迁移，恢复操作能还原原路径及字节。
5. 本地修改、额外文件或归属不明时先输出差异并保留；迁移状态为 needs_review，不静默抹除，也不假装已经完成。经确认后可归档停用，将有用经验逐条转入官方指南或现有项目记忆。
6. 区分普通文件与共享符号链接；不跟随链接删除目标，不修改其他宿主共享的 skill 源。doctor 报告已发现的别名和残留，不扫描无关用户文件。

官方指南和用户经验不建立自动混写机制。用户偏好由已有记忆功能显式保存，单次生成经验不能覆盖模型能力事实，也不能自动推广成所有用户的规则。

迁移备份还应保留文件权限。安装器和公开导出不再按 SKILL.md 文件名触发完整性校验，改用 guidance 清单逐项检查非空内容、主题、内部引用与哈希。同步更新 README、公开 README、examples/clients/README.md 和安装文档；历史验收不改写。

完成后移除仓库 `skills/rikoko` 的生产分发入口；历史验收文件仍保留历史描述。迁移兼容代码可以继续识别 SKILL.md，但新运行时不再以它为指南源。

## 9. 文件改动清单与顺序

| 批次 | 主要文件 | 退出条件 |
| --- | --- | --- |
| A：内容与合同 | 新 guidance 模块；contracts 指南结果合同；现有导演文档 | topic 不丢失、内部引用完整、manifest 可复现 |
| B：统一读取 | mcp/guides.ts、tools.ts、index.ts、stdio.ts、host-connection.ts；capabilities | HTTP 与 stdio 从同一后端取得同版本内容，错误清楚，读取无付费副作用 |
| C：宿主指导 | index.ts、各 instructions 模块、工具描述；core/workspace.ts 和现有制作结果 | 全局文本显著减少；建议与阻断分开；宿主可独立创作合法方案 |
| D：分发与迁移 | scripts/clients.ts、bootstrap/skill-files.ts 的迁移替代；package.json、public-release.json、pack-runtime.mjs、export-public.ts；安装文档 | 新装零 Skill；旧安装有诊断、备份、停用和恢复；公开源码和运行时包均完整 |
| E：验收与发布准备 | host-guides、host-integration、installation、installer-release、public-export 等测试；新增指南迁移和阶段提示测试 | 清洁候选包验证通过；宿主实测结论与未覆盖项分别记录 |

实施沿用当前已有分支，保留工作区其他修改。先完成 B/C 的 MCP-only 可用路径，再执行 D 的旧入口停用。涉及 rikoko-platform 时验证其实际运行时导入/打包边界，不根据本仓库测试推定云端兼容。

整体业务分发从 mcp 抽到应用层可作为后续独立重构。本轮仅抽出共享指南读取和必要指导逻辑，不顺便迁移所有生产工具。

## 10. 验收矩阵

| 场景 | 必须满足 |
| --- | --- |
| 全新宿主，无本地 Skill | 能发现 rikoko、读取指南、准备制作；安装过程不创建 Skill |
| HTTP / stdio | 相同后端和 topic 的正文版本/hash 一致；真实 host 信息允许不同 |
| 新桥接器 / 旧后端，旧桥接器 / 新后端 | 精确报告不兼容工具/合同；不循环重试，不删字段绕过 |
| 文档更新 | 兼容更新在下一次读取可见；新 schema 清楚要求升级/重连 |
| 仅分析 | 完成分析即结束，无生成/渲染提交 |
| 原创视频 | 宿主可选模板，也能提交自创结构；无“未选推荐套件”硬阻断 |
| 参考复刻 | 保留 Gemini handoff、宿主独立目标计划及所有现有准备校验 |
| 修改字幕 | 复用已接受媒体，不调用视频生成、不强制加载完整制作指南 |
| 断线/换宿主 | 从实际请求、计划、revision 和 job 恢复，不重购、不覆盖新修改 |
| 看不到关键图片 | 保留未知并走现有用户判断路径；无付费视觉补查、无伪造通过 |
| 正常交付 | 技术可交付与可选语义审核分开，保留现有默认政策 |
| 旧 Skill 被修改/共享链接/迁移中断 | 定制字节可恢复，共享目标不误删；不以 partial 状态宣称迁移完成 |
| 打包和公开导出 | 提取出的包无旧 Skill 依赖，所有 topic/哈希/引用可读，缺内容时构建失败 |

自动化首先运行受影响测试和类型检查，再执行安装/导出与完整构建回归。真实宿主验收覆盖 Codex、Claude Code、Claude Desktop、Hermes；连接与工具读取成功不等于模型遵循指南、视觉理解或媒体送达已验证。

创意验证使用相同 brief 的不同合法目标方案，确认不会被固定镜头数、固定套路或模板选择锁死；结合实际宿主轨迹检查其是否作出有依据的创意选择。付费生成不是文档迁移的必要验收，不能以 mock 成功声明成片质量提升。

## 11. 交付与回滚

交付内容：MCP-only 运行时、完整指南清单、安装/迁移/恢复工具、更新后的使用文档、自动化和真实宿主验收记录。

先验收干净候选制品，再按明确发布范围升级后端和桥接器，最后停用旧 Skill 并重载宿主会话。发布记录分别列本地实现、测试、提交、制品、部署和实际宿主生效状态。

回滚使用匹配的运行时/桥接器版本及旧 Skill 备份，保留项目数据、资产、作业与准备快照；不重放生成。指南版本本身不是已有作业失效条件，执行合同变化仍按已有版本校验处理。

## 12. 当前源码依据

- [指南读取实现](/Users/west/project/rikoko-mcp/packages/mcp/src/guides.ts)
- [stdio 与后端连接](/Users/west/project/rikoko-mcp/packages/mcp/src/stdio.ts)
- [安装和 doctor](/Users/west/project/rikoko-mcp/scripts/clients.ts)
- [旧 Skill 迁移与恢复](/Users/west/project/rikoko-mcp/packages/bootstrap/src/skill-migration.ts)
- [运行时打包](/Users/west/project/rikoko-mcp/scripts/pack-runtime.mjs)
- [公开源码导出](/Users/west/project/rikoko-mcp/scripts/export-public.ts)
- [生成准备校验](/Users/west/project/rikoko-mcp/packages/core/src/generation-preparation.ts)
- [制作工具及宿主指导](/Users/west/project/rikoko-mcp/packages/mcp/src/production-tools.ts)

本文是当前工作区的改造设计，不表示上述新目录、字段、命令和能力已经实现。
