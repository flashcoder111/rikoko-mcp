import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRuntime } from "../apps/server/src/runtime.js";
import { cloudConnection } from "../packages/cloud-client/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "model-runtime-"));
  for (const key of [
    "DATABASE_URL",
    "S3_BUCKET",
    "RIKOKO_CONFIG_FILE",
    "RIKOKO_PLANS_FILE",
    "FAL_MODELS_FILE",
    "CLOUD_API_URL",
    "CLOUD_API_KEY",
    "FAL_KEY",
    "ENABLE_PAID_PROVIDERS",
    "FIXTURE_OFFICIAL_KEY",
  ])
    vi.stubEnv(key, "");
  vi.stubEnv("DATA_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
it("explicit custom config overrides legacy credentials and does not enable the official gateway", async () => {
  const path = join(dir, "config.json");
  await writeFile(
    path,
    JSON.stringify({ schemaVersion: 1, mode: "custom", providers: [] }),
  );
  vi.stubEnv("RIKOKO_CONFIG_FILE", path);
  vi.stubEnv("FAL_MODELS_FILE", join(dir, "obsolete-missing.json"));
  vi.stubEnv("CLOUD_API_URL", "https://api.example.com");
  vi.stubEnv("CLOUD_API_KEY", "legacy-must-not-be-used");
  const runtime = await openRuntime();
  try {
    expect(runtime.service.provider.describe()).toEqual([]);
    expect(runtime.service.billingSource).toBe("external");
    expect(cloudConnection(runtime.service)?.gateway).toBeUndefined();
    const c = await runtime.service.authenticate(
      (await runtime.service.createAccount("test", 0)).key,
    );
    expect(
      await callTool(runtime.service, c, "generation_usage", {}),
    ).toMatchObject({
      mode: "custom",
      billingSource: "external",
      balanceCents: 0,
    });
    await expect(
      callTool(runtime.service, c, "job_cancel", { jobId: "cloud-old-job" }),
    ).rejects.toMatchObject({ code: "CLOUD_NOT_CONFIGURED" });
  } finally {
    await runtime.db.close();
  }
});
it("official mode without its key remains unavailable and cannot fall back to a personal key", async () => {
  const path = join(dir, "config.json");
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      mode: "official",
      official: {
        url: "https://api.example.com",
        keyEnv: "FIXTURE_OFFICIAL_KEY",
      },
    }),
  );
  vi.stubEnv("RIKOKO_CONFIG_FILE", path);
  vi.stubEnv("FAL_KEY", "must-not-be-used");
  vi.stubEnv("ENABLE_PAID_PROVIDERS", "true");
  const runtime = await openRuntime();
  try {
    expect(runtime.service.provider.describe()).toEqual([]);
    const c = await runtime.service.authenticate(
      (await runtime.service.createAccount("test", 0)).key,
    );
    const cap = await callTool(runtime.service, c, "capabilities", {});
    expect(cap.generation.mode).toBe("official");
    await expect(
      callTool(runtime.service, c, "generation_usage", {}),
    ).rejects.toMatchObject({ code: "CLOUD_NOT_CONFIGURED" });
  } finally {
    await runtime.db.close();
  }
});
