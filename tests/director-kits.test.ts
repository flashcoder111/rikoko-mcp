import { describe, expect, it } from "vitest";
import {
  directorCatalog,
  directorKitSchema,
  assertDirectorAudio,
} from "../packages/core/src/director-kits.js";
import { compilePrompt } from "../packages/core/src/production-prompts.js";
import {
  productionPlanSchema,
  productionShotDirection,
} from "../packages/core/src/production-plan.js";

const direction = {
  mode: "text_to_video",
  subject: "An adult presenter holding the supplied blue bottle",
  initialState: { bottle: "held steadily beside the presenter" },
  action: "Show the bottle once, then keep it visible",
  endState: { bottle: "still held in the same hand" },
};

describe("director kits", () => {
  it("compiles every advertised recipe and requires explicitly enabled dialogue audio", () => {
    for (const kit of directorCatalog({}).kits) {
      for (const recipe of Object.keys(kit.recipes)) {
        const selection = {
          id: kit.id,
          version: kit.version,
          recipe,
          ...(kit.id === "talking-head-v1"
            ? { dialogue: "Approved words." }
            : {}),
        };
        const result = compilePrompt({
          ...direction,
          mode: kit.kind === "image" ? "text_to_image" : "text_to_video",
          directorKit: selection,
        });
        expect(result.prompt.length).toBeLessThan(5000);
        expect(result.direction.directorKit?.recipe).toBe(recipe);
      }
    }
    expect(() => assertDirectorAudio(undefined, {})).not.toThrow();
    expect(() =>
      assertDirectorAudio(
        { id: "ugc-demo-v1", version: 1, recipe: "daily-use" },
        {},
      ),
    ).not.toThrow();
    const speaker = {
      id: "talking-head-v1",
      version: 1,
      recipe: "friendly-explainer",
      dialogue: "Approved words.",
    };
    for (const value of [undefined, false, "true", 1])
      expect(() =>
        assertDirectorAudio(speaker, { generate_audio: value }),
      ).toThrow();
    expect(() =>
      assertDirectorAudio(speaker, { generate_audio: true }),
    ).not.toThrow();
  });
  it("discovers two ad formats and four candidate kits without claiming measured quality", () => {
    const catalog = directorCatalog({});
    expect(catalog.formats.map((f) => f.id)).toEqual([
      "ugc-ad",
      "talking-head-ad",
    ]);
    expect(catalog.kits).toHaveLength(4);
    expect(
      catalog.kits.every(
        (k) => k.validation === "candidate" && k.measuredTrials === 0,
      ),
    ).toBe(true);
    expect(directorCatalog({ kind: "image" }).kits).toHaveLength(1);
    expect(directorCatalog({ id: "product-broll-v1" }).kits).toHaveLength(1);
    expect(() => directorCatalog({ id: "missing" })).toThrow();
  });
  it("uses deterministic recipe wording and leaves the authored shot intact", () => {
    const compiled = compilePrompt({
      ...direction,
      directorKit: { id: "ugc-demo-v1", version: 1, recipe: "hands-on" },
    });
    expect(compiled.prompt).toContain(direction.action);
    expect(compiled.prompt).toContain("contact");
    expect(compiled.directorKit).toMatchObject({
      id: "ugc-demo-v1",
      version: 1,
      recipe: "hands-on",
      validation: "candidate",
    });
    expect(compiled.templateVersion).toBe("rikoko-director-ugc-demo-v1-r1");
    expect(compilePrompt(compiled.direction).prompt).toBe(compiled.prompt);
    expect(compiled.readyForSubmission).toBe(false);
  });
  it("rejects unsupported versions, recipes and unknown options instead of silently falling back", () => {
    for (const directorKit of [
      { id: "ugc-demo-v1", version: 2, recipe: "hands-on" },
      { id: "ugc-demo-v1", version: 1, recipe: "invented" },
      { id: "ugc-demo-v1", version: 1, recipe: "hands-on", camera: "invented" },
    ])
      expect(() => directorKitSchema.parse(directorKit)).toThrow();
  });
  it("does not allow image/video or silent/dialogue template mismatches", () => {
    expect(() =>
      compilePrompt({
        ...direction,
        directorKit: {
          id: "creator-image-v1",
          version: 1,
          recipe: "creator-room",
        },
      }),
    ).toThrow();
    expect(() =>
      compilePrompt({
        ...direction,
        mode: "text_to_image",
        directorKit: {
          id: "product-broll-v1",
          version: 1,
          recipe: "beauty-hold",
        },
      }),
    ).toThrow();
    expect(() =>
      directorKitSchema.parse({
        id: "product-broll-v1",
        version: 1,
        recipe: "beauty-hold",
        dialogue: "Buy now",
      }),
    ).toThrow();
    expect(() =>
      directorKitSchema.parse({
        id: "talking-head-v1",
        version: 1,
        recipe: "calm-expert",
        dialogue: " ",
      }),
    ).toThrow();
  });
  it("preserves literal spoken copy and keeps graphical CTA out of generated lettering", () => {
    const dialogue = "我每天带着它。Visit example.test — no discount claim.";
    const result = compilePrompt({
      ...direction,
      directorKit: {
        id: "talking-head-v1",
        version: 1,
        recipe: "calm-expert",
        dialogue,
      },
    });
    expect(result.prompt).toContain(dialogue);
    expect(result.prompt).toContain("Do not paint captions");
    expect(result.directorKit?.requirements).toContain("native-dialogue-audio");
  });
  it("keeps template selections separate for images and video in a saved plan", () => {
    const plan = productionPlanSchema.parse({
      title: "Ad",
      width: 720,
      height: 1280,
      shots: [
        {
          id: "show",
          ...direction,
          mode: undefined,
          subject: undefined,
          promptKits: {
            image: {
              id: "creator-image-v1",
              version: 1,
              recipe: "product-in-hand",
            },
            video: { id: "ugc-demo-v1", version: 1, recipe: "hands-on" },
          },
        },
      ].map(({ mode, subject, ...shot }) => shot),
    });
    expect(
      productionShotDirection(plan, plan.shots[0]!, "first_frame").directorKit
        ?.id,
    ).toBe("creator-image-v1");
    expect(
      productionShotDirection(plan, plan.shots[0]!, "last_frame").directorKit
        ?.id,
    ).toBe("creator-image-v1");
    expect(productionShotDirection(plan, plan.shots[0]!).directorKit?.id).toBe(
      "ugc-demo-v1",
    );
    expect(() =>
      productionPlanSchema.parse({
        ...plan,
        shots: [
          {
            ...plan.shots[0],
            promptKits: {
              image: { id: "ugc-demo-v1", version: 1, recipe: "hands-on" },
            },
          },
        ],
      }),
    ).toThrow();
  });
  it("preserves legacy prompt output and actual reference binding", () => {
    expect(compilePrompt(direction).templateVersion).toBe(
      "rikoko-direction-v2",
    );
    const result = compilePrompt({
      ...direction,
      mode: "image_to_video",
      references: [
        {
          assetId: "frame",
          role: "first_frame",
          instruction: "Use these exact pixels",
        },
      ],
      directorKit: {
        id: "product-broll-v1",
        version: 1,
        recipe: "beauty-hold",
      },
    });
    expect(result.bindings[0]?.assetId).toBe("frame");
    expect(result.prompt).toContain("Use these exact pixels");
    expect(() =>
      compilePrompt({
        ...direction,
        mode: "image_to_video",
        directorKit: { id: "ugc-demo-v1", version: 1, recipe: "hands-on" },
      }),
    ).toThrow();
  });
});
