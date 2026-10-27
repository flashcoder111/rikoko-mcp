import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { referenceEvidence } from "../packages/core/src/reference-handoff.js";
import { media } from "../packages/render/src/media.js";
import { remakeFixture } from "./video-workflow-fixture.js";
import { bindVideoWorkflow } from "../packages/core/src/video-workflow.js";
import { validateRemakeEvidence } from "../packages/core/src/reference-handoff.js";

let service: Service,
  db: Database,
  dir: string,
  c: any,
  source: any,
  inspection: any,
  content: any;
const network = vi.fn();
const record = (input: any, context = c) =>
  callTool(
    service,
    context,
    "reference_analysis_record" as any,
    input,
  ) as Promise<any>;
const input = () => ({
  assetId: source.id,
  inspectionIds: [inspection.id],
  host: "codex",
  imagesViewed: true,
  content,
});
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "host-reference-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider([], undefined, false, network),
  );
  c = await service.authenticate(
    (await service.createAccount("Host analysis", 1000)).key,
  );
  const path = join(dir, "source.mp4");
  await promisify(execFile)("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=10:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
  source = await service.registerAsset(c.accountId, await readFile(path), {
    name: "source.mp4",
    kind: "video",
    mime: "video/mp4",
    metadata: (await media({ command: "probe", path })).metadata,
    provenance: { evidence: "local-real" },
  });
  inspection = await callTool(service, c, "media_inspect", {
    assetId: source.id,
    timesMs: [0, 250, 500, 750, 1000, 1250, 1500, 1750, 1900],
  });
  const f = await remakeFixture(service, c, { source, trusted: false });
  content = Object.fromEntries(
    [
      "summary",
      "shots",
      "narrativeBeats",
      "events",
      "visualStyle",
      "speech",
      "audio",
      "evidence",
      "unknowns",
    ].map((k) => [k, f.report[k as keyof typeof f.report]]),
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

it("records inspected host observations with distinct provenance, no job, charge or provider call", async () => {
  const result = await record(input());
  const evidence = await service.scoped(c, "read", (tx) =>
    referenceEvidence(service, tx, c.accountId, result.analysisAssetId),
  );
  expect(evidence.report.provenance).toMatchObject({
    provider: "host",
    model: "codex",
    evidence: "host-sampled",
    priceVersion: "no-provider-charge",
  });
  expect(evidence.report.hostObservation).toMatchObject({
    host: "codex",
    imagesViewed: true,
    continuous: false,
    audioReviewed: false,
    timeBasis: "requested",
    maxSampleGapMs: 250,
  });
  expect(evidence.report.hostObservation?.frames).toHaveLength(9);
  expect(evidence.report.coverage.mode).toBe("host_sampled_frames");
  expect(evidence.report.coverage.fps).toBeNull();
  expect((await record(input())).analysisAssetId).toBe(result.analysisAssetId);
  expect(
    await service.scoped(c, "read", (tx) => tx.list(c.accountId, "job")),
  ).toEqual([]);
  expect(network).not.toHaveBeenCalled();
});

it("rejects missing or foreign inspection records and read-only callers", async () => {
  await expect(
    record({ ...input(), inspectionIds: [randomUUID()] }),
  ).rejects.toMatchObject({ code: "HOST_ANALYSIS_EVIDENCE_REQUIRED" });
  const other = await service.authenticate(
    (await service.createAccount("Other", 100)).key,
  );
  await expect(record(input(), other)).rejects.toThrow();
  const readOnly = await service.authenticate(
    (
      await service.issueKey(c, {
        name: "Read only",
        scopes: ["read"],
        budgetCents: 0,
      })
    ).key,
  );
  await expect(record(input(), readOnly)).rejects.toThrow();
});

it("rejects sparse sampling and a claim that images were not viewed", async () => {
  const sparse: any = await callTool(service, c, "media_inspect", {
    assetId: source.id,
    count: 2,
  });
  await expect(
    record({ ...input(), inspectionIds: [sparse.id] }),
  ).rejects.toMatchObject({ code: "HOST_ANALYSIS_COVERAGE_REQUIRED" });
  await expect(record({ ...input(), imagesViewed: false })).rejects.toThrow();
});

it("does not accept spoken or audio observations from a frame-only inspection", async () => {
  const changed = structuredClone(content);
  changed.evidence[0].modality = "audiovisual";
  await expect(record({ ...input(), content: changed })).rejects.toMatchObject({
    code: "HOST_ANALYSIS_AUDIO_UNREVIEWED",
  });
});

it("rejects changed source metadata and frame bytes when consuming an existing report", async () => {
  const result = await record(input());
  const load = () =>
    service.scoped(c, "read", (tx) =>
      referenceEvidence(service, tx, c.accountId, result.analysisAssetId),
    );
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...source, sha256: "a".repeat(64) }),
  );
  await expect(load()).rejects.toMatchObject({ code: "SOURCE_MISMATCH" });
  await service.scoped(c, "write", (tx) => tx.put(source));
  const frame = await service.get(c, "asset", inspection.frames[0].assetId);
  const bytes = await service.storage.read(frame.storageKey);
  await service.storage.put(frame.storageKey, Buffer.from("changed"));
  await expect(load()).rejects.toMatchObject({
    code: "HOST_ANALYSIS_EVIDENCE_REQUIRED",
  });
  await service.storage.put(frame.storageKey, bytes);
});

