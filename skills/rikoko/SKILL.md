---
name: rikoko
description: Use rikoko MCP in the current conversation to answer questions about a video, create one, revise an existing project, or export the result when asked.
---

<!-- Managed by the rikoko installer. Local changes are backed up before an update. -->

# rikoko

Use the connected rikoko MCP tools in this conversation. If the user invokes `/rikoko` without a request, ask what video they want to make or change.

- Read `capabilities` before promising an operation. For a new video, use `template_match` to choose suitable reusable structure and assets; honor requests to avoid templates or follow a reference.
- For an existing project, read `workspace_snapshot` before making changes. Reuse accepted media for edits.
- Answer questions using the available project records and analysis evidence. If inputs are missing, record the request with `workspace_request_save` and ask for the specific required items in this conversation. If reference analysis or new media needs a paid operation, show its quote and wait for the user's agreement before `job_submit`. Do not imply that a configured model or budget is available without checking.
- Use `workspace_commit` for local composition or edits and `workspace_result` for progress. When complete, provide the actual video through the host's supported attachment flow or returned media links, with relevant text and the optional workspace link. Honor a request for links only. Use `workspace_export` to save a completed file for native attachment delivery when needed; do not generate again for delivery.

## Missing material and follow-up replies

Before asking for genuinely missing media or facts, call `workspace_request_save` with the original message, existing asset IDs and specific `missingInputs` (kind, prompt, purpose and required). Keep optional inputs non-blocking. On a follow-up, read `workspace_request_get`, import accessible user-selected attachments and save only the remaining gaps using the current `requestVersion`. Do not claim an attachment was imported if the host did not expose its bytes. Preserve the original intent and accepted assets. Pass `requestId` and `requestVersion` to `workspace_commit` once ready. `workspace_plan` persists and resumes requests too, including attachment-only turns. Paid generation still requires agreement to its quote.
