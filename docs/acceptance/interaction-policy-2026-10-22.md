# User requirements, creative choices and usage — 2026-10-22

## Behavior

- `workspace_request_save` preserves actual user turns and separate `userRequirements`. Without extraction, complete nonempty user messages become requirements. Extracted requirements retain a zero-based source turn and exact quote; fabricated quotes and agent-only requirement replacements are rejected. Actual user follow-ups can change requirements without a second approval step.
- `production_plan_save.plan.creativeChoices` contains the Agent's decisions and reasons. A request-bound plan receives a snapshot of the user's requirements; declared preservation of action/camera/timing/framing is checked against the production method. Existing records remain readable. This is structural traceability, not automatic interpretation of every user sentence or independently authenticated consent.
- Request/plan responses provide `communication.mode=inform_and_continue` and `requiresConfirmation=false`. Guidance calls for a short statement of what stays, what changes and the approach, followed by execution within existing authority. Genuine ambiguity, changed user constraints, required model/account choices and expanded spending remain exceptions. There is no notice-acknowledgement gate or per-shot approval.
- Conversation-facing creative rationale stays local during cloud context synchronization. Execution requirements, shots, method, references and their version/hash checks remain in the transmitted plan.
- `task_usage` reports actual charges for explicit owned job IDs, deduplicating repeated IDs and remote mirrors. Hosts include analysis, generation and authorized retries, including failed/cancelled jobs. Only confirmed/settled customer charges contribute to totals; reservations and provider-cost estimates do not. Credit counts are used only when returned; cents remain USD, external and testing billing remain separate. Mixed credit/monetary reporting remains visible.
- `workspace_result.usage` covers its delivery job only, and its presentation explicitly directs the host to collect the full task total. A free render never establishes a free production. The Studio generation result displays its own usage. Pending settlement does not delay delivery or authorize another request.
- Capabilities publish the interaction policy and startup runtime/guide identity. Health no longer returns the hardcoded `0.1.0`. Guide requirements and doctor now detect bridges missing `video_model_resolve` or `task_usage`.

## Verification

- First focused run: 49 tests passed (requirements, usage, guides, delivery, face policy and generation UI).
- Full regression: 110 files passed, 1 skipped; 860 tests passed, 1 skipped.
- Subsequent cloud-transport and mixed-usage changes: 14 relevant tests passed. The initial added cloud assertion ran before synchronization; moving it after preparation verified the actual outgoing plan and preserved shots.
- Final build, TypeScript, guide-manifest verification, changed-file formatting and diff whitespace checks passed.
- No paid generation or supplier purchase was performed. Cost scenarios use fixtures; real job usage was read without submitting or retrying jobs.

## Local runtime activation

The running local backend was the `20261021-sneaker-dimensions` snapshot; its guidance still advertised the older MiniMax default. Codex/Claude launch settings pointed at `20261021-minimax-preservation`, while Hermes pointed at the sneaker snapshot.

Activated `/Users/west/project/rikoko-mcp/.data/releases/20261022-interaction-policy/runtime` after checking there were no unfinished workspace jobs. Graceful shutdown, a private database backup and the prior runtime/configuration were retained. All 204 existing job records remained. Credentials, provider/account routing and host import/export settings were preserved. No remote cloud service or unrelated local validation service was restarted.

Runtime package SHA-256: `203639e7cc60ae15f95ca1a105488ee1611f2b595eced9af3903aa616cab03bf`.

Guide version: `951950cb9ebddcaf539e49c71bc56553eca26cd6a5f699e2ee85388f14bb2d99`.

All four installed launch profiles (Codex, Hermes, Claude Code and Claude Desktop) passed fresh stdio doctor checks: 83 tools, including the new usage and face-model tools, and matching backend guides. A fresh real MCP client verified the request/plan schemas and deduplicated usage. A hypothetical face scene with no reference inputs returned `capability_gap` and required user interaction, with no Seedance candidates; this does not establish availability for a real reference-based task.

The current conversation's existing MCP process can read the new capabilities and backend guide, but its already-cached tool schemas remain old until the host reconnects. Computer Use refused access to the Codex app itself, so no app UI reload or app restart was performed. Reconnecting rikoko MCP is the remaining host-session action; fresh connections are verified.

Private activation, backup and stdio evidence lives under `.data/releases/20261022-interaction-policy/`; do not publish its credential-containing config backups. Changes remain on the existing branch, uncommitted and unpushed.
