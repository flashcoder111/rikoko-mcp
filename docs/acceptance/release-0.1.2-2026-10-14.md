# rikoko 0.1.2 提交与测试环境部署

日期：2026-10-14。用户授权提交并部署；两个仓库均沿用已有 `main`，未创建分支。

## 发布内容与代码

- MCP 功能提交：`6eaf901033dc20c4a06060516dba8cd4b258c43e`，已推送 `origin/main`。包含素材追问、请求恢复、原对话媒体与文字交付，以及已验收的模板、素材库和安装配置更新；此前 18 个本地提交一并推送。
- 平台运行时升级提交：`0ebfb4900e0f3c26ebadcbf131b6f580b5a32fbb`，位于独立的 `rikoko-platform` 仓库。该仓库没有配置远程，已完成本地提交并用该提交部署服务器。
- 平台使用固定版本 `vendor/rikoko-0.1.2.tgz`，未跨仓库复制共享源文件。包内 143 个文件，SHA-256：`7b6ae1b2ae8a685a50edf414d7a3f5ef7bf8d6e2bf8b34375b8aea049df43087`。

## 检查结果

- MCP 本地完整测试：41 个文件、289 项通过；构建、公共源码导出、4 项 Python 媒体测试通过。
- [GitHub CI：功能提交 6eaf901](https://github.com/flashcoder111/video-workbench/actions/runs/38548354164) 全部通过，包含冻结锁文件安装、构建、TypeScript 测试、Python 媒体测试和公共源码导出。
- 平台运行时校验、类型检查和构建通过；23 项云端测试及 8 项官网测试通过。官网构建仍有原有的大 chunk 提示。
- 本机原有 4310 后端已正常停止、备份数据库并以新代码重启，保留原配置与 32 个已完成任务。新建一个明确标记的部署验收请求，验证 `waiting_input → ready`；没有创建生成或渲染任务。
- 使用实际 Codex 配置建立新的 stdio 连接：48 个工具可用，包含 `workspace_request_save/get`；已完成任务成功导出 MP4、SRT 和 PNG。视频经 ffprobe 检查为 3 秒、768×432、H.264/AAC。没有新增付费调用。

## 云端实际部署

- 测试入口：`https://47.237.147.98`；`/health` 返回 200。此地址是官方云 API 与模板发布后台，不是本地 Studio 或公开安装器站点。
- 发布目录：`/opt/video-workbench-cloud/releases/20261014T101800Z/`。
- 应用镜像：`video-workbench-cloud:20261014-101800`。
- 镜像 ID：`sha256:9b64126aecf747a5f9ea595ed5b2bdd16f7ac06d27e67a9fc33772f1980212b2`。
- 容器内确认依赖版本为 `rikoko@0.1.2`，容器健康检查为 healthy。
- 公开模板目录保留 1 个已发布测试模板；ETag 返回 304；已有 R2 素材下载的长度和 SHA-256 与目录一致。
- 未授权发布/用量/模型接口返回 401，非允许来源返回 403。可用付费模型为 0，账户生成扣款和预留均为 0，付费供应商保持关闭。
- 只更新云应用容器；数据库和 Caddy 的启动时间未变，旧网关代理未修改。没有使用 `--remove-orphans`。

## 备份与回滚

云端部署前数据库备份为 `/opt/video-workbench-cloud/backups/workbench_cloud-20261014-before-0.1.2.dump`，17,450 字节；`pg_restore --list` 校验通过，未执行数据库恢复演练。旧镜像 `video-workbench-cloud:20261012-083303` 和发布目录内的 `compose.application.before.json` 保留。

需要回滚应用时，将该备份 Compose 恢复为 `config/compose.application.json`，执行 `docker compose -f /opt/video-workbench-cloud/config/compose.application.json up -d --no-deps cloud`；不要删除数据库容器或卷。应用升级失败时的部署脚本会恢复旧 Compose 并重新启动旧镜像，本次未触发回滚。

本机数据库备份位于 `.data/releases/20261014-0.1.2/db-before.tar.gz`，5,079,040 字节，权限 0600。验证结果与交付附件位于同目录，均不提交 Git。

## 生效边界

后端和新建 MCP 连接已使用新版本；已经运行的 Agent 连接需要重连 rikoko，刷新缓存的工具清单与 instructions。没有重启用户的 Codex 应用或工作会话。

本次完成既有测试环境更新和本机运行时激活；未发布官网、公开安装器、正式域名或支付功能，未启用或采购 MiniMax 等付费生成。平台部署证据保存于 `rikoko-platform/artifacts/releases/20261014-0.1.2/` 和服务器发布目录。
