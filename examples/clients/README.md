# Codex / Hermes / Claude 对话接入

默认使用宿主原有对话：Agent 理解要求、调用 MCP、返回媒体、继续修改。网页 `/` 保留独立使用和开发调试；用户选择手动剪辑时才打开 `/workspace`。三个客户端共享同一后端账户下的项目、素材、任务与版本，不复制对话或另建项目。

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

macOS 安装器为每端签发 read/write、付费预算为 0 的独立 Key，保存于系统 Keychain。配置只写 Keychain 服务名称，不写凭据。已有配置先备份、再原子更新，其他 MCP 保留；同名 `hypit` 指向不同工程时拒绝覆盖。重复安装同一配置不追加条目。

| 客户端                                    | 配置位置                                                          | 激活方式                                      |
| ----------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Codex app / CLI                           | `~/.codex/config.toml`，`mcp_servers.hypit`                       | 在 MCP 设置中重启连接，或重新启动客户端       |
| Claude Desktop（本安装器支持 macOS 路径） | `~/Library/Application Support/Claude/claude_desktop_config.json` | 登录后重启应用，在开发者/连接器设置确认 Hypit |
| Claude Code                               | `~/.claude.json`，`mcpServers.hypit`                              | 重启或在 `/mcp` 检查连接                      |
| Hermes                                    | `~/.hermes/config.yaml`，`mcp_servers.hypit`                      | `/reload-mcp` 或重启 Hermes                   |

连接器使用当前 Node 的绝对路径，不依赖桌面应用的 shell PATH。升级或移动 Node/仓库后，要检查原配置路径。安装器不会自动覆盖不同路径的已有条目。

```sh
pnpm clients doctor codex
pnpm clients doctor claude-desktop
pnpm clients doctor claude-code
pnpm clients doctor hermes
```

doctor 启动真实 stdio 子进程，检查初始化、工具发现、capabilities 与卡片资源声明，不购买生成任务，也不代替宿主界面验收。查看可移植模板：`pnpm clients config <客户端>`。不要把当前 Mac 的路径直接复制到远程 Hermes。

## Hermes 运行在服务器时

在 Hermes 所在机器部署连接器及 Node 依赖。后端可同机运行，也可设置 `VIDEOWORKBENCH_URL=https://你的服务域名`。通过该机器的秘密环境注入 `VIDEOWORKBENCH_API_KEY`；非 macOS 安装器不会持久化明文凭据。环境变量必须由启动 Hermes 的进程继承；Hermes 的秘密环境文件可使用其官方 `${VAR}` / `${env:VAR}` 机制引用，勿在共享配置中填入真实 Key。

本地 stdio 桥接将结果写入 Hermes 主机的 `VIDEOWORKBENCH_EXPORT_DIR`，模型在**当前会话**使用 `MEDIA:/绝对路径/video.mp4` 返回附件。不得选择其他收件人。配置 `HERMES_MEDIA_DELIVERY_STRICT=1` 的部署需将这个导出目录加入 `HERMES_MEDIA_ALLOW_DIRS`；Docker 部署还要保证 Agent 与网关能访问同一媒体路径。Telegram、飞书等平台的实际发送限制仍需逐平台验证。

## 对话中的使用

可直接说：“使用 Hypit，根据这些素材做一段视频，结果留在当前对话。”也提供 `hypit_create`、`hypit_resume` 两个 MCP prompt。

1. `capabilities` 查看真实可用能力。宿主 Agent 直接准备 composition 或编辑动作；`workspace_plan` 可选，无需额外配置网页创作模型。
2. 本地附件通过 `asset_import_file` 上传实际文件。默认仅允许工程的 `media-inbox/` 和 `artifacts/`；需传素材许可及 `rightsConfirmed: true`。自有附件放入 `media-inbox/`，或由操作者用 `VIDEOWORKBENCH_IMPORT_ROOTS` JSON 数组配置专用附件目录。连接器不能自动读取宿主未提供的附件，也不开放整个用户主目录。
3. `workspace_commit` 创建/编辑，使用稳定 `idempotencyKey`；`workspace_result` 查询并交付。重试查询不再次提交生成。
4. stdio 连接器将已完成媒体保存到本机 `.data/host-media/<客户端>/`，返回 `localPath`、MIME 和限时 URL。Codex 可用本地媒体渲染；Hermes 可用当前会话的 MEDIA 附件；Claude 在支持 MCP Apps 的界面可加载内联播放器。Claude Code/不支持卡片的界面保留文件和链接路径，不能承诺终端内播放视频。
5. 卡片提供进度、媒体、同步最新版本、继续修改和可选工作台。继续修改用 Apps SDK `sendMessage` 交回原对话；宿主不支持时提供可复制文字，不假装已执行。
6. 从工作台返回或切换 Agent 后，先 `workspace_snapshot {projectId}`，再用当前 `baseRevisionId` 提交修改。旧版本冲突应重新读取，不覆盖更新。

`workspace_export {jobId}` 可重试本地附件保存，不重渲染。每个导出/导入文件上限 100 MiB。仅通过认证的后端资产端点读取输出，下载时不跟随供应商或返回值里的任意 URL。导出目录权限 0700、文件 0600。

付费生成仍要求报价、用户确认价格、供应商启用和足够预算。自有供应商不要求官方额度。安装器默认零付费预算不会让普通剪辑误触发购买。本地演示使用合成素材，不发起付费生成。

## 手机、远程与能力边界

手机用户可通过 Hermes 的聊天渠道完成普通创作；手动剪辑时使用工作台。手机工作台及远程卡片需要可达的 HTTPS `PUBLIC_BASE_URL`，不是本机 `127.0.0.1`。浏览器工作台首次仍需同账户 Key 建立会话；公众账号/OAuth 尚未实现。

Streamable HTTP 端点为 `/mcp`，用 Bearer Key 认证。它不暴露客户端本地文件读写工具；需要本机附件交付的客户端应使用 stdio 桥接。后端使用反向代理时，桥接进程的 `PUBLIC_BASE_URL` 应与后端一致，以设置卡片媒体 CSP。

双模式契约见 [对话与工作台](../../docs/architecture/dual-mode.md)。支持标准 MCP 工具不等于每个宿主具有相同的内联 UI 能力，实际界面需按所用客户端版本验证。

## 官方依据

- [Codex MCP 配置与连接](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Claude Desktop 本地 MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Hermes MCP 配置](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/mcp-config-reference.md)
- [Hermes 原生媒体路径处理](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/base.py)
- [MCP Apps 宿主能力](https://modelcontextprotocol.io/extensions/apps/overview)
