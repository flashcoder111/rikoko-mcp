# 对话与工作台共用一份作品

2026-10-14 更新。默认入口是 Codex / Hermes / Claude 原对话。Agent 使用普通 MCP 工具，缺素材时保存追问，完成后交付媒体附件或资源链接及相关文案；用户主动点击工作台链接后才打开工作台。MCP 不注册 Apps 资源、不带工具 UI 元数据、不注册卡片播放器或自动打开网页。网页聊天保留为独立使用和开发调试入口。

## 用户入口

- Codex / Hermes / Claude：默认创作入口，原会话里调用 MCP，媒体与修改结果回到原会话。
- `/`：独立网页入口，附件、创作要求、执行前方案、后台任务状态、可播放结果与“打开工作台”。
- `/workspace?project=<id>&revision=<id>`：同一作品的助手、视频、镜头时间线、字幕/裁剪/分割/顺序/画面/声音/画幅、素材与版本。手机显示单预览与可切换面板。
- `/tools`：保留已有配音、模型、参考分析、用量等底层工具。
- `/preview#<token>`：原有只读分享，和可编辑工作台权限分开。

浏览器首次使用现有工作空间 Key 换取 24 小时 HttpOnly、SameSite=Strict 会话。服务器只保存会话摘要，逐次检查原 Key 的撤销状态。刷新、切换界面不要求重复连接。用户退出撤销会话。尚未提供 OAuth/公众账户注册，因此这仍是自部署工作空间入口，普通手机用户的正式身份连接不在本轮已验收范围。

## 默认 MCP 流程

Codex、Hermes 和 Claude 使用各自的理解能力，直接传结构化动作。无需内嵌网页或再配置一个服务端模型。客户端 stdio 桥接负责原生附件，HTTP 服务负责持久化作品与渲染，两者不重复启动数据库。

```json
{
  "message": "把脚本做成短片",
  "origin": "agent",
  "idempotencyKey": "one-user-intent-stable-id",
  "action": {
    "type": "create",
    "composition": {
      "schemaVersion": 1,
      "title": "第一版",
      "width": 360,
      "height": 640,
      "language": "zh",
      "scenes": [
        { "id": "opening", "durationMs": 3000, "text": "开始新的故事" }
      ]
    }
  }
}
```

1. `workspace_commit` 接收上述动作，校验并持久化版本，排入真实本地合成任务。MCP 返回 projectId / revisionId / jobId 和工作台链接，不提供独立网页聊天入口。
2. `workspace_result {jobId}` 返回实际状态；完成后附媒体 `resource_link`、当前画面文案和工作台链接。配置了导出目录的 Codex/Hermes 自动保存本地附件；`delivery: "links"` 跳过保存。
3. Agent 在原对话交付视频及相关内容。下载失败保留媒体链接，不误报生成失败；可用 `workspace_export` 重试保存，无需重渲染。Codex 使用宿主支持的媒体语法，Hermes 使用当前会话 MEDIA 附件。
4. 用户在工作台修改后，外部 Agent 再调用 `workspace_snapshot {projectId}` 获取当前版本和修改记录，再提交 edit action。网页不会冒充或嵌入原 Hermes 会话，也不保证宿主自动同步所有网页聊天内容。

媒体链接只允许读取该任务的输出，不包含 API Key。`delivery_revoke {grantId}`、一小时到期或原 Key 撤销会使链接失效。重调 workspace_result 可续取新链接，不重渲染。结果链接相当于短时只读权限，应只交给该用户的对话。HTTP 视频读取支持单字节范围请求。

## 共享状态与编辑

编辑动作包含 projectId、当前 baseRevisionId、稳定 idempotencyKey 和 action。服务端在同一事务校验当前 head、素材归属、时间边界，然后保存不可变 revision、作品 head 和操作摘要。相同请求重试返回同一版本和同一任务；同键不同内容报冲突。历史恢复产生新版本，原记录不被删除。

打开/关闭界面、读取状态不创建任务；提交修改会合成一个新预览，复用既有素材，不购买新镜头。关闭页面不终止后台任务。旧的 revision_revise / feedback patch 也推进共享 head，并拒绝对过期版本的编辑；variants 保持独立候选，通过恢复动作明确选用。

支持 caption、delete、move、split、trim、delete_words、visual、scene_audio、insert、style、music、format。裁剪和分割同时调整源视频起点、独立配音起点、已提供的词时间与事件；按词删除需要已有对齐数据。替换画面默认保留原音，可显式选择新素材的声音。字幕文字编辑保留原配音，不等于重配音或自动 ASR。没有现成对齐数据时不伪造“删一句话”的结果。

版本和任务使用现有通用实体表，无破坏性迁移。旧作品仍可查看、编辑；原有数据目录保留。

## 网页里的自然语言理解

`workspace_plan` 保存创作请求并返回可审阅方案或结构化追问；返回的 `requestId` / `requestVersion` 用于下一轮补充，允许只传附件。`workspace_request_save/get` 供宿主 Agent 保存和恢复自己组织的追问，无需额外模型。未解决必需项时不能提交该请求；可选项不阻塞。网页将请求 ID 保留在 URL 中，刷新可恢复。

默认本地明确指令支持，例如“删除最后一个镜头”“第一个镜头移到结尾”“字幕大一点”“当前镜头在 1 秒分割”，以及带脚本的文字卡片、已有图片/视频编排。复合指令全部识别后才返回动作，避免只执行其中一半。

自由描述可选启用一个兼容 Chat Completions 的服务端模型：

```sh
ENABLE_CREATIVE_AGENT=true
CREATIVE_AGENT_URL=https://your-model-service/v1/chat/completions
CREATIVE_AGENT_MODEL=your-model
CREATIVE_AGENT_KEY=your-server-only-key
```

模型只收到请求、composition 和附件元数据，不获得工作空间 Key。输出必须满足编辑 schema，由用户查看方案后提交；素材/租户/时间边界仍由服务端检查。模型不会凭空获得视频生成、ASR 或翻译能力。这项规划调用可能产生服务商费用，当前不进入媒体任务报价账本；默认关闭，本轮只用 mock 测试适配器，没有真实收费调用。

## 手机和远程部署

设定可达的 `PUBLIC_BASE_URL=https://video.example.com`、相应 ALLOWED_HOSTS 和 HTTPS 反向代理。PUBLIC_BASE_URL 同时用于工作台、结果文件及浏览器 Origin 校验。显式配置 HTTPS 时，即使代理到内部 HTTP，浏览器会话仍使用 Secure Cookie；不会盲目信任客户端提供的 X-Forwarded-*。保留外部 Host。当前本机 127.0.0.1 地址不能让另一台手机直接访问。

当前构建仍包含历史卡片代码，但运行中的 MCP 不注册或引用它。从旧版升级后，重启后端并重载宿主 MCP，以刷新缓存的工具声明；旧历史卡片不会被删除。真实宿主的工具授权界面、链接打开和显式附件接收仍需逐端验证。安装与激活见 [客户端配置](../../examples/clients/README.md)。
