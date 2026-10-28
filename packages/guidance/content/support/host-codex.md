# Codex adapter

Use a natural-language request mentioning rikoko and discover its MCP tools. No installed Skill or `$rikoko` activation is needed. Never intercept Codex's `/model` to select a video model.

Read the backend guides with `rikoko_guide`. Discover the actual rikoko tools; names may have an MCP namespace prefix. Do not hardcode another installation's namespace or treat a tool's absence from a deferred listing as a failed backend.

## Attachments and inspection

- Use a user-selected file's actual accessible path with `asset_import_file` when exposed. The stdio connector and Codex must see the same file; a remote worker's path is not automatically a path on the user's Mac. Respect the tool's configured import directories. If necessary and permitted, copy only the selected file into an allowed directory; never widen the allowlist to the whole home directory.
- An image shown in chat is not an owned rikoko asset until imported. If bytes/path are unavailable, save that missing input and offer the configured media directory or workspace upload. A URL for a page is not necessarily a downloadable media file.
- `media_inspect` returns text metadata **and image content blocks**. When orchestrating tools in JavaScript, retain/render the image blocks using the host's supported image forwarding helper. Printing only `structuredContent` or serializing base64 does not show pixels to the model. Use the actual available helper, not an assumed global API.
- If only text reaches the model, do not write a passing visual review. Reinspect using a supported image path/tool or request user review. A local image viewer alone cannot certify a complete video's motion or audio. Record exact inspection IDs and reviewed intervals through the common review contract.

When the user selects local Codex source analysis, follow analysis-preflight and save viewed media_inspect evidence with reference_analysis_record. Keep host-sampled provenance and frame/audio limits explicit. A free-text summary or uploaded analysis JSON is not an executable analysis record.

## Delivery and recovery

For technically ready final media, the stdio bridge can return a real `localPath`. Codex app can display supported local media using `![video](</absolute/returned/path.mp4>)`; use the exact returned path, including angle brackets for spaces. CLI or remote clients may need returned media links instead. Do not assume an absolute path returned by a remote service exists on the viewing machine.

`delivery="links"` skips automatic local export. Include the exact returned clickable workspace URL with attachments and links. Export failure calls for retrying `workspace_export` or delivering returned links, not generation. Preview files remain previews.

After MCP reconnection or context compaction, read `workspace_request_get`, `workspace_snapshot` and relevant saved records. Continue the same project and already submitted jobs. No new chat, filesystem scan, model switch or host-setting change is needed for routine recovery.

The installer configures MCP only. Legacy Skill copies require explicit migration and a host reload to stop stale instructions. Host permissions and rendering support still apply independently of successful MCP initialization.

The host directs and self-checks actual material and the final cut. Use available pixels/playback and listen when capable; frame-only, motion and audio limits stay explicit. Reuse unchanged critical-image checks. Technical delivery remains available with honest failed/unknown findings. No automatic paid review or quality regeneration. Read visual-review for the shared method.
