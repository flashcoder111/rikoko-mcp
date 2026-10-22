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
import { validateProductionLink } from "../packages/core/src/production-scope.js";

let db: Database, service: Service, c: any, dir: string;
const network = vi.fn();
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "production-request-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider([], "fixture", true, network),
  );
  c = await service.authenticate(
    (await service.createAccount("Request binding", 100)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const image = () =>
    service.registerAsset(c.accountId, Buffer.from(randomUUID()), {
      kind: "image",
      name: "product.png",
      mime: "image/png",
      metadata: { width: 320, height: 180 },
      provenance: { evidence: "synthetic" },
    });
  const current = await image(),
    old = await image();
  const request: any = await callTool(service, c, "workspace_request_save", {
    message: "Use this attached burger",
    assetIds: [current.id],
  });
  const plan = {
    title: "Burger",
    width: 320,
    height: 180,
    shots: [
      {
        id: "sear",
        initialState: { patty: "on griddle" },
        action: "Tiny workers turn the patty",
        endState: { patty: "on griddle" },
        references: [
          {
            assetId: current.id,
            role: "product",
            usage: "analysis_only",
            instruction: "Product appearance, not the initial state",
          },
        ],
      },
    ],
  };
  const binding = {
    requestId: request.requestId,
    expectedVersion: request.requestVersion,
  };
  return { current, old, request, plan, binding };
}
it("rejects reusing a different product plan for the current attachment", async () => {
  const { old, plan, binding } = await fixture();
  plan.shots[0].references[0].assetId = old.id;
  await expect(
    callTool(service, c, "production_plan_save", { plan, request: binding }),
  ).rejects.toMatchObject({ code: "REQUEST_ASSET_MISMATCH" });
  expect(network).not.toHaveBeenCalled();
});
it("retains the binding on edits and rejects silently removing the attachment", async () => {
  const { current, plan, binding } = await fixture();
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan,
    request: binding,
  });
  expect(saved.requestBinding.assets).toEqual([
    { assetId: current.id, sha256: current.sha256 },
  ]);
  const updated: any = await callTool(service, c, "production_plan_save", {
    plan: { ...plan, title: "Updated title" },
    planId: saved.id,
    expectedVersion: 1,
  });
  expect(updated.requestBinding).toEqual(saved.requestBinding);
  plan.shots[0].references = [];
  await expect(
    callTool(service, c, "production_plan_save", {
      plan,
      planId: saved.id,
      expectedVersion: 2,
    }),
  ).rejects.toMatchObject({ code: "REQUEST_ASSET_MISMATCH" });
});
it("invalidates a prepared production scope when the request changes", async () => {
  const { old, plan, binding, request } = await fixture();
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan,
    request: binding,
  });
  const operation: any = {
    kind: "generate",
    production: {
      projectId: saved.productionProjectId,
      scopeVersion: 1,
      shotId: "sear",
    },
  };
  const check = () =>
    service.scoped(c, "read", (tx) =>
      validateProductionLink(tx, c.accountId, operation, false),
    );
  await expect(check()).resolves.toBeDefined();
  await callTool(service, c, "workspace_request_save", {
    requestId: request.requestId,
    requestVersion: request.requestVersion,
    message: "Also use this new photo",
    assetIds: [old.id],
  });
  await expect(check()).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  expect(network).not.toHaveBeenCalled();
});
it("rejects mutated attachment bytes and cross-account requests", async () => {
  const { current, plan, binding } = await fixture();
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan,
    request: binding,
  });
  await db.transaction((tx) => tx.put({ ...current, sha256: "0".repeat(64) }));
  await expect(
    callTool(service, c, "production_plan_save", {
      plan,
      planId: saved.id,
      expectedVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "REQUEST_ASSET_CHANGED" });
  const other = await service.authenticate(
    (await service.createAccount("Other", 100)).key,
  );
  await expect(
    callTool(service, other, "production_plan_save", {
      plan: { ...plan, shots: [{ ...plan.shots[0], references: [] }] },
      request: binding,
    }),
  ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
});
it("requires an explicit reason for excluded inputs and keeps legacy plans usable", async () => {
  const { current, plan, binding } = await fixture();
  plan.shots[0].references = [];
  await expect(
    callTool(service, c, "production_plan_save", {
      plan,
      request: {
        ...binding,
        excludedAssets: [
          {
            assetId: current.id,
            reason:
              "User supplied packaging photo; this shot intentionally shows only the food",
          },
        ],
      },
    }),
  ).resolves.toHaveProperty("requestBinding");
  await expect(
    callTool(service, c, "production_plan_save", { plan }),
  ).resolves.toHaveProperty("productionProjectId");
});

