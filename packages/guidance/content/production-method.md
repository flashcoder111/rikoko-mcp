# Separate preservation requirements from execution

Read the whole brief and call `production_method_resolve` before authoring replacements. The user's request determines what must stay. It does not force a provider endpoint. Use video_model_resolve before generation: prefer compatible Seedance Mini for face-free tasks; present/unknown faces forbid all Seedance variants and require user choice of MiniMax (recommended) or Kling. An explicit Seedance preference never overrides this rule.

Supply `intent.relationship`, `intent.change`, actual owned `sourceAssetId`, and `subjects=[{assetId,instruction}]` describing the replacement identities. `intent.preserve` combines action, camera, timing and framing. `edit_source` means change only requested content and retain all four properties; it can use either joint video/image reference generation or a dedicated edit interface. `transfer_properties` names selected properties; `reinterpret` authors new work. Do not use a camera-only recipe when body action must also stay.

Optional `model` selects the user's configured model. The resolver tests that profile's real reference inputs and returns `executionMode`, references and candidates. A `reference_to_video` name does not disqualify a source-preserving task. Conversely, an edit endpoint does not prove fidelity. Never claim that compatible inputs guarantee matching pixels or timepoints.

## Long sources and explicit excerpts

Check input-video limits separately from generated duration. MiniMax H3 video references are 2–15 seconds each, at most 15 seconds combined per request. If the original cannot fit, select meaningful source boundaries while preserving any internal cuts. Import actual excerpts and pass `sourceSegments=[{assetId,sourceStartMs}]` in chronological order. Their measured durations must cover the original without gaps or overlaps. These offsets are host-declared provenance, not automatic visual verification. The resolver never silently cuts footage.

The returned plan saves original source hash, size, duration, excerpt hashes/ranges and actual generation references. Each excerpt carries the original action, camera, cuts, rhythm and screen occupancy together. Identity images change appearance only. Do not redraw choreography, remove vehicles or turn unusual poses into ordinary running.

## MiniMax controls

Use the configured reference profile with actual `reference_video_urls` and `reference_image_urls`. Inspect `generation_prepare.referenceDelivery` before submission. Analysis or a prose description never substitutes for a video input.

Select declared parameters explicitly: fractional duration in seconds, `480P`/`768P`/`1080P`, and a supported aspect ratio. Preserve fractional source timing; do not round it into an excuse to accelerate or slow the result. Use explicit matching landscape/portrait ratio when automatic canvas choice would be ambiguous among identity images and source footage. `adaptive` is a supported provider choice, not a guarantee of exact output pixels. Final canvas remains the user's size. Keep prompt expansion disabled in the preservation profile so the provider is not asked to rewrite the direction.

## Preparation and assembly

Save the returned plan with the current request binding. Compile using returned `promptMode` and actual model. Source-preserving direction derives from the requested changes and complete source relationships; do not switch to motion-only/camera-only templates. Prepare unchanged references and parameters. A gap means fix the actual incompatibility or explain it; never drop preservation requirements to make validation pass.

Assign outputs to their ordered scope/shot. Call `production_editing_preview` with `assetId` for one clip or `assetIds` for multiple clips. Assembly retains source segment durations, speed 1 and final canvas, trimming only excess tails. Short output cannot be repaired with retiming, looping or freezing. Preserve the original soundtrack explicitly when required, muting model-generated audio rather than confusing it with the source.

When the user requests source fidelity checking, compare matched source/output timepoints, including action transitions and cut boundaries. Separate technical completion from actual identity/action/framing judgment. A failed generation does not authorize unlimited retries. Preserve old plans without executionMode as legacy dedicated-edit plans; newly resolved plans record the selected mode explicitly.

## Face review and model interaction

Before each video preparation, inspect the requested scene and every actual visual input (character/product/scene/style images, source/motion video, first/last frames). Use `video_model_resolve` with `faces=present|absent|unknown`, a short evidence reason and each reference's role/status/reason. Video review covers the complete supplied excerpt; sampled frames alone cannot establish absence. An AI-generated or stylized human face still counts under this project policy. When uncertain, retain `unknown`. No new paid analysis is automatic.

The resolver returns only configured compatible candidates, a default recommendation and a `videoPolicy` bound to asset IDs and SHA-256 hashes. With faces or unknowns, ask “本任务涉及人脸（或尚无法确认），不能使用 Seedance。推荐 MiniMax，也可以使用 Kling，你选择哪一个？” Include only available compatible options. Preserve the original task and references while waiting. Record `userChoice={model:<exact model ID>,confirmed:true}` only after a real selection, or reuse an existing explicit choice for this unchanged task. A standing default recommendation does not supply this confirmation. If the preferred model is unavailable, explain that gap; do not silently substitute another model, supplier or account.

Carry the returned `videoPolicy` unchanged into `generation_prepare.input`; keep it in the prepared input submitted to `job_submit`. Changing visual bytes, reference membership or chosen model requires reevaluation. This is host/user semantic evidence, not automatic face recognition or a guarantee that the declaration is correct. The server enforces the declared policy before uploads and generation. Explicit user requests for Seedance cannot override a present/unknown face result.
