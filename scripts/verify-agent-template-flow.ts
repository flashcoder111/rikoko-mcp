import { chromium, expect } from "@playwright/test";
import { serve } from "@hono/node-server";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage, sha256 } from "../packages/storage/src/index.js";
import { completeUpload } from "../packages/core/src/assets.js";
import { starterBytes } from "../packages/templates/src/local-library.js";
import { createApp } from "../apps/server/src/app.js";
import { Worker } from "../apps/worker/src/worker.js";

process.env.ENABLE_CREATIVE_AGENT = "false";
const temp = await mkdtemp(join(tmpdir(), "rikoko-auto-template-ui-"));
const out = resolve("artifacts/agent-template-flow");
await mkdir(out, { recursive: true });
const db = await Database.open();
const service = new Service(db, new LocalStorage(temp));
const account = await service.createAccount(
  "Automatic template verification",
  0,
);
const c = await service.authenticate(account.key);
const app = createApp(service, { studioDir: resolve("apps/studio/dist") });
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
await new Promise<void>((yes, no) => {
  server.once("listening", yes);
  server.once("error", no);
});
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const worker = new Worker(service);
const running = worker.loop();
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const planRequests: { message: string; assetIds: string[] }[] = [];
page.on("request", (request) => {
  if (request.url().endsWith("/api/tools/workspace_plan"))
    planRequests.push(request.postDataJSON());
});
async function waitRender(count: number) {
  await expect
    .poll(
      async () =>
        (await service.list(c, "job")).filter((j) => j.status === "completed")
          .length,
      { timeout: 90000 },
    )
    .toBe(count);
}
async function prompt(message: string) {
  await page.getByLabel("创作要求", { exact: true }).fill(message);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}
try {
  await page.goto(`${origin}/templates`); // Old bookmarks return to direct conversation.
  await page.getByRole("button", { name: "连接工作空间", exact: true }).click();
  await page.getByLabel("工作空间 API Key", { exact: true }).fill(account.key);
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await page.getByText("已连接", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("创作方式").inputValue(), "edit");
  assert.equal(await page.locator(".template-grid,.prompt-grid").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "成片模板", exact: true }).count(),
    0,
  );
  await page.screenshot({
    path: join(out, "01-direct-conversation.png"),
    fullPage: true,
  });
  await prompt("帮我做一条15秒的咖啡店新品宣传视频，主打生椰拿铁，温暖一点");
  await page.waitForURL("**/?project=*");
  await waitRender(1);
  assert.deepEqual(planRequests[0].assetIds, []);
  assert.equal(
    await page
      .getByRole("button", { name: "应用并生成预览", exact: true })
      .count(),
    0,
  );
  const first = (await service.list(c, "revision"))[0];
  const firstIds = first.composition.scenes.map((s: any) => s.assetId);
  assert.equal(
    first.composition.scenes.reduce(
      (sum: number, s: any) => sum + s.durationMs,
      0,
    ),
    15000,
  );
  assert.ok(
    first.composition.scenes.some((s: any) => s.text.includes("生椰拿铁")),
  );
  await page.getByRole("link", { name: "下载视频", exact: true }).waitFor();
  await page
    .locator(".conversation-result video")
    .evaluate((element: HTMLVideoElement) => element.play());
  await expect
    .poll(() =>
      page
        .locator(".conversation-result video")
        .evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0.3);
  await page
    .locator(".conversation-result video")
    .evaluate((element: HTMLVideoElement) => element.pause());
  await page.screenshot({
    path: join(out, "02-automatic-result.png"),
    fullPage: true,
  });
  const firstJob = (await service.list(c, "job"))[0];
  const rendered = await service.get(c, "asset", firstJob.outputs[0]);
  await writeFile(
    join(out, "text-only-preview.mp4"),
    await service.storage.read(rendered.storageKey),
  );
  await prompt("第一个镜头字幕改成：新品到店");
  await page
    .getByRole("button", { name: "应用并生成预览", exact: true })
    .click();
  await waitRender(2);
  const changed = (await service.list(c, "revision"))[0];
  assert.deepEqual(
    changed.composition.scenes.map((s: any) => s.assetId),
    firstIds,
  );

  // Upload a known fixture via the real media pipeline, then let the Agent find it without attachment selection.
  const bytes = await starterBytes("starter-product-stage");
  const intent = await service.createUpload(c, {
    name: "生椰拿铁包装示意.png",
    bytes: bytes.length,
    sha256: sha256(bytes),
    source: "ui-test-upload",
    license: "Apache-2.0",
    rightsConfirmed: true,
  });
  const owned = await completeUpload(service, c, intent.id, bytes);
  await service.scoped(c, "write", (tx) =>
    tx.put({
      ...owned,
      library: {
        category: "商品",
        tags: ["咖啡店", "生椰拿铁"],
        favorite: true,
      },
    }),
  );
  await page.getByRole("button", { name: "新建作品", exact: true }).click();
  await prompt("咖啡店上新短片，主打生椰拿铁，9秒");
  await waitRender(3);
  assert.deepEqual(planRequests.at(-1)?.assetIds, []);
  const reused = (await service.list(c, "revision"))[0];
  assert.ok(
    reused.composition.scenes.every((s: any) => s.assetId === owned.id),
  );
  await page.screenshot({
    path: join(out, "03-existing-assets-reused.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.getByLabel("创作要求", { exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({
    path: join(out, "04-mobile-direct-conversation.png"),
    fullPage: true,
  });
  const jobs = await service.list(c, "job");
  assert.ok(jobs.every((job) => job.input.kind === "render"));
  assert.deepEqual(errors, []);
  const report = {
    status: "PASS",
    textOnlyAutomaticRender: true,
    userTemplateSelections: 0,
    referenceUploadsRequired: false,
    existingAssetReuseWithoutAttachments: true,
    captionEditPreservesAssets: true,
    actualLocalRenders: jobs.length,
    mobileOverflow: false,
    browserErrors: errors,
    paidMediaGenerationRequests: 0,
    modelSelectionTest:
      "mocked in unit tests; browser used deterministic local matching",
  };
  await writeFile(
    join(out, "verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  worker.stop();
  await running;
  server.close();
  await db.close();
  await rm(temp, { recursive: true, force: true });
}
