import { faceFreeFixturePolicy } from "./video-policy-fixture.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "./prepared-request-fixture.js";
import { compilePrompt } from "../packages/core/src/production-prompts.js";
import { generationReferences } from "../packages/core/src/generation-references.js";
import { PreparationClient } from "../packages/cloud-client/src/preparation.js";
import { acceptFixtureImage } from "./critical-image-fixture.js";
import { assertCriticalImageReviews } from "../packages/core/src/critical-image-review.js";

let db: Database, service: Service, c: any, dir: string;
const network = vi.fn();
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "critical-images-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider(
      [
        {
          id: "video",
          kind: "video",
          endpoint: "fixture/i2v",
          maxCostCents: 1,
          priceVersion: "test",
          hardBoundConfirmed: true,
          parameters: { duration: 5 },
          generationInput: {
            mode: "image_to_video",
            outputDurationMs: 5000,
            maxTotalBytes: 1024,
            bindings: [
              {
                field: "image_url",
                roles: ["first_frame"],
                kind: "image",
                array: false,
                min: 1,
                max: 1,
                maxBytes: 1024,
              },
            ],
          },
        },
      ],
      "fixture",
      true,
      network,
    ),
  );
  c = await service.authenticate(
    (await service.createAccount("Review gate", 100)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const asset = await service.registerAsset(
    c.accountId,
    Buffer.from(randomUUID()),
    {
      kind: "image",
      name: "fixture.png",
      mime: "image/png",
      metadata: { width: 320, height: 180 },
      provenance: { evidence: "synthetic" },
    },
  );
  const direction = {
    mode: "image_to_video",
    subject: "One patty",
    action: "Hold still",
    endState: "One patty",
    references: [
      {
        role: "first_frame",
        assetId: asset.id,
        instruction: "Keep this exact single patty",
      },
    ],
  };
  const input = {
    kind: "generate",
    mode: "image_to_video",
    model: "video",
    parameters: {},
    prompt: compilePrompt(direction).prompt,
    target: { width: 320, height: 180 },
    references: [{ role: "first_frame", assetId: asset.id }],
    videoPolicy: faceFreeFixturePolicy([asset]),
  };
  const request: any = await callTool(service, c, "workspace_request_save", {
    message: "Animate the original still",
    assetIds: [asset.id],
  });
  return {
    asset,
    raw: {
      input,
      direction,
      request: { requestId: request.requestId, expectedVersion: 1 },
    },
  };
}
async function unknown(assetId: string) {
  return callTool(service, c, "media_review", {
    assetId,
    inspectionIds: [],
    decision: "unreviewed",
    reviewer: "host_agent",
    notes:
      "Text-only host: pixels unavailable; brightness numbers are insufficient.",
    checks: {
      actionComplete: { status: "not_applicable", reason: "Still image" },
      ...Object.fromEntries(
        ["framing", "continuity", "noArtifacts"].map((key) => [
          key,
          { status: "unknown", reason: "Pixels unavailable" },
        ]),
      ),
    },
  });
}

async function stageFixture() {
  const f = await fixture();
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: {
      title: "One patty starting stage",
      width: 320,
      height: 180,
      shots: [
        {
          id: "sear",
          initialState: { patty: "one patty on griddle" },
          action: "Sear",
          endState: { patty: "one patty on griddle" },
          referenceChoice: {
            strategy: "stage_first_frame",
            reason: "Keep bun separate",
          },
          references: f.raw.direction.references,
        },
      ],
    },
  });
  const drafts: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "sear",
    subject: "One patty",
    mode: "image_to_video",
    model: "video",
  });
  const production = {
    projectId: saved.productionProjectId,
    scopeVersion: 1,
    shotId: "sear",
  };
  const inspectionId = randomUUID();
  await service.scoped(c, "write", (tx) =>
    tx.put({
      id: inspectionId,
      type: "media-inspection",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      assetId: f.asset.id,
      sourceSha256: f.asset.sha256,
      frames: [{ sourceTimeMs: 0 }],
    }),
  );
  const review = {
    assetId: f.asset.id,
    inspectionIds: [inspectionId],
    production,
    reviewer: "host_agent",
    decision: "accepted",
    checks: {
      actionComplete: { status: "not_applicable", reason: "Still fixture" },
      framing: true,
      continuity: true,
      noArtifacts: true,
    },
    notes: "Synthetic test evidence, not actual pixel judgment",
  };
  const stateChecks = {
    stage: { status: "pass", reason: "Searing stage" },
    count: { status: "pass", reason: "One patty" },
    arrangement: { status: "pass", reason: "Bun beside griddle" },
    support: { status: "pass", reason: "Griddle supports patty" },
  };
  return {
    ...f,
    saved,
    drafts,
    production,
    review,
    stateChecks,
    raw: {
      request: f.raw.request,
      input: { ...f.raw.input, prompt: drafts.video.prompt },
      direction: drafts.video.direction,
      plan: {
        planId: saved.id,
        expectedVersion: 1,
        shotId: "sear",
        stage: "video",
      },
    },
  };
}

