import { expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { media } from "../packages/render/src/media.js";
import { compositionSchema } from "../packages/contracts/src/index.js";
it("produces a real decodable local video, sound, burned text and SRT", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "render-"));
  try {
    const result = await media({
      command: "render",
      workDir,
      assets: {},
      composition: compositionSchema.parse({
        schemaVersion: 1,
        title: "Local evidence",
        width: 360,
        height: 640,
        fps: 24,
        scenes: [
          { id: "a", durationMs: 1000, text: "Hello Orbit" },
          { id: "b", durationMs: 1000, text: "A new story", color: "#563b43" },
        ],
        audio: { toneHz: 220, gain: 0.1 },
      }),
    });
    expect(result.metadata.width).toBe(360);
    expect(result.metadata.height).toBe(640);
    expect(result.metadata.hasAudio).toBe(true);
    expect(Math.abs(result.metadata.durationMs - 2000)).toBeLessThanOrEqual(42);
    expect((await readFile(result.output)).byteLength).toBeGreaterThan(10000);
    expect(await readFile(result.subtitles, "utf8")).toContain("A new story");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}, 60000);

it("bounds decoder threads for multiple looping overlays and finishes repeat renders", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "overlay-"));
  try {
    for (let i = 0; i < 3; i++) {
      const result = await media(
        {
          command: "render",
          workDir,
          assets: {},
          composition: compositionSchema.parse({
            schemaVersion: 1,
            title: "Overlay",
            width: 360,
            height: 640,
            scenes: [
              {
                id: "a",
                durationMs: 2000,
                text: "Overlay scheduling",
                words: [{ id: "word", text: "word", startMs: 200, endMs: 700 }],
              },
            ],
            events: [
              {
                id: "card",
                sceneId: "a",
                wordId: "word",
                offsetMs: 0,
                durationMs: 500,
                kind: "card",
                text: "A timed card",
              },
            ],
          }),
        },
        AbortSignal.timeout(15000),
      );
      expect(Math.abs(result.metadata.durationMs - 2000)).toBeLessThanOrEqual(
        42,
      );
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}, 60000);

it("keeps fractional scene durations within one frame of the complete timeline", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "timing-"));
  try {
    const result = await media(
      {
        command: "render",
        workDir,
        assets: {},
        composition: compositionSchema.parse({
          schemaVersion: 1,
          title: "Frame timing",
          width: 144,
          height: 144,
          fps: 24,
          scenes: Array.from({ length: 8 }, (_, i) => ({
            id: `s${i}`,
            durationMs: 555,
            text: "",
          })),
        }),
      },
      AbortSignal.timeout(15000),
    );
    expect(Math.abs(result.metadata.durationMs - 4440)).toBeLessThanOrEqual(42);
    expect(result.metadata.fps).toBe(24);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}, 30000);
