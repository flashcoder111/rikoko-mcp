# rikoko MCP 0.1.40 direct media release

The official cloud client uploads references directly to signed R2 URLs and imports cloud video results directly from R2. Initialization, completion and result authorization remain authenticated JSON calls to the business API. R2 receives no account token. Existing reference snapshots retain their shape; MIME is read from the owned source asset before upload.

## Validation

- 931 TypeScript tests passed, one pre-existing test skipped; ten real Python media tests passed. Build, guide manifest, license inventory and Bash syntax checks passed.
- Twelve focused cloud reference/direct media tests passed, covering MIME/hash/byte binding, upload reuse, ownership rejection, signed URL validation, credential separation, empty video rejection and large analysis reports.
- An isolated cloud account uploaded a 913,307-byte video to real R2 through GatewayClient and obtained a real Gemini quote for 400 credits. A repeated quote reused the uploaded asset. No inference was purchased in this client transport test.
- A completed fixture job referencing that verified upload exercised the real business result endpoint: 1,285 bytes of JSON from the business API and 913,307 bytes downloaded directly from R2, with matching SHA-256. The fixture does not claim a newly generated model video.
- The exact existing public 0.1.36 archive upgraded to the candidate 0.1.40 public archive in an isolated installation. Projects, revisions, media byte hashes, credentials, model configuration, instance identity and Codex/Claude Code settings were retained. Repeated installation, three concurrent stdio MCP connections, actual local FFmpeg export, failed-upgrade rollback and interrupted-upgrade recovery passed on macOS arm64.
- The public archive contains 480 source files with verified manifest hashes and no symlinks/path traversal. Archive SHA-256: `abbf70496b14e7e5550752d0a054fba895fc6347ffafb87f8aec74bda3e42a54`.

Installation tests reuse cached dependencies and temporary MCP host profiles; they do not claim a clean-machine or graphical host matrix acceptance. Native Windows remains an experimental preview. The automated release report separately retains missing manual acceptance evidence as `releaseReady=false`.

MCP TikTok import downloads locally, then uses direct R2 upload for official cloud analysis. The web app imports through the media Worker. Gemini consumes the R2 URL; TikTok page/CDN URLs are not represented as reliable direct Gemini input.

Evidence: `artifacts/release/2026-10-24T09-10-52.213Z/`, `artifacts/direct-media-archive-validation.json`, and the platform workspace's `artifacts/mcp-direct-release-2026-10-24/`.
