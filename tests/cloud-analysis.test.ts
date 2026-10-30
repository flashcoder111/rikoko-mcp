import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { connectCloud } from "../packages/cloud-client/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { bindReferenceReport } from "../packages/core/src/reference-report.js";
import { Worker } from "../apps/worker/src/worker.js";
import { referenceAnalysisProtocol } from "../packages/contracts/src/reference-analysis.js";
import { normalizeAnalysisDuration } from "../packages/core/src/reference-report.js";

it("routes official analysis, remaps a source-bound report, caches it and rejects source drift", async () => {
  const dir = await mkdtemp(join(tmpdir(), "official-analysis-")),
    db = await Database.open();
  try {
    const service = new Service(db, new LocalStorage(dir));
    const c = await service.authenticate(
      (await service.createAccount("test", 0)).key,
    );
    const source = await service.registerAsset(
      c.accountId,
      Buffer.from("video"),
      {
        name: "source",
        kind: "video",
        mime: "video/mp4",
        metadata: { durationMs: 2000, hasAudio: false },
        provenance: {},
      },
    );
    let remoteInput: any,
      report: any,
      submissions = 0;
    const fetcher = vi.fn(async (url: any, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/generation-models")
        return Response.json([
          {
            id: "vision",
            kind: "analysis",
            available: true,
            billingSource: "testing",
            referenceAnalysis: referenceAnalysisProtocol,
            referenceUnderstanding: {
              family: "gemini",
              upstreamModel: "gemini-fixture",
            },
          },
        ]);
      if (path === "/v1/reference-uploads")
        return Response.json({ id: "upload" });
      if (path === "/v1/reference-uploads/upload")
        return Response.json({
          id: "remote-source",
          sha256: source.sha256,
          bytes: source.bytes,
        });
      if (path === "/v1/quotes") {
        remoteInput = JSON.parse(init!.body as string).input;
        return Response.json({
          id: "q",
          priceVersion: "testing:v1",
          billingSource: "testing",
        });
      }
      if (path === "/v1/generations") {
        submissions++;
        return Response.json({ id: "job", status: "queued" });
      }
      if (path.endsWith("/result")) return Response.json(report);
      return Response.json({
        id: "job",
        status: "completed",
        result: {
          kind: "analysis",
          downloadPath: "/v1/generations/job/result",
        },
      });
    });
    connectCloud(service, "https://official.example", "test", fetcher);
    const caps = await callTool(service, c, "capabilities", {});
    expect(caps.referenceAnalysis.models).toHaveLength(1);
    expect(caps.referenceAnalysis.officialGateway).toBe("available");
    expect(caps.generation.officialReferences).toBe("available");
    expect(caps.generation.billingSource).toBe("testing");
    await callTool(service, c, "reference_analysis_settings", {
      detail: "overview",
    });
    const input = { assetId: source.id, model: "vision" };
    const prepared = await callTool(service, c, "reference_analyze", input);
    expect(remoteInput.assetId).toBe("remote-source");
    expect(remoteInput.detail).toBe("overview");
    const job = await callTool(service, c, "job_submit", {
      input: prepared.input,
      quoteId: prepared.quoteId,
      idempotencyKey: "analysis",
    });
    report = bindReferenceReport(
      {
        summary: "Product",
        shots: [
          {
            id: "s",
            startMs: 0,
            endMs: 2000,
            description: "Product",
            framing: "close",
            cameraMotion: "static",
            action: "still",
            transition: "end",
            evidenceIds: ["e"],
          },
        ],
        narrativeBeats: [],
        events: [],
        visualStyle: { description: "studio", evidenceIds: [] },
        speech: [],
        audio: { description: "none", evidenceIds: [] },
        evidence: [
          {
            id: "e",
            startMs: 0,
            endMs: 2000,
            modality: "visual",
            observation: "Product",
            confidence: "high",
          },
        ],
        unknowns: [],
      },
      remoteInput,
      { ...source, id: "remote-source" },
      {
        id: "job",
        accountId: c.accountId,
        type: "job",
        createdAt: new Date().toISOString(),
        ticket: { requestId: "r" },
        priceVersion: "v",
        referenceTiming: {
          status: "measured",
          method: "ffmpeg-scene-difference",
          threshold: 0.3,
          cutTimesMs: [],
        },
      },
      { id: "vision", endpoint: "openrouter/router/video" } as any,
      {
        fps: null,
        mode: "provider_controlled",
        rangeControl: "prompt",
        upstreamModel: "gemini-fixture",
      },
    );
    const originalReport = structuredClone(report);
    for (const mutate of [
      (r: any) => {
        r.source.sha256 = "0".repeat(64);
      },
      (r: any) => {
        r.source.assetId = "different-source";
      },
      (r: any) => {
        r.source.hasAudio = true;
      },
      (r: any) => {
        r.source.durationMs += 2;
      },
    ]) {
      report = structuredClone(originalReport);
      mutate(report);
      await expect(
        callTool(service, c, "record_get", { type: "job", id: job.id }),
      ).rejects.toMatchObject({ code: "SOURCE_MISMATCH" });
    }
    report = structuredClone(originalReport);
    report.source.durationMs = 2001;
    report.coverage.endMs = 2001;
    report.coverage.submittedRange.endMs = 2001;
    report.shots[0].endMs = 2001;
    report.evidence[0].endMs = 2001;
    const shorterRemote = structuredClone(originalReport);
    shorterRemote.source.durationMs = 1999;
    shorterRemote.coverage.endMs = 1999;
    shorterRemote.coverage.submittedRange.endMs = 1999;
    shorterRemote.shots[0].endMs = 1999;
    shorterRemote.evidence[0].endMs = 1999;
    expect(
      normalizeAnalysisDuration(shorterRemote, source.id, 2000),
    ).toMatchObject({
      source: { durationMs: 2000 },
      coverage: { endMs: 2000 },
    });
    expect(
      normalizeAnalysisDuration(shorterRemote, source.id, 2000, true),
    ).toMatchObject({
      source: { durationMs: 2000 },
      coverage: { endMs: 1999, submittedRange: { endMs: 2000 } },
      shots: [{ endMs: 1999 }],
    });
    const unsafeBoundary = structuredClone(report);
    unsafeBoundary.evidence[0].startMs = 2000;
    expect(() =>
      normalizeAnalysisDuration(unsafeBoundary, source.id, 2000),
    ).toThrow("cannot be safely mapped");
    const done = await callTool(service, c, "record_get", {
      type: "job",
      id: job.id,
    });
    expect(done.outputs).toHaveLength(1);
    const read = await callTool(service, c, "reference_analysis_get", {
      analysisAssetId: done.outputs[0],
      section: "all",
    });
    expect(read.source.assetId).toBe(source.id);
    expect(read.source.sha256).toBe(source.sha256);
    expect(read.source.durationMs).toBe(2000);
    expect(read.coverage.endMs).toBe(2000);
    expect(read.shots[0].endMs).toBe(2000);
    expect(read.evidence[0].endMs).toBe(2000);
    expect(
      (await service.get(c, "asset", done.outputs[0])).metadata
        .providerDurationMs,
    ).toBe(2001);
    expect(
      await callTool(service, c, "reference_analyze", input),
    ).toMatchObject({ status: "cached", analysisAssetId: done.outputs[0] });
    expect(submissions).toBe(1);
    const worker = new Worker(service, ["reference_analyze"]);
    const claim = vi.spyOn(service, "claim").mockResolvedValueOnce(null);
    await worker.tick();
    expect(claim).toHaveBeenCalledWith(expect.any(String), [
      "reference_analyze",
    ]);
    claim.mockRestore();
    const detailed = await callTool(service, c, "reference_analyze", {
      ...input,
      detail: "recreate",
      focus: ["motion"],
    });
    const detailedJob = await callTool(service, c, "job_submit", {
      input: detailed.input,
      quoteId: detailed.quoteId,
      idempotencyKey: "detailed-analysis",
    });
    await expect(
      callTool(service, c, "record_get", {
        type: "job",
        id: detailedJob.id,
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_PROFILE_MISMATCH" });
    const another = await callTool(service, c, "reference_analyze", {
      ...input,
      refresh: true,
    });
    await db.transaction((tx) => tx.put({ ...source, sha256: "0".repeat(64) }));
    await expect(
      callTool(service, c, "job_submit", {
        input: another.input,
        quoteId: another.quoteId,
        idempotencyKey: "drift",
      }),
    ).rejects.toMatchObject({ code: "REFERENCE_CHANGED" });
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
