import type { Composition } from "./index.js";

/** Sentence captions follow real speech only when the scene explicitly opts in. */
export function sceneCaptionInterval(scene: Composition["scenes"][number]) {
  if (scene.speechAlignment && scene.words?.length)
    return {
      startMs: scene.words[0].startMs,
      endMs: scene.words.at(-1)!.endMs,
    };
  return { startMs: 0, endMs: scene.durationMs };
}
