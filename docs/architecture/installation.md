# Install rikoko

Run in a macOS or Linux/WSL terminal:

```sh
curl -fsSL https://github.com/flashcoder111/rikoko-mcp/releases/latest/download/install.sh | bash
```

The installer downloads and verifies the versioned GitHub Release archive, prepares dependencies, registers detected Codex/Claude clients, starts the local service, and exports a free sample video. Reload your client's MCP connection afterward. You do not need a separate terminal running `pnpm dev`. Local installation also works without a supported client.

## Local TikTok downloads

TikTok videos are downloaded on your machine. The installer prepares yt-dlp/curl_cffi from the same Python lockfile; older environments check and install missing dependencies on first use. No source checkout or manual download-tool installation is required. Preparation, download, validation, and import status are returned through the job interface. Supported inputs are single-video URLs and vm/vt/t share links. Login requirements, blocked requests, or platform changes may cause failures; the tool returns the reason.

Downloads reuse configured HTTP(S) proxy environment variables and detect macOS system web proxies. To override the proxy, set `RIKOKO_DOWNLOAD_PROXY`, for example `http://127.0.0.1:7890`, in the environment that starts rikoko, then restart the service. The downloader does not read browser cookies or user yt-dlp configuration. Proxy credentials do not enter model inputs or task errors.

Every download destination is checked as a public address. If proxy software returns synthetic addresses in 198.18/15, the downloader queries Cloudflare DNS over HTTPS through the selected proxy and pins the real public address; synthetic addresses are not directly allowed. Final videos are limited to 100 MiB, downloads to three minutes, and dependency preparation to five minutes. This local import entry point is disabled for instances listening externally or using a remote database.

GitHub releases default to local editing, built-in templates, and FFmpeg rendering, without an official API domain or user key. Configure your own provider for AI generation. Releases may preconfigure official API/template endpoints when real services are available; release tooling rejects placeholder domains.

## Client setup and account binding

The one-line command downloads `install.sh` from the latest stable GitHub Release and runs it with Bash. The script embeds that release's source URL and SHA-256, so you do not need to supply a download URL. Official account binding is offered only when the release includes an official endpoint.

The installer detects existing Codex and Claude Code configuration directories, plus Claude Desktop on macOS. Use `bash -s -- --client codex` or `bash -s -- --client claude-code` at the end of the command to select a client. It registers MCP as `rikoko` and provides director guides through `rikoko_guide`; no separate Skill is installed. Other MCP entries are preserved. A same-name entry from a different source stops installation rather than being overwritten.

When official binding is available, an interactive installation can accept your official user key without echoing it or storing it in command history. Press Enter to skip binding and use local editing. Verification calls only `/v1/usage` on the embedded official API origin, rejects redirects, and does not generate paid media. The installer cannot create an official account without an available registration/device-authorization endpoint; a configured address does not mean you are signed in.

For noninteractive installs, inject `RIKOKO_OFFICIAL_KEY` through a secret environment, rather than putting it in a shared command. Installation without a key still completes the local workflow and reports that the account is unbound. Reinstalling the same version preserves configuration, credentials, and custom-provider settings.

## Local directories and service lifecycle

To select a client and installation directory:

```sh
curl -fsSL https://github.com/flashcoder111/rikoko-mcp/releases/latest/download/install.sh | bash -s -- --client codex --dir "$HOME/.local/share/rikoko"
```

The default directory is `${XDG_DATA_HOME:-$HOME/.local/share}/video-workbench`:

- `app/`: public source and application dependencies for this version.
- `runtime/`: Node and uv when required. uv manages Python in its standard user directory; application dependencies live in `app/python/.venv`.
- `config/models.json`: GitHub releases default to `mode=custom`, an empty provider list, and disabled external templates. Releases with official endpoints use `mode=official`.
- `config/credentials.json`: private local key mapping with mode 0600, kept outside source and host MCP configuration.
- `data/`: projects, media, separate local access keys for each MCP client, and service logs.
- `installation.json`: absolute local paths, a dedicated loopback port, and the service instance identity, with mode 0600.

The MCP subprocess checks its service and starts it in the background if needed. The service remains after the conversation closes; after a reboot, the next MCP connection starts it again. It listens only on `127.0.0.1`. Concurrent clients claim the port before opening the database. If another service owns the port, startup stops without sending it credentials. No system startup service is registered by default.

After changing model configuration, use the launcher's restart command; Node does not need to be on your system PATH:

```sh
~/.local/share/video-workbench/service restart
```

The same command supports `start` and `stop`. Restart stops only a process matching both the instance identity and PID. Wait for running creation tasks to finish before stopping the service.

## Custom providers

Edit `config/models.json` using `app/config/models.custom.example.json` as a reference, retaining any template source you want. Put each credential referenced by `keyEnv` into the private `config/credentials.json`, then restart the service. For example:

