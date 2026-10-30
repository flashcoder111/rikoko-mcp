import {
  AppError,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";
import {
  videoPolicySchema,
  type VideoModelIdentity,
} from "../../contracts/src/video-policy.js";

type PolicyModel = VideoModelIdentity & {
  kind: string;
};
export function assertVideoPolicy(
  model: PolicyModel,
  input: Operation,
  assets?: Entity[],
) {
  if (input.kind !== "generate" || model.kind !== "video") return;
  // Reference roles have fixed media kinds in the operation contract. Do not
  // rely on remote catalog metadata being complete to identify visual inputs.
  const visualRefs = (input.references ?? []).filter((r) => r.role !== "voice");
  // Optional observations never require a separate face review or model confirmation.
  if (!input.videoPolicy) return;
  const parsed = videoPolicySchema.safeParse(input.videoPolicy);
  if (!parsed.success)
    throw new AppError(
      "VIDEO_FACE_REVIEW_REQUIRED",
      "Inspect the requested scene and every visual reference, then call video_model_resolve. Unknown is not face-free.",
      409,
    );
  const policy = parsed.data;
  const ids = new Set(visualRefs.map((r) => r.assetId));
  if (
    new Set(policy.references.map((r) => r.assetId)).size !==
      policy.references.length ||
    policy.references.length !== ids.size ||
    policy.references.some((r) => !ids.has(r.assetId))
  )
    throw new AppError(
      "VIDEO_FACE_REVIEW_REQUIRED",
      "Face review must cover exactly every distinct image/video reference, including first/last frames and source video.",
      409,
    );
  if (
    assets &&
    policy.references.some(
      (r) => !assets.some((a) => a.id === r.assetId && a.sha256 === r.sha256),
    )
  )
    throw new AppError(
      "VIDEO_FACE_REVIEW_STALE",
      "Reference bytes changed; inspect the actual assets and resolve the model again.",
      409,
    );
}