it("binds stage checks to the exact first frame, reuses the inspection and adds no provider prose", async () => {
  const f = await stageFixture();
  expect(f.drafts.referenceCheck.startingStateReview.expectedState).toEqual({
    patty: "one patty on griddle",
  });
  await expect(
    callTool(service, c, "media_review", f.review),
  ).rejects.toMatchObject({
    code: "STARTING_STATE_REVIEW_REQUIRED",
  });
  await expect(
    callTool(service, c, "generation_prepare", f.raw),
  ).resolves.toBeDefined();
  const reviewed: any = await callTool(service, c, "media_review", {
    ...f.review,
    startingStateChecks: f.stateChecks,
  });
  const prepared: any = await callTool(service, c, "generation_prepare", f.raw);
  expect(prepared.readyForSubmission).toBe(true);
  expect(prepared.providerRequest.prompt).toBe(f.drafts.video.prompt);
  expect(prepared.referenceCheck.choice.strategy).toBe("stage_first_frame");
  const again: any = await callTool(service, c, "media_review", {
    ...f.review,
    startingStateChecks: f.stateChecks,
  });
  expect(again.id).toBe(reviewed.id);
  expect(network).not.toHaveBeenCalled();
});

it("cannot accept unknown stage or use generic image acceptance instead of the state check", async () => {
  const f = await stageFixture();
  await acceptFixtureImage(service, c, f.asset);
  await expect(
    callTool(service, c, "generation_prepare", f.raw),
  ).resolves.toBeDefined();
  await expect(
    callTool(service, c, "media_review", {
      ...f.review,
      startingStateChecks: {
        ...f.stateChecks,
        stage: { status: "unknown", reason: "Not visible" },
      },
    }),
  ).rejects.toMatchObject({ code: "STARTING_STATE_REVIEW_REQUIRED" });
  await expect(
    callTool(service, c, "media_review", {
      ...f.review,
      production: undefined,
      startingStateChecks: f.stateChecks,
    }),
  ).rejects.toMatchObject({ code: "INVALID_STARTING_STATE_REVIEW" });
  expect(network).not.toHaveBeenCalled();
});

it("does not require a stage review before cloud model discovery", async () => {
  const f = await stageFixture();
  const request = vi.fn(async (_path: string) => ({
    protocol: "rikoko-cloud-preparation-v2",
  }));
  const client = new PreparationClient(
    service,
    "https://fixture.invalid",
    "fixture",
    request,
  );
  await expect(client.prepare(c, f.raw)).rejects.toMatchObject({
    code: "CAPABILITY_UNAVAILABLE",
  });
  expect(
    request.mock.calls.some(([path]) => path === "/v1/generation-models"),
  ).toBe(true);
  expect(network).not.toHaveBeenCalled();
});

