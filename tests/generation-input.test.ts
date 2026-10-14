import { expect, it, vi } from "vitest";
import {
  operationSchema,
  generationInputSchema,
  type Entity,
} from "../packages/contracts/src/index.js";
import { FalProvider, type Model } from "../packages/providers/src/index.js";
import { ReplicateProvider } from "../packages/providers/src/replicate.js";
import {
  generationPayload,
  validateGenerationAssets,
} from "../packages/providers/src/generation-input.js";
import { parseModelConfig } from "../packages/providers/src/config.js";
const binding = {
  field: "images",
  roles: ["character", "product"] as ("character" | "product")[],
  kind: "image" as const,
  array: true,
  min: 1,
  max: 2,
  maxBytes: 1000,
  maxPixels: 40000,
};
const model: Model = {
  id: "edit",
  endpoint: "vendor/edit",
  kind: "image",
  maxCostCents: 10,
  priceVersion: "fixture",
  hardBoundConfirmed: true,
  parameters: {},
  generationInput: {
    mode: "image_edit",
    maxTotalBytes: 1500,
    bindings: [binding],
  },
};
const input = operationSchema.parse({
  kind: "generate",
  model: "edit",
  mode: "image_edit",
  prompt: "Use Image 1 for the person and Image 2 for the product",
  references: [
    { assetId: "person", role: "character" },
    { assetId: "bottle", role: "product" },
  ],
});
const asset = (id: string, fields = {}): Entity => ({
  id,
  accountId: "owner",
  type: "asset",
  createdAt: "fixture",
  bytes: 500,
  kind: "image",
  mime: "image/png",
  metadata: { width: 144, height: 144 },
  ...fields,
});
const provider = (m = model) => new FalProvider([m], "fixture", true);
it("keeps text-only compatibility but rejects undeclared reference operations", () => {
  const text = { ...model, generationInput: undefined };
  expect(
    provider(text).validate(
      operationSchema.parse({
        kind: "generate",
        model: "edit",
        prompt: "picture",
      }),
    ),
  ).toBe(text);
  expect(() => provider(text).validate(input)).toThrow();
  expect(() =>
    provider().validate(
      operationSchema.parse({
        kind: "generate",
        model: "edit",
        prompt: "picture",
      }),
    ),
  ).toThrow();
});
it.each([
  { references: [{ assetId: "person", role: "motion" }] },
  {
    references: [
      { assetId: "person", role: "character" },
      { assetId: "person", role: "character" },
    ],
  },
  {
    references: [
      { assetId: "a", role: "character" },
      { assetId: "b", role: "character" },
      { assetId: "c", role: "product" },
    ],
  },
  { parameters: { images: ["https://unquoted.test"] } },
  { mode: "image_to_video" },
])("rejects unquoted or incompatible generation inputs: %j", (patch) => {
  expect(() =>
    provider().validate(operationSchema.parse({ ...input, ...patch })),
  ).toThrow();
});
it.each([
  { bytes: 1001 },
  { bytes: 0 },
  { bytes: 1.5 },
  { mime: "image/svg+xml" },
  { kind: "video" },
  { metadata: { width: 0, height: 144 } },
  { metadata: { width: 300, height: 300 } },
])(
  "rejects unprobed, unsupported or oversized reference assets: %j",
  (patch) => {
    expect(() =>
      validateGenerationAssets(model, input, [
        asset("person", patch),
        asset("bottle"),
      ]),
    ).toThrow();
  },
);
it("enforces aggregate byte bounds and re-quotes reference limit changes", () => {
  expect(() =>
    validateGenerationAssets(model, input, [
      asset("person", { bytes: 800 }),
      asset("bottle", { bytes: 800 }),
    ]),
  ).toThrow();
  expect(() =>
    validateGenerationAssets(model, input, [asset("person"), asset("bottle")]),
  ).not.toThrow();
  const changed = {
    ...model,
    generationInput: { ...model.generationInput!, maxTotalBytes: 2000 },
  };
  expect(provider().estimate(input).priceVersion).not.toBe(
    provider(changed).estimate(input).priceVersion,
  );
});
it("checks reference video duration individually and across the request", () => {
  const videoModel: Model = {
    ...model,
    kind: "video",
    generationInput: {
      mode: "reference_to_video",
      outputDurationMs: 5000,
      maxTotalBytes: 2000,
      bindings: [
        {
          field: "videos",
          roles: ["motion"],
          kind: "video",
          array: true,
          min: 1,
          max: 2,
          maxBytes: 1000,
          minDurationMs: 2000,
          maxDurationMs: 10000,
          maxTotalDurationMs: 12000,
        },
      ],
    },
  };
  const op = operationSchema.parse({
    ...input,
    mode: "reference_to_video",
    references: [
      { assetId: "a", role: "motion" },
      { assetId: "b", role: "motion" },
    ],
  });
  const clip = (id: string, durationMs: number) =>
    asset(id, { kind: "video", mime: "video/mp4", metadata: { durationMs } });
  for (const pair of [
    [1000, 2000],
    [11000, 2000],
    [7000, 7000],
    [NaN, 2000],
  ])
    expect(() =>
      validateGenerationAssets(videoModel, op, [
        clip("a", pair[0]),
        clip("b", pair[1]),
      ]),
    ).toThrow();
  expect(() =>
    validateGenerationAssets(videoModel, op, [
      clip("a", 6000),
      clip("b", 6000),
    ]),
  ).not.toThrow();
});
it("binds first and last frames to different provider fields and requires both", () => {
  const m: Model = {
    ...model,
    kind: "video",
    generationInput: {
      mode: "first_last_frame",
      outputDurationMs: 5000,
      maxTotalBytes: 2000,
      bindings: [
        {
          ...binding,
          field: "image_url",
          roles: ["first_frame"],
          array: false,
          min: 1,
          max: 1,
        },
        {
          ...binding,
          field: "end_image_url",
          roles: ["last_frame"],
          array: false,
          min: 1,
          max: 1,
        },
      ],
    },
  };
  const op = operationSchema.parse({
    ...input,
    mode: "first_last_frame",
    references: [
      { assetId: "a", role: "first_frame" },
      { assetId: "b", role: "last_frame" },
    ],
  });
  const refs = [
    {
      assetId: "a",
      role: "first_frame" as const,
      url: "https://cdn.test/a.png",
    },
    {
      assetId: "b",
      role: "last_frame" as const,
      url: "https://cdn.test/b.png",
    },
  ];
  expect(generationPayload(m, op, refs)).toEqual({
    image_url: refs[0].url,
    end_image_url: refs[1].url,
  });
  expect(() => generationPayload(m, op, refs.toReversed())).toThrow();
  expect(() =>
    provider(m).validate(
      operationSchema.parse({
        ...op,
        references: [refs[0]].map(({ url: _url, ...ref }) => ref),
      }),
    ),
  ).toThrow();
});
it.each([
  "file:///tmp/local.png",
  "http://internal.test/a",
  "https://user:secret@cdn.test/a",
  "data:text/html;base64,eA==",
])("refuses unsafe resolved reference %s before submission", async (url) => {
  const call = vi.fn();
  const p = new FalProvider([model], "fixture", true, call);
  await expect(
    p.submit(input, undefined, [
      { assetId: "person", role: "character", url },
      { assetId: "bottle", role: "product", url: "https://cdn.test/b.png" },
    ]),
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it("maps Replicate references without exposing local asset IDs or accepting a wrong order", async () => {
  const bodies: any[] = [];
  const p = new ReplicateProvider(
    [model],
    "fixture",
    true,
    async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "prediction" });
    },
  );
  expect(p.referenceDelivery()).toBe("signed_url");
  await p.submit(input, undefined, [
    { assetId: "person", role: "character", url: "https://cdn.test/a" },
    { assetId: "bottle", role: "product", url: "https://cdn.test/b" },
  ]);
  expect(bodies[0].input.images).toEqual([
    "https://cdn.test/a",
    "https://cdn.test/b",
  ]);
  expect(bodies[0].input.references).toBeUndefined();
});
it.each([
  { bindings: [{ ...binding, roles: ["motion"] }] },
  { bindings: [binding, binding] },
  { bindings: [{ ...binding, min: 3 }] },
  { bindings: [{ ...binding, array: false }] },
  { bindings: [{ ...binding, field: "__proto__" }] },
  { bindings: [{ ...binding, minDurationMs: 20, maxDurationMs: 10 }] },
])("rejects contradictory provider reference configuration: %j", (patch) => {
  expect(
    generationInputSchema.safeParse({ ...model.generationInput, ...patch })
      .success,
  ).toBe(false);
});
it("rejects a configured reference field that collides with a custom prompt or fixed parameter", () => {
  for (const m of [
    { ...model, promptField: "images" },
    { ...model, parameters: { images: ["https://old.test"] } },
  ]) {
    expect(() =>
      parseModelConfig({
        schemaVersion: 1,
        mode: "custom",
        providers: [
          {
            id: "p",
            adapter: "fal",
            keyEnv: "KEY",
            enabled: true,
            models: [m],
          },
        ],
      }),
    ).toThrow();
  }
});
