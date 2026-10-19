import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { GatewayClient } from "../packages/cloud-client/src/gateway.js";
let db: Database, service: Service, dir: string, c: any, asset: any;
const bytes = Buffer.from("reference-test-bytes");
const remote: any[] = [];
let fetcher: ReturnType<
    typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>
  >,
  gateway: GatewayClient;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cloud-reference-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  // These upload/idempotency contracts exercise the explicit legacy migration mode.
  service.allowLegacyGeneration = true;
  c = await service.authenticate((await service.createAccount("Local", 0)).key);
  asset = await service.registerAsset(c.accountId, bytes, {
    name: "reference.png",
    kind: "image",
    mime: "image/png",
    metadata: { width: 16, height: 16 },
    provenance: { license: "original", rightsConfirmed: true },
  });
  remote.length = 0;
  fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ Authorization: "Bearer cloud-test" });
    const path = new URL(url).pathname;
    if (path === "/v1/reference-uploads")
      return Response.json({ id: "upload-1" });
    if (path === "/v1/reference-uploads/upload-1") {
      expect(Buffer.from(init.body as Uint8Array)).toEqual(bytes);
      return Response.json({
        id: "remote-asset",
        sha256: asset.sha256,
        bytes: asset.bytes,
      });
    }
    const body = JSON.parse(init.body as string);
    remote.push(body);
    if (path === "/v1/quotes")
      return Response.json({ id: "remote-quote", maxCents: 5 });
    if (path === "/v1/generations")
      return Response.json({ id: "remote-job", status: "queued" });
    throw new Error(path);
  });
  gateway = new GatewayClient(
    service,
    "https://official.example",
    "cloud-test",
    fetcher as any,
  );
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
const input = () => ({
  kind: "generate",
  model: "reference-model",
  mode: "image_to_video",
  prompt: "Animate the product",
  references: [{ assetId: asset.id, role: "first_frame" }],
});
it("uploads owned bytes once, binds remote references to the quote and retries without repurchasing", async () => {
  const q = await gateway.quote(c, input());
  expect(remote[0].input.references).toEqual([
    { assetId: "remote-asset", role: "first_frame" },
  ]);
  expect(remote[0].input.mode).toBe("image_to_video");
  const p = { input: input(), quoteId: q.id, idempotencyKey: "one" };
  const job = await gateway.submit(c, p);
  expect((await gateway.submit(c, p)).id).toBe(job.id);
  expect(remote.filter((r) => r.idempotencyKey)).toHaveLength(1);
  expect(remote[1].input).toEqual(remote[0].input);
  expect(job.input.references[0].assetId).toBe(asset.id);
  expect((await service.usage(c)).reservedCents).toBe(0);
  await gateway.quote(c, input());
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith("/upload-1")),
  ).toHaveLength(1);
});
it("rejects foreign references before making any cloud call", async () => {
  const other = await service.authenticate(
    (await service.createAccount("Other", 0)).key,
  );
  await expect(gateway.quote(other, input())).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects reference changes after quoting without purchasing", async () => {
  const q = await gateway.quote(c, input());
  await db.transaction((tx) => tx.put({ ...asset, sha256: "0".repeat(64) }));
  await expect(
    gateway.submit(c, {
      input: input(),
      quoteId: q.id,
      idempotencyKey: "changed",
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_CHANGED" });
  expect(remote.filter((r) => r.idempotencyKey)).toHaveLength(0);
});
it("rejects an unprepared storyboard even when the legacy video switch is enabled", async () => {
  await expect(
    gateway.quote(c, {
      ...input(),
      storyboard: {
        storyboardId: "board",
        version: 1,
        sourceShotId: "shot",
        stage: "video",
      },
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_PLAN_REQUIRED" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("requires target-plan preparation on the official storyboard quote route", async () => {
  const { connectCloud } =
    await import("../packages/cloud-client/src/index.js");
  const { callStoryboardTool } =
    await import("../packages/mcp/src/storyboard-tools.js");
  await db.transaction((tx) =>
    tx.put({
      id: "official-board",
      type: "storyboard",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      version: 1,
      shots: [
        {
          sourceShotId: "shot",
          durationMs: 2000,
          videoPrompt: "Animate",
          review: {
            decision: "accepted",
            imageAssetId: asset.id,
            sha256: asset.sha256,
          },
        },
      ],
    }),
  );
  const delegate = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string, init: RequestInit) =>
    new URL(url).pathname === "/v1/generation-models"
      ? Response.json([
          {
            id: "reference-model",
            generationInput: { mode: "image_to_video", outputDurationMs: 5000 },
          },
        ])
      : delegate(url, init),
  );
  connectCloud(
    service,
    "https://official.example",
    "cloud-test",
    fetcher as any,
  );
  await expect(
    callStoryboardTool(service, c, "reference_storyboard_quote", {
      storyboardId: "official-board",
      expectedVersion: 1,
      sourceShotId: "shot",
      stage: "video",
      model: "reference-model",
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_PLAN_REQUIRED" });
  expect(remote).toHaveLength(0);
});
it("rejects read-only callers and corrupt local bytes before uploading", async () => {
  const key = await service.issueKey(c, {
    name: "reader",
    scopes: ["read"],
    budgetCents: 0,
  });
  const reader = await service.authenticate(key.key);
  await expect(gateway.quote(reader, input())).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await service.storage.put(asset.storageKey, Buffer.from("tampered"));
  await expect(gateway.quote(c, input())).rejects.toMatchObject({
    code: "REFERENCE_CHANGED",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects a cloud upload with a mismatched hash before quoting", async () => {
  const delegate = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string, init: RequestInit) =>
    new URL(url).pathname.endsWith("/upload-1")
      ? Response.json({
          id: "remote-asset",
          sha256: "0".repeat(64),
          bytes: asset.bytes,
        })
      : delegate(url, init),
  );
  await expect(gateway.quote(c, input())).rejects.toMatchObject({
    code: "CLOUD_RESPONSE_INVALID",
  });
  expect(remote).toHaveLength(0);
});
