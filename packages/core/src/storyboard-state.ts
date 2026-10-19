import {
  AppError,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";

/** Rechecked at quote, purchase and immediately before provider submission. */
export async function validateStoryboardInput(
  tx: Transaction,
  accountId: string,
  input: Operation,
) {
  if (input.kind !== "generate" || !input.storyboard) return;
  const link = input.storyboard;
  const board = await tx.get(link.storyboardId, accountId, "storyboard");
  if (!board) throw new AppError("NOT_FOUND", "Storyboard not found", 404);
  if (board.version !== link.version)
    throw new AppError(
      "STORYBOARD_CONFLICT",
      "Storyboard changed; read it and request a new quote",
      409,
    );
  const shot = board.shots.find(
    (s: Entity) => s.sourceShotId === link.sourceShotId,
  );
  if (!shot) throw new AppError("INVALID_SHOT", "Unknown storyboard shot");
  if (link.stage === "image") {
    if (input.mode !== "image_edit")
      throw new AppError(
        "REFERENCE_MODE_UNSUPPORTED",
        "Storyboard images require image editing",
      );
    const expected = shot.references.map(
      (r: { assetId: string; role: string }) => `${r.role}:${r.assetId}`,
    );
    if (
      expected.length !== input.references?.length ||
      expected.some(
        (r: string, i: number) =>
          r !== `${input.references![i].role}:${input.references![i].assetId}`,
      )
    )
      throw new AppError(
        "STORYBOARD_CONFLICT",
        "Image request must preserve its storyboard reference relationships",
      );
    return;
  }
  const review = shot.review;
  if (review?.decision !== "accepted")
    throw new AppError(
      "STORYBOARD_REVIEW_REQUIRED",
      "Review and accept the target image before video generation",
    );
  const image = await tx.get(review.imageAssetId, accountId, "asset");
  if (!image || image.kind !== "image" || image.sha256 !== review.sha256)
    throw new AppError(
      "STORYBOARD_CONFLICT",
      "Reviewed image changed or is unavailable",
    );
  if (
    !["image_to_video", "reference_to_video", "first_last_frame"].includes(
      input.mode ?? "",
    )
  )
    throw new AppError(
      "REFERENCE_MODE_UNSUPPORTED",
      "Storyboard video requires first-frame or reference-directed generation",
    );
  const imageRole =
    input.mode === "reference_to_video" ? "scene" : "first_frame";
  if (input.mode === "first_last_frame") {
    const lastRef = input.references?.find((r) => r.role === "last_frame");
    const last = lastRef
      ? await tx.get(lastRef.assetId, accountId, "asset")
      : undefined;
    const reviews = await tx.list(accountId, "media-review");
    const accepted = last
      ? reviews
          .filter(
            (r) => r.assetId === last.id && r.sourceSha256 === last.sha256,
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
    if (!last || last.kind !== "image" || accepted?.decision !== "accepted")
      throw new AppError(
        "STORYBOARD_REVIEW_REQUIRED",
        "The last frame requires a current visual acceptance",
      );
  }
  if (
    !input.references?.some(
      (r) => r.assetId === image.id && r.role === imageRole,
    )
  )
    throw new AppError(
      "STORYBOARD_REVIEW_REQUIRED",
      "Video must use the accepted image",
    );
  if (
    shot.motion &&
    !input.references.some(
      (r) => r.assetId === shot.motion.assetId && r.role === "motion",
    )
  )
    throw new AppError(
      "REFERENCE_MODE_UNSUPPORTED",
      "The selected model must retain this shot's motion reference",
    );
}