it("keeps the user's words distinct from creative choices without adding approval", async () => {
  const { plan, binding, request } = await fixture();
  expect(request.userRequirements[0]).toMatchObject({
    text: "Use this attached burger",
    sourceTurn: 0,
  });
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: {
      ...plan,
      creativeChoices: [{ decision: "Warm lighting", reason: "Show texture" }],
    },
    request: binding,
  });
  expect(saved.requestBinding.userRequirements).toEqual(
    request.userRequirements,
  );
  expect(saved.communication).toMatchObject({
    mode: "inform_and_continue",
    requiresConfirmation: false,
    creativeChoices: [{ decision: "Warm lighting", reason: "Show texture" }],
  });
  expect(
    saved.requestBinding.userRequirements.some((r: any) =>
      r.text.includes("Warm"),
    ),
  ).toBe(false);
  const next: any = await callTool(service, c, "workspace_request_save", {
    requestId: request.requestId,
    requestVersion: 1,
    assetIds: [],
  });
  expect(next.userRequirements).toEqual(request.userRequirements);
  expect(next.status).toBe("ready");
});

it("rejects invented user evidence and agent-only requirement changes", async () => {
  const { request } = await fixture();
  await expect(
    callTool(service, c, "workspace_request_save", {
      requestId: request.requestId,
      requestVersion: 1,
      userRequirements: [
        {
          id: "fake",
          text: "Add a CTA",
          sourceTurn: 0,
          sourceQuote: "Add a CTA",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "USER_REQUIREMENT_EVIDENCE_REQUIRED" });
  await expect(
    callTool(service, c, "workspace_request_save", {
      requestId: request.requestId,
      requestVersion: 1,
      userRequirements: [
        {
          id: "changed",
          text: "Use burger",
          sourceTurn: 0,
          sourceQuote: "burger",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "USER_REQUIREMENT_CHANGE_REQUIRED" });
});

it("prevents a creative plan from dropping a preserved user property", async () => {
  const { plan } = await fixture();
  const request: any = await callTool(service, c, "workspace_request_save", {
    message: "Preserve the action",
    userRequirements: [
      {
        id: "action",
        text: "Preserve the action",
        sourceTurn: 0,
        sourceQuote: "Preserve the action",
        preserve: ["action"],
      },
    ],
  });
  await expect(
    callTool(service, c, "production_plan_save", {
      plan,
      request: { requestId: request.requestId, expectedVersion: 1 },
    }),
  ).rejects.toMatchObject({ code: "USER_PRESERVATION_CONFLICT" });
  // A real follow-up can change the requirement without a separate approval ceremony.
  const updated: any = await callTool(service, c, "workspace_request_save", {
    requestId: request.requestId,
    requestVersion: 1,
    message: "You may redesign the action",
    userRequirements: [
      {
        id: "action",
        text: "Redesign action",
        sourceTurn: 1,
        sourceQuote: "You may redesign the action",
      },
    ],
  });
  await expect(
    callTool(service, c, "production_plan_save", {
      plan,
      request: { requestId: updated.requestId, expectedVersion: 2 },
    }),
  ).resolves.toHaveProperty("productionProjectId");
});

it("scopes usage to owned jobs and deduplicates IDs", async () => {
  const other = await service.authenticate(
    (await service.createAccount("Billing other", 100)).key,
  );
  const put = (accountId: string) =>
    service.scoped(c, "write", (tx) =>
      tx.put({
        id: randomUUID(),
        accountId,
        type: "job",
        createdAt: new Date().toISOString(),
        status: "completed",
        billingSource: "credits",
        billingStatus: "confirmed",
        chargedCredits: 7,
        input: { kind: "generate" },
      }),
    );
  const own = await put(c.accountId),
    foreign = await put(other.accountId);
  const usage: any = await callTool(service, c, "task_usage", {
    jobIds: [own.id, own.id],
  });
  expect(usage.jobCount).toBe(1);
  expect(usage.totals[0].chargedCredits).toBe(7);
  await expect(
    callTool(service, c, "task_usage", { jobIds: [foreign.id] }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
