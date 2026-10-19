import { expect, it, vi } from "vitest";
import { FalProvider, type Model } from "../packages/providers/src/index.js";
import { operationSchema } from "../packages/contracts/src/index.js";
import { resolveTiming } from "../packages/core/src/production-timing.js";
import { compilePrompt } from "../packages/core/src/production-prompts.js";
import { validateProductionPlan } from "../packages/core/src/production-plan.js";
import { checkGenerationTarget } from "../packages/providers/src/generation-target.js";
import { assessGenerationOutput } from "../packages/core/src/generation-output.js";

const model: Model = {
  id: "video",
  endpoint: "minimax/h3/text-to-video",
  kind: "video",
  maxCostCents: 100,
  priceVersion: "fixture",
  hardBoundConfirmed: true,
  parameters: { duration: 5, aspect_ratio: "16:9", resolution: "768P" },
  allowedParameters: {
    duration: { type: "integer", min: 4, max: 15 },
    aspect_ratio: { type: "enum", values: ["16:9", "9:16", "1:1"] },
  },
};
it("validates and actually sends declared shot parameters without allowing arbitrary provider fields", async () => {
  let sent: any;
  const fetcher = vi.fn(async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({
      request_id: "test",
      status_url: "https://queue.fal.run/status",
      response_url: "https://queue.fal.run/result",
      cancel_url: "https://queue.fal.run/cancel",
    });
  }) as typeof fetch;
  const provider = new FalProvider([model], "fixture", true, fetcher);
  const input = operationSchema.parse({
    kind: "generate",
    model: "video",
    prompt: "A complete action",
    parameters: { duration: 8, aspect_ratio: "9:16" },
  });
  await provider.submit(input);
  expect(sent).toMatchObject({
    duration: 8,
    aspect_ratio: "9:16",
    resolution: "768P",
  });
  expect(provider.describe()[0]).toMatchObject({
    allowedParameters: model.allowedParameters,
  });
  for (const parameters of [
    { duration: 16 },
    { duration: "8" },
    { aspect_ratio: "4:3" },
    { image_url: "https://example.com" },
  ])
    expect(() =>
      provider.validate(operationSchema.parse({ ...input, parameters })),
    ).toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("keeps the whole replacement by default and only fits or trims on explicit instruction", () => {
  expect(resolveTiming(5200, {})).toMatchObject({
    sourceStartMs: 0,
    durationMs: 5200,
    speed: 1,
    discardedTailMs: 0,
  });
  expect(
    resolveTiming(5200, { policy: "fit_target", durationMs: 3600 }),
  ).toMatchObject({ durationMs: 3600, speed: 5200 / 3600, discardedTailMs: 0 });
  expect(
    resolveTiming(5200, {
      policy: "selected_range",
      sourceStartMs: 200,
      durationMs: 3600,
    }),
  ).toMatchObject({ discardedTailMs: 1400 });
  expect(() =>
    resolveTiming(5200, {
      policy: "selected_range",
      sourceStartMs: 5000,
      durationMs: 1000,
    }),
  ).toThrow();
  expect(() =>
    resolveTiming(5200, { policy: "fit_target", durationMs: 100 }),
  ).toThrow();
});
it("compiles mode-specific prompts from actual input roles and explicit desired state", () => {
  const prompt = compilePrompt({
    mode: "reference_to_video",
    subject: "A blue device",
    action: "Close the lid",
    endState: "The lid is closed",
    references: [
      { assetId: "a", role: "product", instruction: "Keep logo and shape" },
    ],
  });
  expect(prompt.prompt).toContain("The lid is closed");
  expect(prompt.prompt).not.toContain("Animate the reviewed target image");
  expect(prompt.prompt).not.toContain("Source observation");
  expect(() =>
    compilePrompt({
      mode: "first_last_frame",
      subject: "Device",
      action: "Close",
      endState: "Closed",
      references: [{ assetId: "a", role: "first_frame", instruction: "Start" }],
    }),
  ).toThrow();
});
it("reports continuity conflicts without confusing intentional time jumps with errors", () => {
  const plan = {
    title: "Process",
    width: 720,
    height: 1280,
    shots: [
      {
        id: "one",
        initialState: { lid: "open" },
        action: "Close lid",
        endState: { lid: "closed" },
      },
      {
        id: "two",
        initialState: { lid: "open" },
        action: "Rotate device",
        endState: { lid: "open" },
      },
    ],
  };
  expect(validateProductionPlan(plan).issues).toContainEqual(
    expect.objectContaining({ code: "STATE_DISCONTINUITY", shotId: "two" }),
  );
  expect(
    validateProductionPlan({
      ...plan,
      shots: [
        plan.shots[0],
        {
          ...plan.shots[1],
          transition: "time_jump",
          transitionReason: "The device was reopened off screen",
        },
      ],
    }).issues,
  ).toHaveLength(0);
});
it("inherits first-frame aspect and refuses incompatible boundary images", () => {
  const input = {
    parameters: {},
    mode: "first_last_frame",
    references: [
      { role: "first_frame", assetId: "a" },
      { role: "last_frame", assetId: "b" },
    ],
    target: { width: 720, height: 1280, aspectPolicy: "match" as const },
  };
  const assets: any[] = [
    { id: "a", metadata: { width: 720, height: 1280 } },
    { id: "b", metadata: { width: 720, height: 1280 } },
  ];
  expect(checkGenerationTarget(model, input, assets)).toMatchObject({
    aspectSource: "first_frame",
    aspectRatio: 720 / 1280,
  });
  expect(() =>
    checkGenerationTarget(model, input, [
      assets[0],
      { ...assets[1], metadata: { width: 1280, height: 720 } },
    ]),
  ).toThrow("matching aspect");
  expect(() =>
    checkGenerationTarget(
      { parameters: {} },
      { parameters: {}, target: input.target },
    ),
  ).toThrow();
});
it("keeps technical output mismatches unreviewed and reports measured evidence", () => {
  const input = operationSchema.parse({
    kind: "generate",
    model: "video",
    prompt: "Test",
    parameters: { duration: 8, aspect_ratio: "9:16" },
    target: { width: 720, height: 1280, minDurationMs: 7000 },
  });
  const check = assessGenerationOutput(input, {
    kind: "video",
    width: 1344,
    height: 768,
    durationMs: 5200,
  });
  expect(check?.status).toBe("unreviewed");
  expect(check?.warnings.map((w) => w.code)).toEqual([
    "OUTPUT_DURATION_MISMATCH",
    "OUTPUT_ASPECT_MISMATCH",
    "OUTPUT_TOO_SHORT",
  ]);
});
it("warns on unrelated action references and requires motion responsibility", () => {
  const input = {
    mode: "motion_transfer",
    subject: "Device",
    action: "Close",
    actionType: "close",
    endState: "Closed",
    references: [
      {
        assetId: "a",
        role: "motion",
        instruction: "Hand movement",
        actionType: "pour",
        transfer: "action",
      },
    ],
  };
  expect(compilePrompt(input).warnings[0].code).toBe(
    "ACTION_REFERENCE_MISMATCH",
  );
  expect(() =>
    compilePrompt({
      ...input,
      references: [{ ...input.references[0], transfer: undefined }],
    }),
  ).toThrow();
  expect(() => compilePrompt({ ...input, mode: "text_to_video" })).toThrow();
});
