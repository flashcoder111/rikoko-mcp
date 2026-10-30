# rikoko MCP

rikoko is a self-hostable video creation MCP with an optional editing workspace. Create and revise videos in your existing Codex, Hermes, or Claude conversation, then open the local timeline when you want to fine-tune the result. Projects, media, versions, and FFmpeg rendering stay local.

This repository contains the local MCP service, media pipeline, and editing workspace. The website and official cloud backend are maintained in the separate `rikoko-platform` repository. See [Repository layout (Chinese)](docs/architecture/repository-layout.md) for development and shared-runtime workflows.

## Install

Run in a macOS or Linux/WSL terminal:

```sh
curl -fsSL https://github.com/flashcoder111/rikoko-mcp/releases/latest/download/install.sh | bash
```

The installer downloads and verifies a GitHub Release, prepares dependencies, registers detected Codex/Claude MCP clients, starts the local service, and exports a free sample video. Reload your client's MCP connection, then ask it to use rikoko. To select a client, replace the final `bash` with `bash -s -- --client codex`, `bash -s -- --client claude-code`, or, on macOS, `bash -s -- --client claude-desktop`.

Local editing and rendering work without a model API key. Configure your own provider to use AI generation. You can also install and use the local workspace without an Agent client. See the [installation guide](docs/architecture/installation.md), including the experimental Windows installer, and [client setup](examples/clients/README.md).

For a walkthrough with screenshots, see the [getting-started tutorial (Chinese)](docs/tutorials/使用教程.md). It covers the first local sample, Agent conversations, timeline editing, audio adjustments, export, and version recovery.

## Create videos in your conversation

Describe the video you want. The Agent searches templates and existing media, chooses a structure, and fills in the copy. You do not need to select a template or provide a reference video first. The app includes nine local templates and 15 original illustrations; media categories, tags, and favorites help the Agent find reusable assets. Caption changes reuse the current visuals. See [Templates and media reuse (Chinese)](docs/tutorials/模板与素材复用.md).

All clients read versioned director guides from the execution backend through `rikoko_guide`; no separate Skill installation is required. The host Agent makes creative decisions and handles follow-up requests. When a task finishes, it returns a video attachment or media link, relevant copy, and a clickable local workspace link. You can request links only. The workspace opens when you choose to open it; rikoko does not automatically launch a browser, open an MCP window, or register an embedded card player.

TikTok single-video URLs and share links can be submitted through the existing media-import workflow. The local worker downloads, validates, and saves the video. The installer prepares the download tools, and older installations fill in missing locked dependencies on first use. Platform access restrictions can still prevent a download; the task response reports the reason. See [Local downloads](docs/architecture/installation.md).

Official cloud services provide **template update distribution and unified model API billing**. Local editing, rendering, and template updates do not consume official model API credits. You can use either an **official API plan** or **your own provider configuration**. Images, video, and audio share the model catalog and media workflow. Custom provider connections are managed through configuration files. See [Model services (Chinese)](docs/architecture/model-services.md) for configuration, billing, and provider support.

Video generation preserves the model's native audio where possible. New or replacement voiceovers default to **ElevenLabs Eleven v3**; local system TTS is not provided. fal profiles and local timeline support also cover ElevenLabs Music, Sound Effects V2, and MiniMax Voice Clone with voice reuse. These newer profiles still require price verification and live-generation acceptance; historical MiniMax speech and Scribe v2 transcription results remain documented separately in [Audio workflows (Chinese)](docs/speech.md).

## Run from source

Requirements: Node ≥22.19, pnpm 10.28.2, uv, Python 3.12/3.13, and FFmpeg/ffprobe with libx264.

```sh
make setup
pnpm demo
pnpm dev
```

