import { z } from "zod";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppError,
  idSchema,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import {
  referenceOperationSchema,
  referenceReportSchema,
  REFERENCE_ANALYSIS_VERSION,
  type ReferenceReport,
} from "../../contracts/src/reference-analysis.js";
import { Service, fingerprint } from "../../core/src/index.js";
import {
  planReferenceSegments,
  type AnalysisSegment,
} from "../../core/src/reference-planning.js";
import { extractReferenceMedia } from "../../core/src/reference-media.js";
import { referenceTiming } from "../../render/src/reference-timing.js";
import { sha256 } from "../../storage/src/index.js";
import { readReferenceReport } from "./reference-tools.js";
import { resolveAnalysisDetail } from "./reference-settings.js";
import {
  hostAnalysisSchema,
  recordHostAnalysis,
} from "../../core/src/host-reference-analysis.js";

const planSchema = referenceOperationSchema.omit({ kind: true });
const prepareSchema = z
  .object({
    planId: idSchema,
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(4).default(2),
  })
  .strict();
const mergeSchema = z
  .object({
    planId: idSchema,
    analysisAssetIds: z.array(idSchema).min(1).max(100),
  })
  .strict();
export const referenceWorkflowTools = {
  reference_analysis_record: {
    schema: hostAnalysisSchema,
    description:
      "When the user selects local Codex analysis, save its visual observations from actual media_inspect images already viewed. Requires owned source-bound inspection records covering the source with requested seek gaps <=500 ms. content must contain recreate shot details, evidence and honest unknowns. Records host-sampled provenance, never a Gemini job; no provider call or charge. Frame-only: do not claim audio, continuous action or frame-exact timing. Register on the execution account; cloud mirrors alone cannot establish this provenance. Keep the original brief, model policy, actual source-video reference, plan and budget checks.",
  },
  reference_analysis_plan: {
    schema: planSchema,
    description:
      "Plan analysis precision locally: explicit detail wins over reference_analysis_settings; otherwise the saved account preference applies, with auto resolving to shots or recreate for purpose=remake. Detect cut candidates and allocate bounded source intervals; no provider call or purchase. Recreate isolates candidate shots and splits long actions into windows. Window boundaries are not new shots. Use prepare in pages, reference_analyze for each returned exact input, then merge completed reports. Keep all segments and submit the prepared inputs directly with job_submit within the requested scope; no separate price confirmation. FPS remains provider controlled, not a claimed precision setting.",
  },
  reference_analysis_prepare: {
    schema: prepareSchema,
    description:
      "Prepare up to four actual local clips from an owned analysis plan; returns stable clip assets, representative frames and exact analysis inputs. Follow nextOffset until every segment is prepared. Does not upload, quote or submit paid work. Cache reuse preserves plan/source hashes. Clip times start at zero; merge restores original source time.",
  },
  reference_analysis_merge: {
    schema: mergeSchema,
    description:
      "Assemble all completed segment reports into one full source-bound analysis, remapping source times and evidence IDs without another model call. Rejects incomplete, duplicate, foreign or mismatched reports. Retains detailed shot actions and per-shot styles. Inspect segment/window boundaries in the plan: segmentation candidates are not verified cuts. Never use the overview as a generation prompt.",
  },
};

async function sourceFor(service: Service, c: Context, plan: Entity) {
  const source = await service.get(c, "asset", plan.source.assetId);
  if (
    source.sha256 !== plan.source.sha256 ||
    source.metadata?.durationMs !== plan.source.durationMs
  )
    throw new AppError(
      "SOURCE_MISMATCH",
      "The analysis plan no longer matches its source",
    );
  return source;
}

