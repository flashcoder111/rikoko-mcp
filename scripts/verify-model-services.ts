import { chromium, expect } from "@playwright/test";
import { serve } from "@hono/node-server";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { createApp } from "../apps/server/src/app.js";
import { setServiceInfo } from "../packages/core/src/service-info.js";
import { connectCloud } from "../packages/cloud-client/src/index.js";

// Isolated browser fixture. Media is synthesized locally; no provider or checkout is called.
const dir = await mkdtemp(join(tmpdir(), "rikoko-model-ui-"));
const db = await Database.open();
const models = (["image", "video", "audio"] as const).map((kind) => ({
  id: `fixture-${kind}`,
  name: `测试${kind}`,
  description: "仅本地验收",
  kind,
  endpoint: `fixture/${kind}`,
  maxCostCents: 5,
  priceVersion: "fixture",
  hardBoundConfirmed: true,
  parameters: {},
}));
const service = new Service(
  db,
  new LocalStorage(dir),
  new FalProvider(models, "fixture-not-a-real-key", true, async () => {
    throw Error("Provider calls forbidden in UI acceptance");
  }),
  "external",
);
const account = await service.createAccount("UI fixture", 0);
setServiceInfo(service, { mode: "custom", plans: { plans: [] } });
const artifacts = resolve("artifacts/model-services");
await mkdir(artifacts, { recursive: true });
const fixtures: Record<string, string> = {};
for (const kind of ["image", "video", "audio"] as const) {
  const filename = join(
    dir,
    `fixture.${kind === "image" ? "png" : kind === "audio" ? "wav" : "mp4"}`,
  );
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    kind === "audio"
      ? "sine=frequency=440:duration=1"
      : "color=c=0x51466c:s=320x180:d=1",
    ...(kind === "image"
      ? ["-frames:v", "1"]
      : kind === "video"
        ? ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
        : []),
    filename,
  ]);
  const asset = await service.registerAsset(
    account.accountId,
    await readFile(filename),
    {
      name: `fixture-${kind}`,
      kind,
      mime:
        kind === "image"
          ? "image/png"
          : kind === "audio"
            ? "audio/wav"
            : "video/mp4",
      metadata: { width: 320, height: 180, durationMs: 1000 },
      provenance: { evidence: "local-test-fixture" },
    },
  );
  fixtures[kind] = asset.id;
}
const app = createApp(service, { studioDir: resolve("apps/studio/dist") });
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
if (!server.listening)
  await new Promise<void>((r) => server.once("listening", r));
