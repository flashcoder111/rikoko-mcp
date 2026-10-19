import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { completeUpload } from "../packages/core/src/assets.js";
import { LocalStorage, sha256 } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { klingO3Models } from "../packages/providers/src/kling-o3.js";
import { media } from "../packages/render/src/media.js";
import { Worker } from "../apps/worker/src/worker.js";
import { callTool } from "../packages/mcp/src/tools.js";
import {
  compositionSchema,
  type Context,
  type Entity,
} from "../packages/contracts/src/index.js";

const downloads = vi.hoisted(() => ({ bytes: new Uint8Array() }));
vi.mock("../packages/storage/src/download.js", () => ({
  downloadPublic: async () => downloads.bytes,
}));
let root: string,
  dir: string,
  db: Database,
  service: Service,
  context: Context,
  source: Entity;
let sourceBytes: Buffer, posts: Record<string, unknown>[];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rikoko-o3-workflow-"));
  const result = await media({
    command: "render",
    workDir: root,
    assets: {},
    composition: compositionSchema.parse({
      schemaVersion: 1,
      title: "Local protocol fixture",
      width: 720,
      height: 720,
      scenes: [{ id: "a", durationMs: 3000, text: "", color: "#173b42" }],
    }),
  });
  sourceBytes = await readFile(result.output);
  downloads.bytes = new Uint8Array(sourceBytes);
});
beforeEach(async () => {
  dir = await mkdtemp(join(root, "case-"));
  db = await Database.open();
  posts = [];
  const provider = new FalProvider(
    [
      {
        ...klingO3Models[0],
        hardBoundConfirmed: true,
        maxCostCents: 10,
        priceVersion: "fixture",
      },
    ],
    "fixture",
    true,
    async (_url, init) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return Response.json({
          request_id: "o3",
          status_url:
            "https://queue.fal.run/fal-ai/kling-video/requests/o3/status",
          response_url: "https://queue.fal.run/fal-ai/kling-video/requests/o3",
          cancel_url:
            "https://queue.fal.run/fal-ai/kling-video/requests/o3/cancel",
        });
      }
      if (String(_url).endsWith("/status"))
        return Response.json({ status: "COMPLETED" });
      return Response.json({ video: { url: "https://fal.media/mock-o3.mp4" } });
    },
  );
  service = new Service(db, new LocalStorage(dir), provider);
  context = await service.authenticate(
    (await service.createAccount("O3 protocol test", 100)).key,
  );
  const intent = await service.createUpload(context, {
    name: "original.mp4",
    bytes: sourceBytes.length,
    sha256: sha256(sourceBytes),
    source: "local-fixture",
    license: "original",
    rightsConfirmed: true,
  });
  source = await completeUpload(service, context, intent.id, sourceBytes);
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
const input = (sourceId: string) => ({
  kind: "generate",
  model: "kling-o3-video-edit",
  mode: "video_to_video",
  parameters: {},
  prompt:
    "In @Video1 change only the background; preserve the subject and camera movement.",
  references: [{ assetId: sourceId, role: "source_video" }],
});

async function preparedInput(sourceId: string, owner = context) {
  const direction = {
    mode: "video_to_video",
    subject: "The target product",
    action: "Update product appearance",
    endState: { product: "updated while camera movement remains" },
    references: [
      {
        assetId: sourceId,
        role: "source_video",
        instruction: "Preserve the camera path and timing",
      },
    ],
  };
  const draft: any = await callTool(
    service,
    owner,
    "generation_prompt_preview",
    { ...direction, model: "kling-o3-video-edit" },
  );
  const prepared: any = await callTool(service, owner, "generation_prepare", {
    direction: draft.direction,
    input: {
      ...input(sourceId),
      prompt: draft.prompt,
      target: { width: 720, height: 720, aspectPolicy: "contain" },
    },
  });
  expect(prepared.providerRequest.referenceBindings[0].token).toBe("@Video1");
  return prepared.input;
}

it("quotes the probed source, submits once, imports the output and renders a replacement with existing captions", async () => {
  expect(source).toMatchObject({
    mime: "video/mp4",
    metadata: { container: "mp4", durationMs: 3000 },
  });
  const request = await preparedInput(source.id);
  const quote = await service.quote(context, request);
  expect(posts).toHaveLength(0);
  const job = await service.submit(context, {
    quoteId: quote.id,
    input: request,
    idempotencyKey: "o3-once",
  });
  const worker = new Worker(service);
  await worker.tick();
  await worker.tick();
  const completed = await service.get(context, "job", job.id);
  expect(completed.status).toBe("completed");
  expect(completed.outputs).toHaveLength(1);
  const output = await service.get(context, "asset", completed.outputs[0]);
  expect(output).toMatchObject({
    kind: "video",
    metadata: { container: "mp4", durationMs: 3000 },
  });
  expect(posts).toEqual([
    {
      keep_audio: true,
      prompt: request.prompt,
      video_url: expect.stringMatching(/^data:video\/mp4;base64,/),
    },
  ]);
  expect(
    (
      await service.submit(context, {
        quoteId: quote.id,
        input: request,
        idempotencyKey: "o3-once",
      })
    ).id,
  ).toBe(job.id);
  expect(posts).toHaveLength(1);

  const first: any = await callTool(service, context, "workspace_commit", {
    origin: "chat",
    message: "Original",
    idempotencyKey: "create",
    action: {
      type: "create",
      composition: {
        schemaVersion: 1,
        title: "Edited video",
        width: 720,
        height: 720,
        scenes: [
          {
            id: "shot",
            assetId: source.id,
            durationMs: 3000,
            text: "保留字幕",
          },
        ],
      },
    },
  });
  const edited: any = await callTool(service, context, "workspace_commit", {
    projectId: first.projectId,
    baseRevisionId: first.revisionId,
    origin: "chat",
    message: "Replace only the edited visual",
    idempotencyKey: "replace",
    action: {
      type: "edit",
      edits: [
        {
          type: "visual",
          sceneId: "shot",
          assetId: output.id,
          preserveAudio: true,
        },
      ],
    },
  });
  const revision = await service.get(context, "revision", edited.revisionId);
  expect(revision.composition.scenes[0]).toMatchObject({
    assetId: output.id,
    text: "保留字幕",
    durationMs: 3000,
  });
  await worker.tick();
  await worker.tick();
  expect((await service.get(context, "job", edited.jobId)).status).toBe(
    "completed",
  );
  expect(posts).toHaveLength(1);
});
it("rejects foreign references and changed sources without submitting to fal", async () => {
  const foreign = await service.authenticate(
    (await service.createAccount("Foreign", 100)).key,
  );
  await expect(preparedInput(source.id, foreign)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const request = await preparedInput(source.id);
  const quote = await service.quote(context, request);
  await db.transaction((tx) => tx.put({ ...source, sha256: "changed" }));
  await expect(
    service.submit(context, {
      quoteId: quote.id,
      input: request,
      idempotencyKey: "changed",
    }),
  ).rejects.toMatchObject({ code: "PREPARED_REFERENCE_CHANGED" });
  expect(posts).toHaveLength(0);
});
