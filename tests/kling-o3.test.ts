import { faceFreeFixturePolicy } from "./video-policy-fixture.js";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import {
  generationInputSchema,
  operationSchema,
  type Entity,
} from "../packages/contracts/src/index.js";
import { parseModelConfig } from "../packages/providers/src/config.js";
import { FalProvider, type Model } from "../packages/providers/src/index.js";
import { validateGenerationAssets } from "../packages/providers/src/generation-input.js";
import { klingO3Models } from "../packages/providers/src/kling-o3.js";
import { mimeFor } from "../packages/core/src/assets.js";

const profile = {
  id: "kling-o3-video-edit",
  name: "Kling O3 Pro · 视频编辑",
  endpoint: "fal-ai/kling-video/o3/pro/video-to-video/edit",
  kind: "video",
  maxCostCents: 100,
  priceVersion: "fixture",
  hardBoundConfirmed: true,
  parameters: { keep_audio: true },
  generationInput: {
    mode: "video_to_video",
    outputDurationSource: "source_video",
    maxTotalBytes: 41943040,
    bindings: [
      {
        field: "video_url",
        roles: ["source_video"],
        kind: "video",
        array: false,
        min: 1,
        max: 1,
        maxBytes: 20971520,
        mimeTypes: ["video/mp4", "video/quicktime"],
        containers: ["mp4", "mov"],
        minDimension: 720,
        maxDimension: 3840,
        minDurationMs: 3000,
        maxDurationMs: 15000,
      },
      {
        field: "image_urls",
        roles: ["character", "product", "scene", "style", "composition"],
        kind: "image",
        array: true,
        min: 0,
        max: 4,
        maxBytes: 10485760,
        maxPixels: 16777216,
      },
    ],
  },
};
function model(): Model {
  const config = parseModelConfig({
    schemaVersion: 1,
    mode: "custom",
    providers: [
      {
        id: "fal",
        adapter: "fal",
        keyEnv: "KEY",
        enabled: true,
        models: [profile],
      },
    ],
  });
  if (config.mode !== "custom") throw Error("Expected custom config");
  return config.providers[0].models[0];
}
function input(images = 1) {
  return operationSchema.parse({
    kind: "generate",
    model: profile.id,
    videoPolicy: faceFreeFixturePolicy([
      { id: "clip" },
      ...Array.from({ length: images }, (_, i) => ({ id: `image${i}` })),
    ]),
    mode: "video_to_video",
    prompt:
      "In @Video1 replace the background with @Image1; retain the camera motion.",
    references: [
      { assetId: "clip", role: "source_video" },
      ...Array.from({ length: images }, (_, i) => ({
        assetId: `image${i}`,
        role: "scene",
      })),
    ],
  });
}
function clip(patch: Record<string, unknown> = {}): Entity {
  return {
    id: "clip",
    accountId: "owner",
    type: "asset",
    createdAt: "fixture",
    bytes: 1000,
    kind: "video",
    mime: "video/mp4",
    metadata: { width: 1280, height: 720, durationMs: 7000, container: "mp4" },
    ...patch,
  };
}
function image(i = 0): Entity {
  return {
    id: `image${i}`,
    accountId: "owner",
    type: "asset",
    createdAt: "fixture",
    bytes: 100,
    kind: "image",
    mime: "image/png",
    metadata: { width: 1024, height: 1024 },
  };
}

it("declares source-following duration and original audio in the public model catalog", () => {
  const p = new FalProvider([model()], "fixture", true);
  expect(p.describe()[0]).toMatchObject({
    available: true,
    fixedParameters: { keep_audio: true },
    generationInput: {
      mode: "video_to_video",
      outputDurationSource: "source_video",
      references: [
        expect.objectContaining({
          mimeTypes: ["video/mp4", "video/quicktime"],
          minDimension: 720,
          maxDimension: 3840,
        }),
        expect.any(Object),
      ],
    },
  });
  expect(p.describe()[0].generationInput?.outputDurationMs).toBeUndefined();
});

