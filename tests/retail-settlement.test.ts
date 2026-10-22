import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { type Context } from "../packages/contracts/src/index.js";
let db: Database, dir: string, service: Service, c: Context;
const input = {
  kind: "generate" as const,
  model: "picture",
  prompt: "test",
  parameters: {},
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "retail-settlement-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider(
      [
        {
          id: "picture",
          kind: "image",
          endpoint: "test/image",
          maxCostCents: 8,
          creditPriceCents: 12,
          priceVersion: "test-v1",
          hardBoundConfirmed: true,
          parameters: {},
        },
      ],
      "fake",
      true,
    ),
  );
  c = await service.authenticate(
    (await service.createAccount("Buyer", 100)).key,
  );
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
async function start() {
  const job = await service.submit(c, {
    input,
    idempotencyKey: "purchase",
  });
  const claimed = await service.claim("test");
  return { job, lease: claimed!.leaseToken };
}
it("direct submission still enforces balance and key budgets without leaving a reservation", async () => {
  const poor = await service.authenticate(
    (await service.createAccount("No balance", 0)).key,
  );
  await expect(
    service.submit(poor, { input, idempotencyKey: "direct-poor" }),
  ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  const limited = await service.authenticate(
    (
      await service.issueKey(c, {
        name: "Limited",
        scopes: ["read", "write"],
        budgetCents: 1,
      })
    ).key,
  );
  await expect(
    service.submit(limited, { input, idempotencyKey: "direct-limit" }),
  ).rejects.toMatchObject({ code: "KEY_BUDGET_EXCEEDED" });
  expect(await service.list(c, "job")).toHaveLength(0);
  expect(await service.list(c, "quote")).toHaveLength(0);
  expect(await service.usage(c)).toMatchObject({
    balanceCents: 100,
    reservedCents: 0,
  });
});
it("charges the retail snapshot, retains unknown supplier cost, and can reconcile cost without another debit", async () => {
  const { job, lease } = await start();
  await service.finish(
    job.id,
    lease,
    { status: "completed", outputs: ["output"] },
    null,
  );
  const stored = await service.get(c, "job", job.id);
  expect(stored).toMatchObject({
    chargedCents: 12,
    providerMaxCostCents: 8,
    providerActualCostCents: null,
    providerCostStatus: "pending_reconciliation",
  });
  expect(await service.usage(c)).toMatchObject({
    balanceCents: 88,
    reservedCents: 0,
  });
  await service.reconcileProviderCost(c, job.id, {
    costCents: 5,
    note: "Supplier invoice verified",
  });
  await service.reconcileProviderCost(c, job.id, {
    costCents: 5,
    note: "Supplier invoice verified",
  });
  expect(await service.get(c, "job", job.id)).toMatchObject({
    chargedCents: 12,
    providerActualCostCents: 5,
    providerCostStatus: "confirmed",
    status: "completed",
  });
  expect(
    (await service.usage(c)).ledger.filter(
      (e: { kind: string }) => e.kind === "settle",
    ),
  ).toHaveLength(1);
});
it("supports a discounted retail price below supplier cost without increasing the user's charge", async () => {
  service.provider.models[0].creditPriceCents = 2;
  const { job, lease } = await start();
  await service.finish(
    job.id,
    lease,
    { status: "completed", outputs: ["output"] },
    5,
  );
  expect(await service.get(c, "job", job.id)).toMatchObject({
    chargedCents: 2,
    providerActualCostCents: 5,
  });
  expect((await service.usage(c)).balanceCents).toBe(98);
});
it("releases the customer reservation on a reconciled failed fixed-price generation while recording supplier costs", async () => {
  const { job, lease } = await start();
  await service.finish(
    job.id,
    lease,
    { status: "failed", ticket: { requestId: "accepted" } },
    null,
  );
  expect((await service.usage(c)).reservedCents).toBe(12);
  await service.reconcile(c, job.id, {
    costCents: 5,
    outcome: "failed",
    note: "Provider billed failed request",
  });
  expect(await service.get(c, "job", job.id)).toMatchObject({
    chargedCents: 0,
    providerActualCostCents: 5,
  });
  expect(await service.usage(c)).toMatchObject({
    balanceCents: 100,
    reservedCents: 0,
  });
});
it("rejects customer and cross-account supplier cost reconciliation", async () => {
  const { job, lease } = await start();
  await service.finish(
    job.id,
    lease,
    { status: "completed", outputs: ["output"] },
    null,
  );
  const user = await service.authenticate(
    (
      await service.issueKey(c, {
        name: "Customer",
        scopes: ["read", "write"],
        budgetCents: 100,
      })
    ).key,
  );
  await expect(
    service.reconcileProviderCost(user, job.id, {
      costCents: 4,
      note: "forbidden operation",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const other = await service.authenticate(
    (await service.createAccount("Other", 0)).key,
  );
  await expect(
    service.reconcileProviderCost(other, job.id, {
      costCents: 4,
      note: "forbidden operation",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("records supplier overruns separately and rejects conflicting repeated reconciliation", async () => {
  const { job, lease } = await start();
  await service.finish(
    job.id,
    lease,
    { status: "completed", outputs: ["output"] },
    null,
  );
  await service.reconcileProviderCost(c, job.id, {
    costCents: 15,
    note: "Provider invoice overrun",
  });
  expect(await service.get(c, "job", job.id)).toMatchObject({
    chargedCents: 12,
    providerActualCostCents: 15,
    providerCostOverrunCents: 7,
  });
  await expect(
    service.reconcileProviderCost(c, job.id, {
      costCents: 14,
      note: "Conflicting supplier invoice",
    }),
  ).rejects.toMatchObject({ code: "RECONCILIATION_CONFLICT" });
  expect((await service.usage(c)).balanceCents).toBe(88);
});
