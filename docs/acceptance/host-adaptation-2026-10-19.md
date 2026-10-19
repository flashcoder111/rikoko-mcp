# Codex / Claude / Hermes 适配完善（2026-10-19）

## 本次范围

沿用当前已有 main，保留原工作区改动。完善公共 Skill、宿主指引和 MCP 内容分发；本次未提交、推送、部署公共运行时或执行付费生成。

- `skills/rikoko/SKILL.md` 保留任务分流、导演职责、报价授权、复刻证据绑定、视觉验收与恢复规则。详细命令和媒体操作移到按需读取的参考文件，未删除原有 Kling 编辑、TikTok 导入、分析精度、声音和字幕说明。
- Codex、Claude Code/Desktop、Hermes 分别有适配说明，覆盖入口语法、实际文件可达性、MCP image blocks、视觉能力判断、交付方式及重连恢复。宿主名称不视为视觉能力证明；文本摘要不能当作直接观察。
- 增加动作导演示例和跨宿主分析预检说明。示例用于编写目标计划，仍由既有编译/准备链产生正式输入，不绕过 remake 绑定。
- `rikoko_guide` 提供 12 个固定主题（入口加 11 份参考文件），读取随包 Markdown；同时返回文本和 structuredContent，附内容哈希。无用户文件路径/URL参数，无后端调用、上传或付费副作用，stdio/HTTP MCP 共用注册。
- Claude Desktop 无需本地 Skill 文件即可读取相同指引。此工具不注册 MCP App 或内嵌播放器。
- npm 运行时包新增 Skill 与参考文档；打包检查要求参考文件随包。公共源码导出继续校验入口链接。
- `pnpm clients sync-skill <codex|claude-code|hermes>` 仅更新托管技能，备份差异，保护非托管同名 Skill，不初始化后端、不处理凭据、不改宿主配置。普通安装也复用同一文件分发函数。
- doctor 增加指引可用性/哈希检查，明确 `hostVisionVerified=false`、`hostDeliveryVerified=false`。

## 自动验证

执行：

```sh
pnpm exec vitest run tests/host-guides.test.ts tests/skill-files.test.ts tests/host-integration.test.ts tests/host-attachments.test.ts tests/mcp-native-chat.test.ts tests/production-tools.test.ts tests/production-review.test.ts tests/production-enforcement.test.ts tests/remake-handoff.test.ts tests/installation.test.ts
pnpm build
pnpm typecheck
uv run --no-project --with pyyaml python /Users/west/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/rikoko
```

- 10 个测试文件、118 项测试通过。最后调整指引 structuredContent 和 doctor 输出后，9 项宿主指引测试与类型检查再次通过。
- 新增测试通过 MCP 内存传输读取每个主题，验证全文/哈希、不同宿主、无文件工具的读取、无后端调用，以及任意路径/未知主题/额外参数拒绝。
- 临时 home 中运行三端真实 `sync-skill` CLI，在无凭据、无宿主配置且故意无效后端配置下成功；检查只写技能文件，不建立其他配置。
- npm pack dry-run 验证所有入口链接对应文件进入包；没有发布 npm 或正式运行时。
- Skill frontmatter 校验、修改的 TypeScript/JavaScript 格式检查和 `git diff --check` 通过。
- 完整构建通过；Vite 提示两份 Noto 字体路径留待运行时解析，此次未修改字体实现。

## 本机同步与连接检查

已使用 sync-skill 更新本机 Codex、Claude Code、Hermes 的托管 Skill 与 11 份参考文件，原有不同文件已备份；无关用户文件保留。核对入口及参考文件与仓库逐字节一致。

四个已安装配置分别新建真实 stdio 连接，初始化、工具发现、capabilities、rikoko_guide overview 均成功：

| 已安装配置 | 连接 | 指引 |
| --- | --- | --- |
| Codex | 通过 | 新主题目录可读 |
| Claude Code | 通过 | 新主题目录可读 |
| Claude Desktop | 通过 | 无本地 Skill 也可读取 |
| Hermes | 通过 | 新主题目录可读 |

未写入 MCP 配置或凭据；未代替运行中的客户端重载。已有会话需重连 MCP/重新加载 Skill 才能看到新入口，Hermes 可使用 `/reload-mcp` 或重启。

## 尚未验证

真实宿主 UI 中的图片传递、视频/音频展示和 Hermes 各聊天渠道的附件发送；真实付费模型生成画质；公共发行包与云端部署。连接测试与合成媒体回归不等于这些验收已经完成。
