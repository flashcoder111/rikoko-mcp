import {
  inspectProductionScope,
  productionScopeState,
} from "./production-scope.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  idSchema,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import { fingerprint, type Service } from "./index.js";
import { validateRemakeEvidence } from "./reference-handoff.js";
import type { ProductionPlan } from "./production-plan.js";
const requirementCheckSchema = z
  .object({
    requirementId: idSchema,
    status: z.enum(["pass", "fail", "unknown"]),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
function remakeReviewComplete(
  requirements:
    NonNullable<ProductionPlan["remake"]>["requirements"] | undefined,
  checks: z.infer<typeof requirementCheckSchema>[] = [],
) {
  if (!requirements) return checks.length === 0;
  const required = requirements.filter((r) => r.mode !== "free");
  return (
    new Set(checks.map((c) => c.requirementId)).size === checks.length &&
    checks.every(
      (c) =>
        requirements.some((r) => r.id === c.requirementId) &&
        c.status === "pass" &&
        !!c.reason.trim(),
    ) &&
    required.every((r) => checks.some((c) => c.requirementId === r.id))
  );
}
const rangeSchema = z
  .object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
  })
  .strict();
const checkSchema = z
  .object({
    status: z.enum(["pass", "fail", "unknown", "not_applicable"]),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine((check) => check.status === "pass" || !!check.reason, {
    message: "Explain failed, unknown and not-applicable checks",
  });
const compatibleCheckSchema = z.union([z.boolean(), checkSchema]);
const maxActionSampleGapMs = 250;
type ReviewRange = z.infer<typeof rangeSchema>;

function fullAssetReview(review: Entity, asset: Entity) {
  return (
    !review.range ||
    (review.range.startMs === 0 &&
      review.range.endMs ===
        (asset.kind === "video" ? asset.metadata.durationMs : 1))
  );
}
// A later rejection of even part of a clip revokes full acceptance. A later
// accepted excerpt, however, cannot erase a rejected or unknown whole clip.
export function selectReview(reviews: Entity[], asset: Entity) {
  return reviews
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) ||
        (b.sequence ?? 0) - (a.sequence ?? 0),
    )
    .find((r) => fullAssetReview(r, asset) || r.decision !== "accepted");
}
export function reviewStatus(review?: Entity) {
  return review?.decision === "accepted" && review.schemaVersion !== 2
    ? "unreviewed"
    : (review?.decision ?? "unreviewed");
}
function checkCoverage(
  samples: number[],
  range: ReviewRange,
  frameMs: number,
  dense: boolean,
) {
  const inside = samples.filter((t) => t >= range.startMs && t < range.endMs);
  const duration = range.endMs - range.startMs;
  const required = dense
    ? 3
    : Math.min(3, Math.max(1, Math.ceil(duration / frameMs)));
  // Inspection requests are integer milliseconds. Match its rounded endpoint,
  // including fractional frame intervals such as 1000/24.
  const tolerance = Math.min(100, Math.max(1, Math.ceil(frameMs)));
  const boundaries = [range.startMs, ...inside, range.endMs];
  const gaps = boundaries.slice(1).map((t, i) => t - boundaries[i]);
  const maxGap = Math.max(0, ...gaps);
  if (
    inside.length < required ||
    inside[0] > range.startMs + tolerance ||
    inside.at(-1)! < range.endMs - tolerance ||
    (required >= 3 &&
      !inside.some(
        (t) =>
          t >= range.startMs + duration * 0.25 &&
          t <= range.startMs + duration * 0.75,
      )) ||
    (dense && maxGap > maxActionSampleGapMs)
  ) {
    throw new AppError(
      "INSPECTION_COVERAGE_REQUIRED",
      `Inspect ${range.startMs}..${range.endMs} ms with media_inspect, including start, middle and end${dense ? ` and sample gaps at most ${maxActionSampleGapMs} ms` : ""}. This checks sample coverage, not action correctness.`,
    );
  }
  return maxGap;
}
export const mediaReviewSchema = z
  .object({
    assetId: idSchema,
    revisionId: idSchema.optional(),
    inspectionIds: z.array(idSchema).max(30),
    decision: z.enum(["accepted", "needs_changes", "unreviewed"]),
    reviewer: z.enum(["host_agent", "user"]),
    range: rangeSchema.optional(),
    actionRanges: z
      .array(
        rangeSchema
          .extend({
            reason: z.string().trim().min(1).max(1000),
            holdMs: z.number().int().min(0).max(5000).default(200),
          })
          .strict(),
      )
      .max(12)
      .default([]),
    checks: z
      .object({
        actionComplete: compatibleCheckSchema,
        framing: compatibleCheckSchema,
        continuity: compatibleCheckSchema,
        noArtifacts: compatibleCheckSchema,
      })
      .strict(),
    notes: z.string().trim().min(1).max(4000),
    requirementChecks: z.array(requirementCheckSchema).max(50).optional(),
  })
  .strict();
