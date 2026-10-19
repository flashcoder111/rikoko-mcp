import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import {
  compositionSchema,
  type Context,
} from "../packages/contracts/src/index.js";
import { validateWorkspace } from "../packages/core/src/production-review.js";

let db: Database, service: Service, context: Context, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "production-quality-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(directory),
    new FalProvider([], "", false),
  );
  context = await service.authenticate(
    (await service.createAccount("Quality fixture", 0)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

function targetPlan() {
  const initial = {
    cover: { presence: "visible", properties: { position: "open" } },
  };
  const end = {
    cover: { presence: "visible", properties: { position: "closed" } },
  };
  return {
    title: "Container closure",
    width: 320,
    height: 180,
    process: {
      version: 1,
      objects: [{ id: "cover", label: "Container cover" }],
    },
    shots: [
      {
        id: "close",
        durationMs: 2000,
        initialState: { cover: "open" },
        action: "Close once",
        endState: { cover: "closed" },
        process: {
          initialState: initial,
          endState: end,
          stateAnchor: {
            mode: "text_only",
            reason: "Synthetic contract fixture",
          },
          operations: [
            {
              id: "lower",
              role: "main",
              description: "Lower and settle the cover",
              preconditions: initial,
              effects: end,
              timing: {
                approach: { startMs: 0, endMs: 400 },
                contact: { startMs: 400, endMs: 600 },
                completion: { startMs: 600, endMs: 1600 },
                hold: { startMs: 1600, endMs: 2000 },
              },
            },
          ],
        },
      },
    ],
  };
}
async function media() {
  // Synthetic stored bytes and sampled timestamps test enforcement, not model quality.
  const asset = await service.registerAsset(
    context.accountId,
    Buffer.from(randomUUID()),
    {
      name: "synthetic-review.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: {
        kind: "video",
        width: 320,
        height: 180,
        durationMs: 2000,
        fps: 10,
      },
      provenance: { evidence: "contract-fixture" },
    },
  );
  const inspection = {
    id: randomUUID(),
    type: "media-inspection",
    accountId: context.accountId,
    createdAt: new Date().toISOString(),
    assetId: asset.id,
    sourceSha256: asset.sha256,
    range: { startMs: 0, endMs: 2000 },
    frames: Array.from({ length: 20 }, (_, i) => ({
      sourceTimeMs: i * 100,
      requestedTimeMs: i * 100,
    })),
  };
  await service.scoped(context, "write", (tx) => tx.put(inspection));
  return { asset, inspection };
}
async function setup() {
  const plan: any = await callTool(service, context, "production_plan_save", {
    plan: targetPlan(),
  });
  await callTool(service, context, "production_scope_save", {
    projectId: plan.productionProjectId,
    planId: plan.id,
    expectedPlanVersion: 1,
    expectedScopeVersion: 1,
    requirements: { allowedAssetUses: ["external"] },
  });
  return {
    plan,
    ...(await media()),
    production: {
      projectId: plan.productionProjectId,
      scopeVersion: 2,
      shotId: "close",
    },
  };
}
function qualityChecks(): any[] {
  return [
    {
      obligationId: "process:close:state",
      status: "pass",
      reason: "Synthetic start and end state assessment",
      method: "frames",
      range: { startMs: 0, endMs: 2000 },
    },
    {
      obligationId: "process:close:operation:lower",
      status: "pass",
      reason: "Synthetic complete action assessment",
      method: "frames",
      range: { startMs: 0, endMs: 1600 },
      holdMs: 400,
    },
  ];
}
function reviewInput(fixture: Awaited<ReturnType<typeof setup>>) {
  return {
    assetId: fixture.asset.id,
    inspectionIds: [fixture.inspection.id],
    decision: "accepted",
    reviewer: "host_agent",
    production: fixture.production,
    actionRanges: [],
    checks: {
      actionComplete: {
        status: "not_applicable",
        reason: "Exercise the old-check bypass guard",
      },
      framing: true,
      continuity: true,
      noArtifacts: true,
    },
    notes: "Synthetic contract fixture; no real visual judgment",
    qualityChecks: qualityChecks(),
  };
}
it("enforces evidence for optional scoped acceptance without making it an assignment gate", async () => {
  const fixture = await setup();
  await expect(
    callTool(service, context, "media_review", {
      ...reviewInput(fixture),
      qualityChecks: [],
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_QUALITY_REVIEW_REQUIRED" });
  await expect(
    callTool(service, context, "media_review", {
      ...reviewInput(fixture),
      production: undefined,
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_QUALITY_REVIEW_REQUIRED" });
  const accepted: any = await callTool(
    service,
    context,
    "media_review",
    reviewInput(fixture),
  );
  expect(accepted.productionScopeHash).toBeTruthy();
  expect(accepted.production.shotId).toBe("close");
  await expect(
    callTool(service, context, "production_asset_assign", {
      projectId: fixture.production.projectId,
      expectedScopeVersion: 2,
      shotId: "close",
      assetId: fixture.asset.id,
      use: "external",
      notes: "Reviewed source",
    }),
  ).resolves.toMatchObject({ assetId: fixture.asset.id });
});
it("keeps optional review scope checks while allowing assignment without acceptance", async () => {
  const fixture = await setup();
  const generic = {
    ...reviewInput(fixture),
    production: undefined,
    qualityChecks: undefined,
  };
  await callTool(service, context, "media_review", generic);
  const assignment = {
    projectId: fixture.production.projectId,
    expectedScopeVersion: 2,
    shotId: "close",
    assetId: fixture.asset.id,
    use: "external",
    notes: "Reviewed source",
  };
  await expect(
    callTool(service, context, "production_asset_assign", assignment),
  ).resolves.toHaveProperty("assetId", fixture.asset.id);
  await callTool(service, context, "media_review", reviewInput(fixture));
  await callTool(service, context, "production_plan_save", {
    planId: fixture.plan.id,
    expectedVersion: 1,
    plan: { ...targetPlan(), title: "Revised container closure" },
  });
  await expect(
    callTool(service, context, "media_review", reviewInput(fixture)),
  ).rejects.toMatchObject({ code: "PRODUCTION_SCOPE_CHANGED" });
  await expect(
    callTool(service, context, "production_asset_assign", {
      ...assignment,
      expectedScopeVersion: 3,
    }),
  ).resolves.toHaveProperty("assetId", fixture.asset.id);
});
it("requires all final obligations and protects their source action and hold when trimmed", async () => {
  const fixture = await setup();
  await callTool(service, context, "media_review", reviewInput(fixture));
  await callTool(service, context, "production_asset_assign", {
    projectId: fixture.production.projectId,
    expectedScopeVersion: 2,
    shotId: "close",
    assetId: fixture.asset.id,
    use: "external",
    notes: "Reviewed source",
  });
  const composition = compositionSchema.parse({
    schemaVersion: 1,
    title: "Container",
    width: 320,
    height: 180,
    scenes: [
      {
        id: "close",
        productionShotId: "close",
        durationMs: 2000,
        assetId: fixture.asset.id,
      },
    ],
  });
  const revision = {
    id: randomUUID(),
    type: "revision",
    accountId: context.accountId,
    projectId: fixture.production.projectId,
    composition,
    createdAt: new Date().toISOString(),
  };
  const rendered = await media();
  await service.scoped(context, "write", async (tx) => {
    await tx.put(revision);
    await tx.put({
      id: randomUUID(),
      type: "job",
      accountId: context.accountId,
      createdAt: new Date().toISOString(),
      revisionId: revision.id,
      status: "completed",
      outputs: [rendered.asset.id],
    });
  });
  const expectedProductionScopeHash = (
    await validateWorkspace(service, context, revision.id)
  ).productionScopeHash;
  const finalInput = {
    ...reviewInput(fixture),
    production: undefined,
    revisionId: revision.id,
    assetId: rendered.asset.id,
    inspectionIds: [rendered.inspection.id],
    expectedProductionScopeHash,
  };
  await expect(
    callTool(service, context, "media_review", {
      ...finalInput,
      expectedProductionScopeHash: undefined,
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_SCOPE_CHANGED" });
  await expect(
    callTool(service, context, "media_review", {
      ...finalInput,
      qualityChecks: qualityChecks().slice(0, 1),
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_QUALITY_REVIEW_REQUIRED" });
  await callTool(service, context, "media_review", finalInput);
  const ready = await validateWorkspace(service, context, revision.id);
  expect(ready.finalReady).toBe(true);
  expect(ready.qualityReview.map((check) => check.id)).toEqual([
    "process:close:state",
    "process:close:operation:lower",
  ]);
  await callTool(service, context, "media_review", {
    ...finalInput,
    decision: "needs_changes",
    qualityChecks: undefined,
    notes:
      "Optional final feedback must remain visible without blocking delivery",
  });
  expect(await validateWorkspace(service, context, revision.id)).toMatchObject({
    status: "needs_changes",
    finalReady: true,
    reviewAccepted: false,
    reviewRequired: false,
  });
  // A later generic static-style acceptance cannot replace the scoped action proof.
  await callTool(service, context, "media_review", {
    ...reviewInput(fixture),
    production: undefined,
    qualityChecks: undefined,
  });
  await service.scoped(context, "write", (tx) =>
    tx.put({
      ...revision,
      composition: {
        ...composition,
        scenes: [{ ...composition.scenes[0], durationMs: 1800 }],
      },
    }),
  );
  expect(
    (await validateWorkspace(service, context, revision.id)).issues,
  ).toContainEqual(expect.objectContaining({ code: "ACTION_RANGE_CUT" }));
  await callTool(service, context, "production_plan_save", {
    planId: fixture.plan.id,
    expectedVersion: 1,
    plan: { ...targetPlan(), title: "Revised final intent" },
  });
  await expect(
    callTool(service, context, "media_review", finalInput),
  ).rejects.toMatchObject({ code: "PRODUCTION_SCOPE_CHANGED" });
});

it("a later rejected excerpt is feedback and does not prevent explicitly assigning existing media", async () => {
  const fixture = await setup();
  await callTool(service, context, "media_review", reviewInput(fixture));
  await callTool(service, context, "media_review", {
    ...reviewInput(fixture),
    production: undefined,
    qualityChecks: undefined,
    decision: "needs_changes",
    range: { startMs: 500, endMs: 1000 },
    checks: {
      actionComplete: { status: "unknown", reason: "Do not claim completion" },
      framing: true,
      continuity: false,
      noArtifacts: false,
    },
    notes: "Synthetic excerpt rejection revokes prior acceptance",
  });
  await expect(
    callTool(service, context, "production_asset_assign", {
      projectId: fixture.production.projectId,
      expectedScopeVersion: 2,
      shotId: "close",
      assetId: fixture.asset.id,
      use: "external",
      notes: "Rejected source",
    }),
  ).resolves.toHaveProperty("assetId", fixture.asset.id);
});
