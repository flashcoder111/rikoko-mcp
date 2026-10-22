import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import {
  operationSchema,
  type Entity,
} from "../packages/contracts/src/index.js";
import { expandedModels } from "../packages/providers/src/expanded-models.js";
import { FalProvider, type Model } from "../packages/providers/src/index.js";
import {
  modelSchema,
  parseModelConfig,
} from "../packages/providers/src/config.js";
import { validateGenerationAssets } from "../packages/providers/src/generation-input.js";
import { checkGenerationTarget } from "../packages/providers/src/generation-target.js";
import { faceFreeFixturePolicy } from "./video-policy-fixture.js";

function request(model: Model) {
  const references = model.generationInput?.bindings.flatMap((b, i) =>
    Array.from({ length: b.min }, (_, j) => ({
      assetId: `ref-${i}-${j}`,
      role: b.roles[0],
    })),
  );
  return operationSchema.parse({
    kind: "generate",
    model: model.id,
    prompt: "A red ceramic cup on a plain table",
    mode: model.generationInput?.mode,
    references,
    ...(model.kind === "video"
      ? {
          videoPolicy: faceFreeFixturePolicy(
            (references ?? []).map((r) => ({ id: r.assetId })),
          ),
        }
      : {}),
  });
}
const asset = (id: string, width = 1024, height = 1024): Entity => ({
  id,
  accountId: "fixture",
  type: "asset",
  kind: "image",
  mime: "image/png",
  bytes: 1024,
  sha256: "a".repeat(64),
  createdAt: "fixture",
  metadata: { width, height },
});

it("ships unique, schema-valid profiles with matching disabled custom examples", async () => {
  expect(new Set(expandedModels.map((m) => m.id)).size).toBe(9);
  const config = parseModelConfig(
    JSON.parse(await readFile("config/models.custom.example.json", "utf8")),
  );
  expect(config.mode).toBe("custom");
  if (config.mode !== "custom") throw Error("Expected custom config");
  for (const model of expandedModels) {
    expect(modelSchema.parse(model)).toEqual(model);
    const connection = config.providers.find((p) =>
      p.models.some((m) => m.id === model.id),
    )!;
    expect(connection.enabled).toBe(false);
    expect(connection.models.find((m) => m.id === model.id)).toEqual(model);
  }
});

it.each(expandedModels)(
  "routes $id through submission, polling and result collection",
  async (model) => {
    const input = request(model);
    if (input.kind !== "generate") throw Error("Expected generation");
    const references = (input.references ?? []).map((r) => ({
      ...r,
      url: `https://media.example/${r.assetId}.png`,
    }));
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          expect(String(url)).toBe(`https://queue.fal.run/${model.endpoint}`);
          const payload = JSON.parse(String(init.body));
          expect(payload.prompt).toBe(input.prompt);
          expect(payload).toMatchObject(model.parameters);
          expect(payload.videoPolicy).toBeUndefined();
          expect(payload.maxPromptLength).toBeUndefined();
          for (const binding of model.generationInput?.bindings ?? []) {
            const urls = references
              .filter((r) => binding.roles.includes(r.role))
              .map((r) => r.url);
            expect(payload[binding.field]).toEqual(
              binding.array ? urls : urls[0],
            );
          }
          if (
            model.generationInput?.mode === "image_to_video" ||
            model.generationInput?.mode === "first_last_frame"
          )
            expect(payload.aspect_ratio).toBeUndefined();
          return Response.json({
            request_id: "fixture",
            status_url: "https://queue.fal.run/status",
            response_url: "https://queue.fal.run/result",
            cancel_url: "https://queue.fal.run/cancel",
          });
        }
        return Response.json(
          String(url).endsWith("status")
            ? { status: "COMPLETED" }
            : model.kind === "video"
              ? { video: { url: "https://media.example/out.mp4" } }
              : { images: [{ url: "https://media.example/out.png" }] },
        );
      },
    );
    const provider = new FalProvider([model], "fixture-key", true, fetcher);
    const ticket = await provider.submit(input, undefined, references);
    expect(await provider.poll(ticket)).toBe("completed");
    expect(await provider.collect(ticket, input)).toMatchObject({
      kind: model.kind,
      costCents: null,
    });
    expect(provider.estimate(input).maxCents).toBe(model.maxCostCents);
    expect(provider.describe()[0].available).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  },
);

