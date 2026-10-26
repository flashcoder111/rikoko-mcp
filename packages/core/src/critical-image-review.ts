import {
  AppError,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import type { ProductionPlan } from "./production-plan.js";
import {
  requiresStartingStateReview,
  startingStateAccepted,
} from "./shot-reference-choice.js";

const videoModes = new Set([
  "image_to_video",
  "first_last_frame",
  "reference_to_video",
  "video_to_video",
]);
const criticalRoles = new Set([
  "first_frame",
  "last_frame",
  "character",
  "product",
  "scene",
]);

/** Host-workspace gate: never infer visual acceptance from a completed job or a probe. */
export async function assertCriticalImageReviews(
  tx: Transaction,
  accountId: string,
  input: Operation,
) {
  if (input.kind !== "generate" || !videoModes.has(input.mode ?? "")) return;
  const refs = (input.references ?? []).filter((ref) =>
    criticalRoles.has(ref.role),
  );
  if (!refs.length) return;
  const project = input.production
    ? await tx.get(input.production.projectId, accountId, "project")
    : undefined;
  const plan = project?.productionScope
    ? await tx.get(project.productionScope.planId, accountId, "production-plan")
    : undefined;
  const shot = (plan?.plan as ProductionPlan | undefined)?.shots.find(
    (s) => s.id === input.production?.shotId,
  );
  const reviews = await tx.list(accountId, "media-review");
  const board = input.storyboard
    ? await tx.get(input.storyboard.storyboardId, accountId, "storyboard")
    : undefined;
  const boardReview =
    board?.version === input.storyboard?.version
      ? board?.shots.find(
          (shot: Entity) =>
            shot.sourceShotId === input.storyboard?.sourceShotId,
        )?.review
      : undefined;
  const missing: { assetId: string; role: string; status: string }[] = [];
  for (const ref of refs) {
    const asset = await tx.get(ref.assetId, accountId, "asset");
    if (!asset || asset.kind !== "image") {
      missing.push({ ...ref, status: "unavailable_image" });
      continue;
    }
    const relevant = reviews
      .filter(
        (review) =>
          review.assetId === asset.id &&
          review.sourceSha256 === asset.sha256 &&
          !review.revisionId &&
          (!review.production ||
            (input.production &&
              review.production &&
              review.production.projectId === input.production.projectId &&
              review.production.scopeVersion ===
                input.production.scopeVersion &&
              review.production.shotId === input.production.shotId)),
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          (b.sequence ?? 0) - (a.sequence ?? 0),
      );
    const latest = relevant[0];
    const needsStartingState = requiresStartingStateReview(shot, asset.id);
    // Reuse the storyboard's existing quick check; a newer media rejection is never a pass.
    if (
      !latest &&
      !needsStartingState &&
      ref.role ===
        (input.mode === "reference_to_video" ? "scene" : "first_frame") &&
      boardReview?.decision === "accepted" &&
      boardReview.imageAssetId === asset.id &&
      boardReview.sha256 === asset.sha256
    )
      continue;
    let valid =
      latest?.schemaVersion === 2 &&
      latest.decision === "accepted" &&
      (!(
        input.production && ["first_frame", "last_frame"].includes(ref.role)
      ) ||
        !!latest.production) &&
      ["framing", "noArtifacts"].every(
        (key) => latest.checks?.[key]?.status === "pass",
      ) &&
      (latest.checks?.continuity?.status === "pass" ||
        (!["first_frame", "last_frame"].includes(ref.role) &&
          latest.checks?.continuity?.status === "not_applicable" &&
          !!latest.checks.continuity.reason?.trim())) &&
      latest.inspectionIds?.length > 0;
    if (
      valid &&
      needsStartingState &&
      !startingStateAccepted(latest.startingStateChecks)
    )
      valid = false;
    if (valid) {
      for (const id of latest.inspectionIds) {
        const inspection = await tx.get(id, accountId, "media-inspection");
        if (
          !inspection ||
          inspection.assetId !== asset.id ||
          inspection.sourceSha256 !== asset.sha256 ||
          !inspection.frames?.length
        )
          valid = false;
      }
    }
    if (!valid)
      missing.push({
        ...ref,
        status:
          needsStartingState &&
          !startingStateAccepted(latest?.startingStateChecks)
            ? "starting_state_review_required"
            : (latest?.decision ?? "unreviewed"),
      });
  }
  if (missing.length)
    throw new AppError(
      "CRITICAL_IMAGE_REVIEW_REQUIRED",
      "Inspect these exact critical images and record framing and noArtifacts passing. Static character/product/scene references may use continuity=not_applicable with a reason; they cannot certify future video consistency. First/last frames require continuity passing for their intended state; planned boundaries also require the current production projectId, scopeVersion and shotId. Unknown or failed checks remain blocked. A request to ignore a background is not evidence that it was removed. Do not relabel checks just to proceed or regenerate automatically.",
      409,
      {
        stage: "critical_image_review",
        issues: missing.map((ref) => ({
          path: `references.${ref.assetId}`,
          code: "CRITICAL_IMAGE_REVIEW_REQUIRED",
          message: `${ref.role}: ${ref.status}. Use media_inspect, then media_review for these exact pixels and intended state.${ref.status === "starting_state_review_required" ? " Record startingStateChecks: stage, count, arrangement, support, with short reasons and this shot's production binding." : ""}`,
        })),
      },
    );
}
