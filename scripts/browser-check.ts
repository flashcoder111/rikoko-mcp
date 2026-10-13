import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:4310");
await page
  .getByLabel("工作空间 API Key")
  .fill((await readFile(".data/local-admin.key", "utf8")).trim());
await page.getByRole("button", { name: "进入工作台" }).click();
await page.getByRole("heading", { name: "让想法，成为下一条视频。" }).waitFor();
await page
  .getByRole("button", { name: "Orbit · 本地验收样片", exact: true })
  .first()
  .click();
await page.locator("video").waitFor();
await page.waitForFunction(() => {
  const v = document.querySelector("video");
  return v && v.readyState >= 2;
});
async function provePlayback() {
  await page.locator("video").evaluate(async (video: HTMLVideoElement) => {
    video.muted = true;
    await video.play();
  });
  await page.waitForFunction(() => {
    const video = document.querySelector("video");
    return video && video.currentTime > 0.4;
  });
  await page
    .locator("video")
    .evaluate((video: HTMLVideoElement) => video.pause());
}
await provePlayback();
await mkdir("artifacts/ui", { recursive: true });
await page.screenshot({ path: "artifacts/ui/desktop.png", fullPage: true });
const previousSource = await page.locator("video").getAttribute("src");
await page
  .getByLabel("镜头文案")
  .fill(`Browser revision ${Date.now()}. A new story.`);
await page.getByRole("button", { name: "保存并预览", exact: true }).click();
await page.waitForFunction(() => !document.querySelector(".busy"));
await page.waitForFunction(
  (oldSource) => {
    const v = document.querySelector("video");
    return v && v.readyState >= 2 && v.getAttribute("src") !== oldSource;
  },
  previousSource,
  { timeout: 60000 },
);
await provePlayback();
const versionCount = await page.locator(".version-list button").count();
await page
  .getByRole("button", { name: "记录", exact: false })
  .filter({ hasText: "反馈" })
  .count();
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "artifacts/ui/mobile.png", fullPage: true });
const horizontalOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth,
);
if (horizontalOverflow) throw Error("Mobile horizontal overflow");
if (errors.length) throw Error(errors.join("\n"));
await writeFile(
  "artifacts/ui/results.json",
  JSON.stringify(
    {
      status: "PASS",
      desktop: [1440, 1100],
      mobile: [390, 844],
      authenticatedPreview: true,
      browserRevision: true,
      versionCount,
      horizontalOverflow,
      consoleErrors: errors,
    },
    null,
    2,
  ),
);
console.log(
  "Browser acceptance: preview playback, local revision, desktop/mobile layout passed.",
);
await browser.close();
