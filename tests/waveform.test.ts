import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { callTool, type ToolName } from "../packages/mcp/src/tools.js";

let db: Database, dir: string;
afterEach(async () => {
  await db?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});
it("returns real bounded waveform data only for owned audio, with read scope and no billed job", async () => {
  dir = await mkdtemp(join(tmpdir(), "waveform-test-"));
  db = await Database.open();
  const service = new Service(db, new LocalStorage(dir));
  const owner = await service.createAccount("Wave", 0);
  const other = await service.createAccount("Other", 0);
  const c = await service.authenticate(owner.key);
  const path = join(dir, "tone.wav");
  await promisify(execFile)("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    path,
  ]);
  const asset = await service.registerAsset(c.accountId, await readFile(path), {
    name: "tone.wav",
    kind: "audio",
    mime: "audio/wav",
    metadata: { hasAudio: true, durationMs: 1000 },
    provenance: { source: "test" },
  });
  const input = { assetId: asset.id, startMs: 0, durationMs: 1000, bins: 32 };
  const result = await callTool(
    service,
    c,
    "asset_waveform" as ToolName,
    input,
  );
  expect(result.peaks).toHaveLength(32);
  expect(Math.min(...result.peaks)).toBeGreaterThan(0.05);
  expect(
    await callTool(service, c, "asset_waveform" as ToolName, input),
  ).toEqual(result);
  await expect(
    callTool(
      service,
      await service.authenticate(other.key),
      "asset_waveform" as ToolName,
      input,
    ),
  ).rejects.toThrow();
  await expect(
    callTool(service, c, "asset_waveform" as ToolName, {
      ...input,
      startMs: 1000,
    }),
  ).rejects.toThrow();
  await expect(
    callTool(service, c, "asset_waveform" as ToolName, {
      ...input,
      bins: 100000,
    }),
  ).rejects.toThrow();
  expect(await service.list(c, "job")).toHaveLength(0);
  const readKey = await service.issueKey(c, {
    name: "Wave read",
    scopes: ["read"],
    budgetCents: 0,
  });
  const readContext = await service.authenticate(readKey.key);
  const readResult = await callTool(
    service,
    readContext,
    "asset_waveform",
    input,
  );
  expect(readResult.peaks).toHaveLength(32);
  await service.revokeKey(c, readKey.id);
  await expect(
    callTool(service, readContext, "asset_waveform", input),
  ).rejects.toThrow();
});
