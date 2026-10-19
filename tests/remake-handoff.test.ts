import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { referenceReportSchema } from "../packages/contracts/src/reference-analysis.js";
import { Worker } from "../apps/worker/src/worker.js";

let db: Database, service: Service, dir: string, c: any;
const network = vi.fn();
const videoModel = {
  id: "video",
  kind: "video" as const,
  endpoint: "minimax/h3/text-to-video",
  maxCostCents: 10,
  priceVersion: "fixture",
  hardBoundConfirmed: true,
  parameters: { duration: 5, aspect_ratio: "16:9" },
};
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "remake-handoff-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider(
      [
        videoModel,
        {
          id: "image",
          kind: "image",
          endpoint: "fixture/image",
          maxCostCents: 5,
          priceVersion: "fixture",
          hardBoundConfirmed: true,
          parameters: { aspect_ratio: "16:9" },
        },
      ],
      "fixture",
      true,
      network,
    ),
  );
  c = await service.authenticate(
    (await service.createAccount("Remake", 10000)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

async function fixture(
  options: { upstream?: string; unknown?: boolean; trusted?: boolean } = {},
) {
  const jobId = randomUUID();
  const source = await service.registerAsset(
    c.accountId,
    Buffer.from(randomUUID()),
    {
      name: "source.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: { durationMs: 2000, hasAudio: false },
      provenance: { evidence: "contract-fixture" },
    },
  );
  const report = referenceReportSchema.parse({
    schemaVersion: 2,
    analysis: {
      detail: "recreate",
      focus: ["motion", "continuity"],
      method: "whole_video",
    },
    source: {
      assetId: source.id,
      sha256: source.sha256,
      durationMs: 2000,
      hasAudio: false,
      timebase: "source_ms",
    },
    summary: "A lid opens and the interior is revealed.",
    shots: [
      {
        id: "source-open",
        startMs: 0,
        endMs: 2000,
        description: "Box",
        framing: "Close-up",
        cameraMotion: "Fixed",
        action: "Open lid",
        transition: "End",
        evidenceIds: ["e-open"],
        details: {
          startState: "Closed",
          endState: "Open",
          spatialRelations: "Hand above lid",
          lighting: "Soft",
          actionStages: [
            {
              description: "Contact",
              subjectMotion: "Hand approaches",
              cameraMotion: "Fixed",
            },
            {
              description: "Open",
              subjectMotion: "Lid rotates",
              cameraMotion: "Fixed",
            },
          ],
          continuity: {
            fromPrevious: "Start",
            toNext: "End",
            constraints: ["Same box"],
          },
        },
      },
    ],
    narrativeBeats: [
      {
        id: "beat-reveal",
        startMs: 0,
        endMs: 2000,
        role: "reveal",
        description: "Show interior",
        evidenceIds: ["e-open"],
      },
    ],
    events: [],
    visualStyle: { description: "Clean", evidenceIds: ["e-open"] },
    speech: [],
    audio: { description: "Silent", evidenceIds: [] },
    evidence: [
      {
        id: "e-open",
        startMs: 0,
        endMs: 2000,
        modality: "visual",
        observation: "The lid opens",
        confidence: "high",
      },
    ],
    unknowns: options.unknown
      ? [
          {
            startMs: 0,
            endMs: 1000,
            question: "Was contact made?",
            reason: "Occluded",
            suggestedFps: 4,
          },
        ]
      : [],
    coverage: {
      startMs: 0,
      endMs: 2000,
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
      reason: "Contract fixture",
    },
    provenance: {
      provider: "fixture-analysis",
      model: "reference-vision",
      endpoint: "gemini-fixture",
      upstreamModel: options.upstream ?? "gemini-fixture",
      requestId: "fixture-request",
      jobId,
      analysisVersion: "reference-v2.2-detail",
      priceVersion: "fixture",
      analyzedAt: new Date().toISOString(),
      evidence: "provider-live",
    },
  });
  const asset = await service.registerAsset(
    c.accountId,
    Buffer.from(JSON.stringify(report)),
    {
      name: "analysis.json",
      kind: "analysis",
      mime: "application/json",
      metadata: {},
      provenance: { evidence: "provider-live" },
      jobId,
    },
  );
  if (options.trusted !== false)
    await service.scoped(c, "write", (tx) =>
      tx.put({
        id: jobId,
        type: "job",
        accountId: c.accountId,
        createdAt: new Date().toISOString(),
        status: "completed",
        input: {
          kind: "reference_analyze",
          assetId: source.id,
          model: "reference-vision",
          purpose: "remake",
          detail: "recreate",
        },
        outputs: [asset.id],
        analysis: report,
      }),
    );
  const plan: any = {
    title: "Reveal a new box",
    width: 1280,
    height: 720,
    remake: {
      analysisAssetId: asset.id,
      analysisSha256: asset.sha256,
      productFacts: ["The target box has a hinged lid"],
      requirements: [
        {
          id: "reveal",
          mode: "preserve",
          origin: "reference",
          description: "Show the completed opening before cutting",
          sourceShotIds: ["source-open"],
          evidenceIds: ["e-open"],
        },
      ],
      unknownDecisions: [],
    },
    shots: [
      {
        id: "target-open",
        sourceShotIds: ["source-open"],
        purpose: "Reveal the interior",
        initialState: { lid: "closed" },
        action: "Open the lid",
        actionStages: [
          "Hand contacts the lid",
          "Lid rotates open",
          "Hold the open result",
        ],
        endState: { lid: "open" },
        camera: "Fixed close-up; keep contact visible",
        acceptanceCriteria: ["Interior is visible after opening"],
        requirementUses: [
          {
            requirementId: "reveal",
            application: "Hold the open result before the cut",
          },
        ],
      },
    ],
  };
  return { source, report, asset, plan };
}
async function save(plan: any) {
  return callTool(service, c, "production_plan_save", { plan }) as Promise<any>;
}
it("assembles independent target shots with direct production mapping and an initial scoped workspace", async () => {
  const { asset, plan } = await fixture();
  const shot = plan.shots[0];
  plan.shots = [
    {
      ...shot,
      id: "target-contact",
      action: "Touch the target lid",
      endState: { lid: "closed" },
      durationMs: 1000,
    },
    { ...shot, id: "target-open", durationMs: 1000 },
  ];
  const saved = await save(plan);
  const target = await service.registerAsset(
    c.accountId,
    Buffer.from("new target output"),
    {
      name: "target.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: { durationMs: 5000, width: 1280, height: 720 },
      provenance: { evidence: "contract-fixture" },
    },
  );
  const input = {
    analysisAssetId: asset.id,
    title: "Target assembly",
    plan: { planId: saved.id, expectedVersion: 1 },
    replacements: [
      { productionShotId: "target-open", assetId: target.id },
      {
        productionShotId: "target-contact",
        assetId: target.id,
        timingPolicy: "selected_range",
        durationMs: 1000,
      },
    ],
  };
  const adapted: any = await callTool(service, c, "reference_adapt", input);
  expect(adapted.projectId).toBe(saved.productionProjectId);
  expect(
    adapted.composition.scenes.map((s: any) => s.productionShotId),
  ).toEqual(["target-contact", "target-open"]);
  expect(adapted.composition.scenes.map((s: any) => s.durationMs)).toEqual([
    1000, 5000,
  ]);
  expect(adapted.shotMapping[0].visualBrief.action).toBe(
    "Touch the target lid",
  );
  const committed: any = await callTool(service, c, "workspace_commit", {
    projectId: adapted.projectId,
    action: { type: "create", composition: adapted.composition },
    message: "Assemble target plan",
    idempotencyKey: randomUUID(),
  });
  const validation: any = await callTool(service, c, "workspace_validate", {
    revisionId: committed.revisionId,
  });
  expect(
    validation.issues.some((i: any) =>
      [
        "PRODUCTION_SHOT_UNMAPPED",
        "PRODUCTION_SCOPE_REQUIRED",
        "PRODUCTION_SHOT_MISSING",
      ].includes(i.code),
    ),
  ).toBe(false);
  expect(validation.finalReady).toBe(false); // Mapping alone cannot approve unreviewed media.
  await service.cancel(c, committed.jobId);
  await expect(
    callTool(service, c, "reference_adapt", {
      ...input,
      replacements: [{ sourceShotId: "source-open", assetId: target.id }],
    }),
  ).rejects.toMatchObject({ code: "INVALID_SHOT" });
  expect(network).not.toHaveBeenCalled();
});
async function prepared(plan: any) {
  const saved = await save(plan);
  const prompts: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: saved.version,
    shotId: "target-open",
    subject: "Target box",
    mode: "text_to_video",
  });
  const p: any = await callTool(service, c, "generation_prepare", {
    input: { kind: "generate", model: "video", prompt: prompts.video.prompt },
    direction: prompts.video.direction,
    plan: { planId: saved.id, expectedVersion: 1, shotId: "target-open" },
  });
  return { saved, prompts, p };
}
it("returns Gemini evidence and stable source binding without another model call", async () => {
  const { asset } = await fixture();
  const handoff: any = await callTool(service, c, "reference_analysis_get", {
    analysisAssetId: asset.id,
    section: "handoff",
    sourceShotIds: ["source-open"],
  });
  expect(handoff.binding).toMatchObject({
    analysisAssetId: asset.id,
    analysisSha256: asset.sha256,
    upstreamModel: "gemini-fixture",
  });
  expect(handoff.shots[0].details.actionStages).toHaveLength(2);
  expect(handoff.narrativeBeats[0].role).toBe("reveal");
  expect(handoff.evidence[0].id).toBe("e-open");
  expect(handoff.semanticAcceptance).toBe(false);
  expect(network).not.toHaveBeenCalled();
});
it("validates host requirements and freezes purpose, stages, framing and acceptance in prompts", async () => {
  const { plan } = await fixture();
  const { p, prompts } = await prepared(plan);
  for (const text of [
    plan.shots[0].purpose,
    ...plan.shots[0].actionStages,
    plan.shots[0].camera,
    ...plan.shots[0].acceptanceCriteria,
    plan.remake.requirements[0].description,
    plan.remake.productFacts[0],
  ])
    expect(prompts.video.prompt).toContain(text);
  expect(p.remakeEvidence.analysisSha256).toBe(plan.remake.analysisSha256);
  await expect(service.quote(c, p.input)).resolves.toHaveProperty("id");
});
it("reports missing required coverage and rejects it on save", async () => {
  const { plan } = await fixture();
  plan.shots[0].requirementUses = [];
  const result: any = await callTool(
    service,
    c,
    "production_plan_validate",
    plan,
  );
  expect(result.valid).toBe(false);
  expect(result.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "REMAKE_REQUIREMENT_UNCOVERED" }),
    ]),
  );
  await expect(save(plan)).rejects.toMatchObject({
    code: "INVALID_PRODUCTION_PLAN",
  });
});
it("requires a deliberate adaptation reason and rejects unknown requirement IDs", async () => {
  const { plan } = await fixture();
  plan.remake.requirements[0].mode = "adapt";
  let result: any = await callTool(
    service,
    c,
    "production_plan_validate",
    plan,
  );
  expect(result.issues.map((x: any) => x.code)).toContain(
    "REMAKE_ADAPTATION_REASON_REQUIRED",
  );
  plan.shots[0].requirementUses[0].changeReason =
    "Adapt the opening to the new hinge";
  await expect(save(plan)).resolves.toHaveProperty("id");
  plan.shots[0].requirementUses[0].requirementId = "invented";
  result = await callTool(service, c, "production_plan_validate", plan);
  expect(result.valid).toBe(false);
});
it("rejects invented source evidence, stale reports and cross-account reports", async () => {
  const { plan } = await fixture();
  const missing = structuredClone(plan);
  missing.remake.requirements[0].evidenceIds = ["fabricated"];
  await expect(save(missing)).rejects.toMatchObject({
    code: "REMAKE_EVIDENCE_INVALID",
  });
  const stale = structuredClone(plan);
  stale.remake.analysisSha256 = "0".repeat(64);
  await expect(save(stale)).rejects.toMatchObject({
    code: "REMAKE_SOURCE_CHANGED",
  });
  const other = await service.authenticate(
    (await service.createAccount("Other", 100)).key,
  );
  await expect(
    callTool(service, other, "production_plan_save", { plan }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("does not accept a non-Gemini report or self-labelled uploaded analysis", async () => {
  await expect(
    save((await fixture({ upstream: "other-model" })).plan),
  ).rejects.toMatchObject({ code: "REFERENCE_MODEL_POLICY" });
  await expect(
    save((await fixture({ trusted: false })).plan),
  ).rejects.toMatchObject({ code: "ANALYSIS_PROVENANCE_REQUIRED" });
});
it("keeps relevant uncertainty blocking until explicitly classified as not applicable", async () => {
  const { plan } = await fixture({ unknown: true });
  await expect(save(plan)).rejects.toMatchObject({
    code: "REMAKE_UNCERTAINTY_REQUIRED",
  });
  plan.remake.unknownDecisions = [
    { index: 0, disposition: "blocking", reason: "Contact matters" },
  ];
  await expect(save(plan)).rejects.toMatchObject({
    code: "REMAKE_UNCERTAINTY_REQUIRED",
  });
  plan.remake.unknownDecisions = [
    {
      index: 0,
      disposition: "not_applicable",
      reason: "This adaptation uses an already open static display",
    },
  ];
  await expect(save(plan)).resolves.toHaveProperty("id");
});
it("does not allow a plan update to silently remove its remake requirements", async () => {
  const { plan } = await fixture();
  const saved = await save(plan);
  const stripped = structuredClone(saved.plan);
  delete stripped.remake;
  await expect(
    callTool(service, c, "production_plan_save", {
      planId: saved.id,
      expectedVersion: 1,
      plan: stripped,
    }),
  ).rejects.toMatchObject({ code: "REMAKE_REQUIREMENTS_REQUIRED" });
});
it("rechecks source bytes before quote and worker submission without buying twice", async () => {
  const { plan, source } = await fixture();
  const { p } = await prepared(plan);
  const quote = await service.quote(c, p.input);
  const job = await service.submit(c, {
    quoteId: quote.id,
    input: p.input,
    idempotencyKey: randomUUID(),
  });
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...source, sha256: "f".repeat(64) }),
  );
  await expect(service.quote(c, p.input)).rejects.toMatchObject({
    code: "SOURCE_MISMATCH",
  });
  await new Worker(service).tick();
  expect(await service.get(c, "job", job.id)).toMatchObject({
    status: "failed",
    chargedCents: 0,
  });
  expect(network).not.toHaveBeenCalled();
});
it("rejects dropping compiled requirements from a prepared plan direction", async () => {
  const { plan } = await fixture();
  const { saved, prompts } = await prepared(plan);
  const direction = {
    ...prompts.video.direction,
    constraints: "Ignore requirements",
  };
  const preview: any = await callTool(
    service,
    c,
    "generation_prompt_preview",
    direction,
  );
  await expect(
    callTool(service, c, "generation_prepare", {
      input: { kind: "generate", model: "video", prompt: preview.prompt },
      direction,
      plan: { planId: saved.id, expectedVersion: 1, shotId: "target-open" },
    }),
  ).rejects.toMatchObject({ code: "PLAN_DIRECTION_MISMATCH" });
});

it("compiles boundary images without asking the first frame to show the completed action", async () => {
  const { plan } = await fixture();
  const saved = await save(plan);
  const prompts: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "target-open",
    subject: "Target box",
    mode: "text_to_video",
  });
  expect(prompts.image.direction.initialState).toEqual({ lid: "closed" });
  expect(prompts.image.direction.endState).toEqual({ lid: "closed" });
  expect(prompts.image.prompt).not.toContain(
    "Interior is visible after opening",
  );
  expect(prompts.lastFrame.direction.initialState).toEqual({ lid: "open" });
  expect(prompts.video.prompt).toContain("Interior is visible after opening");
});
it("does not use a manual override to drop the frozen remake intent", async () => {
  const { plan } = await fixture();
  const { saved, prompts } = await prepared(plan);
  await expect(
    callTool(service, c, "generation_prepare", {
      input: { kind: "generate", model: "video", prompt: "Do something else" },
      direction: prompts.video.direction,
      plan: { planId: saved.id, expectedVersion: 1, shotId: "target-open" },
      promptOverride: { reason: "Shorter text" },
    }),
  ).rejects.toMatchObject({ code: "REMAKE_PROMPT_OVERRIDE" });
});
it("rechecks reference evidence when assigning an existing plan to a formal project", async () => {
  const { plan, source } = await fixture();
  const saved = await save(plan);
  const project = await service.createProject(c, {
    title: "Formal remake",
    brief: "Keep the reveal",
  });
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...source, sha256: "1".repeat(64) }),
  );
  await expect(
    callTool(service, c, "production_scope_save", {
      projectId: project.id,
      planId: saved.id,
      expectedPlanVersion: 1,
      expectedScopeVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "SOURCE_MISMATCH" });
});
it("requires source-bound evidence to survive cloud plan sync and execution", async () => {
  const { connectServices } =
    await import("../packages/cloud-client/src/index.js");
  const {
    cloudPreparationProtocol,
    syncCloudProductionContext,
    prepareCloudGeneration,
    bindCloudPreparation,
  } = await import("../packages/core/src/cloud-preparation.js");
  const remoteDb = await Database.open();
  const remote = new Service(
    remoteDb,
    new LocalStorage(join(dir, randomUUID())),
    new FalProvider([videoModel], "fixture", true, network),
  );
  const rc = await remote.authenticate(
    (await remote.createAccount("Remote", 1000)).key,
  );
  const requests: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname,
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push(path);
    try {
      let result;
      if (path === "/v1/generation-models") result = remote.provider.describe();
      else if (path === "/v1/generation-protocol")
        result = { protocol: cloudPreparationProtocol };
      else if (path === "/v1/production-context")
        result = await syncCloudProductionContext(remote, rc, body);
      else if (path === "/v1/generation-preparations")
        result = await prepareCloudGeneration(remote, rc, body);
      else if (path.endsWith("/bind"))
        result = await bindCloudPreparation(
          remote,
          rc,
          path.split("/")[3],
          body,
        );
      else if (path === "/v1/quotes")
        result = await remote.quote(rc, body.input);
      else throw Error(`Unexpected route: ${path}`);
      return Response.json(result);
    } catch (e: any) {
      return Response.json(
        { error: { code: e.code, message: e.message } },
        { status: e.status ?? 400 },
      );
    }
  };
  try {
    const { plan } = await fixture();
    const saved = await save(plan);
    const prompts: any = await callTool(service, c, "production_shot_prompts", {
      planId: saved.id,
      expectedVersion: 1,
      shotId: "target-open",
      subject: "Target box",
      mode: "text_to_video",
    });
    const gateway = connectServices(
      service,
      { gatewayOrigin: "https://cloud.example.com", gatewayKey: "fixture" },
      fetcher,
    ).gateway!;
    const p: any = await gateway.prepare(c, {
      input: { kind: "generate", model: "video", prompt: prompts.video.prompt },
      direction: prompts.video.direction,
      plan: { planId: saved.id, expectedVersion: 1, shotId: "target-open" },
    });
    expect(p.remakeEvidence.analysisSha256).toBe(plan.remake.analysisSha256);
    expect(p.cloud.draft.remakeEvidence).toEqual(p.remakeEvidence);
    await expect(gateway.quote(c, p.input)).resolves.toHaveProperty("id");
    expect(requests.some((x) => x.includes("upload"))).toBe(false);
    expect(network).not.toHaveBeenCalled();
  } finally {
    connectServices(service, {});
    await remoteDb.close();
  }
});
it("rejects a substitute analysis model before quote or upload", async () => {
  const { source } = await fixture();
  const original = service.provider;
  const settings = vi.fn(() => ({
    upstreamModel: "other-vlm",
    mode: "static_video_and_audio" as const,
    rangeControl: "api" as const,
    fps: 2,
  }));
  service.provider = {
    ...original,
    models: [],
    describe: () => [],
    validate: vi.fn(() => ({ ...videoModel, kind: "analysis" as const })),
    analysisSettings: settings,
    estimate: vi.fn(() => ({ maxCents: 10, priceVersion: "fixture" })),
    submit: network,
    poll: network,
    collect: network,
    cancel: network,
  } as any;
  try {
    await expect(
      service.quote(c, {
        kind: "reference_analyze",
        assetId: source.id,
        model: "pretends-to-be-gemini",
        purpose: "remake",
        detail: "recreate",
      }),
    ).rejects.toMatchObject({ code: "REFERENCE_MODEL_POLICY" });
    expect(network).not.toHaveBeenCalled();
  } finally {
    service.provider = original;
  }
});
it("rejects legacy source-shot claims without a source-bound remake contract", async () => {
  const { plan } = await fixture();
  delete plan.remake;
  delete plan.shots[0].requirementUses;
  const result: any = await callTool(
    service,
    c,
    "production_plan_validate",
    plan,
  );
  expect(result.valid).toBe(false);
});
it("records why requirements changed and rejects silent downgrade of preserve to free", async () => {
  const { plan } = await fixture();
  const saved = await save(plan);
  plan.remake.requirements[0].mode = "free";
  await expect(
    callTool(service, c, "production_plan_save", {
      planId: saved.id,
      expectedVersion: 1,
      plan,
    }),
  ).rejects.toMatchObject({ code: "REMAKE_CHANGE_REASON_REQUIRED" });
  plan.remake.changeReason = "The user now wants only the color palette";
  await expect(
    callTool(service, c, "production_plan_save", {
      planId: saved.id,
      expectedVersion: 1,
      plan,
    }),
  ).resolves.toMatchObject({ version: 2 });
});
it("does not include unrelated source shots when drafting a newly invented target shot", async () => {
  const { plan } = await fixture();
  plan.shots.push({
    ...plan.shots[0],
    id: "new-ending",
    sourceShotIds: [],
    requirementUses: [],
    initialState: { lid: "open" },
    endState: { lid: "open" },
    action: "Hold",
    actionStages: [],
  });
  const saved = await save(plan);
  const prompts: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "new-ending",
    subject: "Target",
    mode: "text_to_video",
  });
  expect(prompts.handoff.shots).toHaveLength(0);
  expect(prompts.handoff.targetNeighbors.previous.id).toBe("target-open");
});

