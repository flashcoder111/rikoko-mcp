# 素材追问、恢复创作与原对话交付

日期：2026-10-14。本次是本地实现与验收，未提交、推送或部署。

后续提交与部署已完成，见 [0.1.2 发布记录](release-0.1.2-2026-10-14.md)；下文保留最初功能验收时的状态。

## 用户可见行为

- 宿主 Agent 先复用适合的现有素材；缺少必需材料或事实时，在原对话说明需要什么、用于哪里。可选素材不阻塞。
- 保存原始要求、后续补充、已导入素材、未解决的问题。用户只回复素材也可继续同一请求；不会把补充误作新作品。
- 工作台将请求 ID 保留在 URL，刷新后恢复待补充问题或可提交方案。用户可继续上传素材并发送，无需重复输入要求。
- 实际任务完成后，原对话返回视频、字幕和预览图资源，以及当前版本的画面文字。画面文字标明来源，不冒充语音转录或视觉验收。
- 配置导出目录的 Codex/Hermes stdio 桥接自动保存附件并返回宿主媒体语法；其他客户端保留媒体资源链接。`delivery: "links"` 跳过自动保存，`workspace_export` 可手动重试。
- 本地下载失败时保留已成功生成的结果和媒体链接，不重渲染、不再次购买。只有 completed 的任务能导出。
- 保留原对话，不注册 MCP Apps 卡片或自动打开浏览器。用户仍可主动进入工作台精修。

## 工具与状态

新增 `workspace_request_save` 与 `workspace_request_get`，使用现有实体表持久化，不需要破坏性迁移或新增模型。宿主 Agent 可以自己组织缺失项，也可通过可选的 `workspace_plan` 获得方案及结构化追问。

缺失项包含 `id`、`kind`、`prompt`、`purpose`、`required` 和可选 `sceneId`。保存更新必须携带 `requestId` 和当前 `requestVersion`。省略 `missingInputs` 会保留原问题；确认已满足后显式传剩余问题或空数组。素材 ID 自动累积并验证账户归属。

状态为 `waiting_input`、`ready`、`submitted`。本地规划不擅自抹掉宿主保存的必需项；同类素材有多个待补充位置时，交给 Agent 确认对应关系。带请求的 `workspace_commit` 拒绝未就绪和重复提交的请求。相同幂等键重试仍返回同一版本和任务。

`workspace_result` 返回媒体 `resource_link`、结构化 `media` / `outputs`、`textContent`、链接到期时间和工作台入口。刷新短时链接只查询既有任务。SRT 文件导出保留 `.srt` 后缀。

付费分析、图片、视频和音频生成的报价确认规则保持有效；素材补充不构成新付费授权。宿主尚未提供附件字节时，Agent 必须给出可用上传方式，不能声称已经导入。

## 验证

- 最终 `pnpm test`：41 个测试文件、289 项测试全部通过。
- 单元及接口测试覆盖：只发附件续做、跨应用实例恢复、原始要求与素材保留、可选项不阻塞、错误素材不解除必需项、并发版本冲突、跨账户拒绝、只读 Key 拒绝写入、未就绪请求拒绝提交、幂等提交、模型同时返回动作和缺失项时阻止执行。
- MCP 协议测试覆盖 HTTP 和 Codex/Hermes/Claude/generic stdio；原对话返回资源链接，Codex/Hermes 返回本地附件；不注册嵌入 UI。
- 交付异常测试覆盖 links-only、下载失败回退、queued/running/failed/cancelled 不导出，确认交付流程只查询原任务。
- React 表单测试覆盖空文本带附件可发送、忙碌/完全空白时不提交、必需/可选项显示。
- `pnpm build`、类型检查、修改文件格式检查、`git diff --check` 通过。
- `pnpm exec tsx scripts/verify-conversation-delivery.ts` 完成真实浏览器和 stdio 验证：追问刷新恢复 → 上传原始插画测试素材 → 仅附件续做 → 方案刷新恢复 → 本地渲染 → 播放与文案 → 修改字幕复用素材 → 原对话视频交付。
- 两次本地真实渲染，无付费生成调用；输出经 ffprobe 确认为 3 秒、360×640、H.264/AAC。桌面及 390px 手机宽度无横向溢出，浏览器无异常。

本地证据（在 artifacts 中，不包含凭据）：

- `artifacts/conversation-delivery/verification.json`
- `artifacts/conversation-delivery/01-missing-material.png`
- `artifacts/conversation-delivery/02-video-and-content.png`
- `artifacts/conversation-delivery/03-mobile.png`
- `artifacts/conversation-delivery/conversation-result.mp4`

## 激活与验证边界

运行中的后端需要加载新代码，宿主 MCP 需要重载工具清单与 instructions。没有在本轮操作用户的线上服务或重启其工作会话。

浏览器、HTTP 和真实 stdio 已验证；这不等于 Codex/Claude/Hermes 各自厂商界面的完整人工验收。媒体是否内联播放、跨设备地址是否可访问、消息平台是否接受附件仍取决于宿主与部署。验证视频来自明确标注的本地插画素材，不是 MiniMax 或其他供应商的付费生成质量证据。
