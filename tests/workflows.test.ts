import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import {
  LocalStorage,
  sha256,
  safeKey,
  S3Storage,
} from "../packages/storage/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { completeUpload, mimeFor } from "../packages/core/src/assets.js";
import { Worker } from "../apps/worker/src/worker.js";
import { callTool, type ToolName } from "../packages/mcp/src/tools.js";
import {
  compositionSchema,
  operationSchema,
  transcriptSchema,
} from "../packages/contracts/src/index.js";
import { createApp } from "../apps/server/src/app.js";
import { srt, stamp, remapWords } from "../packages/render/src/index.js";
import { media } from "../packages/render/src/media.js";
import { planRecipe } from "../packages/recipes/src/index.js";
let db: Database,
  dir: string,
  service: Service,
  c: any,
  key: string,
  worker: Worker,
  video: any,
  revision: any;
const composition = compositionSchema.parse({
  schemaVersion: 1,
  title: "Test scene",
  width: 360,
  height: 640,
  scenes: [{ id: "one", durationMs: 1000, text: "Original word" }],
  audio: { toneHz: 200, gain: 0.05 },
});
const tool = (name: ToolName, input: unknown = {}) =>
  callTool(service, c, name, input);
async function job(input: unknown) {
  const quote = await tool("quote_create", { input });
  const j = await tool("job_submit", {
    quoteId: quote.id,
    idempotencyKey: crypto.randomUUID(),
    input,
  });
  await worker.tick();
  return tool("record_get", { type: "job", id: j.id });
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "workflow-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  key = (await service.createAccount("Workflow", 0)).key;
  c = await service.authenticate(key);
  worker = new Worker(service);
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
it("runs the shared tools from planning through real render and version-specific downloads", async () => {
  const capabilities = await tool("capabilities");
  expect(capabilities.local).toContain("render");
  const project = await tool("project_create", { title: "Shared tools" });
  const plan = await tool("plan_create", {
    projectId: project.id,
    recipe: {
      mode: "from-scratch",
      title: "Original template",
      product: {
        name: "Orbit",
        description: "A fictional bottle",
        cta: "Explore",
      },
      scenes: composition.scenes,
    },
  });
  revision = await tool("record_get", {
    type: "revision",
    id: plan.revisionId,
  });
  const rendered = await job({
    kind: "render",
    composition: revision.composition,
    revisionId: revision.id,
  });
  expect(rendered.status).toBe("completed");
  video = await tool("record_get", { type: "asset", id: rendered.outputs[0] });
  expect(video.kind).toBe("video");
  expect((await tool("records_list", { type: "asset" })).length).toBe(3);
  expect((await tool("usage_get")).availableCents).toBe(0);
}, 60000);
it("validates upload signatures, content hashes, repeat completion and tenant access", async () => {
  const bytes = await service.storage.read(video.storageKey);
  const intent = await tool("upload_create", {
    name: "copy.mp4",
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    source: "original-test",
    license: "CC0",
    rightsConfirmed: true,
  });
  await expect(
    completeUpload(service, c, intent.id, bytes.slice(1)),
  ).rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
  const imported = await completeUpload(service, c, intent.id, bytes);
  expect(imported.sha256).toBe(video.sha256);
  expect((await completeUpload(service, c, intent.id, bytes)).id).toBe(
    imported.id,
  );
  const wrong = await tool("upload_create", {
    name: "fake.mp4",
    bytes: 3,
    sha256: sha256(new Uint8Array([1, 2, 3])),
    source: "test",
    license: "CC0",
    rightsConfirmed: true,
  });
  await expect(
    completeUpload(service, c, wrong.id, new Uint8Array([1, 2, 3])),
  ).rejects.toMatchObject({ code: "MEDIA_FAILED" });
  await service.db.transaction(async (tx) => {
    const i = await tx.get(wrong.id);
    await tx.put({ ...i!, expiresAt: "2000-01-01" });
  });
  await expect(
    completeUpload(service, c, wrong.id, new Uint8Array([1, 2, 3])),
  ).rejects.toMatchObject({ code: "UPLOAD_EXPIRED" });
}, 60000);
it("cuts a reusable standalone asset, burns supplied captions and records precomputed analysis", async () => {
  const cut = await job({
    kind: "trim",
    assetId: video.id,
    segments: [{ startMs: 100, endMs: 700 }],
    width: 360,
    height: 640,
  });
  expect(cut.status).toBe("completed");
  expect(cut.editMap[0].sourceStartMs).toBe(100);
  const captioned = await job({
    kind: "captions",
    assetId: video.id,
    transcript: {
      schemaVersion: 1,
      language: "en",
      durationMs: 1000,
      words: [
        { id: "a", text: "Corrected", startMs: 100, endMs: 450 },
        { id: "b", text: "brand", startMs: 450, endMs: 900 },
      ],
      evidence: "precomputed",
    },
  });
  expect(captioned.status).toBe("completed");
  const captions = await service.get(c, "asset", captioned.outputs[1]);
  expect(
    Buffer.from(await service.storage.read(captions.storageKey)).toString(),
  ).toContain("Corrected brand");
  const analysis = await job({
    kind: "analyze",
    assetId: video.id,
    observations: [
      { startMs: 0, endMs: 500, observation: "Precomputed product opening" },
    ],
  });
  expect(analysis.analysis.observationEvidence).toBe("precomputed");
  const reused = await tool("plan_create", {
    projectId: revision.projectId,
    recipe: {
      mode: "reference-remix",
      title: "Reuse observed reference",
      referenceAssetId: video.id,
      analysisAssetId: analysis.outputs[0],
    },
  });
  expect(reused.analysisEvidence).toBe("precomputed");
  const none = await job({ kind: "analyze", assetId: video.id });
  expect(none.analysis.observationEvidence).toBe("not_available");
}, 60000);
it("marks absent optional ASR configuration explicitly and avoids any paid call", async () => {
  const result = await job({
    kind: "transcribe",
    assetId: video.id,
    language: "en",
  });
  expect(result.status).toBe("blocked_external");
  expect(result.error.code).toBe("CAPABILITY_UNAVAILABLE");
});
it("applies feedback patches, preserves version lineage and creates independent hooks", async () => {
  const initial = await tool("revision_create", {
    projectId: revision.projectId,
    composition,
  });
  const applied = await tool("feedback_add", {
    revisionId: initial.id,
    text: "Bigger text",
    sceneId: "one",
    atMs: 100,
    patch: {
      type: "style",
      style: { fontSize: 32, color: "#ffd66b", background: "#172722" },
    },
  });
  expect(applied.feedback.status).toBe("applied");
  expect(applied.revision.parentId).toBe(initial.id);
  const revise = await tool("revision_revise", {
    revisionId: initial.id,
    patch: { type: "format", width: 640, height: 360 },
  });
  expect(revise.composition.width).toBe(640);
  const variants = await tool("revision_variants", {
    revisionId: initial.id,
    variants: [
      { label: "A", text: "First" },
      { label: "B", text: "Second" },
    ],
  });
  expect(variants).toHaveLength(2);
  await expect(
    tool("feedback_add", {
      revisionId: initial.id,
      text: "Invalid",
      sceneId: "missing",
    }),
  ).rejects.toThrow();
});
it("issues/revokes/rotates scoped keys and serves only assets in a preview grant", async () => {
  const scoped = await tool("key_create", {
    name: "limited",
    scopes: ["read"],
    budgetCents: 0,
  });
  const rotated = await tool("key_rotate", { keyId: scoped.id });
  await expect(service.authenticate(scoped.key)).rejects.toThrow();
  expect((await service.authenticate(rotated.key)).keyId).toBe(scoped.id);
  await tool("key_revoke", { keyId: scoped.id });
  await expect(service.authenticate(rotated.key)).rejects.toThrow();
  const share = await tool("preview_share", { revisionId: revision.id });
  const app = createApp(service);
  const shared = await app.request("http://localhost/share", {
    headers: { Host: "localhost", "X-Preview-Token": share.token },
  });
  expect(shared.status).toBe(200);
  const wrong = await app.request("http://localhost/share/assets/missing", {
    headers: { Host: "localhost", "X-Preview-Token": share.token },
  });
  expect(wrong.status).toBe(404);
  const good = await app.request(`http://localhost/share/assets/${video.id}`, {
    headers: { Host: "localhost", "X-Preview-Token": share.token },
  });
  expect(good.status).toBe(200);
  const authFile = await app.request(
    `http://localhost/api/assets/${video.id}/file`,
    { headers: { Host: "localhost", Authorization: `Bearer ${key}` } },
  );
  expect(authFile.status).toBe(200);
  await tool("preview_revoke", { shareId: share.id });
  expect(
    (
      await app.request("http://localhost/share", {
        headers: { Host: "localhost", "X-Preview-Token": share.token },
      })
    ).status,
  ).toBe(401);
});
it("selects source words with stable edit mapping and formats subtitles", async () => {
  const words = [
    { id: "w1", text: "hello", startMs: 100, endMs: 300, speaker: "A" },
    { id: "w2", text: "Orbit", startMs: 300, endMs: 700, speaker: "A" },
    { id: "w3", text: "goodbye", startMs: 1200, endMs: 1500, speaker: "B" },
  ];
  const selection = await tool("transcript_select", {
    transcript: {
      schemaVersion: 1,
      language: "en",
      durationMs: 2000,
      words,
      evidence: "precomputed",
    },
    speaker: "A",
  });
  expect(selection.segments).toHaveLength(1);
  expect(remapWords(words, [{ startMs: 100, endMs: 700 }])[0].startMs).toBe(0);
  expect(srt(composition)).toContain("Original word");
  expect(stamp(3661002)).toBe("01:01:01,002");
});
it("validates missing sources, revision mismatches, invalid intervals and unsafe storage keys", async () => {
  await expect(
    service.quote(c, {
      kind: "render",
      revisionId: revision.id,
      composition: { ...revision.composition, title: "Different" },
    }),
  ).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
  await expect(
    service.quote(c, {
      kind: "trim",
      assetId: video.id,
      segments: [{ startMs: 0, endMs: 999999 }],
    }),
  ).rejects.toMatchObject({ code: "INVALID_INTERVAL" });
  expect(() =>
    planRecipe({ mode: "reference-remix", title: "Missing" }),
  ).toThrow();
  expect(() =>
    planRecipe({
      mode: "rawcut",
      title: "Missing",
      scenes: [{ id: "a", text: "a", durationMs: 1000 }],
    }),
  ).toThrow();
  expect(() => safeKey("../secret")).toThrow();
  expect(() =>
    compositionSchema.parse({
      ...composition,
      scenes: [composition.scenes[0], composition.scenes[0]],
    }),
  ).toThrow();
  expect(() =>
    transcriptSchema.parse({
      schemaVersion: 1,
      language: "en",
      durationMs: 100,
      words: [{ id: "w", text: "bad", startMs: 0, endMs: 200 }],
      evidence: "precomputed",
    }),
  ).toThrow();
  await expect(
    media({ command: "probe", path: "/nonexistent" }, AbortSignal.abort()),
  ).rejects.toMatchObject({ code: "CANCELLED" });
});
it("round trips storage adapters without a hosted account", async () => {
  const memory = new Map<string, Uint8Array>();
  const client = {
    send: async (command: any) => {
      const i = command.input;
      if (command.constructor.name === "PutObjectCommand") {
        memory.set(i.Key, i.Body);
        return {};
      }
      if (command.constructor.name === "DeleteObjectCommand") {
        memory.delete(i.Key);
        return {};
      }
      return { Body: { transformToByteArray: async () => memory.get(i.Key) } };
    },
  };
  const s3 = new S3Storage(client as any, "mock-bucket");
  await s3.put("tenant/asset", new Uint8Array([1, 2]));
  expect(await s3.read("tenant/asset")).toEqual(new Uint8Array([1, 2]));
  await s3.delete("tenant/asset");
  expect(memory.size).toBe(0);
  await service.storage.put("tenant/temp", new Uint8Array([1]));
  await service.storage.delete("tenant/temp");
  expect(mimeFor({ kind: "image", codec: "mjpeg" })).toBe("image/jpeg");
  expect(mimeFor({ kind: "image", codec: "webp" })).toBe("image/webp");
  expect(mimeFor({ kind: "audio", codec: "mp3" })).toBe("audio/mpeg");
  expect(mimeFor({ kind: "audio", codec: "aac" })).toBe("audio/mp4");
  expect(mimeFor({ kind: "audio", codec: "pcm_s16le" })).toBe("audio/wav");
});
