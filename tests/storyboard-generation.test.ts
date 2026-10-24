import { attachFixtureAnalysis } from "./video-workflow-fixture.js";
import { faceFreeFixturePolicy } from "./video-policy-fixture.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider, type Model } from "../packages/providers/src/index.js";
import {
  operationSchema,
  compositionSchema,
} from "../packages/contracts/src/index.js";
import { referenceReportSchema } from "../packages/contracts/src/reference-analysis.js";
import { callStoryboardTool } from "../packages/mcp/src/storyboard-tools.js";
import { callTool } from "./prepared-request-fixture.js";
import { media } from "../packages/render/src/media.js";
import { Worker } from "../apps/worker/src/worker.js";
import { GatewayClient } from "../packages/cloud-client/src/gateway.js";
import {
  buildProviders,
  parseModelConfig,
} from "../packages/providers/src/config.js";

const downloaded = vi.hoisted(() => ({
  bytes: new Uint8Array() as Uint8Array,
}));
vi.mock("../packages/storage/src/download.js", () => ({
  downloadPublic: async () => downloaded.bytes,
}));
const imageProfile: Model = {
  id: "edit",
  endpoint: "fal-ai/test-edit",
  kind: "image",
  maxCostCents: 10,
  hardBoundConfirmed: true,
  priceVersion: "fixture-v1",
  parameters: { num_images: 1 },
  generationInput: {
    mode: "image_edit",
    maxTotalBytes: 20_000_000,
    bindings: [
      {
        field: "image_urls",
        roles: ["composition", "character", "product", "scene", "style"],
        kind: "image",
        array: true,
        min: 1,
        max: 6,
        maxBytes: 8_000_000,
      },
    ],
  },
};
const videoProfile: Model = {
  ...imageProfile,
  id: "minimax-i2v",
  endpoint: "minimax/test-i2v",
  kind: "video",
  parameters: { duration: 5 },
  generationInput: {
    mode: "image_to_video",
    outputDurationMs: 5000,
    maxTotalBytes: 20_000_000,
    bindings: [
      {
        field: "image_url",
        roles: ["first_frame"],
        kind: "image",
        array: false,
        min: 1,
        max: 1,
        maxBytes: 8_000_000,
      },
    ],
  },
};
const motionProfile: Model = {
  ...videoProfile,
  id: "minimax-motion",
  generationInput: {
    mode: "reference_to_video",
    outputDurationMs: 5000,
    maxTotalBytes: 20_000_000,
    bindings: [
      {
        field: "image_urls",
        roles: ["scene", "character", "product", "style"],
        kind: "image",
        array: true,
        min: 1,
        max: 6,
        maxBytes: 8_000_000,
      },
      {
        field: "video_urls",
        roles: ["motion"],
        kind: "video",
        array: true,
        min: 0,
        max: 1,
        maxBytes: 8_000_000,
        minDurationMs: 100,
        maxDurationMs: 15000,
        maxTotalDurationMs: 15000,
      },
    ],
  },
};
let db: Database,
  dir: string,
  service: Service,
  c: any,
  source: any,
  analysis: any;
