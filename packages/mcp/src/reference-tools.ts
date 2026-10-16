import { z } from "zod";
import {
  AppError,
  compositionSchema,
  idSchema,
  type Context,
} from "../../contracts/src/index.js";
import {
  referenceOperationSchema,
  referenceReportSchema,
  type ReferenceReport,
} from "../../contracts/src/reference-analysis.js";
import { cloudConnection } from "../../cloud-client/src/index.js";
import { Service, fingerprint } from "../../core/src/index.js";
import {
  referenceWorkflowTools,
  callReferenceWorkflowTool,
} from "./reference-workflow-tools.js";

const analyzeSchema = referenceOperationSchema
  .omit({ kind: true })
  .extend({ refresh: z.boolean().default(false) });
const getSchema = z
  .object({
    analysisAssetId: idSchema,
    section: z
      .enum([
        "all",
        "overview",
        "shots",
        "events",
        "evidence",
        "narrativeBeats",
        "speech",
        "unknowns",
        "parts",
      ])
      .default("overview"),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
const querySchema = z
  .object({
    analysisAssetId: idSchema,
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
    question: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .refine((i) => i.endMs > i.startMs);
export const referenceAdaptSchema = z
  .object({
    analysisAssetId: idSchema,
    title: z.string().min(1).max(160),
    projectId: idSchema.optional(),
    width: z.number().int().min(144).max(1920).default(360),
    height: z.number().int().min(144).max(1920).default(640),
    language: z.string().min(2).max(20).default("zh"),
    reuseReference: z.boolean().default(false),
    replacements: z
      .array(
        z
          .object({
            sourceShotId: idSchema,
            text: z.string().max(1000).default(""),
            assetId: idSchema.optional(),
            sourceStartMs: z.number().int().min(0).default(0),
            durationMs: z.number().int().min(100).max(600000).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const referenceTools = {
  ...referenceWorkflowTools,
  reference_analyze: {
    schema: analyzeSchema,
    description:
      "Quote one independent video analysis. detail is overview, shots (default), or recreate; purpose=remake automatically selects recreate when detail is omitted. focus prioritizes motion, camera, appearance, text, audio or continuity. For full-video recreate or long/dense videos, use reference_analysis_plan/prepare first, analyze every prepared clip and merge; this tool alone makes one model request. Recreate requires structured initial/final states and action stages. Returns cache or exact quote input, never purchases. Obtain price agreement before job_submit. range is prompt-only on fal; only prepared clip assets physically restrict the upload. FPS is unknown on fal.",
  },
  reference_analysis_get: {
    schema: getSchema,
    description:
      "Read a source-bound reference analysis. Choose overview for compact context, or paginated shots/events/evidence/unknowns/parts. parts retains per-segment summaries, audio and source boundaries without repeating them on every page. Times use original-source milliseconds; model times are estimates, FFmpeg cut candidates are separate measurements. all returns the bounded full report.",
  },
  reference_analysis_query: {
    schema: querySchema,
    description:
      "Retrieve existing evidence in a source time range. This is evidence retrieval, not a new model answer. Returns a focused analysis input for unresolved questions; it requires a new quote and approval. Does not call any model.",
  },
  reference_adapt: {
    schema: referenceAdaptSchema,
    description:
      "Convert analyzed shots into a source-linked target composition with replacement text/media and per-shot generation needs. Uses actual analyzed timing and structure. Source footage is reused only with explicit reuseReference. No paid generation/render; pass composition to workspace_commit after review. Optional projectId saves an editable revision.",
  },
};
export async function readReferenceReport(
  service: Service,
  c: Context,
  id: string,
): Promise<ReferenceReport> {
  const asset = await service.get(c, "asset", id);
  if (asset.kind !== "analysis" || asset.bytes > 2 * 1024 * 1024)
    throw new AppError(
      "INVALID_ANALYSIS",
      "Expected a bounded reference analysis asset",
    );
  let report: ReferenceReport;
  try {
    report = referenceReportSchema.parse(
      JSON.parse(
        Buffer.from(await service.storage.read(asset.storageKey)).toString(),
      ),
    );
  } catch {
    throw new AppError(
      "INVALID_ANALYSIS",
      "Expected a validated version 2 reference report",
    );
  }
  const source = await service.get(c, "asset", report.source.assetId);
  if (
    source.sha256 !== report.source.sha256 ||
    source.metadata?.durationMs !== report.source.durationMs
  )
    throw new AppError(
      "SOURCE_MISMATCH",
      "Analysis does not match the owned source video",
    );
  return report;
}
export async function adaptReference(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = referenceAdaptSchema.parse(raw);
  const report = await readReferenceReport(service, c, input.analysisAssetId);
  if (report.analysis?.detail === "overview")
    throw new AppError(
      "ANALYSIS_DETAIL_REQUIRED",
      "Overview sections are not individual shots. Analyze at shots or recreate detail before adaptation.",
    );
  const replacements = new Map(
    input.replacements.map((r) => [r.sourceShotId, r]),
  );
  if (
    replacements.size !== input.replacements.length ||
    input.replacements.some(
      (r) => !report.shots.some((s) => s.id === r.sourceShotId),
    )
  )
    throw new AppError(
      "INVALID_SHOT",
      "Replacement IDs must uniquely identify analyzed shots",
    );
  const scenes = [],
    shotMapping = [];
  for (const shot of report.shots) {
    const replacement = replacements.get(shot.id);
    const durationMs = replacement?.durationMs ?? shot.endMs - shot.startMs;
    const assetId =
      replacement?.assetId ??
      (input.reuseReference ? report.source.assetId : undefined);
    const sourceStartMs =
      assetId === report.source.assetId
        ? shot.startMs
        : (replacement?.sourceStartMs ?? 0);
    if (assetId) {
      if (assetId === report.source.assetId && !input.reuseReference)
        throw new AppError(
          "REFERENCE_REUSE_REQUIRED",
          "Explicitly enable source footage reuse",
        );
      const asset = await service.get(c, "asset", assetId);
      if (!["image", "video"].includes(asset.kind))
        throw new AppError(
          "INVALID_MEDIA",
          "Shot replacement requires image or video",
        );
      if (
        asset.kind === "video" &&
        (!Number.isFinite(asset.metadata?.durationMs) ||
          sourceStartMs + durationMs > asset.metadata.durationMs)
      )
        throw new AppError(
          "INVALID_INTERVAL",
          "Replacement video is shorter than the target shot",
        );
      if (asset.kind === "image" && sourceStartMs !== 0)
        throw new AppError("INVALID_INTERVAL", "Images have no source offset");
    }
    const id =
      shot.id.length <= 96
        ? `ref-${shot.id}`
        : `ref-${fingerprint(shot.id).slice(0, 32)}`;
    scenes.push({
      id,
      durationMs,
      assetId,
      sourceStartMs,
      text: replacement?.text ?? "",
      color: "#173b42",
      fit: "contain",
    });
    shotMapping.push({
      targetSceneId: id,
      sourceShotId: shot.id,
      sourceStartMs: shot.startMs,
      sourceEndMs: shot.endMs,
      sourceEventIds: report.events
        .filter((e) => e.startMs < shot.endMs && e.endMs > shot.startMs)
        .map((e) => e.id),
      evidenceIds: shot.evidenceIds,
      status: assetId ? "reused_media" : "needs_media",
      visualBrief: {
        description: shot.description,
        framing: shot.framing,
        cameraMotion: shot.cameraMotion,
        action: shot.action,
        transition: shot.transition,
        details: shot.details,
        visualStyle: shot.visualStyle ?? report.visualStyle.description,
      },
    });
  }
  const composition = compositionSchema.parse({
    schemaVersion: 1,
    title: input.title,
    width: input.width,
    height: input.height,
    language: input.language,
    scenes,
  });
  const revision = input.projectId
    ? await service.addRevision(c, input.projectId, composition)
    : undefined;
  return {
    planningMethod: "reference-shot-mapping",
    analysisAssetId: input.analysisAssetId,
    referenceAssetId: report.source.assetId,
    composition,
    shotMapping,
    revisionId: revision?.id,
    unknowns: report.unknowns,
    coverageGaps: report.coverage.gaps,
    generationRequired: shotMapping
      .filter((s) => s.status === "needs_media")
      .map((s) => s.targetSceneId),
    rendered: false,
  };
}
export async function callReferenceTool(
  service: Service,
  c: Context,
  name: keyof typeof referenceTools,
  raw: unknown,
): Promise<any> {
  if (Object.hasOwn(referenceWorkflowTools, name))
    return callReferenceWorkflowTool(
      service,
      c,
      name as keyof typeof referenceWorkflowTools,
      raw,
    );
  if (name === "reference_analyze") {
    const { refresh, ...data } = analyzeSchema.parse(raw);
    const input = referenceOperationSchema.parse({
      ...data,
      detail: data.detail ?? (data.purpose === "remake" ? "recreate" : "shots"),
      kind: "reference_analyze",
    });
    const source = await service.get(c, "asset", input.assetId);
    const gateway = cloudConnection(service)?.gateway;
    const officialQuote = gateway ? await gateway.quote(c, input) : undefined;
    if (!gateway) service.provider.validateSource?.(input, source);
    const price = officialQuote ?? service.estimate(input);
    if (!refresh) {
      const jobs = await service.list(c, "job");
      const match = jobs.find(
        (j) =>
          j.inputHash === fingerprint(input) &&
          j.priceVersion === price.priceVersion &&
          j.status === "completed" &&
          j.outputs.length,
      );
      if (match) {
        const report = await readReferenceReport(service, c, match.outputs[0]);
        return {
          status: "cached",
          jobId: match.id,
          analysisAssetId: match.outputs[0],
          summary: report.summary,
          shotCount: report.shots.length,
          unknownCount: report.unknowns.length,
        };
      }
      const active = jobs.find(
        (j) =>
          j.inputHash === fingerprint(input) &&
          j.priceVersion === price.priceVersion &&
          ["queued", "running", "submission_unknown", "failed"].includes(
            j.status,
          ) &&
          (j.status !== "failed" || (j.ticket && !j.settled)),
      );
      if (active)
        return {
          status: active.status,
          jobId: active.id,
          instruction:
            "Read the existing job; poll or resume known tickets. Do not submit another purchase to retry.",
        };
    }
    return {
      status: "quote_required",
      input,
      quote: officialQuote ?? (await service.quote(c, input)),
      instruction:
        "Obtain agreement to this quote, then job_submit with the returned input and a stable idempotencyKey.",
    };
  }
  if (name === "reference_adapt") return adaptReference(service, c, raw);
  if (name === "reference_analysis_get") {
    const input = getSchema.parse(raw),
      report = await readReferenceReport(service, c, input.analysisAssetId);
    if (input.section === "all") return report;
    const { parts, ...profile } = report.analysis ?? {};
    const overview = {
      schemaVersion: report.schemaVersion,
      source: report.source,
      summary: report.summary,
      analysis: report.analysis
        ? { ...profile, partCount: parts?.length ?? 0 }
        : undefined,
      coverage: report.coverage,
      provenance: report.provenance,
      measurements: report.measurements,
      counts: Object.fromEntries(
        [
          "shots",
          "events",
          "evidence",
          "narrativeBeats",
          "speech",
          "unknowns",
        ].map((k) => [k, (report[k as "shots"] as unknown[]).length]),
      ),
    };
    if (input.section === "overview") return overview;
    const items =
      input.section === "parts" ? (parts ?? []) : report[input.section];
    return {
      ...overview,
      section: input.section,
      items: items.slice(input.offset, input.offset + input.limit),
      nextOffset:
        input.offset + input.limit < items.length
          ? input.offset + input.limit
          : null,
    };
  }
  const input = querySchema.parse(raw),
    report = await readReferenceReport(service, c, input.analysisAssetId);
  if (input.endMs > report.source.durationMs)
    throw new AppError("INVALID_INTERVAL", "Query exceeds the source video");
  const overlaps = (e: { startMs: number; endMs: number }) =>
    e.startMs < input.endMs && e.endMs > input.startMs;
  return {
    source: report.source,
    retrievalOnly: true,
    shots: report.shots.filter(overlaps),
    events: report.events.filter(overlaps),
    evidence: report.evidence.filter(overlaps),
    speech: report.speech.filter(overlaps),
    unknowns: report.unknowns.filter(overlaps),
    coverage: report.coverage,
    refinementInput: referenceOperationSchema.parse({
      kind: "reference_analyze",
      assetId: report.source.assetId,
      model: report.provenance.model,
      purpose: "inspect",
      detail: report.analysis?.detail ?? "shots",
      focus: report.analysis?.focus,
      range: { startMs: input.startMs, endMs: input.endMs },
      question:
        input.question ??
        "Resolve uncertain events and timing in this interval",
    }),
    refinementRequiresQuote: true,
  };
}
