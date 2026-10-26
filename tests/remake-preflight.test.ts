import { expect, it } from "vitest";
import { operationSchema } from "../packages/contracts/src/index.js";
import { compilePrompt } from "../packages/core/src/production-prompts.js";
import {
  productionPlanSchema,
  productionShotDirection,
  validateProductionPlan,
} from "../packages/core/src/production-plan.js";

function fixture() {
  return {
    title: "Remake a product demonstration",
    width: 720,
    height: 1280,
    method: {
      relationship: "edit_source",
      change: "Replace the blue bottle with the supplied green bottle",
      kind: "source_edit",
      preserve: ["action", "camera", "timing", "framing"],
      executionMode: "reference_to_video",
      source: {
        assetId: "original",
        sha256: "a".repeat(64),
        width: 720,
        height: 1280,
        durationMs: 12000,
      },
      segments: [
        {
          shotId: "part-1",
          assetId: "excerpt",
          sha256: "b".repeat(64),
          sourceStartMs: 0,
          durationMs: 12000,
        },
      ],
    },
    shots: [
      {
        id: "part-1",
        durationMs: 12000,
        sourceShotIds: ["wide", "close"],
        initialState: { bottle: "on table" },
        endState: { bottle: "held" },
        action: "Lift bottle",
        actionStages: ["Lift without changing the hand position"],
        camera: "Static",
        sourceShotDirections: [
          {
            sourceShotId: "wide",
            direction: "Show one green bottle on the table",
            referenceAssetIds: ["product"],
          },
          {
            sourceShotId: "close",
            direction: "Close-up of the same green bottle held by the hand",
            referenceAssetIds: ["product"],
          },
        ],
        references: [
          {
            assetId: "product",
            role: "product",
            instruction: "Replacement bottle appearance only",
          },
          {
            assetId: "excerpt",
            role: "motion",
            transfer: "action",
            instruction: "Original action and timing",
          },
        ],
      },
    ],
  };
}
it("retains detailed timelines above the former 5000-character transport limit", () => {
  const result = compilePrompt({
    mode: "text_to_video",
    subject: "Scene",
    sceneDirection: "Detailed scene. ".repeat(400),
    action: "Hold",
    initialState: {},
    endState: {},
    references: [],
  });
  expect(result.prompt.length).toBeGreaterThan(5000);
  expect(
    operationSchema.parse({
      kind: "generate",
      model: "reference-model",
      prompt: result.prompt,
    }),
  ).toMatchObject({ prompt: result.prompt });
});
const report = {
  source: { assetId: "original", sha256: "a".repeat(64) },
  shots: [
    {
      id: "wide",
      startMs: 0,
      endMs: 4000,
      framing: "Wide shot",
      action: "Hand reaches for bottle",
      cameraMotion: "Static",
    },
    {
      id: "close",
      startMs: 4000,
      endMs: 12000,
      framing: "Close-up",
      action: "Hand lifts bottle",
      cameraMotion: "Push in",
    },
  ],
};
it("compiles source-relative shot times and target assignments through the source_edit branch", () => {
  const plan = productionPlanSchema.parse(fixture());
  const direction = productionShotDirection(
    plan,
    plan.shots[0],
    "video",
    report as any,
  );
  expect(direction.sceneDirection).toContain("0.000–4.000s");
  expect(direction.sceneDirection).toContain("4.000–12.000s");
  expect(direction.sceneDirection).toContain(
    "Show one green bottle on the table",
  );
  expect(direction.sceneDirection).toContain(
    "Lift without changing the hand position",
  );
  expect(direction.sceneDirection).toContain("Hand lifts bottle");
  expect(direction.sceneDirection).toContain(
    "Image 1 (product): Replacement bottle appearance only",
  );
});
it("rebases overlapping source shots to the current excerpt", () => {
  const raw = fixture();
  raw.method.segments[0].sourceStartMs = 2000;
  raw.method.segments[0].durationMs = 10000;
  raw.shots[0].durationMs = 10000;
  const plan = productionPlanSchema.parse(raw);
  const result = productionShotDirection(
    plan,
    plan.shots[0],
    "video",
    report as any,
  );
  expect(result.sceneDirection).toContain("0.000–2.000s");
  expect(result.sceneDirection).toContain("2.000–10.000s");
  expect(() => productionShotDirection(plan, plan.shots[0])).toThrow();
  plan.shots[0].sourceShotDirections!.pop();
  expect(() =>
    productionShotDirection(plan, plan.shots[0], "video", report as any),
  ).toThrow();
});
it("rejects missing or foreign per-source directions instead of silently dropping them", () => {
  const raw = fixture();
  raw.shots[0].sourceShotDirections[0].referenceAssetIds = ["unrelated"];
  const result = validateProductionPlan(raw);
  expect(
    result.issues.some((x) => x.code === "SOURCE_SHOT_DIRECTION_INVALID"),
  ).toBe(true);
});
it("does not attach timeline observations from a different source", () => {
  const plan = productionPlanSchema.parse(fixture());
  expect(() =>
    productionShotDirection(plan, plan.shots[0], "video", {
      ...report,
      source: { ...report.source, sha256: "f".repeat(64) },
    } as any),
  ).toThrow();
});
