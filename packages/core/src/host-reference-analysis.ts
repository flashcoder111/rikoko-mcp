import { z } from "zod";
import {
  AppError,
  idSchema,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import {
  referenceContentSchema,
  referenceReportSchema,
  type ReferenceReport,
} from "../../contracts/src/reference-analysis.js";
import type { Transaction } from "../../db/src/index.js";
import { sha256 } from "../../storage/src/index.js";
import { fingerprint, type Service } from "./index.js";

export const hostAnalysisSchema = z
  .object({
    assetId: idSchema,
    inspectionIds: z
      .array(idSchema)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    host: z.literal("codex"),
    imagesViewed: z.literal(true),
    content: referenceContentSchema,
  })
  .strict();
const VERSION = "host-codex-sampled-v1";
function fail(message: string): never {
  throw new AppError("HOST_ANALYSIS_EVIDENCE_REQUIRED", message, 409);
}

/** Validates extraction provenance and actual frame bytes, not the host's semantic judgment. */
async function inspectedFrames(
  service: Service,
  tx: Transaction,
  accountId: string,
  source: Entity,
  ids: string[],
) {
  const frames = new Map<
    string,
    { assetId: string; sha256: string; requestedTimeMs: number }
  >();
  for (const id of ids) {
    const inspection = await tx.get(id, accountId, "media-inspection");
    if (
      !inspection ||
      inspection.assetId !== source.id ||
      inspection.sourceSha256 !== source.sha256 ||
      inspection.sampling?.timeBasis !== "requested" ||
      !inspection.frames?.length
    )
      fail("Use owned media_inspect records from these exact source bytes");
    for (const frame of inspection.frames) {
      const asset = await tx.get(frame.assetId, accountId, "asset");
      // Assets deduplicate identical pixels across frames. Source/time provenance
      // belongs to the server's inspection record, not the first asset import.
      if (
        !asset ||
        asset.kind !== "image" ||
        asset.sha256 !== frame.sha256 ||
        !Number.isSafeInteger(frame.requestedTimeMs) ||
        frame.requestedTimeMs < 0 ||
        frame.requestedTimeMs >= source.metadata.durationMs
      )
        fail(
          "An inspection frame no longer matches its source and requested seek time",
        );
      const bytes = await service.storage.read(asset.storageKey);
      if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256)
        fail("Inspection image bytes changed");
      frames.set(`${asset.id}:${frame.requestedTimeMs}`, {
        assetId: asset.id,
        sha256: asset.sha256,
        requestedTimeMs: frame.requestedTimeMs,
      });
    }
  }
  const ordered = [...frames.values()].sort(
    (a, b) =>
      a.requestedTimeMs - b.requestedTimeMs ||
      a.assetId.localeCompare(b.assetId),
  );
  const times = [
    0,
    ...ordered.map((f) => f.requestedTimeMs),
    source.metadata.durationMs,
  ];
  const maxSampleGapMs = Math.max(
    ...times.slice(1).map((t, i) => t - times[i]),
  );
  if (maxSampleGapMs > 500)
    throw new AppError(
      "HOST_ANALYSIS_COVERAGE_REQUIRED",
      "Inspect the whole source with seek gaps at most 500 ms; this establishes sampling coverage, not continuous action correctness",
      409,
    );
  return { frames: ordered, maxSampleGapMs };
}

export async function verifyHostAnalysis(
  service: Service,
  tx: Transaction,
  accountId: string,
  asset: Entity,
  source: Entity,
  report: ReferenceReport,
) {
  const record = await tx.get(
    report.provenance.jobId,
    accountId,
    "host-analysis",
  );
  if (
    !record ||
    record.analysisAssetId !== asset.id ||
    record.analysisSha256 !== asset.sha256 ||
    record.sourceAssetId !== source.id ||
    record.sourceSha256 !== source.sha256 ||
    record.reportHash !== fingerprint(report) ||
    !report.hostObservation
  )
    throw new AppError(
      "ANALYSIS_PROVENANCE_REQUIRED",
      "Register host observations with reference_analysis_record on this execution account; an uploaded label is not an inspection record",
      409,
    );
  const actual = await inspectedFrames(
    service,
    tx,
    accountId,
    source,
    report.hostObservation.inspectionIds,
  );
  if (
    fingerprint(actual.frames) !== fingerprint(report.hostObservation.frames) ||
    actual.maxSampleGapMs !== report.hostObservation.maxSampleGapMs
  )
    fail("Host observations no longer match their inspection records");
  return actual.frames.map((f) => ({ assetId: f.assetId, sha256: f.sha256 }));
}

