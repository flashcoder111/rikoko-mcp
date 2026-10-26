import { AppError } from "../../contracts/src/index.js";

type Source = {
  source: { durationMs: number };
  shots: { id: string; startMs: number; endMs: number }[];
  narrativeBeats?: { startMs: number; endMs: number }[];
};

/** Budget is frozen before analysis. Reposition boundaries; never increase the request ceiling. */
export function planSourceSegments(
  report: Source,
  limits: { minMs: number; maxMs: number; maxRequests: number },
) {
  const duration = report.source.durationMs;
  const { minMs, maxMs, maxRequests } = limits;
  if (
    ![duration, minMs, maxMs, maxRequests].every(Number.isSafeInteger) ||
    duration <= 0 ||
    duration > 60000 ||
    minMs < 1 ||
    maxMs < minMs ||
    maxRequests < 1 ||
    maxRequests > 12
  )
    throw new AppError(
      "INVALID_SEGMENT_LIMIT",
      "Use valid source duration and accepted segment limits",
    );
  const count = Math.ceil(duration / maxMs);
  if (count > maxRequests || duration < count * minMs)
    throw new AppError(
      "SOURCE_SEGMENT_LIMIT",
      "The source cannot fit the accepted request count and reference duration limits",
    );
  const cuts = report.shots
    .flatMap((s) => [s.startMs, s.endMs])
    .filter((t) => t > 0 && t < duration);
  const beats = (report.narrativeBeats ?? [])
    .flatMap((s) => [s.startMs, s.endMs])
    .filter((t) => t > 0 && t < duration);
  // Keep integer-second internal boundaries for the existing measured-excerpt contract.
  // Report the offset explicitly: a rounded boundary is not a measured exact shot cut.
  const points = [
    0,
    ...Array.from(
      { length: Math.ceil(duration / 1000) - 1 },
      (_, i) => (i + 1) * 1000,
    ),
    duration,
  ];
  const nearest = (t: number, boundaries: number[]) =>
    boundaries.length
      ? Math.min(...boundaries.map((c) => Math.abs(c - t)))
      : 1000;
  let states = new Map<number, { score: number; path: number[] }>([
    [0, { score: 0, path: [0] }],
  ]);
  for (let part = 1; part <= count; part++) {
    const next = new Map<number, { score: number; path: number[] }>();
    for (const end of points.slice(1)) {
      const remaining = duration - end;
      if (
        remaining < (count - part) * minMs ||
        remaining > (count - part) * maxMs
      )
        continue;
      for (const [start, state] of states) {
        const length = end - start;
        if (length < minMs || length > maxMs) continue;
        const cutCost =
          end === duration
            ? 0
            : nearest(end, cuts) / 1000 +
              (beats.length
                ? Math.min(1, nearest(end, beats) / 1000) * 0.25
                : 0);
        const score =
          state.score +
          cutCost +
          Math.pow((length - duration / count) / maxMs, 2) * 0.01;
        if (!next.has(end) || score < next.get(end)!.score)
          next.set(end, { score, path: [...state.path, end] });
      }
    }
    states = next;
  }
  const path = states.get(duration)?.path;
  if (!path)
    throw new AppError(
      "SOURCE_SEGMENT_LIMIT",
      "No continuous excerpt plan fits the accepted limits",
    );
  const ranges = path.slice(1).map((endMs, i) => ({ startMs: path[i], endMs }));
  return {
    ranges,
    sourceShotIds: ranges.map((r) =>
      report.shots
        .filter((s) => s.startMs < r.endMs && s.endMs > r.startMs)
        .map((s) => s.id),
    ),
    boundaryOffsetsMs: path.slice(1, -1).map((t) => nearest(t, cuts)),
  };
}
