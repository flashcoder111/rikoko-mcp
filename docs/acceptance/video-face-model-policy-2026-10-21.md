# Video face policy and model selection — 2026-10-21

## Implemented behavior

- Face-free video defaults to an available, input-compatible Seedance Mini profile.
- The requested scene and every visual input are classified as present / absent / unknown. Human faces in generated/stylized images also count. Unknown does not mean absent.
- Every Seedance variant is blocked for present/unknown status, including explicit Seedance selections and models with an alias but a Seedance endpoint.
- Face tasks recommend compatible MiniMax and offer compatible Kling. The host asks in the original conversation and records the actual exact-model choice; an existing explicit choice for the unchanged task may be reused.
- `video_model_resolve` returns candidates, exclusions, interaction instructions, and `videoPolicy`. It does not upload, detect faces, call a model, or authorize spending.
- Reference review binds owned asset IDs and SHA-256 hashes. The generate operation retains review/choice through preparation, local/cloud submission, cloud asset-ID remapping, and Worker reference resolution. Review fields never enter the upstream payload.
- Missing/incomplete visual review, stale hashes, blocked Seedance selection, or missing/wrong-model confirmation fail before generation. The local cloud gateway also enforces policy, including legacy migration mode.
- Existing non-Seedance text-only API requests without videoPolicy remain accepted for compatibility. New host guidance and the Studio composer use the interactive policy flow. Semantic truth is a host/user responsibility, not an automatic face-detection guarantee.

## Profiles and configuration

Four conservative fal Seedance Mini profiles were added: text, first frame, first/last frame, image/video references. Default output is 5 seconds / 720p; duration supports 4–15 seconds. Reference token syntax follows the verified public fal API.

Sources checked 2026-10-21:
- https://fal.ai/models/bytedance/seedance-2.0/mini/text-to-video/api
- https://fal.ai/models/bytedance/seedance-2.0/mini/image-to-video/api
- https://fal.ai/models/bytedance/seedance-2.0/mini/reference-to-video/api

These new profiles have placeholder cost bounds and `hardBoundConfirmed=false`; they are not paid-enabled. Actual account pricing/permissions must be reviewed before enabling. Existing custom model files replace the built-in directory and require explicit configuration updates. No machine configuration, credentials, deployment, running service or account balance was changed by this task.

## Verification

- Build (guide bundle validation, TypeScript, Studio and MCP card): PASS.
- Final TypeScript check: PASS.
- Full regression: 791 passed, 1 skipped, one old fixture initially failed because it referred to a nonexistent asset and now failed ownership validation before preparation validation. The fixture was corrected to use an owned asset; its complete 13-test suite then passed. No remaining known test failures.
- Final focused face-policy / cloud-reference / source-delivery / Studio-interaction run: 29 tests passed.
- New policy coverage: statements 90.09%, branches 86%, functions 100%, lines 94.18%.
- Diff whitespace check: PASS.
- Paid requests / actual generated-video quality / live deployment: NOT RUN.

Work stayed on the existing main branch and preserved unrelated workspace edits. No new branch, commit, push or deployment was performed.
