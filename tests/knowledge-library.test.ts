import { expect, it } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  guideAliases,
  guideCatalog,
  knowledgeSelectionSchema,
  selectKnowledge,
} from "../packages/guidance/src/catalog.js";
import {
  readGuide,
  validateGuideBundle,
  guidanceRoot,
} from "../packages/guidance/src/reader.js";
import { directorGuidance } from "../packages/core/src/director-guidance.js";
import { productionPlanSchema } from "../packages/core/src/production-plan.js";

it("keeps every legacy topic as an alias to a single canonical source", async () => {
  for (const [alias, topic] of Object.entries(guideAliases)) {
    const old = await readGuide({ topic: alias });
    const current = await readGuide({ topic });
    expect(old.topic).toBe(alias);
    expect(old.canonicalTopic).toBe(topic);
    expect(old.markdown).toBe(current.markdown);
    expect(old.sha256).toBe(current.sha256);
    expect(old.guideVersion).toBe(current.guideVersion);
  }
  await expect(validateGuideBundle()).resolves.toHaveProperty("catalogHash");
});

it("discovers three director layers separately from operational support", async () => {
  const index = await readGuide({ topic: "knowledge" });
  expect(index.library.layers).toEqual(["formats", "craft", "models"]);
  expect(index.library.entries).toEqual(guideCatalog);
  expect(index.navigationMarkdown).toContain("formats/ugc-ads");
  expect(index.navigationMarkdown).toContain("models/prompt-writing");
  expect(
    guideCatalog.find((g) => g.topic === "support/host-codex")?.layer,
  ).toBe("support");
});

it("routes an explicit format through craft and actual model context without inventing model expertise", () => {
  const route = selectKnowledge({
    format: "formats/ugc-ads",
    modelId: "seeapi/seedance-mini",
    mode: "reference_to_video",
  });
  expect(route.formats.map((g) => g.topic)).toEqual(["formats/ugc-ads"]);
  expect(route.craft.map((g) => g.topic)).toContain("craft/image-direction");
  expect(route.models.map((g) => g.topic)).toEqual(["models/prompt-writing"]);
  expect(route.modelCoverage).toBe("general_only");
  expect(route.models.every((g) => g.evidence.status !== "rikoko_tested")).toBe(
    true,
  );
  expect(selectKnowledge({}).models).toEqual([]);
});

it("matches future model entries by exact model ID and input mode", () => {
  const modelGuide = {
    ...guideCatalog.find((g) => g.topic === "models/prompt-writing")!,
    topic: "models/test-model",
    scope: { modelIds: ["provider/exact-model"], modes: ["image_to_video"] },
  };
  const entries = [...guideCatalog, modelGuide];
  expect(
    selectKnowledge(
      { modelId: "provider/exact-model", mode: "image_to_video" },
      [],
      entries,
    ).modelCoverage,
  ).toBe("specific");
  for (const selection of [
    { modelId: "provider/exact-model", mode: "text_to_video" },
    { modelId: "provider/exact-model-v2", mode: "image_to_video" },
    { modelId: "provider/exact-model" },
  ])
    expect(selectKnowledge(selection, [], entries).modelCoverage).toBe(
      "general_only",
    );
});

