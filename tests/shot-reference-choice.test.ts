import { expect, it } from "vitest";
import {
  productionPlanSchema,
  productionShotDirection,
  validateProductionPlan,
} from "../packages/core/src/production-plan.js";
import {
  assertShotReferenceChoice,
  shotReferenceCheck,
} from "../packages/core/src/shot-reference-choice.js";
import { compilePrompt } from "../packages/core/src/production-prompts.js";

function plan() {
  return productionPlanSchema.parse({
    title: "Stage selection",
    width: 720,
    height: 1280,
    shots: [
      {
        id: "sear",
        initialState: {
          patty: "one patty on griddle, bun separately beside it",
        },
        action: "Sear without moving to bun",
        endState: { patty: "one patty remains on griddle" },
      },
    ],
  });
}

it("surfaces missing per-shot choices without forcing legacy plans to create images", () => {
  const p = plan();
  const result = validateProductionPlan(p);
  expect(result.valid).toBe(true);
  expect(result.referenceChecks[0]).toMatchObject({
    status: "choose_before_generation",
    imageGenerationRequired: false,
  });
  expect(() =>
    assertShotReferenceChoice(p.shots[0], "text_to_video"),
  ).not.toThrow();
});

it("keeps direct shots and motion-reference shots on paths without generated images", () => {
  const shot = plan().shots[0];
  shot.referenceChoice = { strategy: "direct", reason: "Simple texture shot" };
  expect(() => assertShotReferenceChoice(shot, "text_to_video")).not.toThrow();
  expect(shotReferenceCheck(shot)).not.toHaveProperty("startingStateReview");
  shot.referenceChoice = {
    strategy: "motion_reference",
    reason: "Preserve camera move",
  };
  shot.references = [
    {
      assetId: "motion",
      role: "motion",
      transfer: "camera",
      instruction: "Camera path only",
    },
  ];
  expect(() =>
    assertShotReferenceChoice(shot, "reference_to_video"),
  ).not.toThrow();
  shot.references[0].usage = "analysis_only";
  expect(() =>
    assertShotReferenceChoice(shot, "reference_to_video"),
  ).toThrowError(
    expect.objectContaining({ code: "SHOT_REFERENCE_CHOICE_MISMATCH" }),
  );
});

it("requires a real first-frame binding and compatible mode only when state anchoring was chosen", () => {
  const shot = plan().shots[0];
  shot.referenceChoice = {
    strategy: "stage_first_frame",
    reason: "Avoid assembling before searing",
  };
  expect(validateProductionPlan({ ...plan(), shots: [shot] }).valid).toBe(true);
  expect(() => assertShotReferenceChoice(shot, "reference_to_video")).toThrow();
  shot.references = [
    {
      assetId: "existing-image",
      role: "first_frame",
      instruction: "Use this starting stage",
    },
  ];
  expect(() => assertShotReferenceChoice(shot, "image_to_video")).not.toThrow();
  expect(() => assertShotReferenceChoice(shot, "reference_to_video")).toThrow();
  expect(shotReferenceCheck(shot)).toMatchObject({
    firstFrameAssetIds: ["existing-image"],
    imageGenerationRequired: false,
    startingStateReview: { expectedState: shot.initialState },
  });
});

it("keeps route reasons and inspection instructions out of generated prompts", () => {
  const p = plan();
  const compile = () =>
    compilePrompt({
      mode: "text_to_video",
      subject: "Miniature burger scene",
      ...productionShotDirection(p, p.shots[0]),
    }).prompt;
  const before = compile();
  p.shots[0].referenceChoice = {
    strategy: "direct",
    reason: "HOST_ONLY_CHOICE",
  };
  expect(compile()).toBe(before);
  expect(compile()).not.toContain("HOST_ONLY_CHOICE");
  expect(() =>
    productionPlanSchema.parse({
      ...p,
      shots: [
        {
          ...p.shots[0],
          referenceChoice: { strategy: "direct", reason: "x".repeat(241) },
        },
      ],
    }),
  ).toThrow();
});
