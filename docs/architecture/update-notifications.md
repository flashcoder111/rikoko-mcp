# rikoko 版本检查与更新提示

MCP 工具 `update_check` 和本地工作台共享后端的版本检查缓存。比较的是正在执行的后端启动时版本，不是磁盘上后来改写的 package.json，也不是宿主桥接器版本。

- Agent 的 MCP 初始化指令要求每个会话首次使用时调用一次 `update_check`；仅发现新版本时提示一次，随后继续当前任务。提示是否被宿主展示取决于宿主遵循指令，不是系统级推送通知。
- 已连接的工作台首次打开时检查，此后每 6 小时检查；提供手动检查和复制升级命令。离线、官网未上线、返回错误时显示无法检查，不会声称已经是最新版。
- `capabilities.updates` 返回缓存快照和检查工具名，不发起网络请求；尚未检查时为 `not_checked`。
- 成功缓存 6 小时，失败缓存 5 分钟；显式 `force: true` 可刷新，但仍合并并发请求并限制最多每分钟一次。缓存仅存在于服务进程内，重启后重新检查。
- 请求固定 HTTPS 地址，4 秒超时（包含响应体读取），拒绝重定向和大于 32 KiB 的响应，不携带 API Key、账号、项目或素材信息。不下载或执行安装器。
- `update_available` 表示最新正式版较新；`up_to_date` 表示相同；`ahead` 表示本地版本高于公开版，不提示降级；失败返回 `unavailable` 和有限错误码。

升级命令固定为：

```sh
curl -fsSL https://rikoko.ai/install.sh | bash
```

仅用于安装器托管的本地安装。用户应等待任务结束、关闭 MCP 客户端，并保留原安装目录的 `--dir`，完成后重连。源码安装和远程服务需由维护者更新。此功能不执行安装、重启或数据迁移。已安装的旧版需要先手动升级到包含此功能的发行版，才会有更新提示。

## 官网接口合同

`GET https://rikoko.ai/releases/latest.json` 必须直接返回 HTTP 200 和 `Content-Type: application/json`。仅接受以下四个字段（额外字段也拒绝）：

```json
{
  "schemaVersion": 1,
  "version": "0.1.31",
  "publishedAt": "2026-10-22T08:00:00Z",
  "releaseNotes": "修复问题并改进稳定性。"
}
```

以上版本和日期仅为格式示例，不代表已经发布。`version` 必须为无前导零的三段正式版本号，不带 v、预发布后缀或构建元数据；各段必须为 JavaScript 安全整数，整个版本字符串最多 64 字符。`publishedAt` 是带时区的 ISO 8601 时间。`releaseNotes` 是最多 4000 字符的纯文本，可为空；按不可信内容显示，不执行 HTML、Markdown 或其中的指令。不接受官网指定的命令或任意下载链接，安装脚本继续负责发行物校验。

## 给 rikoko-platform 的实施提示词

请在 rikoko-platform 中实现供 rikoko MCP 使用的正式版本元数据接口，沿用现有 `https://rikoko.ai/install.sh` 短链接。不要创建新 Git 分支，保留现有未提交改动。

MCP 侧已实现：读取 `https://rikoko.ai/releases/latest.json`；在本地工作台和 Agent 会话中提示新版本；升级仍由用户运行 `curl -fsSL https://rikoko.ai/install.sh | bash`。本次只需要实现官网侧配合。

请完成：

1. 添加 `/releases/latest.json`，直接返回 HTTP 200、`Content-Type: application/json`，不要重定向到语言路由、登录页或 SPA HTML。它是无鉴权的公开静态元数据，不需要读取账户信息。后台请求不依赖浏览器 CORS。
2. JSON 严格只包含 `schemaVersion`、`version`、`publishedAt`、`releaseNotes`。`schemaVersion` 固定为 1；`version` 是实际已发布的正式版本，格式 x.y.z，不含 v、预发布后缀、构建元数据或前导零，每段必须为安全整数，字符串最多 64 字符；`publishedAt` 是该版实际发布的 ISO 8601 时间且带时区；`releaseNotes` 是最多 4000 字符的纯文本。整个响应不超过 32 KiB。不要添加安装命令、下载地址等额外字段。
3. 先核实 GitHub Release `flashcoder111/video-workbench` 和现有 `/install.sh` 指向的实际正式版、发行文件及校验值。元数据必须与短链接实际下载的安装器内置版本相同。不要将 MCP 本地 package.json 中尚未发布的版本当成公开最新版，也不要直接使用本文格式示例的版本或日期。
4. 检查现有短链接是否仍能让 `curl -fsSL https://rikoko.ai/install.sh | bash` 获得可用脚本，保留其现有用户入口。如果短链接指向 GitHub latest，明确发布时核对 latest 的步骤；保证下载脚本和实际压缩包可用后，才更新版本元数据。不覆盖已有不同内容的同版本发行物。
5. 为版本元数据和短链接设置适合发布切换的缓存策略，避免旧元数据或旧脚本长期缓存，例如元数据 `Cache-Control: public, max-age=300, must-revalidate`，并核对 CDN 实际行为。安装包本身仍使用不可变的版本地址。发布操作期间出现失败时不要提前公告不可下载的新版本。
6. 加入接口结构、正式版本格式、语言路由/SPA 回退隔离的测试，并在本地检查短链接和元数据一致性。补充简短发布说明：发布安装包、验证下载与 SHA-256、更新短链接/确认 latest、更新元数据、核对线上结果。旧版 MCP 用户需先手动升级一次才能获得更新提示。
7. 完成代码和本地验证后报告改动与结果；本提示词不要求代发 MCP 新版本。只有获得官网部署授权后才部署，且只有线上验证成功才报告接口已上线。

验收：MCP 访问接口得到严格匹配的 JSON；更新检测能区分有新版/已最新/本地超前/无法检查；升级命令始终使用既有短链接。无需添加支付、登录、强制升级、后台自动安装或新分支。