export async function reviewMedia(service: Service, c: Context, raw: unknown) {
  const input = mediaReviewSchema.parse(raw);
  const checks = Object.fromEntries(
    Object.entries(input.checks).map(([key, value]) => [
      key,
      typeof value === "boolean"
        ? { status: value ? "pass" : "fail", reason: input.notes }
        : value,
    ]),
  ) as Record<keyof typeof input.checks, z.infer<typeof checkSchema>>;
  return service.scoped(c, "write", async (tx) => {
    const asset = await tx.get(input.assetId, c.accountId, "asset");
    if (!asset) throw new AppError("NOT_FOUND", "Media not found", 404);
    if (!["image", "video"].includes(asset.kind))
      throw new AppError(
        "INVALID_MEDIA",
        "Visual review requires an image or video",
      );
    const endMs = asset.kind === "video" ? asset.metadata?.durationMs : 1;
    const range = input.range ?? { startMs: 0, endMs };
    if (
      !Number.isSafeInteger(endMs) ||
      endMs <= 0 ||
      range.startMs >= range.endMs ||
      range.endMs > endMs ||
      (asset.kind === "image" && (input.range || input.actionRanges.length))
    )
      throw new AppError(
        "INVALID_INTERVAL",
        "Review ranges must fit the source video; images have no action timeline",
      );
    for (const action of input.actionRanges)
      if (
        action.startMs < range.startMs ||
        action.endMs + action.holdMs > range.endMs ||
        action.endMs <= action.startMs
      )
        throw new AppError(
          "INVALID_INTERVAL",
          "Every action range must fit the reviewed interval",
        );
    if (
      input.decision === "accepted" &&
      (!Object.values(checks).every((check) =>
        ["pass", "not_applicable"].includes(check.status),
      ) ||
        !Object.values(checks).some((check) => check.status === "pass"))
    )
      throw new AppError(
        "REVIEW_FAILED",
        "Applicable checks must pass. Resolve failed or unknown checks; explain each not-applicable check. At least one visual check must apply.",
      );
    if (
      !input.inspectionIds.length &&
      (input.decision !== "unreviewed" ||
        Object.values(checks).some((check) =>
          ["pass", "fail"].includes(check.status),
        ))
    )
      throw new AppError(
        "INSPECTION_REQUIRED",
        "Use media_inspect before claiming visual findings, or record unknown checks with decision=unreviewed",
      );
    const samples: number[] = [];
    for (const id of input.inspectionIds) {
      const evidence = await tx.get(id, c.accountId, "media-inspection");
      if (
        !evidence ||
        evidence.assetId !== asset.id ||
        evidence.sourceSha256 !== asset.sha256
      )
        throw new AppError(
          "STALE_EVIDENCE",
          "Inspection must match these exact media bytes",
        );
      samples.push(
        ...evidence.frames.map((f: { sourceTimeMs: number }) => f.sourceTimeMs),
      );
    }
    const sortedSamples = [...new Set(samples)]
      .filter(
        (t) => Number.isFinite(t) && t >= range.startMs && t < range.endMs,
      )
      .sort((a, b) => a - b);
    let maxSampleGapMs: number | undefined;
    if (input.decision === "accepted" && !sortedSamples.length)
      throw new AppError(
        "INSPECTION_COVERAGE_REQUIRED",
        "Inspection contains no samples in the reviewed scope",
      );
    if (input.decision === "accepted" && asset.kind === "video") {
      const fps = Number(asset.metadata.fps);
      const frameMs = Number.isFinite(fps) && fps > 0 ? 1000 / fps : 40;
      maxSampleGapMs = checkCoverage(sortedSamples, range, frameMs, false);
      if (checks.actionComplete.status === "pass") {
        if (!input.actionRanges.length)
          throw new AppError(
            "ACTION_EVIDENCE_REQUIRED",
            "Declare actionRanges with startMs, endMs and reason, then inspect those intervals. For an intentional static shot explain actionComplete.status=not_applicable.",
          );
        for (const action of input.actionRanges)
          checkCoverage(
            sortedSamples,
            { ...action, endMs: action.endMs + action.holdMs },
            frameMs,
            true,
          );
      }
    }
    const revision = input.revisionId
      ? await tx.get(input.revisionId, c.accountId, "revision")
      : undefined;
    if (input.revisionId && !revision)
      throw new AppError("NOT_FOUND", "Revision not found", 404);
    const production = revision
      ? await productionScopeState(tx, c.accountId, revision.projectId)
      : undefined;
    if (production?.plan?.plan.remake) {
      await validateRemakeEvidence(
        service,
        tx,
        c.accountId,
        production.plan.plan,
        production.plan.hostRemakeEvidence,
      );
      if (
        input.decision === "accepted" &&
        !remakeReviewComplete(
          production.plan.plan.remake.requirements,
          input.requirementChecks,
        )
      )
        throw new AppError(
          "REMAKE_REVIEW_REQUIRED",
          "Inspect each preserve/adapt requirement in the rendered cut and record a passing requirementCheck with a reason; unknown or failed requirements cannot be accepted",
          409,
        );
    } else if (input.requirementChecks?.length) {
      throw new AppError(
        "REMAKE_REVIEW_REQUIRED",
        "Requirement checks must be bound to a formal remake revision",
        409,
      );
    }
    if (revision) {
      if (range.startMs !== 0 || range.endMs !== endMs)
        throw new AppError(
          "REVIEW_REVISION_MISMATCH",
          "Final-cut review must cover its whole rendered asset; review excerpts without revisionId",
        );
      const jobs = await tx.list(c.accountId, "job");
      if (
        !jobs.some(
          (j) =>
            j.revisionId === revision.id &&
            j.status === "completed" &&
            j.outputs?.includes(asset.id),
        )
      )
        throw new AppError(
          "REVIEW_REVISION_MISMATCH",
          "A revision review must inspect that revision's actual rendered output",
        );
    }
    const previous = (await tx.list(c.accountId, "media-review")).filter(
      (r) => r.assetId === asset.id,
    );
    const record = {
      ...input,
      schemaVersion: 2,
      checks,
      range,
      sequence: Math.max(0, ...previous.map((r) => r.sequence ?? 0)) + 1,
      coverage: {
        continuous: false,
        sampledTimesMs: sortedSamples,
        maxSampleGapMs,
        maxActionSampleGapMs,
        timeBasis: "requested",
        semanticAssessment: "reviewer",
      },
      id: randomUUID(),
      type: "media-review",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      sourceSha256: asset.sha256,
      productionScopeHash: production?.hash,
      revisionHash: revision ? fingerprint(revision.composition) : undefined,
    };
    await tx.put(record);
    return record;
  });
}
export async function validateMediaResult(
  service: Service,
  c: Context,
  assetIds: string[],
) {
  const reviews = await service.scoped(c, "read", (tx) =>
    tx.list(c.accountId, "media-review"),
  );
  const media = [];
  for (const id of assetIds) {
    const asset = await service.get(c, "asset", id);
    if (!["image", "video"].includes(asset.kind)) continue;
    const review = selectReview(
      reviews.filter(
        (r) =>
          r.assetId === id && r.sourceSha256 === asset.sha256 && !r.revisionId,
      ),
      asset,
    );
    media.push({
      assetId: id,
      status: reviewStatus(review),
      reviewRefreshRequired:
        review?.decision === "accepted" && review.schemaVersion !== 2,
      generationCheck: asset.provenance?.generationCheck,
    });
  }
  const finalReady =
    media.length > 0 && media.every((m) => m.status === "accepted");
  return {
    status: finalReady
      ? "accepted"
      : media.some((m) => m.status === "needs_changes")
        ? "needs_changes"
        : "unreviewed",
    finalReady,
    media,
    issues: media.flatMap((m) => m.generationCheck?.warnings ?? []),
  };
}
export async function validateWorkspace(
  service: Service,
  c: Context,
  revisionId: string,
) {
  const revision = await service.get(c, "revision", revisionId);
  const composition = revision.composition;
  const reviews = await service.scoped(c, "read", (tx) =>
    tx.list(c.accountId, "media-review"),
  );
  const scenes = [];
  const issues: {
    code: string;
    sceneId?: string;
    severity: "warning" | "error";
    message: string;
  }[] = [];
  for (const scene of composition.scenes) {
    const asset = scene.assetId
      ? await service.get(c, "asset", scene.assetId)
      : undefined;
    const speed = scene.speed ?? 1;
    const sourceStartMs = scene.sourceStartMs ?? 0;
    const sourceEndMs = sourceStartMs + scene.durationMs * speed;
    if (asset?.kind === "video") {
      const sourceReview = selectReview(
        reviews.filter(
          (r) =>
            !r.revisionId &&
            r.assetId === asset.id &&
            r.sourceSha256 === asset.sha256,
        ),
        asset,
      );
      if (reviewStatus(sourceReview) === "accepted") {
        // Split scenes may jointly preserve an action. Do not combine unrelated target shots.
        const used = composition.scenes
          .filter(
            (s: any) =>
              s.assetId === asset.id &&
              s.productionShotId === scene.productionShotId,
          )
          .map((s: any) => ({
            start: s.sourceStartMs ?? 0,
            end: (s.sourceStartMs ?? 0) + s.durationMs * (s.speed ?? 1),
          }))
          .sort((a: any, b: any) => a.start - b.start);
        const tolerance = Math.min(
          100,
          Math.max(1, Math.ceil(1000 / (asset.metadata.fps || 25))),
        );
        for (const action of sourceReview?.actionRanges ?? []) {
          let covered = action.startMs;
          for (const interval of used) {
            if (interval.start > covered + tolerance) break;
            covered = Math.max(covered, interval.end);
          }
          if (covered + tolerance < action.endMs + (action.holdMs ?? 200))
            issues.push({
              code: "ACTION_RANGE_CUT",
              sceneId: scene.id,
              severity: "error",
              message: `Selected source ranges omit the accepted action ${action.startMs}..${action.endMs} ms or its ${action.holdMs ?? 200} ms settled result. Preserve the action, including its start, completion and hold.`,
            });
        }
      }
    }
    const discardedTailMs =
      asset?.kind === "video"
        ? Math.max(0, Math.round(asset.metadata.durationMs - sourceEndMs))
        : 0;
    const sourceRatio = asset?.metadata?.width / asset?.metadata?.height;
    const targetRatio = composition.width / composition.height;
    const croppedFraction =
      scene.fit === "cover" && Number.isFinite(sourceRatio)
        ? 1 - Math.min(sourceRatio / targetRatio, targetRatio / sourceRatio)
        : 0;
    const placeholder = !asset && scene.visualKind !== "graphic";
    if (placeholder)
      issues.push({
        code: "PLACEHOLDER_SCENE",
        sceneId: scene.id,
        severity: "error",
        message:
          "Supply a visual asset or explicitly declare visualKind=graphic for an intentional brand/title card",
      });
    if (discardedTailMs > 1000)
      issues.push({
        code: "DISCARDED_TAIL",
        sceneId: scene.id,
        severity: "warning",
        message: "Inspect the omitted tail for unfinished action",
      });
    if (croppedFraction > 0.1)
      issues.push({
        code: "SIGNIFICANT_CROP",
        sceneId: scene.id,
        severity: "warning",
        message:
          "Inspect the rendered framing; more than 10% of source image area is cropped",
      });
    if (asset?.kind === "video" && sourceEndMs > asset.metadata.durationMs + 1)
      issues.push({
        code: "INVALID_INTERVAL",
        sceneId: scene.id,
        severity: "error",
        message: "Scene reads beyond its source video",
      });
    scenes.push({
      sceneId: scene.id,
      assetId: asset?.id,
      sourceSha256: asset?.sha256,
      sourceStartMs,
      sourceEndMs,
      discardedTailMs,
      croppedFraction,
      placeholder,
      inspect: asset
        ? {
            assetId: asset.id,
            ...(asset.kind === "video"
              ? {
                  startMs: sourceStartMs,
                  endMs: Math.min(
                    Math.ceil(sourceEndMs),
                    asset.metadata.durationMs,
                  ),
                }
              : {}),
            count: 3,
          }
        : undefined,
    });
  }
  const production = await service.scoped(c, "read", (tx) =>
    inspectProductionScope(service, tx, c.accountId, revision),
  );
  issues.push(...production.issues);
  const revisionHash = fingerprint(composition);
  const matching = reviews.filter(
    (r) =>
      r.revisionId === revision.id &&
      r.revisionHash === revisionHash &&
      r.productionScopeHash === production.scopeHash,
  );
  matching.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) ||
      (b.sequence ?? 0) - (a.sequence ?? 0),
  );
  // Check current bytes as well as the immutable revision, even when storage records are damaged.
  let review: (typeof matching)[number] | undefined = matching[0];
  if (review) {
    const reviewedAsset = await service.get(c, "asset", review.assetId);
    if (reviewedAsset.sha256 !== review.sourceSha256) review = undefined;
    else {
      // A new defect in an excerpt also invalidates this exact final cut. A
      // standalone acceptance can never substitute for a revision-bound one.
      review = selectReview(
        [
          review,
          ...reviews.filter(
            (r) =>
              !r.revisionId &&
              r.assetId === reviewedAsset.id &&
              r.sourceSha256 === reviewedAsset.sha256 &&
              r.decision !== "accepted",
          ),
        ],
        reviewedAsset,
      );
    }
  }
  if (
    !remakeReviewComplete(
      production.remakeRequirements,
      review?.requirementChecks,
    )
  ) {
    issues.push({
      code: "REMAKE_REVIEW_REQUIRED",
      severity: "error",
      message:
        "The rendered cut needs explicit acceptance for every preserve/adapt requirement",
    });
    review = undefined;
  }
  return {
    revisionId,
    productionScopeHash: production.scopeHash,
    revisionHash,
    status: reviewStatus(review),
    reviewRefreshRequired:
      review?.decision === "accepted" && review.schemaVersion !== 2,
    reviewId: review?.id,
    reviewAssetId: review?.assetId,
    finalReady:
      !issues.some((i) => i.severity === "error") &&
      reviewStatus(review) === "accepted",
    scenes,
    issues,
    instruction:
      "Inspect source endpoints and the rendered result with media_inspect, then record actual host/user judgment with media_review bound to this revision. Rendering success is not visual acceptance.",
  };
}
