import { describe, expect, it } from "vitest";
import { compositionSchema } from "../packages/contracts/src/index.js";
import { applyEdits } from "../packages/core/src/editing.js";
import type { Edit } from "../packages/core/src/workspace-contracts.js";

const base = () =>
  compositionSchema.parse({
    schemaVersion: 1,
    title: "Audio",
    width: 144,
    height: 256,
    scenes: [
      {
        id: "a",
        durationMs: 4000,
        sourceStartMs: 1000,
        audioAssetId: "voice",
        audioSourceStartMs: 2000,
        words: [{ id: "w", text: "hello", startMs: 1000, endMs: 2000 }],
      },
    ],
    events: [
      {
        id: "e",
        sceneId: "a",
        wordId: "w",
        offsetMs: 200,
        durationMs: 600,
        kind: "text",
      },
    ],
  });
// Raw JSON exercises the same runtime boundary used by MCP and Studio.
const edit = (value: unknown) => value as Edit;
describe("audio timeline edits", () => {
  it("rounds anchored event boundaries together at non-integer playback ratios", () => {
    const c = base();
    c.scenes[0].durationMs = 1000;
    c.scenes[0].words = [{ id: "w", text: "hello", startMs: 2, endMs: 302 }];
    c.events[0].offsetMs = 2;
    c.events[0].durationMs = 996;
    const next = applyEdits(c, [
      edit({ type: "scene_speed", sceneId: "a", speed: 3 }),
    ]);
    expect(next.scenes[0].durationMs).toBe(333);
    expect(next.events[0]).toMatchObject({ offsetMs: 0, durationMs: 332 });
  });
  it("changes output speed while preserving source range and rescaling words, overlays and gain", () => {
    const original = base();
    const next = applyEdits(original, [
      edit({ type: "audio_fade", sceneId: "a", inMs: 1000, outMs: 1000 }),
      edit({ type: "scene_speed", sceneId: "a", speed: 2 }),
    ]);
    expect(next.scenes[0]).toMatchObject({
      durationMs: 2000,
      speed: 2,
      sourceStartMs: 1000,
      audioSourceStartMs: 2000,
      words: [{ startMs: 500, endMs: 1000 }],
      volumeEnvelope: [
        { timeMs: 0, gain: 0 },
        { timeMs: 500, gain: 1 },
        { timeMs: 1500, gain: 1 },
        { timeMs: 2000, gain: 0 },
      ],
    });
    expect(next.events[0]).toMatchObject({ offsetMs: 100, durationMs: 300 });
    expect(
      applyEdits(next, [edit({ type: "scene_speed", sceneId: "a", speed: 1 })])
        .scenes[0].durationMs,
    ).toBe(4000);
    expect(original.scenes[0].durationMs).toBe(4000);
  });
  it("splits a sped-up fade without restarting its gain or seeking the wrong source position", () => {
    const next = applyEdits(base(), [
      edit({
        type: "audio_envelope",
        sceneId: "a",
        points: [
          { timeMs: 0, gain: 0 },
          { timeMs: 4000, gain: 1 },
        ],
      }),
      edit({ type: "scene_speed", sceneId: "a", speed: 2 }),
      { type: "split", sceneId: "a", atMs: 1000 },
    ]);
    expect(next.scenes[1]).toMatchObject({
      sourceStartMs: 3000,
      audioSourceStartMs: 4000,
      volumeEnvelope: [
        { timeMs: 0, gain: 0.5 },
        { timeMs: 1000, gain: 1 },
      ],
    });
    expect(next.scenes[0]).toMatchObject({
      volumeEnvelope: [
        { timeMs: 0, gain: 0 },
        { timeMs: 1000, gain: 0.5 },
      ],
    });
  });
  it("clears the curve and rejects unordered, duplicate, out-of-range points and overlapping fades", () => {
    for (const points of [
      [
        { timeMs: 2000, gain: 1 },
        { timeMs: 1000, gain: 0 },
      ],
      [
        { timeMs: 0, gain: 0 },
        { timeMs: 0, gain: 1 },
      ],
      [{ timeMs: 4001, gain: 0 }],
      [{ timeMs: 0, gain: 1.1 }],
    ])
      expect(() =>
        applyEdits(base(), [
          edit({ type: "audio_envelope", sceneId: "a", points }),
        ]),
      ).toThrow();
    expect(() =>
      applyEdits(base(), [
        edit({ type: "audio_fade", sceneId: "a", inMs: 3000, outMs: 2000 }),
      ]),
    ).toThrow();
    expect(
      applyEdits(base(), [
        edit({ type: "audio_envelope", sceneId: "a", points: [] }),
      ]).scenes[0].volumeEnvelope,
    ).toBeUndefined();
  });
});
