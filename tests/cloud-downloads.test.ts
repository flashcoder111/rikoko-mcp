import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const downloaded = vi.hoisted(() => ({
  bytes: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxkAAAAASUVORK5CYII=",
    "base64",
  ),
  calls: 0,
}));
vi.mock("../packages/storage/src/download.js", () => ({
  downloadPublic: async () => {
    downloaded.calls++;
    return downloaded.bytes;
  },
}));
import { Database } from "../packages/db/src/index.js";
import { Service, fingerprint } from "../packages/core/src/index.js";
import { LocalStorage, sha256 } from "../packages/storage/src/index.js";
import { GatewayClient } from "../packages/cloud-client/src/gateway.js";
import { TemplateClient } from "../packages/cloud-client/src/templates.js";
import { templateSchema } from "../packages/templates/src/schema.js";
let db: Database, service: Service, dir: string, c: any;
beforeEach(async () => {
  db = await Database.open();
  dir = await mkdtemp(join(tmpdir(), "cloud-download-"));
  service = new Service(db, new LocalStorage(dir));
  c = await service.authenticate((await service.createAccount("Local", 0)).key);
  downloaded.calls = 0;
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
it("imports completed remote media only once for concurrent polls, then uses local asset IDs", async () => {
  const input = {
    kind: "generate",
    model: "image",
    prompt: "test",
    parameters: {},
  };
  const fetcher = vi.fn(async (url: any) =>
    Response.json(
      String(url).endsWith("/quotes")
        ? { id: "remote-quote", maxCents: 5 }
        : {
            id: "remote-job",
            status: "completed",
            outputs: ["cloud-only-asset"],
            result: { kind: "image", url: "https://fal.media/fixture.png" },
          },
    ),
  );
  const client = new GatewayClient(
    service,
    "https://cloud.example.com",
    "test",
    fetcher,
  );
  const q = await client.quote(c, input);
  const job = await client.submit(c, {
    input,
    quoteId: q.id,
    idempotencyKey: "download",
  });
  const [a, b] = await Promise.all([
    client.get(c, job.id),
    client.get(c, job.id),
  ]);
  expect(a.outputs).toEqual(b.outputs);
  expect(a.outputs[0]).not.toBe("cloud-only-asset");
  expect(downloaded.calls).toBe(1);
  const asset = await service.get(c, "asset", a.outputs[0]);
  expect(asset.kind).toBe("image");
  expect(await service.storage.read(asset.storageKey)).toEqual(
    downloaded.bytes,
  );
  await client.get(c, job.id);
  expect(downloaded.calls).toBe(1);
  expect((await service.usage(c)).reservedCents).toBe(0);
  const ro = await service.authenticate(
    (
      await service.issueKey(c, {
        name: "Reader",
        scopes: ["read"],
        budgetCents: 0,
      })
    ).key,
  );
  await client.get(ro, job.id);
  expect(downloaded.calls).toBe(1);
});
it("verifies template media bytes, remaps cloud IDs and reuses downloaded assets offline", async () => {
  const t = templateSchema.parse({
    schemaVersion: 1,
    id: "with-image",
    version: 1,
    title: "Image",
    assets: [
      {
        id: "cloud-image",
        sha256: sha256(downloaded.bytes),
        bytes: downloaded.bytes.length,
        name: "image.png",
        license: "original",
      },
    ],
    composition: {
      schemaVersion: 1,
      title: "Image",
      width: 360,
      height: 640,
      scenes: [
        { id: "s", assetId: "cloud-image", text: "hi", durationMs: 1000 },
      ],
    },
  });
  const fetcher = vi.fn(async (url: any) =>
    Response.json(
      String(url).endsWith("catalog")
        ? {
            schemaVersion: 1,
            revision: 1,
            templates: [{ ...t, hash: fingerprint(t) }],
          }
        : { url: "https://assets.example.com/image.png" },
    ),
  );
  const client = new TemplateClient(
    service,
    "https://cloud.example.com",
    fetcher,
  );
  await client.sync(c);
  const owned = await service.registerAsset(
    c.accountId,
    Buffer.from("existing-owned-image"),
    {
      name: "existing.png",
      kind: "image",
      mime: "image/png",
      metadata: { kind: "image", width: 360, height: 640 },
      provenance: { source: "test" },
    },
  );
  const prepared = await client.prepare(c, {
    id: t.id,
    version: 1,
    sceneAssets: { s: owned.id },
  });
  expect(prepared.composition.scenes[0].assetId).toBe(owned.id);
  expect(downloaded.calls).toBe(0);
  expect((await service.list(c, "project")).length).toBe(0);
  const a = await client.apply(c, { id: t.id, version: 1 });
  expect(a.revision.composition.scenes[0].assetId).not.toBe("cloud-image");
  expect(downloaded.calls).toBe(1);
  fetcher.mockRejectedValue(new Error("offline"));
  const b = await client.apply(c, { id: t.id, version: 1 });
  expect(b.revision.composition.scenes[0].assetId).toBe(
    a.revision.composition.scenes[0].assetId,
  );
  expect(downloaded.calls).toBe(1);
});
it("collects official results through the authenticated gateway when local CDN DNS is intercepted", async () => {
  const fetcher = vi.fn(async (url: any, init?: RequestInit) => {
    if (String(url).endsWith("/result")) {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer cloud-test",
      });
      expect(init?.redirect).toBe("error");
      return new Response(new Uint8Array(downloaded.bytes), {
        headers: { "content-type": "application/octet-stream" },
      });
    }
    return Response.json(
      String(url).endsWith("/quotes")
        ? { id: "q" }
        : {
            id: "remote-job",
            status: "completed",
            result: {
              kind: "image",
              downloadPath: "/v1/generations/remote-job/result",
            },
          },
    );
  });
  const client = new GatewayClient(
    service,
    "https://official.example",
    "cloud-test",
    fetcher,
  );
  const input = { kind: "generate", model: "image", prompt: "test" };
  const q = await client.quote(c, input);
  const job = await client.submit(c, {
    input,
    quoteId: q.id,
    idempotencyKey: "relay",
  });
  const [a, b] = await Promise.all([
    client.get(c, job.id),
    client.get(c, job.id),
  ]);
  expect(a.outputs).toHaveLength(1);
  expect(a.outputs).toEqual(b.outputs);
  expect(downloaded.calls).toBe(0);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith("/result")),
  ).toHaveLength(1);
  const asset = await service.get(c, "asset", a.outputs[0]);
  expect(await service.storage.read(asset.storageKey)).toEqual(
    downloaded.bytes,
  );
});
