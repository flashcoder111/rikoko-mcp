# 一行安装与官方 API 默认接入

默认用户路径：运行官网给出的一行命令 → 下载并校验公开源码 → 准备依赖 → 预设官方 API/模板源 → 注册已安装的 Codex/Claude 客户端 → 导出一段免费样片。随后重载客户端 MCP 即可使用。无需另开终端保持 `pnpm dev` 运行。

当前状态：安装和发行代码已在本地实现；正式下载域名、官方 API 域名和模板域名尚未配置，因此还没有可向公众提供的真实安装链接。示例地址会被发行工具拒绝。

## 用户操作

官网的一行命令下载版本对应的 `install.sh` 并交给 Bash 执行；该脚本内置本版本源码下载地址、SHA-256、官方 API 地址与模板源。用户无需填写 URL，也不在安装流程中选择供应商。

默认识别现有 Codex、Claude Code 配置目录；macOS 也识别 Claude Desktop。可在命令末尾使用 `bash -s -- --client codex` 或 `bash -s -- --client claude-code` 指定目标。安装器保留其他 MCP 配置；遇到同名但不同来源的 `hypit` 条目时停止，不覆盖它。

首次交互安装可输入自己的官方用户 Key，输入不回显，也不进入命令历史；回车可跳过绑定，先使用本地编辑。Key 只向内置的官方 API origin 请求 `/v1/usage` 验证，禁止重定向；不会发起付费生成。没有公开注册/设备授权接口时，安装器不能凭空创建官方账户，官方地址已配置也不等于用户已经登录。

非交互环境可通过宿主的秘密环境注入 `HYPIT_OFFICIAL_KEY`；不要把它明文拼进分享的安装命令。无 Key 的非交互安装仍可完成本地流程，最终明确提示尚未绑定。重新运行同版本安装保留 config 与凭据，不覆盖已有自有供应商设置。

## 本地目录与生命周期

默认目录为 `${XDG_DATA_HOME:-$HOME/.local/share}/video-workbench`：

- `app/`：本版本公开源码和应用依赖。
- `runtime/`：必要时安装的 Node 与 uv；Python 由 uv 在其标准用户目录管理，应用依赖放在 `app/python/.venv`。
- `config/models.json`：默认 `mode=official`，预设官方生成与模板地址。
- `config/credentials.json`：本机私有 Key 映射，权限 0600；不放进源码和宿主 MCP 配置。
- `data/`：项目、媒体、每个 MCP 客户端独立的本地访问 Key，以及服务日志。
- `installation.json`：本机绝对路径、专用回环端口和服务实例标识，权限 0600。

MCP 子进程先检查自己的本地服务，缺失时在后台启动；关闭对话后服务保留，重启电脑后由下次 MCP 连接再次启动。服务只监听 `127.0.0.1`。多个客户端同时启动时先争取端口，再打开数据库；端口被其他服务占用时停止，不向其发送凭据。默认不注册系统开机服务。

改动模型配置后，使用安装目录的服务启动器（无需系统 PATH 中存在 Node）：

```sh
~/.local/share/video-workbench/service restart
```

同一命令可使用 `start`、`stop`。重启只停止实例标识与 PID 都匹配的本项目服务。停止前应等待进行中的创作任务完成。

## 自有供应商

自行把 `config/models.json` 改为自有模式，结构参考 `app/config/models.custom.example.json`；保持需要的官方模板源。把每个 `keyEnv` 对应的 Key 写入私有 `config/credentials.json`，然后重启服务。例如：

```json
{"MY_FAL_KEY": "替换为自己的供应商凭据"}
```

启动器只加载当前 config 引用的凭据。自有模式不加载官方用户 Key，不回退到官方付费通道。官方模板更新仍独立、手动执行。

自有模式仍保留已有供应商启用开关、费用上限与本地 Key 预算检查；填写 Key 本身不会提高预算。安装生成的本地客户端 Key 默认预算为零，正式使用自有付费模型前还需由本地管理员配置相应 Key 的预算。

## 环境支持与边界

脚本面向 macOS 与 Linux/WSL（arm64/x64），原生 Windows PowerShell 安装器尚未实现。Node 22.19+ 可复用；缺失时从 Node 官方 HTTPS 地址安装独立运行时并校验 SHA-256。uv 缺失时使用官方指定版本安装器，并通过锁文件准备 uv 管理的 Python 3.12 环境，避免依赖系统 Python 的完整性。不会修改 shell 启动文件。

FFmpeg/ffprobe 优先复用。缺失时使用 Homebrew、apt 或 dnf；系统软件安装可能需要管理员密码或系统开发工具。安装器不能绕过系统授权。FFmpeg 必须支持 libx264，最后的真实样片会检测此能力；某些发行版的 `ffmpeg-free` 不包含它，需要配置该发行版的完整 FFmpeg。Linux 的系统配音与中文字体也需要相应系统包。

同版本重跑可恢复安装；不同版本不会直接覆盖已有安装目录，升级迁移需另行安排。当前发行工具只生成本地文件，不上传、不创建 Git 仓库或分支、不部署 API。

## 运营侧生成发行物

复制 `config/distribution.example.json` 到 `config/distribution.local.json`，填写已准备好的真实 `downloadBaseUrl`、`apiUrl` 和 `templateUrl`，然后：

```sh
pnpm release:installer config/distribution.local.json
```

生成目录包含公开源码、源码压缩包、校验文件、`release.json` 与内置地址的 `install.sh`，并输出发布后的用户命令。只将这些经过审阅的发行物放到对应下载地址。构建命令不代表已经发布，也不会验证生产 API 是否上线。

依赖来源：[Node 官方下载](https://nodejs.org/en/download)、[uv 安装](https://docs.astral.sh/uv/getting-started/installation/)、[FFmpeg 下载说明](https://www.ffmpeg.org/download.html)。