let requests: Record<string, any>[], fetcher: typeof fetch;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "storyboard-"));
  db = await Database.open();
  requests = [];
  fetcher = vi.fn(async (url: any, init?: RequestInit) => {
    if (init?.method === "POST") {
      requests.push(JSON.parse(String(init.body)));
      return Response.json({
        request_id: "fixture",
        status_url: "https://queue.fal.run/status",
        response_url: "https://queue.fal.run/result",
        cancel_url: "https://queue.fal.run/cancel",
      });
    }
    return String(url).endsWith("status")
      ? Response.json({ status: "COMPLETED" })
      : Response.json(
          requests.at(-1)?.image_url || requests.at(-1)?.video_urls
            ? { video: { url: "https://media.fal.media/fixture.mp4" } }
            : { images: [{ url: "https://media.fal.media/fixture.png" }] },
        );
  });
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider(
      [imageProfile, videoProfile, motionProfile],
      "fixture-key",
      true,
      fetcher,
    ),
  );
  c = await service.authenticate(
    (await service.createAccount("Storyboards", 1000)).key,
  );
  const rendered = await media({
    command: "render",
    workDir: dir,
    assets: {},
    composition: compositionSchema.parse({
      schemaVersion: 1,
      title: "Source",
      width: 144,
      height: 144,
      scenes: [{ id: "s", durationMs: 2500, color: "#225588" }],
    }),
  });
  source = await service.registerAsset(
    c.accountId,
    await readFile(rendered.output),
    {
      name: "reference.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: rendered.metadata,
      provenance: { evidence: "local-real" },
    },
  );
  const report = referenceReportSchema.parse({
    schemaVersion: 2,
    source: {
      assetId: source.id,
      sha256: source.sha256,
      durationMs: 2500,
      hasAudio: false,
      timebase: "source_ms",
    },
    summary: "A product shot",
    shots: [
      {
        id: "s1",
        startMs: 0,
        endMs: 2500,
        description: "A person holds a bottle",
        framing: "medium",
        cameraMotion: "push in",
        action: "Lift the bottle",
        transition: "cut",
        evidenceIds: ["e1"],
      },
    ],
    narrativeBeats: [],
    events: [],
    visualStyle: { description: "warm light", evidenceIds: ["e1"] },
    speech: [],
    audio: { description: "silent", evidenceIds: [] },
    evidence: [
      {
        id: "e1",
        startMs: 0,
        endMs: 2500,
        modality: "visual",
        observation: "bottle",
        confidence: "medium",
      },
    ],
    unknowns: [],
    coverage: {
      startMs: 0,
      endMs: 2500,
      fps: 2,
      mode: "static_video_and_audio",
      timing: "model_estimated",
      gaps: [],
    },
    measurements: {
      status: "unavailable",
      method: "ffmpeg-scene-difference",
      threshold: 0.3,
      cutTimesMs: [],
    },
    provenance: {
      provider: "fixture",
      model: "fixture",
      endpoint: "fixture",
      requestId: "fixture",
      jobId: "fixture",
      analysisVersion: "fixture",
      priceVersion: "fixture",
      analyzedAt: new Date().toISOString(),
      evidence: "provider-live",
    },
  });
  analysis = await service.registerAsset(
    c.accountId,
    Buffer.from(JSON.stringify(report)),
    {
      name: "fixture-analysis.json",
      kind: "analysis",
      mime: "application/json",
      metadata: {},
      provenance: { evidence: "precomputed" },
    },
  );
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
// Author explicit target intent for generation tests; source observations are never prompts.
async function invoke(
  name: Parameters<typeof callStoryboardTool>[2],
  raw: any,
): Promise<any> {
  if (name !== "reference_storyboard_quote" || raw.preparedRequestId)
    return callStoryboardTool(service, c, name, raw);
  const board = await service.get(c, "storyboard", raw.storyboardId);
  const shot = board.shots.find(
    (s: any) => s.sourceShotId === raw.sourceShotId,
  );
  if (
    !shot ||
    board.version !== raw.expectedVersion ||
    (raw.stage === "video" && shot.review?.decision !== "accepted") ||
    (raw.stage === "image" &&
      shot.review?.decision === "accepted" &&
      !raw.regenerate)
  )
    return callStoryboardTool(service, c, name, raw);
  const model = service.provider.models.find((m) => m.id === raw.model)!;
  const mode = model.generationInput!.mode;
  let refs: any[] =
    raw.stage === "image"
      ? shot.references
      : [
          {
            assetId: shot.review.imageAssetId,
            role: mode === "reference_to_video" ? "scene" : "first_frame",
            instruction: "Keep the approved target bottle and presenter",
          },
          ...(mode === "reference_to_video" && shot.motion
            ? [
                {
                  assetId: shot.motion.assetId,
                  role: "motion",
                  transfer: shot.motionPurpose,
                  exclude: shot.motionExclusions,
                  instruction: "Use the approved lift timing",
                },
              ]
            : []),
        ];
  const targetPlan: any = {
    title: "Target bottle",
    width: 144,
    height: 144,
    shots: [
      {
        id: "target-lift",
        initialState: { bottle: "on the table" },
        action: "Lift our bottle to chest height",
        endState: { bottle: "held at chest height" },
        durationMs: shot.durationMs,
        references: refs,
      },
    ],
  };
  const motion = refs.find((r) => r.role === "motion");
  if (motion) {
    await attachFixtureAnalysis(
      service,
      c,
      targetPlan,
      await service.get(c, "asset", motion.assetId),
    );
    targetPlan.shots[0].sourceVideo = {
      strategy: "reference",
      assetId: motion.assetId,
    };
  }
  const plan: any = await callTool(service, c, "production_plan_save", {
    plan: targetPlan,
  });
  const drafts: any = await callTool(service, c, "production_shot_prompts", {
    planId: plan.id,
    expectedVersion: plan.version,
    shotId: "target-lift",
    subject: "Our presenter and bottle",
    mode: raw.stage === "image" ? "reference_to_video" : mode,
    ...(raw.stage === "image"
      ? { imageModel: raw.model }
      : { model: raw.model }),
  });
  const draft = raw.stage === "image" ? drafts.image : drafts.video;
  const prepared: any = await callTool(service, c, "generation_prepare", {
    plan: {
      planId: plan.id,
      expectedVersion: plan.version,
      shotId: "target-lift",
      stage: raw.stage === "image" ? "first_frame" : "video",
    },
    direction: draft.direction,
    input: {
      kind: "generate",
      model: raw.model,
      mode,
      prompt: draft.prompt,
      parameters: raw.parameters ?? {},
      references: refs.map(({ assetId, role }) => ({ assetId, role })),
      ...(raw.stage === "video"
        ? {
            videoPolicy: faceFreeFixturePolicy(
              await Promise.all(
                refs.map((r) => service.get(c, "asset", r.assetId)),
              ),
            ),
          }
        : {}),
      target: {
        width: 144,
        height: 144,
        aspectPolicy:
          mode === "reference_to_video" || raw.stage === "image"
            ? "contain"
            : "match",
      },
      storyboard: {
        storyboardId: board.id,
        version: board.version,
        sourceShotId: shot.sourceShotId,
        stage: raw.stage,
      },
    },
  });
  return callStoryboardTool(service, c, name, {
    ...raw,
    preparedRequestId: prepared.preparedRequestId,
  });
}
async function prepare(extra = {}) {
  return invoke("reference_storyboard_prepare", {
    analysisAssetId: analysis.id,
    brief: "Use our own presenter and bottle",
    shots: [{ sourceShotId: "s1", useSourceComposition: true }],
    ...extra,
  });
}
async function review(plan: any, extra = {}) {
  return invoke("reference_storyboard_review", {
    storyboardId: plan.id,
    expectedVersion: plan.version,
    sourceShotId: "s1",
    imageAssetId: plan.shots[0].frame.assetId,
    decision: "accepted",
    checks: { identity: true, product: true, composition: true },
    notes: "Fixture inspected",
    ...extra,
  });
}
it("extracts a real frame and motion clip, preserves source observations and spends nothing", async () => {
  const plan = await prepare({
    shots: [
      {
        sourceShotId: "s1",
        frameTimeMs: 200,
        motionRange: { startMs: 0, endMs: 2500 },
        motionPurpose: "action",
        motionExclusions: "source identity and setting",
      },
    ],
  });
  expect(plan.shots[0].frame).toMatchObject({
    sourceAssetId: source.id,
    requestedTimeMs: 200,
  });
  expect(
    (await service.get(c, "asset", plan.shots[0].frame.assetId)).kind,
  ).toBe("image");
  expect(
    (await service.get(c, "asset", plan.shots[0].motion.assetId)).metadata
      .durationMs,
  ).toBeGreaterThanOrEqual(2400);
  expect(JSON.stringify(plan.shots[0].sourceObservation)).toContain(
    "warm light",
  );
  expect(plan.shots[0].readyForGeneration).toBe(false);
  expect(plan.shots[0].imagePrompt).toBeUndefined();
  expect(JSON.stringify(plan.shots[0].sourceObservation)).toContain(
    "Lift the bottle",
  );
  expect(plan.shots[0].review).toBeUndefined();
  expect(requests).toEqual([]);
  expect((await service.usage(c)).reservedCents).toBe(0);
  expect(
    (
      await callTool(service, c, "record_get", {
        type: "storyboard",
        id: plan.id,
      })
    ).id,
  ).toBe(plan.id);
});
it("sends the exact ordered image references through a quoted worker request", async () => {
  const first = await prepare();
  const product = first.shots[0].frame.assetId;
  const plan = await prepare({
    references: [
      {
        assetId: product,
        role: "product",
        instruction: "The exact bottle design",
      },
    ],
  });
  const quoted = await invoke("reference_storyboard_quote", {
    storyboardId: plan.id,
    expectedVersion: 1,
    sourceShotId: "s1",
    stage: "image",
    model: "edit",
  });
  expect(quoted.input.mode).toBe("image_edit");
  expect(quoted.input.references.map((r: any) => r.role)).toEqual([
    "composition",
    "product",
  ]);
  expect(requests).toHaveLength(0);
  downloaded.bytes = await service.storage.read(
    (await service.get(c, "asset", product)).storageKey,
  );
  const job = await service.submit(c, {
    quoteId: quoted.quote.id,
    input: quoted.input,
    idempotencyKey: "image-step",
  });
  await new Worker(service).tick();
  expect((await service.get(c, "job", job.id)).status).toBe("completed");
  expect(requests).toHaveLength(1);
  expect(requests[0].image_urls).toHaveLength(2);
  expect(requests[0].image_urls[0]).toMatch(/^data:image\/png;base64,/);
  expect(requests[0].prompt).toContain("The exact bottle design");
  expect(JSON.stringify(await service.get(c, "job", job.id))).not.toContain(
    "data:image",
  );
});
it("requires a reviewed image, binds video quotes to it, and invalidates stale approval", async () => {
  const plan = await prepare();
  const request = {
    storyboardId: plan.id,
    expectedVersion: 1,
    sourceShotId: "s1",
    stage: "video",
    model: "minimax-i2v",
  };
  await expect(
    invoke("reference_storyboard_quote", request),
  ).rejects.toMatchObject({ code: "STORYBOARD_REVIEW_REQUIRED" });
  const accepted = await review(plan);
  const q = await invoke("reference_storyboard_quote", {
    ...request,
    expectedVersion: accepted.version,
  });
  expect(q.input.references).toEqual([
    { assetId: plan.shots[0].frame.assetId, role: "first_frame" },
  ]);
  expect(q.targetDurationMs).toBe(2500);
  expect(q.generationDurationMs).toBe(5000);
  await expect(review(plan)).resolves.toEqual(accepted);
  await review(accepted, {
    decision: "rejected",
    notes: "Product needs correction",
  });
  await expect(
    service.submit(c, {
      quoteId: q.quote.id,
      input: q.input,
      idempotencyKey: "stale",
    }),
  ).rejects.toMatchObject({ code: "STORYBOARD_CONFLICT" });
});
it("refuses silent loss of a requested motion reference or undersized video profile", async () => {
  const plan = await prepare({
    shots: [
      {
        sourceShotId: "s1",
        motionRange: { startMs: 0, endMs: 2500 },
        motionPurpose: "action",
        motionExclusions: "source identity and setting",
      },
    ],
  });
  const accepted = await review(plan);
  const req = {
    storyboardId: plan.id,
    expectedVersion: accepted.version,
    sourceShotId: "s1",
    stage: "video",
  };
  await expect(
    invoke("reference_storyboard_quote", { ...req, model: "minimax-i2v" }),
  ).rejects.toMatchObject({ code: "REFERENCE_MODE_UNSUPPORTED" });
  const q = await invoke("reference_storyboard_quote", {
    ...req,
    model: "minimax-motion",
  });
  expect(q.input.references.map((r: any) => r.role)).toEqual([
    "scene",
    "motion",
  ]);
  service.provider.models[2] = {
    ...motionProfile,
    generationInput: {
      ...motionProfile.generationInput!,
      outputDurationMs: 1000,
    },
  };
  await expect(
    invoke("reference_storyboard_quote", { ...req, model: "minimax-motion" }),
  ).rejects.toMatchObject({ code: "GENERATION_TOO_SHORT" });
});
it("checks ownership, media kind, bounds and read-only scope before doing work", async () => {
  await expect(
    prepare({ shots: [{ sourceShotId: "missing" }] }),
  ).rejects.toMatchObject({ code: "INVALID_SHOT" });
  await expect(
    prepare({ shots: [{ sourceShotId: "s1", frameTimeMs: 2500 }] }),
  ).rejects.toMatchObject({ code: "INVALID_INTERVAL" });
  await expect(
    prepare({
      references: [
        { assetId: source.id, role: "character", instruction: "person" },
      ],
    }),
  ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
  const other = await service.authenticate(
    (await service.createAccount("Other", 100)).key,
  );
  await expect(
    callStoryboardTool(service, other, "reference_storyboard_prepare", {
      analysisAssetId: analysis.id,
      brief: "new",
      shots: [{ sourceShotId: "s1", useSourceComposition: true }],
    }),
  ).rejects.toThrow();
  const readKey = await service.issueKey(c, {
    name: "Reader",
    scopes: ["read"],
    budgetCents: 0,
  });
  const reader = await service.authenticate(readKey.key);
  await expect(
    callStoryboardTool(service, reader, "reference_storyboard_prepare", {
      analysisAssetId: analysis.id,
      brief: "new",
      shots: [{ sourceShotId: "s1", useSourceComposition: true }],
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(requests).toHaveLength(0);
});
it("validates declared reference fields and capabilities and rejects URL injection", async () => {
  const plan = await prepare();
  const input = {
    kind: "generate",
    model: "edit",
    mode: "image_edit",
    prompt: "new",
    parameters: {},
    references: [{ assetId: plan.shots[0].frame.assetId, role: "product" }],
  };
  await expect(service.quote(c, input)).resolves.toBeTruthy();
  await expect(
    service.quote(c, {
      ...input,
      references: [{ assetId: source.id, role: "product" }],
    }),
  ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
  await expect(
    service.quote(c, { ...input, model: "minimax-i2v" }),
  ).rejects.toThrow();
  expect(
    operationSchema.safeParse({
      ...input,
      references: [{ assetId: "https://evil.test", role: "product" }],
    }).success,
  ).toBe(false);
  expect(
    operationSchema.safeParse({
      ...input,
      references: [
        { assetId: source.id, role: "product", url: "https://evil.test" },
      ],
    }).success,
  ).toBe(false);
  expect(service.provider.describe()[0].generationInput?.mode).toBe(
    "image_edit",
  );
  const models = [imageProfile];
  const config = {
    schemaVersion: 1,
    mode: "custom",
    providers: [
      { id: "p", adapter: "fal", keyEnv: "KEY", enabled: true, models },
    ],
  };
  expect(
    buildProviders(parseModelConfig(config), { KEY: "secret" }).describe()[0]
      .generationInput?.mode,
  ).toBe("image_edit");
  expect(() =>
    parseModelConfig({
      ...config,
      providers: [
        {
          ...config.providers[0],
          models: [
            {
              ...imageProfile,
              generationInput: {
                ...imageProfile.generationInput,
                bindings: [
                  {
                    ...imageProfile.generationInput!.bindings[0],
                    field: "prompt",
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  ).toThrow();
});
it("surfaces official upload failures without dropping references or changing billing source", async () => {
  const network = vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "REFERENCE_UPLOAD_UNAVAILABLE",
          message: "Upload not deployed",
        },
      },
      { status: 409 },
    ),
  );
  const gateway = new GatewayClient(
    service,
    "https://example.com",
    "secret",
    network,
  );
  await expect(
    gateway.quote(c, {
      kind: "generate",
      model: "edit",
      mode: "image_edit",
      prompt: "new",
      references: [{ assetId: source.id, role: "product" }],
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_UPLOAD_UNAVAILABLE" });
  expect(network).toHaveBeenCalledTimes(1);
});

it("completes reviewed image-to-video, maps its result back to the shot and renders locally", async () => {
  const plan = await prepare();
  const accepted = await review(plan);
  const q = await invoke("reference_storyboard_quote", {
    storyboardId: plan.id,
    expectedVersion: accepted.version,
    sourceShotId: "s1",
    stage: "video",
    model: "minimax-i2v",
  });
  const generated = await media({
    command: "render",
    workDir: dir,
    assets: {},
    composition: compositionSchema.parse({
      schemaVersion: 1,
      title: "Simulated provider video",
      width: 144,
      height: 144,
      scenes: [{ id: "new", durationMs: 5000, color: "#bb5522" }],
    }),
  });
  downloaded.bytes = await readFile(generated.output);
  const job = await service.submit(c, {
    quoteId: q.quote.id,
    input: q.input,
    idempotencyKey: "video-step",
  });
  await new Worker(service).tick();
  const done = await service.get(c, "job", job.id);
  expect(done.status).toBe("completed");
  expect(requests[0].image_url).toMatch(/^data:image\/png;base64,/);
  const adapted = await callTool(service, c, "reference_adapt", {
    analysisAssetId: analysis.id,
    title: "Remade",
    width: 144,
    height: 144,
    replacements: [{ sourceShotId: "s1", assetId: done.outputs[0] }],
  });
  const renderInput = { kind: "render", composition: adapted.composition };
  const renderQuote = await service.quote(c, renderInput);
  const renderJob = await service.submit(c, {
    quoteId: renderQuote.id,
    input: renderInput,
    idempotencyKey: "render-step",
  });
  await new Worker(service).tick();
  const final = await service.get(c, "job", renderJob.id);
  expect(final.status).toBe("completed");
  expect(
    (await service.get(c, "asset", final.outputs[0])).metadata.durationMs,
  ).toBe(5000);
});

it("honors an explicit target duration and caches repeated local preparation", async () => {
  const input = {
    idempotencyKey: "stable-storyboard",
    shots: [{ sourceShotId: "s1", durationMs: 7000 }],
  };
  const plan = await prepare(input);
  expect(plan.shots[0].durationMs).toBe(7000);
  expect((await prepare(input)).id).toBe(plan.id);
  await expect(prepare({ ...input, brief: "changed" })).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
});

it("rechecks revoked approval and changed reference bytes before a queued purchase reaches the provider", async () => {
  const plan = await prepare();
  const accepted = await review(plan);
  const q = await invoke("reference_storyboard_quote", {
    storyboardId: plan.id,
    expectedVersion: accepted.version,
    sourceShotId: "s1",
    stage: "video",
    model: "minimax-i2v",
  });
  const job = await service.submit(c, {
    quoteId: q.quote.id,
    input: q.input,
    idempotencyKey: "revoked",
  });
  await review(accepted, { decision: "rejected" });
  await new Worker(service).tick();
  expect((await service.get(c, "job", job.id)).error.code).toBe(
    "STORYBOARD_CONFLICT",
  );
  expect(requests).toHaveLength(0);
  const imageQ = await invoke("reference_storyboard_quote", {
    storyboardId: plan.id,
    expectedVersion: 3,
    sourceShotId: "s1",
    stage: "image",
    model: "edit",
  });
  const imageJob = await service.submit(c, {
    quoteId: imageQ.quote.id,
    input: imageQ.input,
    idempotencyKey: "corrupt",
  });
  const asset = await service.get(c, "asset", plan.shots[0].frame.assetId);
  await service.storage.put(asset.storageKey, Buffer.from("changed"));
  await new Worker(service).tick();
  expect((await service.get(c, "job", imageJob.id)).error.code).toBe(
    "REFERENCE_CHANGED",
  );
  expect(requests).toHaveLength(0);
});

it("requires distinct endpoint bindings for first and last frames", async () => {
  const p = {
    ...videoProfile,
    generationInput: {
      ...videoProfile.generationInput!,
      mode: "first_last_frame",
      bindings: [
        {
          ...videoProfile.generationInput!.bindings[0],
          roles: ["first_frame", "last_frame"],
          array: true,
          max: 2,
        },
      ],
    },
  };
  expect(() =>
    parseModelConfig({
      schemaVersion: 1,
      mode: "custom",
      providers: [
        { id: "p", adapter: "fal", keyEnv: "KEY", enabled: false, models: [p] },
      ],
    }),
  ).toThrow();
});

it.each(["review", "cancel"])(
  "stops a %s change made while preparing reference bytes before submission",
  async (change) => {
    const plan = await prepare();
    const accepted = await review(plan);
    const q = await invoke("reference_storyboard_quote", {
      storyboardId: plan.id,
      expectedVersion: accepted.version,
      sourceShotId: "s1",
      stage: "video",
      model: "minimax-i2v",
    });
    const job = await service.submit(c, {
      quoteId: q.quote.id,
      input: q.input,
      idempotencyKey: "preparing-change",
    });
    const read = service.storage.read.bind(service.storage);
    let changed = false;
    vi.spyOn(service.storage, "read").mockImplementation(async (key) => {
      const bytes = await read(key);
      if (!changed) {
        changed = true;
        if (change === "review")
          await review(accepted, { decision: "rejected" });
        else await service.cancel(c, job.id);
      }
      return bytes;
    });
    await new Worker(service).tick();
    expect(requests).toHaveLength(0);
    expect((await service.get(c, "job", job.id)).error.code).toBe(
      change === "review" ? "STORYBOARD_CONFLICT" : "CANCELLED",
    );
  },
);

it("refuses the old storyboard generation path without a target-plan preparation", async () => {
  const board = await prepare();
  await expect(
    callStoryboardTool(service, c, "reference_storyboard_quote", {
      storyboardId: board.id,
      expectedVersion: board.version,
      sourceShotId: "s1",
      stage: "image",
      model: "edit",
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_PLAN_REQUIRED" });
  expect(requests).toHaveLength(0);
});
