# Import and reference-analysis preflight

Read this before analyzing attachments or diagnosing a rejected analysis preflight. It applies to every host; use the current host adapter for paths and image visibility.

## Explicit local Codex analysis

When the user explicitly selects local Codex analysis, use `media_inspect` and actually view the returned images, then `reference_analysis_record` with `host=codex`, `imagesViewed=true`, all inspection IDs and honest recreate content. Cover the source with requested seek gaps no greater than 500 ms; use denser samples for critical motion. Sampling coverage does not prove continuous motion or action correctness. The record retains source/frame hashes, requested seek times, estimated shot boundaries, unknowns and unreviewed audio. Do not claim speech or sound from frames.

This is a distinct `host-sampled` record with no provider job or analysis charge. It does not relabel host observations as Gemini output. Register on the runtime/account that executes the generation; a cloud mirror or uploaded JSON alone cannot establish inspection provenance. Read its complete handoff and use the usual request, remake plan, face policy, real source-video reference, preparation and budget checks. Existing Gemini analysis remains supported; do not silently switch a failed paid analysis to host analysis without the user's selection.

## Provider analysis import and scope

Confirm that the attachment became an owned asset with actual probe metadata (MIME, dimensions and duration), not merely a visible thumbnail. Read import roots from the exposed `asset_import_file` description. If a path is outside them, copy only the accessible user-selected file into an allowed directory or explain the required upload. Keep `license` short and factual within the current schema limit. For URL imports use a stable idempotency key; poll a returned download job and use its output asset ID.

Read `reference_analysis_settings`. Explicit task precision wins over saved preference; auto uses shots for ordinary analysis and recreate for a remake. Command-only analysis-settings changes must not import, analyze or buy. For full shot/recreate work use `reference_analysis_plan`, then `reference_analysis_prepare` through all pages. Prepared tasks are bounded clips: submit their exact returned inputs directly with `job_submit`, not another recursive analysis plan. For overview-only work use `reference_analyze detail=overview` when supported.

`capabilities` catalog availability, compatible analysis policy, and successful execution are separate gates. Check that the selected analysis profile satisfies the current Gemini policy and its declared upstream metadata. Metadata that is missing is unknown, not evidence that a configured model complies. The server preflight is the authoritative compatibility check; do not promise successful analysis merely because `available=true`.

## Recover a failed preflight

For `REFERENCE_MODEL_POLICY`, missing upstream declarations or `ANALYSIS_PROTOCOL_MISMATCH`, retain the saved request, source assets, analysis plan and prepared clips. Report the rejected contract and which runtime/catalog needs operator inspection. A media-production request does not authorize editing source code, patching policy checks, injecting catalog fields, changing providers, deployment or retrieving credentials. Operators can inspect the relevant runtime versions and public model metadata separately.

Do not drop `detail`/`focus`, use a host-written shot list as Gemini analysis, or pass source clips straight to generation to hide a failed handoff. Do not repeatedly submit unchanged rejected inputs. After repair/reconnection, check current capabilities and reuse valid prepared inputs; reprepare only when they are invalidated or the user changes the task.

Local clip preparation is not a successful semantic analysis. Submit each intended input with job_submit within the requested scope; no separate quote or price confirmation is required. Do not exceed the approved scope or resubmit to poll. After all analysis jobs succeed, merge all segment reports and read the complete handoff before authoring a remake. Failed parts remain visible; partial coverage is not a full-video result.

For analysis-only requests, deliver the findings, evidence and limits without generation/rendering. For brand end cards, use known brand text and supplied assets; request an exact logo only when the user requires that asset. A plain wordmark can remain an explicit design choice instead of blocking unrelated preparation.

## Concise analysis and evidence access

The analysis prompt assigns each field a distinct role: scene identity, main change, boundary states, ordered observable changes and supporting evidence. Keep factual clauses short; retain every meaningful motion, support/contact relationship and uncertainty. A static shot does not need fabricated action stages. Do not restate a shot transcript in summary, narrative beats and events.

For remake planning, the handoff defaults to a compact view of complete selected-shot details, evidence IDs/confidence, uncertainties and adjacent boundary states. This is a projection of the saved report, not a new model summary. Read all pages; use `handoffDetail="full"` or individual report sections for detailed evidence, events and segment audio when needed. The original report and hash remain unchanged. Concision is not permission to treat an unresolved action as observed.