it("allows a requirement to cover several target shots without duplicating every source shot", async () => {
  const { validateProductionPlan } =
    await import("../packages/core/src/production-plan.js");
  const { plan } = await fixture();
  plan.remake.requirements[0].sourceShotIds.push("source-result");
  plan.shots.push({
    ...plan.shots[0],
    id: "target-result",
    sourceShotIds: ["source-result"],
    initialState: { lid: "open" },
  });
  expect(validateProductionPlan(plan).valid).toBe(true);
  plan.shots.pop();
  expect(validateProductionPlan(plan).issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "REMAKE_SOURCE_MAPPING_REQUIRED" }),
    ]),
  );
});
it("does not drop a formal remake by rebinding to a fresh unbound plan", async () => {
  const { plan } = await fixture();
  const saved = await save(plan);
  const project = await service.createProject(c, {
    title: "Remake scope",
    brief: "Keep the reveal",
  });
  await callTool(service, c, "production_scope_save", {
    projectId: project.id,
    planId: saved.id,
    expectedPlanVersion: 1,
    expectedScopeVersion: 0,
  });
  delete plan.remake;
  delete plan.shots[0].requirementUses;
  plan.shots[0].sourceShotIds = [];
  const unbound = await save(plan);
  await expect(
    callTool(service, c, "production_scope_save", {
      projectId: project.id,
      planId: unbound.id,
      expectedPlanVersion: 1,
      expectedScopeVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "REMAKE_REQUIREMENTS_REQUIRED" });
});
it("returns a typed handoff over the actual MCP client/server boundary", async () => {
  const { Client } = await import("@modelcontextprotocol/client");
  const { InMemoryTransport } = await import("@modelcontextprotocol/server");
  const { createMcpServer } = await import("../packages/mcp/src/index.js");
  const { asset } = await fixture();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer((name, args) =>
    callTool(service, c, name as any, args),
  );
  const client = new Client({ name: "remake-handoff", version: "1" });
  await server.connect(b);
  await client.connect(a);
  try {
    const response: any = await client.callTool({
      name: "reference_analysis_get",
      arguments: {
        analysisAssetId: asset.id,
        section: "handoff",
        sourceShotIds: ["source-open"],
      },
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent.result.binding.protocol).toBe(
      "rikoko-remake-handoff-v1",
    );
    expect(
      response.structuredContent.result.shots[0].details.actionStages,
    ).toHaveLength(2);
  } finally {
    await client.close();
    await server.close();
  }
});
it("blocks formal delivery inspection when saved source evidence becomes stale", async () => {
  const { inspectProductionScope } =
    await import("../packages/core/src/production-scope.js");
  const { plan, source } = await fixture();
  const saved = await save(plan);
  const project = await service.createProject(c, {
    title: "Stale scope",
    brief: "Keep reveal",
  });
  await callTool(service, c, "production_scope_save", {
    projectId: project.id,
    planId: saved.id,
    expectedPlanVersion: 1,
    expectedScopeVersion: 0,
  });
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...source, sha256: "0".repeat(64) }),
  );
  const result = await service.scoped(c, "read", (tx) =>
    inspectProductionScope(service, tx, c.accountId, {
      id: randomUUID(),
      type: "revision",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      projectId: project.id,
      composition: { width: 1280, height: 720, scenes: [] },
    }),
  );
  expect(result.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "SOURCE_MISMATCH" }),
    ]),
  );
});
it("detects corrupted report bytes and cross-account handoff access", async () => {
  const { asset } = await fixture();
  const other = await service.authenticate(
    (await service.createAccount("Other handoff", 0)).key,
  );
  await expect(
    callTool(service, other, "reference_analysis_get", {
      analysisAssetId: asset.id,
      section: "handoff",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, asset.storageKey), "{}");
  await expect(
    callTool(service, c, "reference_analysis_get", {
      analysisAssetId: asset.id,
      section: "handoff",
    }),
  ).rejects.toMatchObject({ code: "REMAKE_SOURCE_CHANGED" });
});
it("requires explicit requirement acceptance on the rendered remake revision", async () => {
  const { plan } = await fixture();
  const saved = await save(plan);
  const project = await service.createProject(c, {
    title: "Final remake",
    brief: "Keep reveal",
  });
  await callTool(service, c, "production_scope_save", {
    projectId: project.id,
    planId: saved.id,
    expectedPlanVersion: 1,
    expectedScopeVersion: 0,
  });
  const a = await service.registerAsset(
    c.accountId,
    Buffer.from(randomUUID()),
    {
      name: "final.png",
      kind: "image",
      mime: "image/png",
      metadata: { width: 1280, height: 720 },
      provenance: { evidence: "contract-fixture" },
    },
  );
  const base = { accountId: c.accountId, createdAt: new Date().toISOString() };
  const evidence = {
    ...base,
    id: randomUUID(),
    type: "media-inspection",
    assetId: a.id,
    sourceSha256: a.sha256,
    frames: [{ sourceTimeMs: 0 }],
  };
  const revision = {
    ...base,
    id: randomUUID(),
    type: "revision",
    projectId: project.id,
    composition: { width: 1280, height: 720, scenes: [] },
  };
  await service.scoped(c, "write", async (tx) => {
    await tx.put(evidence);
    await tx.put(revision);
    await tx.put({
      ...base,
      id: randomUUID(),
      type: "job",
      status: "completed",
      revisionId: revision.id,
      outputs: [a.id],
    });
  });
  const review = {
    assetId: a.id,
    revisionId: revision.id,
    inspectionIds: [evidence.id],
    decision: "accepted",
    reviewer: "host_agent",
    checks: {
      actionComplete: { status: "not_applicable", reason: "Image fixture" },
      framing: true,
      continuity: true,
      noArtifacts: true,
    },
    notes: "Contract fixture, not visual evidence",
  };
  await expect(
    callTool(service, c, "media_review", review),
  ).rejects.toMatchObject({ code: "REMAKE_REVIEW_REQUIRED" });
  await expect(
    callTool(service, c, "media_review", {
      ...review,
      requirementChecks: [
        { requirementId: "reveal", status: "unknown", reason: "Cannot see" },
      ],
    }),
  ).rejects.toMatchObject({ code: "REMAKE_REVIEW_REQUIRED" });
  const accepted: any = await callTool(service, c, "media_review", {
    ...review,
    requirementChecks: [
      { requirementId: "reveal", status: "pass", reason: "Fixture acceptance" },
    ],
  });
  expect(accepted.requirementChecks).toHaveLength(1);
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...accepted, requirementChecks: undefined }),
  );
  const validation: any = await callTool(service, c, "workspace_validate", {
    revisionId: revision.id,
  });
  expect(validation.finalReady).toBe(false);
  expect(validation.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "REMAKE_REVIEW_REQUIRED" }),
    ]),
  );
});
it("validates segment lineage for assembled Gemini handoffs and detects a lost child", async () => {
  const { referenceEvidence } =
    await import("../packages/core/src/reference-handoff.js");
  const parent = await fixture();
  const child = await fixture();
  const mergeId = randomUUID();
  const report = referenceReportSchema.parse({
    ...parent.report,
    analysis: {
      ...parent.report.analysis,
      method: "segmented",
      parts: [
        {
          analysisAssetId: child.asset.id,
          clipAssetId: child.source.id,
          sourceStartMs: 0,
          sourceEndMs: 2000,
          clipDurationMs: 2000,
          timeMapping: "offset-trim-codec-padding",
        },
      ],
    },
    provenance: {
      ...parent.report.provenance,
      jobId: mergeId,
      evidence: "provider-live-assembled",
    },
  });
  const asset = await service.registerAsset(
    c.accountId,
    Buffer.from(JSON.stringify(report)),
    {
      name: "merged.json",
      kind: "analysis",
      mime: "application/json",
      metadata: {},
      provenance: { evidence: "contract-fixture" },
    },
  );
  const merge = {
    id: mergeId,
    type: "analysis-plan",
    accountId: c.accountId,
    createdAt: new Date().toISOString(),
    source: report.source,
    merged: { analysisAssetId: asset.id },
  };
  await service.scoped(c, "write", (tx) => tx.put(merge));
  const evidence = await service.scoped(c, "read", (tx) =>
    referenceEvidence(service, tx, c.accountId, asset.id),
  );
  expect(evidence.binding.dependencies).toHaveLength(4);
  await service.scoped(c, "write", async (tx) => {
    const job = await tx.get(child.report.provenance.jobId, c.accountId, "job");
    await tx.put({ ...job!, status: "failed" });
  });
  await expect(
    service.scoped(c, "read", (tx) =>
      referenceEvidence(service, tx, c.accountId, asset.id),
    ),
  ).rejects.toMatchObject({ code: "ANALYSIS_PROVENANCE_REQUIRED" });
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...merge, merged: { analysisAssetId: "changed" } }),
  );
  await expect(
    service.scoped(c, "read", (tx) =>
      referenceEvidence(service, tx, c.accountId, asset.id),
    ),
  ).rejects.toMatchObject({ code: "ANALYSIS_PROVENANCE_REQUIRED" });
});
it("fails closed if a cloud mirror strips or substitutes the handoff", async () => {
  const { referenceEvidence } =
    await import("../packages/core/src/reference-handoff.js");
  const { syncCloudProductionContext, cloudPreparationProtocol } =
    await import("../packages/core/src/cloud-preparation.js");
  const { plan, asset } = await fixture();
  const { binding } = await service.scoped(c, "read", (tx) =>
    referenceEvidence(service, tx, c.accountId, asset.id),
  );
  const request = {
    protocol: cloudPreparationProtocol,
    clientId: "c".repeat(64),
    localId: randomUUID(),
    version: 1,
    kind: "plan",
    plan,
  };
  await expect(
    syncCloudProductionContext(service, c, request),
  ).rejects.toMatchObject({ code: "REMAKE_EVIDENCE_REQUIRED" });
  await expect(
    syncCloudProductionContext(service, c, {
      ...request,
      remakeEvidence: { ...binding, analysisSha256: "0".repeat(64) },
    }),
  ).rejects.toMatchObject({ code: "REMAKE_SOURCE_CHANGED" });
  await expect(
    syncCloudProductionContext(service, c, {
      ...request,
      remakeEvidence: { ...binding, upstreamModel: "other-vlm" },
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_MODEL_POLICY" });
});
it("allows unused free requirements to leave irrelevant source uncertainty out of the target", async () => {
  const { plan } = await fixture({ unknown: true });
  plan.remake.requirements[0].mode = "free";
  plan.shots[0].sourceShotIds = [];
  plan.shots[0].requirementUses = [];
  await expect(save(plan)).resolves.toHaveProperty("id");
});
it("prepares the first frame against the saved start state and rejects a video-model substitution", async () => {
  const { plan } = await fixture();
  const saved = await save(plan);
  const prompts: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "target-open",
    subject: "Target box",
    mode: "text_to_video",
  });
  const request = {
    input: { kind: "generate", model: "image", prompt: prompts.image.prompt },
    direction: prompts.image.direction,
    plan: {
      planId: saved.id,
      expectedVersion: 1,
      shotId: "target-open",
      stage: "first_frame",
    },
  };
  const p: any = await callTool(service, c, "generation_prepare", request);
  expect(p.plan.stage).toBe("first_frame");
  expect(p.remakeEvidence.analysisSha256).toBe(plan.remake.analysisSha256);
  await expect(
    callTool(service, c, "generation_prepare", {
      ...request,
      input: { ...request.input, model: "video" },
    }),
  ).rejects.toMatchObject({ code: "PLAN_STAGE_MISMATCH" });
});
