# Hermes adapter

Use `/rikoko <request>` or natural language. Where exposed, `skill_view(name="rikoko", path="references/video-direction.md")` loads a supporting file; otherwise use `rikoko_guide` with its matching topic. Read only the current task's references. Never use Hermes's global `/model` to select a rikoko generation model.

## Import actual attachments

Use the attachment path exposed for this conversation and the actual `asset_import_file` import roots. macOS Hermes Desktop's installed profile can allow `~/Library/Application Support/Hermes/composer-images/`; CLI, server and gateway deployments have their own paths. Do not derive a file path from a thumbnail or assume that a Telegram/Feishu attachment is in the Mac directory.

For `FORBIDDEN`, copy the selected material into an allowed directory when accessible and authorized, or explain the required directory/mount change. For an expired path, request reattachment. Do not repeatedly retry an unchanged rejected path, scan unrelated cached attachments or broaden the allowlist automatically. A remote connector must be able to read the real bytes on its own machine.

## Determine what the model can see

Hermes may forward native pixels or route them through an auxiliary vision describer, depending on model/provider and configuration. Check this session's actual tool results. A detailed textual description, filename, or successful `media_inspect` call is not proof that the main model saw pixels.

For a critical input image, if native inspection images are visible, apply the one quick image-check contract. If they are unavailable, keep the output unreviewed and obtain user review or an explicitly available vision-capable review of those exact generated assets. When a separate reviewer is used, retain its identity, inspected assets/intervals and findings in review notes; the tool's `reviewer` field accepts only `host_agent` or `user`. Do not invent a third enum or assert personal observation from a generic image caption. Additional paid review requires its own authorization; there is no bundled automatic paid reviewer.

Gemini source-video analysis and generated-output review serve different purposes. Source analysis remains required for remakes regardless of Hermes's selected model; it cannot certify newly generated footage.

## Delivery and resumption

Only after the final gate, use returned `MEDIA:/absolute/path/video.mp4` for the current conversation when this Hermes channel supports that mechanism. The file must exist on a filesystem shared by the agent and delivery gateway. Use the exact path from the result; do not invent a `MEDIA:` path, insert quotation marks into it, choose another recipient or call a messaging tool as a delivery workaround.

Strict delivery deployments require the export directory in `HERMES_MEDIA_ALLOW_DIRS` when `HERMES_MEDIA_DELIVERY_STRICT=1`. This is an operator setup requirement, not permission for the agent to change settings. If attachment sending fails, return available media links and the exact clickable workspace URL, or retry export. Do not regenerate. `delivery="links"` honors a links-only request. Preview output must not be presented as a final `MEDIA:` attachment.

`/reload-mcp` or a restart reloads MCP configuration. A separate doctor connection does not reload the existing conversation or prove channel delivery. After reconnection/model change, retrieve the current request, project revision, plan and jobs; do not replay purchases. If the user requests speech/audio evaluation, it requires actual listening, not a visual judgment; uncertainty does not block normal delivery.

References: [Hermes skills](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md), [image routing](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/vision.md), [MCP reload](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/mcp-config-reference.md).

Default policy: quickly check critical input images once using actual pixels or user judgment. Do not invoke paid vision review by default. Final videos need no AI review or listening pass for delivery, and quality findings never authorize automatic regeneration. Preserve unknown review status and return technically ready output immediately.
