# Hermes adapter

## Continue a studio edit

The studio's “交给 Hermes 继续” saves a scoped request with `workspace_handoff_prepare`; it does not send a message or start a model. The optional rikoko desktop plugin opens a user-selected existing conversation and appends a continuation draft without overwriting existing text. The user sends it in Hermes. A copyable prompt is available when the desktop plugin or deep link is unavailable.

For a handoff, call `workspace_request_get` with its exact requestId, then `workspace_snapshot` with its projectId. Use the latest revision and verify that the selected scene still exists. If the request is already submitted, read the existing job instead of resubmitting. If the project changed since the request, reconcile the user's intent with current state; never overwrite newer edits or restore the old composition implicitly. Apply caption and existing-music edits with `workspace_commit`, preserving source video asset IDs and passing requestId/requestVersion. Generate new media only when explicitly requested and within the requested scope, without a separate price confirmation. If the request is not found, check that the conversation uses the same rikoko workspace; do not guess another project. Return the same project's workspace link after saving. A browser pinned to an older revision can use “载入最新版本”.

Use natural language mentioning rikoko; no Skill command is required. Use `rikoko_guide` with the matching topic. Read only the current task's references. Never use Hermes's global `/model` to select a rikoko generation model.

## Import actual attachments

Use the attachment path exposed for this conversation and the actual `asset_import_file` import roots. macOS Hermes Desktop's installed profile can allow `~/Library/Application Support/Hermes/composer-images/`; CLI, server and gateway deployments have their own paths. Do not derive a file path from a thumbnail or assume that a Telegram/Feishu attachment is in the Mac directory.

For `FORBIDDEN`, copy the selected material into an allowed directory when accessible and authorized, or explain the required directory/mount change. For an expired path, request reattachment. Do not repeatedly retry an unchanged rejected path, scan unrelated cached attachments or broaden the allowlist automatically. A remote connector must be able to read the real bytes on its own machine.

## Determine what the model can see

### Text-only hosts and visual claims

Keep the user's selected host model, including DeepSeek. Receiving a file path, generating a contact sheet, or calculating brightness/edges/white-pixel counts does not mean this model saw the image. Do not diagnose objects or declare a visual repair successful from those numbers. When pixels cannot reach the active model, retain unknown and ask the user to judge the exact critical image; do not buy an extra vision call or change the host model automatically.

`CRITICAL_IMAGE_REVIEW_REQUIRED` is a prerequisite, not an outage. Follow its asset-specific issues: inspect actual pixels, record the quick image check, then retry the preparation. Reuse current checks; do not manufacture a pass, remove storyboard/plan fields, reimport an image or create a different project to evade it. `finalReady` remains technical readiness, while `reviewAccepted` is separate.

For a user-reported defect, inspect the original input and the affected output interval separately before choosing the repair stage. After an authorized replacement, inspect that exact replacement and its retained cut before saying the defect is fixed. If the current host cannot see them, preserve unknown and return the specific verification gap. A local script that replaces native image blocks with filenames does not restore vision; preserve native blocks or use an explicitly available visual reviewer. Never infer "bad first frame" from a defect that only appeared after video generation.

### Read tool data without parsing rendered media

Keep the tool's native image blocks and returned metadata together. If a bridge returns a JSON string envelope, decode that outer envelope once. An already decoded object does not need `json.loads`.

- Raw MCP response: read `structuredContent.result` for successful rikoko data; inspect `isError` and `structuredContent.error` for errors.
- Hermes response: when `structuredContent` is present, read its `result` member. Hermes may expose a structured-only response directly under `result`; inspect the actual object shape before unwrapping.
- Hermes's text `result` is presentation text. It can contain JSON followed by `MEDIA:` paths, prose or resource descriptions. Do not pass that whole string to `json.loads`, split it by lines and assume each is JSON, or discard trailing text using `raw_decode`. If structured data is unavailable, preserve the original output and use its displayed fields; report the missing structured bridge rather than guessing a parser.
- An error can be wrapped by Hermes as `{"error": "..."}` containing rikoko's error JSON. Read the error first; never treat it as successful data. Keep `code`, `traceId`, `details` and `recovery` when present. Older runtimes and protocol-level validation failures may return plain error text.

