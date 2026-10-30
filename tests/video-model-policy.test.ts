import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  operationSchema,
  type Entity,
} from "../packages/contracts/src/index.js";
import {
  remapVideoPolicy,
  type FaceStatus,
} from "../packages/contracts/src/video-policy.js";
import { assertVideoPolicy } from "../packages/providers/src/video-policy.js";
import { FalProvider, type Model } from "../packages/providers/src/index.js";
import { seedanceMiniModels } from "../packages/providers/src/seedance-mini.js";
import { resolveVideoModel } from "../packages/core/src/video-model-selection.js";
import { defaultGenerationModel } from "../packages/core/src/commands.js";
import { Database } from "../packages/db/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { modelSchema } from "../packages/providers/src/config.js";

const seedance = { ...seedanceMiniModels[0], hardBoundConfirmed: true };
const minimax: Model = {
  ...seedance,
  id: "minimax-video",
  name: "MiniMax",
  endpoint: "minimax/video",
};
const kling: Model = {
  ...seedance,
  id: "kling-video",
  name: "Kling",
  endpoint: "kling/video",
};
const network = vi.fn(async () =>
  Response.json({
    request_id: "job",
    status_url: "https://queue.fal.run/job/status",
    response_url: "https://queue.fal.run/job/result",
    cancel_url: "https://queue.fal.run/job/cancel",
  }),
);
const provider = new FalProvider(
  [kling, minimax, seedance],
  "fixture",
  true,
  network,
);
const policy = (faces: FaceStatus = "absent", model?: string) => ({
  faces,
  reason: "Explicit fixture evidence",
  references: [],
  ...(model ? { userChoice: { model, confirmed: true as const } } : {}),
});
const input = (
  model = seedance.id,
  faces: FaceStatus = "absent",
  choice?: string,
) =>
  operationSchema.parse({
    kind: "generate",
    model,
    prompt: "A landscape",
    videoPolicy: policy(faces, choice),
  });