```json
{"MY_FAL_KEY": "replace-with-your-provider-credential"}
```

The launcher loads only credentials referenced by the current configuration. Custom mode does not load the official user key or fall back to official billing. Official template updates remain separate and manual.

Provider enablement, cost limits, and local key budgets still apply. Supplying a credential does not raise the budget. Installed client keys default to a zero paid budget; a local administrator must configure the relevant key's budget before paid custom-provider use.

## Supported environments and upgrades

The Bash installer targets macOS and Linux/WSL on arm64/x64. The experimental native Windows PowerShell installer is included in the 0.1.32 release but has not been validated on a Windows machine; see below. Existing Node 22.19+ installations are reused. Otherwise, the installer downloads a separate runtime over official Node HTTPS endpoints and verifies SHA-256. Missing uv is installed using a pinned official installer, then a locked uv-managed Python 3.12 environment is prepared. Shell startup files are not modified.

Existing FFmpeg/ffprobe are reused. If absent, the installer uses Homebrew, apt, or dnf; system package installation may require an administrator password or developer tools. FFmpeg must support libx264, which the real sample export checks. Some distributions' `ffmpeg-free` packages omit it and require a full FFmpeg package. Chinese subtitles on Linux require appropriate fonts. System speech components are no longer installed.

Newer installers support in-place upgrades; previously published installers do not gain this behavior automatically. Finish active jobs and close MCP clients, then run the target version's installer with the original `--dir`. The installer downloads, verifies, installs dependencies, and builds in a temporary directory before stopping the verified service instance. Queued, running, submission-unknown, or otherwise unfinished jobs stop the upgrade and restore the original service; jobs are not automatically canceled or repurchased.

Before switching versions, the installer locks the service port and backs up `data/`, `config/`, `installation.json`, and `.release.json` to `backups/<id>/` with mode 0700. The old `app/` is retained. Allow disk space for new dependencies and a full data backup. Only the installer can access business endpoints during upgrade checks; host configuration, port, and instance identity remain unchanged.

The new version must export a fresh free FFmpeg sample. Failure restores both the old application and pre-upgrade data, rather than opening a modified database with old code. Failed candidates and their data remain in the backup directory for diagnosis. Reload MCP after a successful upgrade.

If interruption leaves `.upgrade.json`, close clients and run the same newer installer with `--recover`, retaining the same custom `--dir`. Recovery restores the old version from the interrupted transaction; it does not activate the downloaded candidate. Locks belonging to confirmed exited installers can be recovered. Locks still in use or with unknown ownership are not automatically removed. Do not delete transaction files or backups to bypass recovery. Backups contain private credentials; keep them out of shared files and version control. Remove them yourself after confirming stability.

Upgrades cover installer-managed local PGlite instances, not source checkouts, external PostgreSQL, or cloud deployments. Symlinks and special files in data/configuration are rejected and require cleanup first. Release tooling generates local files only; it does not upload, create Git repositories/branches, or deploy APIs.

<a id="windows-原生安装预览0132"></a>

## Windows native installation preview (0.1.32)

The native installer is an experimental preview without real-machine Windows installation acceptance. It targets Windows 10/11 x64 and 64-bit Windows PowerShell 5.1+. Native ARM64 is outside this preview's scope.

