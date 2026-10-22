# rikoko MCP：Codex / Hermes / Claude 对话接入

视频创作 MCP 的产品名称和新安装配置名统一为 **rikoko**。Codex、Claude Code 和 Hermes 安装时会获得同名技能入口；Claude Desktop 使用 MCP 工具和自然语言入口。

默认使用宿主原有对话：Agent 理解要求、调用普通 MCP 工具、回复状态，并在完成验收后交付视频附件或媒体链接，始终附上可点击的工作台链接。用户继续在原对话提出修改。**不自动弹出 MCP 窗口，不嵌入卡片播放器，也不另开网页对话。** 用户主动点击“打开工作台”时才进入 `/workspace` 预览、剪辑或导出。网页 `/` 保留独立使用和开发调试；多个客户端共享同一后端账户下的项目、素材、任务与版本。

## 安装和激活

一行安装版自动准备环境、连接官方地址并注册检测到的 Codex/Claude 客户端。MCP 通过 `VIDEOWORKBENCH_MANAGED_CONFIG` 找到安装记录，连接时自动启动自己的本地后端；不再需要用户手动保持 `pnpm dev`。安装版的客户端 Key 存在本机 0600 私有文件中，宿主配置只保存文件路径。详见 [一行安装](../../docs/architecture/installation.md)。

以下是手动运行源码的方式：先在本仓库完成 `pnpm install`、`pnpm build`，再保持 `pnpm dev` 运行。stdio 连接器只访问这个 HTTP 后端，不另开 PGlite 数据库。

```sh
pnpm clients install codex
pnpm clients install claude-desktop
pnpm clients install claude-code
# 在实际安装了 Hermes、已有 ~/.hermes/config.yaml 的机器执行：
pnpm clients install hermes
```

macOS 安装器为每端签发 read/write、付费预算为 0 的独立 Key，保存于系统 Keychain。配置只写 Keychain 服务名称，不写凭据。已有配置先备份、再原子更新，其他 MCP 保留；同名 `rikoko` 指向不同工程时拒绝覆盖。重复安装同一配置不追加条目。安装器不会覆盖内容不同的同名用户技能。

macOS Hermes 会额外允许 `~/Library/Application Support/Hermes/composer-images/`，用于导入在聊天输入框上传的图片。旧配置若仍是两个默认工程目录，重新执行 `pnpm clients install hermes` 会只升级该目录列表；其他启动设置必须一致，自定义或主动收窄的目录列表不会被自动扩展。安装后在 Hermes 执行 `/reload-mcp` 或重启应用。Linux/远程 Hermes 请配置实际宿主上的专用附件目录，不套用 macOS 路径。

| 客户端                                    | 配置位置                                                          | 激活方式                                      |
| ----------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Codex app / CLI                           | `~/.codex/config.toml`，`mcp_servers.rikoko`                       | 在 MCP 设置中重启连接，或重新启动客户端       |
| Claude Desktop（本安装器支持 macOS 路径） | `~/Library/Application Support/Claude/claude_desktop_config.json` | 登录后重启应用，在开发者/连接器设置确认 rikoko（配置名 `rikoko`） |
| Claude Code                               | `~/.claude.json`，`mcpServers.rikoko`                              | 重启或在 `/mcp` 检查连接                      |
| Hermes                                    | `~/.hermes/config.yaml`，`mcp_servers.rikoko`                      | `/reload-mcp` 或重启 Hermes                   |

连接器使用当前 Node 的绝对路径，不依赖桌面应用的 shell PATH。升级或移动 Node/仓库后，要检查原配置路径。安装器不会自动覆盖不同路径的已有条目。

```sh
pnpm clients doctor codex
pnpm clients doctor claude-desktop
pnpm clients doctor claude-code
pnpm clients doctor hermes
```

