import {
  AppError,
  compositionSchema,
  type Composition,
} from "../../contracts/src/index.js";
import { editSchema, type Edit } from "./workspace-contracts.js";
import { sliceEnvelope } from "../../contracts/src/audio.js";

const fail = (message: string): never => {
  throw new AppError("INVALID_EDIT", message);
};
type Scene = Composition["scenes"][number];

function sliceScene(
  c: Composition,
  scene: Scene,
  start: number,
  end: number,
  newId: string,
) {
  if (start < 0 || end > scene.durationMs || end - start < 100)
    fail("片段至少保留 0.1 秒，且不能超出原片段。");
  const words = scene.words
    ?.filter((w) => w.startMs >= start && w.endMs <= end)
    .map((w) => ({ ...w, startMs: w.startMs - start, endMs: w.endMs - start }));
  const result: Scene = {
    ...scene,
    id: newId,
    durationMs: end - start,
    sourceStartMs: scene.sourceStartMs + Math.round(start * (scene.speed ?? 1)),
    audioSourceStartMs:
      (scene.audioSourceStartMs ?? 0) + Math.round(start * (scene.speed ?? 1)),
    ...(scene.volumeEnvelope?.length
      ? { volumeEnvelope: sliceEnvelope(scene.volumeEnvelope, start, end) }
      : {}),
    ...(words
      ? {
          words,
          text:
            scene.text ===
            scene.words
              ?.map((w) => w.text)
              .join(c.language.startsWith("zh") ? "" : " ")
              ? words
                  .map((w) => w.text)
                  .join(c.language.startsWith("zh") ? "" : " ")
              : scene.text,
        }
      : {}),
  };
  const events = c.events
    .filter((e) => e.sceneId === scene.id)
    .flatMap((event) => {
      const anchor = event.wordId
        ? (scene.words?.find((w) => w.id === event.wordId)?.startMs ?? 0)
        : 0;
      const from = anchor + event.offsetMs,
        to = from + event.durationMs;
      if (from < start || to > end) return [];
      const keptWord = result.words?.find((w) => w.id === event.wordId);
      return [
        {
          ...event,
          id: `${event.id.slice(0, 60)}_${newId.slice(-30)}`,
          sceneId: newId,
          wordId: keptWord?.id,
          offsetMs: from - start - (keptWord?.startMs ?? 0),
        },
      ];
    });
  return { scene: result, events };
}

