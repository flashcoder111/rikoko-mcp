import { afterAll, beforeAll, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
let dir: string,
  db: Database,
  service: Service,
  owner: any,
  other: any,
  asset: any;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "crop-test-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir), new FalProvider());
  owner = await service.authenticate(
    (await service.createAccount("owner", 100)).key,
  );
  other = await service.authenticate(
    (await service.createAccount("other", 100)).key,
  );
  const file = join(dir, "source.png");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x480",
    "-frames:v",
    "1",
    file,
  ]);
  asset = await service.registerAsset(owner.accountId, await readFile(file), {
    name: "source.png",
    kind: "image",
    mime: "image/png",
    metadata: { width: 640, height: 480 },
    provenance: { evidence: "synthetic" },
  });
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
const crop = () => ({
  assetId: asset.id,
  rect: { x: 80, y: 40, width: 400, height: 360 },
  reason: "Isolate the subject; retain relevant silhouette",
});
it("creates a real bounded derivative, reuses it on retry and leaves visual judgment unreviewed", async () => {
  const result: any = await callTool(
    service,
    owner,
    "media_crop" as any,
    crop(),
  );
  expect(result.assetId).not.toBe(asset.id);
  expect(result.metadata).toMatchObject({ width: 400, height: 360 });
  expect(result.visualAcceptance).toBe("unreviewed");
  const output = await service.get(owner, "asset", result.assetId);
  expect(output.sha256).not.toBe(asset.sha256);
  const again: any = await callTool(
    service,
    owner,
    "media_crop" as any,
    crop(),
  );
  expect(again.assetId).toBe(result.assetId);
  expect(again.derivationId).toBe(result.derivationId);
});
it("rejects a foreign image, out of bounds and a no-op crop", async () => {
  await expect(
    callTool(service, other, "media_crop" as any, crop()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    callTool(service, owner, "media_crop" as any, {
      ...crop(),
      rect: { x: 600, y: 0, width: 100, height: 300 },
    }),
  ).rejects.toMatchObject({ code: "INVALID_CROP" });
  await expect(
    callTool(service, owner, "media_crop" as any, {
      ...crop(),
      rect: { x: 0, y: 0, width: 640, height: 480 },
    }),
  ).rejects.toMatchObject({ code: "INVALID_CROP" });
});
it("checks source bytes even when a crop was previously cached", async () => {
  await service.storage.put(asset.storageKey, Buffer.from("tampered"));
  await expect(
    callTool(service, owner, "media_crop" as any, crop()),
  ).rejects.toMatchObject({ code: "SOURCE_MISMATCH" });
});
