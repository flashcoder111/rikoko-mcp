import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
vi.mock("../packages/storage/src/tiktok.js", () => ({
  downloadTikTok: vi.fn(),
}));
import { downloadTikTok } from "../packages/storage/src/tiktok.js";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { importUrl } from "../packages/core/src/assets.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { Worker } from "../apps/worker/src/worker.js";
import { callTool, tools } from "../packages/mcp/src/tools.js";

let dir: string, db: Database, service: Service, context: any;
const input = {
  url: "https://vm.tiktok.com/Example/",
  name: "reference.mp4",
  license: "user-controlled",
  rightsConfirmed: true as const,
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rikoko-tiktok-test-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  context = await service.authenticate(
    (await service.createAccount("Local", 0)).key,
  );
  vi.mocked(downloadTikTok).mockReset();
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

it("uses the existing import tool, deduplicates background downloads and registers real probed media", async () => {
  expect(tools).not.toHaveProperty("asset_download");
  const first = await callTool(service, context, "asset_import_url", input);
  const second = await importUrl(service, context, input);
  expect(second.id).toBe(first.id);
  expect(first).toMatchObject({
    type: "job",
    status: "queued",
    input: { kind: "import_video" },
  });
  expect(downloadTikTok).not.toHaveBeenCalled();
  const fixture = join(dir, "fixture.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=144x256:r=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440",
    "-t",
    "0.5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    fixture,
  ]);
  vi.mocked(downloadTikTok).mockImplementation(async (_url, work, options) => {
    await options?.onPhase?.("preparing_download");
    const path = join(work, "source.mp4");
    await writeFile(path, await readFile(fixture));
    return { path, videoId: "123456789", downloaderVersion: "fixture" };
  });
  await new Worker(service).tick();
  const job = await service.get(context, "job", first.id);
  expect(job).toMatchObject({
    status: "completed",
    chargedCents: 0,
    assetId: job.outputs[0],
  });
  const asset = await service.get(context, "asset", job.outputs[0]);
  expect(asset).toMatchObject({
    kind: "video",
    metadata: { width: 144, height: 256, hasAudio: true },
    provenance: {
      source: input.url,
      platform: "tiktok",
      videoId: "123456789",
      rightsConfirmed: true,
    },
  });
  expect((await service.usage(context)).availableCents).toBe(0);
});

it("rejects read-only and revoked keys before queueing or preparing dependencies", async () => {
  const readKey = await service.issueKey(context, {
    name: "read",
    scopes: ["read"],
    budgetCents: 0,
  });
  await expect(
    importUrl(service, await service.authenticate(readKey.key), input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await service.revokeKey(context, context.keyId);
  await expect(importUrl(service, context, input)).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  expect(downloadTikTok).not.toHaveBeenCalled();
});

it("preserves downloader diagnostics and allows a fresh attempt after failure", async () => {
  const job = await importUrl(service, context, input);
  const { AppError } = await import("../packages/contracts/src/index.js");
  vi.mocked(downloadTikTok).mockRejectedValue(
    new AppError("DOWNLOAD_LOGIN_REQUIRED", "该视频需要登录后访问。"),
  );
  await new Worker(service).tick();
  expect(await service.get(context, "job", job.id)).toMatchObject({
    status: "failed",
    error: { code: "DOWNLOAD_LOGIN_REQUIRED" },
  });
  const retry = await importUrl(service, context, input);
  expect(retry.id).not.toBe(job.id);
});

it("cancels queued imports without installing or downloading", async () => {
  const job = await importUrl(service, context, input);
  await service.cancel(context, job.id);
  await new Worker(service).tick();
  expect((await service.get(context, "job", job.id)).status).toBe("cancelled");
  expect(downloadTikTok).not.toHaveBeenCalled();
});

it("does not enable dependency installation on a remote service", async () => {
  const queued = await importUrl(service, context, input);
  service.localVideoDownloads = false;
  await expect(importUrl(service, context, input)).rejects.toMatchObject({
    code: "CAPABILITY_UNAVAILABLE",
  });
  expect(downloadTikTok).not.toHaveBeenCalled();
  await new Worker(service).tick();
  expect((await service.get(context, "job", queued.id)).status).toBe(
    "blocked_external",
  );
  expect(downloadTikTok).not.toHaveBeenCalled();
});