doctor 启动真实 stdio 子进程，检查初始化、工具发现、capabilities，并确认没有声明嵌入式 MCP UI。成功输出包含 `interaction: "native-conversation-media-and-content"` 和 `inlineCardResource: false`。它不购买生成任务，也不代替宿主界面验收。查看可移植模板：`pnpm clients config <客户端>`。不要把当前 Mac 的路径直接复制到远程 Hermes。

存在已安装的 rikoko 配置时，doctor 使用其中的启动命令与环境；输出 `configSource` 和 `importRoots` 供核对。没有已安装条目时才使用生成的默认配置，并标记 `configSource: "generated"`。doctor 新建测试连接，不会替已经运行的宿主重载 MCP，也不代表附件已实际上传。

从旧卡片版本更新后，重启后端并在 Agent 中重载 MCP 连接，让宿主重新读取工具声明。已展示的旧卡片可能保留在历史消息中；新的调用使用普通工具结果。

## 三端适配与导演指引

三端使用同一份公共导演流程，差异集中在宿主上下文、附件读取、实际看图能力和结果交付。客户端名称不代表该会话一定具备视觉能力。

| 宿主 | 入口与指引 | 素材与验收 | 最终交付 |
| --- | --- | --- | --- |
| Codex app / CLI | 自然语言与 `rikoko_guide`；[适配说明](../../packages/guidance/content/host-codex.md) | 使用可访问的真实路径；工具编排必须保留 `media_inspect` 的 image blocks | app 支持时使用返回的本地路径展示；CLI/远程可用媒体链接 |
| Claude Code | 自然语言与 `rikoko_guide`；[适配说明](../../packages/guidance/content/host-claude.md) | 按需读取 MCP 指南，核实 MCP 进程能读取附件 | 返回媒体链接；只有当前宿主支持时才使用原生附件 |
| Claude Desktop | 自然语言或 MCP prompt；`rikoko_guide` 提供全文 | 不假定桌面附件对 MCP 可读；无需终端也能读取导演指引 | 媒体链接与工作台链接，不承诺内嵌播放器 |
| Hermes | 自然语言与 `rikoko_guide`；[适配说明](../../packages/guidance/content/host-hermes.md) | 区分 native pixels 和辅助视觉摘要；使用实际主机附件目录 | 支持的当前渠道用返回的 `MEDIA:` 路径；失败可回退到媒体链接 |

所有最终视频仍需当前版本验收，交付时均包含准确的工作台链接。看不到画面的宿主保持 unreviewed，获取用户或可用视觉审核，不把文本摘要写成亲眼观察。

`rikoko_guide` 是只读 MCP 工具，通过已配置连接读取执行后端的版本化导演指南，返回内容哈希和所需合同。不上传素材、不定价、不调用模型。所有宿主均使用此入口，无需独立 Skill、本地 Markdown 文件权限或 MCP App。宿主负责创意、计划和后续选择，模板/套件建议可以不采用。

安装仅配置 MCP。更新后执行 `pnpm clients doctor codex`（或其他客户端）检查全部主题、工具兼容性及旧 Skill 残留。指南内容随后端发布；新工具结构需要更新桥接器和重连，不能仅升级云端就假定所有本机会话已更新。

旧安装先执行 `pnpm clients migrate-skill codex` 预览，确认后加 `--apply`。只归档哈希完整匹配的官方副本；有修改、额外文件或符号链接时返回 `needs_review` 并保留原文件。备份在宿主扫描目录外，可用 `pnpm clients restore-skill codex --backup <id>` 恢复。审阅过定制内容后可显式使用 `--apply --accept-fingerprint <预览指纹>` 归档这份精确副本；共享链接仍需人工处理。中断留下的锁可用 `--recover-lock` 检查并恢复，仅当其记录的进程已退出。其他宿主替换客户端名；Claude Desktop 无本地 Skill 迁移目标。`sync-skill` 已弃用，不再修改文件。

## Hermes 运行在服务器时