### Recover without a retry loop

After the first error, inspect the code, field paths and failed stage. Do not repeat unchanged rejected arguments. `production_plan_validate` takes the plan object directly, whereas `production_plan_save` takes `{plan, planId?, expectedVersion?}`. Fix every returned issue before saving. For `PLAN_CONFLICT`, read the owned plan with `record_get`, reconcile the change, and use its latest version; do not overwrite with stale content just to satisfy the version check.

For `MEDIA_DEPENDENCY_MISSING`, `MEDIA_PERMISSION_DENIED`, missing source/output, or `MEDIA_PROCESS_FAILED`, inspect the actual backend environment and source. Run `media_runtime_check` once when available; it checks synthetic extraction on that backend, not user media or the agent's shell. Only a confirmed `MEDIA_TIMEOUT` justifies reducing extraction samples/intervals. Never regenerate paid footage to repair an inspection failure.

Hermes can temporarily pause all tools on one server after consecutive errors, including application rejections. A pause is not a new server outage. Retain the first underlying error, wait for the stated cooldown before another call, and repair its cause. Do not disable the breaker, reconnect repeatedly, or send validation/status calls during the pause. After an interrupted write or unknown transport outcome, read existing jobs/records before retrying; never replay paid submissions.

Hermes may forward native pixels or route them through an auxiliary vision describer, depending on model/provider and configuration. Check this session's actual tool results. A detailed textual description, filename, or successful `media_inspect` call is not proof that the main model saw pixels.

For a critical input image, if native inspection images are visible, apply the one quick image-check contract. If they are unavailable, keep the output unreviewed and obtain user review or an explicitly available vision-capable review of those exact generated assets. When a separate reviewer is used, retain its identity, inspected assets/intervals and findings in review notes; the tool's `reviewer` field accepts only `host_agent` or `user`. Do not invent a third enum or assert personal observation from a generic image caption. Additional paid review requires its own authorization; there is no bundled automatic paid reviewer.

Gemini source-video analysis and generated-output review serve different purposes. Source analysis remains required for remakes regardless of Hermes's selected model; it cannot certify newly generated footage.

## Delivery and resumption

After technical delivery checks pass, use returned `MEDIA:/absolute/path/video.mp4` for the current conversation when this Hermes channel supports that mechanism. The file must exist on a filesystem shared by the agent and delivery gateway. Use the exact path from the result; do not invent a `MEDIA:` path, insert quotation marks into it, choose another recipient or call a messaging tool as a delivery workaround.

Strict delivery deployments require the export directory in `HERMES_MEDIA_ALLOW_DIRS` when `HERMES_MEDIA_DELIVERY_STRICT=1`. This is an operator setup requirement, not permission for the agent to change settings. If attachment sending fails, return available media links and the exact clickable workspace URL, or retry export. Do not regenerate. `delivery="links"` honors a links-only request. Preview output must not be presented as a final `MEDIA:` attachment.

`/reload-mcp` or a restart reloads MCP configuration. A separate doctor connection does not reload the existing conversation or prove channel delivery. After reconnection/model change, retrieve the current request, project revision, plan and jobs; do not replay purchases. Speech/audio judgment requires actual listening, not a visual judgment; uncertainty does not block normal delivery.

References: [Hermes skills](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md), [image routing](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/vision.md), [MCP reload](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/mcp-config-reference.md).

The host directs and self-checks actual material and the final cut. Use available pixels/playback and listen when capable; frame-only, motion and audio limits stay explicit. Reuse unchanged critical-image checks. Technical delivery remains available with honest failed/unknown findings. No automatic paid review or quality regeneration. Read visual-review for the shared method.