it("routes sourced product and presenter knowledge to registered Mini/H3 profiles only", async () => {
  for (const [modelId, mode, format, modelTopic, craftTopic] of [
    [
      "web-seeapi-seedance-mini-references",
      "reference_to_video",
      "formats/product-ads",
      "models/seedance-mini",
      "craft/product-staging",
    ],
    [
      "seedance-mini-first-last",
      "first_last_frame",
      "formats/product-ads",
      "models/seedance-mini",
      "craft/product-staging",
    ],
    [
      "minimax-h3-768p-5s-9x16",
      "text_to_video",
      "formats/talking-head-ads",
      "models/minimax-h3",
      "craft/presenter-performance",
    ],
    [
      "minimax-storyboard-references",
      "reference_to_video",
      "formats/talking-head-ads",
      "models/minimax-h3",
      "craft/presenter-performance",
    ],
  ] as const) {
    const guide = await readGuide({
      topic: modelTopic,
      selection: { modelId, mode, format },
    });
    expect(guide.readingPath?.modelCoverage).toBe("specific");
    expect(guide.readingPath?.models.map((g) => g.topic)).toContain(modelTopic);
    expect(guide.readingPath?.craft.map((g) => g.topic)).toContain(craftTopic);
    expect(guide.evidence.status).toBe("official_documentation");
    expect(guide.evidence.sources.length).toBeGreaterThan(0);
    for (const source of guide.evidence.sources)
      expect(guide.markdown).toContain(source.url);
    expect(guide.navigationMarkdown).toContain("Model coverage: specific");
  }
  for (const selection of [
    { modelId: "seedance-2-5-text", mode: "text_to_video" },
    { modelId: "minimax-hailuo-2-3-text", mode: "text_to_video" },
    { modelId: "web-seeapi-seedance-mini-text", mode: "video_edit" },
    { modelId: "minimax-h3-max-text" },
  ])
    expect(selectKnowledge(selection).modelCoverage).toBe("general_only");
});

it("accepts and recovers new product/craft selections in read-only stage guidance", async () => {
  const plan = productionPlanSchema.parse({
    title: "A solid product replaces a liquid",
    width: 720,
    height: 1280,
    knowledge: {
      format: "formats/product-ads",
      crafts: ["craft/product-staging"],
    },
    shots: [
      {
        id: "reveal",
        initialState: {},
        action: "Reveal surface",
        endState: {},
      },
    ],
  });
  const result = await directorGuidance("prepared", {
    plan,
    modelId: "web-seeapi-seedance-mini-image",
    mode: "image_to_video",
  });
  expect(result.readingPath.formats[0].topic).toBe("formats/product-ads");
  expect(result.readingPath.models.map((g) => g.topic)).toContain(
    "models/seedance-mini",
  );
  expect(
    result.readingPath.models.every(
      (g) => g.evidence.status !== "rikoko_tested",
    ),
  ).toBe(true);
});

it("persists format/craft choices and carries them into stage guidance", async () => {
  const plan = productionPlanSchema.parse({
    title: "Demo",
    width: 720,
    height: 1280,
    knowledge: { format: "formats/ugc-ads", crafts: ["craft/image-direction"] },
    shots: [{ id: "demo", initialState: {}, action: "Open", endState: {} }],
  });
  const result = await directorGuidance("prepared", {
    plan,
    modelId: "example/model",
    mode: "image_to_video",
  });
  expect(result.readingPath.formats[0].topic).toBe("formats/ugc-ads");
  expect(result.readingPath.modelCoverage).toBe("general_only");
  expect(result.content.every((g) => g.canonicalTopic && g.layer)).toBe(true);
  const other = await directorGuidance("prepared", {
    plan,
    modelId: "example/other",
    mode: "image_to_video",
  });
  expect(other.decisionKey).not.toBe(result.decisionKey);
});

it("rejects cross-layer selections and arbitrary file paths", async () => {
  expect(
    knowledgeSelectionSchema.safeParse({ format: "craft/image-direction" })
      .success,
  ).toBe(false);
  await expect(readGuide({ topic: "../secret" })).rejects.toThrow();
  expect(
    productionPlanSchema.safeParse({
      title: "Demo",
      width: 720,
      height: 1280,
      knowledge: { modelId: "invented" },
      shots: [],
    }).success,
  ).toBe(false);
});

it("rejects changed catalog identity and paths even when content hashes remain intact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "knowledge-manifest-"));
  try {
    await cp(guidanceRoot, dir, { recursive: true });
    const path = join(dir, "manifest.json");
    const original = JSON.parse(await readFile(path, "utf8"));
    for (const change of [
      { catalogHash: "0".repeat(64) },
      { files: { ...original.files, overview: "../secret.md" } },
    ]) {
      await writeFile(path, JSON.stringify({ ...original, ...change }));
      await expect(validateGuideBundle(dir)).rejects.toThrow(
        "Invalid guide manifest",
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
