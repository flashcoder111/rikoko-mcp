import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FalVideoProvider } from "../packages/providers/src/fal-video.js";
import {
  buildProviders,
  parseModelConfig,
} from "../packages/providers/src/config.js";
import { referenceOperationSchema } from "../packages/contracts/src/reference-analysis.js";
import { Service } from "../packages/core/src/index.js";
import { Database } from "../packages/db/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { Worker } from "../apps/worker/src/worker.js";
import { callTool } from "../packages/mcp/src/tools.js";
import type { Model } from "../packages/providers/src/index.js";

const model: Model = {
  id: "gemini-reference",
  endpoint: "openrouter/router/video",
  kind: "analysis",
  maxCostCents: 100,
  priceVersion: "test-only",
  hardBoundConfirmed: true,
  parameters: {
    model: "google/gemini-3.8-flash",
    maxDurationMs: 60000,
    maxBytes: 83886080,
    maxOutputTokens: 8192,
  },
};
const input = referenceOperationSchema.parse({
  kind: "reference_analyze",
  assetId: "source",
  model: model.id,
});
const fileUrl = "https://v3b.fal.media/files/b/test/reference.mp4";
const uploadUrl =
  "https://v3b.fal.media/upload/test?signature=private-upload-signature";
const content = {
  summary: "Box opens",
  shots: [
    {
      id: "s1",
      startMs: 0,
      endMs: 2000,
      description: "Box",
      framing: "close",
      cameraMotion: "static",
      action: "Opening",
      transition: "end",
      evidenceIds: ["e1"],
    },
  ],
  narrativeBeats: [],
  events: [],
  visualStyle: { description: "Blue", evidenceIds: ["e1"] },
  speech: [],
  audio: { description: "No audio", evidenceIds: [] },
  evidence: [
    {
      id: "e1",
      startMs: 0,
      endMs: 2000,
      modality: "visual",
      observation: "Box",
      confidence: "high",
    },
  ],
  unknowns: [],
};
let calls: { url: string; init?: RequestInit }[],
  pending: boolean,
  fetcher: typeof fetch;
