import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { createApp } from "../apps/server/src/app.js";
import {
  referenceReportSchema,
  type Context,
} from "../packages/contracts/src/index.js";

let db: Database, service: Service, context: Context, directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "rikoko-caption-style-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(directory));
  context = await service.authenticate(
    (await service.createAccount("Style test", 0)).key,
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

it("prepares styles from a source-bound analysis without subtitles, rejects foreign analysis, and never purchases", async () => {
  const source = await service.registerAsset(
    context.accountId,
    Buffer.from("synthetic test fixture; not real video"),
    {
      name: "reference.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: { durationMs: 1000, hasAudio: false, width: 360, height: 640 },
      provenance: { source: "test-fixture" },
    },
  );
  // Synthetic report exercises the production contract; it is not live analysis evidence.
  const report = referenceReportSchema.parse({
    schemaVersion: 2,
    source: {
      assetId: source.id,
      sha256: source.sha256,
      durationMs: 1000,
      hasAudio: false,
      timebase: "source_ms",
    },
    summary: "A silent cinematic shot without subtitles",
    shots: [
      {
        id: "s",
        startMs: 0,
        endMs: 1000,
        description: "Landscape",
        framing: "Wide",
        cameraMotion: "Static",
        action: "Still",
        transition: "Cut",
        evidenceIds: ["e"],
      },
    ],
    narrativeBeats: [],
    events: [],
    speech: [],
    unknowns: [],
    visualStyle: { description: "Cinematic and vintage", evidenceIds: ["e"] },
    audio: { description: "No audio", evidenceIds: [] },
    evidence: [
      {
        id: "e",
        startMs: 0,
        endMs: 1000,
        modality: "visual",
        observation: "Muted warm landscape",
        confidence: "high",
      },
    ],
    coverage: {
      startMs: 0,
      endMs: 1000,
      fps: null,
      mode: "provider_controlled",
      timing: "model_estimated",
      gaps: [],
    },
    provenance: {
      provider: "fixture",
      model: "fixture",
      endpoint: "fixture",
      requestId: "fixture",
      jobId: "fixture",
      analysisVersion: "fixture",
      priceVersion: "fixture",
      analyzedAt: "2026-10-17T00:00:00.000Z",
      evidence: "provider-live",
    },
    measurements: {
      status: "unavailable",
      method: "ffmpeg-scene-difference",
      threshold: 0.3,
      cutTimesMs: [],
      reason: "fixture",
    },
  });
  const analysis = await service.registerAsset(
    context.accountId,
    Buffer.from(JSON.stringify(report)),
    {
      name: "reference.json",
      kind: "analysis",
      mime: "application/json",
      metadata: {},
      provenance: { source: "test-fixture" },
    },
  );
  const paid = vi.spyOn(service.provider, "submit");
  const styled = await callTool(service, context, "caption_style_prepare", {
    analysisAssetId: analysis.id,
    description: "黑体加粗，无阴影",
  });
  expect(styled.style).toMatchObject({
    fontFamily: "noto-sans-sc",
    fontWeight: 700,
    shadowOpacity: 0,
  });
  expect(styled.preset).toBe("cinematic");
  expect(styled.reference.evidenceIds).toEqual(["e"]);
  expect(styled.rendered).toBe(false);
  const adapted = await callTool(service, context, "reference_adapt", {
    analysisAssetId: analysis.id,
    title: "Adapted",
    matchCaptionStyle: true,
    captionDescription: "黑体加粗",
    captionStyle: { color: "#abcdef" },
  });
  expect(adapted.composition.captionStyle).toMatchObject({
    fontFamily: "noto-sans-sc",
    fontWeight: 700,
    color: "#abcdef",
  });
  expect(adapted.composition.scenes[0].text).toBe("");
  const stranger = await service.authenticate(
    (await service.createAccount("Other", 0)).key,
  );
  await expect(
    callTool(service, stranger, "caption_style_prepare", {
      analysisAssetId: analysis.id,
    }),
  ).rejects.toThrow();
  expect(paid).not.toHaveBeenCalled();
  expect(await service.list(context, "job")).toHaveLength(0);
});

it("serves only bundled font files, without serving arbitrary local files", async () => {
  const app = createApp(service);
  for (const file of ["NotoSansSC.ttf", "NotoSerifSC.ttf"]) {
    const response = await app.request(`http://localhost/fonts/${file}`, {
      headers: { Host: "localhost" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/ttf");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000000);
  }
  expect(
    (
      await app.request("http://localhost/fonts/package.json", {
        headers: { Host: "localhost" },
      })
    ).status,
  ).toBe(404);
});
