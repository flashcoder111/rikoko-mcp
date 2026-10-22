# E06 / 06-revise-one-scene

Revise a scene, styling, and audio. Supplied word anchors follow the revised timing; offline audio fixtures use test tones rather than generated speech.

Run `pnpm demo` from the repository root. The shared script creates assets and runs all eight examples in sequence; run it separately from the development service. Evidence for this example is written to `artifacts/acceptance/<run>/E06*.json` and `artifacts/acceptance/<run>/outputs/E06*`.

See [request.json](request.json) for input configuration and the E06 section of [scripts/demo.ts](../../scripts/demo.ts) for the runnable implementation. Resume by querying the returned `job_id`; do not resubmit an existing job with a new idempotency key. Rerunning the full demo creates new projects without overwriting earlier versions.

This example records local implementation checks, not completion of the corresponding full AI or human quality gates in the implementation plan.
