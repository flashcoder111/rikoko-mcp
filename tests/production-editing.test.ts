import { describe, expect, it } from "vitest";
import { compositionSchema } from "../packages/contracts/src/index.js";
import {
  productionEditingSchema,
  validateProductionEditing,
  validateEditingComposition,
  editingShotDirection,
} from "../packages/core/src/production-editing.js";
const plan = () => ({
  title: "Assembly ad",
  shots: [
    { id: "assemble", durationMs: 2000 },
    { id: "hero", durationMs: 2000 },
  ],
  editing: productionEditingSchema.parse({
    version: 1,
    audio: {
      mode: "shared_track",
      assetId: "music",
      sourceSha256: "a".repeat(64),
      gain: 0.2,
      allowNativeAudio: false,
      ending: "resolve",
      endingReason: "Resolve on the product hold",
      beatPoints: [
        {
          id: "accent",
          timeMs: 2000,
          kind: "accent",
          provenance: "manual",
          evidence: "Listened to the supplied recording at 2 seconds",
        },
      ],
      syncPoints: [
        {
          shotId: "hero",
          offsetMs: 0,
          beatId: "accent",
          toleranceMs: 80,
          description: "Product reveal",
        },
      ],
    },
    ending: {
      shotIds: ["hero"],
      strategy: "product_brand",
      productVisible: true,
      brandText: "example",
      minHoldMs: 1500,
      reason: "Product and brand remain together",
    },
  }),
});
const composition = () =>
  compositionSchema.parse({
    schemaVersion: 1,
    title: "Assembly ad",
    width: 720,
    height: 1280,
    scenes: [
      {
        id: "one",
        productionShotId: "assemble",
        assetId: "clip1",
        durationMs: 2000,
        volume: 0,
      },
      {
        id: "two",
        productionShotId: "hero",
        assetId: "clip2",
        durationMs: 2000,
        volume: 0,
        text: "example",
      },
    ],
    audio: { assetId: "music", gain: 0.2 },
  });
const assets = () =>
  new Map<string, any>([
    [
      "music",
      {
        id: "music",
        kind: "audio",
        sha256: "a".repeat(64),
        metadata: { hasAudio: true, durationMs: 5000 },
      },
    ],
    ["clip1", { kind: "video", metadata: { hasAudio: true } }],
    ["clip2", { kind: "video", metadata: { hasAudio: true } }],
  ]);
describe("production editing contract", () => {
  it("preserves a valid source-bound audio and product ending plan", () => {
    expect(validateProductionEditing(plan())).toEqual([]);
    expect(validateEditingComposition(plan(), composition(), assets())).toEqual(
      [],
    );
  });
  it("rejects missing audio binding, duplicate beats and missing target shots", () => {
    const p = plan();
    delete (p.editing.audio as any).sourceSha256;
    p.editing.audio!.beatPoints.push({ ...p.editing.audio!.beatPoints[0] });
    p.editing.audio!.syncPoints[0].shotId = "missing";
    expect(validateProductionEditing(p).map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "AUDIO_SOURCE_REQUIRED",
        "DUPLICATE_BEAT",
        "SYNC_SHOT_INVALID",
      ]),
    );
  });
  it("rejects a beat outside its shot timing and invalid ending placement", () => {
    const p = plan();
    p.editing.audio!.syncPoints[0].offsetMs = 2500;
    p.editing.ending!.shotIds = ["assemble"];
    expect(validateProductionEditing(p).map((i) => i.code)).toEqual(
      expect.arrayContaining(["SYNC_POINT_OUTSIDE_SHOT", "ENDING_NOT_FINAL"]),
    );
  });
  it("detects actual cut drift instead of trusting planned durations", () => {
    const c = composition();
    c.scenes[0].durationMs = 2400;
    expect(validateEditingComposition(plan(), c, assets())).toContainEqual(
      expect.objectContaining({
        code: "MUSIC_SYNC_MISMATCH",
        severity: "error",
      }),
    );
  });
  it("invalidates the beat map when audio bytes change", () => {
    const a = assets();
    a.get("music").sha256 = "b".repeat(64);
    expect(
      validateEditingComposition(plan(), composition(), a).map((i) => i.code),
    ).toContain("AUDIO_SOURCE_CHANGED");
  });
  it("rejects unplanned native sound and a short or replaced shared track", () => {
    const c = composition();
    c.scenes[0].volume = 1;
    const a = assets();
    a.get("music").metadata.durationMs = 2500;
    expect(validateEditingComposition(plan(), c, a).map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "UNPLANNED_NATIVE_AUDIO",
        "AUDIO_TRACK_TOO_SHORT",
      ]),
    );
    c.audio!.assetId = "other";
    expect(
      validateEditingComposition(plan(), c, a).map((i) => i.code),
    ).toContain("AUDIO_TRACK_MISMATCH");
  });
  it("does not let a graphic-only or short ending satisfy a product hold", () => {
    const c = composition();
    c.scenes[1].visualKind = "graphic";
    delete c.scenes[1].assetId;
    c.scenes[1].durationMs = 1000;
    expect(
      validateEditingComposition(plan(), c, assets()).map((i) => i.code),
    ).toEqual(
      expect.arrayContaining([
        "ENDING_PRODUCT_REQUIRED",
        "ENDING_HOLD_TOO_SHORT",
      ]),
    );
  });
  it("does not let an interleaved ending or reordered process silently pass", () => {
    const c = composition();
    c.scenes.reverse();
    expect(
      validateEditingComposition(plan(), c, assets()).map((i) => i.code),
    ).toContain("ENDING_NOT_FINAL");
  });
  it("allows intentional silent work without inventing music", () => {
    const p = plan();
    p.editing.audio = productionEditingSchema.parse({
      version: 1,
      audio: {
        mode: "silent",
        gain: 0,
        allowNativeAudio: false,
        ending: "silent",
        endingReason: "Silent product loop",
      },
    }).audio;
    const c = composition();
    delete c.audio;
    expect(validateEditingComposition(p, c, assets())).toEqual([]);
    c.scenes[0].volume = 1;
    expect(
      validateEditingComposition(p, c, assets()).map((i) => i.code),
    ).toContain("UNPLANNED_NATIVE_AUDIO");
  });
  it("compiles production sound policy and ending intent, not global beats into each independent model clip", () => {
    const text = editingShotDirection(plan(), "hero");
    expect(text).toContain("Do not generate background music");
    expect(text).toContain("example");
    expect(text).toContain("1500");
    expect(text).not.toContain("Listened to");
  });
  it("does not treat tone generators or sound events as silence", () => {
    const p = plan();
    p.editing.audio = productionEditingSchema.parse({
      version: 1,
      audio: {
        mode: "silent",
        gain: 0,
        allowNativeAudio: false,
        ending: "silent",
        endingReason: "Silent",
      },
    }).audio;
    const c = composition();
    c.audio = { toneHz: 440, gain: 0.2 };
    c.events = [
      {
        id: "fx",
        sceneId: "one",
        kind: "sound",
        assetId: "fx",
        offsetMs: 0,
        durationMs: 500,
        text: "",
        gain: 1,
      },
    ];
    expect(
      validateEditingComposition(p, c, assets()).map((i) => i.code),
    ).toEqual(
      expect.arrayContaining([
        "AUDIO_SILENCE_REQUIRED",
        "UNPLANNED_SOUND_EVENT",
      ]),
    );
  });
});
