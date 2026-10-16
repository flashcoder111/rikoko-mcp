import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { media } from "../packages/render/src/media.js";
import { compositionSchema } from "../packages/contracts/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { bindReferenceReport } from "../packages/core/src/reference-report.js";

let db: Database, service: Service, c: any, dir: string, source: any;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rikoko-analysis-plan-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  c = await service.authenticate(
    (await service.createAccount("test", 100)).key,
  );
  const rendered = await media({
    command: "render",
    workDir: dir,
    assets: {},
    composition: compositionSchema.parse({
      schemaVersion: 1,
      title: "Cuts",
      width: 144,
      height: 144,
      scenes: [
        { id: "a", durationMs: 1000, color: "#0000ff", text: "" },
        { id: "b", durationMs: 1500, color: "#ffffff", text: "" },
      ],
    }),
  });
  source = await service.registerAsset(
    c.accountId,
    await readFile(rendered.output),
    {
      name: "source.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: rendered.metadata,
      provenance: { license: "test" },
    },
  );
});
afterEach(async () => {
  await db?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

it("advertises precision controls and makes plans readable through the public record API", async () => {
  const caps = await callTool(service, c, "capabilities", {});
  expect(caps.referenceAnalysis.defaultDetail).toBe("shots");
  expect(caps.referenceAnalysis.detailProfiles.map((p: any) => p.id)).toEqual(["overview", "shots", "recreate"]);
  const plan = await callTool(service, c, "reference_analysis_plan", { assetId: source.id, model: "vision", purpose: "remake" });
  expect(plan.detail).toBe("recreate");
  expect((await callTool(service, c, "record_get", { type: "analysis-plan", id: plan.id })).id).toBe(plan.id);
});

it("prepares reusable real clips without buying and refuses incomplete or foreign merges", async () => {
  const input = { assetId: source.id, model: "vision", detail: "recreate" };
  const plan = await callTool(service, c, "reference_analysis_plan", input);
  expect(plan.segments).toHaveLength(2);
  expect(plan.detail).toBe("recreate");
  expect(plan.sampling.fps).toBeNull();
  const prepared = await callTool(service, c, "reference_analysis_prepare", {
    planId: plan.id,
    offset: 0,
    limit: 2,
  });
  expect(prepared.tasks).toHaveLength(2);
  expect(prepared.tasks[0].input).toMatchObject({
    detail: "recreate",
    model: "vision",
  });
  expect(prepared.tasks[0].input.assetId).not.toBe(source.id);
  expect(await service.list(c, "job")).toHaveLength(0);
  const repeated = await callTool(service, c, "reference_analysis_prepare", {
    planId: plan.id,
    offset: 0,
    limit: 2,
  });
  expect(repeated.tasks.map((t: any) => t.input.assetId)).toEqual(
    prepared.tasks.map((t: any) => t.input.assetId),
  );
  const other = await service.authenticate(
    (await service.createAccount("other", 0)).key,
  );
  await expect(
    callTool(service, other, "reference_analysis_prepare", { planId: plan.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    callTool(service, c, "reference_analysis_merge", {
      planId: plan.id,
      analysisAssetIds: [],
    }),
  ).rejects.toThrow();
  const ids = [];
  for (const task of prepared.tasks) {
    const clip = await service.get(c, "asset", task.input.assetId);
    const endMs = clip.metadata.durationMs;
    const data = {
      summary: "Scene",
      shots: [
        {
          id: "s",
          startMs: 0,
          endMs,
          description: "Scene",
          framing: "wide",
          cameraMotion: "static",
          action: "Hold",
          transition: "cut",
          evidenceIds: ["e"],
          details: {
            startState: "Still",
            endState: "Still",
            spatialRelations: "Centered",
            lighting: "Even",
            actionStages: [],
            continuity: { fromPrevious: "Cut", toNext: "Cut", constraints: [] },
          },
        },
      ],
      events: [],
      narrativeBeats: [],
      visualStyle: { description: "Plain", evidenceIds: ["e"] },
      speech: [],
      audio: { description: "Silent", evidenceIds: [] },
      evidence: [
        {
          id: "e",
          startMs: 0,
          endMs,
          modality: "visual",
          observation: "Still",
          confidence: "high",
        },
      ],
      unknowns: [],
    };
    const report = bindReferenceReport(
      data,
      task.input,
      clip,
      {
        id: "job",
        ticket: { requestId: "r" },
        priceVersion: "test",
        referenceTiming: {
          status: "measured",
          method: "ffmpeg-scene-difference",
          threshold: 0.3,
          cutTimesMs: [],
        },
      } as any,
      { id: "vision", endpoint: "test" } as any,
      {
        fps: null,
        mode: "provider_controlled",
        rangeControl: "prompt",
        upstreamModel: "gemini",
      },
    );
    const asset = await service.registerAsset(
      c.accountId,
      Buffer.from(JSON.stringify(report)),
      {
        kind: "analysis",
        name: "report.json",
        mime: "application/json",
        metadata: {},
        provenance: {},
      },
    );
    ids.push(asset.id);
  }
  const merged = await callTool(service, c, "reference_analysis_merge", {
    planId: plan.id,
    analysisAssetIds: ids,
  });
  const report = await callTool(service, c, "reference_analysis_get", {
    analysisAssetId: merged.analysisAssetId,
    section: "all",
  });
  expect(report.source.assetId).toBe(source.id);
  expect(report.shots).toHaveLength(2);
  expect(report.shots[1].startMs).toBe(plan.segments[1].startMs);
  expect(report.shots.at(-1).endMs).toBe(source.metadata.durationMs);
  expect(report.shots[0].details.startState).toBe("Still");
  expect(new Set(report.evidence.map((e: any) => e.id)).size).toBe(2);
  expect(report.analysis.method).toBe("segmented");
  expect(
    (
      await callTool(service, c, "reference_analysis_merge", {
        planId: plan.id,
        analysisAssetIds: ids,
      })
    ).analysisAssetId,
  ).toBe(merged.analysisAssetId);
});
