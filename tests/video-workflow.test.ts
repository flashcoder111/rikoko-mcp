import { remakeFixture } from "./video-workflow-fixture.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";

let db: Database, service: Service, c: any, dir: string;
const network = vi.fn();
const direction = {
  mode: "text_to_video",
  subject: "Two dancers",
  action: "Dance together",
  endState: "Both stop",
};
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "video-workflow-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider(
      [
        {
          id: "video",
          kind: "video",
          endpoint: "minimax/h3/text-to-video",
          maxCostCents: 10,
          priceVersion: "test",
          hardBoundConfirmed: true,
          parameters: { duration: 5, aspect_ratio: "16:9" },
        },
        {
          id: "reference-video",
          kind: "video",
          endpoint: "minimax/h3/reference-to-video",
          maxCostCents: 10,
          priceVersion: "test",
          hardBoundConfirmed: true,
          parameters: { duration: 5, aspect_ratio: "16:9" },
          generationInput: {
            mode: "reference_to_video",
            referenceSyntax: "descriptive",
            maxTotalBytes: 10000000,
            outputDurationMs: 5000,
            bindings: [
              {
                field: "reference_video_urls",
                roles: ["motion"],
                kind: "video",
                array: true,
                min: 1,
                max: 1,
                maxBytes: 10000000,
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
    (await service.createAccount("workflow", 1000)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
async function input() {
  const preview: any = await callTool(
    service,
    c,
    "generation_prompt_preview",
    direction,
  );
  return {
    kind: "generate",
    model: "video",
    prompt: preview.prompt,
    target: { width: 1280, height: 720 },
  };
}
it("can prepare video without a separate saved request", async () => {
  await expect(
    callTool(service, c, "generation_prepare", {
      input: await input(),
      direction,
    }),
  ).resolves.toBeDefined();
  expect(network).not.toHaveBeenCalled();
});
it("can quote and submit a text-only video without a preparation", async () => {
  await expect(service.quote(c, (await input()) as any)).resolves.toBeDefined();
  expect(network).not.toHaveBeenCalled();
});
it("allows a source attachment in an optional plan without mandatory analysis", async () => {
  const source = await service.registerAsset(
    c.accountId,
    Buffer.from("original dance"),
    {
      kind: "video",
      name: "dance.mp4",
      mime: "video/mp4",
      metadata: { durationMs: 5000, hasAudio: false },
      provenance: { evidence: "fixture" },
    },
  );
  const request: any = await callTool(service, c, "workspace_request_save", {
    message: "Recreate this dance with two new people",
    assetIds: [source.id],
  });
  await expect(
    callTool(service, c, "production_plan_save", {
      request: {
        requestId: request.requestId,
        expectedVersion: request.requestVersion,
      },
      plan: {
        title: "Dance",
        width: 1280,
        height: 720,
        shots: [
          {
            id: "dance",
            initialState: { pose: "Standing" },
            action: "Dance",
            endState: { pose: "Stop" },
            references: [
              {
                assetId: source.id,
                role: "motion",
                transfer: "action",
                usage: "analysis_only",
                instruction: "Original dance",
              },
            ],
          },
        ],
      },
    }),
  ).resolves.toBeDefined();
  expect(network).not.toHaveBeenCalled();
});

async function sourcePlan(options: { trusted?: boolean } = {}) {
  const f = await remakeFixture(service, c, options);
  const request: any = await callTool(service, c, "workspace_request_save", {
    message: "Recreate the original movement, change the character only",
    assetIds: [f.source.id],
  });
  const ref = {
    assetId: f.source.id,
    role: "motion",
    transfer: "action",
    instruction: "Preserve the original movement",
  };
  f.plan.shots[0].references = [ref];
  f.plan.shots[0].sourceVideo = { strategy: "reference", assetId: f.source.id };
  f.plan.shots[0].referenceChoice = {
    strategy: "motion_reference",
    reason: "Keep the original action",
  };
  return { ...f, request, ref };
}
async function prepareSource(f: any) {
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: f.plan,
    request: { requestId: f.request.requestId, expectedVersion: 1 },
  });
  const preview: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: saved.version,
    shotId: "target-open",
    subject: "A box",
    mode: "reference_to_video",
  });
  return callTool(service, c, "generation_prepare", {
    plan: {
      planId: saved.id,
      expectedVersion: saved.version,
      shotId: "target-open",
    },
    direction: preview.video.direction,
    input: {
      kind: "generate",
      model: "reference-video",
      mode: "reference_to_video",
      prompt: preview.video.prompt,
      references: [{ assetId: f.source.id, role: "motion" }],
      videoPolicy: {
        faces: "absent",
        reason: "Box fixture",
        references: [
          {
            assetId: f.source.id,
            sha256: f.source.sha256,
            faces: "absent",
            reason: "Box fixture",
          },
        ],
      },
    },
  }) as Promise<any>;
}
it("keeps ordinary original video creation usable with an explicit saved brief", async () => {
  const request: any = await callTool(service, c, "workspace_request_save", {
    message: "Two dancers dance then stop",
  });
  const prepared: any = await callTool(service, c, "generation_prepare", {
    input: await input(),
    direction,
    request: { requestId: request.requestId, expectedVersion: 1 },
  });
  const quote = await service.quote(c, prepared.input);
  expect(quote.preparedRequestId).toBe(prepared.id);
  const trace: any = await callTool(service, c, "generation_trace_get", {
    id: prepared.id,
  });
  expect(trace.stages.request.originalMessage).toBe(
    "Two dancers dance then stop",
  );
  expect(trace.stages.analysis).toBeNull();
});
it("keeps a source request snapshot without requiring paid analysis for a separate text generation", async () => {
  const f = await sourcePlan();
  await expect(
    callTool(service, c, "generation_prepare", {
      input: await input(),
      direction,
      request: { requestId: f.request.requestId, expectedVersion: 1 },
    }),
  ).resolves.toBeDefined();
});
it("requires real completed analysis, not an uploaded JSON claim", async () => {
  const f = await sourcePlan({ trusted: false });
  await expect(prepareSource(f)).rejects.toMatchObject({
    code: "ANALYSIS_PROVENANCE_REQUIRED",
  });
});
it("rejects analysis-only and reconstruction routes without delivered source video", async () => {
  const f = await sourcePlan();
  delete f.plan.shots[0].referenceChoice;
  f.plan.shots[0].references[0].usage = "analysis_only";
  f.plan.shots[0].sourceVideo = {
    strategy: "reconstruct",
    reason: "Host tries to omit source",
  };
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: f.plan,
    request: { requestId: f.request.requestId, expectedVersion: 1 },
  });
  const preview: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "target-open",
    subject: "Box",
    mode: "text_to_video",
  });
  await expect(
    callTool(service, c, "generation_prepare", {
      input: { ...(await input()), prompt: preview.video.prompt },
      direction: preview.video.direction,
      plan: { planId: saved.id, expectedVersion: 1, shotId: "target-open" },
    }),
  ).rejects.toMatchObject({ code: "SOURCE_VIDEO_REFERENCE_REQUIRED" });
});
it("preserves the source, analysis, host plan and final provider bindings as separate trace stages", async () => {
  const f = await sourcePlan();
  const prepared = await prepareSource(f);
  const trace: any = await callTool(service, c, "generation_trace_get", {
    id: prepared.id,
  });
  expect(trace.stages.analysis.report.summary).toBe(f.report.summary);
  expect(trace.stages.planning.content.shots[0].action).toBe("Open the lid");
  expect(trace.stages.delivery.references[0]).toMatchObject({
    kind: "video",
    sha256: f.source.sha256,
    field: "reference_video_urls",
  });
  const quote = await service.quote(c, prepared.input);
  expect(quote.preparedRequestId).toBe(prepared.id);
  await callTool(service, c, "workspace_request_save", {
    requestId: f.request.requestId,
    requestVersion: 1,
    message: "Change the ending",
  });
  await expect(service.quote(c, prepared.input)).rejects.toMatchObject({
    code: "REQUEST_CONFLICT",
  });
  expect(
    (await callTool(service, c, "generation_trace_get", { id: prepared.id }))
      .stages.request.version,
  ).toBe(1);
  expect(network).not.toHaveBeenCalled();
});
it("optional preparations keep owned traces without spending", async () => {
  const prepared: any = await callTool(service, c, "generation_prepare", { input: await input(), direction });
  const trace: any = await callTool(service, c, "generation_trace_get", { id: prepared.id });
  expect(trace.stages.request).toBeNull();
  const other = await service.authenticate((await service.createAccount("other", 100)).key);
  await expect(callTool(service, other, "generation_trace_get", { id: prepared.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(network).not.toHaveBeenCalled();
});

it("cloud verifies actual analysis jobs, uploads the source and invalidates stale mirrored requests", async () => {
  const {
    syncCloudProductionContext,
    prepareCloudGeneration,
    bindCloudPreparation,
    referenceDeclaration,
    cloudPreparationProtocol,
  } = await import("../packages/core/src/cloud-preparation.js");
  const { videoRequestSnapshot } =
    await import("../packages/core/src/video-workflow.js");
  const { fingerprint } = await import("../packages/core/src/index.js");
  const f = await sourcePlan();
  const local = await prepareSource(f);
  const rdb = await Database.open();
  const remote = new Service(
    rdb,
    new LocalStorage(join(dir, "cloud")),
    service.provider,
  );
  const rc = await remote.authenticate(
    (await remote.createAccount("cloud", 1000)).key,
  );
  try {
    const snapshot = await db.transaction((tx) =>
      videoRequestSnapshot(tx, c.accountId, {
        requestId: f.request.requestId,
        expectedVersion: 1,
      }),
    );
    const context = {
      protocol: cloudPreparationProtocol,
      clientId: "a".repeat(64),
      version: 1,
    };
    const req = await syncCloudProductionContext(remote, rc, {
      ...context,
      localId: f.request.requestId,
      kind: "request",
      request: snapshot,
    });
    const plan = await syncCloudProductionContext(remote, rc, {
      ...context,
      localId: local.plan.planId,
      kind: "plan",
      plan: local.workflow.plan.content,
      remakeEvidence: local.remakeEvidence,
    });
    await expect(
      syncCloudProductionContext(remote, rc, {
        ...context,
        localId: "invalid-shot-evidence",
        kind: "plan",
        plan: {
          ...local.workflow.plan.content,
          remake: {
            ...local.workflow.plan.content.remake,
            requirements: local.workflow.plan.content.remake.requirements.map(
              (r: any) => ({ ...r, sourceShotIds: ["invented-shot"] }),
            ),
          },
          shots: local.workflow.plan.content.shots.map((s: any) => ({
            ...s,
            sourceShotIds: ["invented-shot"],
          })),
        },
        remakeEvidence: local.remakeEvidence,
      }),
    ).rejects.toMatchObject({ code: "REMAKE_EVIDENCE_INVALID" });
    const { preparedRequestId, production, ...operation } = local.input;
    const raw = {
      protocol: cloudPreparationProtocol,
      request: {
        input: operation,
        direction: local.prompt.direction,
        plan: { planId: plan.id, expectedVersion: 1, shotId: "target-open" },
        request: { requestId: req.id, expectedVersion: 1 },
      },
      references: [referenceDeclaration(f.source)],
    };
    await expect(prepareCloudGeneration(remote, rc, raw)).rejects.toMatchObject(
      { code: "ANALYSIS_PROVENANCE_REQUIRED" },
    );
    const uploaded = await remote.registerAsset(
      rc.accountId,
      await service.storage.read(f.source.storageKey),
      {
        name: "source.mp4",
        kind: "video",
        mime: "video/mp4",
        metadata: f.source.metadata,
        provenance: { evidence: "fixture-upload" },
      },
    );
    const remoteReport = structuredClone(f.report);
    remoteReport.source = {
      ...remoteReport.source,
      assetId: uploaded.id,
      durationMs: f.report.source.durationMs + 1,
    };
    remoteReport.coverage.endMs += 1;
    for (const item of [
      ...remoteReport.shots,
      ...remoteReport.narrativeBeats,
      ...remoteReport.evidence,
    ]) {
      if (item.endMs === f.report.source.durationMs) item.endMs += 1;
    }
    const cloudAnalysisJob = {
      id: f.report.provenance.jobId,
      type: "job",
      accountId: rc.accountId,
      createdAt: new Date().toISOString(),
      status: "completed",
      input: {
        kind: "reference_analyze",
        assetId: uploaded.id,
        model: f.report.provenance.model,
      },
      analysis: remoteReport,
      outputs: [],
    };
    await rdb.transaction((tx) =>
      tx.put({
        ...cloudAnalysisJob,
        analysis: { ...remoteReport, summary: "altered evidence" },
      }),
    );
    await expect(prepareCloudGeneration(remote, rc, raw)).rejects.toMatchObject(
      { code: "ANALYSIS_PROVENANCE_REQUIRED" },
    );
    await rdb.transaction((tx) => tx.put(cloudAnalysisJob));
    const draft: any = await prepareCloudGeneration(remote, rc, raw);
    const bound: any = await bindCloudPreparation(remote, rc, draft.id, {
      requestHash: draft.requestHash,
      references: [{ sourceAssetId: f.source.id, assetId: uploaded.id }],
    });
    expect(bound.input.references).toEqual([
      { assetId: uploaded.id, role: "motion" },
    ]);
    await expect(remote.quote(rc, bound.input)).resolves.toHaveProperty("id");
    const trace: any = await callTool(remote, rc, "generation_trace_get", {
      id: bound.id,
    });
    expect(trace.stages.delivery.references[0].sha256).toBe(f.source.sha256);
    expect(trace.stages.analysis.report.summary).toBe(f.report.summary);
    const forgedEvidence = {
      ...local.remakeEvidence,
      sourceExcerpts: [
        {
          assetId: f.source.id,
          sha256: "b".repeat(64),
          sourceSha256: f.source.sha256,
          startMs: 0,
          endMs: 2000,
        },
      ],
    };
    const forged = await syncCloudProductionContext(remote, rc, {
      ...context,
      localId: "forged-excerpt",
      kind: "plan",
      plan: local.workflow.plan.content,
      remakeEvidence: forgedEvidence,
    });
    const forgedRaw = {
      ...raw,
      request: {
        ...raw.request,
        plan: { ...raw.request.plan, planId: forged.id },
        input: {
          ...operation,
          videoPolicy: {
            ...operation.videoPolicy,
            references: operation.videoPolicy.references.map((r: any) => ({
              ...r,
              sha256: "b".repeat(64),
            })),
          },
        },
      },
      references: [
        { ...referenceDeclaration(f.source), sha256: "b".repeat(64) },
      ],
    };
    await expect(
      prepareCloudGeneration(remote, rc, forgedRaw),
    ).rejects.toMatchObject({ code: "SOURCE_EXCERPT_PROVENANCE_REQUIRED" });
    await expect(
      syncCloudProductionContext(remote, rc, {
        ...context,
        localId: f.request.requestId,
        kind: "request",
        version: 2,
        request: { ...snapshot, version: 2, assets: [] },
      }),
    ).rejects.toMatchObject({ code: "REQUEST_ASSET_CHANGED" });
    await syncCloudProductionContext(remote, rc, {
      ...context,
      localId: f.request.requestId,
      kind: "request",
      version: 2,
      request: {
        ...snapshot,
        version: 2,
        turns: [
          ...snapshot.turns,
          { message: "Change the ending", assetIds: [] },
        ],
      },
    });
    await expect(remote.quote(rc, bound.input)).rejects.toMatchObject({
      code: "REQUEST_CONFLICT",
    });
    expect(fingerprint(bound.workflow.request)).toBe(fingerprint(snapshot));
    expect(network).not.toHaveBeenCalled();
  } finally {
    await rdb.close();
  }
});

it("direct generation is independent of the deprecated legacy switch", async () => {
  service.allowLegacyGeneration = true;
  try {
    await expect(
      service.quote(c, (await input()) as any),
    ).resolves.toBeDefined();
  } finally {
    service.allowLegacyGeneration = false;
  }
});
it("rejects a genuine source excerpt that omits the selected action interval", async () => {
  const f = await sourcePlan();
  const excerpt = await service.registerAsset(
    c.accountId,
    Buffer.from("too short source excerpt"),
    {
      kind: "video",
      name: "excerpt.mp4",
      mime: "video/mp4",
      metadata: { durationMs: 1000 },
      provenance: {},
    },
  );
  await service.scoped(c, "write", (tx) =>
    tx.put({
      id: "source-excerpt-" + excerpt.id,
      type: "source-excerpt",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      assetId: excerpt.id,
      sha256: excerpt.sha256,
      sourceAssetId: f.source.id,
      sourceSha256: f.source.sha256,
      startMs: 0,
      endMs: 1000,
    }),
  );
  f.plan.shots[0].references = [{ ...f.ref, assetId: excerpt.id }];
  f.plan.shots[0].sourceVideo = { strategy: "reference", assetId: excerpt.id };
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: f.plan,
  });
  const preview: any = await callTool(service, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: 1,
    shotId: "target-open",
    subject: "A box",
    mode: "reference_to_video",
  });
  await expect(
    callTool(service, c, "generation_prepare", {
      request: { requestId: f.request.requestId, expectedVersion: 1 },
      plan: { planId: saved.id, expectedVersion: 1, shotId: "target-open" },
      direction: preview.video.direction,
      input: {
        kind: "generate",
        model: "reference-video",
        mode: "reference_to_video",
        prompt: preview.video.prompt,
        references: [{ assetId: excerpt.id, role: "motion" }],
        videoPolicy: {
          faces: "absent",
          reason: "Fixture",
          references: [
            {
              assetId: excerpt.id,
              sha256: excerpt.sha256,
              faces: "absent",
              reason: "Fixture",
            },
          ],
        },
      },
    }),
  ).rejects.toMatchObject({ code: "SOURCE_VIDEO_REFERENCE_REQUIRED" });
});
it("reports missing historical evidence instead of hiding legacy jobs", async () => {
  await service.scoped(c, "write", (tx) =>
    tx.put({
      id: "legacy-job",
      type: "job",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      status: "completed",
      input: {
        kind: "generate",
        model: "video",
        prompt: "Historical invented action",
      },
      outputs: [],
    }),
  );
  const trace: any = await callTool(service, c, "generation_trace_get", {
    id: "legacy-job",
  });
  expect(trace.evidenceComplete).toBe(false);
  expect(trace.stages.request).toBeNull();
  expect(trace.stages.analysis).toBeNull();
  expect(trace.stages.delivery.providerPrompt).toBe(
    "Historical invented action",
  );
  expect(trace.stages.execution[0].jobId).toBe("legacy-job");
});
it("does not invalidate a prepared shot when another excerpt is extracted later", async () => {
  const f = await sourcePlan();
  const prepared = await prepareSource(f);
  await service.scoped(c, "write", (tx) =>
    tx.put({
      id: "source-excerpt-extra-" + f.source.id,
      type: "source-excerpt",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      assetId: "extra-" + f.source.id,
      sha256: "c".repeat(64),
      sourceAssetId: f.source.id,
      sourceSha256: f.source.sha256,
      startMs: 0,
      endMs: 1000,
    }),
  );
  await expect(service.quote(c, prepared.input)).resolves.toHaveProperty("id");
});