Keep the service running and use another terminal to run `pnpm clients install codex`, `pnpm clients install claude-desktop`, or `pnpm clients install claude-code`. Run `pnpm clients install hermes` on the machine where Hermes actually runs. Reload MCP in the client afterward. Existing MCP configuration is preserved; the macOS source installer stores credentials in Keychain. New client keys have no paid-generation budget by default. See [Installation and activation](examples/clients/README.md#installation-and-activation).

Open <http://127.0.0.1:4310> for the standalone web interface or workspace. A loopback-only local service connects the browser automatically using a 24-hour HttpOnly / SameSite=Strict session. The service creates `.data/local-admin.key` on first startup; keep this file private and do not commit it. The key is not exposed to the browser or stored in URLs or localStorage. Remote or proxy deployments still require explicit authentication. Logging out or revoking the original key invalidates the session.

Run the demo and development service separately: the embedded database cannot be opened by two processes using the same directory. The default PGlite database persists accounts and tasks in `.data/db`, with files in `.data/assets`; a background worker starts with the service. This works without PostgreSQL or Docker. Production deployments use PostgreSQL and pg-boss; see [Self-hosting (Chinese)](docs/architecture/self-hosting.md).

`pnpm demo` runs local E00–E07 checks and produces MP4s, SRTs, preview frames, test audio, and version diffs. The output path is recorded in `artifacts/acceptance/latest.txt`. It does not download model weights or make paid requests. Audio fixtures are explicitly labeled synthetic test tones, not narration.

## Conversation and editing workspace

The default entry point is the existing Codex, Hermes, or Claude conversation. Upload media or provide a script, follow task progress, and request revisions. The Agent returns text and an “Open workspace” link. Clicking it opens `/workspace` for previewing, editing, and exporting. `/` remains available for standalone use and development; `/tools` provides speech, model, and usage tools.

Both interfaces share projects, media, tasks, versions, and edit history. Supported edits include captions, trimming, splitting, deletion, ordering, replacing visuals while keeping audio, volume, background music, aspect ratio, and restoring history. Each saved edit creates a new version; edits based on an outdated version return a conflict. Opening or closing the workspace does not regenerate media.

The host Agent calls `workspace_commit` directly. On completion, `workspace_result` returns media resource links, on-screen copy, and the workspace link. Codex/Hermes bridges with an export directory save attachments automatically; other hosts use media links. Set `delivery: "links"` to skip local saving. `workspace_export` retries export without regenerating. Use `workspace_request_save/get` to preserve a request while waiting for missing media. MCP does not advertise Apps resources.

Free-form creation inside the web interface can optionally use a creative model. Without one, it handles explicit editing instructions, existing media, and script cards. See [Dual-mode architecture (Chinese)](docs/architecture/dual-mode.md) and [conversation delivery acceptance (Chinese)](docs/acceptance/native-conversation.md).

## Features

- Local character and appearance profiles, named creative standards, structured rules, conflict checks, and per-project rule snapshots. See [Character profiles and creative standards (Chinese)](docs/tutorials/本地人物与创作规范.md).
- Shared HTTP/MCP services for projects, plans, media, immutable versions, revisions, variants, feedback, jobs, and usage.
- Reference-based adaptation, text-to-template composition, and time-based source-video cuts. Caller-supplied reference observations are labeled `precomputed`.
- FFmpeg composition with images, video, original graphics, captions, voiceovers, original audio, background music, text cards, B-roll events, source-time mapping, and vertical contain/cover layouts.
- Constant shot speed from 0.25–4× with pitch preservation, audio fades, volume keyframes, and source-audio waveforms. MCP, the workspace, and exports share the same parameters. See [Audio editing acceptance (Chinese)](docs/acceptance/audio-editing.md).
- Revisions by shot, caption style, and language; reusable partial TTS outputs; word events updated from supplied alignment timestamps; separate versions for opening variants.
- Upload intents, SHA-256/length/media validation, tenant isolation, SSRF protection, private media access, and revocable one-hour preview permissions.
- API key issuance, rotation, revocation, scopes, and budgets; atomic budget reservations, idempotency, transactional outbox, leases, cancellation, and manual cost reconciliation.
- fal queue adapters for image/video/TTS and structured reference analysis/translation, including validation, estimates, submission, polling, cancellation, and collection. Paid providers are disabled by default. WhisperX is an optional adapter with a separate environment.

## Validation status

Live examples of reference analysis, image/video generation, and cloud speech are recorded in [core acceptance (Chinese)](docs/acceptance/core-functional-2026-10-15.md) and [speech acceptance (Chinese)](docs/acceptance/speech-2026-10-15.md). These examples do not establish completion of every G0–G6 gate or readiness for all commercial use cases.

Complex-subject model quality, local WhisperX ASR/alignment, automatic person tracking, translation/dubbing quality, additional real Agent clients, and the full public-release workflow still require separate acceptance. Template planning, centered contain/cover framing, and preset captions do not provide LLM creation, person tracking, or ASR respectively.

Local FFmpeg processing has been exercised. Missing model, billing, or hosting configuration returns an explicit error or `blocked_external`; it does not silently switch models or fabricate results. Local system TTS has been removed.

## Development commands

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
uv run --project python python -m unittest discover -s tests -p '*_test.py'
pnpm build
make verify-provenance
make verify-contracts
make verify-local
make verify-service
```

`pnpm verify release --automated` runs the build, full regression suite, real-media tests, and isolated install, upgrade, and rollback checks. Its report is bound to a source fingerprint. `pnpm verify release` additionally requires evidence from real clients, a clean machine, and release-license review. Generation releases use `--scope generation` and require live-model acceptance; missing evidence produces a nonzero exit. See [Release verification (Chinese)](docs/architecture/release-verification.md).

`verify-media-ai`, `verify-live`, and `verify-clients` do not automatically perform manual or paid acceptance or infer the current environment from historical results. The local demo does not replace long-source-video tests, human reference judgments, or live-provider acceptance.

## MCP and HTTP

- Remote MCP: `POST http://127.0.0.1:4310/mcp` with `Authorization: Bearer <workspace-key>`.
- stdio: inject `VIDEOWORKBENCH_API_KEY` and `VIDEOWORKBENCH_URL`, then run `pnpm stdio`. It connects to the running service without opening another local database.
- HTTP tools: `POST /api/tools/<tool_name>` accepts the same JSON input as MCP and returns `{result: ...}`.
- Uploads: call `upload_create`, then `PUT /api/uploads/<id>` with the same Bearer key.
- Private downloads: `GET /api/assets/<id>/file`. A remote service cannot read absolute paths on the user's computer.

The default conversation workflow is `workspace_commit` → `workspace_result`. Before revising, call `workspace_snapshot` and submit the latest `baseRevisionId`. Use `workspace_plan` when a reviewable plan is useful.

The lower-level workflow is `project_create` → `plan_create` / `revision_create` → `job_submit` → `record_get(type=job)`. Submit within the user's authorized scope; a separate quote is optional and `quote_create` is used when the user asks for pricing. Internal validation, budget reservation, and settlement still apply. Reconnect using the original `job_id`; retry submission with the original idempotency key. Reusing a key with different content returns a conflict. See [Client setup](examples/clients/README.md).

## Paid providers

To enable fal, inject `FAL_KEY` on the server, configure reviewed model profiles, enable `ENABLE_PAID_PROVIDERS=true`, and set account/key budgets. `.env.example` documents the variables; the service reads its process environment and does not automatically load that file. Historical credential references are not credentials or evidence of a current balance.

`deploy/fal-models.example.json` is intentionally not executable as-is. Verify endpoints, fixed parameters, pricing versions, and worst-case costs before setting `hardBoundConfirmed`. Callers cannot override provider parameters that affect cost. Profile changes invalidate earlier quotes and jobs that have not yet been submitted upstream.

A fal response is not a final invoice. Pending costs and reserved budgets remain available for administrator reconciliation against provider usage records. Estimates are not reported as actual charges. Submission timeouts enter `submission_unknown` and are not automatically repurchased. Paid execution stays disabled until a budget is authorized.

Video selection defaults to compatible Seedance Mini for face-free tasks. Faces or unknown face status block every Seedance variant: recommend MiniMax, offer Kling, and obtain or reuse the user's explicit model choice through `video_model_resolve`. New Seedance Mini profiles have unconfirmed cost bounds and cannot execute until reviewed/configured. Existing MiniMax H3 profiles retain their configured availability. A custom `FAL_MODELS_FILE` replaces the defaults.

The historical H3 profile used `minimax/h3/text-to-video`, 768P, five seconds, and a maximum US$0.30 quote at the public rate checked on 2026-10-11. Verify current provider prices before enabling it. The local H3 example is a public fal sample, not a new generation. `scripts/h3-ui-fixture.ts` imports an already-downloaded copy through authenticated upload without purchasing generation. See [UI acceptance](docs/acceptance/ui-replica.md).

## Repository structure

| Path | Purpose |
| --- | --- |
| `apps/server` | Service and authentication |
| `apps/worker` | Background execution |
| `apps/studio` | Conversation and editing workspace |
| `apps/mcp-card` | Conversation result-card implementation |
| `packages` | Shared contracts, core, storage, MCP, providers, recipes, rendering, and database |
| `python` | Media execution |
| `examples` | Eight example workflows and client setup |
| `tests` | Contract, service, media, and security tests |

The interface uses a light conversation view and a dark assistant/player/timeline/media workspace at `/workspace?project=...`. It supports draft undo/redo, split/trim/reorder, captions, sound, format, fit, annotated-frame attachments, and immutable saved exports. On phones, bottom tabs switch between preview, conversation, editing, and media.

Original implementation work does not copy Hypit source code, Skills, or examples. Historical `plans/`, `research/`, and `outputs/` remain separate; see the [implementation plan (Chinese)](plans/框架搭建与开源整合实施计划书.md). The source includes the Apache-2.0 license text. Dependency, model, media, and service rights are described in [Third-party notices](THIRD_PARTY_NOTICES.md).

## Export public source

Run `pnpm export:public` to create `artifacts/public-source/<timestamp>/` and a file-hash manifest using `public-release.json`. The export includes the local workspace, MCP, media execution, template protocol/client, custom-provider adapters, and tests. It excludes the official cloud backend, real configuration, runtime data, research, and development samples.

The command refuses to overwrite an existing directory and does not create a Git repository or branch or publish externally. The export uses the separate [public README](docs/open-source/README.public.md). See [Open-source boundaries](docs/open-source/boundaries.md). Export and build checks do not replace license and media-rights review.

## Official cloud platform

Official template distribution, the unified generation API, R2 storage, operations, and deployment configuration live in `rikoko-platform`. This repository retains template synchronization, the official generation API client, and custom-provider integrations.

Local projects remain editable and renderable with FFmpeg. Templates synchronize only on request, and existing projects retain their template snapshots. The repository split did not change existing service addresses, configuration keys, or live deployments.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:media
```

To update shared platform code, `pnpm pack:runtime` builds a versioned package with file-scope checks. See [Repository layout (Chinese)](docs/architecture/repository-layout.md).
