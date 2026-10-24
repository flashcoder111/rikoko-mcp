import { scopeFixture } from "./production-fixture.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "./prepared-request-fixture.js";
import { media } from "../packages/render/src/media.js";
import { workspaceResult } from "../packages/core/src/delivery.js";
import { connectServices } from "../packages/cloud-client/src/index.js";
import { createMcpServer } from "../packages/mcp/src/index.js";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
let service: Service,
  db: Database,
  dir: string,
  c: any,
  source: any,
  inspection: any;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "production-test-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider(
      [
        {
          id: "fixture-video",
          kind: "video",
          endpoint: "minimax/h3/text-to-video",
          maxCostCents: 100,
          priceVersion: "fixture",
          hardBoundConfirmed: true,
          parameters: { duration: 5, aspect_ratio: "16:9" },
          allowedParameters: {
            duration: { type: "integer", min: 5, max: 15 },
            aspect_ratio: { type: "enum", values: ["16:9", "9:16"] },
          },
        },
      ],
      "fixture-key",
      true,
    ),
  );
  c = await service.authenticate(
    (await service.createAccount("Production", 1000)).key,
  );
  const path = join(dir, "motion.mp4");
  await promisify(execFile)("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=10:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
  source = await service.registerAsset(c.accountId, await readFile(path), {
    name: "moving.mp4",
    kind: "video",
    mime: "video/mp4",
    metadata: (await media({ command: "probe", path })).metadata,
    provenance: { evidence: "local-real" },
  });
}, 30000);
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
it("returns real frame pixels with hash-bound evidence and cross-checks a false static claim", async () => {
  inspection = (await callTool(service, c, "media_inspect", {
    assetId: source.id,
    claimedStatic: true,
  })) as any;
  expect(inspection.frames).toHaveLength(3);
  expect(
    Buffer.from(inspection.frames[0].image.data, "base64")
      .subarray(1, 4)
      .toString(),
  ).toBe("PNG");
  expect(inspection.sourceSha256).toBe(source.sha256);
  expect(inspection.sampling.continuous).toBe(false);
  expect(inspection.sampling.timeBasis).toBe("requested");
  expect(inspection.frames[0].requestedTimeMs).toBe(0);
  expect(inspection.warnings[0].code).toBe("STATIC_CLAIM_CONTRADICTED");
  const stranger = await service.authenticate(
    (await service.createAccount("Other", 100)).key,
  );
  await expect(
    callTool(service, stranger, "media_inspect", { assetId: source.id }),
  ).rejects.toThrow();
  await expect(
    callTool(service, c, "media_inspect", { assetId: source.id, endMs: 3000 }),
  ).rejects.toThrow();
}, 30000);
it("sends image blocks over MCP without duplicating base64 in structured text", async () => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer(async () => inspection);
  const client = new Client({ name: "test", version: "1" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result: any = await client.callTool({
      name: "media_inspect",
      arguments: { assetId: source.id },
    });
    expect(result.content.filter((c: any) => c.type === "image")).toHaveLength(
      3,
    );
    expect(result.content[0].text).not.toContain(
      inspection.frames[0].image.data,
    );
    expect(result.structuredContent.result.frames[0].image).toBeUndefined();
  } finally {
    await client.close();
    await server.close();
  }
});
it("samples requested event timestamps and keeps their order in native MCP image results", async () => {
  const timesMs = [0, 200, 400, 650, 900, 1100, 1350, 1600, 1850, 1900];
  const evidence: any = await callTool(service, c, "media_inspect", {
    assetId: source.id,
    timesMs,
  });
  expect(evidence.frames.map((f: any) => f.requestedTimeMs)).toEqual(timesMs);
  expect(evidence.sampling.maxSampleGapMs).toBe(250);
  const accepted: any = await callTool(service, c, "media_review", {
    assetId: source.id,
    inspectionIds: [evidence.id],
    decision: "accepted",
    reviewer: "host_agent",
    checks: {
      actionComplete: { status: "pass" },
      framing: true,
      continuity: true,
      noArtifacts: true,
    },
    actionRanges: [
      {
        startMs: 0,
        endMs: 2000,
        holdMs: 0,
        reason: "Exercise sampled evidence coverage on a synthetic chart",
      },
    ],
    notes:
      "Test fixture only; this is not an assessment of product action quality.",
  });
  expect(accepted.coverage.continuous).toBe(false);
  // Do not leave standalone acceptance for tests of initially unreviewed media.
  await service.scoped(c, "write", (tx) =>
    tx.query("DELETE FROM entities WHERE id=$1", [accepted.id]),
  );
});
it("rejects unordered, duplicate and out-of-range event timestamps", async () => {
  for (const timesMs of [[500, 100], [100, 100], [-1], [2000]]) {
    await expect(
      callTool(service, c, "media_inspect", { assetId: source.id, timesMs }),
    ).rejects.toThrow();
  }
  await expect(
    callTool(service, c, "media_inspect", {
      assetId: source.id,
      startMs: 500,
      timesMs: [200, 600],
    }),
  ).rejects.toMatchObject({ code: "INVALID_INTERVAL" });
  await expect(
    callTool(service, c, "media_inspect", {
      assetId: source.id,
      timesMs: [100, 200],
      count: 3,
    }),
  ).rejects.toThrow();
});
it("delivers without inspection and keeps optional acceptance bound to its revision", async () => {
  const project = await service.createProject(c, {
    title: "Review",
    brief: "fixture",
  });
  const revision = await service.addRevision(c, project.id, {
    schemaVersion: 1,
    title: "Review",
    width: 180,
    height: 320,
    scenes: [
      {
        id: "s",
        productionShotId: "s",
        assetId: source.id,
        durationMs: 500,
        fit: "cover",
      },
    ],
  });
  const job = {
    id: "rendered-fixture",
    type: "job",
    accountId: c.accountId,
    createdAt: new Date().toISOString(),
    status: "completed",
    revisionId: revision.id,
    outputs: [source.id],
  };
  await service.scoped(c, "write", (tx) => tx.put(job));
  const validation: any = await callTool(service, c, "workspace_validate", {
    revisionId: revision.id,
  });
  expect(validation.scenes[0].croppedFraction).toBeCloseTo(0.6836, 3);
  expect(validation.scenes[0].discardedTailMs).toBe(1500);
  expect(
    (await workspaceResult(service, c, job.id, "final")).quality,
  ).toMatchObject({ finalReady: true, reviewAccepted: false });
  const review = {
    assetId: source.id,
    revisionId: revision.id,
    inspectionIds: [inspection.id],
    decision: "accepted",
    reviewer: "host_agent",
    checks: {
      actionComplete: {
        status: "not_applicable",
        reason: "Synthetic motion chart has no narrative action to complete",
      },
      framing: true,
      continuity: true,
      noArtifacts: true,
    },
    notes: "Fixture pixels inspected; no semantic product claim.",
  };
  await expect(
    callTool(service, c, "media_review", {
      ...review,
      inspectionIds: ["missing"],
    }),
  ).rejects.toThrow();
  await callTool(service, c, "media_review", {
    ...review,
    revisionId: undefined,
  });
  await scopeFixture(service, c, project.id, source.id, 180, 320, "s");
  await callTool(service, c, "media_review", review);
  expect(
    (await workspaceResult(service, c, job.id, "final")).quality?.finalReady,
  ).toBe(true);
  const next = await service.addRevision(c, project.id, {
    ...revision.composition,
    title: "Changed",
  });
  expect(
    (
      (await callTool(service, c, "workspace_validate", {
        revisionId: next.id,
      })) as any
    ).status,
  ).toBe("unreviewed");
  const placeholder = await service.addRevision(c, project.id, {
    ...revision.composition,
    scenes: [{ id: "p", durationMs: 500 }],
  });
  expect(
    (
      (await callTool(service, c, "workspace_validate", {
        revisionId: placeholder.id,
      })) as any
    ).issues[0].code,
  ).toBe("PLACEHOLDER_SCENE");
  const graphic = await service.addRevision(c, project.id, {
    ...revision.composition,
    scenes: [{ id: "p", durationMs: 500, visualKind: "graphic" }],
  });
  expect(
    (
      (await callTool(service, c, "workspace_validate", {
        revisionId: graphic.id,
      })) as any
    ).issues.filter((i: any) => i.code === "PLACEHOLDER_SCENE"),
  ).toEqual([]);
});
it("supports a sampled grid and re-usable image frames", async () => {
  const grid: any = await callTool(service, c, "media_inspect", {
    assetId: source.id,
    layout: "grid",
    count: 4,
  });
  expect(grid.grid.data).toBeTruthy();
  const frame = await service.get(c, "asset", grid.frames[0].assetId);
  expect(frame.metadata.width).toBeGreaterThan(0);
  const still: any = await callTool(service, c, "media_inspect", {
    assetId: frame.id,
  });
  expect(still.frames).toHaveLength(1);
}, 30000);
it("preflights exact dynamic output parameters and rejects mismatched aspect without a provider call", async () => {
  const input = {
    kind: "generate",
    model: "fixture-video",
    prompt: "Close a lid completely",
    parameters: { duration: 8, aspect_ratio: "9:16" },
    target: { width: 720, height: 1280 },
  };
  const prepared: any = await callTool(service, c, "generation_prepare", {
    input,
    promptOverride: {
      reason: "Exercise target parameter validation with a handwritten fixture",
    },
  });
  expect(prepared.input.parameters).toEqual(input.parameters);
  expect(prepared.expectedOutput.durationMs).toBe(8000);
  expect(prepared.generated).toBe(false);
  expect((await service.usage(c)).reservedCents).toBe(0);
  await expect(
    callTool(service, c, "generation_prepare", {
      input: { ...input, parameters: { aspect_ratio: "16:9" } },
      promptOverride: { reason: "Exercise target aspect rejection" },
    }),
  ).rejects.toMatchObject({ code: "GENERATION_ASPECT_MISMATCH" });
  await expect(
    callTool(service, c, "generation_prepare", {
      input: { ...input, parameters: { aspect_ratio: "16:9" } },
      promptOverride: { reason: "Check incompatible aspect" },
    }),
  ).rejects.toMatchObject({ code: "GENERATION_ASPECT_MISMATCH" });
  const contained: any = await callTool(service, c, "generation_prepare", {
    promptOverride: { reason: "Exercise explicit contain adaptation" },
    input: {
      ...input,
      parameters: {},
      target: { ...input.target, aspectPolicy: "contain" },
    },
  });
  expect(contained.expectedOutput.warnings).toHaveLength(1);
  await expect(
    callTool(service, c, "generation_prepare", {
      input: { ...input, target: { ...input.target, minDurationMs: 9000 } },
      promptOverride: { reason: "Exercise minimum duration rejection" },
    }),
  ).rejects.toMatchObject({ code: "GENERATION_TOO_SHORT" });
});
it("saves independently authored plans and binds both prompt stages to target state and version", async () => {
  const plan = {
    title: "Device",
    width: 720,
    height: 1280,
    shots: [
      {
        id: "target-one",
        initialState: { lid: "open" },
        action: "Close the lid",
        endState: { lid: "closed" },
      },
    ],
  };
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan,
  });
  expect(saved.plan.shots[0].sourceShotIds).toEqual([]);
  expect(
    (
      (await callTool(service, c, "record_get", {
        type: "production-plan",
        id: saved.id,
      })) as any
    ).version,
  ).toBe(1);
  const prompts: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "target-one",
    subject: "Blue device",
    mode: "text_to_video",
  });
  expect(prompts.video.prompt).toContain("The lid is closed.");
  expect(prompts.image.prompt).toContain(
    "Required final state: The lid is open.",
  );
  await expect(
    callTool(service, c, "production_shot_prompts", {
      planId: saved.id,
      expectedVersion: 2,
      shotId: "target-one",
      subject: "Device",
      mode: "text_to_video",
    }),
  ).rejects.toMatchObject({ code: "PLAN_CONFLICT" });
  await expect(
    callTool(service, c, "production_plan_save", {
      plan,
      planId: saved.id,
      expectedVersion: 2,
    }),
  ).rejects.toThrow();
  expect(
    (
      (await callTool(service, c, "production_plan_save", {
        plan,
        planId: saved.id,
        expectedVersion: 1,
      })) as any
    ).version,
  ).toBe(2);
});
it("tracks standalone visual acceptance and a later rejection without confusing job completion with success", async () => {
  await callTool(service, c, "media_review", {
    assetId: source.id,
    inspectionIds: [],
    decision: "unreviewed",
    reviewer: "host_agent",
    checks: Object.fromEntries(
      ["actionComplete", "framing", "continuity", "noArtifacts"].map((k) => [
        k,
        { status: "unknown", reason: "Reset standalone fixture" },
      ]),
    ),
    notes: "Fresh review test",
  });
  const job = {
    id: "generated-fixture",
    type: "job",
    accountId: c.accountId,
    createdAt: new Date().toISOString(),
    status: "completed",
    outputs: [source.id],
  };
  await service.scoped(c, "write", (tx) => tx.put(job));
  expect(
    (await workspaceResult(service, c, job.id)).mediaAcceptance?.status,
  ).toBe("unreviewed");
  await expect(
    workspaceResult(service, c, job.id, "final"),
  ).resolves.toMatchObject({
    mediaAcceptance: { finalReady: true, reviewAccepted: false },
  });
  const review = {
    assetId: source.id,
    inspectionIds: [inspection.id],
    decision: "accepted",
    reviewer: "host_agent",
    checks: {
      actionComplete: {
        status: "not_applicable",
        reason: "Synthetic motion chart has no narrative action to complete",
      },
      framing: true,
      continuity: true,
      noArtifacts: true,
    },
    notes: "Inspected sampled fixture pixels",
  };
  await expect(
    callTool(service, c, "media_review", {
      ...review,
      checks: { ...review.checks, framing: false },
    }),
  ).rejects.toMatchObject({ code: "REVIEW_FAILED" });
  const partial: any = await callTool(service, c, "media_inspect", {
    assetId: source.id,
    endMs: 400,
    count: 1,
  });
  await expect(
    callTool(service, c, "media_review", {
      ...review,
      inspectionIds: [partial.id],
    }),
  ).rejects.toMatchObject({ code: "INSPECTION_COVERAGE_REQUIRED" });
  await callTool(service, c, "media_review", review);
  expect(
    (await workspaceResult(service, c, job.id, "final")).mediaAcceptance
      ?.finalReady,
  ).toBe(true);
  await callTool(service, c, "media_review", {
    ...review,
    decision: "needs_changes",
    notes: "A newly noticed defect needs correction",
  });
  expect(
    (await workspaceResult(service, c, job.id)).mediaAcceptance?.status,
  ).toBe("needs_changes");
});
it("compiles owned product references from the saved plan and flags invalid plans without saving", async () => {
  const reference = {
    assetId: inspection.frames[0].assetId,
    role: "product",
    instruction: "Keep device shape",
  };
  const shot = {
    id: "product",
    initialState: { lid: "open" },
    action: "Close lid",
    endState: { lid: "closed" },
    references: [reference],
  };
  const plan = { title: "Referenced", width: 720, height: 1280, shots: [shot] };
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan,
  });
  const result: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "product",
    subject: "Device",
    mode: "reference_to_video",
  });
  expect(result.image.bindings[0].token).toBe("Image 1");
  expect(result.video.prompt).toContain("Keep device shape");
  const preview: any = await callTool(service, c, "generation_prompt_preview", {
    mode: "text_to_video",
    subject: "Device",
    action: "Close",
    endState: "Closed",
  });
  expect(preview.templateVersion).toBe("rikoko-direction-v2");
  const invalid = { ...plan, shots: [shot, { ...shot, id: "next" }] };
  expect(
    ((await callTool(service, c, "production_plan_validate", invalid)) as any)
      .valid,
  ).toBe(false);
  await expect(
    callTool(service, c, "production_plan_save", { plan: invalid }),
  ).rejects.toThrow();
});
it("rejects older cloud preparation protocols without uploading or generating", async () => {
  const paths: string[] = [];
  connectServices(
    service,
    { gatewayOrigin: "https://cloud.example.com", gatewayKey: "fixture" },
    async (url) => {
      paths.push(new URL(String(url)).pathname);
      return Response.json([]);
    },
  );
  try {
    await expect(
      callTool(service, c, "generation_prepare", {
        input: { kind: "generate", model: "old-cloud", prompt: "A box" },
        promptOverride: { reason: "Manual test" },
      }),
    ).rejects.toMatchObject({ code: "PREPARATION_PROTOCOL_UNSUPPORTED" });
    expect(paths).toEqual(["/v1/generation-protocol"]);
  } finally {
    connectServices(service, {});
  }
});
