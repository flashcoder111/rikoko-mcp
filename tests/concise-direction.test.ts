import { expect, it } from "vitest";
import { compilePrompt } from "../packages/core/src/production-prompts.js";
import {
  productionPlanSchema,
  productionShotDirection,
} from "../packages/core/src/production-plan.js";
import { referenceHandoff } from "../packages/core/src/reference-handoff.js";
import { analysisDetailInstructions } from "../packages/providers/src/reference-policy.js";

const sceneDirection =
  "One continuous 4-second macro shot. A tiny crane suspends one cheese-topped patty above an empty bottom bun on a dark wooden board. Lower vertically, make contact by 2.5 seconds, release only after the bun bears the weight, and hold the open stack. No top bun or greens. Warm side light; a slow camera drift keeps contact visible.";
const plan = () =>
  productionPlanSchema.parse({
    title: "Patty placement",
    width: 720,
    height: 1280,
    shots: [
      {
        id: "place",
        initialState: { patty: "suspended above bottom bun" },
        action: "Lower onto bun, then release",
        actionStages: ["Approach", "Contact", "Release", "Hold"],
        endState: { patty: "supported by bottom bun" },
        camera: "Slow drift",
        sceneDirection,
        generationConstraints: ["One patty only"],
        references: [
          {
            assetId: "product",
            role: "product",
            instruction: "Burger materials only, not assembly state",
          },
          {
            assetId: "motion",
            role: "motion",
            transfer: "action",
            instruction: "Only the vertical lowering and contact",
          },
          {
            assetId: "source",
            role: "source_video",
            usage: "analysis_only",
            instruction: "Original analysis only",
          },
        ],
      },
    ],
  });

it("compiles authored scene prose once, keeps explicit constraints and actual reference bindings", () => {
  const p = plan();
  const result = compilePrompt(
    {
      mode: "reference_to_video",
      subject: "Patty",
      ...productionShotDirection(p, p.shots[0]),
    },
    "kling",
  );
  expect(result.prompt).toContain(sceneDirection);
  expect(result.prompt).not.toContain("Ordered action stages");
  expect(result.prompt).not.toContain("At the start:");
  expect(result.prompt).not.toContain("Required final state:");
  expect(result.prompt).toContain("One patty only");
  expect(result.prompt).toContain("@Image1");
  expect(result.prompt).toContain("@Video1");
  expect(result.prompt).not.toContain("Original analysis only");
  expect(result.direction.initialState).toEqual(p.shots[0].initialState);
  expect(result.direction.endState).toEqual(p.shots[0].endState);
  expect(result.compilerVersion).toBe("rikoko-prompt-compiler-v5");
  expect(compilePrompt(result.direction, "kling").prompt).toBe(result.prompt);
});

it("keeps boundary images state-based even when the video uses sceneDirection", () => {
  const p = plan();
  const base = {
    mode: "image_edit",
    subject: "Patty",
    ...productionShotDirection(p, p.shots[0]),
  };
  for (const stage of ["first_frame", "last_frame"] as const) {
    const result = compilePrompt({
      ...base,
      ...productionShotDirection(p, p.shots[0], stage),
    });
    expect(result.direction.sceneDirection).toBeUndefined();
    expect(result.prompt).not.toContain("4-second");
    expect(result.prompt).not.toContain("Lower vertically");
    expect(result.bindings).toHaveLength(1);
    expect(result.prompt).toContain(
      stage === "first_frame"
        ? "suspended above bottom bun"
        : "supported by bottom bun",
    );
  }
});

it("keeps legacy structured prompts and rejects an empty authored scene", () => {
  const p = plan();
  delete p.shots[0].sceneDirection;
  const direction = productionShotDirection(p, p.shots[0]);
  expect(direction).toHaveProperty("sceneDirection", undefined);
  const result = compilePrompt({
    mode: "reference_to_video",
    subject: "Patty",
    ...direction,
  });
  expect(result.prompt).toContain("Ordered action stages");
  expect(result.prompt).toContain("Required final state");
  expect(() =>
    compilePrompt({ ...result.direction, sceneDirection: " " }),
  ).toThrow();
});

