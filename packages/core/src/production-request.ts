import { z } from "zod";
import { assertUserPreservation } from "./production-intent.js";
import { AppError, idSchema, type Entity } from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import type { ProductionPlan } from "./production-plan.js";

export const productionRequestSchema = z
  .object({
    requestId: idSchema,
    expectedVersion: z.number().int().positive(),
    excludedAssets: z
      .array(
        z
          .object({
            assetId: idSchema,
            reason: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .max(14)
      .default([]),
  })
  .strict();

/** Bind every original attachment; cloud v2 mirrors this original request separately. */
export async function bindProductionRequest(
  tx: Transaction,
  accountId: string,
  plan: ProductionPlan,
  raw: z.infer<typeof productionRequestSchema>,
) {
  const request = await tx.get(raw.requestId, accountId, "workspace-request");
  if (!request || request.version !== raw.expectedVersion)
    throw new AppError(
      "REQUEST_CONFLICT",
      "Read the current workspace_request_get and bind its exact version before reusing a plan",
      409,
    );
  if (
    request.missingInputs?.some((item: { required: boolean }) => item.required)
  )
    throw new AppError(
      "REQUEST_INPUT_REQUIRED",
      "Resolve the request's required inputs before saving its production plan",
      409,
    );
  const used = new Set(
    plan.shots.flatMap((shot) => shot.references.map((ref) => ref.assetId)),
  );
  assertUserPreservation(request.userRequirements ?? [], plan.method);
  if (plan.editing?.audio?.assetId) used.add(plan.editing.audio.assetId);
  const exclusions = new Set(raw.excludedAssets.map((item) => item.assetId));
  if (
    exclusions.size !== raw.excludedAssets.length ||
    raw.excludedAssets.some(
      (item) =>
        !request.assetIds.includes(item.assetId) || used.has(item.assetId),
    )
  )
    throw new AppError(
      "REQUEST_ASSET_MISMATCH",
      "Exclusions must uniquely name unused attachments from this request and explain why",
      409,
    );
  const assets: { assetId: string; sha256: string }[] = [];
  let hasSourceVideo = false;
  for (const assetId of request.assetIds as string[]) {
    const asset = await tx.get(assetId, accountId, "asset");
    if (!asset?.sha256 || (!used.has(assetId) && !exclusions.has(assetId)))
      throw new AppError(
        "REQUEST_ASSET_MISMATCH",
        "This plan omits a current attachment. Use the actual asset in shot references (analysis_only is allowed) or explicitly explain its exclusion; do not silently substitute an old product",
        409,
        {
          issues: [
            {
              path: "request",
              code: "REQUEST_ASSET_MISMATCH",
              message: assetId,
            },
          ],
        },
      );
    assets.push({ assetId, sha256: asset.sha256 });
    if (asset.kind === "video") {
      hasSourceVideo = true;
      if (!plan.remake)
        throw new AppError(
          "VIDEO_ANALYSIS_REQUIRED",
          "Analyze the original video before planning; video attachments cannot be excluded or treated only as still images",
          409,
          { stage: "analysis" },
        );
      if (exclusions.has(assetId))
        throw new AppError(
          "SOURCE_VIDEO_REFERENCE_REQUIRED",
          "The original video cannot be excluded from its generation workflow",
          409,
          { stage: "reference_delivery" },
        );
    }
  }
  if (
    hasSourceVideo &&
    plan.shots.some(
      (shot) =>
        shot.visualKind === "media" &&
        shot.sourceShotIds.length > 0 &&
        !shot.sourceVideo,
    )
  )
    throw new AppError(
      "SOURCE_VIDEO_DECISION_REQUIRED",
      "For each source-linked media shot, choose sourceVideo.strategy=reference with the actual motion excerpt assetId, or reconstruct with a concrete reason. An analysis report is not a video generation reference.",
      409,
    );
  return { ...raw, assets, userRequirements: request.userRequirements ?? [] };
}

export async function validateProductionRequest(
  tx: Transaction,
  accountId: string,
  record: Entity,
) {
  if (!record.requestBinding) return; // Existing plans and cloud mirrors remain supported.
  const binding = record.requestBinding;
  const current = await bindProductionRequest(
    tx,
    accountId,
    record.plan,
    binding,
  );
  if (
    current.assets.length !== binding.assets.length ||
    current.assets.some(
      (asset) =>
        !binding.assets.some(
          (saved: { assetId: string; sha256: string }) =>
            saved.assetId === asset.assetId && saved.sha256 === asset.sha256,
        ),
    )
  )
    throw new AppError(
      "REQUEST_ASSET_CHANGED",
      "Request attachment bytes changed; reconcile the plan and prepare again",
      409,
    );
}
