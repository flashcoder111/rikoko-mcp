# Hermes + DeepSeek: MCP constraint hardening

Status: local source and tests only. No commit, deployment, Hermes runtime switch, host model change, paid generation or paid visual analysis was performed.

## Incident and changes

The October 19 burger-promo audit found that the host continued from explicitly unreviewed boundary images, confused file/statistical inspection with visual evidence, mixed editorial brand copy into footage prompts, and used full-clip tail frames while retaining an earlier cut endpoint.

1. **Critical image gate.** First/last frames and identity/product/scene image references require a current hash-bound quick image check, even without a storyboard. Planned boundary checks bind the current project, scope version and shot. Preparation, quote, submission and local execution recheck acceptance. Later applicable unknown/rejected reviews revoke a pass. The existing storyboard quick check can be reused; no duplicate mandatory review or automatic paid vision call is added.
2. **Footage/editorial separation.** The prompt compiler no longer automatically appends purpose, acceptance criteria or remake requirement prose. Those remain in the saved plan and host-facing response. Required visual instructions belong in states, action stages, reference responsibilities and the explicit `generationConstraints` field. Ending brand/CTA copy appearing in a footage prompt causes a structured error instead of silent rewriting. Static image-to-video holds explicitly preserve the completed first-frame state.
3. **Continuity provenance and edit endpoint.** A `previous_end` anchor must be an actual persisted `media_inspect` frame from the preceding shot's completed or assigned video in the same project. Final scoped composition validation checks that the frame comes from the selected preceding source and its retained endpoint, accounting for source offset and playback speed. This uses recorded extraction request time with a source-frame tolerance, not decoded frame-PTS proof.
4. **Honest evidence reporting.** Hermes guidance and delivery presentation distinguish technical readiness from visual acceptance. Brightness, edge counts, white-pixel counts, file paths and contact-sheet creation do not demonstrate object identity or repair success. Still-image checks do not require invented video action or audio findings.

## Validation

- `pnpm typecheck`: passed.
- `pnpm exec vitest run`: 94 test files passed, 1 skipped; 728 tests passed, 1 skipped (729 total), 153.35 seconds.
- Targeted Prettier check for the changed implementation and test files: passed.
- Focused coverage includes direct no-storyboard preparation, cloud rejection before upload/sync, stale image hashes, review revocation at quote/submission/execution, intended-shot binding, storyboard reuse, editorial copy separation and continuity source/endpoint checks.
- Existing remake tests now verify that host obligations remain available while deliberate footage instructions remain in compiled prompts; requirements were not removed from the canonical plan.
- Read-only replay of the captured `/tmp/plan-v8.json` and original S06 submitted prompt returned `EDITORIAL_COPY_IN_GENERATION`. The new compiler's constraints/editing fragments contain no exact `rikoko` copy. The unchanged old action still needs an explicit plan correction; it is not silently sanitized.
- A 4360 ms full-clip tail paired with a retained 3000 ms endpoint is rejected by the new continuity check.
- Automated image review records are synthetic test fixtures. They are not evidence that actual generated burger footage is visually correct.

## Compatibility and limits

- Keep Hermes and DeepSeek. No additional model or provider is required by these checks.
- If the active host cannot view the critical image pixels, it must preserve unknown status and obtain judgment of that exact image. These constraints cannot add vision capability to a text-only model or independently prove that a host's submitted visual judgment is truthful.
- Final AI review remains optional. Technically valid output can still be delivered with unreviewed status; structural scope, asset and continuity violations remain technical failures.
- Cloud-bound server preparations delegate image-review authority to the host workspace. The cloud server does not independently see those review pixels. Host checks run before cloud preparation and before purchase/submission.
- Old mixed editorial prompts or generic boundary-image acceptance records may now be rejected. Read the structured error, review the actual image or update the saved plan, then prepare again. Do not create another project, delete provenance, reimport frames or claim acceptance to bypass a gate.
- Existing saved plans retain all acceptance/remake requirements. Hosts must explicitly translate required footage into the generation fields rather than rely on automatic copying of review prose. New preparations may therefore compile differently.
- Real MiniMax output quality and an end-to-end Hermes + DeepSeek rerun remain unverified. The currently installed Hermes runtime was not replaced in this work.
