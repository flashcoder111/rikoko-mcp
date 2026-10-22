# rikoko MCP 导演指南整合验收

日期：2026-10-19。状态：本地实现，当前分支 `main`；未提交、推送或部署，未修改已安装宿主配置及其 Skill 副本，未运行付费生成。保留仓库原有未提交改动。

## 实现结果

- 指南唯一生产来源为 `packages/guidance/content`，共 17 个主题，随运行时打包；manifest 校验内容 SHA-256。`rikoko_guide` 通过业务工具的统一调用路径，由实际执行后端读取；HTTP 与 stdio 不再分别持有指南内容。
- 启动指令从此前约 26,048 字符缩减至 2,938 字符（约减少 88.7%），保留能力入口、宿主职责、执行合同和交付约定。工具数量仍为 78，没有另建自主导演 Agent。
- 宿主负责需求解释、独立目标计划、镜头设计、提示词表达、方案选择及证据判断。导演套件和阶段建议明确可选；实际校验阻断单独返回。保留现有素材、准备记录、模型兼容、版本、幂等与支出约束。
- 计划校验、镜头提示词、生成准备和工作区快照返回相关主题及阶段建议。历史 revision 快照明确区分当前 head，修改前要求重新读取 head；轮询不会建议重新提交生成。
- 新安装不再创建独立 Skill；`sync-skill` 弃用且不修改文件。删除原 Skill 分发路径及重复 instructions。原仓库 Skill 的本地内容在迁移前另存临时备份；已安装的用户副本未动。
- doctor 检查实际后端的所有指南主题、内容哈希、协议、必需工具和版本一致性，同时报告旧 Skill 状态。仅文档内容更新随兼容后端生效；新工具/schema 仍需升级桥接器并重连。

## 旧安装迁移

`pnpm clients migrate-skill codex` 只预览；`--apply` 先验证已配置 MCP 后端，再归档已知官方副本。定制副本需审阅后显式提供 `--accept-fingerprint <sha256>`；共享符号链接不会自动迁移。

备份位于宿主扫描目录外，保留字节和权限。`pnpm clients restore-skill codex --backup <id>` 校验来源及内容，不覆盖现存目录。`--recover-lock` 仅恢复确认 owner 已退出的主锁；获取和恢复共用 guard，未知 owner 或中断 guard 需要人工检查。

客户端名称可替换为受支持的 Claude Code/Hermes 名称；Claude Desktop 没有本地 Skill 迁移目标。正式迁移后需重新加载宿主会话，避免会话继续持有旧指令。

## 验证证据

- 类型检查、变更模块的格式检查、`git diff --check` 通过。
- 根仓库 `pnpm build` 通过；实际导出的公开源码候选包 `pnpm build` 通过，包括指南校验、TypeScript 和两套前端构建。构建仍有原有 Noto 字体运行时解析提示。
- 实际 runtime 打包通过，共 232 个文件，无 Skill 分发目录。版本仍为 `0.1.25`，只产生临时候选，不用于覆盖已发布版本；正式发布需递增版本并重建。
- 实际 npm 包提取后逐主题读取、公开源码导出、缺失/损坏指南校验、HTTP 认证和 HTTP/stdio 正文一致性均由测试覆盖。
- Codex、Claude、Hermes、generic 四种配置分别启动真实 stdio 子进程并连接临时 HTTP 后端，读取全部主题；这些属于协议集成测试。
- 旧 Skill 已知/定制/未知内容、链接、备份恢复、内容篡改、活跃锁、并发恢复及中断 guard 均有回归测试。二次静态审查通过。

最终全量 `pnpm test`：97 个测试文件通过、1 个跳过；742 项测试通过、1 项既有跳过，耗时 161.31 秒。日志：`/tmp/rikoko-mcp-only-final-tests.log`。

## 候选制品与实际边界

候选目录：`/var/folders/px/ghk7pf1d5qb0c2m7wy13c0xm0000gn/T/rikoko-mcp-only-release-Bxe4sK/`。

- 公开源码：`source-final/`。构建借用本机已安装依赖（node_modules 链接），未做全新网络依赖安装。
- 运行时：`runtime-final/rikoko-0.1.25.tgz`，SHA-256 `0dcffe9fe4fb2896cc9e7d32a16c769dc34d32b112fed4e244691b8f09a4fa68`。
- 候选包含当前工作区内容，因此也包含任务开始前已有改动，不等于可独立发布的本次补丁。

尚未完成实际 Codex/Claude/Hermes 应用会话的升级、旧 Skill 迁移、宿主创意行为观察、图片可见性及原生媒体交付验收；协议测试不代表这些能力已验证。本轮没有真实模型质量试验，不能据此宣称成片质量提升。
