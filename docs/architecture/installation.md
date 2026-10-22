# rikoko 一行安装

在 macOS 或 Linux/WSL 终端运行：

```sh
curl -fsSL https://github.com/flashcoder111/rikoko-mcp/releases/latest/download/install.sh | bash
```

安装器下载并校验 GitHub Release 的固定版本包，准备依赖、注册检测到的 Codex/Claude 客户端、启动本地服务并导出一段免费样片。随后重载客户端 MCP 即可使用，无需另开终端保持 `pnpm dev` 运行。没有支持的客户端时仍会完成本地安装。

TikTok 短视频下载也在用户本机执行。安装器通过同一份 Python 锁文件准备 yt-dlp/curl_cffi；旧环境首次使用时由本地服务自动检查并补齐，用户无需源码或手动安装下载工具。准备、下载、校验和入库状态通过现有任务接口返回。仅支持单视频及 vm/vt/t 分享链接；平台登录要求、请求拦截或页面变化仍可能导致下载失败，工具会返回对应原因。

下载复用用户配置的 HTTP(S) 代理环境变量，并自动检测 macOS 系统网页代理。需要覆盖时，可在启动 rikoko 的环境中设置 `RIKOKO_DOWNLOAD_PROXY`（例如 `http://127.0.0.1:7890`），重启本地服务后生效。下载器不读取浏览器 Cookie 或用户的 yt-dlp 配置，代理凭据不进入模型输入或任务错误。下载流量逐个校验目标公网地址；代理软件返回 198.18/15 合成地址时，通过所选代理向 Cloudflare DNS over HTTPS 查询真实公网地址后固定连接，不直接放行合成地址。最终视频限制为 100 MiB，下载执行限时三分钟，依赖准备限时五分钟。对外监听或使用远程数据库的实例不启用此本地下载入口。

GitHub 公开发行默认只使用本地编辑、内置模板与 FFmpeg 渲染，不要求官方 API 域名或用户 Key。AI 生成需自行配置供应商。官方 API 与模板源可在后续有实际服务地址的发行物中预设；示例域名仍会被发行工具拒绝。

## 用户操作

GitHub 的一行命令下载最新正式 Release 对应的 `install.sh` 并交给 Bash 执行；该脚本内置本版本源码下载地址和 SHA-256。用户无需填写 URL。只有发行物明确配置了官方地址时，安装器才提示绑定官方用户 Key。

默认识别现有 Codex、Claude Code 配置目录；macOS 也识别 Claude Desktop。可在命令末尾使用 `bash -s -- --client codex` 或 `bash -s -- --client claude-code` 指定目标。安装器以 `rikoko` 注册 MCP，通过 `rikoko_guide` 提供导演指南，不再安装独立 Skill；保留其他 MCP 配置，遇到同名但不同来源的条目时停止，不覆盖它。

首次交互安装可输入自己的官方用户 Key，输入不回显，也不进入命令历史；回车可跳过绑定，先使用本地编辑。Key 只向内置的官方 API origin 请求 `/v1/usage` 验证，禁止重定向；不会发起付费生成。没有公开注册/设备授权接口时，安装器不能凭空创建官方账户，官方地址已配置也不等于用户已经登录。

非交互环境可通过宿主的秘密环境注入 `RIKOKO_OFFICIAL_KEY`；不要把它明文拼进分享的安装命令。无 Key 的非交互安装仍可完成本地流程，最终明确提示尚未绑定。重新运行同版本安装保留 config 与凭据，不覆盖已有自有供应商设置。

## 本地目录与生命周期

可指定客户端和安装目录：

```sh
curl -fsSL https://github.com/flashcoder111/rikoko-mcp/releases/latest/download/install.sh | bash -s -- --client codex --dir "$HOME/.local/share/rikoko"
```

默认目录为 `${XDG_DATA_HOME:-$HOME/.local/share}/video-workbench`：

- `app/`：本版本公开源码和应用依赖。
- `runtime/`：必要时安装的 Node 与 uv；Python 由 uv 在其标准用户目录管理，应用依赖放在 `app/python/.venv`。
- `config/models.json`：GitHub 发行默认 `mode=custom`、空供应商列表和关闭外部模板；配置了官方地址的发行物使用 `mode=official`。
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

脚本面向 macOS 与 Linux/WSL（arm64/x64），原生 Windows PowerShell 安装器已补入源码和发行打包流程（0.1.31 预览），尚未发布、未进行 Windows 实机安装验证；详情见下节。Node 22.19+ 可复用；缺失时从 Node 官方 HTTPS 地址安装独立运行时并校验 SHA-256。uv 缺失时使用官方指定版本安装器，并通过锁文件准备 uv 管理的 Python 3.12 环境，避免依赖系统 Python 的完整性。不会修改 shell 启动文件。

