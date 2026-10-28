# Compiler and model-reference writing

This is existing runtime/adapter guidance migrated from video direction. It contains no newly validated model-specific recipes.

## Compiler and model reference syntax

Keep `initialState` and `endState` as structured object maps in the plan and returned direction. The compiler renders them into readable sentences; preparation compares the objects, not JSON text. The source storyboard returns `sourceObservation` with `readyForGeneration=false`. Its `authoredDrafts` are notes, not a generation input. Always compile the independently authored target plan.

Pass the actual video `model` and optional `imageModel` to `production_shot_prompts`, or `model` to `generation_prompt_preview`. Read `generationInput.referenceSyntax` in the profile: `kling` and `seedance` use case-sensitive `@Image1`, `@Video1` with separate image/video numbering in provider input order; `descriptive` uses ordinary prose. MiniMax first/last frames use “The first frame” / “The last frame”, with no invented `@` tokens. A preview without a model is generic; preview again with the selected model before preparing.

## Provider wording and host obligations

Before submission, read `generation_prepare.referenceDelivery`: confirm the videoReferenceCount, actual asset hashes, clip duration and provider field/array index. A zero count means no source movement is transmitted, even when Gemini analyzed the source. This is a prepared manifest, not an upload receipt or proof that the provider followed the reference. Do not claim "sent upstream" until submission succeeds; retain the job/preparation IDs for tracing. The manifest never authorizes an extra paid call.

Keep `generationConstraints` limited to visible subject/state/action constraints. `acceptanceCriteria`, remake requirements and editorial brand/CTA text remain in the saved plan and `production_shot_prompts.hostInstructions`; do not paste that block into a video prompt. The compiler does not automatically turn review criteria into footage instructions. Express required visual facts in initialState/action/endState/camera/generationConstraints. If `EDITORIAL_COPY_IN_GENERATION` is returned, revise the saved shot wording and recompile; do not use promptOverride to bypass it.

For a `previous_end` anchor, call `media_inspect` on the preceding shot's actual selected video and use the returned frame assetId directly. Extract near the endpoint that the final edit will retain, not the full generated clip's tail if it will be trimmed. Record a quick image review before continuing. Reimporting a PNG loses verifiable extraction lineage. If the selected source is a retimed/trimmed derivative, assign that derivative to the preceding shot before extracting its endpoint. Changing the final cut can invalidate the next shot's continuity binding.
