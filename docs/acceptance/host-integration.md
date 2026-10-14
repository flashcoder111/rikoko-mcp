> 当前默认交互见[2026-10-14 对话交付验收](conversation-delivery-2026-10-14.md)。

# Codex / Hermes / Claude 原对话接入验收

> 2026-10-12 交互已调整为“原 Agent 对话 + 工作台链接”，不再注册或自动显示 MCP Apps 卡片，也不自动交付附件。当前说明见[原对话交互验收](native-conversation.md)。下文保留 2026-10-11 的历史验收结果，其中卡片相关描述不代表当前行为。

日期：2026-10-11。目标是以宿主原对话为默认入口，工作台按需打开。以下区分已安装配置、真实协议进程、实际客户端界面，不能互相代替。

## 实施结果

- 同一后端的 stdio 桥接支持 Codex、Hermes、Claude Desktop、Claude Code 四种启动配置；固定当前 Node 绝对路径，避免桌面 PATH 差异。
- macOS 按客户端签发独立 read/write Key，预算为 0，保存 Keychain；配置/测试报告不含凭据。安装前协议检查，已有配置备份与保留，同名不同工程不覆盖。
- MCP instructions 与 create/resume prompts 要求在原对话创作、返回媒体、修改前读取最新版本。宿主配置不暴露 Key 管理工具。
- 本地附件导入使用专用目录、真实字节、SHA256、100 MiB 限制及媒体校验；原生导出使用认证的自有资产端点，拒绝跨域重定向，不把返回 URL 当作任意下载目标。
- 已完成结果自动返回本机文件路径；Codex 媒体语法、Hermes 当前会话 MEDIA 指令与 Claude Apps/文件路径分别适配。
- MCP Apps 卡片支持播放器、同步最新版本、原对话续改、可选工作台。宿主不能发送消息时展示可复制请求。旧轮询结果不会覆盖新工具结果。

## 客户端矩阵

| 客户端                  | 本机配置                                          | 真实 stdio 协议         | 厂商客户端中的完整对话验收                                           |
| ----------------------- | ------------------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| Codex CLI 0.154.0 / app | 已安装；`codex mcp get hypit --json` 确认 enabled | 通过                    | 当前任务工具尚未重载；自动化禁止操作 Codex 自身 UI，需手动激活后验收 |
| Claude Desktop          | 已安装，保留 pencil 配置                          | 通过                    | 已打开应用，停在登录页；等待用户自行登录                             |
| Claude Code             | 已写用户配置，保留原设置                          | 通过                    | 本机未发现 Claude Code CLI，未做 CLI 对话验收                        |
| Hermes                  | 本机未发现安装或配置，未写入虚构的安装位置        | 通过本地 Hermes profile | 实际运行位置待提供；未验证外部聊天平台附件发送                       |

Hermes profile 测试在本机 SDK 客户端启动连接器，临时继承测试所用 Codex Key，并不等于实际 Hermes 已安装。三个已安装客户端各有自己的 Keychain 凭据，原配置均备份后更新。所有测试使用相同后端账户，因此能读取同一作品。

## 可复现证据

运行服务后执行：

```sh
pnpm clients doctor codex
pnpm clients doctor claude-desktop
pnpm clients doctor claude-code
pnpm exec tsx scripts/verify-hosts.ts
pnpm test:coverage
pnpm build
pnpm format:check
```

`scripts/verify-hosts.ts` 是当前 macOS 验收脚本，依赖上述已安装 Keychain 凭据、已下载的 fal 官方公开 H3 样片及正在运行的本地后端。它不应被当作任意干净机器的一键验收；通用连接检查使用 doctor。

本次协议流程：Codex profile 导入 H3 公开样片并创建作品 → Claude profile 修改同一作品字幕 → Hermes profile 读取相同最新版本 → 真实 FFmpeg 输出 → 三个 profile 各自取得本地 MP4。Claude Code profile 另外检查工具、prompt、资源和 capabilities。

- 每个 profile 发现 27 个工具、2 个 prompt 和结果卡片资源。
- 项目：`7605698a-ae04-452b-a3a8-bdbbed9fe64a`。
- 最新版本：`be90631e-b659-4c77-85f8-005b393ff12f`。
- 输出任务：`691e2a33-53cd-49c8-a280-c1360b4b7568`。
- ffprobe：3.000 秒、768 × 432、H.264 视频与 AAC 音轨。
- 原用户作品未被此流程修改。fixture 单独持久化，重复验证读取同一作品。
- 记录：`artifacts/host-integration/verification.json`、`protocol.log`、`tests.log`、`build.log`。
- 最终自动检查：17 个测试文件、125 项 TypeScript 测试通过；构建、类型与格式检查通过。覆盖率：语句 92.38%、分支 84.93%、函数 93.35%、行 93.07%。覆盖率配置针对 core/server 等后端逻辑，不代表完整前端覆盖。
- 卡片 3 项 DOM + mocked Apps bridge 测试覆盖最新版本同步、原对话续改/拒绝回退、旧轮询迟到；这些不能证明厂商 iframe、CSP、网络或登录态已验收。

## 尚待实际环境验证

Codex 重载 MCP、Claude Desktop 登录、Hermes 实际主机与消息平台确认后，才能完成三个产品中的用户旅程。Claude Code 的终端文件交付与 Claude Desktop 的内联界面属于不同能力。普通 MCP 调用可用不保证所有客户端都呈现相同卡片。

当前后端只监听本机，手机/远程工作台仍需 HTTPS 可达部署与身份连接。没有运行付费 H3 生成、公众账号/OAuth 或生产发布。H3 官方样片剪辑不是新生成的供应商实测。安装、媒体目录和远程配置详见 [客户端说明](../../examples/clients/README.md)。
