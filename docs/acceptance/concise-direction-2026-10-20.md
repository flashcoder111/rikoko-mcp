# Concise analysis handoff and authored scene direction

Status: local implementation and offline validation, 2026-10-20. No deployment, provider generation, paid retry or new visual-quality claim.

## Problem and behavior

The burger comparison showed repeated scene/state/phase prose, generic action-reference instructions and missing shot-local timing or spatial exclusions. Complete records did not ensure useful directing.

- Analysis instructions now assign distinct responsibilities to scene description, action, boundary states, stages, narrative and evidence. They ask for short factual clauses without losing observed changes or uncertainty. `REFERENCE_ANALYSIS_VERSION` is `reference-v2.3-concise`, so the changed policy gets a new cache/pricing identity. Saved reports remain readable. Actual Gemini output length/accuracy has not been remeasured.
- `reference_analysis_get(section="handoff")` and shot-prompt handoffs default to `handoffDetail="compact"`. Current-shot observations, narrative beats, uncertainty indices, coverage, binding and evidence identities/confidence remain. Repeated evidence prose, events and segment summaries/audio are accessible in the full view; neighboring shots default to their boundary states. `detailsAccess` supplies the read arguments. No new model call or lossy rewriting is used.
- Optional saved `shot.sceneDirection` is a complete authored video scene: subject, setting, initial arrangement, specific action and timing, final state and camera. It replaces separate scene-field prose in the compiled video, while structured state/action data remain in the plan/direction. Explicit constraints, selected product facts, process, kit, audio/ending requirements and real reference bindings remain active. The host must verify semantic consistency; this implementation does not claim to infer it.
- The scene path uses `rikoko-scene-direction-v1` / `rikoko-prompt-compiler-v5`. It omits irrelevant explanations about later muting from generation audio direction. Legacy structured wording is unchanged.
- First/last-frame drafts explicitly clear the video scene paragraph and continue to use their respective structured states. The plan comparison binds both presence and absence of authored prose, preventing injection through a fresh prompt preview. Exact preparation records/hashes remain required, including across the cloud path.
- Guides explain concise authoring, meaningful deadlines, stage-specific absent objects, current-shot reference roles and deliberate product-fact selection. These are general directing practices; no burger-specific behavior was added to the compiler.

## Offline burger candidate

The historical four-shot plan was copied and revised locally; its production record was not changed. The candidate includes new director prose and shot-local reference instructions. Counts measure that combined authoring/compiler change, not compiler compression in isolation.

| Shot | Previous English words | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| S01 | 375 | 220 | 41% |
| S02 | 385 | 209 | 46% |
| S03 | 372 | 224 | 40% |
| S04 | 427 | 255 | 40% |

The same historical four-shot handoff serialized to 27,179 bytes in full view and 15,450 bytes in compact view (about 43% less). This is a read-view measurement, not a new Gemini generation result.

Local comparison artifacts: `/Users/west/project/rikoko test/comparison-2026-10-20/prompt-analysis/optimized-candidate/` (`对照.md`, four exact candidate prompts, `candidate-plan.json`, `metrics.json`). These are unsubmitted drafts, not replacement production assets.

## Validation

- Initial five focused tests failed before implementation, then passed.
- First regression group: 6 files / 83 tests passed.
- Expanded contract group: 11 files / 121 tests passed, including cloud preparation, source report reads, process constraints, host guides and exact plan binding.
- Follow-up group: 6 files / 53 tests passed, including the added process/audio/ending preservation test, analysis provider routing, cloud reference, enforcement and direct delivery. Test groups overlap.
- TypeScript checking passed; the guidance manifest was regenerated and validated.
- The turn-specific diff was reviewed against a pre-edit filesystem snapshot to preserve the existing dirty worktree. No new Git branch, commit or deployment.

Remaining empirical check: compare old and candidate prompts using the same provider profile, images/videos and generation controls. Repeat samples before attributing quality differences to wording. No automatic quality retries were introduced.