在 Hermes 所在机器部署连接器及 Node 依赖。后端可同机运行，也可设置 `VIDEOWORKBENCH_URL=https://你的服务域名`。通过该机器的秘密环境注入 `VIDEOWORKBENCH_API_KEY`；非 macOS 安装器不会持久化明文凭据。环境变量必须由启动 Hermes 的进程继承；Hermes 的秘密环境文件可使用其官方 `${VAR}` / `${env:VAR}` 机制引用，勿在共享配置中填入真实 Key。

完成后在 Hermes 原对话交付视频及相关内容。配置了导出目录时，`workspace_result` 自动将结果写入 Hermes 主机的 `VIDEOWORKBENCH_EXPORT_DIR`，并在**当前会话**使用 `MEDIA:/绝对路径/video.mp4` 返回附件。不得选择其他收件人。配置 `HERMES_MEDIA_DELIVERY_STRICT=1` 的部署需将这个导出目录加入 `HERMES_MEDIA_ALLOW_DIRS`；Docker 部署还要保证 Agent 与网关能访问同一媒体路径。Telegram、飞书等平台的实际发送限制仍需逐平台验证。

## 对话中的使用

宿主可以理解以下兼容文字表达，不代表注册了技能命令；工作台输入框则省略 `rikoko`，直接输入 `/models` 等；输入 `/` 或点击输入框旁的 `/` 按钮查看菜单。Agent 的 `/model` 可能属于宿主自身，因此选择视频模型请完整写 `/rikoko model <模型 ID>`。

| Agent 示例 | 用途 |
| --- | --- |
| `/rikoko help` | 查看指令 |
| `/rikoko models` | 查看当前接入的模型、规格和状态 |
| `/rikoko model <目录中的 ID>` | 明确选择模型；`auto` 恢复自动选择，视频优先 MiniMax |
| `/rikoko brief 咖啡店新品短片` | 补充创作要求 |
| `/rikoko style 温暖、自然光` | 补充风格 |
| `/rikoko reference 第一张图用于人物一致性` | 说明参考素材用途，需另附实际文件 |
| `/rikoko video`、`image`、`speech`、`audio`、`edit` | 切换视频、图片、语音、其他音频或剪辑；各类保留独立模型选择 |

工作台指令单独放在草稿的最后一行，按 Enter 应用；原描述和附件会保留，指令本身不提交任务。时长、画幅直接用自然语言，例如“做一条 15 秒、9:16 竖屏的视频，配温柔的中文女声”，Agent 分别整理视频和语音参数，匹配各自的模型规格。工作台直接生成使用所选模型的固定规格，描述本身不会覆盖规格；复杂要求交给 Agent 编排。需要结构化参考输入的档案会显示在目录中，当前工作台文字生成入口不能选择它们，请通过 Agent 的参考素材流程绑定输入。

当前模型统一经 fal.ai 接入；Seedance 2 等后续模型在实际配置并启用后由模型目录提供，不预置虚构可用状态。选择模型本身不代表请求生成；只执行用户请求范围内的生成并遵守明确预算。用户询价时才展示可选报价。以下是兼容的文字表达，独立 Skill 已取消；推荐普通自然语言，不保证斜杠菜单。

可直接说：“使用 rikoko，根据这些素材做一段视频，在当前对话告诉我进度，完成后发给我视频。”若只想看工作台链接，可明确提出。所有宿主均可使用自然语言。MCP 还提供可选的 `rikoko_create`、`rikoko_resume` prompt，展示方式取决于客户端。安装或更新后需重载 MCP；不依赖技能或斜杠菜单。

