# Production enforcement regression — 2026-10-18

Scope: review items 1, 2, 3, 8, 9, 11 and the model reference syntax portion of 12. Local work on the existing `main` branch, preserving the existing worktree. No commit, push, release, deployment, host configuration change, or paid model generation was performed.

## Implemented behavior

- Reference-input video generation requires a frozen preparation at quotation, submission and worker validation. Video generation requires a target canvas; preparation with a saved plan inherits its dimensions and default production scope. `RIKOKO_ALLOW_LEGACY_GENERATION=true` is an explicit server migration switch, disabled by default. It does not waive storyboard target plans or final-delivery acceptance.
- Saving a target plan creates a default scoped project. Unscoped compositions cannot become final-ready. `workspace_commit` accepts the first composition in that empty scoped project.
- Completed previews remain inspection results: no Hermes `MEDIA:` line, automatic native attachment, resource attachment block, or final-delivery instruction. Explicit preview export still saves inspection files. `workspace_export` defaults to final and uses the same acceptance gate.
- Plan state maps remain structured through comparison. The compiler emits readable sentences in deterministic object-key order, rather than serialized JSON. Template/compiler versions are v2; the changed preparation adapter contract requires older local preparations to be rebuilt.
- `ACTION_RANGE_CUT` is an error when used source intervals omit an accepted action's start, completion, or settled result. Source time includes trim and playback speed; contiguous scenes mapped to the same target shot can jointly cover an interval. `holdMs` defaults to 200 ms; explicit zero remains possible for an intentionally hold-free edit. Sampling covers the declared hold. Unclassified discarded tails remain warnings.
- The public source manifest includes every skill playbook. Export and installation reject missing, empty or invalid linked references before reporting success.
- Storyboard extraction returns source observations with `readyForGeneration=false`. Both local and cloud preparation/quotation require a target plan for storyboard generation; legacy source-action prompt generation is removed.
- `reference_adapt` accepts `replacements[].productionShotId`. With a saved remake plan, assembly follows target shot order and dimensions, supports independent source-to-target mapping, and returns its scoped project. Ambiguous source-only mappings are rejected. Replacement video uses its full duration unless a different timing policy is explicit.
- Profiles declare reference syntax. Kling O3 uses case-sensitive `@ImageN`/`@VideoN`; MiniMax first-frame prompts use natural descriptions without invented `@` markers. Preview accepts a model ID; shot prompts accept separate video and image model IDs. Preparation validates provider field order using the same syntax.

## Verification

The new enforcement suite was first run against the old behavior and failed all 12 initial assertions. The corrected implementation passed those checks; subsequent tests cover cloud pre-upload rejection, explicit legacy mode, target-plan assembly, structured state comparison, split/gapped cuts and model-specific syntax.

- `pnpm test:coverage`: **77 test files, 585 tests passed**, exit 0. Statements 88.20%, branches 83.92%, functions 89.86%, lines 89.15%; all four configured 80% thresholds pass.
- Final targeted enforcement/preparation/review suites: **78 tests passed** across 5 files. Additional host delivery, cloud compatibility, remake assembly and Kling workflow suites passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed (TypeScript plus studio and MCP card production bundles).
- `git diff --check`: passed. Current branch remains `main`.

The full suite includes the real public source export check, verifies all linked playbooks are present, and exercises local media rendering/extraction without purchasing generation.

Evidence uses synthetic fixtures and mocked provider/cloud requests, with real local media extraction/rendering where the existing tests require it. These checks establish protocol and editing behavior, not the visual quality of newly generated paid footage. The local changes must be released to both endpoints and clients reconnected before they affect installed/cloud users.
