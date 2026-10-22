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

const directory = await mkdtemp(join(tmpdir(), "rikoko-workspace-handoff-"));
const artifacts = resolve("artifacts/workspace-handoff");
await mkdir(artifacts, { recursive: true });
const db = await Database.open();
const service = new Service(db, new LocalStorage(directory));
const account = await service.createAccount(
  "Workspace editing verification",
  0,
);
const context = await service.authenticate(account.key);
const app = createApp(service, { studioDir: resolve("apps/studio/dist") });
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
if (!server.listening)
  await new Promise<void>((done) => server.once("listening", done));
const address = server.address();
if (!address || typeof address === "string") throw Error("Missing test server");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const worker = new Worker(service, ["render"]);
try {
  const fixture = join(directory, "source.mp4"),
    musicPath = join(directory, "music.wav");
  const exec = promisify(execFile);
  await exec("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x294c61:s=360x640:r=24:d=3",
    "-c:v",
    "libx264",
    fixture,
  ]);
  await exec("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    musicPath,
  ]);
  const asset = await service.registerAsset(
    context.accountId,
    await readFile(fixture),
    {
      name: "合成测试画面.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: { hasAudio: false, durationMs: 3000, width: 360, height: 640 },
      provenance: { source: "synthetic-test" },
    },
  );
  const created = await callTool(service, context, "workspace_commit", {
    action: {
      type: "create",
      composition: {
        schemaVersion: 1,
        title: "文案与音乐编辑验收",
        width: 360,
        height: 640,
        scenes: [
          {
            id: "first",
            durationMs: 3000,
            assetId: asset.id,
            text: "原始文案",
          },
        ],
      },
    },
    message: "本地验证",
    idempotencyKey: "create",
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
  await page.goto(
    `${origin}/workspace?project=${created.projectId}&revision=${created.revisionId}`,
  );
  await page.getByRole("button", { name: "改文案", exact: true }).click();
  await page.getByLabel("镜头字幕").fill("新文案，画面保持不变");
  await expect(
    page.getByRole("button", { name: "保存并合成预览", exact: true }).first(),
  ).toBeEnabled();
  await page.screenshot({
    path: join(artifacts, "caption-edit.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "换音乐", exact: true }).click();
  await page.getByLabel("上传背景音乐").setInputFiles(musicPath);
  await page
    .getByRole("button", { name: "我有使用权限，上传", exact: true })
    .click();
  await expect(
    page
      .getByLabel("背景音乐", { exact: true })
      .locator("option", { hasText: "music.wav" }),
  ).toHaveCount(1);
  await page
    .getByLabel("背景音乐", { exact: true })
    .selectOption({ label: "music.wav" });
  await page.getByLabel("配乐音量", { exact: true }).fill("0.2");
  await page
    .getByRole("button", { name: "保存并合成预览", exact: true })
    .first()
    .click();
  await expect
    .poll(
      async () =>
        (
          await callTool(service, context, "workspace_snapshot", {
            projectId: created.projectId,
          })
        ).revision.id,
    )
    .not.toBe(created.revisionId);
  await worker.tick();
  const state = await callTool(service, context, "workspace_snapshot", {
    projectId: created.projectId,
  });
  expect(state.revision.composition.scenes[0]).toMatchObject({
    assetId: asset.id,
    text: "新文案，画面保持不变",
  });
  expect(state.revision.composition.audio.gain).toBe(0.2);
  expect(state.jobs[0].status).toBe("completed");
  await expect(page.locator(".edit-status")).toContainText("修改已保存", {
    timeout: 15000,
  });
  await page.waitForFunction(() => {
    const video = document.querySelector(
      ".studio-player video",
    ) as HTMLVideoElement | null;
    return video && video.readyState >= 2;
  });
  expect(
    state.jobs.every(
      (job: { input: { kind: string } }) => job.input.kind === "render",
    ),
  ).toBe(true);
  const dismiss = page
    .locator(".feedback-bar")
    .getByRole("button", { name: "关闭", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.getByLabel("关闭编辑面板").click();
  await page.getByText("交给 Hermes 继续", { exact: true }).click();
  await page
    .getByLabel("交给 Hermes 的要求")
    .fill("保持画面，只把结尾文案改得简短一些");
  await page
    .getByRole("button", { name: "准备交给 Hermes", exact: true })
    .click();
  const link = page.getByRole("link", {
    name: "打开 Hermes，选择原会话",
    exact: true,
  });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^hermes:\/\/rikoko-handoff/);
  const requestId = new URL(href!).searchParams.get("request");
  const request = await callTool(service, context, "workspace_request_get", {
    requestId,
  });
  expect(request).toMatchObject({
    projectId: created.projectId,
    revisionId: state.revision.id,
    selectedSceneId: "first",
  });
  expect(
    (
      await callTool(service, context, "workspace_snapshot", {
        projectId: created.projectId,
      })
    ).jobs,
  ).toHaveLength(2);
  await page.screenshot({
    path: join(artifacts, "hermes-handoff.png"),
    fullPage: true,
  });
  // Simulate an edit arriving through MCP while the browser is pinned to its saved revision.
  await callTool(service, context, "workspace_commit", {
    projectId: created.projectId,
    baseRevisionId: state.revision.id,
    action: {
      type: "edit",
      edits: [{ type: "caption", sceneId: "first", text: "Hermes 更新的文案" }],
    },
    message: "Agent 续改验证",
    idempotencyKey: "agent-update",
    origin: "agent",
  });
  await page.getByRole("button", { name: "载入最新版本", exact: true }).click();
  await page.getByRole("button", { name: "改文案", exact: true }).click();
  await expect(page.getByLabel("镜头字幕")).toHaveValue("Hermes 更新的文案");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(artifacts, "mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  await writeFile(
    join(artifacts, "result.json"),
    JSON.stringify(
      {
        status: "PASS",
        realRender: true,
        originalVideoReused: true,
        musicUpload: true,
        handoffSaved: true,
        latestVersionLoaded: true,
        paidGenerationExecuted: false,
        hermesMessageSent: false,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: copy/music editing, real local render, handoff preparation, latest-version refresh, desktop/mobile.",
  );
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
  await rm(directory, { recursive: true, force: true });
}