it("rejects mismatched saved choices in real local and cloud preparation", async () => {
  const f = await stageFixture();
  const saved: any = await callTool(service, c, "production_plan_save", {
    planId: f.saved.id,
    expectedVersion: 1,
    plan: {
      ...f.saved.plan,
      shots: f.saved.plan.shots.map((shot: any) => ({
        ...shot,
        referenceChoice: {
          strategy: "direct",
          reason: "Deliberately incompatible test choice",
        },
      })),
    },
  });
  const raw = {
    ...f.raw,
    plan: { ...f.raw.plan, expectedVersion: saved.version },
  };
  await acceptFixtureImage(service, c, f.asset, {
    ...f.production,
    scopeVersion: 2,
  });
  await expect(
    callTool(service, c, "generation_prepare", raw),
  ).rejects.toMatchObject({
    code: "SHOT_REFERENCE_CHOICE_MISMATCH",
  });
  const request = vi.fn(async (_path: string) => ({
    protocol: "rikoko-cloud-preparation-v2",
  }));
  const client = new PreparationClient(
    service,
    "https://fixture.invalid",
    "fixture",
    request,
  );
  await expect(client.prepare(c, raw)).rejects.toMatchObject({
    code: "SHOT_REFERENCE_CHOICE_MISMATCH",
  });
  expect(
    request.mock.calls.every(([path]) => path === "/v1/generation-protocol"),
  ).toBe(true);
  expect(network).not.toHaveBeenCalled();
});

it("keeps optional review uncertainty separate from quote and worker execution", async () => {
  const f = await stageFixture();
  await callTool(service, c, "media_review", {
    ...f.review,
    startingStateChecks: f.stateChecks,
  });
  const prepared: any = await callTool(service, c, "generation_prepare", f.raw);
  await callTool(service, c, "media_review", {
    ...f.review,
    decision: "unreviewed",
    startingStateChecks: {
      ...f.stateChecks,
      count: { status: "unknown", reason: "Occluded" },
    },
  });
  await expect(service.quote(c, prepared.input)).resolves.toBeDefined();
  await expect(
    generationReferences(
      service,
      {
        accountId: c.accountId,
        referenceAssets: [
          {
            assetId: prepared.input.references[0].assetId,
            role: prepared.input.references[0].role,
            sha256: (
              await service.get(
                c,
                "asset",
                prepared.input.references[0].assetId,
              )
            ).sha256,
            bytes: (
              await service.get(
                c,
                "asset",
                prepared.input.references[0].assetId,
              )
            ).bytes,
          },
        ],
      } as any,
      prepared.input,
    ),
  ).resolves.toBeDefined();
});

