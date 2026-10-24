import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { GatewayClient } from "../packages/cloud-client/src/gateway.js";
import { cloudRequest } from "../packages/cloud-client/src/http.js";
import {
  directReferenceUpload,
  directStorageUrl,
} from "../packages/cloud-client/src/direct-media.js";
import { faceFreeFixturePolicy } from "./video-policy-fixture.js";
const signed =
  "https://" +
  "a".repeat(32) +
  ".r2.cloudflarestorage.com/private/source?X-Amz-Signature=fixture";
const intent = {
  url: signed,
  method: "PUT",
  headers: { "Content-Type": "image/png", "If-None-Match": "*" },
};
it("rejects untrusted storage URLs and upload header injection before sending any bytes", async () => {
  for (const url of [
    "https://127.0.0.1/video",
    "https://evil.test/video",
    "https://u:p@" +
      "a".repeat(32) +
      ".r2.cloudflarestorage.com/x?X-Amz-Signature=s",
    signed + "#fragment",
    signed.replace("https:", "http:"),
    signed.replace("=fixture", "="),
  ])
    expect(() => directStorageUrl(url)).toThrow();
  const fetcher = vi.fn();
  for (const upload of [
    { ...intent, method: "POST" },
    {
      ...intent,
      headers: { ...intent.headers, Authorization: "Bearer never-forward" },
    },
    { ...intent, headers: { ...intent.headers, "Content-Type": "video/mp4" } },
  ])
    await expect(
      directReferenceUpload(fetcher, upload, new Uint8Array([1]), "image/png"),
    ).rejects.toMatchObject({ code: "CLOUD_RESPONSE_INVALID" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("follows only signed R2 result metadata without forwarding account credentials", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ delivery: "r2", url: signed }))
    .mockResolvedValueOnce(
      new Response("video", { headers: { "Content-Type": "video/mp4" } }),
    );
  const r = await cloudRequest(
    "https://api.example",
    "/v1/generations/job/result",
    fetcher,
    { key: "account-token", binary: true },
  );
  expect(Buffer.from(r.data).toString()).toBe("video");
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer account-token",
  );
  expect(fetcher.mock.calls[1][1].headers).toBeUndefined();
  expect(fetcher.mock.calls[1][1].redirect).toBe("error");
});
it("preserves large reports, rejects empty videos and does not follow arbitrary result redirects", async () => {
  const report = JSON.stringify({ summary: "a".repeat(40000) });
  expect(
    Buffer.from(
      (
        await cloudRequest(
          "https://api.example",
          "/result",
          vi.fn(
            async () =>
              new Response(report, {
                headers: { "Content-Type": "application/json" },
              }),
          ),
          { binary: true },
        )
      ).data,
    ).toString(),
  ).toBe(report);
  const empty = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ delivery: "r2", url: signed }))
    .mockResolvedValueOnce(
      new Response(null, { headers: { "Content-Type": "video/mp4" } }),
    );
  await expect(
    cloudRequest("https://api.example", "/result", empty, { binary: true }),
  ).rejects.toMatchObject({ code: "RESULT_UNAVAILABLE" });
  const external = vi.fn(async () =>
    Response.json({ delivery: "r2", url: "https://evil.test/video" }),
  );
  await expect(
    cloudRequest("https://api.example", "/result", external, { binary: true }),
  ).rejects.toMatchObject({ code: "CLOUD_RESPONSE_INVALID" });
  expect(external).toHaveBeenCalledOnce();
});
let db: Database, service: Service, dir: string, c: any, asset: any;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "direct-client-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  c = await service.authenticate((await service.createAccount("local", 0)).key);
  asset = await service.registerAsset(c.accountId, Buffer.from("reference"), {
    name: "image.png",
    kind: "image",
    mime: "image/png",
    metadata: { width: 16, height: 16 },
    provenance: { license: "original" },
  });
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
it("quotes with an owned reference using direct PUT plus metadata completion, then reuses its binding", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === signed) {
      expect(init.headers).toEqual(intent.headers);
      expect(Buffer.from(init.body as Uint8Array).toString()).toBe("reference");
      return new Response(null, { status: 200 });
    }
    expect(init.headers).toMatchObject({
      Authorization: "Bearer account-token",
    });
    const path = new URL(url).pathname;
    if (path === "/v1/generation-models")
      return Response.json([
        {
          id: "image",
          kind: "image",
          available: true,
          generationInput: {
            mode: "image_edit",
            references: [{ roles: ["product"], kind: "image" }],
          },
        },
      ]);
    if (path === "/v1/reference-uploads") {
      expect(JSON.parse(init.body as string)).toMatchObject({
        sha256: asset.sha256,
        mime: "image/png",
        bytes: asset.bytes,
      });
      return Response.json({ id: "intent", upload: intent });
    }
    if (path === "/v1/reference-uploads/intent/complete")
      return Response.json({
        id: "remote-asset",
        sha256: asset.sha256,
        bytes: asset.bytes,
      });
    if (path === "/v1/quotes") {
      expect(JSON.parse(init.body as string).input.references[0].assetId).toBe(
        "remote-asset",
      );
      return Response.json({ id: "quote", maxCents: 5 });
    }
    throw Error("Unexpected request path");
  });
  const gateway = new GatewayClient(
    service,
    "https://api.example",
    "account-token",
    fetcher as any,
  );
  const input: any = {
    kind: "generate",
    model: "image",
    mode: "image_edit",
    prompt: "Edit this product",
    references: [{ assetId: asset.id, role: "product" }],
    videoPolicy: faceFreeFixturePolicy([asset]),
  };
  await gateway.quote(c, input);
  await gateway.quote(c, input);
  expect(calls.filter((r) => r.url === signed)).toHaveLength(1);
  expect(calls.filter((r) => r.url.endsWith("/intent/complete"))).toHaveLength(
    1,
  );
  expect(calls.some((r) => r.url.endsWith("/intent"))).toBe(false);
  const other = await service.authenticate(
    (await service.createAccount("other", 0)).key,
  );
  const count = calls.length;
  await expect(gateway.quote(other, input)).rejects.toThrow();
  expect(calls).toHaveLength(count);
});
