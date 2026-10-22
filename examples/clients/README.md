# rikoko MCP: Codex, Hermes, and Claude setup

The product and new MCP configuration entries use the name **rikoko**. All supported hosts use MCP tools and natural language; no separate Skill installation is required.

Use your existing host conversation to describe a video, follow progress, and request revisions. After acceptance, the Agent returns a video attachment or media link and a clickable workspace link. Open the link when you want to preview, edit, or export in `/workspace`. rikoko does not automatically open MCP windows, embed a card player, or start another web conversation. `/` remains available for standalone use and development. Clients connected to the same backend account share projects, media, jobs, and versions.

## Installation and activation

The one-line installer prepares the environment and registers detected Codex/Claude clients. Releases configured with official service addresses also support connecting to those services. MCP locates the installation through `VIDEOWORKBENCH_MANAGED_CONFIG` and starts its local backend when needed; you do not need to keep `pnpm dev` running. Managed client keys are stored in private local files with mode 0600; host configuration stores only their paths. See [One-line installation](../../docs/architecture/installation.md).

For source development, first run `pnpm install` and `pnpm build` in this repository, then keep `pnpm dev` running. The stdio connector accesses that HTTP backend without opening another PGlite database.

```sh
pnpm clients install codex
pnpm clients install claude-desktop
pnpm clients install claude-code
# Run on the machine with Hermes installed and an existing ~/.hermes/config.yaml:
pnpm clients install hermes
```

On macOS, the source installer issues a separate read/write key with a paid budget of zero for each client and stores it in Keychain. Configuration contains the Keychain service name, not the credential. Existing configuration is backed up and updated atomically, preserving other MCP entries. A `rikoko` entry pointing to a different project is rejected; reinstalling the same configuration does not create duplicates. Migration of legacy Skills is described below.

The macOS Hermes configuration also permits `~/Library/Application Support/Hermes/composer-images/` for images uploaded in the composer. If an older configuration still uses only the two default project directories, rerunning `pnpm clients install hermes` upgrades that list when the remaining launch settings match. Custom or deliberately restricted lists are not expanded. Run `/reload-mcp` in Hermes or restart it afterward. Linux/remote Hermes must use dedicated attachment directories on its actual host.

| Client | Configuration | Activation |
| --- | --- | --- |
| Codex app / CLI | `~/.codex/config.toml`, `mcp_servers.rikoko` | Restart the connection in MCP settings or restart the client |
| Claude Desktop (macOS installer path) | `~/Library/Application Support/Claude/claude_desktop_config.json` | Restart after signing in; check the `rikoko` entry in developer/connector settings |
| Claude Code | `~/.claude.json`, `mcpServers.rikoko` | Restart or check the connection with `/mcp` |
| Hermes | `~/.hermes/config.yaml`, `mcp_servers.rikoko` | Run `/reload-mcp` or restart Hermes |

The connector uses the current Node executable's absolute path rather than relying on a desktop application's shell PATH. Check configured paths after upgrading or moving Node or the repository. The installer does not automatically overwrite entries with different paths.

```sh
pnpm clients doctor codex
pnpm clients doctor claude-desktop
pnpm clients doctor claude-code
pnpm clients doctor hermes
```

Doctor starts a real stdio subprocess, checks initialization, tool discovery, and capabilities, and verifies that no embedded MCP UI is advertised. Successful output includes `interaction: "native-conversation-media-and-content"` and `inlineCardResource: false`. It does not purchase generation or replace host UI acceptance. Use `pnpm clients config <client>` for portable templates; do not copy local Mac paths to a remote Hermes host.

When a rikoko entry exists, doctor uses its launch command and environment and reports `configSource` and `importRoots`. Otherwise it uses generated defaults with `configSource: "generated"`. Its new test connection does not reload an already-running host or demonstrate an actual attachment upload.

After upgrading from the older card-based version, restart the backend and reload MCP so the host rereads tool declarations. Old cards may remain in conversation history; new calls return ordinary tool results.

## Host adaptations and director guides

Hosts share the director workflow. Differences concern host context, attachment access, visual inspection, and delivery. A client name alone does not establish that the current session can inspect images.

