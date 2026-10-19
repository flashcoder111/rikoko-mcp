import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { validateWorkspace } from "../packages/core/src/production-review.js";
let db: Database, service: Service, c: any, dir: string;
const direction = {
  mode: "text_to_image",
  subject: "A box",
  action: "Show the closed lid",
  initialState: '{"lid":"closed"}',
  endState: '{"lid":"closed"}',
};
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "scope-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider(
      [
        {
          id: "fixture",
          kind: "image",
          endpoint: "fixture/image",
          maxCostCents: 5,
          priceVersion: "1",
          hardBoundConfirmed: true,
          parameters: { aspect_ratio: "16:9" },
        },
      ],
      "test",
      true,
    ),
  );
  c = await service.authenticate(
    (await service.createAccount("Scope", 1000)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
async function setup(external = false) {
  const plan: any = await callTool(service, c, "production_plan_save", {
    plan: {
      title: "Box",
      width: 320,
      height: 180,
      shots: [
        {
          id: "shot",
          initialState: { lid: "closed" },
          action: direction.action,
          endState: { lid: "closed" },
        },
      ],
    },
  });
  const project = await service.createProject(c, {
    title: "Project",
    brief: "Formal",
  });
  await callTool(service, c, "production_scope_save", {
    projectId: project.id,
    planId: plan.id,
    expectedPlanVersion: 1,
    expectedScopeVersion: 0,
    requirements: {
      allowedAssetUses: external
        ? ["prepared_generation", "external"]
        : ["prepared_generation"],
    },
  });
  const prompt: any = await callTool(
    service,
    c,
    "generation_prompt_preview",
    direction,
  );
  const request = {
    input: {
      kind: "generate",
      model: "fixture",
      prompt: prompt.prompt,
      production: { projectId: project.id, scopeVersion: 1, shotId: "shot" },
    },
    plan: { planId: plan.id, expectedVersion: 1, shotId: "shot" },
    direction,
  };
  const p: any = await callTool(service, c, "generation_prepare", request);
  return { plan, project, p, request };
}
async function asset() {
  const a = await service.registerAsset(
    c.accountId,
    Buffer.from(randomUUID()),
    {
      name: "fixture.png",
      kind: "image",
      mime: "image/png",
      metadata: { width: 320, height: 180 },
      provenance: { evidence: "contract-fixture" },
    },
  );
  const evidence = {
    id: randomUUID(),
    type: "media-inspection",
    accountId: c.accountId,
    createdAt: new Date().toISOString(),
    assetId: a.id,
    sourceSha256: a.sha256,
    range: { startMs: 0, endMs: 1 },
    frames: [{ sourceTimeMs: 0, requestedTimeMs: 0 }],
  };
  await service.scoped(c, "write", (tx) => tx.put(evidence));
  return { a, evidence };
}
async function accept(a: any, evidence: any, revisionId?: string) {
  return callTool(service, c, "media_review", {
    assetId: a.id,
    inspectionIds: [evidence.id],
    decision: "accepted",
    reviewer: "host_agent",
    checks: {
      actionComplete: { status: "not_applicable", reason: "Still frame" },
      framing: { status: "pass" },
      continuity: { status: "pass" },
      noArtifacts: { status: "pass" },
    },
    notes: "Synthetic evidence tests the contract only",
    ...(revisionId ? { revisionId } : {}),
  });
}
async function assign(project: any, a: any, use = "prepared_generation") {
  return callTool(service, c, "production_asset_assign", {
    projectId: project.id,
    expectedScopeVersion: 1,
    shotId: "shot",
    assetId: a.id,
    use,
    notes: "Selected for the target shot",
  });
}
it("requires the current scope and plan for formal generation while allowing experiments", async () => {
  const { request, p, plan, project } = await setup();
  await expect(service.quote(c, request.input)).rejects.toMatchObject({
    code: "PRODUCTION_PREPARATION_REQUIRED",
  });
  await expect(
    callTool(service, c, "generation_prepare", { ...request, plan: undefined }),
  ).rejects.toMatchObject({ code: "PRODUCTION_PLAN_REQUIRED" });
  expect((await service.quote(c, p.input)).preparedRequestId).toBe(p.id);
  const experiment = { ...request.input, production: undefined };
  expect((await service.quote(c, experiment)).id).toBeTruthy();
  await expect(
    callTool(service, c, "production_scope_save", {
      projectId: project.id,
      planId: plan.id,
      expectedPlanVersion: 1,
      expectedScopeVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_SCOPE_CHANGED" });
  await callTool(service, c, "production_plan_save", {
    planId: plan.id,
    expectedVersion: 1,
    plan: { ...plan.plan, title: "Revision" },
  });
  await expect(service.quote(c, p.input)).rejects.toMatchObject({
    code: "PRODUCTION_SCOPE_CHANGED",
  });
});
it("retains preparation provenance and external-use authorization without a review gate", async () => {
  const { project } = await setup(),
    { a, evidence } = await asset();
  await expect(assign(project, a)).rejects.toMatchObject({
    code: "PRODUCTION_ORIGIN_REQUIRED",
  });
  await accept(a, evidence);
  await expect(assign(project, a)).rejects.toMatchObject({
    code: "PRODUCTION_ORIGIN_REQUIRED",
  });
  await expect(assign(project, a, "external")).rejects.toMatchObject({
    code: "PRODUCTION_ASSET_USE_FORBIDDEN",
  });
});
it("accepts exact prepared outputs and invalidates stale scope assignments and final reviews", async () => {
  const { project, plan, p } = await setup(),
    { a, evidence } = await asset();
  const q = await service.quote(c, p.input),
    job = await service.submit(c, {
      input: p.input,
      quoteId: q.id,
      idempotencyKey: randomUUID(),
    });
  // A synthetic completed job avoids paid generation; review fixtures do not claim real visual quality.
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...job, status: "completed", outputs: [a.id] }),
  );
  await accept(a, evidence);
  await assign(project, a);
  const revision = await service.addRevision(c, project.id, {
    schemaVersion: 1,
    title: "Final",
    width: 320,
    height: 180,
    scenes: [
      { id: "main", productionShotId: "shot", assetId: a.id, durationMs: 1000 },
    ],
  });
  await service.scoped(c, "write", (tx) =>
    tx.put({
      id: randomUUID(),
      type: "job",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      status: "completed",
      revisionId: revision.id,
      outputs: [a.id],
    }),
  );
  await accept(a, evidence, revision.id);
  expect((await validateWorkspace(service, c, revision.id)).finalReady).toBe(
    true,
  );
  await callTool(service, c, "production_scope_save", {
    projectId: project.id,
    planId: plan.id,
    expectedPlanVersion: 1,
    expectedScopeVersion: 1,
  });
  const result = await validateWorkspace(service, c, revision.id);
  expect(result.finalReady).toBe(false);
  expect(result.status).toBe("unreviewed");
  expect(result.issues.map((i) => i.code)).toContain(
    "PRODUCTION_ASSET_UNASSIGNED",
  );
});
it("permits explicit external sources but requires every scene and target shot to map", async () => {
  const { project } = await setup(true),
    { a, evidence } = await asset();
  await accept(a, evidence);
  await assign(project, a, "external");
  const unmapped = await service.addRevision(c, project.id, {
    schemaVersion: 1,
    title: "Draft",
    width: 320,
    height: 180,
    scenes: [{ id: "main", assetId: a.id, durationMs: 1000 }],
  });
  const result = await validateWorkspace(service, c, unmapped.id);
  expect(result.issues.map((i) => i.code)).toEqual(
    expect.arrayContaining([
      "PRODUCTION_SHOT_UNMAPPED",
      "PRODUCTION_SHOT_MISSING",
    ]),
  );
  expect(
    (await service.get(c, "project", project.id)).productionScope.version,
  ).toBe(1);
});
it("does not let a graphic label bypass a planned media shot or target dimensions", async () => {
  const { project } = await setup();
  const revision = await service.addRevision(c, project.id, {
    schemaVersion: 1,
    title: "Draft",
    width: 180,
    height: 320,
    scenes: [
      {
        id: "main",
        productionShotId: "shot",
        visualKind: "graphic",
        text: "Card",
        durationMs: 1000,
      },
    ],
  });
  const result = await validateWorkspace(service, c, revision.id);
  expect(result.issues.map((i) => i.code)).toEqual(
    expect.arrayContaining([
      "PRODUCTION_TARGET_MISMATCH",
      "PRODUCTION_VISUAL_KIND_MISMATCH",
    ]),
  );
});
it("requires owner and write permission to change formal scope", async () => {
  const { project, plan } = await setup();
  const key = await service.issueKey(c, {
      name: "Reader",
      scopes: ["read"],
      budgetCents: 0,
    }),
    reader = await service.authenticate(key.key);
  await expect(
    callTool(service, reader, "production_scope_save", {
      projectId: project.id,
      planId: plan.id,
      expectedPlanVersion: 1,
      expectedScopeVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const other = await service.authenticate(
    (await service.createAccount("Other", 100)).key,
  );
  await expect(
    callTool(service, other, "production_scope_save", {
      projectId: project.id,
      planId: plan.id,
      expectedPlanVersion: 1,
      expectedScopeVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
