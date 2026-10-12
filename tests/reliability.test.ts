import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import {
  FalProvider,
  SubmissionUnknown,
} from "../packages/providers/src/index.js";
import { Worker } from "../apps/worker/src/worker.js";
import { compositionSchema } from "../packages/contracts/src/index.js";
const model = {
  id: "test-image",
  endpoint: "fal-ai/test",
  kind: "image" as const,
  maxCostCents: 700,
  priceVersion: "test-v1",
  hardBoundConfirmed: true,
  parameters: {},
};
const input = {
  kind: "generate",
  model: "test-image",
  prompt: "Orbit",
  parameters: {},
};
let db: Database, dir: string, svc: Service, c: any;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "reliable-"));
  db = await Database.open();
  svc = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider([model], "fake-test-credential", true, async () => {
      throw new Error("Timeout after upstream acceptance");
    }),
  );
  c = await svc.authenticate((await svc.createAccount("Budget", 1000)).key);
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
it("atomically reserves account budget under concurrency and releases a cancellation exactly once", async () => {
  const q = await svc.quote(c, input);
  const attempts = await Promise.allSettled(
    ["a", "b"].map((k) =>
      svc.submit(c, { quoteId: q.id, idempotencyKey: k, input }),
    ),
  );
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  expect((await svc.usage(c)).reservedCents).toBe(700);
  const job = (
    attempts.find(
      (a) => a.status === "fulfilled",
    ) as PromiseFulfilledResult<any>
  ).value;
  await svc.cancel(c, job.id);
  await svc.cancel(c, job.id);
  expect((await svc.usage(c)).reservedCents).toBe(0);
  expect(
    (await svc.usage(c)).ledger.filter((l: any) => l.kind === "release"),
  ).toHaveLength(1);
});
it("enforces per-key budget and invalidates expired quotes", async () => {
  const key = await svc.issueKey(c, {
    name: "capped",
    scopes: ["read", "write"],
    budgetCents: 699,
  });
  const limited = await svc.authenticate(key.key);
  const q = await svc.quote(limited, input);
  await expect(
    svc.submit(limited, { quoteId: q.id, idempotencyKey: "over", input }),
  ).rejects.toMatchObject({ code: "KEY_BUDGET_EXCEEDED" });
  await db.transaction(async (tx) => {
    const v = await tx.get(q.id);
    await tx.put({ ...v!, expiresAt: "2000-01-01T00:00:00.000Z" });
  });
  await expect(
    svc.submit(c, { quoteId: q.id, idempotencyKey: "old", input }),
  ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
});
it("never resubmits an unknown upstream submission and keeps funds reserved until reconciliation", async () => {
  const q = await svc.quote(c, input);
  const job = await svc.submit(c, {
    quoteId: q.id,
    idempotencyKey: "unknown",
    input,
  });
  const worker = new Worker(svc);
  await worker.tick();
  const unknown = await svc.get(c, "job", job.id);
  expect(unknown.status).toBe("submission_unknown");
  expect(unknown.costStatus).toBe("pending_reconciliation");
  expect(await worker.tick()).toBe(false);
  expect((await svc.usage(c)).reservedCents).toBe(700);
  await svc.reconcile(c, job.id, {
    costCents: 200,
    note: "Confirmed from provider usage export",
    outcome: "failed",
  });
  expect((await svc.usage(c)).balanceCents).toBe(800);
  expect((await svc.usage(c)).reservedCents).toBe(0);
});
it("turns a crashed submission checkpoint into unknown instead of buying again", async () => {
  const q = await svc.quote(c, input);
  const job = await svc.submit(c, {
    quoteId: q.id,
    idempotencyKey: "crash",
    input,
  });
  const claimed = await svc.claim("dead-worker");
  await svc.checkpoint(job.id, claimed!.leaseToken, { phase: "submitting" });
  await db.transaction(async (tx) => {
    const v = await tx.get(job.id);
    await tx.put({ ...v!, leaseUntil: "2000-01-01T00:00:00.000Z" });
  });
  expect(await svc.claim("replacement")).toBeNull();
  expect((await svc.get(c, "job", job.id)).status).toBe("submission_unknown");
});
it("rejects stale worker completion and preserves key budgets during rotation", async () => {
  const q = await svc.quote(c, input);
  const job = await svc.submit(c, {
    quoteId: q.id,
    idempotencyKey: "lease",
    input,
  });
  await svc.claim("worker");
  await expect(
    svc.finish(job.id, "wrong-token", { status: "completed" }, 700),
  ).rejects.toMatchObject({ code: "LEASE_LOST" });
  const key = await svc.rotateKey(c, c.keyId);
  expect((await svc.authenticate(key.key)).keyId).toBe(c.keyId);
  expect((await svc.usage(c)).reservedCents).toBe(700);
});
it("invalidates stale voice after changing a scene and validates complete localized audio", async () => {
  const comp = compositionSchema.parse({
    schemaVersion: 1,
    title: "Voice",
    width: 360,
    height: 640,
    scenes: [{ id: "one", text: "First", durationMs: 1000 }],
  });
  const p = await svc.createProject(c, { title: "Voice" });
  const a = await svc.registerAsset(c.accountId, new Uint8Array([1, 2, 3]), {
    name: "test.wav",
    kind: "audio",
    mime: "audio/wav",
    metadata: { durationMs: 1000 },
    provenance: { evidence: "contract-mock" },
  });
  comp.scenes[0].audioAssetId = a.id;
  const rev = await svc.addRevision(c, p.id, comp);
  const next = await svc.revise(c, rev.id, {
    type: "scene",
    sceneId: "one",
    changes: { text: "Longer new line" },
  });
  expect(next.composition.scenes[0].audioAssetId).toBeUndefined();
  expect(
    (await svc.get(c, "revision", rev.id)).composition.scenes[0].audioAssetId,
  ).toBe(a.id);
  await expect(
    svc.revise(c, rev.id, { type: "language", language: "zh", scenes: [] }),
  ).rejects.toThrow();
});
it("revokes and expires preview permissions", async () => {
  const p = await svc.createProject(c, { title: "Share" });
  const rev = await svc.addRevision(c, p.id, {
    schemaVersion: 1,
    title: "Share",
    width: 360,
    height: 640,
    scenes: [{ id: "a", durationMs: 1000, text: "Hello" }],
  });
  const s = await svc.createShare(c, rev.id);
  expect((await svc.resolveShare(s.token)).revision.id).toBe(rev.id);
  await svc.revokeShare(c, s.id);
  await expect(svc.resolveShare(s.token)).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});
it("requires immutable provider parameters and distinguishes rejection from ambiguous transport failure", async () => {
  await expect(
    svc.quote(c, { ...input, parameters: { duration: 10000 } }),
  ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
  await expect(svc.provider.submit(input as any)).rejects.toBeInstanceOf(
    SubmissionUnknown,
  );
  const provider = new FalProvider(
    [model],
    "fake",
    true,
    async () => new Response("{}", { status: 422 }),
  );
  await expect(provider.submit(input as any)).rejects.toMatchObject({
    code: "PROVIDER_REJECTED",
  });
});

it("rejects a provider profile change between quote and execution before any paid submission", async () => {
  const quote = await svc.quote(c, input);
  const job = await svc.submit(c, {
    quoteId: quote.id,
    idempotencyKey: "profile-change",
    input,
  });
  svc.provider.models[0] = { ...model, parameters: { num_images: 20 } };
  await new Worker(svc).tick();
  const final = await svc.get(c, "job", job.id);
  expect(final.error.code).toBe("PRICE_CHANGED");
  expect(final.costStatus).toBe("confirmed");
  expect((await svc.usage(c)).reservedCents).toBe(0);
});

it("resumes only a known upstream request while preserving its reservation and identity", async () => {
  const q = await svc.quote(c, input);
  const job = await svc.submit(c, {
    quoteId: q.id,
    idempotencyKey: "resume",
    input,
  });
  const active = await svc.claim("old");
  await svc.checkpoint(job.id, active!.leaseToken, {
    ticket: {
      requestId: "known",
      statusUrl: "https://queue.fal.run/test/status",
      resultUrl: "https://queue.fal.run/test/result",
      cancelUrl: "https://queue.fal.run/test/cancel",
    },
  });
  await svc.finish(
    job.id,
    active!.leaseToken,
    { status: "failed", error: { code: "PROVIDER_POLL_FAILED" } },
    null,
  );
  const resumed = await svc.resume(c, job.id);
  expect(resumed.id).toBe(job.id);
  expect(resumed.status).toBe("queued");
  expect(resumed.ticket.requestId).toBe("known");
  expect((await svc.usage(c)).reservedCents).toBe(700);
});