async function planAnalysis(service: Service, c: Context, raw: unknown) {
  const parsed = planSchema.parse(raw);
  const detail = await resolveAnalysisDetail(service, c, parsed);
  const input = { ...parsed, detail };
  const source = await service.get(c, "asset", input.assetId);
  if (
    source.kind !== "video" ||
    !Number.isSafeInteger(source.metadata?.durationMs) ||
    source.metadata.durationMs <= 0 ||
    source.bytes > 100 * 1024 * 1024
  )
    throw new AppError(
      "INVALID_MEDIA",
      "Analysis planning requires a probed video up to 100 MiB",
    );
  const range = input.range ?? {
    startMs: 0,
    endMs: source.metadata.durationMs,
  };
  if (range.endMs > source.metadata.durationMs)
    throw new AppError("INVALID_INTERVAL", "Plan range exceeds source");
  const id = `analysis-plan-${fingerprint([c.accountId, input, source.sha256, REFERENCE_ANALYSIS_VERSION])}`;
  const existing = await service.scoped(c, "read", (tx) =>
    tx.get(id, c.accountId, "analysis-plan"),
  );
  if (existing) return existing;
  const dir = await mkdtemp(join(tmpdir(), "rikoko-analysis-plan-"));
  try {
    const bytes = await service.storage.read(source.storageKey);
    if (bytes.byteLength !== source.bytes || sha256(bytes) !== source.sha256)
      throw new AppError("SOURCE_MISMATCH", "Source bytes changed");
    const path = join(dir, "source");
    await writeFile(path, bytes, { mode: 0o600 });
    const timing = await referenceTiming(path, source.metadata.durationMs);
    const segments = planReferenceSegments(
      range.endMs - range.startMs,
      timing.cutTimesMs
        .filter((t) => t > range.startMs && t < range.endMs)
        .map((t) => t - range.startMs),
      detail,
    ).map((s) => ({
      ...s,
      startMs: s.startMs + range.startMs,
      endMs: s.endMs + range.startMs,
    }));
    const plan = {
      id,
      type: "analysis-plan",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      input,
      detail,
      source: {
        assetId: source.id,
        sha256: source.sha256,
        durationMs: source.metadata.durationMs,
        hasAudio: source.metadata.hasAudio === true,
        timebase: "source_ms",
      },
      range,
      segments,
      measurements: timing,
      prepared: {},
      sampling: {
        fps: null,
        mode: "provider_controlled",
        strategy:
          detail === "overview" &&
          segments.length === 1 &&
          range.startMs === 0 &&
          range.endMs === source.metadata.durationMs
            ? "whole_video"
            : "local_clips",
      },
      estimatedCalls: segments.length,
      submitted: false,
      analysisVersion: REFERENCE_ANALYSIS_VERSION,
    };
    return service.scoped(
      c,
      "write",
      async (tx) =>
        (await tx.get(id, c.accountId, "analysis-plan")) ?? tx.put(plan),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function prepareAnalysis(service: Service, c: Context, raw: unknown) {
  const input = prepareSchema.parse(raw);
  let plan = await service.get(c, "analysis-plan", input.planId);
  const source = await sourceFor(service, c, plan);
  const selected: AnalysisSegment[] = plan.segments.slice(
    input.offset,
    input.offset + input.limit,
  );
  if (!selected.length)
    throw new AppError("INVALID_INTERVAL", "No segments at this offset");
  const pending = selected.filter((s) => !plan.prepared[s.id]);
  const updates: Record<string, unknown> = {};
  for (const segment of pending) {
    const whole =
      segment.startMs === 0 &&
      segment.endMs === source.metadata.durationMs &&
      plan.detail === "overview";
    const extracted = whole
      ? undefined
      : (
          await extractReferenceMedia(
            service,
            c,
            source.id,
            [
              {
                sourceShotId: segment.id,
                frameTimeMs: segment.startMs,
                motionRange: { startMs: segment.startMs, endMs: segment.endMs },
              },
            ],
            { maxMotionMs: 60000 },
          )
        )[0];
    const clip = whole
      ? source
      : await service.get(c, "asset", extracted!.motion!.assetId);
    // Encoding may pad the tail by a frame/AAC packet. Never accept a materially different clip.
    const tolerance = Math.max(
      100,
      Math.ceil(2000 / (source.metadata.fps || 24)),
    );
    if (
      Math.abs(clip.metadata.durationMs - (segment.endMs - segment.startMs)) >
      tolerance
    )
      throw new AppError(
        "CLIP_DURATION_MISMATCH",
        "Prepared clip differs from its source interval",
      );
    updates[segment.id] = {
      segmentId: segment.id,
      sourceRange: { startMs: segment.startMs, endMs: segment.endMs },
      boundary: segment.boundary,
      clipDurationMs: clip.metadata.durationMs,
      clipSha256: clip.sha256,
      frameAssetId: extracted?.frame.assetId,
      input: referenceOperationSchema.parse({
        ...plan.input,
        kind: "reference_analyze",
        assetId: clip.id,
        range: undefined,
      }),
    };
  }
  plan = await service.scoped(c, "write", async (tx) => {
    const current = await tx.get(plan.id, c.accountId, "analysis-plan");
    if (!current)
      throw new AppError("NOT_FOUND", "Analysis plan is unavailable", 404);
    // Prefer an already persisted concurrent preparation; retries retain the same input assets.
    return tx.put({
      ...current,
      prepared: { ...updates, ...current.prepared },
    });
  });
  return {
    planId: plan.id,
    detail: plan.detail,
    tasks: selected.map((s) => plan.prepared[s.id]),
    nextOffset:
      input.offset + selected.length < plan.segments.length
        ? input.offset + selected.length
        : null,
    totalSegments: plan.segments.length,
    submitted: false,
  };
}

async function mergeAnalysis(service: Service, c: Context, raw: unknown) {
  const input = mergeSchema.parse(raw);
  const plan = await service.get(c, "analysis-plan", input.planId);
  const source = await sourceFor(service, c, plan);
  if (
    new Set(input.analysisAssetIds).size !== input.analysisAssetIds.length ||
    input.analysisAssetIds.length !== plan.segments.length
  )
    throw new AppError(
      "INCOMPLETE_ANALYSIS",
      "Supply exactly one report for every planned segment; no segment may be omitted",
    );
  const reports = await Promise.all(
    input.analysisAssetIds.map(async (id) => ({
      id,
      report: await readReferenceReport(service, c, id),
    })),
  );
  const ordered = (plan.segments as AnalysisSegment[]).map((s) => {
    const task = plan.prepared[s.id];
    const matches = task
      ? reports.filter((r) => r.report.source.assetId === task.input.assetId)
      : [];
    if (matches.length !== 1)
      throw new AppError(
        "INCOMPLETE_ANALYSIS",
        `Missing or duplicate report for ${s.id}`,
      );
    const { id, report } = matches[0];
    if (
      report.source.sha256 !== task.clipSha256 ||
      report.provenance.model !== plan.input.model ||
      report.analysis?.detail !== plan.detail ||
      fingerprint(report.analysis?.focus ?? []) !==
        fingerprint(plan.input.focus ?? []) ||
      report.coverage.startMs !== 0 ||
      report.coverage.endMs !== task.clipDurationMs
    )
      throw new AppError(
        "ANALYSIS_PLAN_MISMATCH",
        "Report source, profile or coverage differs from its planned task",
      );
    return { segment: s, task, id, report };
  });
  const mergeHash = fingerprint([plan.id, ordered.map((p) => p.id)]);
  if (plan.merged?.inputHash === mergeHash) {
    await readReferenceReport(service, c, plan.merged.analysisAssetId);
    return { ...plan.merged, planId: plan.id };
  }
  const shots: ReferenceReport["shots"] = [],
    evidence: ReferenceReport["evidence"] = [],
    events: ReferenceReport["events"] = [],
    speech: ReferenceReport["speech"] = [],
    beats: ReferenceReport["narrativeBeats"] = [],
    unknowns: ReferenceReport["unknowns"] = [];
  ordered.forEach(({ segment, report }, i) => {
    const prefix = (id: string) => `p${i + 1}-${fingerprint(id).slice(0, 24)}`;
    const timed = <T extends { startMs: number; endMs: number }>(
      item: T,
    ): T | undefined => {
      const startMs = segment.startMs + item.startMs;
      const endMs = Math.min(segment.endMs, segment.startMs + item.endMs);
      if (startMs >= endMs) return undefined; // codec padding, explicitly recorded in analysis.parts
      return { ...item, startMs, endMs };
    };
    const mappedEvidence = report.evidence
      .map(timed)
      .filter((x) => x !== undefined)
      .map((e) => ({ ...e, id: prefix(e.id) }));
    const evidenceIds = new Set(mappedEvidence.map((e) => e.id));
    const refs = (ids: string[]) =>
      ids.map(prefix).filter((id) => evidenceIds.has(id));
    evidence.push(...mappedEvidence);
    shots.push(
      ...report.shots
        .map(timed)
        .filter((x) => x !== undefined)
        .map((s) => ({
          ...s,
          id: prefix(s.id),
          evidenceIds: refs(s.evidenceIds),
          visualStyle: s.visualStyle ?? report.visualStyle.description,
        })),
    );
    events.push(
      ...report.events
        .map(timed)
        .filter((x) => x !== undefined)
        .map((e) => ({
          ...e,
          id: prefix(e.id),
          evidenceIds: refs(e.evidenceIds),
        })),
    );
    beats.push(
      ...report.narrativeBeats
        .map(timed)
        .filter((x) => x !== undefined)
        .map((e) => ({
          ...e,
          id: prefix(e.id),
          evidenceIds: refs(e.evidenceIds),
        })),
    );
    speech.push(
      ...report.speech
        .map(timed)
        .filter((x) => x !== undefined)
        .map((e) => ({ ...e, evidenceIds: refs(e.evidenceIds) })),
    );
    unknowns.push(...report.unknowns.map(timed).filter((x) => x !== undefined));
  });
  const gaps = [];
  let end = plan.range.startMs;
  for (const s of shots) {
    if (s.startMs > end) gaps.push({ startMs: end, endMs: s.startMs });
    end = s.endMs;
  }
  if (end < plan.range.endMs)
    gaps.push({ startMs: end, endMs: plan.range.endMs });
  const first = ordered[0].report;
  let report: ReferenceReport;
  try {
    report = referenceReportSchema.parse({
      ...first,
      summary: `Combined ${ordered.length} source-linked segment analyses (${plan.detail}). Full observations, styles and actions are retained per shot; segment summaries and audio descriptions remain in the linked component reports. Processing windows and cut candidates are not verified semantic boundaries.`,
      shots,
      evidence,
      events,
      speech,
      narrativeBeats: beats,
      unknowns,
      visualStyle: {
        description:
          "See each shot's visualStyle for the corresponding source segment.",
        evidenceIds: [],
      },
      audio: {
        description:
          "See the linked component reports for segment-specific audio descriptions.",
        evidenceIds: [],
      },
      source: plan.source,
      analysis: {
        detail: plan.detail,
        focus: plan.input.focus ?? [],
        method: "segmented",
        parts: ordered.map((p, i) => ({
          analysisAssetId: p.id,
          clipAssetId: p.task.input.assetId,
          sourceStartMs: p.segment.startMs,
          sourceEndMs: p.segment.endMs,
          clipDurationMs: p.task.clipDurationMs,
          timeMapping: "offset-trim-codec-padding",
          boundary: p.segment.boundary,
          summary: p.report.summary,
          audio: {
            ...p.report.audio,
            evidenceIds: p.report.audio.evidenceIds
              .map((id) => `p${i + 1}-${fingerprint(id).slice(0, 24)}`)
              .filter((id) => evidence.some((e) => e.id === id)),
          },
        })),
      },
      coverage: {
        startMs: plan.range.startMs,
        endMs: plan.range.endMs,
        fps: null,
        mode: "provider_controlled",
        timing: "model_estimated",
        gaps,
      },
      measurements: plan.measurements,
      provenance: {
        ...first.provenance,
        provider: "rikoko-segment-merge",
        requestId: plan.id,
        jobId: plan.id,
        analyzedAt: new Date().toISOString(),
        evidence: "provider-live-assembled",
      },
    });
  } catch {
    throw new AppError(
      "ANALYSIS_MERGE_INVALID",
      "Combined report exceeds schema limits or has invalid timing/evidence. No observations were silently dropped to fit the report.",
    );
  }
  const bytes = Buffer.from(JSON.stringify(report));
  if (bytes.byteLength > 2 * 1024 * 1024)
    throw new AppError(
      "ANALYSIS_LIMIT",
      "Combined report exceeds 2 MiB; use a smaller plan range",
    );
  const asset = await service.registerAsset(c.accountId, bytes, {
    name: "reference-analysis-merged.json",
    kind: "analysis",
    mime: "application/json",
    metadata: { planId: plan.id },
    provenance: {
      source: "analysis-merge",
      sourceAssetId: source.id,
      sourceSha256: source.sha256,
      evidence: "provider-live-assembled",
    },
  });
  const result = {
    inputHash: mergeHash,
    analysisAssetId: asset.id,
    shotCount: report.shots.length,
    reportUnit: plan.segments.some(
      (s: AnalysisSegment) => s.boundary === "window",
    )
      ? "shot_fragments"
      : "reported_shots",
    windowBoundaryCount: plan.segments.filter(
      (s: AnalysisSegment) => s.boundary === "window",
    ).length,
  };
  await service.scoped(c, "write", async (tx) => {
    const latest = await tx.get(plan.id, c.accountId, "analysis-plan");
    if (latest) await tx.put({ ...latest, merged: result });
  });
  return { ...result, planId: plan.id };
}

export async function callReferenceWorkflowTool(
  service: Service,
  c: Context,
  name: keyof typeof referenceWorkflowTools,
  raw: unknown,
) {
  await service.scoped(c, "write", async () => {});
  if (name === "reference_analysis_record")
    return recordHostAnalysis(service, c, raw);
  if (name === "reference_analysis_plan") return planAnalysis(service, c, raw);
  if (name === "reference_analysis_prepare")
    return prepareAnalysis(service, c, raw);
  return mergeAnalysis(service, c, raw);
}