export async function recordHostAnalysis(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = hostAnalysisSchema.parse(raw);
  if (
    input.content.speech.length ||
    input.content.audio.evidenceIds.length ||
    input.content.evidence.some((e) => e.modality !== "visual") ||
    input.content.events.some((e) => e.type === "sound")
  )
    throw new AppError(
      "HOST_ANALYSIS_AUDIO_UNREVIEWED",
      "Frame inspections do not establish speech, sound or audiovisual evidence",
      409,
    );
  const prepared = await service.scoped(c, "write", async (tx) => {
    const source = await tx.get(input.assetId, c.accountId, "asset");
    if (
      !source ||
      source.kind !== "video" ||
      !Number.isSafeInteger(source.metadata?.durationMs) ||
      source.metadata.durationMs <= 0
    )
      fail("Use an owned probed source video");
    const observation = await inspectedFrames(
      service,
      tx,
      c.accountId,
      source,
      input.inspectionIds,
    );
    const id = `host-analysis-${fingerprint([VERSION, c.accountId, input, source.sha256, observation])}`;
    const existing = await tx.get(id, c.accountId, "host-analysis");
    return { source, observation, id, existing };
  });
  const { source, observation, id, existing } = prepared;
  if (existing) {
    const asset = await service.get(c, "asset", existing.analysisAssetId);
    const report = referenceReportSchema.parse(
      JSON.parse(
        Buffer.from(await service.storage.read(asset.storageKey)).toString(),
      ),
    );
    await service.scoped(c, "read", (tx) =>
      verifyHostAnalysis(service, tx, c.accountId, asset, source, report),
    );
    return {
      analysisAssetId: asset.id,
      analysisSha256: asset.sha256,
      recordId: id,
      providerCharge: 0,
    };
  }
  const report = referenceReportSchema.parse({
    ...input.content,
    schemaVersion: 2,
    analysis: {
      detail: "recreate",
      focus: ["motion", "camera", "appearance", "text", "continuity"],
      method: "whole_video",
    },
    source: {
      assetId: source.id,
      sha256: source.sha256,
      durationMs: source.metadata.durationMs,
      hasAudio: source.metadata.hasAudio === true,
      timebase: "source_ms",
    },
    coverage: {
      startMs: 0,
      endMs: source.metadata.durationMs,
      fps: null,
      mode: "host_sampled_frames",
      timing: "model_estimated",
      gaps: [],
    },
    measurements: {
      status: "unavailable",
      method: "ffmpeg-scene-difference",
      threshold: 0.3,
      cutTimesMs: [],
      reason: "Host observations do not establish measured cut times",
    },
    hostObservation: {
      host: input.host,
      imagesViewed: input.imagesViewed,
      inspectionIds: input.inspectionIds,
      ...observation,
      continuous: false,
      audioReviewed: false,
      timeBasis: "requested",
      limitations: [
        "Only the recorded frame pixels were sampled; unsampled motion remains unobserved.",
        "Seek times are requested positions, not verified decoded-frame PTS. Shot boundaries are host estimates.",
        "No audio was reviewed by this frame-only analysis.",
      ],
    },
    provenance: {
      provider: "host",
      model: "codex",
      endpoint: "local-host",
      upstreamModel: "host_codex",
      requestId: id,
      jobId: id,
      analysisVersion: VERSION,
      priceVersion: "no-provider-charge",
      analyzedAt: new Date().toISOString(),
      evidence: "host-sampled",
    },
  });
  // Validate all report intervals before storing; no completed provider job is created.
  const asset = await service.registerAsset(
    c.accountId,
    Buffer.from(JSON.stringify(report)),
    {
      name: "host-codex-reference-analysis.json",
      kind: "analysis",
      mime: "application/json",
      metadata: {},
      provenance: {
        source: "host-reference-analysis",
        evidence: "host-sampled",
        sourceAssetId: source.id,
        sourceSha256: source.sha256,
      },
    },
  );
  const saved = await service.scoped(c, "write", async (tx) => {
    const current = await tx.get(source.id, c.accountId, "asset");
    if (
      !current ||
      current.sha256 !== source.sha256 ||
      fingerprint(current.metadata) !== fingerprint(source.metadata)
    )
      throw new AppError(
        "SOURCE_MISMATCH",
        "Source changed while recording host observations",
        409,
      );
    await inspectedFrames(
      service,
      tx,
      c.accountId,
      current,
      input.inspectionIds,
    );
    const raced = await tx.get(id, c.accountId, "host-analysis");
    if (raced) return raced;
    return tx.put({
      id,
      type: "host-analysis",
      accountId: c.accountId,
      createdAt: report.provenance.analyzedAt,
      sourceAssetId: source.id,
      sourceSha256: source.sha256,
      analysisAssetId: asset.id,
      analysisSha256: asset.sha256,
      reportHash: fingerprint(report),
    });
  });
  return {
    analysisAssetId: saved.analysisAssetId,
    analysisSha256: saved.analysisSha256,
    recordId: id,
    providerCharge: 0,
  };
}
