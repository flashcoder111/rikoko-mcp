# Hermes 附件导入修复（2026-10-19）

## 原因与修改

Hermes 桌面上传的图片位于 macOS `~/Library/Application Support/Hermes/composer-images/`，原安装配置仅包含工程 `artifacts/` 和 `media-inbox/`。因此图片能在聊天中显示，却在 rikoko 上传之前被目录白名单拒绝。

- macOS Hermes 安装配置增加专用 `composer-images/`，使用目标客户端的 home；其他客户端及 Linux/远程宿主不自动加入此路径。
- 重新安装可迁移仅含两个默认工程目录的旧 Hermes 配置。命令、参数及其他环境变量必须匹配；保留注释、超时、其他 MCP 和凭据设置。自定义及主动收窄的白名单不自动扩大。
- 尚未创建的配置目录不会阻断其他可用目录。继续按真实路径检查边界，阻止越界文件、相似前缀目录、逃逸软链接、非媒体文件及超过大小限制的文件。
- 工具描述列出配置的导入目录；目录拒绝说明如何复制所选素材或调整专用附件目录并重载；附件路径失效返回重新附加的提示。
- doctor 优先读取已安装的启动配置，输出 `configSource` 和 `importRoots`；未安装时才明确使用生成配置。

## 验证

- `pnpm exec vitest run tests/host-attachments.test.ts tests/host-integration.test.ts tests/installation.test.ts tests/mcp-native-chat.test.ts`：4 个文件、32 项测试通过。
- `pnpm typecheck`：通过。
- 本次 TypeScript 文件的 Prettier 检查及 `git diff --check`：通过。
- 新增测试通过 MCP 内存传输调用真实文件导入代码，检查图片字节交给上传接口；后端 HTTP 使用测试替身。拒绝导入时不会发出上传请求。
- 本机 `~/.hermes/config.yaml` 已备份并只更新导入目录；读回确认其他配置语义未变，配置与备份权限为 0600。
- 截图对应的原图片通过更新后的路径校验。
- `pnpm clients doctor hermes` 使用本机已安装配置建立真实 stdio 连接，工具发现和 capabilities 成功，返回三个预期导入目录。

本次未重新上传用户图片、未执行付费任务、未发布公共运行时、未提交或推送。运行中的 Hermes 尚需 `/reload-mcp` 或重启以加载新配置；doctor 的新连接不代表原聊天进程已重载，也不代表已完成 Hermes 界面中的上传验收。
