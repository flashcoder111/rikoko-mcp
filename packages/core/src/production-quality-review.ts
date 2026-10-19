import { z } from "zod";
import { AppError, idSchema } from "../../contracts/src/index.js";

type Range = { startMs: number; endMs: number };
type QualityPlan = {
  process?: unknown;
  shots: {
    id: string;
    durationMs?: number;
    process?: {
      operations: { id: string; timing: { hold: Range } }[];
    };
  }[];
  editing?: {
    audio?: { syncPoints: unknown[] };
    ending?: { shotIds: string[]; minHoldMs: number; productVisible: boolean };
  };
};
type ReviewComposition = {
  scenes: { productionShotId?: string; durationMs: number }[];
};
export type ProductionReviewObligation = {
  id: string;
  kind: "process" | "visual" | "audio";
  shotId?: string;
  operationId?: string;
  minHoldMs?: number;
};
const rangeSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  })
  .strict()
  .refine((r) => r.endMs > r.startMs, "End must follow start");
export const productionReviewBindingSchema = z
  .object({
    projectId: idSchema,
    scopeVersion: z.number().int().positive(),
    shotId: idSchema,
  })
  .strict();
export const productionQualityCheckSchema = z
  .object({
    obligationId: z.string().min(1).max(350),
    status: z.enum(["pass", "fail", "unknown"]),
    reason: z.string().trim().min(1).max(2000),
    method: z.enum([
      "frames",
      "host_listening",
      "user_listening",
      "audio_analysis",
    ]),
    range: rangeSchema.optional(),
    holdMs: z.number().int().nonnegative().max(600000).optional(),
  })
  .strict();
export type ProductionQualityCheck = z.infer<
  typeof productionQualityCheckSchema
>;

/** These are review obligations, never automatic claims about physics or taste. */
export function productionReviewObligations(
  plan: QualityPlan,
  shotId?: string,
): ProductionReviewObligation[] {
  const obligations: ProductionReviewObligation[] = [];
  for (const shot of plan.shots) {
    if ((shotId && shot.id !== shotId) || !shot.process) continue;
    obligations.push({
      id: `process:${shot.id}:state`,
      kind: "visual",
      shotId: shot.id,
    });
    for (const operation of shot.process.operations)
      obligations.push({
        id: `process:${shot.id}:operation:${operation.id}`,
        kind: "process",
        shotId: shot.id,
        operationId: operation.id,
        minHoldMs: operation.timing.hold.endMs - operation.timing.hold.startMs,
      });
  }
  if (!shotId && plan.editing?.audio) {
    obligations.push(
      { id: "audio:continuity", kind: "audio" },
      { id: "audio:ending", kind: "audio" },
    );
    for (let i = 0; i < plan.editing.audio.syncPoints.length; i++)
      obligations.push({ id: `audio:sync:${i}`, kind: "audio" });
  }
  if (!shotId && plan.editing?.ending) {
    obligations.push({
      id: "ending:readability",
      kind: "visual",
      minHoldMs: plan.editing.ending.minHoldMs,
    });
    if (plan.editing.ending.productVisible)
      obligations.push({
        id: "ending:product",
        kind: "visual",
        minHoldMs: plan.editing.ending.minHoldMs,
      });
  }
  return obligations;
}

function fail(message: string): never {
  throw new AppError("PRODUCTION_QUALITY_REVIEW_REQUIRED", message, 409);
}
function shotRanges(
  composition: ReviewComposition | undefined,
  shotId: string,
): Range[] {
  let startMs = 0;
  const ranges: Range[] = [];
  for (const scene of composition?.scenes ?? []) {
    const endMs = startMs + scene.durationMs;
    if (scene.productionShotId === shotId) ranges.push({ startMs, endMs });
    startMs = endMs;
  }
  return ranges;
}
function coveredBy(range: Range, intervals: Range[]) {
  let cursor = range.startMs;
  for (const interval of [...intervals].sort((a, b) => a.startMs - b.startMs)) {
    if (interval.endMs <= cursor) continue;
    if (interval.startMs > cursor) break;
    cursor = Math.max(cursor, interval.endMs);
  }
  return cursor >= range.endMs;
}
function checkSamples(
  samples: number[],
  range: Range,
  frameMs: number,
  dense: boolean,
) {
  const times = [...new Set(samples)]
    .filter((t) => t >= range.startMs && t < range.endMs)
    .sort((a, b) => a - b);
  const tolerance = Math.min(100, Math.max(1, Math.ceil(frameMs)));
  const duration = range.endMs - range.startMs;
  if (
    !times.length ||
    (dense && times.length < 3) ||
    times[0] > range.startMs + tolerance ||
    times.at(-1)! < range.endMs - tolerance ||
    (duration > frameMs * 2 &&
      !times.some(
        (t) =>
          t >= range.startMs + duration * 0.25 &&
          t <= range.startMs + duration * 0.75,
      )) ||
    (dense &&
      [range.startMs, ...times, range.endMs].some(
        (t, i, a) => i > 0 && t - a[i - 1] > 250,
      ))
  )
    fail(
      `Quality inspection coverage is incomplete for ${range.startMs}..${range.endMs} ms${dense ? "; inspect the action and settled hold with gaps at most 250 ms" : ""}`,
    );
}

