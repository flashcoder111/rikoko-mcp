# E02 / 02-from-scratch

Compose an original local template without AI image or video generation.

Run `pnpm demo` from the repository root. The shared script creates assets and runs all eight examples in sequence; run it separately from the development service. Evidence for this example is written to `artifacts/acceptance/<run>/E02*.json` and `artifacts/acceptance/<run>/outputs/E02*`.

See [request.json](request.json) for input configuration and the E02 section of [scripts/demo.ts](../../scripts/demo.ts) for the runnable implementation. Resume by querying the returned `job_id`; do not resubmit an existing job with a new idempotency key. Rerunning the full demo creates new projects without overwriting earlier versions.

This example records local implementation checks, not completion of the corresponding full AI or human quality gates in the implementation plan.
