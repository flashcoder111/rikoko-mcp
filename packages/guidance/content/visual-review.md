# Quick image checks and direct delivery

Default policy: check critical images once, deliver completed technically valid videos directly, and never start final AI review or automatic quality regeneration. Optional review tools remain available when the user explicitly requests a review; they do not gate delivery. Read `capabilities.reviewPolicy` and `visualReview` for the installed runtime. An older runtime that still blocks delivery needs updating; do not fabricate acceptance or relabel preview output to bypass it.

## One quick check for critical images

Critical images are video first/last frames and identity/product references that determine subsequent generation. Decorative backgrounds and ordinary inserts do not require a compulsory review. Before another check, reuse a recorded judgment for the same image bytes and intended use. A new image or materially changed intended state needs its own check; unchanged images do not need repeated checks per shot, host reconnect or delivery.

Check only: (1) correct person/product, (2) major hand/product structural defects, (3) the intended starting or ending state. Ignore incidental styling and aesthetic perfection unless the user required it. Never add a paid Gemini/vision call just for this default check. For shots choosing `referenceChoice.strategy=stage_first_frame`, use that same inspection to record `startingStateChecks={stage,count,arrangement,support}` with short reasons and the current production shot binding. Check the current operation, object count, layout and support/clearance for the next action. Stage and arrangement must pass; count/support can be not_applicable with a reason. This is one image check, not another model call or a final-video gate.

Use pixels already available to the host. When the common review API needs an inspection ID, call `media_inspect` once for the image and forward its actual image blocks, not just metadata. Record `media_review` for standalone key images: `actionComplete=not_applicable` with a still-image reason, `framing` for subject/product correctness, `continuity` for the intended state, and `noArtifacts` for major defects. For storyboard first frames use `reference_storyboard_review`: `identity`/`product` cover the subject, and `composition` covers major defects plus the starting state. Identical storyboard-review retries reuse the existing version. Do not record both kinds merely to satisfy two checklists. Last-frame storyboard input uses an existing current image `media_review`.

Accept only if the host actually sees the pixels or the user explicitly judges this exact image. If the host cannot see them, keep `unreviewed`/unknown and obtain user judgment for the critical input. Do not invent a pass or purchase a separate review automatically. A known wrong critical image must not drive video. Rejection does not authorize regeneration: identify the defect and preserve the result. A repair requires explicit user instruction or an already explicit repair allowance within its remaining call/cost limit; do not infer that allowance from a general create-video request.

The host workspace enforces this check at preparation and rechecks at quote, submission and local worker execution, including direct generation without a storyboard. For a planned first/last frame, bind `media_review.production` to the current project, scope version and shot: a generic image pass does not certify the intended shot state. Image reviews use the quick checks above, not video operation/audio `qualityChecks`. A later applicable rejection or unknown review revokes an earlier pass. Server-side bound cloud preparations rely on the host workspace's review records; they do not perform a separate visual inspection.

## Deliver without final AI review

Use completed footage in composition without source-video acceptance. `production_asset_assign` retains account ownership, completed-preparation provenance and project/scope/shot binding; it does not require a visual pass. A simple unscoped composition can be delivered; when a scope exists its plan, mappings and assignments remain checked.

`workspace_commit` renders the composition. `workspace_result` defaults to `purpose="final"`; when completed and technically valid, deliver its video and exact clickable workspace URL immediately. `finalReady` means technical readiness, not creative approval. `reviewAccepted`/`status` separately retain any real optional review; unreviewed or rejected feedback must never be relabeled as accepted.

Technical checks preserve ownership, current bound scope, required assets, non-placeholder scenes, source time ranges, declared editing constraints and output byte integrity/measured dimensions/duration. They use no vision model. The worker already probes output when collecting it. No final AI analysis, frame sampling, listening report or mandatory user approval is needed for delivery. Do not turn warnings into extra review tasks or repeat generation to improve an unrequested subjective score.

`purpose="preview"` remains an explicit inspection option, with no automatic final attachment instructions. `workspace_export` saves existing files using the same technical delivery checks; attachment failure calls for returning links or retrying export, never regeneration. Keep the exact workspace link alongside native attachments and links-only replies.

## Optional review on request

When the user explicitly asks to inspect a defect, compare results or evaluate quality, inspect only the relevant media/interval. `media_review` retains its honest evidence contract: checks use pass/fail/unknown/not_applicable, source hashes and real inspection IDs. Video action-completion claims require observed action ranges and the returned coverage requirements; sound claims require actual listening. A model cannot infer a pass from metadata or a successful render.

Detailed process, sound, remake and final-revision review obligations apply only when claiming optional acceptance. Use `qualityChecks`, `requirementChecks` and exact scope/revision bindings as documented by the tools. An excerpt never certifies the whole take. Missing evidence remains unknown, but optional review status does not block file delivery. Technical violations such as an out-of-bounds source interval still do.

A requested review does not itself authorize another paid generation. Record findings, keep existing media, and repair only the specifically authorized scope. Cases without review remain unreviewed; collect them without delaying delivery or promoting a template automatically.
