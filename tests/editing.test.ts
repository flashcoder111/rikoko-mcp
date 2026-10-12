import { describe, expect, it } from "vitest";
import { compositionSchema } from "../packages/contracts/src/index.js";
import { applyEdits } from "../packages/core/src/editing.js";
import type { Edit } from "../packages/core/src/workspace-contracts.js";

const base = () =>
  compositionSchema.parse({
    schemaVersion: 1,
    title: "Edits",
    width: 360,
    height: 640,
    language: "en",
    scenes: [
      {
        id: "a",
        durationMs: 4000,
        sourceStartMs: 5000,
        audioAssetId: "voice",
        audioSourceStartMs: 2000,
        text: "one two three four",
        words: [
          { id: "w1", text: "one", startMs: 0, endMs: 900 },
          { id: "w2", text: "two", startMs: 1000, endMs: 1900 },
          { id: "w3", text: "three", startMs: 2000, endMs: 2900 },
          { id: "w4", text: "four", startMs: 3000, endMs: 3900 },
        ],
      },
      { id: "b", durationMs: 1000, text: "finish" },
    ],
    events: [
      {
        id: "before",
        sceneId: "a",
        wordId: "w1",
        offsetMs: 0,
        durationMs: 500,
        kind: "text",
        text: "before",
      },
      {
        id: "after",
        sceneId: "a",
        wordId: "w3",
        offsetMs: 0,
        durationMs: 500,
        kind: "text",
        text: "after",
      },
      {
        id: "plain",
        sceneId: "a",
        offsetMs: 3000,
        durationMs: 300,
        kind: "text",
        text: "plain",
      },
    ],
    audio: { assetId: "music", gain: 0.5 },
  });
