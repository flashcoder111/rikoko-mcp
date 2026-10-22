# E03 / 03-rawcut-reframe

Select explicit time ranges, apply contain framing, and preserve source-time mappings. This example does not perform ASR or face tracking.

Run `pnpm demo` from the repository root. The shared script creates assets and runs all eight examples in sequence; run it separately from the development service. Evidence for this example is written to `artifacts/acceptance/<run>/E03*.json` and `artifacts/acceptance/<run>/outputs/E03*`.

See [request.json](request.json) for input configuration and the E03 section of [scripts/demo.ts](../../scripts/demo.ts) for the runnable implementation. Resume by querying the returned `job_id`; do not resubmit an existing job with a new idempotency key. Rerunning the full demo creates new projects without overwriting earlier versions.

This example records local implementation checks, not completion of the corresponding full AI or human quality gates in the implementation plan.