FFmpeg/ffprobe 优先复用。缺失时使用 Homebrew、apt 或 dnf；系统软件安装可能需要管理员密码或系统开发工具。安装器不能绕过系统授权。FFmpeg 必须支持 libx264，最后的真实样片会检测此能力；某些发行版的 `ffmpeg-free` 不包含它，需要配置该发行版的完整 FFmpeg。Linux 的中文字幕需要相应字体包；安装器不再安装系统配音组件。

新版安装器支持在原目录升级（已发布的旧安装器不会自动获得此行为）。升级前结束进行中的任务并关闭 MCP 客户端；使用目标版本的安装命令和原来的 `--dir`。安装器先在临时目录下载、校验、安装依赖和构建，成功后才停止已核实实例的服务。若有排队、执行中、提交结果未知或其他未结束任务，停止升级并恢复原服务；不自动取消任务或重新购买生成。

切换前会锁住服务端口，并将 `data/`、`config/`、`installation.json`、`.release.json` 备份到权限为 0700 的 `backups/<id>/`；旧 `app/` 一并保留。目录空间需要容纳新依赖和完整数据备份。升级自检期间只有安装器能访问业务接口，原宿主配置与端口、实例身份保持不变。新版本必须完成新的免费 FFmpeg 样片；失败会一起恢复旧程序和升级前数据，不能用旧程序直接打开新版本修改过的数据库。失败候选与其数据也保留在备份目录供排查。成功后重载 MCP。

如果进程中断并留下 `.upgrade.json`，关闭客户端后，使用同一新版安装器加 `--recover`（自定义安装需保留相同 `--dir`）。恢复不会激活下载的新版本；它恢复中断事务中的旧版本。已确认退出的安装进程锁可恢复，仍在运行或无法确认归属的锁不会被自动移除。不要删除事务文件或备份目录来绕过恢复。备份包含私有凭据，不应分享或提交；确认版本稳定后由用户自行清理。

升级仅面向安装器托管的本地 PGlite 实例，不处理源码目录、外部 PostgreSQL 或云端部署；数据与配置中的符号链接和特殊文件会被拒绝，需要先由用户整理。当前发行工具只生成本地文件，不上传、不创建 Git 仓库或分支、不部署 API。

## Windows 原生安装预览（0.1.32）

此安装器仍为实验性预览，尚未完成 Windows 实机安装验收。Windows 10/11 x64、64 位 Windows PowerShell 5.1+ 是此预览的目标环境，ARM64 尚不在原生安装器范围内。

