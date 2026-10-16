import { AppError } from "../../contracts/src/index.js";
import type { AnalysisDetail } from "../../contracts/src/reference-analysis.js";

export type AnalysisSegment = {
  id: string;
  startMs: number;
  endMs: number;
  boundary: "start" | "cut_candidate" | "window";
};

/** Candidates guide input preparation; neither candidate nor window edges are verified shots. */
export function planReferenceSegments(
  durationMs: number,
  cuts: number[],
  detail: AnalysisDetail,
): AnalysisSegment[] {
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > 3_600_000
  )
    throw new AppError(
      "INVALID_MEDIA",
      "A measured source duration is required",
    );
  if (detail === "overview" && durationMs <= 60000)
    return [
      { id: "segment-1", startMs: 0, endMs: durationMs, boundary: "start" },
    ];
  const maxWindow =
    detail === "recreate" ? 8000 : detail === "shots" ? 12000 : 15000;
  const points = [...new Set(cuts)]
    .filter((t) => Number.isSafeInteger(t) && t > 0 && t < durationMs)
    .sort((a, b) => a - b);
  const result: AnalysisSegment[] = [];
  let startMs = 0;
  let boundary: AnalysisSegment["boundary"] = "start";
  while (startMs < durationMs) {
    const limit = Math.min(durationMs, startMs + maxWindow);
    const within = points.filter((t) => t > startMs && t <= limit);
    // Recreate gets every candidate interval; shots gets a bounded group of at most four cuts.
    const endMs =
      detail === "recreate"
        ? (within[0] ?? limit)
        : detail === "shots"
          ? (within[Math.min(within.length, 4) - 1] ?? limit)
          : limit;
    result.push({
      id: `segment-${result.length + 1}`,
      startMs,
      endMs,
      boundary,
    });
    boundary = points.includes(endMs) ? "cut_candidate" : "window";
    startMs = endMs;
    if (result.length > 100)
      throw new AppError(
        "ANALYSIS_PLAN_LIMIT",
        "This range needs more than 100 analysis segments. Choose a smaller source range; no segments were omitted.",
      );
  }
  return result;
}