export function validateProductionQualityReview(input: {
  plan: QualityPlan;
  shotId?: string;
  composition?: ReviewComposition;
  qualityChecks?: ProductionQualityCheck[];
  decision: "accepted" | "needs_changes" | "unreviewed";
  samples: number[];
  range: Range;
  frameMs: number;
}) {
  const obligations = productionReviewObligations(input.plan, input.shotId);
  const checks = input.qualityChecks ?? [];
  const known = new Map(obligations.map((o) => [o.id, o]));
  if (
    new Set(checks.map((c) => c.obligationId)).size !== checks.length ||
    checks.some((c) => !known.has(c.obligationId))
  )
    fail(
      "Quality checks must use each plan-derived obligation ID at most once",
    );
  if (
    input.decision === "accepted" &&
    obligations.some(
      (o) =>
        !checks.some((c) => c.obligationId === o.id && c.status === "pass"),
    )
  )
    fail(
      "Every required production quality obligation must pass; missing, failed or unknown findings cannot be accepted",
    );
  for (const check of checks) {
    if (check.status === "unknown") continue;
    const obligation = known.get(check.obligationId)!;
    const range = check.range;
    if (
      !range ||
      range.startMs < input.range.startMs ||
      range.endMs > input.range.endMs ||
      range.startMs >= range.endMs
    )
      fail(
        "Observed quality findings need an actual interval inside the reviewed asset",
      );
    if (obligation.kind === "audio") {
      if (check.method === "frames")
        fail(
          "Audio findings require listening or actual audio analysis; visual frames do not establish sound quality",
        );
      if (
        check.status === "pass" &&
        !["host_listening", "user_listening"].includes(check.method)
      )
        fail(
          "Listen to the rendered audio before passing musical continuity, sync or ending; frames and audio analysis alone cannot certify musical quality",
        );
      if (
        check.status === "pass" &&
        (range.startMs !== input.range.startMs ||
          range.endMs !== input.range.endMs)
      )
        fail(
          "Audio acceptance requires listening through the full rendered cut, including the ending",
        );
      continue;
    }
    if (check.method !== "frames")
      fail("Visual and process quality findings require inspected frames");
    const holdMs = obligation.operationId ? (check.holdMs ?? 0) : 0;
    const observed = { ...range, endMs: range.endMs + holdMs };
    if (observed.endMs > input.range.endMs)
      fail(
        "The observed action and settled hold must fit inside the reviewed asset",
      );
    if (
      check.status === "pass" &&
      obligation.minHoldMs &&
      (obligation.operationId ? holdMs : range.endMs - range.startMs) <
        obligation.minHoldMs
    )
      fail(
        `The observed settled or advertising hold must last at least ${obligation.minHoldMs} ms`,
      );
    if (obligation.shotId && input.composition) {
      const intervals = shotRanges(input.composition, obligation.shotId);
      if (!coveredBy(observed, intervals))
        fail(
          `Quality evidence must belong to target shot ${obligation.shotId}`,
        );
      if (
        !obligation.operationId &&
        check.status === "pass" &&
        (range.startMs !== intervals[0]?.startMs ||
          range.endMs !== intervals.at(-1)?.endMs)
      )
        fail(
          `State review must cover the start and end of target shot ${obligation.shotId}`,
        );
    } else if (
      obligation.shotId &&
      !obligation.operationId &&
      check.status === "pass" &&
      (range.startMs !== input.range.startMs ||
        range.endMs !== input.range.endMs)
    ) {
      fail(
        `State review must cover the start and end of target shot ${obligation.shotId}`,
      );
    }
    if (obligation.id.startsWith("ending:") && input.composition) {
      const intervals = input.plan.editing!.ending!.shotIds.flatMap((id) =>
        shotRanges(input.composition, id),
      );
      if (!coveredBy(range, intervals))
        fail(
          "Advertising hold evidence must belong to the planned ending shots",
        );
    }
    const acceptedAction =
      obligation.kind === "process" && check.status === "pass";
    if (acceptedAction) {
      // Samples after completion cannot stand in for observing the action itself.
      // Keep at least three action samples, even for an implausibly tiny declared range.
      checkSamples(input.samples, range, input.frameMs, true);
    }
    checkSamples(input.samples, observed, input.frameMs, acceptedAction);
  }
}

/** A generic or stale acceptance must not certify a new scoped process plan. */
export function productionQualityAccepted(
  review:
    | {
        id?: string;
        decision?: string;
        qualityChecks?: ProductionQualityCheck[];
        productionScopeHash?: string;
        production?: { shotId: string };
      }
    | undefined,
  plan: QualityPlan,
  scopeHash: string | undefined,
  shotId?: string,
) {
  const obligations = productionReviewObligations(plan, shotId);
  if (!obligations.length) return true;
  if (
    review?.decision !== "accepted" ||
    review.productionScopeHash !== scopeHash ||
    (shotId && review.production?.shotId !== shotId)
  )
    return false;
  const checks = review.qualityChecks ?? [];
  return (
    new Set(checks.map((c) => c.obligationId)).size === checks.length &&
    checks.every(
      (c) =>
        obligations.some((o) => o.id === c.obligationId) &&
        c.status === "pass" &&
        !!c.reason.trim(),
    ) &&
    obligations.every((o) => checks.some((c) => c.obligationId === o.id))
  );
}

export function productionReviewInstructions(
  plan: QualityPlan,
  composition?: ReviewComposition,
) {
  return productionReviewObligations(plan).map((obligation) => ({
    ...obligation,
    ...(obligation.shotId && composition
      ? { targetRanges: shotRanges(composition, obligation.shotId) }
      : {}),
    requiredEvidence:
      obligation.kind === "audio"
        ? "Listen to the whole rendered cut and record observed sound, sync and ending; analysis alone is not musical acceptance"
        : obligation.kind === "process"
          ? "Inspect actual approach, contact, completion and settled hold with gaps at most 250 ms; record the observed action range and holdMs"
          : "Inspect the actual start, middle and end; describe observed state, support, object identity, scale, visibility and advertising readability as applicable",
  }));
}
