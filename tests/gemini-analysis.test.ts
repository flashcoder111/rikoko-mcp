import { expect, it, vi } from "vitest";
import { GeminiProvider } from "../packages/providers/src/gemini.js";
import {
  buildProviders,
  parseModelConfig,
} from "../packages/providers/src/config.js";
import { referenceOperationSchema } from "../packages/contracts/src/reference-analysis.js";
import type { Model, Ticket } from "../packages/providers/src/index.js";

const model: Model = {
  id: "vision",
  endpoint: "gemini-3.8-flash",
  kind: "analysis",
  maxCostCents: 10,
  priceVersion: "test",
  hardBoundConfirmed: true,
  parameters: {
    fps: 4,
    maxDurationMs: 60000,
    maxBytes: 100,
    maxOutputTokens: 8192,
  },
};
const input = referenceOperationSchema.parse({
  kind: "reference_analyze",
  assetId: "owned",
  model: "vision",
  range: { startMs: 1250, endMs: 2750 },
});
const ticket: Ticket = {
  requestId: "interaction1",
  statusUrl: "https://attacker.example/status",
  resultUrl: "https://attacker.example/result",
  cancelUrl: "https://attacker.example/cancel",
};
const uri = "https://generativelanguage.googleapis.com/v1beta/files/test";

it("encodes focused ranges in seconds while requiring original-source milliseconds in output", async () => {
  const fetcher = vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.input[0].processing).toEqual({
      type: "static",
      fps: 4,
      start_offset: 1.25,
      end_offset: 2.75,
    });
    expect(body.input[1].text).toContain("ORIGINAL source clock");
    expect(body.generation_config.max_output_tokens).toBe(8192);
    expect(init?.redirect).toBe("error");
    return Response.json({ id: "interaction1" });
  });
  await new GeminiProvider([model], "secret", true, fetcher).submit(input, uri);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  "https://attacker.example/upload",
  "http://generativelanguage.googleapis.com/upload/x",
  "https://user:password@generativelanguage.googleapis.com/upload/x",
  "https://generativelanguage.googleapis.com/v1beta/interactions",
])(
  "never sends private media or credentials to an untrusted upload URL: %s",
  async (url) => {
    const fetcher = vi.fn(
      async () => new Response(null, { headers: { "x-goog-upload-url": url } }),
    );
    await expect(
      new GeminiProvider([model], "secret", true, fetcher).prepare(
        input,
        new Uint8Array([1]),
        "video/mp4",
      ),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it("polls and cancels only the fixed Gemini API origin, ignoring URLs on stored tickets", async () => {
  const fetcher = vi.fn(async (url, init) => {
    expect(String(url)).toMatch(
      /^https:\/\/generativelanguage.googleapis.com\/v1beta\/interactions\/interaction1/,
    );
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "secret" });
    return Response.json({ status: "completed" });
  });
  const provider = new GeminiProvider([model], "secret", true, fetcher);
  expect(await provider.poll(ticket)).toBe("completed");
  expect(await provider.cancel(ticket)).toEqual({
    accepted: true,
    refunded: false,
  });
  await expect(
    provider.poll({ ...ticket, requestId: "../files/private" }),
  ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each([401, 429, 500, 408])(
  "classifies failed submissions without retrying (%s)",
  async (status) => {
    const fetcher = vi.fn(
      async () => new Response("private upstream details", { status }),
    );
    await expect(
      new GeminiProvider([model], "secret", true, fetcher).submit(input, uri),
    ).rejects.toMatchObject({
      code:
        status >= 500 || status === 408
          ? "SUBMISSION_UNKNOWN"
          : "PROVIDER_REJECTED",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it("keeps unfinished uploads bound to their connection and waits without reuploading", async () => {
  const raw = {
    schemaVersion: 1,
    mode: "custom",
    providers: [
      {
        id: "google",
        adapter: "gemini",
        enabled: true,
        keyEnv: "VIDEO_KEY",
        models: [model],
      },
    ],
  };
  let polls = 0;
  const fetcher = vi.fn(async (url) => {
    if (String(url).includes("/upload/v1beta"))
      return new Response(null, {
        headers: {
          "x-goog-upload-url":
            "https://generativelanguage.googleapis.com/upload/session/test",
        },
      });
    if (String(url).includes("/upload/session"))
      return Response.json({
        file: {
          name: "files/test",
          uri,
          state: "PROCESSING",
          mimeType: "video/mp4",
        },
      });
    polls++;
    return Response.json({
      name: "files/test",
      uri,
      state: "ACTIVE",
      mimeType: "video/mp4",
    });
  });
  const provider = buildProviders(
    parseModelConfig(raw),
    { VIDEO_KEY: "secret" },
    fetcher,
  );
  const prepared = await provider.prepare(
    input,
    new Uint8Array([1]),
    "video/mp4",
  );
  expect(prepared.ready).toBe(false);
  expect(
    (await provider.prepare(input, undefined, undefined, prepared)).ready,
  ).toBe(true);
  expect(polls).toBe(1);
  const changed = buildProviders(
    parseModelConfig(raw),
    { VIDEO_KEY: "other-key" },
    fetcher,
  );
  await expect(
    changed.prepare(input, undefined, undefined, prepared),
  ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_CHANGED" });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("does not enable invalid/missing credentials or accept unbounded media profiles", async () => {
  const fetcher = vi.fn();
  const provider = new GeminiProvider([model], "secret", true, fetcher);
  const asset: any = {
    kind: "video",
    mime: "video/mp4",
    bytes: 50,
    metadata: { durationMs: 5000 },
  };
  expect(() => provider.validateSource(input, asset)).not.toThrow();
  for (const patch of [
    { bytes: 101 },
    { metadata: { durationMs: 61000 } },
    { kind: "audio" },
    { mime: "video/unrecognized" },
  ])
    expect(() =>
      provider.validateSource(input, { ...asset, ...patch }),
    ).toThrow();
  for (const p of [
    new GeminiProvider([model]),
    new GeminiProvider([model], "secret", false),
    new GeminiProvider(
      [{ ...model, hardBoundConfirmed: false }],
      "secret",
      true,
    ),
    new GeminiProvider(
      [{ ...model, parameters: { fps: 1000 } }],
      "secret",
      true,
    ),
  ])
    expect(() => p.validate(input)).toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    provider.prepare(input, new Uint8Array(101), "video/mp4"),
  ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
});
it("rejects oversized results and malformed accepted submissions without exposing bodies", async () => {
  const provider = new GeminiProvider(
    [model],
    "secret",
    true,
    async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
  );
  await expect(provider.collect(ticket, input)).rejects.toMatchObject({
    code: "PROVIDER_RESULT_INVALID",
  });
  await expect(provider.submit(input, uri)).rejects.toMatchObject({
    code: "SUBMISSION_UNKNOWN",
  });
});