`pnpm release:installer` generates both `install.sh` and `install.ps1` with the same version, source URL, and SHA-256. The source PowerShell file is a template and refuses direct execution. Download the native installer from the [v0.1.32 Release](https://github.com/flashcoder111/rikoko-mcp/releases/tag/v0.1.32) and check `release.json`. Public availability does not establish Windows validation.

Use the release tooling's `windowsCommand` to download and run the full script, or download that release's `install.ps1` and run it from its directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Client codex
```

Options include `-Client auto|codex|claude-code|claude-desktop` and `-InstallDir` with an absolute local-disk path. The default is `%LOCALAPPDATA%\rikoko`. The command does not permanently change execution policy.

- Node.js 22 is downloaded from its official site and SHA-256 verified; uv uses a pinned official PowerShell installer. Node, uv, and Python live under the installation's `runtime/`; the virtual environment uses `Scripts/python.exe`.
- FFmpeg/ffprobe on PATH are reused. Otherwise, WinGet prepares `Gyan.FFmpeg`. Missing WinGet or an unrefreshed PATH produces an explicit error. WSL is not configured automatically.
- The current Windows user's inheritable ACL protects the installation and newly generated private configuration; Unix 0600 is not a Windows permission guarantee. Existing configuration and other MCP entries are preserved, and same-name conflicts stop installation.
- Claude Desktop defaults to `%APPDATA%\Claude\claude_desktop_config.json`. If Edit Config shows another location, such as an MSIX path, set `RIKOKO_CLAUDE_DESKTOP_CONFIG` to that actual absolute path before running the installer. Do not write several guessed locations.
- The generated `service.ps1` supports commands such as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\rikoko\service.ps1" restart`. Service startup remains on demand, without a startup entry.
- Same-version retries are supported; replacing another version is rejected. In-place Windows upgrades and interrupted-upgrade recovery are outside this preview. Check process status before handling a leftover `.install-lock`; it is not automatically removed.

Normal installation runs connection checks and the free sample check. The preview's development review did not execute these on Windows or verify PowerShell execution, dependency downloads, media processing, or client UI. Static checks are not installation acceptance.

Windows users with an initialized WSL distribution can run the Bash installer there:

```powershell
wsl.exe -- bash -lc "curl -fsSL https://rikoko.ai/install.sh | bash"
```

This configures Agents in the same WSL distribution, not Windows desktop clients. Full Linux/WSL installation acceptance also remains outstanding.

References: [uv installation directories](https://docs.astral.sh/uv/reference/installer/), [WinGet install](https://learn.microsoft.com/en-us/windows/package-manager/winget/install), [Claude Desktop configuration paths](https://playwright.dev/mcp/clients/claude-desktop).

## Build releases

### Update checks

Versions with update checking expose the read-only MCP tool `update_check` and display version status plus a copyable upgrade command in the connected local workspace. The upgrade entry point is `curl -fsSL https://rikoko.ai/install.sh | bash`. Checking does not automatically install or restart anything. An unavailable website version endpoint, network failure, or invalid response is reported as an inability to check. See [Update notifications (Chinese)](update-notifications.md) for the endpoint contract and caching behavior. Older installations need one manual upgrade to gain this feature.

### Installer artifacts

GitHub releases for local functionality use `config/distribution.github.json`. Keep its version and GitHub tag aligned with `package.json` when publishing:

```sh
pnpm release:installer config/distribution.github.json
```

Upload the generated `install.sh`, `install.ps1`, archive, SHA-256 file, and `release.json` to the matching GitHub Release. The one-line command can download them after publication.

For a release with official services, copy `config/distribution.example.json` to `config/distribution.local.json`, enter real prepared `downloadBaseUrl`, `apiUrl`, and `templateUrl` values, then run:

```sh
pnpm release:installer config/distribution.local.json
```

The output includes public source, a source archive, checksums, `release.json`, scripts with embedded URLs, and user commands for the published release. Publish only the reviewed artifacts at the matching download location. Building does not publish them or verify that production APIs are live.

Dependency sources: [Node downloads](https://nodejs.org/en/download), [uv installation](https://docs.astral.sh/uv/getting-started/installation/), [FFmpeg downloads](https://www.ffmpeg.org/download.html).

### MCP director guides

Director guides live in `packages/guidance` and are read from the executing backend through `rikoko_guide`. Both stdio and HTTP MCP use this source. Installation configures MCP only; no Skill is installed. Packaging and public export verify the manifest, all topics, content hashes, and references. Run `pnpm guides:manifest` after editing guide content and `pnpm guides:check` to verify it.

Update/reconnect the matching backend and bridge, then run `pnpm clients doctor codex` (or `claude-code`, `claude-desktop`, `hermes`). Doctor checks every guide and reports legacy Skill leftovers separately from connection success. Compatible content changes are available on the next guide read; new tool schemas require a bridge upgrade/reconnection.

For legacy installations, `pnpm clients migrate-skill codex` previews the known installation only. Add `--apply` after review to archive a recognized, unchanged official copy outside the host's Skill discovery directories, after verifying the installed MCP profile. Modified/unknown copies and symlinks remain untouched with `needs_review`. Restore with `pnpm clients restore-skill codex --backup <id>`; an existing destination is never intentionally overwritten. Archives retain bytes and modes under `~/.local/share/rikoko/skill-archives/<host>/`. Reload the host after migration. `sync-skill` is deprecated and changes no files. Never remove user additions merely because a managed comment remains.

Video generation requires target dimensions, and reference-input video requires a saved preparation. For a deliberate legacy-client migration only, the service operator may set `RIKOKO_ALLOW_LEGACY_GENERATION=true`; it is disabled by default and cannot be selected per request. This does not waive storyboard target plans or final-delivery acceptance.

After reviewing a customized directory, an operator can explicitly accept its displayed fingerprint with `pnpm clients migrate-skill codex --apply --accept-fingerprint <sha256>`. Changed bytes or shared links still prevent migration. After an interrupted process, `pnpm clients migrate-skill codex --recover-lock` removes only a lock whose recorded process has exited; it never kills a process. Unknown lock owners require manual inspection. Acquisition and recovery share a short-lived `.migration-guard`; an interrupted guard also requires manual owner inspection and is never automatically removed.
