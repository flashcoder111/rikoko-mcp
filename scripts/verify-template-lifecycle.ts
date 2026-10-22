import { serve } from "@hono/node-server";
import { chromium, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service, fingerprint } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { connectServices } from "../packages/cloud-client/src/index.js";
import { templateSchema } from "../packages/templates/src/schema.js";
const dir = await mkdtemp(join(tmpdir(), "rikoko-template-e2e-"));
const db = await Database.open();
const service = new Service(db, new LocalStorage(dir));
const account = await service.createAccount("Template verification", 0);
const context = await service.authenticate(account.key);
let version = 1;
connectServices(
  service,
  { templateOrigin: "https://templates.example.com" },
  async () => {
    const t = templateSchema.parse({
      schemaVersion: 1,
      id: "coffee-demo",
      version,
      title: "Official coffee",
      description: "Official coffee ritual",
      composition: {
        schemaVersion: 1,
        title: "Coffee ritual",
        width: 360,
        height: 640,
        scenes: [
          { id: "cup", durationMs: 1000, text: `Official coffee v${version}` },
        ],
      },
    });
    return Response.json({
      schemaVersion: 1,
      revision: version,
      templates: [{ ...t, hash: fingerprint(t) }],
    });
  },
);
await callTool(service, context, "template_sync", {});
await callTool(service, context, "template_apply", {
  id: "coffee-demo",
  version: 1,
});
const app = createApp(service, { studioDir: resolve("apps/studio/dist") });
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
await new Promise<void>((done) => server.once("listening", done));
const port = (server.address() as { port: number }).port;
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.request.post(`${origin}/auth/session`, {
    headers: { Origin: origin, Authorization: `Bearer ${account.key}` },
  });
  expect(response.ok()).toBe(true);
  await page.goto(`${origin}/templates`);
  await expect(
    page.getByRole("heading", { name: "模板库", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("选择作品版本")
    .selectOption({ label: "Coffee ritual · v1" });
  await page
    .getByRole("button", { name: "保存为我的模板", exact: true })
    .click();
  await page.getByLabel("模板名称").fill("My moonlight coffee");
  await page.getByLabel("用途描述").fill("Moonlight coffee ritual");
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My moonlight coffee", exact: true }),
  ).toBeVisible();
  version = 2;
  await page.getByRole("button", { name: "更新官方模板", exact: true }).click();
  await expect(
    page.getByText(
      "来源有 v2 更新。你的版本保持不变，可让 Agent 比较后按需调整。",
    ),
  ).toBeVisible();
  await page.getByLabel("模板来源").selectOption("personal");
  await expect(page.locator(".template-inventory-grid article")).toHaveCount(1);
  const matched = await callTool(service, context, "template_match", {
    brief: "My moonlight coffee ritual",
  });
  const own = matched.candidates.find(
    (x: any) => x.template.title === "My moonlight coffee",
  )?.template;
  expect(own?.sourceKind).toBe("personal");
  expect(own?.version).toBe(1);
  const prepared = await callTool(service, context, "template_prepare", {
    id: own.id,
    version: 1,
    sourceKind: "personal",
  });
  expect(prepared.composition.scenes[0].text).toBe("Official coffee v1");
  const output = resolve("output/template-lifecycle-2026-10-22");
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: join(output, "personal-template-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(output, "personal-template-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "browser save",
        "official sync",
        "personal version protection",
        "agent retrieval and reuse",
        "mobile overflow",
        "no page errors",
      ],
      screenshots: output,
    }),
  );
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
  await rm(dir, { recursive: true, force: true });
}
