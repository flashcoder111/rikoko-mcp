import { expect, it } from "vitest";
import {
  referenceOperationSchema,
  referenceReportSchema,
} from "../packages/contracts/src/reference-analysis.js";
import { referenceInstructions } from "../packages/providers/src/reference-policy.js";
import { bindReferenceReport } from "../packages/core/src/reference-report.js";
import { referenceShotPrompts } from "../packages/core/src/reference-prompts.js";
import { planReferenceSegments } from "../packages/core/src/reference-planning.js";

export const detailedShot = () => ({
  id: "shot",
  startMs: 0,
  endMs: 2000,
  description: "A person in a doorway",
  framing: "full body",
  cameraMotion: "slight tilt up",
  action: "Jump",
  transition: "cut before contact",
  evidenceIds: ["ev"],
  details: {
    startState: "Arms down; a lit flashlight already lies on the floor.",
    endState: "Airborne, arms above head, before contact.",
    spatialRelations: "Subject behind foreground flashlight, facing camera.",
    lighting: "Cold window light.",
    actionStages: [
      {
        description: "Bend knees",
        subjectMotion: "Down and slightly forward",
        cameraMotion: "Still",
      },
      {
        description: "Leap and raise arms",
        subjectMotion: "Up and toward camera",
        cameraMotion: "Tilt up",
      },
    ],
    continuity: {
      fromPrevious: "Flashlight now on floor",
      toNext: "Match airborne pose",
      constraints: ["Do not add a landing"],
    },
  },
});
export const content = () => ({
  summary: "Jump",
  shots: [detailedShot()],
  narrativeBeats: [],
  events: [],
  visualStyle: { description: "Cold", evidenceIds: ["ev"] },
  speech: [],
  audio: { description: "Silent", evidenceIds: [] },
  evidence: [
    {
      id: "ev",
      startMs: 0,
      endMs: 2000,
      modality: "visual",
      observation: "Leap",
      confidence: "high",
    },
  ],
  unknowns: [],
});
export function reportFor(data: unknown = content(), detail = "recreate") {
  return bindReferenceReport(
    data,
    referenceOperationSchema.parse({
      kind: "reference_analyze",
      assetId: "source",
      model: "vision",
      detail,
    }),
    {
      id: "source",
      sha256: "a".repeat(64),
      metadata: { durationMs: 2000, hasAudio: false },
    } as any,
    {
      id: "job",
      ticket: { requestId: "request" },
      priceVersion: "test",
      referenceTiming: {
        status: "measured",
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

it("accepts independent analysis detail and focus controls without inventing FPS", () => {
  const input = referenceOperationSchema.parse({
    kind: "reference_analyze",
    assetId: "source",
    model: "vision",
    detail: "recreate",
    focus: ["motion", "continuity"],
  });
  expect(input.detail).toBe("recreate");
  expect(input.focus).toEqual(["motion", "continuity"]);
  expect(referenceOperationSchema.safeParse({ ...input, fps: 8 }).success).toBe(
    false,
  );
  expect(
    referenceOperationSchema.safeParse({ ...input, detail: "precise" }).success,
  ).toBe(false);
  const instructions = referenceInstructions(input);
  expect(instructions).toContain("actionStages");
  expect(instructions).toContain("startState");
  expect(instructions).toContain("Do not merge separate cuts");
});

it("persists full staged actions, rejects shallow recreate output, and reads legacy reports", () => {
  const report = reportFor();
  expect(report.analysis?.detail).toBe("recreate");
  expect(report.shots[0].details?.actionStages).toHaveLength(2);
  const shallow = content();
  delete (shallow.shots[0] as any).details;
  expect(() => reportFor(shallow)).toThrow();
  const old = reportFor(shallow, "shots");
  delete (old as any).analysis;
  expect(referenceReportSchema.safeParse(old).success).toBe(true);
});

it("uses the entire action record for image and video drafts without copying the overview", () => {
  const report = reportFor();
  const prompts = referenceShotPrompts(
    report,
    report.shots[0],
    "Same story with our character",
    "",
  );
  expect(prompts.imagePrompt).toContain("already lies on the floor");
  expect(prompts.videoPrompt).toContain("Bend knees");
  expect(prompts.videoPrompt).toContain("Up and toward camera");
  expect(prompts.videoPrompt).toContain("before contact");
  expect(prompts.videoPrompt).toContain("Match airborne pose");
  expect(prompts.videoPrompt).toContain("Do not add a landing");
});

it("includes adjacent shot states as context while keeping the current shot's style", () => {
  const report = reportFor();
  const next = structuredClone(report.shots[0]);
  next.id = "next";
  next.details!.startState = "Healthy person airborne in warm snow";
  report.shots.push(next);
  report.shots[0].visualStyle = "Cold cabin";
  const prompts = referenceShotPrompts(report, report.shots[0], "Remake", "");
  expect(prompts.videoPrompt).toContain("Healthy person airborne in warm snow");
  expect(prompts.videoPrompt).toContain("Cold cabin");
});

it("keeps every short candidate interval and uses bounded windows for long continuous shots", () => {
  const overview = planReferenceSegments(22000, [1000, 1100, 9000], "overview");
  const recreate = planReferenceSegments(22000, [1000, 1100, 9000], "recreate");
  expect(overview).toHaveLength(1);
  expect(recreate.slice(0, 3).map((s) => [s.startMs, s.endMs])).toEqual([
    [0, 1000],
    [1000, 1100],
    [1100, 9000],
  ]);
  expect(recreate.at(-1)?.endMs).toBe(22000);
  expect(recreate.every((s) => s.endMs - s.startMs <= 8000)).toBe(true);
  expect(recreate.some((s) => s.boundary === "window")).toBe(true);
  expect(
    recreate.every((s, i) => i === 0 || s.startMs === recreate[i - 1].endMs),
  ).toBe(true);
});

it("keeps sub-100ms insert shots and makes oversized drafts explicit instead of dropping stages", () => {
  const data = content();
  data.shots[0].endMs = 42;
  data.evidence[0].endMs = 42;
  expect(reportFor(data).shots[0].endMs).toBe(42);
  const report = reportFor();
  report.shots[0].details!.actionStages = Array.from({ length: 16 }, () => ({
    description: "x".repeat(400),
    subjectMotion: "y".repeat(300),
    cameraMotion: "z".repeat(300),
  }));
  expect(() =>
    referenceShotPrompts(report, report.shots[0], "Remake", ""),
  ).toThrow(/5000/);
  expect(
    referenceShotPrompts(report, report.shots[0], "Remake", "", {
      imagePrompt: "Authored image",
      videoPrompt: "Authored action",
    }).videoPrompt,
  ).toBe("Authored action");
});

it("allocates shot groups without inventing an FPS and refuses unbounded plans", () => {
  const shots = planReferenceSegments(
    30000,
    [1000, 2000, 3000, 4000, 5000, 6000],
    "shots",
  );
  expect(shots[0].endMs).toBe(4000);
  expect(shots.at(-1)?.endMs).toBe(30000);
  expect(planReferenceSegments(61000, [], "overview")).toHaveLength(5);
  expect(() => planReferenceSegments(0, [], "shots")).toThrow();
  expect(() =>
    planReferenceSegments(
      200000,
      Array.from({ length: 101 }, (_, i) => (i + 1) * 100),
      "recreate",
    ),
  ).toThrow(/100/);
});