`pnpm release:installer` 现在同时生成 `install.sh` 与 `install.ps1`，两者内置同一版本、下载地址与 SHA-256。源码中的 PowerShell 文件是模板，会拒绝直接执行。0.1.32 发行物包含原生 PowerShell 安装器；请从 [v0.1.32 Release](https://github.com/flashcoder111/rikoko-mcp/releases/tag/v0.1.32) 下载并核对 `release.json`。公开下载不代表已通过 Windows 实机验证。

发布相应发行物后，使用发行工具输出的 `windowsCommand` 下载并运行完整脚本；也可以下载该发行物的 `install.ps1`，在其目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Client codex
```

可选 `-Client auto|codex|claude-code|claude-desktop` 和 `-InstallDir`（本地磁盘绝对路径）。默认安装到 `%LOCALAPPDATA%\rikoko`，不会永久更改执行策略。

- Node.js 22 从官方站点下载并验证 SHA-256；uv 使用指定版本官方 PowerShell 安装器。Node、uv 和 Python 放在本安装目录的 `runtime/`，Python 虚拟环境使用 `Scripts/python.exe`。
- 复用 PATH 中的 FFmpeg/ffprobe，缺失时通过 WinGet 的 `Gyan.FFmpeg` 包准备。WinGet 不存在或安装后 PATH 尚未更新时给出明确错误；不自动配置 WSL。
- 使用当前 Windows 用户的可继承 ACL 保护安装目录和新生成的私有配置；Unix 的 0600 不作为 Windows 权限保证。保留现有配置及其他 MCP 条目；遇到同名冲突停止。
- 默认 Claude Desktop 路径是 `%APPDATA%\Claude\claude_desktop_config.json`。若客户端的“Edit Config”显示其他路径（例如 MSIX），将 `RIKOKO_CLAUDE_DESKTOP_CONFIG` 指向该实际绝对文件路径后再运行；不要同时写入多个猜测位置。
- 生成 `service.ps1`，例如 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\rikoko\service.ps1" restart`。服务仍按需启动，不注册开机项。
- 支持同版本重试，拒绝覆盖不同版本；Windows 原地升级和中断升级恢复未纳入本预览。安装中断留下的 `.install-lock` 必须先检查进程状态，不自动清除。

正常用户运行安装器时仍会执行既有连接检查与免费样片自检；本轮开发没有执行它们。未验证 PowerShell 的实际执行、依赖下载、Windows 媒体能力或客户端 UI，不将静态检查等同于安装成功。

使用 WSL 的 Windows 用户可在已有、初始化完成的发行版中使用 Bash 安装器：

```powershell
wsl.exe -- bash -lc "curl -fsSL https://rikoko.ai/install.sh | bash"
```

此命令配置同一 WSL 发行版中的 Agent，不配置 Windows 桌面客户端。Linux/WSL 的完整安装验收也仍未完成。

参考：[uv 自定义安装目录](https://docs.astral.sh/uv/reference/installer/)、[WinGet install](https://learn.microsoft.com/en-us/windows/package-manager/winget/install)、[Claude Desktop 配置路径](https://playwright.dev/mcp/clients/claude-desktop)。

## 运营侧生成发行物

### 检查更新与提示

包含更新检查功能的版本提供只读 MCP 工具 `update_check`，并在已连接的本地工作台显示版本状态和复制升级命令。升级入口为 `curl -fsSL https://rikoko.ai/install.sh | bash`；不自动安装或重启。官网版本接口未上线、网络失败或内容无效时会明确返回无法检查。官网接口合同、缓存行为和实施提示词见[版本检查与更新提示](update-notifications.md)。旧版用户需要先手动升级一次才能获得此功能。

### 生成安装包

GitHub 本地功能发行使用 `config/distribution.github.json`；发布新版本时，使其中的版本和 GitHub tag 与源码的 `package.json` 一致：

```sh
pnpm release:installer config/distribution.github.json
```

将生成的 `install.sh`、`install.ps1`、压缩包、SHA-256 文件和 `release.json` 上传到该 tag 对应的 GitHub Release，发布后上面的一行命令即可下载。

带官方服务的发行物：复制 `config/distribution.example.json` 到 `config/distribution.local.json`，填写已准备好的真实 `downloadBaseUrl`、`apiUrl` 和 `templateUrl`，然后：

```sh
pnpm release:installer config/distribution.local.json
```

生成目录包含公开源码、源码压缩包、校验文件、`release.json` 与内置地址的 `install.sh` / `install.ps1`，并输出发布后的用户命令。只将这些经过审阅的发行物放到对应下载地址。构建命令不代表已经发布，也不会验证生产 API 是否上线。

依赖来源：[Node 官方下载](https://nodejs.org/en/download)、[uv 安装](https://docs.astral.sh/uv/getting-started/installation/)、[FFmpeg 下载说明](https://www.ffmpeg.org/download.html)。

### MCP director guides

Director guides live in `packages/guidance` and are read from the executing backend through `rikoko_guide`. Both stdio and HTTP MCP use this source. Installation configures MCP only; no Skill is installed. Packaging and public export verify the manifest, all topics, content hashes and references. Run `pnpm guides:manifest` after editing guide content, and `pnpm guides:check` to verify it.

Update/reconnect the matching backend and bridge, then run `pnpm clients doctor codex` (or `claude-code`, `claude-desktop`, `hermes`). Doctor checks every guide and reports legacy Skill leftovers separately from connection success. Compatible content changes are available on the next guide read; new tool schemas require a bridge upgrade/reconnection.

For legacy installations, `pnpm clients migrate-skill codex` previews the known installation only. Add `--apply` after reviewing it to archive an unchanged recognized official copy outside the host's Skill discovery directories, after verifying the installed MCP profile. Modified/unknown copies and symlinks remain untouched with `needs_review`. Restore with `pnpm clients restore-skill codex --backup <id>`; an existing destination is never intentionally overwritten. Archives retain bytes and modes under `~/.local/share/rikoko/skill-archives/<host>/`. Reload the host after migration. `sync-skill` is deprecated and changes no files. Never remove user additions merely because a managed comment remains.

Video generation requires target dimensions, and reference-input video requires a saved preparation. For a deliberate legacy-client migration only, the service operator may set `RIKOKO_ALLOW_LEGACY_GENERATION=true`; it is disabled by default and cannot be selected per request. This does not waive storyboard target plans or final-delivery acceptance.

After reviewing a customized directory, an operator can explicitly accept the displayed fingerprint with `pnpm clients migrate-skill codex --apply --accept-fingerprint <sha256>`. Any changed bytes or shared links still prevent migration. After an interrupted process, `pnpm clients migrate-skill codex --recover-lock` removes only a lock whose recorded process has exited; it never kills a process. Unknown lock owners require manual inspection. Acquisition and recovery share a short-lived `.migration-guard`; an interrupted guard also requires manual owner inspection and is never automatically removed.