| Host | Entry point and guides | Media and review | Delivery |
| --- | --- | --- | --- |
| Codex app / CLI | Natural language and `rikoko_guide`; [host guide](../../packages/guidance/content/host-codex.md) | Use accessible real paths; preserve `media_inspect` image blocks through tool orchestration | Display returned local paths when the app supports them; CLI/remote hosts can use media links |
| Claude Code | Natural language and `rikoko_guide`; [host guide](../../packages/guidance/content/host-claude.md) | Load guides as needed and verify that the MCP process can read attachments | Media links; native attachments only when the host supports them |
| Claude Desktop | Natural language or MCP prompts; full guides through `rikoko_guide` | Do not assume desktop attachments are readable by MCP; guides require no terminal | Media and workspace links; no guaranteed embedded player |
| Hermes | Natural language and `rikoko_guide`; [host guide](../../packages/guidance/content/host-hermes.md) | Distinguish native pixels from auxiliary vision summaries; use the actual host's attachment directories | Returned `MEDIA:` paths on supported channels, with media links as fallback |

Final videos require review of the current version, and delivery includes the correct workspace link. Hosts unable to inspect frames keep visual status unreviewed and seek user or available visual review; a text summary is not a direct visual observation.

`rikoko_guide` is a read-only MCP tool that retrieves versioned guides from the configured execution backend, including content hashes and required contracts. It does not upload media, quote prices, or call models. All hosts use it without a separate Skill, local Markdown permissions, or an MCP App. The host retains creative, planning, and follow-up decisions; template and kit suggestions are optional.

Installation configures MCP only. After updating, run the relevant `pnpm clients doctor` command to check all guide topics, tool compatibility, and legacy Skill leftovers. Guides ship with the backend; new tool schemas require a matching bridge update and reconnection.

For legacy installations, preview with `pnpm clients migrate-skill codex`, then add `--apply` after review. Only recognized official copies with matching hashes are archived. Modified copies, extra files, and symlinks return `needs_review` and remain intact. Backups live outside host discovery directories and can be restored with `pnpm clients restore-skill codex --backup <id>`. After reviewing custom content, use `--apply --accept-fingerprint <preview-fingerprint>` to archive that exact copy; shared links still require manual handling. `--recover-lock` recovers an interrupted lock only when its recorded process has exited. Substitute another client name as needed; Claude Desktop has no local Skill migration target. `sync-skill` is deprecated and changes no files.

## Hermes on a server

Install the connector and Node dependencies on the Hermes host. The backend may run on the same machine or be configured with `VIDEOWORKBENCH_URL=https://your-service.example.com`. Inject `VIDEOWORKBENCH_API_KEY` through that host's secret environment; the non-macOS source installer does not persist plaintext credentials. The process launching Hermes must inherit these variables. Hermes secret-environment references can use its `${VAR}` / `${env:VAR}` syntax. Keep real keys out of shared configuration.

Deliver results in the original Hermes conversation. With an export directory configured, `workspace_result` saves media to `VIDEOWORKBENCH_EXPORT_DIR` on the Hermes host. Return `MEDIA:/absolute/path/video.mp4` in the **current session**, without selecting another recipient. Deployments using `HERMES_MEDIA_DELIVERY_STRICT=1` must add this directory to `HERMES_MEDIA_ALLOW_DIRS`. In Docker, the Agent and gateway need access to the same media path. Actual delivery limits require validation for each channel, including Telegram and Feishu.

## Conversation usage

The host can interpret the text examples below; they are not separately installed Skill commands. In the workspace composer, omit `rikoko` and use `/models`, for example. Type `/` or click the adjacent `/` button to view the menu. A host's own `/model` command may select its language model, so use `/rikoko model <model ID>` when referring to a video model.

| Example | Purpose |
| --- | --- |
| `/rikoko help` | View commands |
| `/rikoko models` | List configured models, specifications, and status |
| `/rikoko model <catalog ID>` | Choose a model; `auto` restores automatic selection under the face-aware video policy |
| `/rikoko brief A short video for a new coffee-shop drink` | Add creative requirements |
| `/rikoko style Warm, natural light` | Add a style preference |
| `/rikoko reference Use the first image for character consistency` | Explain a reference's role; attach the actual file separately |
| `/rikoko video`, `image`, `speech`, `audio`, `edit` | Switch media/editing mode; each retains its own model choice |

Place a workspace command on the last line of the draft and press Enter to apply it. The description and attachments remain, and the command itself does not submit a job. Describe duration and format naturally, such as “Make a 15-second, 9:16 vertical video with a gentle English female voice.” The Agent separates video and speech parameters and matches them to model specifications. Direct workspace generation uses the selected model's fixed specifications; text does not override them. Use the Agent for complex orchestration. Profiles requiring structured references appear in the catalog but cannot be selected from the text-only workspace entry point; bind references through the Agent workflow.

