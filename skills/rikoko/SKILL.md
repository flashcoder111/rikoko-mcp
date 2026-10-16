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

## Video analysis precision

Support `/rikoko analysis [overview|shots|recreate|auto]` through `reference_analysis_settings`. Accept Chinese aliases 概览、逐镜头、复刻、自动. No argument reads the current setting; `auto` resets it. Confirm that it is the account default for future analyses. A command alone only reads/saves this preference and never starts analysis, uploads, quotes, rendering or purchases. Unknown arguments leave the setting unchanged. The studio uses `/analysis` with the same persisted setting.

Explicit per-task detail wins over the saved account default, which wins over automatic inference. Read `reference_analysis_settings` to choose the workflow; omit `detail` from plan/analyze when the user has not overridden it for this task, so the server resolves the saved preference. With `auto`, ordinary analysis uses `shots` and remake/later-generation uses `recreate`. Explicit “概览/quick summary” → `overview`; “逐镜头/shot breakdown” → `shots`; “复刻精度” → `recreate`. Keep requested focus such as motion, camera, appearance, text, audio or continuity; persist it with the existing workspace request when available. A phrase like “只把第 5 镜动作展开” means read that shot's original-source range and prepare a focused recreate plan. Prepared tasks keep their resolved detail even if the account default later changes.

For complete-shot or recreate analysis, use `reference_analysis_plan` then `reference_analysis_prepare`, following every `nextOffset`. This creates actual local clips and representative frames. Quote each returned exact `reference_analyze` input directly; never recursively plan a prepared clip. Present the intended call count and aggregate quoted charge for the bounded set before purchasing. Reuse accepted inputs and existing jobs; do not retry purchases or exceed the agreed scope. Use `reference_analysis_merge` only after all segment reports are available. Keep original reports when adding a focused analysis.

Read full `shots` records before generating: starting and ending state, spatial relationships, lighting, ordered `actionStages`, and continuity. A static shot may have no stages. Complex motion needs its observable stages; a word count is not a quality guarantee. Generate separate image and video prompts from these records, retaining neighboring end/start poses as context without adding neighboring scenes to the current shot. Never use the chat overview as the production prompt or invent unseen preparation, contact, landing or outcomes. If a full record exceeds a generation prompt's length limit, author a bounded prompt without dropping the user's important constraints; the full analysis remains stored.

Local cut detection produces candidates. Long continuous shots can be divided into processing windows, which are not verified new shots; report that distinction. On the fal video route, actual FPS remains provider controlled. A detailed prompt or a local clip does not prove higher FPS or frame accuracy.

## Native audio and post-production sound

Preserve the video model’s actual native dialogue, ambience and effects by default. Independent speech is for requested later changes or replacement; default to available **ElevenLabs Eleven v3** (`elevenlabs-voice`). Read capabilities first. Local system TTS is removed. Never silently select MiniMax speech or a system voice when Eleven v3 is unavailable.

- **Narration replacement:** quote `tts` with `engine=fal`, explicit model, text, language and voice; retain visuals and change only the intended audio.
- **Music:** use a configured audio/category=music profile such as `elevenlabs-music-30s`; describe mood and instruments and inspect fixed `music_length_ms` and `force_instrumental`. Generate with `parameters={}`; use a `music` edit to mix the returned asset.
- **Sound effects:** use audio/category=sound, e.g. `elevenlabs-sound-5s`; inspect fixed `duration_seconds`. Use a `sound` edit with sceneId, eventId, assetId, offsetMs, durationMs, gain and optional audioSourceStartMs/wordId. Setting assetId=null removes that effect. Effects mix with native audio, narration and music instead of replacing them.
- **Voice cloning:** use `minimax-voice-clone` with `mode=voice_clone`, an owned audio reference with role=voice and preview text as prompt. Check the profile’s measured duration/size limits. Review the preview and retain its output asset: `provenance.voiceClone` contains the provider-specific voiceId and reuseModel. For later synthesis, submit `tts` with that reuseModel, voice=voiceId and voiceAssetId=the clone output. MiniMax clone IDs are incompatible with Eleven v3 and cannot move between provider accounts. A new MiniMax clone must be used with TTS within 7 days to retain it; this requires its own quote, not an automatic purchase. Do not clone again for each line.

Music, effects, cloning and later cloned-voice synthesis each use their own quote and user agreement. Configuration and mock tests do not establish live voice or music quality.

## Missing material and follow-up replies

Before asking for genuinely missing media or facts, call `workspace_request_save` with the original message, existing asset IDs and specific `missingInputs` (kind, prompt, purpose and required). Keep optional inputs non-blocking. On a follow-up, read `workspace_request_get`, import accessible user-selected attachments and save only the remaining gaps using the current `requestVersion`. Do not claim an attachment was imported if the host did not expose its bytes. Preserve the original intent and accepted assets. Pass `requestId` and `requestVersion` to `workspace_commit` once ready. `workspace_plan` persists and resumes requests too, including attachment-only turns. Paid generation still requires agreement to its quote.
