# 对话与工作台共用一份作品

2026-10-11。默认入口是 Codex / Hermes / Claude 原对话，可选编辑工作台、共享版本与媒体交付。网页聊天保留为独立使用和开发调试入口。实现范围不代表完整复刻 Pollo 或 Vizard，宿主之间也不保证完全相同的卡片 UI。

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

1. `workspace_commit` 接收上述动作，校验并持久化版本，排入真实本地合成任务，返回 projectId / revisionId / jobId 与两个界面链接。
2. `workspace_result {jobId}` 返回实际状态/阶段。完成后返回 MP4、预览帧、字幕等结果文件，带 MIME、名称、一小时有效的受限媒体链接。
3. stdio 桥接把已完成输出保存到宿主专用目录，返回本地路径：Codex 可使用本地媒体渲染，Hermes 使用当前会话的 MEDIA 附件。支持 MCP Apps 的宿主可以加载 `ui://video-workbench/result.html`，展示状态、媒体、同步最新版本、继续修改和可选工作台。卡片通过 Apps SDK 把修改要求发回原对话；能力不可用时提供复制文字。其他界面保留普通 JSON 与 resource_link，不承诺终端内播放。
4. 用户在工作台修改后，外部 Agent 再调用 `workspace_snapshot {projectId}` 获取当前版本和修改记录，再提交 edit action。网页不会冒充或嵌入原 Hermes 会话，也不保证宿主自动同步所有网页聊天内容。

媒体链接只允许读取该任务的输出，不包含 API Key。`delivery_revoke {grantId}`、一小时到期或原 Key 撤销会使链接失效。重调 workspace_result 可续取新链接，不重渲染。结果链接相当于短时只读权限，应只交给该用户的对话。HTTP 视频读取支持单字节范围请求。

## 共享状态与编辑

编辑动作包含 projectId、当前 baseRevisionId、稳定 idempotencyKey 和 action。服务端在同一事务校验当前 head、素材归属、时间边界，然后保存不可变 revision、作品 head 和操作摘要。相同请求重试返回同一版本和同一任务；同键不同内容报冲突。历史恢复产生新版本，原记录不被删除。

打开/关闭界面、读取状态不创建任务；提交修改会合成一个新预览，复用既有素材，不购买新镜头。关闭页面不终止后台任务。旧的 revision_revise / feedback patch 也推进共享 head，并拒绝对过期版本的编辑；variants 保持独立候选，通过恢复动作明确选用。

支持 caption、delete、move、split、trim、delete_words、visual、scene_audio、insert、style、music、format。裁剪和分割同时调整源视频起点、独立配音起点、已提供的词时间与事件；按词删除需要已有对齐数据。替换画面默认保留原音，可显式选择新素材的声音。字幕文字编辑保留原配音，不等于重配音或自动 ASR。没有现成对齐数据时不伪造“删一句话”的结果。

版本和任务使用现有通用实体表，无破坏性迁移。旧作品仍可查看、编辑；原有数据目录保留。

## 网页里的自然语言理解

`workspace_plan` 只返回可审阅方案。默认本地明确指令支持，例如“删除最后一个镜头”“第一个镜头移到结尾”“字幕大一点”“当前镜头在 1 秒分割”，以及带脚本的文字卡片、已有图片/视频编排。复合指令全部识别后才返回动作，避免只执行其中一半。

自由描述可选启用一个兼容 Chat Completions 的服务端模型：

```sh
ENABLE_CREATIVE_AGENT=true
CREATIVE_AGENT_URL=https://your-model-service/v1/chat/completions
CREATIVE_AGENT_MODEL=your-model
CREATIVE_AGENT_KEY=your-server-only-key
```

模型只收到请求、composition 和附件元数据，不获得工作空间 Key。输出必须满足编辑 schema，由用户查看方案后提交；素材/租户/时间边界仍由服务端检查。模型不会凭空获得视频生成、ASR 或翻译能力。这项规划调用可能产生服务商费用，当前不进入媒体任务报价账本；默认关闭，本轮只用 mock 测试适配器，没有真实收费调用。

## 手机和远程部署

设定可达的 `PUBLIC_BASE_URL=https://video.example.com`、相应 ALLOWED_HOSTS 和 HTTPS 反向代理。PUBLIC_BASE_URL 同时用于工作台、结果文件、卡片媒体域及浏览器 Origin 校验。显式配置 HTTPS 时，即使代理到内部 HTTP，浏览器会话仍使用 Secure Cookie；不会盲目信任客户端提供的 X-Forwarded-*。保留外部 Host。当前本机 127.0.0.1 地址不能让另一台手机直接访问。

运行 `pnpm build` 同时打包 Studio 与 MCP 结果卡片。真实宿主的 Apps 能力、附件接收、平台原生媒体回传仍要逐个验收；不支持 Apps 的宿主仍有普通工具和文件路径。安装、激活与各宿主能力边界见 [客户端配置](../../examples/clients/README.md)。