Models are currently integrated through fal.ai and appear as available only when actually configured and enabled. Face-free video tasks default to compatible Seedance Mini. Faces in the request or any reference, including first/last frames, or unknown face status block every Seedance variant. Recommend MiniMax or offer Kling, and obtain or reuse the user's explicit choice through `video_model_resolve`. Model selection alone does not request generation, supply credentials, or authorize a budget. Generate only within the user's request and explicit budget; show optional quotes when requested.

For example: “Use rikoko to make a video from these assets, tell me the progress here, and send me the finished video.” You can request links only. All hosts support natural-language entry. Optional MCP prompts `rikoko_create` and `rikoko_resume` are presented according to client capabilities. Reload MCP after installation or updates; no Skill or slash menu is required.

1. Call `capabilities` for actual availability. Read `rikoko_guide {topic:"overview"}`, then load the relevant host adaptation and task topics. The host prepares a composition or edit actions directly; `workspace_plan` is optional and needs no web creative-model configuration.
2. Import actual local files with `asset_import_file`. Defaults allow project `media-inbox/` and `artifacts/`; macOS Hermes also includes the composer directory above. Provide media licensing information and `rightsConfirmed: true`. Operators configure other dedicated directories through the `VIDEOWORKBENCH_IMPORT_ROOTS` JSON array. Tool descriptions list current roots. For `FORBIDDEN`, copy the selected media to an allowed directory or update the dedicated-directory configuration and reload MCP, then use the new path. Do not repeat the same rejected request. A missing directory does not invalidate other roots; expired attachments must be attached again. The connector cannot read attachments the host has not supplied or access the entire home directory.
3. Call `workspace_commit` with a stable `idempotencyKey`, then `workspace_result` to check status. Repeated status checks do not resubmit generation.
4. Completed jobs return ordinary text, structured results, and media `resource_link` entries for the video, captions, previews, and on-screen copy. Configured Codex/Hermes export directories save attachments automatically; other hosts use accessible media links. No `ui.resourceUri` or HTML resources are declared.
5. Continue editing in the original host input. Open the workspace link when you want a preview or finer edits. The Agent does not automatically launch a browser or require a switch to web chat. The workspace's first visit requires connecting to your account.
6. After using the workspace or switching Agents, call `workspace_snapshot {projectId}` and submit edits using the current `baseRevisionId`. On a stale-version conflict, reread rather than overwriting newer work.

Use `workspace_export {jobId}` to save or retry attachment downloads to `.data/host-media/<client>/` or a configured directory without rerendering. Each imported/exported file is limited to 100 MiB. Outputs are read only through authenticated backend asset endpoints, without following arbitrary provider/result URLs. Export directories use mode 0700 and files use 0600.

Generation requires an enabled provider, sufficient budget, and authorization within the user's request. Internal submission handles billing without requiring a separate quote confirmation at every step. Custom providers do not require official credits. New keys' zero paid budget keeps ordinary editing from triggering purchases. Local demos use synthetic media and do not make paid generation requests.

<a id="手机远程与能力边界"></a>

## Mobile, remote access, and capability limits

Mobile users can create through Hermes chat channels and open the workspace link for manual editing. Mobile and remote workspaces need a reachable HTTPS `PUBLIC_BASE_URL`, not a local `127.0.0.1` address. The browser's first visit still requires a key for the same account; public accounts/OAuth are not implemented.

Streamable HTTP uses `/mcp` with Bearer authentication. Neither HTTP nor stdio advertises embedded UI. HTTP does not expose client-local file read/write tools; use the stdio bridge when local downloads are required. The backend's `PUBLIC_BASE_URL` determines returned workspace links.

See [Conversation and workspace contracts (Chinese)](../../docs/architecture/dual-mode.md). Tool-call details, permission prompts, and link-opening behavior remain controlled by the host client.

## Upstream references

- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Claude Desktop local MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Hermes MCP configuration](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/mcp-config-reference.md)
- [Hermes native media handling](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/base.py)

## Windows native preview

The 0.1.32 Release includes an experimental PowerShell installer that has not been validated on Windows. It targets Windows 10/11 x64. It keeps Codex under `%USERPROFILE%\.codex`, Claude Code at `%USERPROFILE%\.claude.json`, and Claude Desktop at `%APPDATA%\Claude\claude_desktop_config.json`. If Desktop's Edit Config opens a different location, set `RIKOKO_CLAUDE_DESKTOP_CONFIG` to that absolute file path. Existing entries are preserved and conflicting rikoko entries are rejected. See [Windows installation preview](../../docs/architecture/installation.md#windows-native-installation-preview-0132).

The WSL installer configures clients inside WSL; it does not register a Windows desktop client. Download the native installer from the matching 0.1.32 Release; publication does not establish Windows installation or client validation.