const address = server.address();
if (!address || typeof address === "string") throw Error("Missing test port");
const origin = `http://127.0.0.1:${address.port}`;
let stopped = false;
const worker = (async () => {
  while (!stopped) {
    const job = await service.claim("ui-fixture");
    if (job) {
      const kind = models.find((m) => m.id === job.input.model)?.kind;
      if (!kind) throw Error("Unexpected fixture operation");
      await service.finish(
        job.id,
        job.leaseToken,
        { status: "completed", outputs: [fixtures[kind]] },
        5,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
})();
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "连接工作空间", exact: true }).click();
  await page.getByLabel("工作空间 API Key").fill(account.key);
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await expect(page.getByText("已连接", { exact: true })).toBeVisible();
  for (const kind of ["image", "video", "audio"] as const) {
    await page.getByLabel("创作方式", { exact: true }).selectOption(kind);
    await expect(page.getByLabel("生成模型")).toHaveValue(`fixture-${kind}`);
    await page.getByLabel("创作要求", { exact: true }).fill(`测试 ${kind}`);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.getByText("由你的供应商账户付费，不扣官方套餐额度。", {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "确认并生成", exact: true }).click();
    await expect(page.locator(".generation-status")).toContainText("生成完成", {
      timeout: 15000,
    });
    const preview = page.locator(
      `.generation-turn ${kind === "image" ? "img.generated-image" : kind}`,
    );
    await expect(preview).toBeVisible();
    await page.screenshot({
      path: join(artifacts, `${kind}.png`),
      fullPage: true,
    });
  }
  await page.reload();
  await expect(page.locator(".generation-turn audio")).toBeVisible();
  await page.getByRole("button", { name: "调整提示词", exact: true }).click();
  await expect(page.getByLabel("创作方式", { exact: true })).toHaveValue(
    "audio",
  );
  await expect(page.getByLabel("生成模型")).toHaveValue("fixture-audio");
  await page.getByRole("button", { name: "官方综合套餐", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "官方套餐暂未开放购买" }),
  ).toBeVisible();
  await expect(
    page.getByText("当前通过 config 使用自有服务", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "购买套餐" })).toHaveCount(0);
  await expect(page.getByText("我的模型服务", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: join(artifacts, "plans-empty.png"),
    fullPage: true,
  });
  const plans = {
    plans: [
      {
        id: "fixture-plan",
        name: "验收测试套餐",
        description: "仅用于界面验收，不是实际售卖套餐",
        currency: "USD" as const,
        priceMinor: 1000,
        allowanceCents: 1200,
        features: ["测试图片、视频与音频"],
        purchaseUrl: "https://checkout.example.com/fixture",
      },
    ],
  };
  setServiceInfo(service, { mode: "official", plans });
  connectCloud(
    service,
    "https://fixture.invalid",
    "fixture-cloud-key",
    async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/usage")
        return Response.json({
          balanceCents: 1200,
          reservedCents: 200,
          availableCents: 1000,
          charges: [
            {
              jobId: "charged",
              model: "fixture-image",
              createdAt: "2026-10-12T00:00:00Z",
              status: "completed",
              chargedCents: 12,
              reservedCents: 0,
              billingStatus: "confirmed",
            },
            {
              jobId: "pending",
              model: "fixture-video",
              createdAt: "2026-10-12T00:00:00Z",
              status: "submission_unknown",
              chargedCents: null,
              reservedCents: 200,
              billingStatus: "pending_reconciliation",
            },
          ],
        });
      if (path === "/v1/generation-models")
        return Response.json(service.provider.describe());
      throw Error("Unexpected cloud request");
    },
  );
  await page.getByRole("button", { name: "刷新用量" }).click();
  await expect(page.getByText("可用 US$10.00", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "API 调用账单" }),
  ).toContainText("已扣 US$0.12");
  await expect(
    page.getByRole("region", { name: "API 调用账单" }),
  ).toContainText("待核对 · 预留 US$2.00");
  await expect(
    page.getByText("本地剪辑、渲染和模板更新免费。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "购买套餐" })).toHaveAttribute(
    "href",
    "https://checkout.example.com/fixture",
  );
  await page.screenshot({
    path: join(artifacts, "plans-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "最近 API 调用" }),
  ).toHaveCount(1);
  await page.screenshot({
    path: join(artifacts, "plans-mobile.png"),
    fullPage: false,
  });
  await page.locator(".plan-footnote").scrollIntoViewIfNeeded();
  await expect(page.locator(".plan-footnote")).toBeInViewport();
  await expect(page.getByRole("link", { name: "购买套餐" })).toBeInViewport();
  await page.screenshot({ path: join(artifacts, "plans-mobile-bottom.png") });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow || errors.length)
    throw Error(JSON.stringify({ overflow, errors }));
  await writeFile(
    join(artifacts, "browser-verification.json"),
    JSON.stringify(
      {
        status: "PASS",
        simulatedProvider: true,
        paidCalls: 0,
        checkoutVisited: false,
        checks: [
          "config-only custom mode",
          "image/video/audio quote-submit-preview",
          "zero platform balance in custom mode",
          "unconfigured plans have no purchase button",
          "official balance source",
          "customer charge and pending reservation history",
          "configured checkout link",
          "desktop/mobile no overflow",
          "mobile billing and purchase sections remain reachable",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: model services browser acceptance; no paid calls or checkout visits.",
  );
} finally {
  await browser.close();
  stopped = true;
  await worker;
  await new Promise<void>((r) => server.close(() => r()));
  await db.close();
  await rm(dir, { recursive: true, force: true });
}