beforeEach(() => {
  calls = [];
  pending = false;
  fetcher = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/storage/upload/initiate"))
      return Response.json({ file_url: fileUrl, upload_url: uploadUrl });
    if (String(url).includes("/upload/test"))
      return new Response(null, { status: 200 });
    if (init?.method === "POST")
      return Response.json({
        request_id: "req1",
        status_url:
          "https://queue.fal.run/openrouter/router/requests/req1/status",
        response_url: "https://queue.fal.run/openrouter/router/requests/req1",
        cancel_url:
          "https://queue.fal.run/openrouter/router/requests/req1/cancel",
      });
    if (String(url).endsWith("/status"))
      return Response.json({ status: pending ? "IN_QUEUE" : "COMPLETED" });
    if (String(url).endsWith("/cancel")) return Response.json({});
    return Response.json({
      output: "```json\n" + JSON.stringify(content) + "\n```",
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 100,
        total_tokens: 1100,
        cost: 0.0005,
        private_key: "never-persist",
      },
    });
  });
});
it("uploads with a fal key and submits the documented Gemini model without Google credentials", async () => {
  const provider = new FalVideoProvider([model], "fal-test-key", true, fetcher);
  const media = await provider.prepare(
    input,
    new Uint8Array([1, 2]),
    "video/mp4",
  );
  expect(media).toMatchObject({ uri: fileUrl, ready: true });
  expect(calls[0].url).toBe(
    "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
  );
  expect(calls[0].init?.headers).toMatchObject({
    Authorization: "Key fal-test-key",
    "X-Fal-Object-Lifecycle": JSON.stringify({
      expiration_duration_seconds: 86400,
    }),
  });
  expect(new Headers(calls[1].init?.headers).has("Authorization")).toBe(false);
  expect(calls[1].init?.redirect).toBe("error");
  const ticket = await provider.submit(input, media.uri);
  const body = JSON.parse(String(calls[2].init?.body));
  expect(body).toMatchObject({
    model: "google/gemini-3.8-flash",
    video_urls: [fileUrl],
    max_tokens: 8192,
    reasoning: false,
    temperature: 0,
    enable_web_search: false,
  });
  expect(body).not.toHaveProperty("fps");
  expect(body).not.toHaveProperty("response_format");
  expect(body.system_prompt).toContain("evidenceIds");
  const result = await provider.collect(ticket, input);
  expect(result).toMatchObject({
    kind: "analysis",
    data: content,
    costCents: null,
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      cost: 0.0005,
    },
  });
  expect(JSON.stringify(result)).not.toContain("never-persist");
  expect(JSON.stringify(media)).not.toContain("private-upload-signature");
});
it.each([
  "https://evil.test/upload",
  "https://fal.media.evil.test/upload",
  "http://v3.fal.media/upload",
  "https://secret@v3.fal.media/upload",
  "https://127.0.0.1/upload",
])(
  "rejects untrusted upload destination %s before sending bytes",
  async (url) => {
    const call = vi.fn(async () =>
      Response.json({ file_url: fileUrl, upload_url: url }),
    );
    await expect(
      new FalVideoProvider([model], "key", true, call).prepare(
        input,
        new Uint8Array([1]),
        "video/mp4",
      ),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(call).toHaveBeenCalledTimes(1);
  },
);
it("rejects undocumented sampling overrides, wrong endpoints and model substitutions", () => {
  for (const m of [
    { ...model, endpoint: "fal-ai/video-understanding" },
    { ...model, parameters: { ...model.parameters, fps: 8 } },
    {
      ...model,
      parameters: { ...model.parameters, model: "google/gemini-2.5-flash" },
    },
  ])
    expect(() =>
      new FalVideoProvider([m], "key", true).validate(input),
    ).toThrow();
});
it("checks upload and source limits before submitting paid work", async () => {
  const provider = new FalVideoProvider(
    [{ ...model, parameters: { ...model.parameters, maxBytes: 2 } }],
    "key",
    true,
    fetcher,
  );
  await expect(
    provider.prepare(input, new Uint8Array([1, 2, 3]), "video/mp4"),
  ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
  expect(() =>
    provider.validateSource(input, {
      kind: "video",
      mime: "video/mp4",
      bytes: 1,
      metadata: { durationMs: 60001 },
    } as any),
  ).toThrow();
  expect(calls).toHaveLength(0);
});
it("focuses the prompt using source time without claiming API cropping or known FPS", async () => {
  const provider = new FalVideoProvider([model], "key", true, fetcher);
  await provider.submit(
    { ...input, range: { startMs: 1000, endMs: 2000 } },
    fileUrl,
  );
  const body = JSON.parse(String(calls[0].init?.body));
  expect(body.prompt).toContain("1000..2000ms");
  expect(body).not.toHaveProperty("start_offset");
  expect(provider.analysisSettings(input)).toMatchObject({
    fps: null,
    mode: "provider_controlled",
    rangeControl: "prompt",
    upstreamModel: "google/gemini-3.8-flash",
  });
});
it("never retries an ambiguous paid submission", async () => {
  const call = vi.fn(async () => {
    throw Error("secret transport details");
  });
  await expect(
    new FalVideoProvider([model], "key", true, call).submit(input, fileUrl),
  ).rejects.toMatchObject({ code: "SUBMISSION_UNKNOWN" });
  expect(call).toHaveBeenCalledTimes(1);
});
let db: Database | undefined, dir: string | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});
it("runs quote → upload → restart → report → adaptation through the configured fal connection", async () => {
  db = await Database.open();
  dir = await mkdtemp(join(tmpdir(), "fal-reference-"));
  const config = parseModelConfig({
    schemaVersion: 1,
    mode: "custom",
    providers: [
      {
        id: "fal-analysis",
        adapter: "fal-video",
        keyEnv: "FAL_KEY",
        enabled: true,
        models: [model],
      },
    ],
  });
  const service = new Service(
    db,
    new LocalStorage(dir),
    buildProviders(config, { FAL_KEY: "key" }, fetcher),
    "external",
  );
  const c = await service.authenticate(
    (await service.createAccount("fal analysis", 100)).key,
  );
  const source = await service.registerAsset(c.accountId, new Uint8Array([1]), {
    name: "test.mp4",
    kind: "video",
    mime: "video/mp4",
    metadata: { durationMs: 2000, hasAudio: false },
    provenance: { evidence: "contract-mock" },
  });
  const ready = await callTool(service, c, "reference_analyze", {
    assetId: source.id,
    model: model.id,
  });
  expect(ready.status).toBe("quote_required");
  expect(calls).toHaveLength(0);
  const job = await service.submit(c, {
    quoteId: ready.quote.id,
    input: ready.input,
    idempotencyKey: "same-analysis",
  });
  pending = true;
  await new Worker(service).tick();
  pending = false;
  await new Worker(service).tick();
  const completed = await service.get(c, "job", job.id);
  expect(completed.status).toBe("completed");
  expect(completed.providerUsage).toMatchObject({
    total_tokens: 1100,
    cost: 0.0005,
  });
  expect(completed.providerActualCostCents).toBeNull();
  const report = await callTool(service, c, "reference_analysis_get", {
    analysisAssetId: completed.outputs[0],
  });
  expect(report.coverage).toMatchObject({
    fps: null,
    mode: "provider_controlled",
    rangeControl: "prompt",
    submittedRange: { startMs: 0, endMs: 2000 },
  });
  expect(report.provenance.upstreamModel).toBe("google/gemini-3.8-flash");
  const plan = await callTool(service, c, "reference_adapt", {
    analysisAssetId: completed.outputs[0],
    title: "Remake",
  });
  expect(plan.composition.scenes[0].durationMs).toBe(2000);
  expect(
    calls.filter(
      (x) =>
        x.init?.method === "POST" && x.url.startsWith("https://queue.fal.run/"),
    ),
  ).toHaveLength(1);
  expect(calls.every((x) => !x.url.includes("googleapis.com"))).toBe(true);
});
it('keeps existing fal generation routes available alongside native video analysis', async () => {
 const image:Model={id:'image',endpoint:'test/image',kind:'image',maxCostCents:0,priceVersion:'test',hardBoundConfirmed:false,parameters:{}};
 const provider=new FalVideoProvider([image,{...model,maxCostCents:0,hardBoundConfirmed:false}],'test',true,fetcher,{testing:true});
 expect(provider.describe().every(m=>m.available)).toBe(true);
 expect(provider.validate({kind:'generate',model:'image',prompt:'product',parameters:{}}).id).toBe('image');
 await provider.submit({kind:'generate',model:'image',prompt:'product',parameters:{}});
 expect(JSON.parse(calls.at(-1)!.init!.body as string).prompt).toBe('product');
});
