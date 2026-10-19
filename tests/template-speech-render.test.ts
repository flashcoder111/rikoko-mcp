import { expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { Worker } from "../apps/worker/src/worker.js";
import { srt } from "../packages/render/src/index.js";

it("renders speech-templated audio and timed sentence captions with the real local media executor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rikoko-speech-render-"));
  const db = await Database.open();
  try {
    const service = new Service(db, new LocalStorage(join(dir, "assets")));
    const context = await service.authenticate(
      (await service.createAccount("Speech render", 0)).key,
    );
    const paid = vi.spyOn(service.provider, "submit");
    const path = join(dir, "recording.wav");
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=3",
      path,
    ]);
    const source = await service.registerAsset(
      context.accountId,
      await readFile(path),
      {
        name: "recording.wav",
        kind: "audio",
        mime: "audio/wav",
        metadata: { durationMs: 3000, hasAudio: true },
        provenance: { source: "sine-fixture" },
      },
    );
    const transcript = await service.registerAsset(
      context.accountId,
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          language: "en",
          durationMs: 3000,
          evidence: "precomputed",
          words: [
            { id: "one", text: "One", startMs: 200, endMs: 600 },
            { id: "two", text: "Two", startMs: 1200, endMs: 1700 },
            { id: "three", text: "Three", startMs: 2200, endMs: 2700 },
          ],
        }),
      ),
      {
        name: "transcript.json",
        kind: "transcript",
        mime: "application/json",
        metadata: { sourceAssetId: source.id },
        provenance: { source: "precomputed-fixture" },
      },
    );
    const prepared = await callTool(service, context, "template_prepare", {
      id: "rikoko-starter-product",
      version: 1,
      parameters: { text1: "One", text2: "Two", text3: "Three" },
      speech: { assetId: source.id, transcriptAssetId: transcript.id },
    });
    const composition = {
      ...prepared.composition,
      width: 144,
      height: 256,
      captionStyle: { ...prepared.composition.captionStyle, fontSize: 12 },
    };
    const committed = await callTool(service, context, "workspace_commit", {
      action: { type: "create", composition },
      message: "Speech timing fixture",
      idempotencyKey: "render-once",
    });
    expect(await new Worker(service).tick()).toBe(true);
    const job = await service.get(context, "job", committed.jobId);
    expect(job.status, JSON.stringify(job.error)).toBe("completed");
    const outputs = await Promise.all(
      job.outputs.map((id: string) => service.get(context, "asset", id)),
    );
    const video = outputs.find((a) => a.kind === "video")!;
    const subtitle = outputs.find((a) => a.kind === "subtitle")!;
    expect(video.metadata.hasAudio).toBe(true);
    expect(Math.abs(video.metadata.durationMs - 3000)).toBeLessThan(100);
    expect(
      Buffer.from(await service.storage.read(subtitle.storageKey)).toString(),
    ).toBe(srt(composition));
    expect(srt(composition)).toContain("00:00:00,200 --> 00:00:00,600");
    expect(paid).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