it("submits the source and ordered reference images to O3 without inventing duration or aspect parameters", async () => {
  const call = vi.fn(async () =>
    Response.json({
      request_id: "o3-job",
      status_url:
        "https://queue.fal.run/fal-ai/kling-video/requests/o3-job/status",
      response_url: "https://queue.fal.run/fal-ai/kling-video/requests/o3-job",
      cancel_url:
        "https://queue.fal.run/fal-ai/kling-video/requests/o3-job/cancel",
    }),
  );
  const p = new FalProvider([model()], "fixture", true, call);
  const op = input(2);
  const result = await p.submit(op, undefined, [
    {
      assetId: "clip",
      role: "source_video",
      url: "https://cdn.test/source.mp4",
    },
    { assetId: "image0", role: "scene", url: "https://cdn.test/scene.png" },
    { assetId: "image1", role: "scene", url: "https://cdn.test/style.png" },
  ]);
  expect(result.requestId).toBe("o3-job");
  expect(call).toHaveBeenCalledTimes(1);
  const [url, init] = (
    call.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(url).toBe(`https://queue.fal.run/${profile.endpoint}`);
  expect(JSON.parse(String(init.body))).toEqual({
    prompt: op.kind === "generate" ? op.prompt : "",
    keep_audio: true,
    video_url: "https://cdn.test/source.mp4",
    image_urls: ["https://cdn.test/scene.png", "https://cdn.test/style.png"],
  });
});

it.each([3000, 7000, 15000])(
  "accepts a %d ms source and optional reference images",
  (durationMs) => {
    expect(() =>
      validateGenerationAssets(model(), input(0), [
        clip({
          metadata: { width: 720, height: 1280, durationMs, container: "mp4" },
        }),
      ]),
    ).not.toThrow();
    expect(() =>
      validateGenerationAssets(model(), input(4), [
        clip(),
        ...Array.from({ length: 4 }, (_, i) => image(i)),
      ]),
    ).not.toThrow();
  },
);
it.each([
  { mime: "video/webm" },
  {
    metadata: { width: 1280, height: 720, durationMs: 2999, container: "mp4" },
  },
  {
    metadata: { width: 1280, height: 720, durationMs: 15001, container: "mp4" },
  },
  {
    metadata: { width: 1280, height: 719, durationMs: 7000, container: "mp4" },
  },
  {
    metadata: { width: 3841, height: 2160, durationMs: 7000, container: "mp4" },
  },
  { metadata: { durationMs: 7000, container: "mp4" } },
  {
    metadata: {
      width: 1280.5,
      height: 720,
      durationMs: 7000,
      container: "mp4",
    },
  },
  { bytes: 20971521 },
  {
    metadata: { width: 1280, height: 720, durationMs: 7000, container: "webm" },
  },
  { metadata: { width: 1280, height: 720, durationMs: 7000 } },
])("rejects incompatible source metadata before quoting: %j", (patch) => {
  const m = model();
  expect(() =>
    validateGenerationAssets(m, input(), [clip(patch), image()]),
  ).toThrow(
    expect.objectContaining({
      code:
        "mime" in patch ||
        ("metadata" in patch && patch.metadata?.container !== "mp4")
          ? "INVALID_MEDIA"
          : "REFERENCE_LIMIT",
    }),
  );
});
it("rejects a missing source, motion-only input, a fifth image, and fixed audio overrides", () => {
  const p = new FalProvider([model()], "fixture", true);
  for (const patch of [
    { references: [{ assetId: "image0", role: "scene" }] },
    { references: [{ assetId: "clip", role: "motion" }] },
    { parameters: { keep_audio: false } },
  ])
    expect(() =>
      p.validate(operationSchema.parse({ ...input(), ...patch })),
    ).toThrow();
  expect(() => p.validate(input(5))).toThrow();
});
it.each([
  { outputDurationMs: 5000 },
  { mode: "image_to_video" },
  { outputDurationSource: undefined },
  {
    bindings: [
      { ...profile.generationInput.bindings[0], mimeTypes: ["image/png"] },
    ],
  },
  {
    bindings: [
      {
        ...profile.generationInput.bindings[0],
        minDimension: 3841,
        maxDimension: 3840,
      },
    ],
  },
])("rejects contradictory source duration and format policies: %j", (patch) => {
  expect(
    generationInputSchema.safeParse({ ...profile.generationInput, ...patch })
      .success,
  ).toBe(false);
});
it("invalidates the quote when the audio or video input constraints change", () => {
  const m = model();
  const p = (m: Model) => new FalProvider([m], "fixture", true);
  expect(p(m).estimate(input()).priceVersion).not.toBe(
    p({ ...m, parameters: { keep_audio: false } }).estimate(input())
      .priceVersion,
  );
  expect(p(m).estimate(input()).priceVersion).not.toBe(
    p({
      ...m,
      generationInput: { ...m.generationInput!, maxTotalBytes: 20000000 },
    }).estimate(input()).priceVersion,
  );
});
it("maps actual probed containers and retains existing metadata compatibility", () => {
  expect(mimeFor({ kind: "video", codec: "h264", container: "mov" })).toBe(
    "video/quicktime",
  );
  expect(mimeFor({ kind: "video", codec: "vp9", container: "webm" })).toBe(
    "video/webm",
  );
  expect(mimeFor({ kind: "video", codec: "h264", container: "other" })).toBe(
    "application/octet-stream",
  );
  expect(mimeFor({ kind: "video", codec: "h264" })).toBe("video/mp4");
});
it("ships O3 in both custom fal examples with enablement and pricing still explicit", async () => {
  for (const path of [
    "config/models.custom.example.json",
    "config/models.reference.example.json",
  ]) {
    const config = parseModelConfig(JSON.parse(await readFile(path, "utf8")));
    if (config.mode !== "custom") throw Error("Expected custom config");
    const connection = config.providers.find((p) =>
      p.models.some((m) => m.id === profile.id),
    );
    expect(connection).toMatchObject({ adapter: "fal", enabled: false });
    expect(connection?.models.find((m) => m.id === profile.id)).toMatchObject({
      endpoint: profile.endpoint,
      hardBoundConfirmed: false,
      parameters: { keep_audio: true },
      generationInput: { outputDurationSource: "source_video" },
    });
    expect(
      connection?.models.find((m) => m.id === profile.id)?.generationInput,
    ).toEqual(klingO3Models[0].generationInput);
  }
});