it("retains process support and ending/audio instructions alongside authored prose", () => {
  const p = plan();
  p.editing = {
    version: 1,
    audio: {
      mode: "shared_track",
      assetId: "score",
      sourceSha256: "a".repeat(64),
      gain: 1,
      allowNativeAudio: false,
      ending: "resolve",
      endingReason: "Finish",
      beatPoints: [],
      syncPoints: [],
    },
    ending: {
      shotIds: ["place"],
      strategy: "product_brand",
      productVisible: true,
      brandText: "example",
      minHoldMs: 500,
      reason: "Hold",
    },
  };
  const result = compilePrompt({
    mode: "reference_to_video",
    subject: "Patty",
    ...productionShotDirection(p, p.shots[0]),
    process: {
      version: 1,
      stage: "video",
      objects: [
        { id: "bun", label: "Bottom bun" },
        { id: "patty", label: "Patty" },
      ],
      initialState: {
        bun: { presence: "visible" },
        patty: { presence: "visible", supportedBy: "bun" },
      },
      endState: {
        bun: { presence: "visible" },
        patty: { presence: "visible", supportedBy: "bun" },
      },
      operations: [],
      stateAnchor: { mode: "text_only", reason: "Fixture" },
    },
  });
  expect(result.prompt).toContain("supportedBy=bun");
  expect(result.prompt).toContain("Do not generate background music");
  expect(result.prompt).toContain("500 ms");
  expect(result.prompt).not.toContain("muted in editing");
  expect(result.prompt).not.toContain("example");
});

it("compacts repeated context without losing uncertainty, evidence identity or pagination", () => {
  const shot = (id: string, startMs: number) => ({
    id,
    startMs,
    endMs: startMs + 1000,
    description: "Product",
    framing: "Macro",
    action: "Lower",
    cameraMotion: "Static",
    transition: "cut",
    evidenceIds: ["e"],
    details: { startState: "Raised", endState: "Resting", actionStages: [] },
  });
  const report: any = {
    summary: "Two shots",
    shots: [shot("one", 0), shot("two", 1000)],
    narrativeBeats: [],
    events: [{ id: "event", startMs: 0, endMs: 500, description: "Lower" }],
    evidence: [
      {
        id: "e",
        startMs: 0,
        endMs: 500,
        observation: "Detailed proof",
        confidence: "high",
        modality: "visual",
      },
    ],
    unknowns: [
      { startMs: 0, endMs: 500, question: "Contact?", reason: "Occluded" },
    ],
    coverage: { startMs: 0, endMs: 2000, gaps: [{ startMs: 800, endMs: 900 }] },
    analysis: {
      parts: [
        {
          sourceStartMs: 0,
          sourceEndMs: 1000,
          summary: "Long duplicate summary",
          audio: { description: "Detailed audio" },
          analysisAssetId: "part",
        },
      ],
    },
  };
  const binding: any = { analysisAssetId: "analysis", analysisSha256: "hash" };
  const compact = referenceHandoff(report, binding, [], 0, 1);
  const full = referenceHandoff(report, binding, [], 0, 1, true, "full");
  expect(compact.shots).toEqual(full.shots);
  expect(compact.unknowns).toEqual(full.unknowns);
  expect(compact.coverage).toEqual(full.coverage);
  expect(compact.nextOffset).toBe(1);
  expect(compact.evidence[0]).toMatchObject({ id: "e", confidence: "high" });
  expect(compact.evidence[0]).not.toHaveProperty("observation");
  expect(full.evidence[0]).toHaveProperty("observation", "Detailed proof");
  expect(compact.sourceNeighbors[0].next).toMatchObject({
    id: "two",
    startState: "Raised",
  });
  expect(compact.sourceNeighbors[0].next).not.toHaveProperty("action");
  expect(full.sourceNeighbors[0].next).toHaveProperty("action", "Lower");
  expect(compact.detailsAccess).toMatchObject({
    analysisAssetId: "analysis",
    section: "handoff",
    handoffDetail: "full",
    offset: 0,
    limit: 1,
  });
  expect(referenceHandoff(report, binding, [], 0, 20, false).shots).toEqual([]);
});

it("asks Gemini to record changes without generic stages or repeated narrative", () => {
  const instructions = analysisDetailInstructions({
    kind: "reference_analyze",
    assetId: "video",
    model: "gemini",
    purpose: "remake",
    detail: "recreate",
    language: "en",
  });
  expect(instructions).toContain("Field ownership");
  expect(instructions).toContain("Do not pad");
  expect(instructions).toContain("Do not add unseen");
});