/** Deterministic edits shared by chat and studio. Inputs never become shell commands. */
export function applyEdits(base: Composition, raw: Edit[]): Composition {
  let next = structuredClone(base);
  for (const [editIndex, value] of raw.entries()) {
    const edit = editSchema.parse(value);
    const index =
      "sceneId" in edit
        ? next.scenes.findIndex((s) => s.id === edit.sceneId)
        : -1;
    if ("sceneId" in edit && index < 0) fail("找不到所选镜头，请刷新作品。");
    const scene = next.scenes[index];
    switch (edit.type) {
      case "scene_speed": {
        const ratio = (scene.speed ?? 1) / edit.speed;
        const scale = (ms: number) => Math.round(ms * ratio);
        const oldWords = scene.words;
        scene.durationMs = scale(scene.durationMs);
        scene.speed = edit.speed;
        scene.words = scene.words?.map((w) => ({
          ...w,
          startMs: scale(w.startMs),
          endMs: scale(w.endMs),
        }));
        scene.volumeEnvelope = scene.volumeEnvelope?.map((p) => ({
          ...p,
          timeMs: scale(p.timeMs),
        }));
        next.events = next.events.map((e) => {
          if (e.sceneId !== scene.id) return e;
          const anchor = oldWords?.find((w) => w.id === e.wordId)?.startMs ?? 0;
          const start = anchor + e.offsetMs;
          return {
            ...e,
            offsetMs: scale(start) - scale(anchor),
            durationMs: scale(start + e.durationMs) - scale(start),
          };
        });
        break;
      }
      case "audio_envelope":
        if (edit.points.length) scene.volumeEnvelope = edit.points;
        else delete scene.volumeEnvelope;
        break;
      case "audio_fade": {
        if (edit.inMs + edit.outMs > scene.durationMs)
          fail("淡入与淡出总时长不能超过镜头长度。");
        const points = new Map<number, number>();
        points.set(0, edit.inMs ? 0 : 1);
        if (edit.inMs) points.set(edit.inMs, 1);
        if (edit.outMs) points.set(scene.durationMs - edit.outMs, 1);
        points.set(scene.durationMs, edit.outMs ? 0 : 1);
        if (!edit.inMs && !edit.outMs) delete scene.volumeEnvelope;
        else
          scene.volumeEnvelope = [...points].map(([timeMs, gain]) => ({
            timeMs,
            gain,
          }));
        break;
      }
      case "scene_fit":
        scene.fit = edit.fit;
        break;
      case "caption":
        scene.text = edit.text;
        break;
      case "delete":
        if (next.scenes.length === 1) fail("作品至少需要一个镜头。");
        next.scenes.splice(index, 1);
        next.events = next.events.filter((e) => e.sceneId !== scene.id);
        break;
      case "move": {
        if (edit.toIndex >= next.scenes.length) fail("目标位置超出镜头列表。");
        next.scenes.splice(index, 1);
        next.scenes.splice(edit.toIndex, 0, scene);
        break;
      }
      case "trim":
      case "split":
      case "delete_words": {
        let intervals: { start: number; end: number }[];
        if (edit.type === "trim")
          intervals = [{ start: edit.startMs, end: edit.endMs }];
        else if (edit.type === "split")
          intervals = [
            { start: 0, end: edit.atMs },
            { start: edit.atMs, end: scene.durationMs },
          ];
        else {
          if (!scene.words?.length) fail("按词删减需要先转录并对齐此片段。");
          const removed = scene.words!.filter((w) =>
            edit.wordIds.includes(w.id),
          );
          if (removed.length !== new Set(edit.wordIds).size)
            fail("所选文字不属于此片段。");
          intervals = [];
          let cursor = 0;
          for (const word of removed) {
            if (word.startMs - cursor >= 100)
              intervals.push({ start: cursor, end: word.startMs });
            cursor = word.endMs;
          }
          if (scene.durationMs - cursor >= 100)
            intervals.push({ start: cursor, end: scene.durationMs });
          if (!intervals.length)
            fail("删除后没有可保留的片段，请删除整个镜头。");
        }
        const usedIds = new Set(next.scenes.map((s) => s.id));
        const slices = intervals.map((part, i) => {
          let id = scene.id;
          if (i > 0) {
            let suffix = i;
            do {
              id = `${scene.id.slice(0, 65)}_cut${editIndex}_${suffix++}`;
            } while (usedIds.has(id));
            usedIds.add(id);
          }
          return sliceScene(next, scene, part.start, part.end, id);
        });
        next.events = [
          ...next.events.filter((e) => e.sceneId !== scene.id),
          ...slices.flatMap((s) => s.events),
        ];
        next.scenes.splice(index, 1, ...slices.map((s) => s.scene));
        break;
      }
      case "visual":
        scene.assetId = edit.assetId;
        scene.sourceStartMs = 0;
        if (!edit.preserveAudio) {
          delete scene.audioAssetId;
          delete scene.audioSourceStartMs;
        }
        if (edit.fit) scene.fit = edit.fit;
        break;
      case "scene_audio":
        scene.volume = edit.volume;
        if (edit.audioAssetId === null) {
          delete scene.audioAssetId;
          scene.volume = 0;
        } else if (edit.audioAssetId) {
          scene.audioAssetId = edit.audioAssetId;
          scene.audioSourceStartMs = 0;
        }
        break;
      case "insert":
        if (edit.atIndex > next.scenes.length) fail("插入位置超出镜头列表。");
        next.scenes.splice(edit.atIndex, 0, edit.scene);
        break;
      case "style": {
        const { type: _, ...style } = edit;
        Object.assign(next.captionStyle, style);
        break;
      }
      case "music": {
        if (edit.assetId === null) delete next.audio;
        else
          next.audio = {
            ...next.audio,
            gain: edit.gain,
            ...(edit.assetId
              ? { assetId: edit.assetId, toneHz: undefined }
              : {}),
          };
        break;
      }
      case "format":
        next.width = edit.width;
        next.height = edit.height;
        break;
    }
    next = compositionSchema.parse(next);
  }
  return next;
}
