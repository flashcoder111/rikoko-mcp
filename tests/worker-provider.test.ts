import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const downloads = vi.hoisted(() => ({ bytes: new Uint8Array() }));
vi.mock("../packages/storage/src/download.js", () => ({
  downloadPublic: async () => downloads.bytes,
}));
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { Worker } from "../apps/worker/src/worker.js";
import { media } from "../packages/render/src/media.js";
import { compositionSchema } from "../packages/contracts/src/index.js";
let db: Database,
  dir: string,
  svc: Service,
  c: any,
  worker: Worker,
  polls: number,
  submits: number,
  cancels: number;
const input = {
  kind: "generate",
  model: "test",
  prompt: "Original",
  parameters: {},
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "upstream-"));
  db = await Database.open();
  polls = 0;
  submits = 0;
  cancels = 0;
  const provider = new FalProvider(
    [
      {
        id: "test",
        endpoint: "fal-ai/test",
        kind: "image",
        maxCostCents: 10,
        priceVersion: "v1",
        parameters: {},
        hardBoundConfirmed: true,
      },
    ],
    "fake",
    true,
    async (url, options) => {
      if (options?.method === "POST") {
        submits++;
        return Response.json({
          request_id: "one",
          status_url: "https://queue.fal.run/test/status",
          response_url: "https://queue.fal.run/test/result",
          cancel_url: "https://queue.fal.run/test/cancel",
        });
      }
      if (String(url).endsWith("status")) {
        polls++;
        return Response.json({
          status: polls === 1 ? "IN_QUEUE" : "COMPLETED",
        });
      }
      if (String(url).endsWith("cancel")) {
        cancels++;
        return Response.json({ cancelled: true });
      }
      return Response.json({
        image: { url: "https://media.fal.media/contract-mock.png" },
      });
    },
  );
  svc = new Service(db, new LocalStorage(dir), provider);
  c = await svc.authenticate(
    (await svc.createAccount("Mock upstream", 100)).key,
  );
  worker = new Worker(svc);
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
async function enqueue() {
  const q = await svc.quote(c, input);
  return svc.submit(c, {
    quoteId: q.id,
    idempotencyKey: crypto.randomUUID(),
    input,
  });
}
it("does not record a retail charge as supplier cost when resuming collected output", async () => {
  svc.provider.models[0].creditPriceCents = 15;
  const job = await enqueue();
  await db.transaction((tx) =>
    tx.put({ ...job, outputs: ["already-collected-output"] }),
  );
  await worker.tick();
  await worker.tick();
  expect(await svc.get(c, "job", job.id)).toMatchObject({
    chargedCents: 15,
    providerActualCostCents: null,
    providerCostStatus: "pending_reconciliation",
  });
});
it("retains reservation for a submitted queued provider task and requests real upstream cancellation", async () => {
  const job = await enqueue();
  await worker.tick();
  expect(submits).toBe(1);
  const waiting = await svc.get(c, "job", job.id);
  expect(waiting.ticket.requestId).toBe("one");
  await svc.cancel(c, job.id);
  expect((await svc.usage(c)).reservedCents).toBe(10);
  await worker.tick();
  expect(cancels).toBe(1);
  const cancelled = await svc.get(c, "job", job.id);
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.costStatus).toBe("pending_reconciliation");
  expect(submits).toBe(1);
});
it("polls the original request and collects real bytes without resubmission or invented costs", async () => {
  const result = await media({
    command: "render",
    workDir: dir,
    assets: {},
    composition: compositionSchema.parse({
      schemaVersion: 1,
      title: "fixture",
      width: 144,
      height: 144,
      scenes: [{ id: "a", durationMs: 500, text: "" }],
    }),
  });
  downloads.bytes = await readFile(result.preview);
  const job = await enqueue();
  await worker.tick();
  await worker.tick();
  expect(submits).toBe(1);
  const complete = await svc.get(c, "job", job.id);
  expect(complete.status).toBe("completed");
  expect(complete.outputs).toHaveLength(1);
  expect(complete.costStatus).toBe("pending_reconciliation");
  expect((await svc.usage(c)).reservedCents).toBe(10);
  await svc.reconcile(c, job.id, {
    costCents: 7,
    note: "Verified mock settlement",
    outcome: "completed",
  });
  expect((await svc.usage(c)).balanceCents).toBe(93);
}, 60000);