it("prepares an unreviewed first frame without a storyboard or plan", async () => {
  const { asset, raw } = await fixture();
  await unknown(asset.id);
  await expect(
    callTool(service, c, "generation_prepare", raw),
  ).resolves.toBeDefined();
  expect(network).not.toHaveBeenCalled();
  await acceptFixtureImage(service, c, asset);
  const prepared: any = await callTool(service, c, "generation_prepare", raw);
  expect(prepared.readyForSubmission).toBe(true);
  // Reusing the same accepted image does not trigger another inspection/model request.
  await expect(
    callTool(service, c, "generation_prepare", raw),
  ).resolves.toHaveProperty("readyForSubmission", true);
  expect(network).not.toHaveBeenCalled();
});
it("does not block quote, submit or dispatch when an optional review changes", async () => {
  const { asset, raw } = await fixture();
  await acceptFixtureImage(service, c, asset);
  const prepared: any = await callTool(service, c, "generation_prepare", raw);
  const q = await service.quote(c, prepared.input);
  await unknown(asset.id);
  await expect(service.quote(c, prepared.input)).resolves.toBeDefined();
  await expect(
    service.submit(c, {
      quoteId: q.id,
      input: prepared.input,
      idempotencyKey: randomUUID(),
    }),
  ).resolves.toBeDefined();
  await expect(
    generationReferences(
      service,
      {
        accountId: c.accountId,
        referenceAssets: [
          {
            assetId: prepared.input.references[0].assetId,
            role: prepared.input.references[0].role,
            sha256: (
              await service.get(
                c,
                "asset",
                prepared.input.references[0].assetId,
              )
            ).sha256,
            bytes: (
              await service.get(
                c,
                "asset",
                prepared.input.references[0].assetId,
              )
            ).bytes,
          },
        ],
      } as any,
      prepared.input,
    ),
  ).resolves.toBeDefined();
  expect(network).not.toHaveBeenCalled();
});
it("allows unreviewed cloud references to reach model discovery", async () => {
  const { raw } = await fixture();
  const request = vi.fn(async () => ({
    protocol: "rikoko-cloud-preparation-v2",
  }));
  const client = new PreparationClient(
    service,
    "https://fixture.invalid",
    "fixture",
    request,
  );
  await expect(client.prepare(c, raw)).rejects.toMatchObject({
    code: "CAPABILITY_UNAVAILABLE",
  });
  expect(request.mock.calls.length).toBeGreaterThan(1); // Read-only protocol/model discovery.
  expect(network).not.toHaveBeenCalled();
});
it("does not require inspection evidence to prepare an owned image", async () => {
  const { asset, raw } = await fixture();
  const review: any = await acceptFixtureImage(service, c, asset);
  await service.scoped(c, "write", async (tx) => {
    const inspection = await tx.get(
      review.inspectionIds[0],
      c.accountId,
      "media-inspection",
    );
    await tx.put({ ...inspection!, sourceSha256: "0".repeat(64) });
  });
  await expect(
    callTool(service, c, "generation_prepare", raw),
  ).resolves.toBeDefined();
});
it("binds planned boundary checks to the intended shot without requiring video action findings for an image", async () => {
  const { asset, raw } = await fixture();
  const state = { patty: { presence: "visible" } };
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: {
      title: "Static process",
      width: 320,
      height: 180,
      process: { version: 1, objects: [{ id: "patty", label: "One patty" }] },
      shots: [
        {
          id: "hold",
          durationMs: 5000,
          initialState: { patty: "visible" },
          action: "Hold still",
          endState: { patty: "visible" },
          references: raw.direction.references,
          process: {
            initialState: state,
            endState: state,
            operations: [],
            stateAnchor: { mode: "first_frame", assetId: asset.id },
          },
        },
      ],
    },
  });
  const production = {
    projectId: saved.productionProjectId,
    scopeVersion: 1,
    shotId: "hold",
  };
  const input: any = { ...raw.input, production };
  const validate = () =>
    service.scoped(c, "read", (tx) =>
      assertCriticalImageReviews(tx, c.accountId, input),
    );
  await acceptFixtureImage(service, c, asset);
  await expect(validate()).rejects.toMatchObject({
    code: "CRITICAL_IMAGE_REVIEW_REQUIRED",
  });
  await acceptFixtureImage(service, c, asset, production);
  await expect(validate()).resolves.toBeUndefined();
  await unknown(asset.id);
  await expect(validate()).rejects.toMatchObject({
    code: "CRITICAL_IMAGE_REVIEW_REQUIRED",
  });
});

it("accepts an inspected identity reference without pretending that a still proves continuity", async () => {
  const { asset, raw } = await fixture();
  const review: any = await acceptFixtureImage(service, c, asset);
  await callTool(service, c, "media_review", {
    assetId: asset.id,
    inspectionIds: review.inspectionIds,
    decision: "accepted",
    reviewer: "host_agent",
    checks: {
      framing: true,
      noArtifacts: true,
      continuity: {
        status: "not_applicable",
        reason: "Static identity reference, not a video sequence",
      },
      actionComplete: { status: "not_applicable", reason: "Still image" },
    },
    notes: "Subject visible; background has not been removed.",
  });
  const check = (role: string) =>
    service.scoped(c, "read", (tx) =>
      assertCriticalImageReviews(tx, c.accountId, {
        ...raw.input,
        mode: "reference_to_video",
        references: [{ assetId: asset.id, role }],
      } as any),
    );
  await expect(check("character")).resolves.toBeUndefined();
  await expect(check("product")).resolves.toBeUndefined();
  await expect(check("first_frame")).rejects.toMatchObject({
    code: "CRITICAL_IMAGE_REVIEW_REQUIRED",
  });
  await expect(
    callTool(service, c, "media_review", {
      assetId: asset.id,
      inspectionIds: review.inspectionIds,
      decision: "accepted",
      reviewer: "host_agent",
      checks: {
        framing: true,
        noArtifacts: true,
        continuity: true,
        actionComplete: { status: "not_applicable", reason: "Still image" },
      },
      notes: "Trying to promote unchanged evidence",
    }),
  ).rejects.toMatchObject({ code: "REVIEW_NEW_EVIDENCE_REQUIRED" });
  await unknown(asset.id);
  await expect(check("character")).rejects.toMatchObject({
    code: "CRITICAL_IMAGE_REVIEW_REQUIRED",
  });
  expect(network).not.toHaveBeenCalled();
});
