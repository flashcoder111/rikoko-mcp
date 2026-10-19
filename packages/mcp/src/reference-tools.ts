import {
  loadReferenceReport,
  referenceEvidence,
  referenceHandoff,
  validateRemakeEvidence,
} from "../../core/src/reference-handoff.js";
import { productionPlanSchema } from "../../core/src/production-plan.js";
import { productionScopeState } from "../../core/src/production-scope.js";
import { z } from "zod";
import { resolveTiming } from "../../core/src/production-timing.js";
import { captionStylePatchSchema } from "../../contracts/src/caption-style.js";
import { prepareCaptionStyle } from "../../core/src/caption-style.js";
import {
  analysisSettings,
  analysisSettingsSchema,
  resolveAnalysisDetail,
} from "./reference-settings.js";
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
        "handoff",
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
    sourceShotIds: z.array(idSchema).max(20).default([]),
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
    plan: z
      .object({
        planId: idSchema,
        expectedVersion: z.number().int().positive(),
      })
      .strict()
      .optional(),
    width: z.number().int().min(144).max(1920).default(360),
    height: z.number().int().min(144).max(1920).default(640),
    language: z.string().min(2).max(20).default("zh"),
    reuseReference: z.boolean().default(false),
    matchCaptionStyle: z.boolean().default(false),
    captionDescription: z.string().max(2000).optional(),
    captionStyle: captionStylePatchSchema.optional(),
    replacements: z
      .array(
        z
          .object({
            sourceShotId: idSchema.optional(),
            productionShotId: idSchema.optional(),
            text: z.string().max(1000).default(""),
            assetId: idSchema.optional(),
            sourceStartMs: z.number().int().min(0).default(0),
            durationMs: z.number().int().min(100).max(600000).optional(),
            timingPolicy: z
              .enum(["full_asset", "selected_range", "fit_target"])
              .optional(),
          })
          .strict()
          .refine(
            (r) => !!r.sourceShotId || !!r.productionShotId,
            "Identify a source or target shot",
          ),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const referenceTools = {
  ...referenceWorkflowTools,
  reference_analysis_settings: {
    schema: analysisSettingsSchema,
    description:
      "Read or set this account's default video analysis detail. With no detail, read only. overview/shots/recreate persists an explicit default; auto restores shots for ordinary analysis and recreate for remake. Powers /rikoko analysis and the studio /analysis command. Explicit detail on an individual task wins. Applies to future inputs across this account, not existing plans, quotes or jobs. No model call, upload, quote or purchase.",
  },
  reference_analyze: {
    schema: analyzeSchema,
    description:
      "Quote one independent Gemini video analysis; the configured upstream must declare the Gemini family, regardless of the host LLM. Explicit detail (overview/shots/recreate) overrides reference_analysis_settings; when omitted use the account preference, or with auto use recreate for purpose=remake and shots otherwise. focus prioritizes motion, camera, appearance, text, audio or continuity. For full-video recreate or long/dense videos, use reference_analysis_plan/prepare first, analyze every prepared clip and merge; this tool alone makes one model request. Recreate requires structured initial/final states and action stages. Returns cache or exact quote input, never purchases. Obtain price agreement before job_submit. range is prompt-only on fal; only prepared clip assets physically restrict the upload. FPS is unknown on fal.",
  },
  reference_analysis_get: {
    schema: getSchema,
    description:
      "Read a source-bound reference analysis. For remake authoring choose section=handoff with optional sourceShotIds and pagination: returns verified Gemini lineage/hash, full shot states/stages, relevant beats/evidence/unknown indices/gaps and source neighbors. Handoff requires a completed recreate analysis job or a trusted merged report, never an uploaded provenance claim. Choose overview for compact context, or paginated shots/events/evidence/unknowns/parts. parts retains per-segment summaries, audio and source boundaries without repeating them on every page. Times use original-source milliseconds; model times are estimates, FFmpeg cut candidates are separate measurements. all returns the bounded full report.",
  },
  reference_analysis_query: {
    schema: querySchema,
    description:
      "Retrieve existing evidence in a source time range. This is evidence retrieval, not a new model answer. Returns a focused analysis input for unresolved questions; it requires a new quote and approval. Does not call any model.",
  },
  reference_adapt: {
    schema: referenceAdaptSchema,
    description:
      "With plan={planId,expectedVersion}, assemble in target-plan order and dimensions using replacements.productionShotId, including split/merged source mapping. Returns the default scoped projectId for workspace_commit. Without plan, creates a draft using source timing and optional direct productionShotId mapping. Source footage is reused only with explicit reuseReference. No paid generation/render; pass composition to workspace_commit after review. Optional projectId saves an editable revision. Set matchCaptionStyle to suggest subtitle styling from visualStyle even when the reference has no subtitles; captionDescription and explicit captionStyle override the suggestion. This does not recognize an exact source font.",
  },
};
export async function readReferenceReport(
  service: Service,
  c: Context,
  id: string,
): Promise<ReferenceReport> {
  return service.scoped(
    c,
    "read",
    async (tx) =>
      (await loadReferenceReport(service, tx, c.accountId, id)).report,
  );
}
export async function adaptReference(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = referenceAdaptSchema.parse(raw);
  const report = await readReferenceReport(service, c, input.analysisAssetId);
  if (input.plan) return adaptTargetPlan(service, c, input, report);
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
    let durationMs = replacement?.durationMs ?? shot.endMs - shot.startMs;
    let speed = 1;
    let discardedTailMs = 0;
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
      if (asset.kind === "video" && assetId !== report.source.assetId) {
        const timing = resolveTiming(asset.metadata?.durationMs, {
          policy: replacement?.timingPolicy,
          sourceStartMs,
          durationMs: replacement?.durationMs,
        });
        durationMs = timing.durationMs;
        speed = timing.speed;
        discardedTailMs = timing.discardedTailMs;
      }
      if (!["image", "video"].includes(asset.kind))
        throw new AppError(
          "INVALID_MEDIA",
          "Shot replacement requires image or video",
        );
      if (
        asset.kind === "video" &&
        (!Number.isFinite(asset.metadata?.durationMs) ||
          sourceStartMs + durationMs * speed > asset.metadata.durationMs + 0.01)
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
      productionShotId: replacement?.productionShotId,
      durationMs,
      speed,
      assetId,
      sourceStartMs,
      text: replacement?.text ?? "",
      color: "#173b42",
      fit: "contain",
    });
    shotMapping.push({
      targetSceneId: id,
      discardedTailMs,
      warnings:
        discardedTailMs > 1000
          ? [
              "More than one second of the generated tail was discarded. Use media_inspect on the omitted interval and check action completion.",
            ]
          : [],
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
  const captionStyling =
    input.matchCaptionStyle || input.captionDescription || input.captionStyle
      ? prepareCaptionStyle({
          description: input.captionDescription,
          referenceStyle: input.matchCaptionStyle
            ? report.visualStyle.description
            : undefined,
          overrides: input.captionStyle,
        })
      : undefined;
  const composition = compositionSchema.parse({
    schemaVersion: 1,
    title: input.title,
    width: input.width,
    height: input.height,
    language: input.language,
    scenes,
    ...(captionStyling ? { captionStyle: captionStyling.style } : {}),
  });
  const revision = input.projectId
    ? await service.addRevision(c, input.projectId, composition)
    : undefined;
  return {
    planningMethod: "reference-shot-mapping",
    ...(captionStyling ? { captionStyling } : {}),
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
async function adaptTargetPlan(
  service: Service,
  c: Context,
  input: z.infer<typeof referenceAdaptSchema>,
  report: ReferenceReport,
) {
  const saved = await service.get(c, "production-plan", input.plan!.planId);
  if (saved.version !== input.plan!.expectedVersion)
    throw new AppError(
      "PLAN_CONFLICT",
      "Use the current target plan version",
      409,
    );
  const plan = productionPlanSchema.parse(saved.plan);
  if (!plan.remake || plan.remake.analysisAssetId !== input.analysisAssetId)
    throw new AppError(
      "REMAKE_REQUIREMENTS_REQUIRED",
      "Use a target remake plan bound to this source analysis",
      409,
    );
  await service.scoped(c, "read", (tx) =>
    validateRemakeEvidence(service, tx, c.accountId, plan),
  );
  const projectId = input.projectId ?? saved.productionProjectId;
  if (!projectId)
    throw new AppError(
      "PRODUCTION_SCOPE_REQUIRED",
      "Bind a project to the target plan",
      409,
    );
  const state = await service.scoped(c, "read", (tx) =>
    productionScopeState(tx, c.accountId, projectId),
  );
  if (
    state.scope?.planId !== saved.id ||
    state.scope.planVersion !== saved.version
  )
    throw new AppError(
      "PRODUCTION_SCOPE_CHANGED",
      "Use a project bound to this plan version",
      409,
    );
  const replacements = new Map<string, (typeof input.replacements)[number]>();
  for (const replacement of input.replacements) {
    const candidates = plan.shots.filter((s) =>
      replacement.productionShotId
        ? s.id === replacement.productionShotId
        : s.sourceShotIds.includes(replacement.sourceShotId!),
    );
    if (
      candidates.length !== 1 ||
      replacements.has(candidates[0].id) ||
      (replacement.sourceShotId &&
        !candidates[0].sourceShotIds.includes(replacement.sourceShotId))
    )
      throw new AppError(
        "INVALID_SHOT",
        "Use a unique productionShotId; source-only mapping must be unambiguous",
      );
    replacements.set(candidates[0].id, replacement);
  }
  const scenes = [],
    shotMapping = [];
  for (const shot of plan.shots) {
    const replacement = replacements.get(shot.id);
    const source =
      shot.sourceShotIds.length === 1
        ? report.shots.find((s) => s.id === shot.sourceShotIds[0])
        : undefined;
    const assetId =
      replacement?.assetId ??
      (input.reuseReference && source ? report.source.assetId : undefined);
    if (input.reuseReference && !assetId && shot.visualKind !== "graphic")
      throw new AppError(
        "INVALID_SHOT",
        "A merged or new target shot needs explicit replacement media",
      );
    if (assetId === report.source.assetId && !input.reuseReference)
      throw new AppError(
        "REFERENCE_REUSE_REQUIRED",
        "Explicitly enable source footage reuse",
      );
    const asset = assetId ? await service.get(c, "asset", assetId) : undefined;
    if (asset && !["image", "video"].includes(asset.kind))
      throw new AppError("INVALID_MEDIA", "Target shot needs visual media");
    let durationMs = replacement?.durationMs ?? shot.durationMs;
    let sourceStartMs = replacement?.sourceStartMs ?? 0,
      speed = 1;
    if (asset?.kind === "video") {
      if (assetId === report.source.assetId && !replacement) {
        sourceStartMs = source!.startMs;
        durationMs = source!.endMs - source!.startMs;
      }
      const timing = resolveTiming(asset.metadata.durationMs, {
        policy:
          assetId === report.source.assetId
            ? "selected_range"
            : replacement?.timingPolicy,
        sourceStartMs,
        durationMs:
          assetId === report.source.assetId
            ? durationMs
            : replacement?.durationMs,
      });
      ({ durationMs, sourceStartMs, speed } = timing);
    }
    if (!durationMs)
      throw new AppError(
        "TARGET_DURATION_REQUIRED",
        `Set durationMs for target shot ${shot.id}`,
      );
    if (asset?.kind === "image" && sourceStartMs)
      throw new AppError("INVALID_INTERVAL", "Images have no source offset");
    scenes.push({
      id: shot.id,
      productionShotId: shot.id,
      visualKind: shot.visualKind === "graphic" ? "graphic" : undefined,
      assetId,
      sourceStartMs,
      durationMs,
      speed,
      text: replacement?.text ?? "",
      fit: "contain",
      color: "#173b42",
    });
    shotMapping.push({
      targetSceneId: shot.id,
      productionShotId: shot.id,
      sourceShotIds: shot.sourceShotIds,
      status:
        asset || shot.visualKind === "graphic" ? "reused_media" : "needs_media",
      visualBrief: {
        action: shot.action,
        initialState: shot.initialState,
        endState: shot.endState,
        camera: shot.camera,
      },
    });
  }
  const captionStyling =
    input.matchCaptionStyle || input.captionDescription || input.captionStyle
      ? prepareCaptionStyle({
          description: input.captionDescription,
          referenceStyle: input.matchCaptionStyle
            ? report.visualStyle.description
            : undefined,
          overrides: input.captionStyle,
        })
      : undefined;
  const composition = compositionSchema.parse({
    schemaVersion: 1,
    title: input.title,
    width: plan.width,
    height: plan.height,
    language: input.language,
    scenes,
    ...(captionStyling ? { captionStyle: captionStyling.style } : {}),
  });
  const revision = input.projectId
    ? await service.addRevision(c, projectId, composition)
    : undefined;
  return {
    planningMethod: "target-plan-mapping",
    projectId,
    planId: saved.id,
    planVersion: saved.version,
    productionScope: state.scope,
    analysisAssetId: input.analysisAssetId,
    referenceAssetId: report.source.assetId,
    composition,
    shotMapping,
    revisionId: revision?.id,
    ...(captionStyling ? { captionStyling } : {}),
    generationRequired: shotMapping
      .filter((s) => s.status === "needs_media")
      .map((s) => s.targetSceneId),
    unknowns: report.unknowns,
    coverageGaps: report.coverage.gaps,
    rendered: false,
  };
}
export async function callReferenceTool(
  service: Service,
  c: Context,
  name: keyof typeof referenceTools,
  raw: unknown,
): Promise<any> {
  if (name === "reference_analysis_settings")
    return analysisSettings(service, c, raw);
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
      detail: await resolveAnalysisDetail(service, c, data),
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
    const input = getSchema.parse(raw);
    if (input.section === "handoff")
      return service.scoped(c, "read", async (tx) => {
        const { report, binding } = await referenceEvidence(
          service,
          tx,
          c.accountId,
          input.analysisAssetId,
        );
        return referenceHandoff(
          report,
          binding,
          input.sourceShotIds,
          input.offset,
          input.limit,
        );
      });
    if (input.sourceShotIds.length)
      throw new AppError(
        "INVALID_INPUT",
        "sourceShotIds is only supported for section=handoff",
      );
    const report = await readReferenceReport(service, c, input.analysisAssetId);
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
