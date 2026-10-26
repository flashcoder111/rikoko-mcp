import { AppError } from "../../contracts/src/index.js";
import type { ReferenceReport } from "../../contracts/src/reference-analysis.js";
import type { ProductionPlan } from "./production-plan.js";

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
      return `${seconds(Math.max(start, s.startMs) - start)}–${seconds(Math.min(end, s.endMs) - start)}s: ${s.framing}; action: ${s.action}; camera: ${s.cameraMotion}.${s.details?.spatialRelations ? ` Source layout: ${s.details.spatialRelations}.` : ""}${target ? ` Target: ${target.direction}. ${refs.join("; ")}` : ""}`;
    }),
  ].join("\n");
}
