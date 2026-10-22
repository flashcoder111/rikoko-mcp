import { faceFreeFixturePolicy } from "./video-policy-fixture.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service, fingerprint } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { resultText } from "../packages/mcp/src/presentation.js";
import { validateWorkspace } from "../packages/core/src/production-review.js";
import { referenceShotPrompts } from "../packages/core/src/reference-prompts.js";
import { referenceAdaptSchema } from "../packages/mcp/src/reference-tools.js";
import { GatewayClient } from "../packages/cloud-client/src/gateway.js";
import { compilePrompt } from "../packages/core/src/production-prompts.js";
import { promptReferenceSyntax } from "../packages/providers/src/prompt-reference.js";
import { klingO3Models } from "../packages/providers/src/kling-o3.js";

let db: Database, service: Service, dir: string, c: any;
const network = vi.fn();
const model = {
  id: "video",
  kind: "video" as const,
  endpoint: "minimax/h3/image-to-video",
  maxCostCents: 10,
  priceVersion: "test",
  hardBoundConfirmed: true,
  parameters: { duration: 5 },
  generationInput: {
    mode: "image_to_video" as const,
    outputDurationMs: 5000,
    maxTotalBytes: 1024,
    bindings: [
      {
        field: "image_url",
        roles: ["first_frame" as const],
        kind: "image" as const,
        array: false,
        min: 1,
        max: 1,
        maxBytes: 1024,
      },
    ],
  },
};
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "production-enforcement-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider(
      [
        model,
        {
          ...model,
          id: "text-video",
          endpoint: "minimax/h3/text-to-video",
          generationInput: undefined,
          parameters: { duration: 5, aspect_ratio: "16:9" },
        },
      ],
      "fixture",
      true,
      network,
    ),
  );
  c = await service.authenticate(
    (await service.createAccount("Enforcement", 1000)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

it("rejects unprepared reference video before any provider call", async () => {
  await expect(
    service.quote(c, {
      kind: "generate",
      model: "video",
      mode: "image_to_video",
      prompt: "Close the lid",
      references: [{ role: "first_frame", assetId: "missing" }],
      videoPolicy: faceFreeFixturePolicy([{ id: "missing" }]),
      target: { width: 1280, height: 720 },
    }),
  ).rejects.toMatchObject({ code: "GENERATION_PREPARATION_REQUIRED" });
  expect(network).not.toHaveBeenCalled();
});
it("requires an explicit target for standalone video generation", async () => {
  await expect(
    service.quote(c, {
      kind: "generate",
      model: "text-video",
      prompt: "Close lid",
    }),
  ).rejects.toMatchObject({ code: "GENERATION_TARGET_REQUIRED" });
});
it("permits old clients only through explicit server configuration", async () => {
  service.allowLegacyGeneration = true;
  try {
    await expect(
      service.quote(c, {
        kind: "generate",
        model: "text-video",
        prompt: "Close lid",
      }),
    ).resolves.toHaveProperty("id");
  } finally {
    service.allowLegacyGeneration = false;
  }
  expect(network).not.toHaveBeenCalled();
});
it("blocks unprepared cloud video before uploading references or requesting a quote", async () => {
  const asset = await service.registerAsset(
    c.accountId,
    Buffer.from("synthetic frame"),
    {
      name: "fixture.png",
      kind: "image",
      mime: "image/png",
      metadata: { width: 320, height: 180 },
      provenance: { evidence: "synthetic" },
    },
  );
  const requests: string[] = [];
  const fetcher = vi.fn(async (url: any) => {
    requests.push(String(url));
    return Response.json([{ id: "video", kind: "video" }]);
  });
  const gateway = new GatewayClient(
    service,
    "https://cloud.example.com",
    "fixture",
    fetcher,
  );
  await expect(
    gateway.quote(c, {
      kind: "generate",
      model: "video",
      mode: "image_to_video",
      prompt: "Close lid",
      references: [{ role: "first_frame", assetId: asset.id }],
      videoPolicy: faceFreeFixturePolicy([asset]),
      target: { width: 1280, height: 720 },
    }),
  ).rejects.toMatchObject({ code: "GENERATION_PREPARATION_REQUIRED" });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("/v1/generation-models");
});
it("uses case-sensitive Kling labels and no synthetic labels for MiniMax's first frame", async () => {
  const d = {
    mode: "video_to_video",
    subject: "Burger",
    action: "Replace product",
    endState: { burger: "assembled" },
    references: [
      {
        assetId: "clip",
        role: "source_video",
        instruction: "Retain camera movement",
      },
      { assetId: "identity", role: "product", instruction: "Use this product" },
    ],
  };
  const syntax = promptReferenceSyntax(klingO3Models[0]);
  const draft = compilePrompt(d, syntax);
  expect(draft.bindings.map((b) => b.token)).toEqual(["@Video1", "@Image1"]);
  expect(draft.prompt).not.toMatch(/@(?:image|video)/);
  const firstFrame = compilePrompt(
    {
      ...d,
      mode: "image_to_video",
      references: [
        {
          assetId: "frame",
          role: "first_frame",
          instruction: "Keep the approved framing",
        },
      ],
    },
    promptReferenceSyntax(model),
  );
  expect(firstFrame.prompt).toContain("The first frame supplies");
  expect(firstFrame.prompt).not.toContain("@");
});
it.each(["hermes", "codex"] as const)(
  "keeps unreviewed %s previews out of automatic delivery",
  (client) => {
    const text = resultText(
      {
        jobId: "job",
        status: "completed",
        purpose: "preview",
        quality: { status: "unreviewed", finalReady: false, issues: [] },
        workspace: "http://localhost/workspace",
        media: [
          {
            assetId: "out",
            name: "out.mp4",
            mimeType: "video/mp4",
            url: "https://example.invalid/out",
            localPath: "/tmp/out.mp4",
          },
        ],
      },
      client,
    );
    expect(text).toContain("Preview —");
    expect(text).toContain("No final AI review is required");
    expect(text).not.toContain("MEDIA:");
    expect(text).not.toContain("Display in this conversation:");
    expect(text).not.toContain("deliver the video");
    expect(text).toContain("[Open workspace]");
  },
);
it("saves a default formal project and compiles structured states into readable model prose", async () => {
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: {
      title: "Burger",
      width: 1280,
      height: 720,
      shots: [
        {
          id: "close",
          action: "Lower the top bun",
          initialState: { top_bun: "separate" },
          endState: { top_bun: "on the patty" },
        },
      ],
    },
  });
  expect(saved.productionProjectId).toBeTruthy();
  const draft: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "close",
    subject: "Burger",
    mode: "text_to_video",
  });
  expect(draft.video.direction.initialState).toEqual({ top_bun: "separate" });
  expect(draft.video.prompt).toContain("The top bun is separate.");
  expect(draft.video.prompt).not.toContain('{"');
  const prepared: any = await callTool(service, c, "generation_prepare", {
    input: {
      kind: "generate",
      model: "text-video",
      prompt: draft.video.prompt,
    },
    direction: draft.video.direction,
    plan: { planId: saved.id, expectedVersion: 1, shotId: "close" },
  });
  expect(prepared.input.target).toMatchObject({ width: 1280, height: 720 });
  expect(prepared.input.production).toMatchObject({
    projectId: saved.productionProjectId,
    shotId: "close",
  });
});
it("compares state objects independently of key order while rejecting a different target state", async () => {
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: {
      title: "Assembly",
      width: 1280,
      height: 720,
      shots: [
        {
          id: "assemble",
          initialState: { top_bun: "separate", patty: "on the base" },
          action: "Lower bun",
          endState: { top_bun: "on the patty", patty: "on the base" },
        },
      ],
    },
  });
  const draft: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "assemble",
    subject: "Burger",
    mode: "text_to_video",
  });
  const request = {
    plan: { planId: saved.id, expectedVersion: 1, shotId: "assemble" },
    input: {
      kind: "generate",
      model: "text-video",
      prompt: draft.video.prompt,
    },
    direction: {
      ...draft.video.direction,
      initialState: { patty: "on the base", top_bun: "separate" },
    },
  };
  await expect(
    callTool(service, c, "generation_prepare", request),
  ).resolves.toMatchObject({ readyForSubmission: true });
  await expect(
    callTool(service, c, "generation_prepare", {
      ...request,
      direction: {
        ...request.direction,
        initialState: { patty: "missing", top_bun: "separate" },
      },
    }),
  ).rejects.toMatchObject({ code: "PLAN_DIRECTION_MISMATCH" });
});

