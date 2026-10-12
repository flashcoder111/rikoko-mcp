export type VolumePoint = { timeMs: number; gain: number };

/** Constant outside the keys, linear between keys. Times are output milliseconds. */
export function envelopeGain(
  points: VolumePoint[] | undefined,
  timeMs: number,
): number {
  if (!points?.length) return 1;
  if (timeMs <= points[0].timeMs) return points[0].gain;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (timeMs <= b.timeMs)
      return (
        a.gain +
        ((b.gain - a.gain) * (timeMs - a.timeMs)) / (b.timeMs - a.timeMs)
      );
  }
  return points[points.length - 1].gain;
}

export function sliceEnvelope(
  points: VolumePoint[],
  start: number,
  end: number,
): VolumePoint[] {
  if (!points.length) return [];
  return [
    ...(start >= points[0].timeMs
      ? [{ timeMs: 0, gain: envelopeGain(points, start) }]
      : []),
    ...points
      .filter((p) => p.timeMs > start && p.timeMs < end)
      .map((p) => ({ ...p, timeMs: p.timeMs - start })),
    ...(end <= points[points.length - 1].timeMs
      ? [{ timeMs: end - start, gain: envelopeGain(points, end) }]
      : []),
  ];
}
