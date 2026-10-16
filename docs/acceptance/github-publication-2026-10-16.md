# GitHub 公开发布与一行安装验收

日期：2026-10-16（北京时间）。

## 公开入口

- 仓库：<https://github.com/flashcoder111/video-workbench>，已设为 public；不带 GitHub 登录凭据的 API 请求确认 `private=false`。
- Release：<https://github.com/flashcoder111/video-workbench/releases/tag/v0.1.12>。
- 版本提交：`fb3eca972a1d3261341acdb72a4ba8649f98f308`，tag 与源码快照一致。

```sh
curl -fsSL https://github.com/flashcoder111/video-workbench/releases/latest/download/install.sh | bash
```

GitHub Release 包含 `install.sh`、源码压缩包、`.sha256` 和 `release.json`。压缩包 SHA-256 为 `e46960dad8dbba485f174bc31bf5973e04d26c3c7ef48714444535ddf7969391`。

## 安装行为

GitHub 发行默认使用本地编辑、内置模板和 FFmpeg 渲染，配置为 `mode=custom`、空供应商列表和关闭外部模板。无需官方域名或用户 Key；安装不购买模型调用。AI 生成需自行配置供应商。

安装器自动准备依赖、校验版本包、注册检测到的 Codex/Claude 客户端、启动回环服务并导出免费样片。没有客户端也能完成本地安装；可用 `--client codex`、`--client claude-code` 或 macOS 的 `--client claude-desktop` 指定客户端。

## 已完成验证

| 检查 | 结果 |
| --- | --- |
| 独立源码快照 | 331 个 Git 文件与发布提交逐项匹配；未采用工作区中的其他未提交功能 |
| 构建 | TypeScript 类型检查及两个前端构建通过 |
| TypeScript 测试 | 51 个文件、343 项全部通过 |
| Python 媒体测试 | 5 项全部通过 |
| 安装配置模块覆盖率 | 语句 93.58%、分支 91.89%、函数 100%、行 95.83% |
| 无客户端安装 | 使用发行压缩包、真实依赖安装与构建，完成免费样片；下载传输使用本地 fixture |
| 公开安装命令 | 从 GitHub 公开链接匿名下载安装器和源码包，SHA-256 校验、依赖安装、构建及免费 FFmpeg 样片通过 |
| MCP | 使用临时 Codex/Claude Code 配置启动真实 stdio，三条并发连接均成功发现工具及读取 capabilities |
| 重复安装 | 同一公开命令重跑成功，原宿主设置与其他 MCP 配置保持一致 |
| 服务管理 | 停止后由 MCP 自动启动、启动器 restart/stop 均通过 |
| 凭据 | 私有配置权限 0600；未使用共享 Key；付费调用为零 |

GitHub Linux CI：[Validate #38864386300](https://github.com/flashcoder111/video-workbench/actions/runs/38864386300)。依赖安装和构建已通过，测试仍在运行；上表的完整测试结果来自本机独立源码快照。

发布前使用 Gitleaks 8.30.1 检查全部 Git 历史、源码快照和发行目录。历史扫描的四处匹配经核实为三处 SHA-256 文件哈希及一处 UI fixture 固定测试凭据；发行目录的三处匹配均为清单中的 SHA-256 哈希，未发现实际服务凭据。

独立检查发现已提交的分析设置测试对应的界面和 capabilities 接线仍在未提交工作中，本次只补齐该接线。其他音频、模型和命令菜单改动继续保留在原工作区。本次沿用已有 `main` 分支，创建发布 tag，未新建分支、改写历史或改动平台仓库。

## 范围与证据

本机公开安装验证为 macOS arm64，复用了已有 Node、uv、FFmpeg 和包缓存；未完成完全无依赖新机器、Linux/WSL 安装器或原生 Windows 的实机验收。真实 stdio 协议验收不等于厂商客户端 UI 的完整旅程。本次没有购买模型生成或验证官方 API 收费。

本地证据位于被 Git 忽略的 `artifacts/publication-2026-10-16/`：`public-install-results.json`、公开首次/重复安装日志、MCP 日志、独立构建与测试日志、覆盖率日志以及脱敏的扫描报告。临时安装使用独立宿主配置，未修改开发者实际客户端配置。
