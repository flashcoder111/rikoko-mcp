import { attachFixtureAnalysis } from "./video-workflow-fixture.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider, type Model } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import {
  assertMethodMode,
  methodKind,
  sourceEditComposition,
} from "../packages/core/src/production-method.js";
import { productionPlanSchema } from "../packages/core/src/production-plan.js";

let db: Database,
  service: Service,
  c: Awaited<ReturnType<Service["authenticate"]>>,
  dir: string;
const network = vi.fn();
const editModel: Model = {
  id: "fixture-edit",
  endpoint: "fixture/edit",
  kind: "video",
  parameters: {},
  maxCostCents: 1,
  priceVersion: "fixture",
  hardBoundConfirmed: true,
  generationInput: {
    mode: "video_to_video",
    outputDurationSource: "source_video",
    maxTotalBytes: 10_000_000,
    bindings: [
      {
        roles: ["character", "product"],
        kind: "image",
        field: "images",
        array: true,
        min: 0,
        max: 2,
        maxBytes: 1_000_000,
      },
      {
        roles: ["source_video"],
        kind: "video",
        field: "video",
        array: false,
        min: 1,
        max: 1,
        maxBytes: 9_000_000,
        maxDurationMs: 30000,
      },
    ],
  },
};
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "method-selection-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider([editModel], "fixture", true, network),
  );
  c = await service.authenticate(
    (await service.createAccount("Method flow", 100)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
async function source(durationMs = 17042) {
  return service.registerAsset(
    c.accountId,
    Buffer.from(`source-${durationMs}`),
    {
      kind: "video",
      name: "source.mp4",
      mime: "video/mp4",
      metadata: { width: 854, height: 480, durationMs, container: "mp4" },
      provenance: { evidence: "synthetic" },
    },
  );
}
it("carries source editing from method choice to prepared request and native-speed composition", async () => {
  const original = await source();
  const resolved = await callTool(service, c, "production_method_resolve", {
    intent: {
      relationship: "edit_source",
      change: "Replace the foreground person only",
    },
    sourceAssetId: original.id,
  });
  expect(resolved.status).toBe("candidate_available");
  expect(resolved.plan).toMatchObject({
    width: 854,
    height: 480,
    shots: [{ durationMs: 17042 }],
  });
  const request = await callTool(service, c, "workspace_request_save", {
    message:
      "Only replace the foreground person, retain original movement and composition",
    assetIds: [original.id],
  });
  await attachFixtureAnalysis(service, c, resolved.plan, original);
  resolved.plan.treatment = {
    intent: "Show the same reveal with the target identity",
    referenceInterpretation:
      "Opening before the reaction makes the change understandable",
    approach: "Retain the original action and eyeline",
    successCriteria: ["The target looks left toward the revealed object"],
  };
  resolved.plan.shots[0].sourceShotDirections = [
    {
      sourceShotId: "source-open",
      direction: "Use the target identity throughout",
      referenceAssetIds: [],
      relations: [
        {
          sourceField: "startState",
          disposition: "preserve",
          target: "Target identity faces screen left",
          reason: "Preserve the intended partner eyeline",
        },
        {
          sourceField: "endState",
          disposition: "unknown",
          reason: "Keep the fixture uncertainty visible",
        },
        {
          sourceField: "spatialRelations",
          disposition: "unknown",
          reason: "Target spatial relation is not observed",
        },
      ],
    },
  ];
  const saved = await callTool(service, c, "production_plan_save", {
    plan: resolved.plan,
    request: {
      requestId: request.requestId,
      expectedVersion: request.requestVersion,
    },
  });
  const draft = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "source-edit",
    subject: "Foreground person",
    mode: resolved.promptMode,
    model: editModel.id,
  });
  expect(draft.video.prompt).toContain(
    "entire performance and camera sequence",
  );
  expect(draft.video.prompt).toContain("Target identity faces screen left");
  expect(draft.hostInstructions.treatment).toEqual(resolved.plan.treatment);
  expect(draft.hostInstructions.sourceRelations[0].unresolved).toEqual([
    "endState",
    "spatialRelations",
  ]);
  const resumed = await callTool(service, c, "workspace_snapshot", {
    projectId: saved.productionProjectId,
  });
  expect(resumed.productionPlan.plan.treatment).toEqual(
    resolved.plan.treatment,
  );
  expect(resumed.guidance.treatment).toEqual(resolved.plan.treatment);
  expect(resumed.guidance.suggestions[0].tool).toBe("production_shot_prompts");
  const prepared = await callTool(service, c, "generation_prepare", {
    input: {
      kind: "generate",
      model: editModel.id,
      mode: "video_to_video",
      videoPolicy: {
        faces: "absent",
        reason: "Synthetic contract fixture",
        references: [
          {
            assetId: original.id,
            sha256: original.sha256,
            faces: "absent",
            reason: "Synthetic fixture",
          },
        ],
      },
      prompt: draft.video.prompt,
      references: draft.video.bindings.map(
        ({ assetId, role }: { assetId: string; role: string }) => ({
          assetId,
          role,
        }),
      ),
      parameters: {},
    },
    direction: draft.video.direction,
    plan: {
      planId: saved.id,
      expectedVersion: 1,
      shotId: "source-edit",
      stage: "video",
    },
  });
  expect(prepared.readyForSubmission).toBe(true);
  expect(prepared.providerRequest.prompt).toContain(
    "Target identity faces screen left",
  );
  expect(prepared.plan.directorIntent.treatment).toEqual(
    resolved.plan.treatment,
  );
  expect(prepared.plan.guideVersion).toBe(saved.guideVersion);
  expect(prepared.guideVersion).toBe(saved.guideVersion);
  expect(prepared.guidance.treatment).toEqual(resolved.plan.treatment);
  expect(prepared.expectedOutput.durationMs).toBe(17042);
  const assembled = await callTool(service, c, "production_editing_preview", {
    planId: saved.id,
    expectedVersion: 1,
    assetId: original.id,
  });
  expect(assembled.composition).toMatchObject({
    width: 854,
    height: 480,
    scenes: [{ speed: 1, durationMs: 17042 }],
  });
  expect(network).not.toHaveBeenCalled();
});
it("reports an input-duration capability gap without splitting or choosing reference generation", async () => {
  const original = await source(40000);
  const result = await callTool(service, c, "production_method_resolve", {
    intent: { relationship: "edit_source", change: "Replace the person" },
    sourceAssetId: original.id,
  });
  expect(result.status).toBe("capability_gap");
  expect(result.candidates).toEqual([]);
  expect(result.method.kind).toBe("source_edit");
  expect(result.plan.shots).toHaveLength(1);
});
it("preserves combined properties instead of treating them as camera-only or action-only", () => {
  expect(
    methodKind({
      relationship: "transfer_properties",
      change: "New character",
      preserve: ["action", "camera"],
    }),
  ).toBe("reference_transfer");
  expect(
    methodKind({
      relationship: "reinterpret",
      change: "New story",
      preserve: [],
    }),
  ).toBe("adaptation");
});
it("checks the actual two-subject input capacity before recommending an edit profile", async () => {
  const original = await source();
  const images = await Promise.all(
    ["fugitive", "pursuer", "third"].map((name) =>
      service.registerAsset(c.accountId, Buffer.from(name), {
        kind: "image",
        name: `${name}.png`,
        mime: "image/png",
        metadata: { width: 320, height: 480 },
        provenance: { evidence: "synthetic" },
      }),
    ),
  );
  const input = {
    intent: {
      relationship: "edit_source",
      change: "Replace fugitive and pursuer, keep their positions",
    },
    sourceAssetId: original.id,
    subjects: images
      .slice(0, 2)
      .map((a) => ({ assetId: a.id, instruction: a.name })),
  };
  const resolved = await callTool(
    service,
    c,
    "production_method_resolve",
    input,
  );
  expect(resolved.status).toBe("candidate_available");
  expect(resolved.references.map((r: { role: string }) => r.role)).toEqual([
    "character",
    "character",
    "source_video",
  ]);
  const tooMany = await callTool(service, c, "production_method_resolve", {
    ...input,
    subjects: images.map((a) => ({ assetId: a.id, instruction: a.name })),
  });
  expect(tooMany.status).toBe("capability_gap");
  expect(network).not.toHaveBeenCalled();
});
it("keeps the selected method through preparation and refuses retiming short outputs", async () => {
  const original = await source();
  const resolved = await callTool(service, c, "production_method_resolve", {
    intent: { relationship: "edit_source", change: "Replace appearance" },
    sourceAssetId: original.id,
  });
  const plan = productionPlanSchema.parse(resolved.plan);
  expect(() => assertMethodMode(plan, "camera_transfer")).toThrow();
  expect(() => assertMethodMode(plan, "reference_to_video")).toThrow();
  expect(() =>
    sourceEditComposition(plan, {
      ...original,
      metadata: { ...original.metadata, durationMs: 4000 },
    }),
  ).toThrow();
});