it("retains all credential, paid enablement and cost confirmation gates", () => {
  for (const provider of [
    new FalProvider(expandedModels, undefined, true),
    new FalProvider(expandedModels, "fixture", false),
    new FalProvider(
      expandedModels.map((m) => ({ ...m, hardBoundConfirmed: false })),
      "fixture",
      true,
    ),
  ]) {
    expect(provider.describe().every((m) => !m.available)).toBe(true);
    for (const model of expandedModels)
      expect(() => provider.validate(request(model))).toThrow();
  }
});

it("rejects missing frames, unsupported controls and oversized Wan prompts before network access", async () => {
  const fetcher = vi.fn();
  const provider = new FalProvider(expandedModels, "fixture", true, fetcher);
  for (const model of expandedModels) {
    const input = request(model);
    await expect(
      provider.submit({ ...input, parameters: { num_images: 10 } } as any),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
    if (model.generationInput)
      await expect(
        provider.submit({ ...input, references: [] } as any),
      ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
    if (model.maxPromptLength) {
      expect(() =>
        provider.validate({ ...input, prompt: "a".repeat(1500) } as any),
      ).not.toThrow();
      await expect(
        provider.submit({ ...input, prompt: "a".repeat(1501) } as any),
      ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
    }
    if (model.kind === "video")
      expect(() =>
        provider.validate({ ...input, parameters: { duration: "16" } } as any),
      ).toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("enforces FLUX input pixel/count bounds used in the cost calculation", () => {
  const model = expandedModels.find((m) => m.id === "flux-2-pro-edit")!;
  const input = request(model);
  if (input.kind !== "generate") throw Error("Expected generation");
  const refs = Array.from({ length: 4 }, (_, i) => ({
    assetId: `image-${i}`,
    role: "product" as const,
  }));
  expect(() =>
    validateGenerationAssets(
      model,
      { ...input, references: refs },
      refs.map((r) => asset(r.assetId)),
    ),
  ).not.toThrow();
  expect(() =>
    validateGenerationAssets(
      model,
      { ...input, references: refs },
      refs.map((r) => asset(r.assetId, 1025)),
    ),
  ).toThrow();
  expect(() =>
    validateGenerationAssets(
      model,
      { ...input, references: [...refs, { assetId: "extra", role: "style" }] },
      [],
    ),
  ).toThrow();
});

it("checks fixed image canvas in both local and public catalog paths", () => {
  const model = expandedModels.find((m) => m.id === "flux-2-pro-text")!;
  const catalog = new FalProvider([model]).describe()[0];
  expect(catalog.fixedParameters).toMatchObject({ width: 1024, height: 1024 });
  for (const profile of [model, catalog]) {
    expect(
      checkGenerationTarget(profile, {
        parameters: {},
        target: { width: 1024, height: 1024, aspectPolicy: "match" },
      }).aspectRatio,
    ).toBe(1);
    expect(() =>
      checkGenerationTarget(profile, {
        parameters: {},
        target: { width: 1920, height: 1080, aspectPolicy: "match" },
      }),
    ).toThrow();
  }
});

it("preserves dynamic duration, first-frame aspect and face-choice policy", () => {
  const provider = new FalProvider(expandedModels, "fixture", true);
  for (const model of expandedModels.filter((m) => m.kind === "video")) {
    const input = request(model);
    if (input.kind !== "generate") throw Error("Expected generation");
    const assets = (input.references ?? []).map((r) =>
      asset(r.assetId, 1280, 720),
    );
    expect(
      checkGenerationTarget(
        model,
        { ...input, parameters: { duration: "10" } },
        assets,
      ).durationMs,
    ).toBe(10000);
    if (model.generationInput) {
      expect(checkGenerationTarget(model, input, assets).aspectRatio).toBe(
        16 / 9,
      );
      expect(() =>
        provider.validate({ ...input, videoPolicy: undefined }),
      ).toThrow();
    }
    const policy = { ...input.videoPolicy!, faces: "present" as const };
    expect(() =>
      provider.validate({ ...input, videoPolicy: policy }),
    ).toThrow();
    const confirmed = {
      ...policy,
      userChoice: { model: model.id, confirmed: true as const },
    };
    if (model.id.startsWith("wan-"))
      expect(() =>
        provider.validate({ ...input, videoPolicy: confirmed }),
      ).toThrow();
    else
      expect(() =>
        provider.validate({ ...input, videoPolicy: confirmed }),
      ).not.toThrow();
  }
});
