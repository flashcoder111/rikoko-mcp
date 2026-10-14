import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import {
  buildProviders,
  parseModelConfig,
} from "../packages/providers/src/config.js";
import { Worker } from "../apps/worker/src/worker.js";
import { callTool } from "../packages/mcp/src/tools.js";
import {
  referenceContentSchema,
  referenceReportSchema,
} from "../packages/contracts/src/reference-analysis.js";

const content = () => ({
  summary: "Two product shots with a reveal.",
  shots: [
    {
      id: "shot1",
      startMs: 0,
      endMs: 1000,
      description: "Box",
      framing: "close-up",
      cameraMotion: "static",
      action: "A box opens",
      transition: "cut",
      evidenceIds: ["e1"],
    },
    {
      id: "shot2",
      startMs: 1000,
      endMs: 2500,
      description: "Product",
      framing: "wide",
      cameraMotion: "pan",
      action: "Reveal",
      transition: "end",
      evidenceIds: ["e2"],
    },
  ],
  narrativeBeats: [
    {
      id: "beat1",
      startMs: 0,
      endMs: 2500,
      role: "reveal",
      description: "Reveal the product",
      evidenceIds: ["e1", "e2"],
    },
  ],
  events: [
    {
      id: "event1",
      startMs: 1000,
      endMs: 1500,
      type: "action",
      description: "Reveal",
      evidenceIds: ["e2"],
    },
  ],
  visualStyle: { description: "Clean, blue", evidenceIds: ["e1"] },
  speech: [],
  audio: { description: "No reliable audio evidence", evidenceIds: [] },
  evidence: [
    {
      id: "e1",
      startMs: 0,
      endMs: 1000,
      modality: "visual",
      observation: "A box",
      confidence: "high",
    },
    {
      id: "e2",
      startMs: 1000,
      endMs: 2500,
      modality: "visual",
      observation: "Product appears",
      confidence: "medium",
    },
  ],
  unknowns: [
    {
      startMs: 0,
      endMs: 2500,
      question: "Is there a musical beat?",
      reason: "Audio uncertain",
      suggestedFps: 4,
    },
  ],
});
const profile = {
  id: "reference-vision",
  endpoint: "gemini-3.8-flash",
  kind: "analysis",
  maxCostCents: 10,
  priceVersion: "test-only",
  hardBoundConfirmed: true,
  parameters: {
    fps: 2,
    maxDurationMs: 60000,
    maxOutputTokens: 8192,
    maxBytes: 104857600,
  },
};
const config = () =>
  parseModelConfig({
    schemaVersion: 1,
    mode: "custom",
    providers: [
      {
        id: "video-understanding",
        adapter: "gemini",
        keyEnv: "TEST_GEMINI_KEY",
        enabled: true,
        models: [profile],
      },
    ],
  });
let db: Database, dir: string, svc: Service, c: any, source: any;
let interactionStatus: string,
  response: unknown,
  submission: "ok" | "unknown",
  submissions: number;