1. `capabilities` 查看真实可用能力；读取当前宿主适配和任务所需的导演指引。调用 `rikoko_guide {topic:"overview"}`，再按返回目录加载相关 topic。宿主 Agent 直接准备 composition 或编辑动作；`workspace_plan` 可选，无需额外配置网页创作模型。
2. 本地附件通过 `asset_import_file` 上传实际文件。默认允许工程的 `media-inbox/` 和 `artifacts/`；macOS Hermes 安装配置还包含上面的 `composer-images/`。需传素材许可及 `rightsConfirmed: true`。其他专用附件目录由操作者通过 `VIDEOWORKBENCH_IMPORT_ROOTS` JSON 数组配置。工具描述会列出当前目录；遇到 `FORBIDDEN`，按提示将所选素材复制到可用目录后使用新路径，或更新专用目录配置并重载 MCP；不要原样反复重试。目录尚未创建不会影响其他有效目录；附件已失效时需重新附加。连接器不能自动读取宿主未提供的附件，也不开放整个用户主目录。
3. `workspace_commit` 创建/编辑，使用稳定 `idempotencyKey`；`workspace_result` 查询状态。重试查询不再次提交生成。
4. MCP 在任务完成后返回普通文本、结构化结果及媒体 `resource_link`，包含视频、字幕、预览图和当前画面文案。配置了导出目录的 Codex/Hermes 自动保存附件；其他宿主使用可访问的媒体链接。仍不声明 `ui.resourceUri` 或 HTML 资源。
5. 用户继续使用宿主原有输入框修改；需要预览或精修时自行点击链接。Agent 不调用浏览器打开工具，也不要求用户切到网页聊天。工作台首次打开仍需连接自己的工作空间。
6. 从工作台返回或切换 Agent 后，先 `workspace_snapshot {projectId}`，再用当前 `baseRevisionId` 提交修改。旧版本冲突应重新读取，不覆盖更新。

需要手动保存或重试附件下载时调用 `workspace_export {jobId}`，将结果保存到本机 `.data/host-media/<客户端>/` 或指定目录；它可重试保存，不重渲染。每个导出/导入文件上限 100 MiB。仅通过认证的后端资产端点读取输出，下载时不跟随供应商或返回值里的任意 URL。导出目录权限 0700、文件 0600。

生成仍要求供应商启用、足够预算和用户请求范围；计费由内部提交协议处理，不额外要求每步询价确认。自有供应商不要求官方额度。安装器默认零付费预算不会让普通剪辑误触发购买。本地演示使用合成素材，不发起付费生成。

## 手机、远程与能力边界

手机用户可通过 Hermes 的聊天渠道完成普通创作；手动剪辑时点击工作台链接。手机和远程工作台需要可达的 HTTPS `PUBLIC_BASE_URL`，不是本机 `127.0.0.1`。浏览器工作台首次仍需同账户 Key 建立会话；公众账号/OAuth 尚未实现。

Streamable HTTP 端点为 `/mcp`，用 Bearer Key 认证。HTTP 与 stdio 都不声明嵌入式 UI。HTTP 不暴露客户端本地文件读写工具；需要明确下载到本机的客户端应使用 stdio 桥接。后端的 `PUBLIC_BASE_URL` 决定返回的工作台地址。

双模式契约见 [对话与工作台](../../docs/architecture/dual-mode.md)。宿主自身的工具调用详情、权限确认和链接打开方式仍由客户端决定；本项目不再请求 MCP Apps 界面。

## 官方依据

- [Codex MCP 配置与连接](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Claude Desktop 本地 MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Hermes MCP 配置](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/mcp-config-reference.md)
- [Hermes 原生媒体路径处理](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/base.py)


### Windows native preview

The 0.1.31 PowerShell installer is implemented locally but unpublished and not validated on Windows. It targets Windows 10/11 x64. It keeps Codex under `%USERPROFILE%\.codex`, Claude Code at `%USERPROFILE%\.claude.json`, and Claude Desktop at `%APPDATA%\Claude\claude_desktop_config.json`. If Desktop's Edit Config opens a different location, set `RIKOKO_CLAUDE_DESKTOP_CONFIG` to that absolute file path. Existing entries are preserved and conflicting rikoko entries are rejected. See [Windows installation preview](../../docs/architecture/installation.md#windows-原生安装预览0131).

The public WSL installer configures clients inside WSL; it does not register a Windows desktop client. Native Windows downloads must not be advertised until the matching release is published.