describe("non-destructive media edits", () => {
  it("can split the same source repeatedly across independent editing requests", () => {
    const first = applyEdits(base(), [
      { type: "split", sceneId: "a", atMs: 2000 },
    ]);
    const second = applyEdits(first, [
      { type: "split", sceneId: "a", atMs: 1000 },
    ]);
    expect(new Set(second.scenes.map((s) => s.id)).size).toBe(4);
    expect(second.scenes.slice(0, 3).map((s) => s.sourceStartMs)).toEqual([
      5000, 6000, 7000,
    ]);
    expect(
      applyEdits(base(), [
        { type: "visual", sceneId: "a", assetId: "new", preserveAudio: false },
      ]).scenes[0].audioAssetId,
    ).toBeUndefined();
  });
  it("splits picture, original source, separate narration, words and graphics on the same boundary", () => {
    const original = base();
    const next = applyEdits(original, [
      { type: "split", sceneId: "a", atMs: 2000 },
    ]);
    expect(next.scenes).toHaveLength(3);
    expect(next.scenes[1]).toMatchObject({
      sourceStartMs: 7000,
      audioSourceStartMs: 4000,
      durationMs: 2000,
      text: "three four",
      words: [
        { id: "w3", startMs: 0, endMs: 900 },
        { id: "w4", startMs: 1000, endMs: 1900 },
      ],
    });
    expect(next.events.find((e) => e.text === "after")).toMatchObject({
      sceneId: next.scenes[1].id,
      wordId: "w3",
      offsetMs: 0,
    });
    expect(next.events.find((e) => e.text === "plain")).toMatchObject({
      sceneId: next.scenes[1].id,
      offsetMs: 1000,
    });
    expect(original.scenes).toHaveLength(2);
    expect(original.scenes[0].sourceStartMs).toBe(5000);
  });
  it("trims only the selected interval and removes out-of-range caption words and events", () => {
    const next = applyEdits(base(), [
      { type: "trim", sceneId: "a", startMs: 1000, endMs: 3000 },
    ]);
    expect(next.scenes[0]).toMatchObject({
      sourceStartMs: 6000,
      audioSourceStartMs: 3000,
      text: "two three",
      durationMs: 2000,
    });
    expect(next.events).toHaveLength(1);
    expect(next.events[0].wordId).toBe("w3");
  });
  it("deletes word-aligned speech from both sound and picture without retaining the removed words", () => {
    const next = applyEdits(base(), [
      { type: "delete_words", sceneId: "a", wordIds: ["w2", "w3"] },
    ]);
    expect(
      next.scenes.flatMap((s) => s.words?.map((w) => w.id) ?? []),
    ).not.toContain("w2");
    expect(next.scenes.slice(0, -1).reduce((t, s) => t + s.durationMs, 0)).toBe(
      2200,
    );
    expect(next.events.every((e) => e.wordId !== "w3")).toBe(true);
  });
  it("caption corrections preserve narration and timing while scene deletion removes dependent graphics", () => {
    const original = base();
    const corrected = applyEdits(original, [
      { type: "caption", sceneId: "a", text: "Corrected spelling" },
    ]);
    expect(corrected.scenes[0].audioAssetId).toBe("voice");
    expect(corrected.scenes[0].words).toEqual(original.scenes[0].words);
    const deleted = applyEdits(corrected, [{ type: "delete", sceneId: "a" }]);
    expect(deleted.events).toEqual([]);
    expect(deleted.scenes[0].id).toBe("b");
  });
  it("supports reordering, image replacement, insertion, sound, captions, music and aspect ratio in one edit transaction", () => {
    const next = applyEdits(base(), [
      { type: "move", sceneId: "b", toIndex: 0 },
      {
        type: "visual",
        sceneId: "b",
        assetId: "photo",
        fit: "cover",
        preserveAudio: true,
      },
      {
        type: "insert",
        atIndex: 2,
        scene: compositionSchema.parse({
          ...base(),
          scenes: [{ id: "new", durationMs: 1000 }],
          events: [],
        }).scenes[0],
      },
      {
        type: "scene_audio",
        sceneId: "a",
        audioAssetId: "newvoice",
        volume: 0.5,
      },
      { type: "style", fontSize: 40, color: "#eeeeee", background: "#112233" },
      { type: "music", gain: 0.2, assetId: "differentmusic" },
      { type: "format", width: 640, height: 360 },
    ]);
    expect(next.scenes.map((s) => s.id)).toEqual(["b", "a", "new"]);
    expect(next.scenes[0]).toMatchObject({
      assetId: "photo",
      fit: "cover",
      sourceStartMs: 0,
    });
    expect(next.scenes[1]).toMatchObject({
      audioAssetId: "newvoice",
      audioSourceStartMs: 0,
      volume: 0.5,
    });
    expect(next.captionStyle.fontSize).toBe(40);
    expect(next.width).toBe(640);
    expect(next.audio?.assetId).toBe("differentmusic");
    expect(applyEdits(next, [{ type: "music", gain: 0.1 }]).audio?.gain).toBe(
      0.1,
    );
    const muted = applyEdits(next, [
      { type: "scene_audio", sceneId: "a", audioAssetId: null, volume: 1 },
      { type: "music", gain: 0, assetId: null },
    ]);
    expect(muted.audio).toBeUndefined();
    expect(muted.scenes[1].audioAssetId).toBeUndefined();
    expect(muted.scenes[1].volume).toBe(0);
  });
  it("allows cutting untranscribed source clips without inventing words", () => {
    const next = applyEdits(base(), [
      { type: "trim", sceneId: "b", startMs: 200, endMs: 900 },
      { type: "scene_audio", sceneId: "b", volume: 0.25 },
    ]);
    expect(next.scenes[1]).toMatchObject({
      text: "finish",
      sourceStartMs: 200,
      durationMs: 700,
      volume: 0.25,
    });
    expect(next.scenes[1].words).toBeUndefined();
  });
  it.each([
    { type: "delete", sceneId: "missing" },
    { type: "move", sceneId: "a", toIndex: 50 },
    { type: "split", sceneId: "a", atMs: 0 },
    { type: "trim", sceneId: "a", startMs: 3900, endMs: 5000 },
    { type: "trim", sceneId: "a", startMs: 3000, endMs: 2000 },
    { type: "delete_words", sceneId: "b", wordIds: ["w1"] },
    { type: "delete_words", sceneId: "a", wordIds: ["missing"] },
    {
      type: "insert",
      atIndex: 5,
      scene: {
        id: "x",
        durationMs: 1000,
        text: "",
        sourceStartMs: 0,
        color: "#112233",
        volume: 1,
        fit: "contain",
      },
    },
  ] as Edit[])(
    "rejects invalid or ambiguous editing instead of corrupting the project: $type",
    (edit) => {
      const original = base();
      expect(() => applyEdits(original, [edit])).toThrow();
      expect(original).toEqual(base());
    },
  );
  it("rejects deleting the final clip, duplicate IDs and cuts that would remove all media", () => {
    expect(() =>
      applyEdits(base(), [
        { type: "delete", sceneId: "b" },
        { type: "delete", sceneId: "a" },
      ]),
    ).toThrow();
    expect(() =>
      applyEdits(base(), [
        { type: "insert", atIndex: 0, scene: base().scenes[0] },
      ]),
    ).toThrow();
    const c = base();
    c.scenes[0].words = [{ id: "all", text: "all", startMs: 0, endMs: 4000 }];
    c.events = [];
    expect(() =>
      applyEdits(c, [{ type: "delete_words", sceneId: "a", wordIds: ["all"] }]),
    ).toThrow();
  });
});
it("changing fit preserves trim offsets, audio and manually corrected captions through a split", () => {
  const edited = applyEdits(base(), [
    { type: "caption", sceneId: "a", text: "Manually corrected caption" },
    { type: "scene_fit", sceneId: "a", fit: "cover" },
    { type: "split", sceneId: "a", atMs: 2000 },
  ]);
  expect(edited.scenes[0]).toMatchObject({
    sourceStartMs: 5000,
    audioSourceStartMs: 2000,
    fit: "cover",
    text: "Manually corrected caption",
  });
  expect(edited.scenes[1]).toMatchObject({
    sourceStartMs: 7000,
    audioSourceStartMs: 4000,
    fit: "cover",
    text: "Manually corrected caption",
  });
});