it("rejects an uploaded report that copies a legitimate host provenance label", async () => {
  const result = await record(input());
  const original = await service.get(c, "asset", result.analysisAssetId);
  const claim = JSON.parse(
    Buffer.from(await service.storage.read(original.storageKey)).toString(),
  );
  claim.summary =
    "An uploaded host label must not authorize altered observations";
  const forged = await service.registerAsset(
    c.accountId,
    Buffer.from(JSON.stringify(claim)),
    {
      name: "forged.json",
      kind: "analysis",
      mime: "application/json",
      metadata: {},
      provenance: { evidence: "host-sampled" },
    },
  );
  await expect(
    service.scoped(c, "read", (tx) =>
      referenceEvidence(service, tx, c.accountId, forged.id),
    ),
  ).rejects.toMatchObject({ code: "ANALYSIS_PROVENANCE_REQUIRED" });
});

it("accepts a source-bound host plan but still requires the actual video reference", async () => {
  const result = await record(input());
  const { plan } = await remakeFixture(service, c, { source, trusted: false });
  plan.remake.analysisAssetId = result.analysisAssetId;
  plan.remake.analysisSha256 = result.analysisSha256;
  plan.shots[0].references = [
    {
      assetId: source.id,
      role: "motion",
      transfer: "action",
      instruction: "Preserve source motion",
    },
  ];
  plan.shots[0].sourceVideo = { strategy: "reference", assetId: source.id };
  plan.shots[0].referenceChoice = {
    strategy: "motion_reference",
    reason: "Preserve source motion",
  };
  const request: any = await callTool(service, c, "workspace_request_save", {
    message: "Replace this box",
    assetIds: [source.id],
  });
  const link = {
    requestId: request.requestId,
    expectedVersion: request.requestVersion,
  };
  const saved: any = await callTool(service, c, "production_plan_save", {
    plan,
    request: link,
  });
  const data = {
    request: link,
    plan: {
      planId: saved.id,
      expectedVersion: saved.version,
      shotId: "target-open",
    },
    input: { references: [{ assetId: source.id, role: "motion" }] },
  };
  const bound = await service.scoped(c, "read", (tx) =>
    bindVideoWorkflow(service, tx, c, data, "video"),
  );
  expect(bound?.analysis.report.provenance.evidence).toBe("host-sampled");
  await expect(
    service.scoped(c, "read", (tx) =>
      bindVideoWorkflow(
        service,
        tx,
        c,
        { ...data, input: { references: [] } },
        "video",
      ),
    ),
  ).rejects.toMatchObject({ code: "SOURCE_VIDEO_REFERENCE_REQUIRED" });
  const binding = await service.scoped(c, "read", (tx) =>
    validateRemakeEvidence(service, tx, c.accountId, saved.plan),
  );
  await expect(
    service.scoped(c, "read", (tx) =>
      validateRemakeEvidence(service, tx, c.accountId, saved.plan, {
        ...binding,
        model: "spoof",
      }),
    ),
  ).rejects.toMatchObject({ code: "ANALYSIS_PROVENANCE_REQUIRED" });
  expect(network).not.toHaveBeenCalled();
});

it("retains multiple seek positions when identical frame assets are deduplicated", async () => {
  const path = join(dir, "static.mp4");
  await promisify(execFile)("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=red:size=320x180:rate=10:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
  const still = await service.registerAsset(c.accountId, await readFile(path), {
    name: "static.mp4",
    kind: "video",
    mime: "video/mp4",
    metadata: (await media({ command: "probe", path })).metadata,
    provenance: { evidence: "local-real" },
  });
  const samples: any = await callTool(service, c, "media_inspect", {
    assetId: still.id,
    timesMs: [0, 500, 1000, 1500, 1900],
  });
  expect(new Set(samples.frames.map((f: any) => f.assetId)).size).toBe(1);
  const result = await record({
    ...input(),
    assetId: still.id,
    inspectionIds: [samples.id],
  });
  const verified = await service.scoped(c, "read", (tx) =>
    referenceEvidence(service, tx, c.accountId, result.analysisAssetId),
  );
  expect(
    verified.report.hostObservation?.frames.map((f) => f.requestedTimeMs),
  ).toEqual([0, 500, 1000, 1500, 1900]);
});
