import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service, fingerprint } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { connectServices } from "../packages/cloud-client/src/index.js";
import {
  cloudPreparationProtocol,
  prepareCloudGeneration,
  bindCloudPreparation,
  syncCloudProductionContext,
  referenceDeclaration,
} from "../packages/core/src/cloud-preparation.js";
import { validatePreparedGeneration } from "../packages/core/src/generation-preparation.js";
let db: Database,
  remoteDb: Database,
  local: Service,
  remote: Service,
  c: any,
  rc: any,
  foreign: any,
  dir: string,
  gateway: any;
const requests: { path: string; body: any }[] = [];
const providerCalls = vi.fn();
const direction = {
  mode: "text_to_image",
  subject: "A blue box",
  action: "Show the closed lid",
  initialState: '{"lid":"closed"}',
  endState: '{"lid":"closed"}',
};
const model = {
  id: "fixture",
  kind: "image" as const,
  endpoint: "fixture/image",
  maxCostCents: 5,
  priceVersion: "1",
  hardBoundConfirmed: true,
  parameters: { aspect_ratio: "16:9" },
};
const fetcher: typeof fetch = async (url, init) => {
  const path = new URL(String(url)).pathname,
    body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (path === "/v1/generation-models")
    return Response.json(remote.provider.describe());
  requests.push({ path, body });
  try {
    let result: any;
    if (path === "/v1/generation-protocol")
      result = { protocol: cloudPreparationProtocol };
    else if (path === "/v1/production-context")
      result = await syncCloudProductionContext(remote, rc, body);
    else if (path === "/v1/generation-preparations")
      result = await prepareCloudGeneration(remote, rc, body);
    else if (path.endsWith("/bind"))
      result = await bindCloudPreparation(remote, rc, path.split("/")[3], body);
    else if (path === "/v1/quotes") result = await remote.quote(rc, body.input);
    else if (path === "/v1/generations") result = await remote.submit(rc, body);
    else if (path.startsWith("/v1/generations/"))
      result = await remote.get(rc, "job", path.split("/")[3]);
    else throw new Error(`Unexpected route ${path}`);
    return Response.json(result);
  } catch (e: any) {
    return Response.json(
      { error: { code: e.code, message: e.message } },
      { status: e.status ?? 400 },
    );
  }
};
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cloud-prep-contract-"));
  db = await Database.open();
  remoteDb = await Database.open();
  local = new Service(db, new LocalStorage(join(dir, "local")));
  remote = new Service(
    remoteDb,
    new LocalStorage(join(dir, "remote")),
    new FalProvider(
      [
        model,
        {
          ...model,
          id: "video",
          kind: "video",
          endpoint: "minimax/h3/text-to-video",
          parameters: { duration: 4, aspect_ratio: "9:16" },
        },
      ],
      "fixture",
      true,
      providerCalls,
    ),
  );
  c = await local.authenticate((await local.createAccount("Host", 1000)).key);
  rc = await remote.authenticate(
    (await remote.createAccount("Cloud", 1000)).key,
  );
  foreign = await remote.authenticate(
    (await remote.createAccount("Other", 1000)).key,
  );
  gateway = connectServices(
    local,
    { gatewayOrigin: "https://cloud.example.com", gatewayKey: "test" },
    fetcher,
  ).gateway!;
});
afterAll(async () => {
  await db.close();
  await remoteDb.close();
  await rm(dir, { recursive: true, force: true });
});
it("preserves saved sceneDirection and its exact prompt across cloud preparation", async () => {
  const sceneDirection =
    "One continuous 4-second macro shot. A closed blue box rests on the table. Open its hinged lid by 2 seconds and hold it open. The camera stays fixed in soft side light.";
  const saved: any = await callTool(local, c, "production_plan_save", {
    plan: {
      title: "Concise cloud scene",
      knowledge: {
        format: "formats/process-broll",
        crafts: ["craft/production-quality"],
      },
      treatment: {
        intent: "Make the reveal legible",
        approach: "Show contact then the open result",
        successCriteria: ["The open interior is visible"],
      },
      width: 720,
      height: 1280,
      shots: [
        {
          id: "open",
          initialState: { lid: "closed" },
          action: "Open lid",
          endState: { lid: "open" },
          sceneDirection,
        },
      ],
    },
  });
  const preview: any = await callTool(local, c, "production_shot_prompts", {
    planId: saved.id,
    expectedVersion: saved.version,
    shotId: "open",
    subject: "Blue box",
    mode: "text_to_video",
  });
  const request: any = await callTool(local, c, "workspace_request_save", {
    message: sceneDirection,
  });
  const result = await gateway.prepare(c, {
    request: { requestId: request.requestId, expectedVersion: 1 },
    input: { kind: "generate", model: "video", prompt: preview.video.prompt },
    direction: preview.video.direction,
    plan: { planId: saved.id, expectedVersion: saved.version, shotId: "open" },
  });
  expect(result.prompt.direction.sceneDirection).toBe(sceneDirection);
  expect(result.providerRequest.prompt).toBe(preview.video.prompt);
  expect(result.prompt.compilerVersion).toBe("rikoko-prompt-compiler-v5");
  expect(result.prompt.overridden).toBe(false);
  expect(result.plan.directorIntent.treatment).toEqual(saved.plan.treatment);
  expect(result.plan.directorIntent.knowledge).toEqual(saved.plan.knowledge);
  expect(result.cloud.draft.plan.directorIntent.knowledge).toEqual(
    saved.plan.knowledge,
  );
  expect(result.plan.guideVersion).toBe(saved.guideVersion);
  expect(result.cloud.draft.plan.directorIntent.treatment).toEqual(
    saved.plan.treatment,
  );
  expect(providerCalls).not.toHaveBeenCalled();
});
async function prepare(extra: any = {}) {
  const preview: any = await callTool(
    local,
    c,
    "generation_prompt_preview",
    direction,
  );
  return gateway.prepare(c, {
    input: { kind: "generate", model: "fixture", prompt: preview.prompt },
    direction,
    ...extra,
  });
}
async function formal() {
  const plan: any = await callTool(local, c, "production_plan_save", {
    plan: {
      title: "Box",
      creativeChoices: [
        { decision: "Soft studio light", reason: "Make the lid readable" },
      ],
      width: 320,
      height: 180,
      shots: [
        {
          id: "shot",
          initialState: { lid: "closed" },
          action: direction.action,
          endState: { lid: "closed" },
        },
      ],
    },
  });
  expect(plan.plan.creativeChoices).toHaveLength(1);
  const project = await local.createProject(c, {
    title: "Formal",
    brief: "Bound",
  });
  await callTool(local, c, "production_scope_save", {
    projectId: project.id,
    planId: plan.id,
    expectedPlanVersion: 1,
    expectedScopeVersion: 0,
  });
  const preview: any = await callTool(
    local,
    c,
    "generation_prompt_preview",
    direction,
  );
  const p = await prepare({
    input: {
      kind: "generate",
      model: "fixture",
      prompt: preview.prompt,
      production: { projectId: project.id, scopeVersion: 1, shotId: "shot" },
    },
    plan: { planId: plan.id, expectedVersion: 1, shotId: "shot" },
  });
  const sent = requests
    .filter(
      (request) =>
        request.path === "/v1/production-context" &&
        request.body.kind === "plan",
    )
    .at(-1)!;
  expect(sent.body.plan.creativeChoices).toEqual(plan.plan.creativeChoices);
  expect(sent.body.plan.shots).toEqual(plan.plan.shots);
  return { plan, project, p };
}
it("prepares on the cloud without upload, quote, provider call, or local model configuration", async () => {
  const start = requests.length,
    p = await prepare();
  expect(p.readyForSubmission).toBe(true);
  expect(p.cloud.draft.referenceState).toBe("declared");
  expect(requests.slice(start).map((r) => r.path)).toEqual([
    "/v1/generation-protocol",
    "/v1/generation-preparations",
  ]);
  expect(providerCalls).not.toHaveBeenCalled();
  await expect(remote.quote(rc, p.cloud.draft.input)).rejects.toMatchObject({
    code: "PREPARATION_REFERENCES_UNBOUND",
  });
  await expect(local.quote(c, p.input)).rejects.toThrow();
});
it("binds immutable cloud input through quote/submit and preserves local metadata on poll", async () => {
  const p = await prepare(),
    q = await gateway.quote(c, p.input);
  expect(q.preparedRequestHash).toBe(p.requestHash);
  expect(q.remotePreparedRequestId).not.toBe(p.cloud.draft.id);
  expect(q.remoteInput.prompt).toBe(p.input.prompt);
  const job = await gateway.submit(c, {
    input: p.input,
    quoteId: q.id,
    idempotencyKey: "cloud-once",
  });
  expect(job.preparedRequestId).toBe(p.id);
  expect((await gateway.get(c, job.id)).preparedRequestId).toBe(p.id);
  expect(
    (
      await gateway.submit(c, {
        input: p.input,
        quoteId: q.id,
        idempotencyKey: "cloud-once",
      })
    ).id,
  ).toBe(job.id);
  await expect(
    gateway.quote(c, { ...p.input, prompt: "Changed" }),
  ).rejects.toMatchObject({ code: "PREPARED_REQUEST_MISMATCH" });
  expect(providerCalls).not.toHaveBeenCalled();
});
it("mirrors plan changes so remote queued work fails validation and retries stay idempotent", async () => {
  const { p, plan } = await formal(),
    q = await gateway.quote(c, p.input);
  const job = await gateway.submit(c, {
    input: p.input,
    quoteId: q.id,
    idempotencyKey: "formal-once",
  });
  await callTool(local, c, "production_plan_save", {
    planId: plan.id,
    expectedVersion: 1,
    plan: { ...plan.plan, title: "Changed plan" },
  });
  await expect(
    remote.scoped(rc, "read", (tx) =>
      validatePreparedGeneration(remote, tx, rc.accountId, q.remoteInput),
    ),
  ).rejects.toMatchObject({ code: "PRODUCTION_SCOPE_CHANGED" });
  await expect(gateway.quote(c, p.input)).rejects.toMatchObject({
    code: "PRODUCTION_SCOPE_CHANGED",
  });
  expect(
    (
      await gateway.submit(c, {
        input: p.input,
        quoteId: q.id,
        idempotencyKey: "formal-once",
      })
    ).id,
  ).toBe(job.id);
});
it("scope rebinding invalidates remote preparation and cannot be disabled per call", async () => {
  const { p, plan, project } = await formal();
  const q = await gateway.quote(c, p.input);
  await callTool(local, c, "production_scope_save", {
    projectId: project.id,
    planId: plan.id,
    expectedPlanVersion: 1,
    expectedScopeVersion: 1,
  });
  await expect(remote.quote(rc, q.remoteInput)).rejects.toMatchObject({
    code: "PRODUCTION_SCOPE_CHANGED",
  });
  await expect(
    gateway.quote(c, { ...p.input, preparedRequestId: undefined }),
  ).rejects.toMatchObject({ code: "PRODUCTION_SCOPE_CHANGED" });
});
it("blocks context edits while disconnected and preserves the host plan", async () => {
  const { plan } = await formal();
  connectServices(local, {});
  try {
    await expect(
      callTool(local, c, "production_plan_save", {
        planId: plan.id,
        expectedVersion: 1,
        plan: { ...plan.plan, title: "Offline" },
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_SYNC_REQUIRED" });
    expect((await local.get(c, "production-plan", plan.id)).version).toBe(1);
  } finally {
    gateway = connectServices(
      local,
      { gatewayOrigin: "https://cloud.example.com", gatewayKey: "test" },
      fetcher,
    ).gateway!;
  }
});
it("requires immutable hashes, owned preparations and current model configuration", async () => {
  const p = await prepare(),
    d = p.cloud.draft;
  await expect(
    bindCloudPreparation(remote, foreign, d.id, {
      requestHash: d.requestHash,
      references: [],
    }),
  ).rejects.toMatchObject({ code: "PREPARED_REQUEST_MISMATCH" });
  await expect(
    bindCloudPreparation(remote, rc, d.id, {
      requestHash: "0".repeat(64),
      references: [],
    }),
  ).rejects.toMatchObject({ code: "PREPARED_REQUEST_MISMATCH" });
  remote.provider.models[0].parameters = { quality: "new" };
  try {
    await expect(gateway.quote(c, p.input)).rejects.toMatchObject({
      code: "PREPARED_MODEL_CHANGED",
    });
  } finally {
    remote.provider.models[0].parameters = { aspect_ratio: "16:9" };
  }
});
it("validates uploaded bytes and actual reference field order against the declared draft", async () => {
  const referenceModel = {
    ...model,
    id: "ref",
    generationInput: {
      mode: "image_edit" as const,
      bindings: [
        {
          field: "images",
          roles: ["product" as const],
          kind: "image" as const,
          array: true,
          min: 1,
          max: 2,
          maxBytes: 10000,
        },
      ],
      maxTotalBytes: 20000,
    },
  };
  remote.provider.models.push(referenceModel);
  const asset = await remote.registerAsset(rc.accountId, Buffer.from("first"), {
    name: "ref.png",
    kind: "image",
    mime: "image/png",
    metadata: { width: 320, height: 180 },
    provenance: { evidence: "test-fixture" },
  });
  const wrong = await remote.registerAsset(rc.accountId, Buffer.from("wrong"), {
    name: "ref.png",
    kind: "image",
    mime: "image/png",
    metadata: { width: 320, height: 180 },
    provenance: { evidence: "test-fixture" },
  });
  const dir = {
    ...direction,
    mode: "image_edit",
    references: [
      {
        assetId: "host-ref",
        role: "product",
        instruction: "product appearance",
        exclude: "background",
      },
    ],
  };
  const preview: any = await callTool(
    local,
    c,
    "generation_prompt_preview",
    dir,
  );
  const d = await prepareCloudGeneration(remote, rc, {
    protocol: cloudPreparationProtocol,
    request: {
      input: {
        kind: "generate",
        model: "ref",
        mode: "image_edit",
        prompt: preview.prompt,
        references: [{ assetId: "host-ref", role: "product" }],
      },
      direction: dir,
    },
    references: [{ ...referenceDeclaration(asset), id: "host-ref" }],
  });
  await expect(
    bindCloudPreparation(remote, rc, d.id, {
      requestHash: d.requestHash,
      references: [{ sourceAssetId: "host-ref", assetId: wrong.id }],
    }),
  ).rejects.toMatchObject({ code: "PREPARED_REFERENCE_CHANGED" });
  const bound = await bindCloudPreparation(remote, rc, d.id, {
    requestHash: d.requestHash,
    references: [{ sourceAssetId: "host-ref", assetId: asset.id }],
  });
  expect(bound.input.references).toEqual([
    { assetId: asset.id, role: "product" },
  ]);
  expect(bound.providerRequest.referenceBindings[0]).toMatchObject({
    field: "images",
    index: 0,
    token: "Image 1",
    assetId: asset.id,
  });
  expect((await remote.quote(rc, bound.input)).preparedRequestHash).toBe(
    bound.requestHash,
  );
});
it("rejects conflicting or rollback context versions", async () => {
  const request = {
    protocol: cloudPreparationProtocol,
    clientId: fingerprint("client"),
    localId: "plan",
    kind: "plan",
    version: 2,
    plan: {
      title: "One",
      width: 320,
      height: 180,
      shots: [{ id: "one", action: "Hold", initialState: {}, endState: {} }],
    },
  };
  const first = await syncCloudProductionContext(remote, rc, request);
  expect((await syncCloudProductionContext(remote, rc, request)).id).toBe(
    first.id,
  );
  await expect(
    syncCloudProductionContext(remote, rc, { ...request, version: 1 }),
  ).rejects.toMatchObject({ code: "PRODUCTION_CONTEXT_CONFLICT" });
  await expect(
    syncCloudProductionContext(remote, rc, {
      ...request,
      plan: { ...request.plan, title: "Two" },
    }),
  ).rejects.toMatchObject({ code: "PRODUCTION_CONTEXT_CONFLICT" });
});
