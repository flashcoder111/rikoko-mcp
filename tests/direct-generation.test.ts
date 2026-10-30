import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { urlImportSchema } from "../packages/contracts/src/asset-import.js";

let db: Database, service: Service, dir: string, owner: any, other: any;
const input = { kind: "generate", model: "video", prompt: "A cup on a table" };
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "direct-generation-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir), new FalProvider([{
    id: "video", kind: "video", endpoint: "minimax/h3/text-to-video",
    parameters: { duration: 5, aspect_ratio: "16:9" },
    maxCostCents: 10, creditPriceCents: 10, hardBoundConfirmed: true,
    priceVersion: "test",
  }], "fixture", true));
  owner = await service.authenticate((await service.createAccount("Owner", 100)).key);
  other = await service.authenticate((await service.createAccount("Other", 100)).key);
});
afterAll(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });

it("submits a brief directly without analysis, plan, review, target or quote confirmation", async () => {
  const job: any = await callTool(service, owner, "job_submit", { input, idempotencyKey: "direct" });
  expect(job.status).toBe("queued");
  expect(job.reservedCents).toBe(10);
  const again: any = await callTool(service, owner, "job_submit", { input, idempotencyKey: "direct" });
  expect(again.id).toBe(job.id);
  const ledger = await db.transaction(tx => tx.query("SELECT * FROM ledger WHERE job_id=$1", [job.id]));
  expect(ledger.rows.filter(r => r.kind === "reserve")).toHaveLength(1);
  await expect(service.get(other, "job", job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(service.submit(owner, { input: { ...input, prompt: "Changed" }, idempotencyKey: "direct" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});

it("optional preparation accepts a handwritten brief without a saved creative request", async () => {
  const prepared: any = await callTool(service, owner, "generation_prepare", { input });
  expect(prepared.input.prompt).toBe(input.prompt);
  const job = await service.submit(owner, { input: prepared.input, idempotencyKey: "prepared-direct" });
  expect(job.status).toBe("queued");
  await expect(service.submit(owner, { input: { ...prepared.input, prompt: "Changed" }, idempotencyKey: "changed-prepared" })).rejects.toMatchObject({ code: "PREPARED_REQUEST_MISMATCH" });
});

it("still refuses spending beyond the available balance", async () => {
  const poor = await service.authenticate((await service.createAccount("Empty", 0)).key);
  await expect(service.submit(poor, { input, idempotencyKey: "empty" })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
});

it("still refuses spending beyond the key budget", async () => {
  await db.transaction(tx => tx.query("UPDATE api_keys SET budget_cents=0 WHERE id=$1", [other.keyId]));
  await expect(service.submit(other, { input, idempotencyKey: "budget" })).rejects.toMatchObject({ code: "KEY_BUDGET_EXCEEDED" });
});

it("does not require or fabricate a new rights confirmation for user-selected media", () => {
  const result = urlImportSchema.parse({ url: "https://example.com/video.mp4", name: "Reference" });
  expect(result.license).toBe("user-provided");
  expect(result.rightsConfirmed).toBeUndefined();
});
