import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { operationSchema } from "../packages/contracts/src/index.js";
import { latestModels } from "../packages/providers/src/latest-models.js";
import { FalProvider, type Model } from "../packages/providers/src/index.js";
import {
  modelSchema,
  parseModelConfig,
} from "../packages/providers/src/config.js";
import { generationDurationMs } from "../packages/providers/src/generation-parameters.js";
import { faceFreeFixturePolicy } from "./video-policy-fixture.js";
import snapshot from "./fixtures/fal-latest-schemas.json";

// This deliberately reads independently fetched upstream constraints, not model declarations.
function conforms(value: unknown, schema: any): boolean {
  if (schema.anyOf) return schema.anyOf.some((s: any) => conforms(value, s));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (Object.hasOwn(schema, "const") && value !== schema.const) return false;
  if (schema.type === "null") return value === null;
  if (schema.type === "string")
    return (
      typeof value === "string" &&
      value.length >= (schema.minLength ?? 0) &&
      value.length <= (schema.maxLength ?? Infinity)
    );
  if (schema.type === "boolean") return typeof value === "boolean";
  if (["number", "integer"].includes(schema.type))
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (schema.type !== "integer" || Number.isInteger(value)) &&
      value >= (schema.minimum ?? -Infinity) &&
      value <= (schema.maximum ?? Infinity)
    );
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.length >= (schema.minItems ?? 0) &&
      value.length <= (schema.maxItems ?? Infinity) &&
      value.every((v) => conforms(v, schema.items))
    );
  if (schema.type === "object")
    return (
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (schema.required ?? []).every((k: string) => Object.hasOwn(value, k)) &&
      Object.entries(value).every(
        ([k, v]) => schema.properties[k] && conforms(v, schema.properties[k]),
      )
    );
  return false;
}
function inputFor(model: Model) {
  const references = model.generationInput?.bindings.flatMap((b, i) =>
    Array.from({ length: b.min }, (_, j) => ({
      assetId: `frame-${i}-${j}`,
      role: b.roles[0],
    })),
  );
  return operationSchema.parse({
    kind: "generate",
    model: model.id,
    prompt: "A ceramic cup rotating on a wooden table",
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

it.each(latestModels)(
  "submits $id with an upstream-valid payload and collects its output",
  async (model) => {
    const input = inputFor(model);
    if (input.kind !== "generate") throw Error("Expected generation");
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          expect(String(url)).toBe(`https://queue.fal.run/${model.endpoint}`);
          const payload = JSON.parse(String(init.body));
          const schema =
            snapshot.endpoints[
              model.endpoint as keyof typeof snapshot.endpoints
            ].input;
          expect(conforms(payload, schema), JSON.stringify(payload)).toBe(true);
          expect(payload.videoPolicy).toBeUndefined();
          expect(payload.minPromptLength).toBeUndefined();
          for (const binding of model.generationInput?.bindings ?? []) {
            const urls = (input.references ?? [])
              .filter((r) => binding.roles.includes(r.role))
              .map((r) => `https://media.example/${r.assetId}.png`);
            expect(payload[binding.field]).toEqual(
              binding.array ? urls : urls[0],
            );
          }
          return Response.json({
            request_id: "fixture",
            status_url: "https://queue.fal.run/status",
            response_url: "https://queue.fal.run/result",
            cancel_url: "https://queue.fal.run/cancel",
          });
        }
        if (String(url).endsWith("status"))
          return Response.json({ status: "COMPLETED" });
        return Response.json(
          model.kind === "video"
            ? { video: { url: "https://media.example/result.mp4" } }
            : { images: [{ url: "https://media.example/result.png" }] },
        );
      },
    );
    // Mock transport only. Never change the shipped cost-confirmation flag to run this test.
    const provider = new FalProvider([model], "fixture", true, fetcher, {
      testing: true,
    });
    const ticket = await provider.submit(
      input,
      undefined,
      input.references?.map((r) => ({
        ...r,
        url: `https://media.example/${r.assetId}.png`,
      })),
    );
    expect(await provider.poll(ticket)).toBe("completed");
    expect(await provider.collect(ticket, input)).toMatchObject({
      kind: model.kind,
      costCents: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  },
);

it("constrains every exposed output control to its upstream schema", () => {
  for (const model of latestModels) {
    expect(modelSchema.parse(model)).toEqual(model);
    const schema: any =
      snapshot.endpoints[model.endpoint as keyof typeof snapshot.endpoints]
        .input;
    for (const [key, rule] of Object.entries(model.allowedParameters ?? {})) {
      const values = rule.type === "enum" ? rule.values : [rule.min, rule.max];
      for (const value of values)
        expect(
          conforms(value, schema.properties[key]),
          `${model.id}.${key}=${value}`,
        ).toBe(true);
    }
    for (const binding of model.generationInput?.bindings ?? [])
      expect(schema.properties[binding.field]).toBeDefined();
  }
});

it("preserves integer vs string durations and fractional H3 durations", () => {
  const provider = new FalProvider(latestModels, "fixture", true, vi.fn(), {
    testing: true,
  });
  for (const model of latestModels.filter((m) => m.kind === "video")) {
    const input = inputFor(model);
    if (input.kind !== "generate") throw Error("Expected generation");
    const duration = model.id.startsWith("seedance-") ? "10" : 10;
    expect(() =>
      provider.validate({ ...input, parameters: { duration } }),
    ).not.toThrow();
    expect(generationDurationMs(model, { duration })).toBe(10000);
    const wrongType = typeof duration === "string" ? 10 : "10";
    expect(() =>
      provider.validate({ ...input, parameters: { duration: wrongType } }),
    ).toThrow();
    expect(() =>
      provider.validate({ ...input, parameters: { duration: 31 } }),
    ).toThrow();
    if (model.id.startsWith("minimax-")) {
      expect(() =>
        provider.validate({ ...input, parameters: { duration: 4.5 } }),
      ).not.toThrow();
      expect(generationDurationMs(model, { duration: 4.5 })).toBe(4500);
    }
  }
});

it("keeps unreviewed token billing unavailable and retains credentials/enablement gates", () => {
  const fetcher = vi.fn();
  const provider = new FalProvider(latestModels, "fixture", true, fetcher);
  for (const model of latestModels) {
    expect(provider.describe().find((m) => m.id === model.id)?.available).toBe(
      model.hardBoundConfirmed,
    );
    if (!model.hardBoundConfirmed)
      expect(() => provider.validate(inputFor(model))).toThrow();
    for (const unavailable of [
      new FalProvider(latestModels, undefined, true),
      new FalProvider(latestModels, "fixture", false),
    ])
      expect(() => unavailable.validate(inputFor(model))).toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("enforces Nano minimum prompt length and rejects raw URL/billing overrides", async () => {
  const fetcher = vi.fn();
  const provider = new FalProvider(latestModels, "fixture", true, fetcher, {
    testing: true,
  });
  for (const model of latestModels) {
    const input = inputFor(model);
    if (input.kind !== "generate") throw Error("Expected generation");
    const forbiddenParameters: Record<string, string | number>[] = [
      { image_url: "https://other.example/x.png" },
      { num_images: 4 },
      { thinking_level: "high" },
    ];
    for (const parameters of forbiddenParameters)
      await expect(
        provider.submit({ ...input, parameters }),
      ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
    if (model.minPromptLength) {
      await expect(
        provider.submit({ ...input, prompt: "ab" }),
      ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
      expect(() =>
        provider.validate({ ...input, prompt: "cup" }),
      ).not.toThrow();
    }
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("does not allow new Seedance versions or FLUX to bypass face policy", () => {
  const provider = new FalProvider(latestModels, "fixture", true, vi.fn(), {
    testing: true,
  });
  for (const model of latestModels.filter((m) => m.kind === "video")) {
    const input = inputFor(model);
    if (input.kind !== "generate") throw Error("Expected generation");
    for (const faces of ["present", "unknown"] as const) {
      const videoPolicy = {
        ...input.videoPolicy!,
        faces,
        userChoice: { model: model.id, confirmed: true as const },
      };
      if (model.id.startsWith("minimax-")) {
        expect(() =>
          provider.validate({
            ...input,
            videoPolicy: { ...videoPolicy, userChoice: undefined },
          }),
        ).toThrow();
        expect(() =>
          provider.validate({ ...input, videoPolicy }),
        ).not.toThrow();
      } else
        expect(() => provider.validate({ ...input, videoPolicy })).toThrow();
    }
    if (input.references?.length || model.id.startsWith("seedance-"))
      expect(() =>
        provider.validate({ ...input, videoPolicy: undefined }),
      ).toThrow();
  }
});

it("includes all 12 profiles in the disabled example without duplicate IDs", async () => {
  expect(latestModels).toHaveLength(12);
  const config = parseModelConfig(
    JSON.parse(await readFile("config/models.custom.example.json", "utf8")),
  );
  if (config.mode !== "custom") throw Error("Expected custom config");
  for (const model of latestModels) {
    const connection = config.providers.find((p) =>
      p.models.some((m) => m.id === model.id),
    )!;
    expect(connection.enabled).toBe(false);
    expect(connection.models.find((m) => m.id === model.id)).toEqual(model);
  }
});
