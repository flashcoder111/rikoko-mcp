import { validateStoryboardInput } from "../packages/core/src/storyboard-state.js";
import { acceptFixtureImage } from "./critical-image-fixture.js";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service, fingerprint } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider, type Model } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { Worker } from "../apps/worker/src/worker.js";
import { connectServices } from "../packages/cloud-client/src/index.js";
import * as prompts from "../packages/core/src/production-prompts.js";
import { h3Models } from "../packages/providers/src/h3.js";
import { GatewayClient } from "../packages/cloud-client/src/gateway.js";

let db: Database, service: Service, dir: string, c: any;
let provider: FalProvider, sent: any[], fetcher: ReturnType<typeof vi.fn>;
const direction = {
  mode: "text_to_video",
  subject: "A blue device",
  action: "Close the lid",
  initialState: '{"lid":"open"}',
  endState: '{"lid":"closed"}',
};
const model: Model = {
  id: "fixture-video",
  kind: "video",
  endpoint: "minimax/h3/text-to-video",
  maxCostCents: 10,
  priceVersion: "fixture",
  hardBoundConfirmed: true,
  parameters: { duration: 5, aspect_ratio: "16:9", resolution: "768P" },
  allowedParameters: { duration: { type: "integer", min: 5, max: 15 } },
};
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "preparation-test-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  c = await service.authenticate(
    (await service.createAccount("Prepared request fixtures", 10000)).key,
  );
});
beforeEach(() => {
  sent = [];
  fetcher = vi.fn(async (_url, init) => {
    if (init?.method === "POST") {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({
        request_id: "fixture",
        status_url: "https://queue.fal.run/test/status",
        response_url: "https://queue.fal.run/test/result",
        cancel_url: "https://queue.fal.run/test/cancel",
      });
    }
    return Response.json({ status: "IN_QUEUE" });
  });
  provider = new FalProvider(
    [structuredClone(model)],
    "fixture-key",
    true,
    fetcher as typeof fetch,
  );
  service.provider = provider;
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
async function prepare(extra: any = {}) {
  const preview: any = await callTool(
    service,
    c,
    "generation_prompt_preview",
    direction,
  );
  return callTool(service, c, "generation_prepare", {
    input: {
      kind: "generate",
      target: { width: 1280, height: 720 },
      model: model.id,
      prompt: preview.prompt,
      parameters: { duration: 8 },
    },
    direction,
    ...extra,
  }) as Promise<any>;
}
async function plan() {
  return callTool(service, c, "production_plan_save", {
    plan: {
      title: "Device process",
      width: 1280,
      height: 720,
      shots: [
        {
          id: "close",
          initialState: { lid: "open" },
          action: direction.action,
          endState: { lid: "closed" },
        },
      ],
    },
  }) as Promise<any>;
}
async function enqueue(prepared: any) {
  const quote = await service.quote(c, prepared.input);
  return service.submit(c, {
    quoteId: quote.id,
    input: prepared.input,
    idempotencyKey: crypto.randomUUID(),
  });
}
it("direct submission preserves preparation binding and rejects changed inputs", async () => {
  const prepared = await prepare();
  const job = await callTool(service, c, "job_submit", {
    input: prepared.input,
    idempotencyKey: "direct-prepared",
  });
  expect(job.preparedRequestId).toBe(prepared.preparedRequestId);
  await expect(
    callTool(service, c, "job_submit", {
      input: { ...prepared.input, prompt: "Changed" },
      idempotencyKey: "direct-changed",
    }),
  ).rejects.toMatchObject({ code: "PREPARED_REQUEST_MISMATCH" });
  expect(fetcher).not.toHaveBeenCalled();
  await service.cancel(c, job.id);
});
it("persists a frozen request and binds quote and job without provider calls", async () => {
  const p = await prepare();
  expect(p.preparedRequestId).toBeTruthy();
  const record = await service.get(
    c,
    "generation-preparation",
    p.preparedRequestId,
  );
  expect(record.input).toEqual(p.input);
  expect(record.inputHash).toBe(fingerprint(p.input));
  expect(record.prompt.templateVersion).toBe("rikoko-direction-v2");
  expect(record.prompt.text).toBe(p.input.prompt);
  const quote = await service.quote(c, p.input);
  expect(quote.preparedRequestId).toBe(p.preparedRequestId);
  const job = await service.submit(c, {
    quoteId: quote.id,
    input: p.input,
    idempotencyKey: "prepared-once",
  });
  expect(job.preparedRequestHash).toBe(record.requestHash);
  expect(fetcher).not.toHaveBeenCalled();
  await service.cancel(c, job.id);
});
it("rejects edits, forged IDs, foreign records and stale model profiles before quotation", async () => {
  const p = await prepare();
  for (const changed of [
    { ...p.input, prompt: "Different" },
    { ...p.input, parameters: { duration: 9 } },
  ])
    await expect(service.quote(c, changed)).rejects.toMatchObject({
      code: "PREPARED_REQUEST_MISMATCH",
    });
  await expect(
    service.quote(c, { ...p.input, preparedRequestId: "missing" }),
  ).rejects.toMatchObject({ code: "PREPARED_REQUEST_NOT_FOUND" });
  const stranger = await service.authenticate(
    (await service.createAccount("Other preparation", 100)).key,
  );
  await expect(service.quote(stranger, p.input)).rejects.toMatchObject({
    code: "PREPARED_REQUEST_NOT_FOUND",
  });
  provider.models[0].parameters.resolution = "1080P";
  await expect(service.quote(c, p.input)).rejects.toMatchObject({
    code: "PREPARED_MODEL_CHANGED",
  });
});
it("uses saved target states and invalidates the preparation after a plan revision", async () => {
  const saved = await plan();
  const p = await prepare({
    plan: { planId: saved.id, expectedVersion: saved.version, shotId: "close" },
  });
  expect(p.input.target).toMatchObject({ width: 1280, height: 720 });
  const q = await service.quote(c, p.input);
  await callTool(service, c, "production_plan_save", {
    planId: saved.id,
    expectedVersion: saved.version,
    plan: { ...saved.plan, title: "New direction" },
  });
  await expect(
    service.submit(c, {
      quoteId: q.id,
      input: p.input,
      idempotencyKey: "stale-plan",
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_SCOPE_CHANGED" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("requires a manual override reason while keeping the original compiled text", async () => {
  const input = {
    kind: "generate",
    target: { width: 1280, height: 720 },
    model: model.id,
    prompt: "Handwritten closing shot",
  };
  await expect(prepare({ input })).rejects.toMatchObject({
    code: "PROMPT_OVERRIDE_REASON_REQUIRED",
  });
  const p = await prepare({
    input,
    promptOverride: { reason: "Use a shorter approved description" },
  });
  expect(p.prompt).toMatchObject({
    text: input.prompt,
    overrideReason: "Use a shorter approved description",
    overridden: true,
  });
  expect(p.prompt.baseText).toContain(direction.action);
  await expect(
    callTool(service, c, "generation_prepare", { input }),
  ).rejects.toMatchObject({ code: "PROMPT_OVERRIDE_REASON_REQUIRED" });
});
it("blocks stale queued work before sending and releases the reservation", async () => {
  const reservedBefore = (await service.usage(c)).reservedCents;
  const saved = await plan();
  const p = await prepare({
    plan: { planId: saved.id, expectedVersion: saved.version, shotId: "close" },
  });
  const job = await enqueue(p);
  await callTool(service, c, "production_plan_save", {
    planId: saved.id,
    expectedVersion: saved.version,
    plan: { ...saved.plan, title: "Changed while queued" },
  });
  await new Worker(service).tick();
  expect(fetcher).not.toHaveBeenCalled();
  expect(await service.get(c, "job", job.id)).toMatchObject({
    status: "failed",
    error: { code: "PRODUCTION_SCOPE_CHANGED" },
    reservedCents: 10,
    chargedCents: 0,
  });
  expect((await service.usage(c)).reservedCents).toBe(reservedBefore);
});
it("sends exactly the previewed prompt and parameters and resumes the original request", async () => {
  const p = await prepare();
  const job = await enqueue(p);
  const worker = new Worker(service);
  await worker.tick();
  expect(sent).toEqual([
    { ...model.parameters, duration: 8, prompt: p.input.prompt },
  ]);
  await worker.tick();
  expect(sent).toHaveLength(1);
  await service.cancel(c, job.id);
  // Avoid leaving a queued fixture for later cases.
  await service.scoped(c, "write", async (tx) => {
    const j = await tx.get(job.id, c.accountId, "job");
    await tx.put({ ...j!, status: "cancelled" });
  });
});
it("does not forward local preparations to the cloud", async () => {
  const p = await prepare();
  const cloudFetch = vi.fn(async () => Response.json([]));
  connectServices(
    service,
    { gatewayOrigin: "https://cloud.example.com", gatewayKey: "fixture" },
    cloudFetch as typeof fetch,
  );
  try {
    await expect(
      callTool(service, c, "quote_create", { input: p.input }),
    ).rejects.toMatchObject({ code: "PREPARATION_ROUTE_MISMATCH" });
    expect(cloudFetch).not.toHaveBeenCalled();
  } finally {
    connectServices(service, {});
  }
});

async function referenceFixture() {
  const asset = await service.registerAsset(
    c.accountId,
    new Uint8Array([1, 2, 3]),
    {
      name: "contract-fixture.png",
      kind: "image",
      mime: "image/png",
      metadata: { width: 320, height: 180 },
      provenance: { evidence: "contract-mock" },
    },
  );
  await acceptFixtureImage(service, c, asset);
  provider.models[0].generationInput = {
    mode: "reference_to_video",
    outputDurationMs: 5000,
    maxTotalBytes: 1000000,
    bindings: [
      {
        field: "image_urls",
        kind: "image",
        roles: ["product", "scene"],
        array: true,
        min: 1,
        max: 4,
        maxBytes: 1000000,
      },
    ],
  };
  const d = {
    ...direction,
    mode: "reference_to_video",
    references: [
      {
        assetId: asset.id,
        role: "product",
        instruction: "Keep blue casing and product label",
      },
    ],
  };
  const preview: any = await callTool(
    service,
    c,
    "generation_prompt_preview",
    d,
  );
  const raw = {
    input: {
      kind: "generate",
      target: { width: 1280, height: 720 },
      model: model.id,
      mode: "reference_to_video",
      prompt: preview.prompt,
      references: [{ assetId: asset.id, role: "product" }],
      videoPolicy: {
        faces: "absent",
        reason: "Synthetic product-only fixture",
        references: [
          {
            assetId: asset.id,
            sha256: asset.sha256,
            faces: "absent",
            reason: "Synthetic fixture",
          },
        ],
      },
    },
    direction: d,
  };
  const prepared: any = await callTool(service, c, "generation_prepare", raw);
  return { asset, prepared, raw };
}

it("previews real field/index bindings and sends the same ordered asset bytes", async () => {
  const { asset, prepared } = await referenceFixture();
  expect(prepared.providerRequest.referenceBindings).toEqual([
    {
      assetId: asset.id,
      role: "product",
      inputIndex: 0,
      field: "image_urls",
      array: true,
      index: 0,
      token: "Image 1",
    },
  ]);
  const record: any = await callTool(service, c, "record_get", {
    type: "generation-preparation",
    id: prepared.preparedRequestId,
  });
  expect(record.requestHash).toBe(prepared.requestHash);
  const job = await enqueue(prepared);
  await new Worker(service).tick();
  expect(sent[0]).toMatchObject({
    prompt: prepared.input.prompt,
    image_urls: ["data:image/png;base64,AQID"],
  });
  expect(JSON.stringify(record)).not.toContain("fixture-key");
  expect(JSON.stringify(record)).not.toContain("data:image");
  await service.scoped(c, "write", async (tx) => {
    const j = await tx.get(job.id, c.accountId, "job");
    await tx.put({ ...j!, status: "cancelled" });
  });
});

it("invalidates reference metadata or bytes even before the quote snapshot exists", async () => {
  const { asset, prepared } = await referenceFixture();
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...asset, metadata: { ...asset.metadata, width: 640 } }),
  );
  await expect(service.quote(c, prepared.input)).rejects.toMatchObject({
    code: "PREPARED_REFERENCE_CHANGED",
  });
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...asset, sha256: "different" }),
  );
  await expect(service.quote(c, prepared.input)).rejects.toMatchObject({
    code: "PREPARED_REFERENCE_CHANGED",
  });
});