it("selects a compatible configured default without a face-review confirmation", () => {
  expect(defaultGenerationModel(provider.describe())?.id).toBe(seedance.id);
  for (const faces of ["absent", "present", "unknown"] as const) {
    const result = resolveVideoModel({ faces }, [], provider.describe());
    expect(result).toMatchObject({
      status: "ready",
      selectedModel: seedance.id,
      userInteraction: { required: false },
    });
    expect(result.candidates).toHaveLength(3);
  }
  expect(
    resolveVideoModel({ model: kling.id }, [], provider.describe()),
  ).toMatchObject({ status: "ready", selectedModel: kling.id });
});
it("does not replace an unavailable explicit selection", () => {
  expect(
    resolveVideoModel({ model: "missing" }, [], provider.describe()),
  ).toMatchObject({ selectedModel: null, userInteraction: { required: true } });
  expect(resolveVideoModel({}, [], [])).toMatchObject({
    status: "capability_gap",
  });
});
it("accepts direct video input without review records or repeated model confirmation", () => {
  for (const model of [seedance, minimax, kling]) {
    expect(() =>
      provider.validate(
        operationSchema.parse({
          kind: "generate",
          model: model.id,
          prompt: "scene",
        }),
      ),
    ).not.toThrow();
    expect(() => provider.validate(input(model.id, "unknown"))).not.toThrow();
  }
  expect(network).not.toHaveBeenCalled();
});
const picture: Entity = {
  id: "picture",
  type: "asset",
  accountId: "account",
  createdAt: "fixture",
  kind: "image",
  sha256: "a".repeat(64),
  bytes: 3,
  mime: "image/png",
  metadata: { width: 640, height: 640 },
};
const frame = { ...seedanceMiniModels[1], hardBoundConfirmed: true };
function frameInput(faces: FaceStatus = "absent") {
  return operationSchema.parse({
    kind: "generate",
    model: frame.id,
    prompt: "A landscape",
    mode: "image_to_video",
    references: [{ assetId: picture.id, role: "first_frame" }],
    videoPolicy: {
      ...policy(),
      references: [
        {
          assetId: picture.id,
          sha256: picture.sha256,
          faces,
          reason: "Inspected fixture pixels",
        },
      ],
    },
  });
}
it("keeps explicit observation hashes accurate without blocking unreviewed references", () => {
  const op = frameInput();
  expect(() => assertVideoPolicy(frame, op, [picture])).not.toThrow();
  expect(() =>
    assertVideoPolicy(frame, frameInput("present"), [picture]),
  ).not.toThrow();
  expect(() =>
    assertVideoPolicy(frame, op, [{ ...picture, sha256: "b".repeat(64) }]),
  ).toThrow(expect.objectContaining({ code: "VIDEO_FACE_REVIEW_STALE" }));
  if (op.kind !== "generate") throw Error("fixture");
  expect(() =>
    assertVideoPolicy(frame, { ...op, videoPolicy: policy() }, [picture]),
  ).toThrow(expect.objectContaining({ code: "VIDEO_FACE_REVIEW_REQUIRED" }));
  expect(() =>
    assertVideoPolicy(
      {
        ...frame,
        id: "minimax-frame",
        endpoint: "minimax/frame",
        name: "MiniMax",
      },
      { ...op, model: "minimax-frame", videoPolicy: undefined },
      [picture],
    ),
  ).not.toThrow();
});
it("offers only compatible modes and binds observed reference hashes without network calls", () => {
  const p = new FalProvider([seedance, frame], "fixture", true, network);
  const result = resolveVideoModel(
    {
      faces: "absent",
      reason: "landscape",
      references: [
        {
          assetId: picture.id,
          role: "first_frame",
          faces: "absent",
          reason: "Landscape pixels",
        },
      ],
    },
    [picture],
    p.describe(),
  );
  expect(result).toMatchObject({
    status: "ready",
    selectedModel: frame.id,
    videoPolicy: { references: [{ sha256: picture.sha256 }] },
  });
  expect(result.candidates).toHaveLength(1);
});
it("retains face review and user choice through cloud asset-ID remapping", () => {
  const op = frameInput();
  if (op.kind !== "generate") throw Error("fixture");
  const mapped = remapVideoPolicy(op.videoPolicy, [
    { sourceAssetId: picture.id, assetId: "cloud-picture" },
  ]);
  expect(mapped?.references[0]).toMatchObject({
    assetId: "cloud-picture",
    sha256: picture.sha256,
    faces: "absent",
  });
  expect(op.videoPolicy?.references[0].assetId).toBe(picture.id);
});
it("ships schema-valid Seedance profiles without automatically enabling paid generation", () => {
  for (const model of seedanceMiniModels) {
    expect(modelSchema.parse(model)).toBeTruthy();
    expect(model.hardBoundConfirmed).toBe(false);
  }
  expect(
    new FalProvider(seedanceMiniModels, "fixture", true)
      .describe()
      .every((m) => !m.available),
  ).toBe(true);
});

let service: Service,
  db: Database,
  dir: string,
  c: Awaited<ReturnType<Service["authenticate"]>>;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "face-policy-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir), provider);
  c = await service.authenticate(
    (await service.createAccount("face fixtures", 10000)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
it("queues direct video once and retains the normal reservation", async () => {
  const result = await callTool(service, c, "video_model_resolve", {
    faces: "present",
  });
  expect(result.status).toBe("ready");
  const before = await service.usage(c);
  const request = {
    input: input(seedance.id, "present"),
    idempotencyKey: "direct-face",
  };
  const first = await callTool(service, c, "job_submit", request);
  const duplicate = await callTool(service, c, "job_submit", request);
  expect(duplicate.id).toBe(first.id);
  expect((await service.usage(c)).reservedCents).toBeGreaterThan(
    before.reservedCents,
  );
  expect(network).not.toHaveBeenCalled();
});

it("keeps face observations and confirmation out of the provider payload", async () => {
  network.mockClear();
  await provider.submit(input(minimax.id, "present", minimax.id));
  expect(network).toHaveBeenCalledTimes(1);
  const request = network.mock.calls[0] as unknown as [string, RequestInit];
  const payload = JSON.parse(String(request[1].body));
  expect(payload.videoPolicy).toBeUndefined();
  expect(payload.userChoice).toBeUndefined();
  expect(payload.prompt).toBe("A landscape");
  network.mockClear();
});
