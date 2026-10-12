import { expect, it, vi } from "vitest";
import {
  buildProviders,
  parseModelConfig,
} from "../packages/providers/src/config.js";

const model = {
  id: "picture",
  name: "图片",
  endpoint: "vendor/image",
  kind: "image",
  maxCostCents: 5,
  priceVersion: "v1",
  hardBoundConfirmed: true,
  parameters: { num_images: 1 },
};
const config = {
  schemaVersion: 1,
  mode: "custom",
  providers: [
    {
      id: "personal",
      adapter: "fal",
      keyEnv: "PERSONAL_FAL_KEY",
      enabled: true,
      models: [model],
    },
  ],
};
const input = {
  kind: "generate" as const,
  model: "picture",
  prompt: "a cup",
  parameters: {},
};

it("loads config-only connections, never exposing credentials or private parameters", () => {
  const provider = buildProviders(parseModelConfig(config), {
    PERSONAL_FAL_KEY: "private-key",
  });
  expect(provider.describe()[0]).toMatchObject({
    id: "picture",
    name: "图片",
    available: true,
  });
  expect(JSON.stringify(provider.describe())).not.toMatch(
    /private-key|keyEnv|num_images|endpoint/,
  );
  expect(
    buildProviders(parseModelConfig(config), {}).describe()[0].available,
  ).toBe(false);
});

it("rejects ambiguous modes, duplicate model ids and invalid credentials config", () => {
  for (const value of [
    {
      ...config,
      providers: [
        ...config.providers,
        { ...config.providers[0], id: "second" },
      ],
    },
    {
      ...config,
      mode: "official",
      official: { url: "https://api.example.com", keyEnv: "OFFICIAL_KEY" },
    },
    {
      ...config,
      providers: [{ ...config.providers[0], key: "literal-secret" }],
    },
    {
      schemaVersion: 1,
      mode: "official",
      official: { url: "https://user:pass@example.com", keyEnv: "KEY" },
    },
  ])
    expect(() => parseModelConfig(value)).toThrow();
});

it("keeps a ticket bound to its connection and stops after a route configuration change", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      request_id: "one",
      status_url: "https://queue.fal.run/status",
      response_url: "https://queue.fal.run/result",
      cancel_url: "https://queue.fal.run/cancel",
    }),
  );
  const provider = buildProviders(
    parseModelConfig(config),
    { PERSONAL_FAL_KEY: "private-key" },
    fetcher,
  );
  const ticket = await provider.submit(input);
  expect(ticket.connectionId).toBe("personal");
  const changed = buildProviders(
    parseModelConfig({
      ...config,
      providers: [
        {
          ...config.providers[0],
          models: [{ ...model, endpoint: "other/model" }],
        },
      ],
    }),
    { PERSONAL_FAL_KEY: "private-key" },
    fetcher,
  );
  await expect(changed.poll(ticket)).rejects.toMatchObject({
    code: "PROVIDER_CONFIG_CHANGED",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("runs Replicate predictions with the correct key and never forwards it to output hosts", async () => {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: any, init?: RequestInit) => {
    calls.push(String(url));
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer replicate-secret",
    });
    return Response.json({
      id: "abc123",
      status: "succeeded",
      output: ["https://replicate.delivery/example.png"],
    });
  });
  const provider = buildProviders(
    parseModelConfig({
      ...config,
      providers: [{ ...config.providers[0], adapter: "replicate" }],
    }),
    { PERSONAL_FAL_KEY: "replicate-secret" },
    fetcher,
  );
  const ticket = await provider.submit(input);
  expect(await provider.poll(ticket)).toBe("completed");
  expect(await provider.collect(ticket, input)).toMatchObject({
    kind: "image",
    url: "https://replicate.delivery/example.png",
    costCents: null,
  });
  expect(
    calls.every((url) => url.startsWith("https://api.replicate.com/v1/")),
  ).toBe(true);
});
it("does not retry ambiguous predictions or accept missing prediction identifiers", async () => {
  const parsed = parseModelConfig({
    ...config,
    providers: [{ ...config.providers[0], adapter: "replicate" }],
  });
  for (const fetcher of [
    async () => {
      throw Error("network");
    },
    async () => new Response("{}", { status: 503 }),
    async () => Response.json({}),
  ]) {
    const call = vi.fn(fetcher);
    await expect(
      buildProviders(parsed, { PERSONAL_FAL_KEY: "secret" }, call).submit(
        input,
      ),
    ).rejects.toMatchObject({ code: "SUBMISSION_UNKNOWN" });
    expect(call).toHaveBeenCalledTimes(1);
  }
  const rejected = buildProviders(
    parsed,
    { PERSONAL_FAL_KEY: "secret" },
    async () => new Response("{}", { status: 401 }),
  );
  await expect(rejected.submit(input)).rejects.toMatchObject({
    code: "PROVIDER_REJECTED",
  });
});
it("never falls back to another connection when a provider fails", async () => {
  const call = vi.fn(async () => new Response("{}", { status: 429 }));
  const parsed = parseModelConfig({
    ...config,
    providers: [
      ...config.providers,
      {
        ...config.providers[0],
        id: "backup",
        models: [{ ...model, id: "backup-picture" }],
      },
    ],
  });
  await expect(
    buildProviders(parsed, { PERSONAL_FAL_KEY: "secret" }, call).submit(input),
  ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
  expect(call).toHaveBeenCalledTimes(1);
  const noRoute = buildProviders(
    parseModelConfig({
      schemaVersion: 1,
      mode: "official",
      official: { url: "https://api.example.com", keyEnv: "KEY" },
    }),
  );
  expect(noRoute.describe()).toEqual([]);
  expect(() => noRoute.validate(input)).toThrow();
});
