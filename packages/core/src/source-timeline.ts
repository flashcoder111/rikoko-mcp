import { AppError } from "../../contracts/src/index.js";
import type { ReferenceReport } from "../../contracts/src/reference-analysis.js";
import type { ProductionPlan } from "./production-plan.js";

export function targetRelationDirection(
  plan: ProductionPlan,
  shot: ProductionPlan["shots"][number],
  report?: ReferenceReport,
) {
  const mapped =
    shot.sourceShotDirections?.filter((d) => d.relations?.length) ?? [];
  if (!mapped.length) return "";
  if (
    !report ||
    !plan.method?.source ||
    plan.method.source.assetId !== report.source.assetId ||
    plan.method.source.sha256 !== report.source.sha256
  )
    throw new AppError(
      "SOURCE_RELATION_EVIDENCE_REQUIRED",
      "Target relations require the current source-bound report",
    );
  return mapped
    .flatMap((direction) =>
      direction.relations!.flatMap((relation) => {
        const source = report.shots.find(
          (s) => s.id === direction.sourceShotId,
        );
        if (!source?.details?.[relation.sourceField])
          throw new AppError(
            "SOURCE_RELATION_EVIDENCE_REQUIRED",
            "The selected source relation has no bound observation",
          );
        if (!["preserve", "change"].includes(relation.disposition)) return [];
        if (!relation.target?.trim())
          throw new AppError(
            "SOURCE_RELATION_TARGET_REQUIRED",
            "A required relation must have an explicit target expression",
          );
        return [
          `Target relation for ${direction.sourceShotId} ${relation.sourceField} (${relation.disposition}): ${relation.target}.`,
        ];
      }),
    )
    .join("\n");
}

/** Observations come from the hash-bound report, target changes from the saved plan. */
export function sourceTimelineDirection(
  plan: ProductionPlan,
  shot: ProductionPlan["shots"][number],
  report?: ReferenceReport,
) {
  if (!report) {
    if (shot.sourceShotDirections?.length)
      throw new AppError(
        "REMAKE_EVIDENCE_REQUIRED",
        "Source-shot directions require the bound analysis report",
      );
    return "";
  }
  const source = plan.method?.source;
  if (
    !source ||
    source.assetId !== report.source.assetId ||
    source.sha256 !== report.source.sha256
  )
    throw new AppError(
      "REMAKE_SOURCE_CHANGED",
      "Timeline analysis must match the saved source",
    );
  const segment = plan.method?.segments?.find((s) => s.shotId === shot.id);
  const start = segment?.sourceStartMs ?? 0;
  const end =
    start + (segment?.durationMs ?? shot.durationMs ?? source.durationMs);
  const entries = report.shots.filter(
    (s) => s.startMs < end && s.endMs > start,
  );
  if (
    shot.sourceShotDirections &&
    (entries.some(
      (s) => !shot.sourceShotDirections!.some((d) => d.sourceShotId === s.id),
    ) ||
      shot.sourceShotDirections.some(
        (d) => !entries.some((s) => s.id === d.sourceShotId),
      ))
  )
    throw new AppError(
      "SOURCE_SHOT_DIRECTION_INVALID",
      "Target directions must cover precisely the source shots in this excerpt",
    );
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  return [
    "Source timeline (times relative to this excerpt). Preserve these shots and their occupancy; apply the target changes, not the original subject appearance:",
    ...entries.map((s) => {
      const target = shot.sourceShotDirections?.find(
        (d) => d.sourceShotId === s.id,
      );
      // Only the host can separate an observed relation from the source person's
      // appearance. Unresolved source prose stays in the handoff, not the prompt.
      const relations = target?.relations ?? [];
      const targetRelations = relations.flatMap((relation) => {
        if (!s.details?.[relation.sourceField])
          throw new AppError(
            "SOURCE_RELATION_EVIDENCE_REQUIRED",
            "The selected source relation has no bound observation",
          );
        if (!["preserve", "change"].includes(relation.disposition)) return [];
        if (!relation.target?.trim())
          throw new AppError(
            "SOURCE_RELATION_TARGET_REQUIRED",
            "A required relation must have an explicit target expression",
          );
        return [
          `Target ${relation.sourceField} (${relation.disposition}): ${relation.target}.`,
        ];
      });
      const refs =
        target?.referenceAssetIds.map((id) => {
          const ref = shot.references.find(
            (r) => r.assetId === id && r.usage !== "analysis_only",
          );
          if (!ref)
            throw new AppError(
              "SOURCE_SHOT_DIRECTION_INVALID",
              "Timeline reference is not a generation input",
            );
          const images = shot.references.filter(
            (r) =>
              r.usage !== "analysis_only" &&
              !["motion", "source_video"].includes(r.role),
          );
          return `Image ${images.findIndex((r) => r.assetId === id) + 1} (${ref.role}): ${ref.instruction}`;
        }) ?? [];
      return `${seconds(Math.max(start, s.startMs) - start)}–${seconds(Math.min(end, s.endMs) - start)}s: ${s.framing}; action: ${s.action}; camera: ${s.cameraMotion}.${!target?.relations && s.details?.spatialRelations ? ` Source layout: ${s.details.spatialRelations}.` : ""}${target ? ` Target: ${target.direction}. ${refs.join("; ")}` : ""}${targetRelations.length ? ` ${targetRelations.join(" ")}` : ""}`;
    }),
  ].join("\n");
}

/** Evidence and unresolved choices for the host; never an automatic semantic verdict. */
export function sourceRelationHandoff(
  shot: ProductionPlan["shots"][number],
  report?: ReferenceReport,
) {
  return (report?.shots ?? [])
    .filter((s) => shot.sourceShotIds.includes(s.id))
    .map((s) => ({
      sourceShotId: s.id,
      evidenceIds: s.evidenceIds,
      observations: s.details
        ? {
            startState: s.details.startState,
            endState: s.details.endState,
            spatialRelations: s.details.spatialRelations,
          }
        : null,
      decisions:
        shot.sourceShotDirections?.find((d) => d.sourceShotId === s.id)
          ?.relations ?? [],
      unresolved: (
        ["startState", "endState", "spatialRelations"] as const
      ).filter(
        (field) =>
          s.details?.[field] &&
          !shot.sourceShotDirections
            ?.find((d) => d.sourceShotId === s.id)
            ?.relations?.some(
              (r) => r.sourceField === field && r.disposition !== "unknown",
            ),
      ),
    }));
}

/** New source-edit plans must resolve observed state/layout into target terms.
 * Unknown is an honest decision, not a fabricated success or an aesthetic veto.
 * Legacy saved plans and frozen requests keep their original contract.
 */
export function sourceRelationIssues(
  plan: ProductionPlan,
  report?: ReferenceReport,
) {
  if (plan.method?.kind !== "source_edit" || !report) return [];
  return plan.shots.flatMap((shot) =>
    sourceRelationHandoff(shot, report).flatMap((entry) => {
      const missing = entry.unresolved.filter(
        (field) =>
          !entry.decisions.some((decision) => decision.sourceField === field),
      );
      return missing.length
        ? [
            {
              code: "SOURCE_RELATION_DECISION_REQUIRED",
              shotId: shot.id,
              message: `Resolve ${entry.sourceShotId} ${missing.join(", ")} in sourceShotDirections[].relations using target subjects. Preserve/change needs target text; not_applicable/unknown needs an honest reason.`,
            },
          ]
        : [];
    }),
  );
}
