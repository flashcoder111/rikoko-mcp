import { expect, it } from "vitest";
import {
  assertEditorialSeparation,
  productionPlanSchema,
  productionShotDirection,
} from "../packages/core/src/production-plan.js";
import { compilePrompt } from "../packages/core/src/production-prompts.js";

function fixture() {
  return productionPlanSchema.parse({
    title: "Burger promo",
    width: 720,
    height: 1280,
    editing: {
      version: 1,
      ending: {
        shotIds: ["hero"],
        strategy: "product_brand",
        productVisible: true,
        brandText: "rikoko",
        cta: "Tiny crew. Big flavor.",
        minHoldMs: 2500,
        reason: "Show rikoko and Tiny crew. Big flavor.",
      },
    },
    shots: [
      {
        id: "hero",
        purpose: "Sell rikoko",
        initialState: { burger: "closed" },
        action: "Hold the closed burger unchanged",
        endState: { burger: "closed" },
        durationMs: 3000,
        camera: "Slow macro push",
        acceptanceCriteria: [
          "rikoko is readable for 2500ms",
          "Listen to the final soundtrack",
        ],
        generationConstraints: ["No new ingredients or handling tools enter"],
      },
    ],
  });
}
it("keeps brand copy and acceptance criteria in the plan but out of the generated footage prompt", () => {
  const plan = fixture(),
    before = structuredClone(plan);
  const direction = productionShotDirection(plan, plan.shots[0]);
  const { prompt } = compilePrompt({
    mode: "text_to_video",
    subject: "One completed burger",
    ...direction,
  });
  for (const copy of [
    "rikoko",
    "Tiny crew",
    "Acceptance",
    "Listen to the final soundtrack",
  ])
    expect(prompt).not.toContain(copy);
  expect(prompt).toContain("No new ingredients or handling tools enter");
  expect(prompt).toContain("generate no lettering");
  expect(plan).toEqual(before);
  expect(() => assertEditorialSeparation(plan, "hero", prompt)).not.toThrow();
});
it("rejects the incident's mixed shot action instead of silently stripping text or changing user intent", () => {
  const plan = fixture();
  plan.shots[0].action =
    "Hold the burger; leave space for editorial rikoko overlays; no generated text";
  const { prompt } = compilePrompt({
    mode: "text_to_video",
    subject: "Burger",
    ...productionShotDirection(plan, plan.shots[0]),
  });
  expect(() => assertEditorialSeparation(plan, "hero", prompt)).toThrow(
    expect.objectContaining({ code: "EDITORIAL_COPY_IN_GENERATION" }),
  );
  expect(() =>
    assertEditorialSeparation(plan, "hero", "Show TINY CREW. BIG FLAVOR."),
  ).toThrow();
});
it("honors explicit generation constraints without optional remake or review prose", () => {
  const plan = fixture();
  delete plan.shots[0].purpose;
  delete plan.shots[0].acceptanceCriteria;
  expect(productionShotDirection(plan, plan.shots[0]).constraints).toContain(
    "No new ingredients or handling tools enter",
  );
});