it("rejects wrong model modes, input responsibilities and invalid handwritten parameters", async () => {
  const { raw } = await referenceFixture();
  await expect(
    callTool(service, c, "generation_prepare", {
      ...raw,
      input: {
        ...raw.input,
        references: [{ ...raw.input.references[0], role: "scene" }],
      },
    }),
  ).rejects.toMatchObject({ code: "PROMPT_REFERENCE_MISMATCH" });
  await expect(
    callTool(service, c, "generation_prepare", {
      ...raw,
      direction: { ...raw.direction, mode: "image_edit" },
    }),
  ).rejects.toThrow();
  await expect(
    callTool(service, c, "generation_prepare", {
      input: raw.input,
      promptOverride: { reason: "Handwritten" },
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_DIRECTION_REQUIRED" });
  await expect(
    callTool(service, c, "generation_prepare", {
      ...raw,
      input: { ...raw.input, prompt: "Custom", parameters: { duration: 100 } },
      promptOverride: { reason: "Does not exempt unsupported duration" },
    }),
  ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
});

it("keeps analysis-only evidence out of generated prompts and provider inputs", async () => {
  const d = {
    ...direction,
    references: [
      {
        assetId: "observation-only",
        role: "scene",
        instruction: "Study pacing",
        usage: "analysis_only",
      },
    ],
  };
  const preview: any = await callTool(
    service,
    c,
    "generation_prompt_preview",
    d,
  );
  expect(preview.bindings).toHaveLength(0);
  expect(preview.prompt).not.toContain("Study pacing");
  const p: any = await callTool(service, c, "generation_prepare", {
    input: {
      kind: "generate",
      target: { width: 1280, height: 720 },
      model: model.id,
      prompt: preview.prompt,
    },
    direction: d,
  });
  expect(p.references).toHaveLength(0);
  expect(p.providerRequest.referenceBindings).toHaveLength(0);
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects reference numbering that disagrees with provider field order", async () => {
  const { raw } = await referenceFixture();
  provider.models[0].generationInput!.bindings = [
    {
      field: "scene_image",
      roles: ["scene"],
      kind: "image",
      array: false,
      min: 1,
      max: 1,
      maxBytes: 1000000,
    },
    {
      field: "product_image",
      roles: ["product"],
      kind: "image",
      array: false,
      min: 1,
      max: 1,
      maxBytes: 1000000,
    },
  ];
  const refs = [
    raw.direction.references[0],
    { ...raw.direction.references[0], role: "scene" },
  ];
  const d = { ...raw.direction, references: refs };
  const preview: any = await callTool(
    service,
    c,
    "generation_prompt_preview",
    d,
  );
  await expect(
    callTool(service, c, "generation_prepare", {
      input: {
        ...raw.input,
        prompt: preview.prompt,
        references: refs.map(({ assetId, role }) => ({ assetId, role })),
      },
      direction: d,
    }),
  ).rejects.toMatchObject({ code: "PROMPT_BINDING_MISMATCH" });
});

it("retains saved prompt/template bytes when later previews use a new template", async () => {
  const p = await prepare();
  const original = prompts.compilePrompt;
  const spy = vi.spyOn(prompts, "compilePrompt").mockImplementation((raw) => ({
    ...original(raw),
    templateVersion: "next-fixture-version",
    prompt: "New template wording",
  }));
  try {
    const q = await service.quote(c, p.input);
    expect(q.templateVersion).toBe("rikoko-direction-v2");
    const stored = await service.get(
      c,
      "generation-preparation",
      p.preparedRequestId,
    );
    expect(stored.prompt.text).toBe(p.input.prompt);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it("keeps idempotent job lookup after a plan revision without buying a second job", async () => {
  const saved = await plan();
  const p = await prepare({
    plan: { planId: saved.id, expectedVersion: saved.version, shotId: "close" },
  });
  const q = await service.quote(c, p.input);
  const args = { input: p.input, quoteId: q.id, idempotencyKey: "plan-retry" };
  const job = await service.submit(c, args);
  await callTool(service, c, "production_plan_save", {
    planId: saved.id,
    expectedVersion: saved.version,
    plan: { ...saved.plan, title: "Changed" },
  });
  expect((await service.submit(c, args)).id).toBe(job.id);
  await service.cancel(c, job.id);
});

it("rechecks after reference resolution and does not classify a known pre-send rejection as unknown spending", async () => {
  const { prepared, asset } = await referenceFixture();
  const job = await enqueue(prepared);
  service.storage.providerUrl = async () => {
    await service.scoped(c, "write", (tx) =>
      tx.put({ ...asset, sha256: "changed-during-resolution" }),
    );
    return "https://owned.example/fixture.png";
  };
  try {
    await new Worker(service).tick();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await service.get(c, "job", job.id)).toMatchObject({
      status: "failed",
      error: { code: "PREPARED_REFERENCE_CHANGED" },
      chargedCents: 0,
    });
  } finally {
    delete service.storage.providerUrl;
  }
});

it("uses the configured MiniMax H3 profile in captured provider requests without real generation", async () => {
  provider.models = [structuredClone(h3Models[0])];
  const preview: any = await callTool(
    service,
    c,
    "generation_prompt_preview",
    direction,
  );
  const p: any = await callTool(service, c, "generation_prepare", {
    input: {
      kind: "generate",
      target: { width: 720, height: 1280 },
      model: provider.models[0].id,
      prompt: preview.prompt,
      parameters: { duration: 8, aspect_ratio: "9:16" },
    },
    direction,
  });
  const job = await enqueue(p);
  await new Worker(service).tick();
  expect(sent[0]).toEqual({
    ...h3Models[0].parameters,
    duration: 8,
    aspect_ratio: "9:16",
    prompt: preview.prompt,
  });
  await service.scoped(c, "write", async (tx) => {
    const j = await tx.get(job.id, c.accountId, "job");
    await tx.put({ ...j!, status: "cancelled" });
  });
});

it("rejects direct cloud submission without an owned quote before network or upload", async () => {
  const p = await prepare();
  const cloudFetch = vi.fn(async () => Response.json({}));
  const client = new GatewayClient(
    service,
    "https://cloud.example.com",
    "fixture",
    cloudFetch as typeof fetch,
  );
  await expect(
    client.submit(c, {
      input: p.input,
      quoteId: "missing",
      idempotencyKey: "no-cloud",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(cloudFetch).not.toHaveBeenCalled();
});

it("allows read-only preview and retrieval but requires write permission to save a preparation", async () => {
  const p = await prepare();
  const key = await service.issueKey(c, {
    name: "Read-only fixture",
    scopes: ["read"],
    budgetCents: 0,
  });
  const reader = await service.authenticate(key.key);
  await expect(
    callTool(service, reader, "generation_prompt_preview", direction),
  ).resolves.toMatchObject({ readyForSubmission: false });
  await expect(
    callTool(service, reader, "record_get", {
      type: "generation-preparation",
      id: p.preparedRequestId,
    }),
  ).resolves.toMatchObject({ requestHash: p.requestHash });
  await expect(
    callTool(service, reader, "generation_prepare", {
      input: { ...p.input, preparedRequestId: undefined },
      direction,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("rejects mismatched plan content, dimensions, versions, shots and mutation of saved records", async () => {
  const saved = await plan();
  const link = {
    planId: saved.id,
    expectedVersion: saved.version,
    shotId: "close",
  };
  await expect(
    prepare({
      plan: link,
      direction: { ...direction, action: "Reopen it" },
      promptOverride: { reason: "Cannot override target state binding" },
    }),
  ).rejects.toMatchObject({ code: "PLAN_DIRECTION_MISMATCH" });
  await expect(
    prepare({ plan: { ...link, expectedVersion: 99 } }),
  ).rejects.toMatchObject({ code: "PLAN_CONFLICT" });
  await expect(
    prepare({ plan: { ...link, shotId: "absent" } }),
  ).rejects.toMatchObject({ code: "INVALID_SHOT" });
  const preview = prompts.compilePrompt(direction);
  await expect(
    prepare({
      plan: link,
      input: {
        kind: "generate",
        model: model.id,
        prompt: preview.prompt,
        target: { width: 720, height: 1280 },
      },
    }),
  ).rejects.toMatchObject({ code: "PLAN_TARGET_MISMATCH" });
  const p = await prepare({ plan: link });
  await expect(prepare({ input: p.input })).rejects.toMatchObject({
    code: "PREPARED_REQUEST_IMMUTABLE",
  });
  const record = await service.get(
    c,
    "generation-preparation",
    p.preparedRequestId,
  );
  await service.scoped(c, "write", (tx) =>
    tx.put({
      ...record,
      prompt: { ...record.prompt, text: "Changed persisted text" },
    }),
  );
  await expect(service.quote(c, p.input)).rejects.toMatchObject({
    code: "PREPARED_REQUEST_INVALID",
  });
});

it("quotes frozen storyboard requests without rebuilding their prompt", async () => {
  const { asset, raw } = await referenceFixture();
  const board = {
    id: "prepared-storyboard",
    type: "storyboard",
    accountId: c.accountId,
    createdAt: new Date().toISOString(),
    version: 1,
    shots: [
      {
        sourceShotId: "shot",
        durationMs: 2000,
        references: [{ assetId: asset.id, role: "product" }],
        review: {
          decision: "accepted",
          imageAssetId: asset.id,
          sha256: asset.sha256,
        },
      },
    ],
  };
  await service.scoped(c, "write", (tx) => tx.put(board));
  const d = {
    ...raw.direction,
    references: [
      {
        assetId: asset.id,
        role: "scene",
        instruction: "Reviewed target scene",
      },
    ],
  };
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan: {
      title: "Target device",
      width: 1280,
      height: 720,
      shots: [
        {
          id: "close",
          initialState: { lid: "open" },
          action: direction.action,
          endState: { lid: "closed" },
          references: d.references,
        },
      ],
    },
  });
  const preview = prompts.compilePrompt(d);
  const p: any = await callTool(service, c, "generation_prepare", {
    input: {
      ...raw.input,
      prompt: preview.prompt,
      references: [{ assetId: asset.id, role: "scene" }],
      storyboard: {
        storyboardId: board.id,
        version: 1,
        sourceShotId: "shot",
        stage: "video",
      },
    },
    direction: d,
    plan: { planId: saved.id, expectedVersion: saved.version, shotId: "close" },
  });
  const args = {
    storyboardId: board.id,
    expectedVersion: 1,
    sourceShotId: "shot",
    stage: "video",
    model: model.id,
    preparedRequestId: p.preparedRequestId,
  };
  const q: any = await callTool(service, c, "reference_storyboard_quote", args);
  expect(q.input).toEqual(p.input);
  expect(q.quote.preparedRequestHash).toBe(p.requestHash);
  await expect(
    callTool(service, c, "reference_storyboard_quote", {
      ...args,
      prompt: "Different wording",
    }),
  ).rejects.toMatchObject({ code: "PREPARED_REQUEST_MISMATCH" });
});

it("requires motion-transfer responsibility to match the selected strategy", async () => {
  await expect(
    callTool(service, c, "generation_prompt_preview", {
      ...direction,
      mode: "motion_transfer",
      references: [
        {
          assetId: "motion-fixture",
          role: "motion",
          transfer: "camera",
          instruction: "Camera arc",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "REFERENCE_RESPONSIBILITY_MISMATCH" });
});

it("inherits the plan shot duration and cannot weaken it with a shorter request target", async () => {
  const saved = await plan();
  const updated: any = await callTool(service, c, "production_plan_save", {
    planId: saved.id,
    expectedVersion: saved.version,
    plan: {
      ...saved.plan,
      shots: [{ ...saved.plan.shots[0], durationMs: 12000 }],
    },
  });
  const link = {
    planId: updated.id,
    expectedVersion: updated.version,
    shotId: "close",
  };
  await expect(prepare({ plan: link })).rejects.toMatchObject({
    code: "GENERATION_TOO_SHORT",
  });
  const p = await prepare({
    plan: link,
    input: {
      kind: "generate",
      model: model.id,
      prompt: prompts.compilePrompt(direction).prompt,
      parameters: { duration: 12 },
      target: { width: 1280, height: 720, minDurationMs: 1000 },
    },
  });
  expect(p.input.target.minDurationMs).toBe(12000);
});

it("does not select image editing when a plan has only analysis references", async () => {
  const saved = await plan();
  const asset = await service.registerAsset(
    c.accountId,
    new Uint8Array([4, 5, 6]),
    {
      name: "analysis.png",
      kind: "image",
      mime: "image/png",
      metadata: { width: 320, height: 180 },
      provenance: { evidence: "contract-mock" },
    },
  );
  const updated: any = await callTool(service, c, "production_plan_save", {
    planId: saved.id,
    expectedVersion: saved.version,
    plan: {
      ...saved.plan,
      shots: [
        {
          ...saved.plan.shots[0],
          references: [
            {
              assetId: asset.id,
              role: "scene",
              instruction: "Observe the setting",
              usage: "analysis_only",
            },
          ],
        },
      ],
    },
  });
  const draft: any = await callTool(service, c, "production_shot_prompts", {
    planId: updated.id,
    expectedVersion: updated.version,
    shotId: "close",
    subject: "A blue device",
    mode: "text_to_video",
  });
  expect(draft.image.direction.mode).toBe("text_to_image");
  expect(draft.video.bindings).toHaveLength(0);
  const p = await prepare({
    plan: {
      planId: updated.id,
      expectedVersion: updated.version,
      shotId: "close",
    },
    direction: draft.video.direction,
  });
  expect(p.references).toHaveLength(0);
});

it("checks storyboard duration on the prepared submission path without a public quote", async () => {
  const asset = await service.registerAsset(
    c.accountId,
    Buffer.from("fixture-image"),
    {
      name: "first.png",
      kind: "image",
      mime: "image/png",
      metadata: {},
      provenance: {},
    },
  );
  await db.transaction(async (tx) => {
    await tx.put({
      id: "duration-board",
      accountId: c.accountId,
      type: "storyboard",
      createdAt: new Date().toISOString(),
      version: 1,
      shots: [
        {
          sourceShotId: "shot",
          durationMs: 6000,
          review: {
            decision: "accepted",
            imageAssetId: asset.id,
            sha256: asset.sha256,
          },
        },
      ],
    });
    const input = {
      kind: "generate" as const,
      model: model.id,
      prompt: "Lift",
      parameters: {},
      mode: "image_to_video" as const,
      references: [{ assetId: asset.id, role: "first_frame" as const }],
      storyboard: {
        storyboardId: "duration-board",
        version: 1,
        sourceShotId: "shot",
        stage: "video" as const,
      },
    };
    for (const expectedOutput of [{ durationMs: 5000 }, {}])
      await expect(
        validateStoryboardInput(tx, c.accountId, input, expectedOutput),
      ).rejects.toMatchObject({ code: "GENERATION_TOO_SHORT" });
    await expect(
      validateStoryboardInput(tx, c.accountId, input, { durationMs: 6000 }),
    ).resolves.toBeUndefined();
  });
});
