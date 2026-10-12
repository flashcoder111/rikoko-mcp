import { expect, it, vi } from "vitest";
import {
  cloudOrigin,
  cloudRequest,
} from "../packages/cloud-client/src/http.js";
import {
  instantiate,
  templateSchema,
} from "../packages/templates/src/schema.js";
const base = {
  schemaVersion: 1,
  id: "example",
  version: 1,
  title: "Example",
  parameters: { name: { default: "hi", maxLength: 10 } },
  assets: [],
  composition: {
    schemaVersion: 1,
    title: "{{name}}",
    width: 360,
    height: 640,
    language: "en",
    scenes: [{ id: "intro", text: "{{name}}", durationMs: 1000 }],
  },
};
it("limits cloud origins and never follows redirects with credentials", async () => {
  for (const url of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com/?secret=yes",
    "https://example.com/#x",
  ])
    expect(() => cloudOrigin(url)).toThrow();
  expect(cloudOrigin("http://127.0.0.1:4320")).toBe("http://127.0.0.1:4320");
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  await cloudRequest("https://example.com", "/v1/usage", fetcher, {
    key: "server-only",
  });
  expect(fetcher).toHaveBeenCalledWith(
    "https://example.com/v1/usage",
    expect.objectContaining({
      redirect: "error",
      headers: expect.objectContaining({ Authorization: "Bearer server-only" }),
    }),
  );
});
it("rejects corrupt, oversized and unsuccessful cloud responses", async () => {
  await expect(
    cloudRequest(
      "https://example.com",
      "/",
      async () => new Response("not-json"),
    ),
  ).rejects.toMatchObject({ code: "CLOUD_RESPONSE_INVALID" });
  await expect(
    cloudRequest("https://example.com", "/", async () =>
      Response.json(
        { error: { code: "BUDGET_EXCEEDED", message: "Budget exhausted" } },
        { status: 402 },
      ),
    ),
  ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED", status: 402 });
  await expect(
    cloudRequest(
      "https://example.com",
      "/",
      async () => new Response("x".repeat(8 * 1024 * 1024 + 1)),
    ),
  ).rejects.toMatchObject({ code: "CLOUD_RESPONSE_TOO_LARGE" });
  expect(
    (
      await cloudRequest(
        "https://example.com",
        "/",
        async () => new Response(null, { status: 304 }),
        { etag: '"old"' },
      )
    ).data,
  ).toBeNull();
});
it("validates template references and only substitutes declared parameters", () => {
  const t = templateSchema.parse(base);
  expect(instantiate(t, {}).title).toBe("hi");
  expect(() => instantiate(t, { unknown: "bad" })).toThrow();
  expect(() => instantiate(t, { name: "far too many characters" })).toThrow();
  expect(() =>
    templateSchema.parse({
      ...base,
      composition: { ...base.composition, title: "{{missing}}" },
    }),
  ).toThrow();
  expect(() =>
    templateSchema.parse({
      ...base,
      composition: {
        ...base.composition,
        scenes: [{ ...base.composition.scenes[0], assetId: "undeclared" }],
      },
    }),
  ).toThrow();
  const a = {
    id: "image",
    sha256: "0".repeat(64),
    bytes: 100,
    name: "file",
    license: "original",
  };
  expect(() => templateSchema.parse({ ...base, assets: [a, a] })).toThrow();
  const withAsset = templateSchema.parse({
    ...base,
    assets: [a],
    composition: {
      ...base.composition,
      scenes: [{ ...base.composition.scenes[0], assetId: "image" }],
    },
  });
  expect(() => instantiate(withAsset, {})).toThrow("not downloaded");
  expect(
    instantiate(withAsset, {}, { image: "local-image" }).scenes[0].assetId,
  ).toBe("local-image");
});
