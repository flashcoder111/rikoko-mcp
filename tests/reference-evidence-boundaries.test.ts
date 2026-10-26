import { expect, it } from "vitest";
import { bindReferenceReport } from "../packages/core/src/reference-report.js";
import {
  referenceOperationSchema,
  referenceReportSchema,
} from "../packages/contracts/src/reference-analysis.js";
import { referenceInstructions } from "../packages/providers/src/reference-policy.js";

const input = referenceOperationSchema.parse({
  kind: "reference_analyze",
  assetId: "source",
  model: "vision",
  detail: "shots",
});
function fixture() {
  const timed = {
    startMs: 1133,
    endMs: 5600,
    evidenceIds: ["before", "current", "after"],
  };
  return {
    summary: "Synthetic boundary-reference regression",
    shots: [
      {
        id: "shot",
        ...timed,
        description: "Scene",
        framing: "Wide",
        cameraMotion: "Still",
        action: "Motion",
        transition: "Cut",
      },
    ],
    narrativeBeats: [
      {
        id: "beat",
        ...structuredClone(timed),
        role: "Opening",
        description: "Scene",
      },
    ],
    events: [
      {
        id: "event",
        ...structuredClone(timed),
        type: "action",
        description: "Motion",
      },
    ],
    speech: [
      {
        ...structuredClone(timed),
        text: "Synthetic speech",
        speaker: "Speaker",
      },
    ],
    visualStyle: {
      description: "Daylight",
      evidenceIds: ["before", "current", "after"],
    },
    audio: { description: "Speech", evidenceIds: ["current"] },
    evidence: [
      {
        id: "before",
        startMs: 0,
        endMs: 1133,
        modality: "visual",
        observation: "Earlier scene",
        confidence: "high",
      },
      {
        id: "current",
        startMs: 1133,
        endMs: 5600,
        modality: "audiovisual",
        observation: "Scene",
        confidence: "high",
      },
      {
        id: "after",
        startMs: 5600,
        endMs: 6800,
        modality: "visual",
        observation: "Later scene",
        confidence: "high",
      },
    ],
    unknowns: [],
  };
}
function bind(data: unknown) {
  return bindReferenceReport(
    data,
    input,
    {
      id: "source",
      sha256: "a".repeat(64),
      metadata: { durationMs: 6800, hasAudio: true },
    } as any,
    {
      id: "job",
      ticket: { requestId: "request" },
      priceVersion: "test",
      referenceTiming: {
        status: "unavailable",
        method: "ffmpeg-scene-difference",
        threshold: 0.3,
        cutTimesMs: [],
      },
    } as any,
    { id: "vision", endpoint: "openrouter/router/video" } as any,
    {
      fps: null,
      mode: "provider_controlled",
      rangeControl: "prompt",
      upstreamModel: "gemini",
    },
  );
}

it("removes redundant boundary-only references while preserving real evidence, source timing and raw output", () => {
  const raw = fixture(),
    before = structuredClone(raw);
  const report = bind(raw);
  for (const item of [
    ...report.shots,
    ...report.events,
    ...report.narrativeBeats,
    ...report.speech,
  ]) {
    expect(item.evidenceIds).toEqual(["current"]);
    expect([item.startMs, item.endMs]).toEqual([1133, 5600]);
  }
  expect(raw).toEqual(before);
  expect(report.evidence).toEqual(raw.evidence);
  expect(report.visualStyle).toEqual(raw.visualStyle);
  expect(report.coverage.gaps).toEqual([
    { startMs: 0, endMs: 1133 },
    { startMs: 5600, endMs: 6800 },
  ]);
  expect(referenceReportSchema.safeParse(report).success).toBe(true);
});

it.each(["shots", "events", "narrativeBeats", "speech"] as const)(
  "rejects %s supported only by adjacent evidence",
  (group) => {
    const raw = fixture();
    raw[group][0].evidenceIds = ["before", "after"];
    expect(() => bind(raw)).toThrow("Analysis has invalid");
  },
);

it("still rejects unknown IDs, distant evidence, overlapping shots, missing details and out-of-range times", () => {
  const unknown = fixture();
  unknown.shots[0].evidenceIds.push("missing");
  expect(() => bind(unknown)).toThrow();
  const distant = fixture();
  distant.evidence[0].endMs = 1100;
  expect(() => bind(distant)).toThrow();
  const overlap = fixture();
  overlap.shots.push({ ...overlap.shots[0], id: "overlapping" });
  expect(() => bind(overlap)).toThrow();
  const outside = fixture();
  outside.shots[0].endMs = 6801;
  expect(() => bind(outside)).toThrow();
  const report = bind(fixture());
  report.analysis!.detail = "recreate";
  expect(referenceReportSchema.safeParse(report).success).toBe(false);
  report.analysis!.detail = "shots";
  report.shots[0].evidenceIds.push("after");
  expect(referenceReportSchema.safeParse(report).success).toBe(false);
});

it("instructs the provider to use positive temporal overlap instead of adjacent-shot evidence", () => {
  expect(referenceInstructions(input)).toContain(
    "evidence.startMs < item.endMs",
  );
  expect(referenceInstructions(input)).toContain(
    "evidence.endMs > item.startMs",
  );
});