// Isolated records test deterministic cut validation, never claim visual inspection.
function workspaceFixture(durationMs = 3600, speed = 1, sourceStartMs = 0) {
  const source = {
    id: "source",
    kind: "video",
    sha256: "source-bytes",
    metadata: { durationMs: 5000, fps: 25, width: 720, height: 1280 },
  };
  const composition = {
    width: 720,
    height: 1280,
    scenes: [
      { id: "scene", assetId: source.id, durationMs, speed, sourceStartMs },
    ],
  };
  const project = { id: "project" };
  const revision = { id: "revision", projectId: project.id, composition };
  const rendered = {
    id: "rendered",
    sha256: "rendered-bytes",
    kind: "video",
    metadata: { durationMs },
  };
  const reviews = [
    {
      id: "source-review",
      assetId: source.id,
      sourceSha256: source.sha256,
      schemaVersion: 2,
      decision: "accepted",
      createdAt: "2026-10-18",
      range: { startMs: 0, endMs: 5000 },
      actionRanges: [{ startMs: 4000, endMs: 4800, reason: "Completion" }],
    },
    {
      id: "final-review",
      assetId: rendered.id,
      sourceSha256: rendered.sha256,
      schemaVersion: 2,
      decision: "accepted",
      createdAt: "2026-10-18",
      revisionId: revision.id,
      revisionHash: fingerprint(composition),
    },
  ];
  const records: any = { source, project, revision, rendered };
  const tx: any = {
    get: async (id: string) => records[id],
    list: async (_a: string, type: string) =>
      type === "media-review" ? reviews : [],
  };
  const svc: any = {
    get: async (_c: unknown, _t: string, id: string) => records[id],
    scoped: async (_c: unknown, _p: unknown, fn: any) => fn(tx),
  };
  return { svc, records, reviews };
}
it("blocks cutting away accepted completion even if a final-cut review accepted the render", async () => {
  const { svc } = workspaceFixture();
  const result = await validateWorkspace(svc, c, "revision");
  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: "ACTION_RANGE_CUT", severity: "error" }),
  );
  expect(result.finalReady).toBe(false);
});
it("checks source time after speed changes and retains a declared settled-result margin", async () => {
  const { svc, reviews } = workspaceFixture(2500, 2);
  reviews[0].actionRanges![0] = {
    ...reviews[0].actionRanges![0],
    holdMs: 200,
  } as any;
  expect(
    (await validateWorkspace(svc, c, "revision")).issues.some(
      (i) => i.code === "ACTION_RANGE_CUT",
    ),
  ).toBe(false);
  svc.get = async (_c: unknown, _t: string, id: string) =>
    workspaceFixture(2400, 2).records[id];
  expect((await validateWorkspace(svc, c, "revision")).issues).toContainEqual(
    expect.objectContaining({ code: "ACTION_RANGE_CUT" }),
  );
});
it("allows unscoped compositions to deliver without inventing a production scope", async () => {
  const { svc } = workspaceFixture(5000);
  const result = await validateWorkspace(svc, c, "revision");
  expect(result.issues).not.toContainEqual(
    expect.objectContaining({ code: "PRODUCTION_SCOPE_REQUIRED" }),
  );
  expect(result.finalReady).toBe(true);
});
it("allows contiguous split scenes but rejects gaps or omission of the action start", async () => {
  const { svc, records } = workspaceFixture(4400);
  records.revision.composition.scenes.push({
    ...records.revision.composition.scenes[0],
    id: "split",
    sourceStartMs: 4400,
    durationMs: 600,
  });
  expect(
    (await validateWorkspace(svc, c, "revision")).issues.some(
      (i) => i.code === "ACTION_RANGE_CUT",
    ),
  ).toBe(false);
  records.revision.composition.scenes[1].sourceStartMs = 4600;
  records.revision.composition.scenes[1].durationMs = 400;
  expect(
    (await validateWorkspace(svc, c, "revision")).issues.some(
      (i) => i.code === "ACTION_RANGE_CUT",
    ),
  ).toBe(true);
  records.revision.composition.scenes = [
    {
      ...records.revision.composition.scenes[0],
      sourceStartMs: 4300,
      durationMs: 700,
    },
  ];
  expect(
    (await validateWorkspace(svc, c, "revision")).issues.some(
      (i) => i.code === "ACTION_RANGE_CUT",
    ),
  ).toBe(true);
});