let calls: { url: string; init?: RequestInit }[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "reference-analysis-"));
  db = await Database.open();
  calls = [];
  submissions = 0;
  interactionStatus = "completed";
  response = content();
  submission = "ok";
  const fetcher: typeof fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/upload/v1beta/files"))
      return new Response(null, {
        headers: {
          "x-goog-upload-url":
            "https://generativelanguage.googleapis.com/upload/session/test",
        },
      });
    if (String(url).includes("/upload/session/"))
      return Response.json({
        file: {
          name: "files/test",
          uri: "https://generativelanguage.googleapis.com/v1beta/files/test",
          mimeType: "video/mp4",
          state: "ACTIVE",
        },
      });
    if (String(url).endsWith("/interactions") && init?.method === "POST") {
      submissions++;
      if (submission === "unknown")
        throw Error("secret should never be persisted");
      return Response.json({ id: "interaction1", status: "in_progress" });
    }
    if (String(url).endsWith("/cancel"))
      return Response.json({ status: "cancelled" });
    return Response.json({
      id: "interaction1",
      status: interactionStatus,
      steps: [
        {
          type: "model_output",
          content: [{ type: "text", text: JSON.stringify(response) }],
        },
      ],
      usage: { total_tokens: 123 },
    });
  });
  svc = new Service(
    db,
    new LocalStorage(dir),
    buildProviders(config(), { TEST_GEMINI_KEY: "test-secret" }, fetcher),
    "external",
  );
  c = await svc.authenticate(
    (await svc.createAccount("Reference test", 100)).key,
  );
  source = await svc.registerAsset(c.accountId, new Uint8Array([1, 2, 3]), {
    name: "reference.mp4",
    kind: "video",
    mime: "video/mp4",
    metadata: { durationMs: 2500, hasAudio: false },
    provenance: { evidence: "contract-mock" },
  });
});
afterEach(async () => {
  await db?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function enqueue(extra = {}) {
  const input = {
    kind: "reference_analyze",
    assetId: source.id,
    model: profile.id,
    purpose: "remake",
    language: "zh",
    ...extra,
  };
  const quote = await svc.quote(c, input);
  return svc.submit(c, {
    quoteId: quote.id,
    input,
    idempotencyKey: crypto.randomUUID(),
  });
}
it("uploads private local video, returns evidence-linked structure and makes a source-linked editable plan", async () => {
  const job = await enqueue();
  await new Worker(svc).tick();
  const done = await svc.get(c, "job", job.id);
  expect(done.status).toBe("completed");
  expect(submissions).toBe(1);
  expect(done.providerCostStatus).toBe("pending_reconciliation");
  const report = await callTool(svc, c, "reference_analysis_get", {
    analysisAssetId: done.outputs[0],
  });
  expect(report.source).toMatchObject({
    assetId: source.id,
    sha256: source.sha256,
    durationMs: 2500,
  });
  expect(report.shots).toHaveLength(2);
  expect(report.provenance).toMatchObject({
    model: profile.id,
    requestId: "interaction1",
  });
  expect(JSON.stringify(report)).not.toContain("test-secret");
  expect(referenceReportSchema.safeParse(report).success).toBe(true);
  const body = JSON.parse(
    String(calls.find((x) => x.url.endsWith("/interactions"))!.init!.body),
  );
  expect(body).toMatchObject({
    background: true,
    response_format: { type: "text", mime_type: "application/json" },
  });
  expect(body.input[0]).toMatchObject({
    type: "video",
    processing: { type: "static", fps: 2 },
  });
  const query = await callTool(svc, c, "reference_analysis_query", {
    analysisAssetId: done.outputs[0],
    startMs: 1100,
    endMs: 1600,
  });
  expect(query.shots.map((s: any) => s.id)).toEqual(["shot2"]);
  expect(query.refinementInput).toMatchObject({
    kind: "reference_analyze",
    range: { startMs: 1100, endMs: 1600 },
  });
  const adaptation = await callTool(svc, c, "reference_adapt", {
    analysisAssetId: done.outputs[0],
    title: "Our product",
    replacements: [
      { sourceShotId: "shot1", text: "Our opening" },
      { sourceShotId: "shot2", text: "Our reveal" },
    ],
  });
  expect(adaptation.composition.scenes.map((s: any) => s.durationMs)).toEqual([
    1000, 1500,
  ]);
  expect(adaptation.shotMapping[0]).toMatchObject({
    sourceShotId: "shot1",
    targetSceneId: "ref-shot1",
    status: "needs_media",
  });
  expect(adaptation.composition.scenes.every((s: any) => !s.assetId)).toBe(
    true,
  );
  const cached = await callTool(svc, c, "reference_analyze", {
    assetId: source.id,
    model: profile.id,
    purpose: "remake",
    language: "zh",
  });
  expect(cached).toMatchObject({
    status: "cached",
    analysisAssetId: done.outputs[0],
  });
  expect(submissions).toBe(1);
});
it("returns a quote without making a model call and isolates other accounts", async () => {
  const preview = await callTool(svc, c, "reference_analyze", {
    assetId: source.id,
    model: profile.id,
  });
  expect(preview.status).toBe("quote_required");
  expect(calls).toHaveLength(0);
  const other = await svc.authenticate(
    (await svc.createAccount("Other", 10)).key,
  );
  await expect(
    svc.quote(other, {
      kind: "reference_analyze",
      assetId: source.id,
      model: profile.id,
    }),
  ).rejects.toThrow();
});
it("resumes polling an accepted analysis after worker restart without paying twice", async () => {
  interactionStatus = "in_progress";
  const job = await enqueue();
  await new Worker(svc).tick();
  expect((await svc.get(c, "job", job.id)).status).toBe("queued");
  interactionStatus = "completed";
  await new Worker(svc).tick();
  expect((await svc.get(c, "job", job.id)).status).toBe("completed");
  expect(submissions).toBe(1);
});
it("retains uncertain submissions for reconciliation instead of re-buying", async () => {
  submission = "unknown";
  const job = await enqueue();
  await new Worker(svc).tick();
  await new Worker(svc).tick();
  const failed = await svc.get(c, "job", job.id);
  expect(failed.status).toBe("submission_unknown");
  expect(JSON.stringify(failed)).not.toContain("secret");
  expect(submissions).toBe(1);
});
it("cancels the original interaction and does not promise a refund", async () => {
  interactionStatus = "in_progress";
  const job = await enqueue();
  await new Worker(svc).tick();
  await svc.cancel(c, job.id);
  await new Worker(svc).tick();
  expect(await svc.get(c, "job", job.id)).toMatchObject({
    status: "cancelled",
    providerCancellation: { refunded: false },
  });
  expect(calls.some((x) => x.url.endsWith("/cancel"))).toBe(true);
  expect(submissions).toBe(1);
});
it.each(["outside", "dangling", "overlap"])(
  "rejects unusable model evidence: %s",
  async (reason) => {
    const result = content();
    if (reason === "outside") result.shots[1].endMs = 999999;
    if (reason === "dangling") result.shots[0].evidenceIds = ["invented"];
    if (reason === "overlap") result.shots[1].startMs = 500;
    response = result;
    const job = await enqueue();
    await new Worker(svc).tick();
    expect(await svc.get(c, "job", job.id)).toMatchObject({
      status: "failed",
      error: { code: "PROVIDER_RESULT_INVALID" },
      outputs: [],
    });
  },
);
it("validates video bounds before billing and rejects forged structured references", async () => {
  await expect(
    enqueue({ range: { startMs: 0, endMs: 3000 } }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
  expect(
    referenceContentSchema.safeParse({ ...content(), shots: [] }).success,
  ).toBe(false);
});
