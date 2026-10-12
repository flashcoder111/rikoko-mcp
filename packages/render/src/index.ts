import {
  compositionSchema,
  type Composition,
} from "../../contracts/src/index.js";
export function resolveTimeline(input: Composition) {
  const c = compositionSchema.parse(input);
  let offset = 0;
  const scenes = c.scenes.map((s) => {
    const timed = { ...s, startMs: offset, endMs: offset + s.durationMs };
    offset = timed.endMs;
    return timed;
  });
  const events = c.events.map((e) => {
    const scene = scenes.find((s) => s.id === e.sceneId)!;
    const word = scene.words?.find((w) => w.id === e.wordId);
    return {
      ...e,
      startMs: scene.startMs + (word?.startMs ?? 0) + e.offsetMs,
      endMs: scene.startMs + (word?.startMs ?? 0) + e.offsetMs + e.durationMs,
    };
  });
  return { durationMs: offset, scenes, events };
}
export function srt(c: Composition) {
  let n = 0;
  return resolveTimeline(c)
    .scenes.filter((s) => s.text)
    .map(
      (s) => `${++n}\n${stamp(s.startMs)} --> ${stamp(s.endMs)}\n${s.text}\n`,
    )
    .join("\n");
}
export function stamp(ms: number) {
  const n = Math.round(ms);
  return `${String(Math.floor(n / 3600000)).padStart(2, "0")}:${String(Math.floor(n / 60000) % 60).padStart(2, "0")}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")},${String(n % 1000).padStart(3, "0")}`;
}
export function editMap(segments: { startMs: number; endMs: number }[]) {
  let output = 0;
  return segments.map((s) => {
    const v = {
      sourceStartMs: s.startMs,
      sourceEndMs: s.endMs,
      outputStartMs: output,
      outputEndMs: output + s.endMs - s.startMs,
    };
    output = v.outputEndMs;
    return v;
  });
}
export function remapWords(
  words: { id: string; text: string; startMs: number; endMs: number }[],
  segments: { startMs: number; endMs: number }[],
) {
  return editMap(segments).flatMap((s, index) =>
    words
      .filter((w) => w.startMs >= s.sourceStartMs && w.endMs <= s.sourceEndMs)
      .map((w) => ({
        ...w,
        id: `${w.id}_${index}`,
        sourceWordId: w.id,
        startMs: w.startMs - s.sourceStartMs + s.outputStartMs,
        endMs: w.endMs - s.sourceStartMs + s.outputStartMs,
      })),
  );
}
