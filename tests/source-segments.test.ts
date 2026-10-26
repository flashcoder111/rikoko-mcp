import { expect, it } from "vitest";
import { planSourceSegments } from "../packages/core/src/source-segments.js";

const report = {
  source: { durationMs: 31835 },
  shots: [
    { id: "a", startMs: 0, endMs: 9000 },
    { id: "b", startMs: 9000, endMs: 21000 },
    { id: "c", startMs: 21000, endMs: 31835 },
  ],
};
const limits = { minMs: 2000, maxMs: 15000, maxRequests: 3 };
it("uses content cuts within the quoted request ceiling instead of equal thirds", () => {
  expect(planSourceSegments(report, limits).ranges).toEqual([
    { startMs: 0, endMs: 9000 },
    { startMs: 9000, endMs: 21000 },
    { startMs: 21000, endMs: 31835 },
  ]);
});
it("covers the full source without short tails or extra requests", () => {
  const result = planSourceSegments({ ...report, shots: [] }, limits);
  expect(result.ranges).toHaveLength(3);
  expect(result.ranges.at(-1)?.endMs).toBe(31835);
  result.ranges.forEach((r, i) => {
    expect(r.startMs).toBe(i ? result.ranges[i - 1].endMs : 0);
    expect(r.endMs - r.startMs).toBeGreaterThanOrEqual(2000);
    expect(r.endMs - r.startMs).toBeLessThanOrEqual(15000);
  });
});
it("does not buy extra requests for many short source shots", () => {
  const result = planSourceSegments(
    {
      ...report,
      shots: Array.from({ length: 15 }, (_, i) => ({
        id: String(i),
        startMs: i * 2100,
        endMs: i === 14 ? 31835 : (i + 1) * 2100,
      })),
    },
    limits,
  );
  expect(result.ranges).toHaveLength(3);
  expect(result.boundaryOffsetsMs.some((x) => x > 0)).toBe(true);
});
it("rejects an impossible accepted limit before any generation", () => {
  expect(() =>
    planSourceSegments(report, { ...limits, maxRequests: 2 }),
  ).toThrow();
  expect(() =>
    planSourceSegments({ ...report, source: { durationMs: 1800 } }, limits),
  ).toThrow();
});
