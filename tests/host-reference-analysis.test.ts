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

let service: Service, db: Database, dir: string, c: any, source: any, inspection: any, content: any;
const network = vi.fn();
const record = (input: any, context = c) =>
  callTool(service, context, "reference_analysis_record" as any, input) as Promise<any>;
const input = () => ({ assetId: source.id, inspectionIds: [inspection.id], host: "codex", imagesViewed: true, content });
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "host-reference-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir), new FalProvider([], undefined, false, network));
  c = await service.authenticate((await service.createAccount("Host analysis", 1000)).key);
  const path = join(dir, "source.mp4");
  await promisify(execFile)("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
  source = await service.registerAsset(c.accountId, await readFile(path), {
    name: "source.mp4", kind: "video", mime: "video/mp4",
    metadata: (await media({ command: "probe", path })).metadata,
    provenance: { evidence: "local-real" },
  });
  inspection = await callTool(service, c, "media_inspect", {
    assetId: source.id, timesMs: [0, 250, 500, 750, 1000, 1250, 1500, 1750, 1900],
  });
  const f = await remakeFixture(service, c, { source, trusted: false });
  content = Object.fromEntries(["summary", "shots", "narrativeBeats", "events", "visualStyle", "speech", "audio", "evidence", "unknowns"].map(k => [k, f.report[k as keyof typeof f.report]]));
});
afterAll(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });

it("records inspected host observations with distinct provenance, no job, charge or provider call", async () => {
  const result = await record(input());
  const evidence = await service.scoped(c, "read", tx => referenceEvidence(service, tx, c.accountId, result.analysisAssetId));
  expect(evidence.report.provenance).toMatchObject({ provider: "host", model: "codex", evidence: "host-sampled", priceVersion: "no-provider-charge" });
  expect(evidence.report.hostObservation).toMatchObject({ host: "codex", imagesViewed: true, continuous: false, audioReviewed: false, timeBasis: "requested", maxSampleGapMs: 250 });
  expect(evidence.report.hostObservation?.frames).toHaveLength(9);
  expect(evidence.report.coverage.mode).toBe("host_sampled_frames");
  expect(evidence.report.coverage.fps).toBeNull();
  expect((await record(input())).analysisAssetId).toBe(result.analysisAssetId);
  expect(await service.scoped(c, "read", tx => tx.list(c.accountId, "job"))).toEqual([]);
  expect(network).not.toHaveBeenCalled();
});

it("rejects missing or foreign inspection records and read-only callers", async () => {
  await expect(record({ ...input(), inspectionIds: [randomUUID()] })).rejects.toMatchObject({ code: "HOST_ANALYSIS_EVIDENCE_REQUIRED" });
  const other = await service.authenticate((await service.createAccount("Other", 100)).key);
  await expect(record(input(), other)).rejects.toThrow();
  await expect(record(input(), { ...c, scopes: ["read"] })).rejects.toThrow();
});

it("rejects sparse sampling and a claim that images were not viewed", async () => {
  const sparse: any = await callTool(service, c, "media_inspect", { assetId: source.id, count: 2 });
  await expect(record({ ...input(), inspectionIds: [sparse.id] })).rejects.toMatchObject({ code: "HOST_ANALYSIS_COVERAGE_REQUIRED" });
  await expect(record({ ...input(), imagesViewed: false })).rejects.toThrow();
});

it("does not accept spoken or audio observations from a frame-only inspection", async () => {
  const changed = structuredClone(content);
  changed.evidence[0].modality = "audiovisual";
  await expect(record({ ...input(), content: changed })).rejects.toMatchObject({ code: "HOST_ANALYSIS_AUDIO_UNREVIEWED" });
});

it("rejects changed source metadata and frame bytes when consuming an existing report", async () => {
  const result = await record(input());
  const load = () => service.scoped(c, "read", tx => referenceEvidence(service, tx, c.accountId, result.analysisAssetId));
  await service.scoped(c, "write", tx => tx.put({ ...source, sha256: "a".repeat(64) }));
  await expect(load()).rejects.toMatchObject({ code: "SOURCE_MISMATCH" });
  await service.scoped(c, "write", tx => tx.put(source));
  const frame = await service.get(c, "asset", inspection.frames[0].assetId);
  const bytes = await service.storage.read(frame.storageKey);
  await service.storage.put(frame.storageKey, Buffer.from("changed"));
  await expect(load()).rejects.toMatchObject({ code: "HOST_ANALYSIS_EVIDENCE_REQUIRED" });
  await service.storage.put(frame.storageKey, bytes);
});

it("rejects an uploaded report that copies a legitimate host provenance label", async () => {
  const result = await record(input());
  const original = await service.get(c, "asset", result.analysisAssetId);
  const forged = await service.registerAsset(c.accountId, await service.storage.read(original.storageKey), {
    name: "forged.json", kind: "analysis", mime: "application/json", metadata: {}, provenance: { evidence: "host-sampled" },
  });
  await expect(service.scoped(c, "read", tx => referenceEvidence(service, tx, c.accountId, forged.id))).rejects.toMatchObject({ code: "ANALYSIS_PROVENANCE_REQUIRED" });
});
