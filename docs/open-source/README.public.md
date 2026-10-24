# rikoko

rikoko is a self-hostable video creation MCP. Create and revise videos in an Agent conversation, then fine-tune them in the local timeline. Projects, media, versions, and FFmpeg rendering stay local. Official cloud services provide template update distribution and unified model API billing.

Keep requests and revisions in your existing conversation. If required media is missing, the Agent asks for it there and preserves the request. On completion, it delivers a video attachment or media link, relevant copy, and a clickable local workspace link for further editing. It does not automatically open a browser or MCP window. You can request links only; the workspace link is still included.

Local editing, caption composition, rendering, and template synchronization do not consume official API credits. External model calls and host Agent fees are billed separately. Existing media can be edited and exported without activating the official API.

For illustrated instructions covering the first local sample, Agent setup, editing, audio, export, and version recovery, see the [getting-started tutorial (Chinese)](docs/tutorials/使用教程.md).

## One-line installation

Run in a macOS or Linux/WSL terminal:

```sh
curl -fsSL https://github.com/flashcoder111/rikoko-mcp/releases/latest/download/install.sh | bash
```

The installer downloads and verifies a GitHub Release, prepares the environment, registers detected Codex/Claude MCP clients, starts the local service, and exports a free sample. Reload your client's MCP connection, then ask it to use rikoko. To select a client, replace the final `bash` with `bash -s -- --client codex`, `bash -s -- --client claude-code`, or, on macOS, `bash -s -- --client claude-desktop`.

The newer installer supports in-place upgrades with data backups and automatic rollback if checks fail. Use `--recover` after an interrupted upgrade. Finish running tasks and close clients before upgrading; see the installation guide.

Local editing and rendering require no model API key. Configure your own provider for AI generation. You can install and use the local workspace even if no client is detected. See [Installation](docs/architecture/installation.md) for custom directories, service management, and the experimental Windows installer.

## Run from source

Requirements: Node ≥22.19, pnpm 10.28.2, uv, Python 3.12/3.13, and FFmpeg/ffprobe with libx264.

```sh
pnpm install --frozen-lockfile
uv sync --project python --frozen --python 3.12
pnpm build
pnpm demo
pnpm dev
```

Open `http://127.0.0.1:4310` and sign in to your workspace with the key generated in `.data/local-admin.key`. Run the demo and development service separately; two processes must not open the same database directory. Do not share or commit the local key.

The local demo uses labeled test tones and does not call paid models. Standalone voiceovers default to ElevenLabs Eleven v3 through fal; local system TTS is not provided.

## Configure templates and model APIs separately

The app includes nine local composition templates, 15 original illustrations, and rendered MP4 previews, with no cloud or model key required. The Agent selects a structure from your description, fills in copy, and reuses visuals. Media categories, tags, and favorites support automatic retrieval. See [Templates and media reuse (Chinese)](docs/tutorials/模板与素材复用.md).

Set `TEMPLATE_API_URL=https://templates.example.com` to add a template source without changing model billing. The catalog is requested only when the user asks for updates and `template_sync` is called. Existing projects retain their original template snapshots.

The official generation service uses `GENERATION_API_URL` and `GENERATION_API_KEY`. Alternatively, point `RIKOKO_CONFIG_FILE` to a config file: `mode=official` uses a platform user key, while `mode=custom` uses your configured providers. `templates.url` sets the template source independently; `templates=false` disables it.

Example domains are placeholders and must be replaced with available services. Inject secrets through the process environment; `.env` is not loaded automatically. Do not place real keys in model configuration JSON or public files. Managed installations use a separate private credentials file as described in the installation guide.

Official cloud reference uploads go directly from the local rikoko client to signed R2 URLs; cloud-generated videos download from R2 directly to the local library. The business API exchanges authorization and metadata. Account tokens are never sent to R2. TikTok links imported through MCP are downloaded on the user's machine, then uploaded directly to R2 when cloud analysis is requested; the official cloud web app imports them through its media Worker. Gemini reads the R2 video URL. TikTok page links and temporary CDN links are not a reliable direct Gemini input.

Neither mode automatically switches billing sources after a failure. The official key is sent only to the generation API origin and is not included in template synchronization. A zero official balance does not prevent local processing of existing media or template updates.

See [Model services (Chinese)](docs/architecture/model-services.md) for provider configuration. The project uses `RIKOKO_*` environment variables and the MCP configuration name `rikoko`. Third-party references do not imply affiliation.

## Connect an Agent

When running from source, keep the local service running, then execute `pnpm clients install codex`, `pnpm clients install claude-desktop`, or `pnpm clients install claude-code`. The one-line installer handles these steps and service startup automatically. Configure Hermes on the host where it actually runs.

The installer preserves other MCP configurations. New local client keys have a paid budget of zero. Reload the host's MCP connection after installation. Client capabilities must be verified against the version in use. See [Client setup](examples/clients/README.md).

## MCP director guides

No separate Skill installation is required. Ask the host Agent to use rikoko; it reads `rikoko_guide` from the execution backend and retains creative decisions. `capabilities` reports the guide version. See the client setup guide for legacy Skill migration and backend/bridge compatibility checks.

For face-free video tasks, the default is compatible Seedance Mini. Any face in the request or reference media, or unknown face status, blocks all Seedance variants. The Agent recommends MiniMax or offers Kling and obtains or reuses an explicit model choice. Choosing a model does not configure credentials or authorize a paid budget.

## Development and contributions

```sh
pnpm typecheck
pnpm test
pnpm test:media
pnpm build
```

See [Contributing](CONTRIBUTING.md), [Open-source boundaries](docs/open-source/boundaries.md), and [Third-party notices](THIRD_PARTY_NOTICES.md). This source snapshot excludes the official cloud backend, runtime data, provider keys, research, and development samples.

The source includes the Apache-2.0 license text. Third-party components remain subject to their own terms; model weights and third-party media are not automatically licensed with the source. A successful build does not establish acceptance of paid generation, online payments, or production deployment.
