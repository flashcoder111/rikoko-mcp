import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openRuntime } from "../apps/server/src/runtime.js";
import { cloudConnection } from "../packages/cloud-client/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { publicServiceInfo } from "../packages/core/src/service-info.js";

let dir: string;
let runtime: Awaited<ReturnType<typeof openRuntime>> | undefined;
const catalogUrl = "https://templates.example.com";
const gatewayUrl = "https://generation.example.com";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cloud-boundaries-"));
  for (const name of [
    "DATABASE_URL",
    "S3_BUCKET",
    "RIKOKO_CONFIG_FILE",
    "RIKOKO_PLANS_FILE",
    "FAL_MODELS_FILE",
    "CLOUD_API_URL",
    "CLOUD_API_KEY",
    "TEMPLATE_API_URL",
    "GENERATION_API_URL",
    "GENERATION_API_KEY",
    "FAL_KEY",
    "ENABLE_PAID_PROVIDERS",
    "FIXTURE_OFFICIAL_KEY",
  ])
    vi.stubEnv(name, "");
  vi.stubEnv("DATA_DIR", dir);
});
afterEach(async () => {
  await runtime?.db.close();
  runtime = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});
async function principal() {
  return runtime!.service.authenticate(
    (await readFile(join(dir, "local-admin.key"), "utf8")).trim(),
  );
}
it.each(["TEMPLATE_API_URL", "CLOUD_API_URL"])(
  "%s without a paid gateway key preserves personal model access and free manual templates",
  async (name) => {
    vi.stubEnv(name, catalogUrl);
    vi.stubEnv("FAL_KEY", "test-personal-secret");
    vi.stubEnv("ENABLE_PAID_PROVIDERS", "true");
    const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      Response.json({ schemaVersion: 1, revision: 0, templates: [] }),
    );
    vi.stubGlobal("fetch", fetcher);
    runtime = await openRuntime();
    expect(runtime.service.billingSource).toBe("external");
    expect(runtime.service.provider.describe().some((m) => m.available)).toBe(
      true,
    );
    expect(cloudConnection(runtime.service)?.gateway).toBeUndefined();
    const c = await principal();
    await callTool(runtime.service, c, "template_list", {});
    await publicServiceInfo(runtime.service);
    expect(fetcher).not.toHaveBeenCalled();
    await callTool(runtime.service, c, "template_sync", {});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${catalogUrl}/v1/catalog`);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(
      "test-personal-secret",
    );
    expect((await runtime.service.usage(c)).reservedCents).toBe(0);
  },
);
it("sends the official key only to the generation origin, with an independent template origin", async () => {
  vi.stubEnv("TEMPLATE_API_URL", catalogUrl);
  vi.stubEnv("GENERATION_API_URL", gatewayUrl);
  vi.stubEnv("GENERATION_API_KEY", "test-official-secret");
  const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) =>
    Response.json({ schemaVersion: 1, revision: 0, templates: [] }),
  );
  vi.stubGlobal("fetch", fetcher);
  runtime = await openRuntime();
  const c = await principal();
  await callTool(runtime.service, c, "template_sync", {});
  await callTool(runtime.service, c, "generation_usage", {});
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    `${catalogUrl}/v1/catalog`,
    `${gatewayUrl}/v1/usage`,
  ]);
  expect(
    new Headers(fetcher.mock.calls[0][1]?.headers).has("authorization"),
  ).toBe(false);
  expect(
    new Headers(fetcher.mock.calls[1][1]?.headers).get("authorization"),
  ).toBe("Bearer test-official-secret");
});
it("can disable the template service while keeping the explicit official gateway", async () => {
  const path = join(dir, "config.json");
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      mode: "official",
      templates: false,
      official: { url: gatewayUrl, keyEnv: "FIXTURE_OFFICIAL_KEY" },
    }),
  );
  vi.stubEnv("RIKOKO_CONFIG_FILE", path);
  vi.stubEnv("TEMPLATE_API_URL", catalogUrl);
  vi.stubEnv("FIXTURE_OFFICIAL_KEY", "fixture");
  runtime = await openRuntime();
  expect(cloudConnection(runtime.service)?.templates).toBeUndefined();
  expect(cloudConnection(runtime.service)?.gateway).toBeDefined();
  expect(
    await callTool(runtime.service, await principal(), "template_list", {}),
  ).toMatchObject({ configured: false });
});
it("explicit gateway configuration without a key never falls back to paid personal generation", async () => {
  vi.stubEnv("GENERATION_API_URL", gatewayUrl);
  vi.stubEnv("FAL_KEY", "personal-secret");
  vi.stubEnv("ENABLE_PAID_PROVIDERS", "true");
  runtime = await openRuntime();
  expect(runtime.service.provider.describe().every((m) => !m.available)).toBe(
    true,
  );
  await expect(
    callTool(runtime.service, await principal(), "generation_usage", {}),
  ).rejects.toMatchObject({ code: "CLOUD_NOT_CONFIGURED" });
});
it("preserves official testing usage instead of relabeling it as credit billing", async () => {
  vi.stubEnv("GENERATION_API_URL", gatewayUrl);
  vi.stubEnv("GENERATION_API_KEY", "test-official-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ billingSource: "testing", charges: [] })),
  );
  runtime = await openRuntime();
  expect(
    await callTool(runtime.service, await principal(), "generation_usage", {}),
  ).toMatchObject({ billingSource: "testing", mode: "official" });
});
