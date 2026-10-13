import { chromium, expect } from "@playwright/test";
import { serve } from "@hono/node-server";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { createApp } from "../apps/server/src/app.js";
import { Worker } from "../apps/worker/src/worker.js";

const directory = await mkdtemp(join(tmpdir(), "audio-editor-e2e-"));
const artifacts = resolve("artifacts/audio-editing");
await mkdir(artifacts, { recursive: true });
const db = await Database.open();
const service = new Service(db, new LocalStorage(directory));
const account = await service.createAccount("Audio verification", 0);
const context = await service.authenticate(account.key);
const app = createApp(service, { studioDir: resolve("apps/studio/dist") });
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
if (!server.listening)
  await new Promise<void>((done) => server.once("listening", done));
const address = server.address();
if (!address || typeof address === "string") throw Error("Missing test server");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const worker = new Worker(service);
try {
  const fixture = join(directory, "source.mp4");
  await promisify(execFile)("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=24:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
    fixture,
  ]);
  const asset = await service.registerAsset(
    context.accountId,
    await readFile(fixture),
    {
      name: "本地声音测试.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: { hasAudio: true, durationMs: 4000, width: 320, height: 180 },
      provenance: { source: "synthetic-test" },
    },
  );
  const created = await callTool(service, context, "workspace_commit", {
    action: {
      type: "create",
      composition: {
        schemaVersion: 1,
        title: "声音与速度验收",
        width: 320,
        height: 180,
        scenes: [{ id: "first", durationMs: 4000, assetId: asset.id }],
      },
    },
    message: "本地验证",
    idempotencyKey: "audio-test-create",
  });
  await worker.tick();
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.request.post(`${origin}/auth/session`, {
    headers: { Authorization: `Bearer ${account.key}`, Origin: origin },
  });
  await page.goto(`${origin}/workspace?project=${created.projectId}`);
  await page.locator(".timeline-clip").first().dblclick();
  await page.getByLabel("成片速度", { exact: true }).selectOption("2");
  await expect(page.getByLabel("成片速度", { exact: true })).toHaveValue("2");
  await page.getByLabel("淡入秒数").fill("0.4");
  await page.getByLabel("淡出秒数").fill("0.4");
  await page.getByRole("button", { name: "应用淡入淡出", exact: true }).click();
  await expect(page.getByLabel("音量点 1", { exact: true })).toHaveValue("0");
  await page.getByLabel("原声音量", { exact: true }).fill("1.5");
  await expect(
    page.getByRole("img", { name: "音频波形和音量曲线" }),
  ).toBeVisible();
  await page.getByLabel("成片速度", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(artifacts, "audio-controls.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector(".stage-media") as HTMLVideoElement;
    return (
      video?.currentTime > 0.15 &&
      video.playbackRate === 2 &&
      video.volume === 1
    );
  });
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/tools/workspace_commit") &&
        response.request().method() === "POST",
    ),
    page
      .locator(".clip-inspector")
      .getByRole("button", { name: "保存并生成预览", exact: true })
      .click(),
  ]);
  if (!response.ok()) throw Error(await response.text());
  const saved = (await response.json()).result;
  await worker.tick();
  const snapshot = await callTool(service, context, "workspace_snapshot", {
    projectId: created.projectId,
  });
  const scene = snapshot.revision.composition.scenes[0];
  expect(scene).toMatchObject({ speed: 2, durationMs: 2000, volume: 1.5 });
  expect(scene.volumeEnvelope).toHaveLength(4);
  const job = await service.get(context, "job", saved.jobId);
  expect(job.status).toBe("completed");
  const output = await service.get(context, "asset", job.outputs[0]);
  expect(Math.abs(output.metadata.durationMs - 2000)).toBeLessThanOrEqual(50);
  await writeFile(
    join(artifacts, "speed-and-fades.mp4"),
    await service.storage.read(output.storageKey),
  );
  await page.reload();
  await page.locator(".timeline-clip").first().dblclick();
  await expect(page.getByLabel("成片速度", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("音量点 1", { exact: true })).toHaveValue("0");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(artifacts, "mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  await writeFile(
    join(artifacts, "verification.json"),
    JSON.stringify(
      {
        status: "PASS",
        checks: [
          "real-waveform",
          "speed-preview",
          "fade-controls",
          "gain-150-percent",
          "save-real-render",
          "reopen-persisted-edits",
          "mobile-layout",
        ],
        durationMs: output.metadata.durationMs,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Audio editor acceptance passed: waveform, speed, fades, gain, persistence, real export, mobile.",
  );
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
  await rm(directory, { recursive: true, force: true });
}
