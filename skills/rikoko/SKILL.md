---
name: rikoko
description: Use rikoko MCP to analyze a reference video, direct a remake or new video, revise existing media, and deliver the completed result in the current conversation.
---

<!-- Managed by the rikoko installer. Local changes are backed up before an update. -->

# rikoko

Work in the user's current conversation. Gemini analyzes original video through rikoko; the host authors the target and quickly checks critical images once when it can actually see them; rikoko executes and records evidence. Use this skill for media work, not for changing rikoko's source code or the host's settings.

## Load the relevant guidance

Read only the current host's adapter: [Codex](references/host-codex.md), [Claude Code or Desktop](references/host-claude.md), or [Hermes](references/host-hermes.md). The client's name does not establish vision, local-file access or attachment delivery. Check tools exposed in this session and whether inspection images actually reach the active model.

If local references are unavailable, call `rikoko_guide {topic:"overview"}` and then the matching topic below. It returns the same bundled Markdown over MCP without a browser, file permission or paid model call. Follow the connected runtime's schemas and capabilities; do not infer a missing tool from this document. Older runtimes need an update/reconnection for newer contracts.

| When | Read | MCP topic |
| --- | --- | --- |
| Codex | [Codex adapter](references/host-codex.md) | `host-codex` |
| Claude | [Claude adapter](references/host-claude.md) | `host-claude` |
| Hermes | [Hermes adapter](references/host-hermes.md) | `host-hermes` |
| Reference analysis, attachment import or rejected analysis quote | [Analysis preflight](references/analysis-preflight.md) | `analysis-preflight` |
| New footage or a remake | [Video direction](references/video-direction.md) and [director examples](references/directing-examples.md) | `video-direction`, `directing-examples` |
| Process continuity, action timing, soundtrack or ad endings | [Production quality](references/production-quality.md) | `production-quality` |
| First/last frames or image generation | [Image direction](references/image-direction.md) | `image-direction` |
| Assembly, handling or other physical processes | [Process B-roll](references/process-broll.md) | `process-broll` |
| Inspecting, accepting or delivering media | [Visual review](references/visual-review.md) | `visual-review` |
| Help, model choice, brief/spec changes | [Commands](references/commands.md) | `commands` |
| Video edits, TikTok import, speech, music or captions | [Media operations](references/media-operations.md) | `media-operations` |

## Start from the user's request

- Read `capabilities` before promising work. Help/model-list turns only report the catalog; analysis-only turns end with analysis. Neither implies generation or rendering. An empty skill invocation shows concise `help`, `models`, `model <id>` and `brief <request>` examples and asks for the request.
- For an existing project, read `workspace_snapshot`. Resume `workspace_request_get` for an existing request. Keep accepted assets and use the current `baseRevisionId` and `requestVersion`.
- For a new brief, use `template_match` to select a useful structure/assets unless the user declines templates. For a supplied reference, prioritize its requirements. Never invent product facts or require a reference merely to start.
- Import accessible user-selected attachments as actual assets. A thumbnail, filename or description is not an import. Save genuine gaps with `workspace_request_save` (original intent, collected asset IDs, remaining `missingInputs` with kind/prompt/purpose/required) before asking for them. Optional inputs do not block. Attachment-only follow-ups continue the same request.

## Direct, prepare and review

For generation, turn the brief into readable target shots using the direction playbooks. Describe what changes on screen, in what order, and what proves completion. Keep source observations separate from target decisions; each shot has a clear purpose, stable subjects, initial state, ordered action, end state, camera and visible acceptance criteria.

For physical processes, maintain object identity, inventory, support and completed operations across cuts; hidden does not mean absent. Budget one readable operation with approach, contact, completion and settle. A finished-product reference supplies appearance, not an assembly-stage anchor. Use the [production-quality playbook](references/production-quality.md) to plan shared audio, evidence-backed timing cues, an intentional ending and optional event-specific review when requested. Keep creative choices separate from user requirements; never call intended beats measured or visual sampling an audio review.

For remakes, obtain Gemini `recreate` analysis and read `reference_analysis_get section=handoff` through every `nextOffset`. Bind the report ID/hash, preserve/adapt/free requirements, source evidence and uncertainty decisions in `plan.remake`. Do not replace that record with a host summary. Analysis gaps that affect the target must be resolved before dependent production.

Use `production_plan_validate/save` and the saved formal project scope. Compile each shot with `production_shot_prompts` using actual model IDs; `generation_prompt_preview` previews mode-specific wording. Use `generation_prepare` for each boundary-image/video stage with the exact prompt/direction, actual owned references and supported target specs. Revise the saved plan before changing a remake prompt. Source timing does not dictate target duration; sending source composition or motion to the model is an explicit input decision.

Prefer an available MiniMax video profile that supports the requested reference roles and output specs; honor explicit model selections. The configured official gateway or custom fal connection controls availability. Model preference and budget are not quote acceptance. Present the exact quote (or bounded set and total) and obtain agreement before `job_submit`; changed billable inputs need a fresh quote and agreement. Preserve prepared input unchanged. Poll existing jobs, never resubmit to check progress.

Check critical images once for correct subject/product, major defects and intended state; reuse the same image/use judgment. Use `reference_storyboard_review` for first frames or `media_review` for other key images, without duplicate checklists. Decorative images need no gate. If pixels are unavailable, keep unknown and ask for user judgment on the critical image; never buy extra vision review automatically. Completed videos need no source or final AI acceptance before assignment/delivery. Keep complete clips by default. A failed check never authorizes automatic regeneration; repairs require explicit user instruction or an explicit remaining repair allowance.

Use `workspace_commit` for local composition/edits with a stable idempotency key and the current revision. Deliver the completed render through `workspace_result` (default `purpose=final`) once technical validation passes. `finalReady` is technical readiness; optional visual acceptance is separate. Final AI review, extra sampling/listening and automatic quality regeneration are off by default. Keep optional review available only on user request.

## Continue and deliver

After a reconnect, context loss or host switch, retrieve existing request/project, plan, preparation, job and review records by their IDs. Check current versions before changing anything. Reuse successful media and already submitted jobs; a cached chat statement of approval does not authorize changed inputs. If a required contract is unavailable, preserve the records and explain the specific missing capability instead of stripping validation fields.

Deliver completed media in this conversation using the current host's attachment support or exact returned links. Always include the returned workspace URL as a clickable Markdown link, including links-only replies, so the user can continue editing. Preserve project/revision parameters; never append credentials or invent paths. Do not automatically open a browser, MCP App, popup or separate chat. `workspace_export` saves existing outputs and does not regenerate; `purpose=preview` is for inspection and must be labeled as such. Expired links can be refreshed with `workspace_result`.

Report observations separately from inferences and unknowns. Keep progress useful: what is prepared, submitted, rendered, reviewed, or blocked, plus the next necessary action. Carry tool IDs internally; explain choices to the user in ordinary language.