it("keeps reference media private until a configured storage adapter can authorize access", async () => {
  svc.provider.models = [
    {
      id: "vision",
      endpoint: "fal-ai/vision",
      kind: "analysis",
      maxCostCents: 10,
      priceVersion: "test",
      parameters: {},
      hardBoundConfirmed: true,
    },
  ];
  const reference = await svc.registerAsset(c.accountId, new Uint8Array([1]), {
    name: "mock-reference.mp4",
    kind: "video",
    mime: "video/mp4",
    metadata: { durationMs: 2000 },
    provenance: { evidence: "contract-mock" },
  });
  const op = { kind: "analyze", assetId: reference.id, model: "vision" };
  const quote = await svc.quote(c, op);
  const job = await svc.submit(c, {
    quoteId: quote.id,
    input: op,
    idempotencyKey: "vision-storage",
  });
  await worker.tick();
  const result = await svc.get(c, "job", job.id);
  expect(result.status).toBe("blocked_external");
  expect(submits).toBe(0);
  expect((await svc.usage(c)).reservedCents).toBe(0);
});

it("collects schema-validated translation as a reusable asset without a media download", async () => {
  svc.provider = new FalProvider(
    [
      {
        id: "translator",
        endpoint: "fal-ai/translation",
        kind: "translation",
        maxCostCents: 10,
        priceVersion: "v1",
        parameters: {},
        hardBoundConfirmed: true,
      },
    ],
    "fake",
    true,
    async (url, options) => {
      if (options?.method === "POST")
        return Response.json({
          request_id: "t",
          status_url: "https://queue.fal.run/t/status",
          response_url: "https://queue.fal.run/t/result",
          cancel_url: "https://queue.fal.run/t/cancel",
        });
      if (String(url).endsWith("status"))
        return Response.json({ status: "COMPLETED" });
      return Response.json({
        output: { schemaVersion: 1, language: "zh", text: "你好" },
      });
    },
  );
  const op = {
    kind: "translate",
    model: "translator",
    text: "Hello",
    language: "zh",
  };
  const q = await svc.quote(c, op);
  const job = await svc.submit(c, {
    quoteId: q.id,
    input: op,
    idempotencyKey: "translation",
  });
  await worker.tick();
  const result = await svc.get(c, "job", job.id);
  expect(result.status).toBe("completed");
  const asset = await svc.get(c, "asset", result.outputs[0]);
  expect(asset.kind).toBe("translation");
  expect(
    JSON.parse(Buffer.from(await svc.storage.read(asset.storageKey)).toString())
      .text,
  ).toBe("你好");
});

it.each([true, false])(
  "checks reference analysis against owned source timing (valid=%s)",
  async (valid) => {
    const source = await svc.registerAsset(c.accountId, new Uint8Array([9]), {
      name: "reference.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: { durationMs: valid ? 2000 : 500 },
      provenance: { evidence: "contract-mock" },
    });
    svc.storage.providerUrl = async () =>
      "https://owned.example/reference?temporary=capability";
    svc.provider = new FalProvider(
      [
        {
          id: "vision",
          endpoint: "fal-ai/vision",
          kind: "analysis",
          maxCostCents: 10,
          priceVersion: "v1",
          parameters: {},
          hardBoundConfirmed: true,
        },
      ],
      "fake",
      true,
      async (url, options) => {
        if (options?.method === "POST") {
          expect(JSON.parse(String(options.body)).video_url).toContain(
            "owned.example",
          );
          return Response.json({
            request_id: "v",
            status_url: "https://queue.fal.run/v/status",
            response_url: "https://queue.fal.run/v/result",
            cancel_url: "https://queue.fal.run/v/cancel",
          });
        }
        if (String(url).endsWith("status"))
          return Response.json({ status: "COMPLETED" });
        return Response.json({
          output: {
            schemaVersion: 1,
            summary: "Visible reference",
            observations: [
              { startMs: 0, endMs: 1000, observation: "A product" },
            ],
          },
        });
      },
    );
    const op = { kind: "analyze", assetId: source.id, model: "vision" };
    const quote = await svc.quote(c, op);
    const job = await svc.submit(c, {
      quoteId: quote.id,
      input: op,
      idempotencyKey: "vision",
    });
    await worker.tick();
    const result = await svc.get(c, "job", job.id);
    expect(result.status).toBe(valid ? "completed" : "failed");
    expect(JSON.stringify(result)).not.toContain("temporary=capability");
    if (valid) {
      const { callTool } = await import("../packages/mcp/src/tools.js");
      const p = await svc.createProject(c, { title: "Reference" });
      const plan = await callTool(svc, c, "plan_create", {
        projectId: p.id,
        recipe: {
          mode: "reference-remix",
          title: "Remix",
          referenceAssetId: source.id,
          analysisAssetId: result.outputs[0],
        },
      });
      expect(plan.observations[0].observation).toBe("A product");
    } else expect(result.error.code).toBe("PROVIDER_RESULT_INVALID");
  },
);
