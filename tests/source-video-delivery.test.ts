import { faceFreeFixturePolicy } from "./video-policy-fixture.js";
import { expect, it, vi } from "vitest";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider, type Model } from "../packages/providers/src/index.js";
import { compilePrompt } from "../packages/core/src/production-prompts.js";
import { validateProductionPlan } from "../packages/core/src/production-plan.js";
import { bindProductionRequest } from "../packages/core/src/production-request.js";
import { referenceDelivery } from "../packages/core/src/reference-delivery.js";
import {
  prepareCloudGeneration,
  bindCloudPreparation,
  referenceDeclaration,
  cloudPreparationProtocol,
} from "../packages/core/src/cloud-preparation.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const motion = {
  assetId: "source-clip",
  role: "motion",
  transfer: "action",
  instruction:
    "Tiny workers lower the food; transfer choreography, not the hot dog",
};
const plan = (sourceVideo?: unknown, references: unknown[] = [motion]) => ({
  title: "Construction",
  width: 432,
  height: 768,
  shots: [
    {
      id: "lift",
      initialState: {},
      action: "Lower and release the patty",
      endState: { patty: "resting on bun" },
      sourceVideo,
      references,
    },
  ],
});
it("rejects claiming a source video is supplied when it is absent or analysis-only", () => {
  for (const refs of [[], [{ ...motion, usage: "analysis_only" }]]) {
    expect(
      validateProductionPlan(
        plan({ strategy: "reference", assetId: motion.assetId }, refs),
      ).issues,
    ).toContainEqual(
      expect.objectContaining({ code: "SOURCE_VIDEO_STRATEGY_MISMATCH" }),
    );
  }
  expect(
    validateProductionPlan(
      plan({ strategy: "reference", assetId: motion.assetId }),
    ).valid,
  ).toBe(true);
  expect(
    validateProductionPlan(
      plan(
        { strategy: "reconstruct", reason: "Exact boundary control needed" },
        [],
      ),
    ).valid,
  ).toBe(true);
  expect(
    validateProductionPlan(
      plan({ strategy: "reconstruct", reason: "Boundary control" }),
    ).valid,
  ).toBe(false);
});
it("requires a decision for current request-bound source shots, while legacy plans remain valid", async () => {
  const parsed = validateProductionPlan(plan()).plan;
  parsed.shots[0].sourceShotIds = ["original-shot"];
  const tx: any = {
    get: async (id: string) =>
      id === "request"
        ? { version: 1, assetIds: [motion.assetId] }
        : { kind: "video", sha256: "a".repeat(64) },
  };
  const binding = {
    requestId: "request",
    expectedVersion: 1,
    excludedAssets: [],
  };
  await expect(
    bindProductionRequest(tx, "owner", parsed, binding),
  ).rejects.toMatchObject({ code: "SOURCE_VIDEO_DECISION_REQUIRED" });
  parsed.shots[0].sourceVideo = {
    strategy: "reference",
    assetId: motion.assetId,
  };
  await expect(
    bindProductionRequest(tx, "owner", parsed, binding),
  ).resolves.toHaveProperty("assets");
  expect(validateProductionPlan(plan(undefined, [])).valid).toBe(true);
});
it("keeps both product bytes and source clip through cloud declaration, binding and the actual provider HTTP payload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "source-video-delivery-"));
  const db = await Database.open();
  const requests: any[] = [];
  const network = vi.fn(async (_url: any, init: any) => {
    requests.push(JSON.parse(init.body));
    return Response.json({
      request_id: "fixture",
      status_url: "https://queue.fal.run/fixture/status",
      response_url: "https://queue.fal.run/fixture/result",
      cancel_url: "https://queue.fal.run/fixture/cancel",
    });
  });
  const model: Model = {
    id: "reference-video",
    endpoint: "minimax/h3-max/reference-to-video",
    kind: "video",
    maxCostCents: 200,
    priceVersion: "fixture",
    hardBoundConfirmed: true,
    parameters: { duration: 4, resolution: "768P", aspect_ratio: "9:16" },
    generationInput: {
      mode: "reference_to_video",
      outputDurationMs: 4000,
      maxTotalBytes: 20000,
      bindings: [
        {
          field: "image_urls",
          roles: ["product"],
          kind: "image",
          array: true,
          min: 1,
          max: 1,
          maxBytes: 10000,
        },
        {
          field: "video_urls",
          roles: ["motion"],
          kind: "video",
          array: true,
          min: 1,
          max: 1,
          maxBytes: 10000,
        },
      ],
    },
  };
  const provider = new FalProvider([model], "fixture", true, network);
  const service = new Service(db, new LocalStorage(dir), provider);
  try {
    const c = await service.authenticate(
      (await service.createAccount("fixture", 1000)).key,
    );
    const bytes = [
      Buffer.from("synthetic product"),
      Buffer.from("synthetic source motion"),
    ];
    const assets = await Promise.all(
      bytes.map((b, i) =>
        service.registerAsset(c.accountId, b, {
          name: i ? "clip.mp4" : "product.png",
          kind: i ? "video" : "image",
          mime: i ? "video/mp4" : "image/png",
          metadata: {
            width: 432,
            height: 768,
            ...(i ? { durationMs: 3700 } : {}),
          },
          provenance: { evidence: "test-fixture" },
        }),
      ),
    );
    const direction = {
      mode: "reference_to_video",
      subject: "Burger",
      action: "Lower patty",
      endState: "Patty rests on bun",
      references: [
        {
          assetId: "host-product",
          role: "product",
          instruction: "Appearance only",
        },
        { ...motion, assetId: "host-video" },
      ],
    };
    const compiled = compilePrompt(direction);
    const draft = await prepareCloudGeneration(service, c, {
      protocol: cloudPreparationProtocol,
      request: {
        input: {
          kind: "generate",
          mode: "reference_to_video",
          model: model.id,
          target: { width: 432, height: 768 },
          prompt: compiled.prompt,
          videoPolicy: faceFreeFixturePolicy(
            assets.map((a, i) => ({
              ...a,
              id: direction.references[i].assetId,
            })),
          ),
          references: compiled.bindings.map(({ assetId, role }) => ({
            assetId,
            role,
          })),
        },
        direction: compiled.direction,
      },
      references: assets.map((asset, i) => ({
        ...referenceDeclaration(asset),
        id: direction.references[i].assetId,
      })),
    });
    expect(
      draft.input.videoPolicy!.references.map((r: any) => r.assetId),
    ).toEqual(["host-product", "host-video"]);
    const wrong = await service.registerAsset(
      c.accountId,
      Buffer.from("other clip"),
      {
        name: "wrong.mp4",
        kind: "video",
        mime: "video/mp4",
        metadata: assets[1].metadata,
        provenance: {},
      },
    );
    const mappings = assets.map((asset, i) => ({
      sourceAssetId: direction.references[i].assetId,
      assetId: asset.id,
    }));
    await expect(
      bindCloudPreparation(service, c, draft.id, {
        requestHash: draft.requestHash,
        references: [mappings[0], { ...mappings[1], assetId: wrong.id }],
      }),
    ).rejects.toMatchObject({ code: "PREPARED_REFERENCE_CHANGED" });
    const bound = await bindCloudPreparation(service, c, draft.id, {
      requestHash: draft.requestHash,
      references: mappings,
    });
    const manifest = referenceDelivery(bound);
    expect(manifest).toMatchObject({
      stage: "prepared_not_submitted",
      videoReferenceCount: 1,
    });
    expect(manifest.references[1]).toMatchObject({
      assetId: assets[1].id,
      sha256: assets[1].sha256,
      durationMs: 3700,
      field: "video_urls",
      index: 0,
    });
    expect(network).not.toHaveBeenCalled();
    await provider.submit(
      bound.input,
      undefined,
      bound.input.references.map((ref: any, i: number) => ({
        ...ref,
        url: `data:${assets[i].mime};base64,${bytes[i].toString("base64")}`,
      })),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].video_urls).toEqual([
      `data:video/mp4;base64,${bytes[1].toString("base64")}`,
    ]);
    expect(requests[0].image_urls).toEqual([
      `data:image/png;base64,${bytes[0].toString("base64")}`,
    ]);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
it("does not present analysis-only references as uploaded or generated video", () => {
  const manifest = referenceDelivery({
    references: [],
    input: { model: "i2v", mode: "image_to_video" },
    prompt: {
      direction: { references: [{ ...motion, usage: "analysis_only" }] },
    },
  });
  expect(manifest.videoReferenceCount).toBe(0);
  expect(manifest.analysisOnlyReferences).toEqual([
    { assetId: motion.assetId, role: "motion" },
  ]);
  expect(manifest.message).toContain("No video is bound");
});
