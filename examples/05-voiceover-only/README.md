# E05 / 05-voiceover-only

Post-production voiceovers default to cloud-based ElevenLabs Eleven v3; local system TTS has been removed. Offline E05 verifies that local speech requests are rejected, without purchasing or fabricating cloud speech.

Run `pnpm demo` from the repository root. The shared script creates assets and runs all eight examples in sequence; run it separately from the development service. Evidence for this example is written to `artifacts/acceptance/<run>/E05*.json`.

See [request.json](request.json) for input configuration and the E05 section of [scripts/demo.ts](../../scripts/demo.ts) for the runnable implementation. Resume by querying the returned `job_id`; do not resubmit an existing job with a new idempotency key. Rerunning the full demo creates new projects without overwriting earlier versions.

This example records local implementation checks, not completion of the corresponding full AI or human quality gates in the implementation plan.
