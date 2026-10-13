# 原 Agent 对话与工作台链接验收

日期：2026-10-12。

## 交互要求

用户在 Codex、Claude 或 Hermes 原有输入框中提出创作和修改要求。Agent 调用普通 MCP 工具，回复简短状态和一个工作台链接。用户主动点击链接后才打开工作台。项目不请求弹出 MCP Apps 窗口、不嵌入播放器、不自动打开浏览器或独立网页聊天。

示例回复：

> 已保存新版本，其他镜头保持不变。打开工作台可预览和导出。

实际回复附后端返回的“打开工作台”链接，不在链接中拼接工作空间 Key。

## 实现

- 所有 MCP 工具通过 `server.registerTool` 注册，不注册结果卡片资源，也不声明 `ui.resourceUri`。
- `workspace_commit` 与 `workspace_result` 只返回普通文本及结构化状态和工作台链接；`workspace_snapshot` 保留继续修改需要的项目、版本与时间线数据，去掉独立网页聊天入口。
- 默认结果中的媒体链接、媒体权限令牌和自动播放器附件被移除；输出素材 ID、名称和 MIME 保留，供 Agent 继续编排。
- `workspace_result` 不自动把文件写入宿主媒体目录。用户明确要求文件或附件时，才调用 `workspace_export`，不会因此重渲染或重复购买。
- instructions、create/resume prompts 和工具说明均要求留在原对话，默认只附工作台链接。
- `clients doctor` 不再要求卡片资源；它检查没有嵌入 UI 声明，输出 `interaction: "native-conversation-workspace-link"`、`inlineCardResource: false`。
- 历史卡片源码与测试仍保留，但运行中的 MCP 不注册或引用该界面。

底层 HTTP 媒体接口和工作台自己的登录、播放、导出流程保留。MCP 查询完成结果时，底层仍会签发短时媒体权限，但默认 MCP 响应不暴露这些链接；显式导出使用原有认证下载路径。

## 本地验证

- `pnpm test`：35 个测试文件、206 项测试通过。
- `pnpm build`：类型检查、Studio 和现存卡片产物构建通过；构建产物存在不代表 MCP 会注册卡片。
- `tests/api.test.ts`：真实 MCP v2 HTTP 客户端确认无 UI 元数据和资源声明，工作台链接可返回，默认没有媒体 `resource_link` 或网页聊天入口。
- `tests/mcp-native-chat.test.ts`：实际启动 Codex、Hermes、Claude 和通用四种 stdio 配置，验证 prompts、创建、查询、无自动附件写入，以及显式导出不会新增任务。这里使用标明的契约素材，不作为视频质量证据。
- 隔离的真实渲染验收：通过 stdio 创建作品，FFmpeg 输出 1 秒、360 × 640、H.264/AAC 视频；默认响应只有 `text`，宿主导出目录没有自动生成文件；工作台链接可访问；明确导出后 ffprobe 成功解析 MP4。
- 同一隔离服务运行 `clients doctor codex` 成功，`inlineCardResource` 为 `false`。

真实渲染记录在 `artifacts/native-conversation/verification.json`，显式导出样片在 `artifacts/native-conversation/explicit-download.mp4`。本轮没有修改用户作品，没有付费模型调用。

## 激活与边界

本机 Codex 的 `hypit` 配置已指向当前工程的 `packages/mcp/src/stdio.ts`。应用更新后，启动或重启本地后端，再在宿主中重载 Hypit MCP 连接，让客户端刷新工具清单与资源声明。已出现在旧历史消息里的卡片不会自动删除。

上述证据是本地 HTTP、真实 stdio 进程和媒体验证，不是 Codex、Claude、Hermes 厂商界面的完整人工验收。宿主自己的工具调用详情或权限确认仍由宿主控制；本项目已移除会触发 MCP Apps 内容窗口的声明。链接首次打开仍需有效工作空间登录。