it("keeps full preservation intent while selecting MiniMax joint references and explicit consecutive source excerpts", async () => {
  const original = await source(17042);
  const a = await source(4958),
    b = await source(12084);
  const model: Model = {
    ...editModel,
    id: "minimax-reference",
    generationInput: {
      ...editModel.generationInput!,
      mode: "reference_to_video",
      outputDurationSource: undefined,
      outputDurationMs: 5000,
      bindings: [
        {
          roles: ["character"],
          kind: "image",
          field: "reference_image_urls",
          array: true,
          min: 0,
          max: 2,
          maxBytes: 1000000,
        },
        {
          roles: ["motion"],
          kind: "video",
          field: "reference_video_urls",
          array: true,
          min: 1,
          max: 1,
          maxBytes: 9000000,
          minDurationMs: 2000,
          maxDurationMs: 15000,
        },
      ],
    },
  };
  const provider = new FalProvider([model], "fixture", true, network);
  const { resolveProductionMethod, methodPlanIssues, assertMethodSegment } =
    await import("../packages/core/src/production-method.js");
  const resolved = resolveProductionMethod(
    {
      model: model.id,
      intent: {
        relationship: "edit_source",
        change: "Swap both identities only",
      },
      sourceAssetId: original.id,
      sourceSegments: [
        { assetId: a.id, sourceStartMs: 0 },
        { assetId: b.id, sourceStartMs: 4958 },
      ],
    },
    original,
    [],
    provider.describe(),
    [a, b],
  );
  expect(resolved.status).toBe("candidate_available");
  expect(resolved.promptMode).toBe("reference_to_video");
  const plan = productionPlanSchema.parse(resolved.plan);
  expect(plan.method?.preserve).toEqual([
    "action",
    "camera",
    "timing",
    "framing",
  ]);
  expect(methodPlanIssues(plan)).toEqual([]);
  expect(
    plan.shots.map(
      (s) =>
        s.references.find(
          (r) => r.role === "motion" && r.usage !== "analysis_only",
        )?.assetId,
    ),
  ).toEqual([a.id, b.id]);
  expect(() => assertMethodMode(plan, "reference_to_video")).not.toThrow();
  expect(() => assertMethodSegment(plan, plan.shots[0].id, [b])).toThrow(
    /excerpt/,
  );
  const assembly = sourceEditComposition(plan, [a, b]);
  expect(assembly.scenes.map((s) => s.speed)).toEqual([1, 1]);
  expect(assembly.width).toBe(854);
  expect(assembly.scenes.reduce((n, s) => n + s.durationMs, 0)).toBe(17042);
  expect(() =>
    resolveProductionMethod(
      {
        intent: { relationship: "edit_source", change: "Swap" },
        sourceAssetId: original.id,
        sourceSegments: [
          { assetId: a.id, sourceStartMs: 0 },
          { assetId: b.id, sourceStartMs: 4000 },
        ],
      },
      original,
      [],
      provider.describe(),
      [a, b],
    ),
  ).toThrow(/gaps/);
  expect(() =>
    resolveProductionMethod(
      {
        intent: { relationship: "edit_source", change: "Swap" },
        sourceAssetId: original.id,
        sourceSegments: [
          { assetId: a.id, sourceStartMs: 0 },
          { assetId: b.id, sourceStartMs: 4958 },
        ],
      },
      original,
      [],
      provider.describe(),
      [a, { ...b, metadata: { ...b.metadata, width: 360, height: 640 } }],
    ),
  ).toThrow(/canvas/);
  plan.shots[0].sceneDirection += " Preserve the original cut at 2.5 seconds.";
  const miniService = new Service(db, new LocalStorage(dir), provider);
  const request = await callTool(miniService, c, "workspace_request_save", {
    message: "Swap both identities, preserve original timing",
    assetIds: [original.id],
  });
  await attachFixtureAnalysis(miniService, c, plan, original);
  for (const [clip, startMs] of [
    [a, 0],
    [b, 4958],
  ] as const)
    await miniService.scoped(c, "write", (tx) =>
      tx.put({
        id: "source-excerpt-" + clip.id,
        type: "source-excerpt",
        accountId: c.accountId,
        createdAt: new Date().toISOString(),
        assetId: clip.id,
        sha256: clip.sha256,
        sourceAssetId: original.id,
        sourceSha256: original.sha256,
        startMs,
        endMs: startMs + clip.metadata.durationMs,
      }),
    );
  const saved = await callTool(miniService, c, "production_plan_save", {
    plan,
    request: {
      requestId: request.requestId,
      expectedVersion: request.requestVersion,
    },
  });
  const draft = await callTool(miniService, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: plan.shots[0].id,
    subject: "Source identities",
    mode: "reference_to_video",
    model: model.id,
  });
  expect(draft.video.prompt).toContain("original cut at 2.5 seconds");
  const preparation = await callTool(miniService, c, "generation_prepare", {
    input: {
      kind: "generate",
      model: model.id,
      mode: "reference_to_video",
      videoPolicy: {
        faces: "present",
        reason: "Identity replacement",
        userChoice: { model: model.id, confirmed: true },
        references: [
          {
            assetId: a.id,
            sha256: a.sha256,
            faces: "present",
            reason: "Synthetic person fixture",
          },
        ],
      },
      prompt: draft.video.prompt,
      parameters: {},
      references: draft.video.bindings.map((r: any) => ({
        assetId: r.assetId,
        role: r.role,
      })),
      target: { width: 854, height: 480, aspectPolicy: "contain" },
    },
    direction: draft.video.direction,
    plan: {
      planId: saved.id,
      expectedVersion: 1,
      shotId: plan.shots[0].id,
      stage: "video",
    },
  });
  expect(preparation.readyForSubmission).toBe(true);
  expect(preparation.input.references).toEqual([
    { assetId: a.id, role: "motion" },
  ]);
  expect(network).not.toHaveBeenCalled();
});

it("accepts exact MiniMax fractional durations and declared output controls without changing reference payloads", async () => {
  const { resolveGenerationParameters, generationDurationMs } =
    await import("../packages/providers/src/generation-parameters.js");
  const { minimaxReferenceControls } =
    await import("../packages/providers/src/h3.js");
  const model = {
    parameters: {
      duration: 5,
      resolution: "768P",
      prompt_expansion_mode: "disabled",
    },
    allowedParameters: minimaxReferenceControls,
  };
  const overrides = {
    duration: 4.958,
    resolution: "480P",
    aspect_ratio: "16:9",
  };
  expect(generationDurationMs(model, overrides)).toBe(4958);
  expect(resolveGenerationParameters(model, overrides)).toMatchObject({
    ...overrides,
    prompt_expansion_mode: "disabled",
  });
  expect(() => resolveGenerationParameters(model, { duration: NaN })).toThrow();
  expect(() =>
    resolveGenerationParameters(model, { reference_video_urls: [] }),
  ).toThrow();
});
