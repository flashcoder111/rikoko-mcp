import { chromium, expect } from "@playwright/test";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { starterBytes } from "../packages/templates/src/local-library.js";
import { createApp } from "../apps/server/src/app.js";
import { Worker } from "../apps/worker/src/worker.js";

process.env.ENABLE_CREATIVE_AGENT = "false";
const temp = await mkdtemp(join(tmpdir(), "rikoko-conversation-"));
const out = resolve("artifacts/conversation-delivery");
await mkdir(out, { recursive: true });
const db = await Database.open();
const service = new Service(db, new LocalStorage(join(temp, "assets")));
const account = await service.createAccount(
  "Conversation verification (local only)",
  0,
);
const c = await service.authenticate(account.key);
const server = serve({
  fetch: createApp(service, { studioDir: resolve("apps/studio/dist") }).fetch,
  hostname: "127.0.0.1",
  port: 0,
});
if (!server.listening)
  await new Promise<void>((done) => server.once("listening", done));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.PUBLIC_BASE_URL = origin;
const worker = new Worker(service);
const running = worker.loop();
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const plans: { message: string; requestId?: string; assetIds: string[] }[] = [];
page.on("request", (request) => {
  if (request.url().endsWith("/api/tools/workspace_plan"))
    plans.push(request.postDataJSON());
});
const client = new Client({ name: "conversation-verification", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    "--import",
    resolve("node_modules/tsx/dist/loader.mjs"),
    resolve("packages/mcp/src/stdio.ts"),
  ],
  env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    VIDEOWORKBENCH_URL: origin,
    VIDEOWORKBENCH_API_KEY: account.key,
    VIDEOWORKBENCH_CLIENT: "codex",
    VIDEOWORKBENCH_EXPORT_DIR: join(temp, "exports"),
    VIDEOWORKBENCH_IMPORT_ROOTS: JSON.stringify([temp]),
  },
  stderr: "pipe",
});
async function prompt(text: string) {
  await page.getByLabel("创作要求", { exact: true }).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}
async function waitRender(count: number) {
  await expect
    .poll(
      async () =>
        (await service.list(c, "job")).filter(
          (job) => job.status === "completed",
        ).length,
      { timeout: 90000 },
    )
    .toBe(count);
}
try {
  await page.goto(origin);
  await page.getByRole("button", { name: "连接工作空间", exact: true }).click();
  await page.getByLabel("工作空间 API Key", { exact: true }).fill(account.key);
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await page.getByText("已连接", { exact: true }).waitFor();
  await prompt("制作这款产品的 3 秒竖屏短片，不用模板。脚本：功能演示");
  await page.waitForURL("**/?request=*");
  await expect(page.locator(".proposal-card")).toContainText("产品正面照片");
  assert.equal((await service.list(c, "job")).length, 0);
  const requestId = new URL(page.url()).searchParams.get("request");
  await page.reload();
  await expect(page.locator(".proposal-card")).toContainText("产品正面照片");
  await page.screenshot({
    path: join(out, "01-missing-material.png"),
    fullPage: true,
  });
  await page.locator(".composer input[type=file]").setInputFiles({
    name: "product-test-illustration.png",
    mimeType: "image/png",
    buffer: await starterBytes("starter-product-stage"),
  });
  await page
    .getByRole("button", { name: "我有使用权限，上传", exact: true })
    .click();
  await expect(page.locator(".composer")).toContainText(
    "product-test-illustration.png",
  );
  await expect(page.getByLabel("创作要求", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByRole("button", { name: "应用并生成预览", exact: true })
    .waitFor();
  assert.equal(plans.at(-1)?.message, "");
  assert.equal(plans.at(-1)?.requestId, requestId);
  assert.equal(plans.at(-1)?.assetIds.length, 1);
  // The ready proposal survives a reload, including the original commit message.
  await page.reload();
  await page
    .getByRole("button", { name: "应用并生成预览", exact: true })
    .click();
  await page.waitForURL("**/?project=*");
  await waitRender(1);
  await page.getByRole("link", { name: "下载视频", exact: true }).waitFor();
  await page.getByText("查看视频文案", { exact: true }).click();
  await expect(page.locator(".conversation-result details")).toContainText(
    "功能演示",
  );
  await page
    .locator(".conversation-result video")
    .evaluate((element: HTMLVideoElement) => element.play());
  await expect
    .poll(() =>
      page
        .locator(".conversation-result video")
        .evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0.2);
  await page
    .locator(".conversation-result video")
    .evaluate((element: HTMLVideoElement) => element.pause());
  const firstRevision = (await service.list(c, "revision"))[0];
  await prompt("第一个镜头字幕改成：继续修改成功");
  await page
    .getByRole("button", { name: "应用并生成预览", exact: true })
    .click();
  await waitRender(2);
  await page.getByRole("link", { name: "下载视频", exact: true }).waitFor();
  await expect(page.locator(".conversation-result details")).toContainText(
    "继续修改成功",
  );
  await expect(page.locator(".conversation-result video")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  const changed = (await service.list(c, "revision"))[0];
  assert.equal(
    changed.composition.scenes[0].assetId,
    firstRevision.composition.scenes[0].assetId,
  );
  await client.connect(transport);
  const job = (await service.list(c, "job"))[0];
  const result = await client.callTool({
    name: "workspace_result",
    arguments: { jobId: job.id },
  });
  assert.notEqual(result.isError, true);
  const delivered = (result.structuredContent as any).result;
  assert.ok(delivered.textContent.screenText.includes("继续修改成功"));
  assert.ok(
    result.content.some(
      (item: any) =>
        item.type === "resource_link" && item.mimeType === "video/mp4",
    ),
  );
  const video = delivered.media.find(
    (item: any) => item.mimeType === "video/mp4",
  );
  assert.ok(video.localPath);
  const bytes = await readFile(video.localPath);
  assert.ok(bytes.length > 1000);
  await writeFile(join(out, "conversation-result.mp4"), bytes);
  assert.equal((await fetch(video.url)).status, 200);
  assert.equal((await service.list(c, "job")).length, 2);
  await page.screenshot({
    path: join(out, "02-video-and-content.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: join(out, "03-mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  const report = {
    status: "PASS",
    pendingRequestSurvivesReload: true,
    attachmentOnlyResume: true,
    readyProposalSurvivesReload: true,
    originalIntentPreserved: true,
    actualLocalRenders: 2,
    captionEditReusesMedia: true,
    videoPlayback: true,
    stdioNativeAttachmentAndResourceLinks: true,
    videoAndContentReturned: true,
    browserErrors: errors,
    mobileOverflow: false,
    paidGenerationCalls: 0,
    evidence:
      "Real local render and browser/stdio flow; original illustration fixture, no live AI generation or native desktop UI acceptance.",
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
  await client.close();
  await browser.close();
  worker.stop();
  await running;
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
  await rm(temp, { recursive: true, force: true });
}
