import {
  AppError,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";
import {
  combinedFaceStatus,
  videoModelFamily,
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
  const family = videoModelFamily(model);
  // Reference roles have fixed media kinds in the operation contract. Do not
  // rely on remote catalog metadata being complete to identify visual inputs.
  const visualRefs = (input.references ?? []).filter((r) => r.role !== "voice");
  // Existing text-only non-Seedance requests remain valid. References never bypass review.
  if (!input.videoPolicy && family !== "seedance" && !visualRefs.length) return;
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
  const faces = combinedFaceStatus(policy);
  if (family === "seedance" && faces !== "absent")
    throw new AppError(
      "SEEDANCE_FACE_BLOCKED",
      "Seedance 系列禁止用于涉及人脸或人脸状态不明的任务。请与用户确认使用 MiniMax（默认推荐）或 Kling。",
      409,
    );
  if (faces !== "absent") {
    if (!["minimax", "kling"].includes(family))
      throw new AppError(
        "VIDEO_FACE_MODEL_UNSUPPORTED",
        "涉及人脸的任务请选择兼容的 MiniMax 或 Kling 模型。",
        409,
      );
    if (
      policy.userChoice?.model !== input.model ||
      policy.userChoice.confirmed !== true
    )
      throw new AppError(
        "VIDEO_MODEL_CHOICE_REQUIRED",
        "请告知用户人脸限制，并确认使用 MiniMax（默认推荐）或 Kling；明确选择仍有效时无需重复询问。",
        409,
      );
  }
}
