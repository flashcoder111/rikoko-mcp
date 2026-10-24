import {
  generationTraceGet,
  tracedPreparation,
} from "../../core/src/generation-trace.js";
import {
  productionRequestSchema,
  bindProductionRequest,
  validateProductionRequest,
} from "../../core/src/production-request.js";
import { intentNotice } from "../../core/src/production-intent.js";
import {
  videoModelResolveSchema,
  resolveVideoModel,
} from "../../core/src/video-model-selection.js";
import {
  methodResolveSchema,
  resolveProductionMethod,
  assertMethodMode,
  assertMethodSource,
  sourceEditComposition,
} from "../../core/src/production-method.js";
import { referenceDelivery } from "../../core/src/reference-delivery.js";
import { shotReferenceCheck } from "../../core/src/shot-reference-choice.js";
import {
  planGuidance,
  shotGuidance,
  preparedGuidance,
} from "../../core/src/director-guidance.js";
import { mediaRuntimeCheck } from "../../core/src/media-runtime.js";
import {
  directorCatalog,
  directorCatalogSchema,
} from "../../core/src/director-kits.js";
import {
  directorCaseSchema,
  recordDirectorCase,
} from "../../core/src/director-cases.js";
import {
  assertEditingAssets,
  assertProductionQualityRetained,
  editingTimeline,
  validateEditingComposition,
} from "../../core/src/production-editing.js";
import { productionReviewObligations } from "../../core/src/production-quality-review.js";
import { compositionSchema, type Entity } from "../../contracts/src/index.js";
import {
  validateRemakeEvidence,
  referenceEvidence,
  referenceHandoff,
} from "../../core/src/reference-handoff.js";
import {
  productionScopeSaveSchema,
  productionRequirementsSchema,
  productionAssetAssignSchema,
  saveProductionScope,
  assignProductionAsset,
  syncProductionChange,
} from "../../core/src/production-scope.js";
import { z } from "zod";
import { promptReferenceSyntax } from "../../providers/src/prompt-reference.js";
import { randomUUID } from "node:crypto";
import {
  AppError,
  idSchema,
  operationSchema,
  type Context,
} from "../../contracts/src/index.js";
import { Service, fingerprint } from "../../core/src/index.js";
import { cloudConnection } from "../../cloud-client/src/index.js";
import {
  compilePrompt,
  promptInputSchema,
} from "../../core/src/production-prompts.js";
import {
  productionPlanSchema,
  validateProductionPlan,
  productionShotDirection,
  assertEditorialSeparation,
  type ProductionPlan,
} from "../../core/src/production-plan.js";
import {
  inspectMedia,
  inspectSchema,
} from "../../core/src/media-inspection.js";
import {
  reviewMedia,
  mediaReviewSchema,
  validateWorkspace,
} from "../../core/src/production-review.js";
import {
  generationPrepareSchema,
  prepareGeneration,
} from "../../core/src/generation-preparation.js";
function targetNeighbor(
  shot: ProductionPlan["shots"][number] | undefined,
  detail: "compact" | "full",
) {
  if (!shot) return null;
  return detail === "full"
    ? shot
    : {
        id: shot.id,
        initialState: shot.initialState,
        endState: shot.endState,
        transition: shot.transition,
        transitionReason: shot.transitionReason,
      };
}

export const productionTools = {
  generation_trace_get: {
    schema: z.object({ id: idSchema }).strict(),
    description:
      "Read the owned immutable request, verified Gemini report, host plan, compiled prompt, actual reference bindings and execution status by preparation/job/failure trace ID. Missing legacy evidence stays missing. No model call.",
  },
  video_model_resolve: {
    schema: videoModelResolveSchema,
    description:
      "Before video generation, inspect the requested scene and ALL supplied images/videos (including source video and first/last frames). Declare faces present/absent/unknown with evidence; never infer absence from metadata or only a video's first frame. Returns compatible configured candidates and hash-bound videoPolicy. Default Seedance Mini only for face-free tasks. Present/unknown blocks EVERY Seedance variant, recommends MiniMax, offers Kling, and requires interaction in the original conversation. Record userChoice only from an actual user selection (reuse an existing explicit selection). Carry returned videoPolicy into generation_prepare/job_submit. This tool does not detect faces, upload, generate or authorize spending.",
  },
  production_method_resolve: {
    schema: methodResolveSchema,
    description:
      "Choose the production relationship BEFORE storyboarding or selecting a model. The host interprets the whole brief: edit_source changes the actual video while preserving everything else; transfer_properties generates new material borrowing named properties; reinterpret authors a new adaptation. Supply a concise change statement, owned sourceAssetId and subject images with their replacement roles. Returns only compatible configured candidates (Seedance Mini preferred for face-free tasks; otherwise MiniMax, subject to video_model_resolve and user choice), or a capability_gap without fallback. Preservation requirements do not force video_to_video: select a compatible MiniMax reference_to_video or edit interface. Optional model selects the user preference; explicit sourceSegments declare consecutive source excerpts when one call cannot fit the original. Returns a plan retaining original timing and canvas; optional output is an explicit user-requested size. Does not analyze, upload, generate or authorize spending. Read rikoko_guide topic=production-method.",
  },
  director_case_record: {
    schema: directorCaseSchema,
    description:
      "Save an account-owned immutable trial snapshot from a completed/failed prepared director-kit job, optionally with its exact output and source-media review. Outcome is derived, never caller-supplied; no automatic kit promotion or training. Repeating identical input returns the same case. List/read with records_list/record_get type=director-case. No generation.",
  },
  director_catalog: {
    schema: directorCatalogSchema,
    description:
      "Read candidate UGC/talking-head ad formats, versioned image/video prompt kits, recipe wording, reference needs and review criteria. Select a kit only if useful before authoring shot.promptKits.image/video; custom direction is also valid or preview direction.directorKit. No model calls or automatic quality claims; composition template_match serves a separate purpose.",
  },
  production_editing_preview: {
    schema: z
      .object({
        planId: idSchema,
        expectedVersion: z.number().int().positive(),
        revisionId: idSchema.optional(),
        assetId: idSchema.optional(),
        assetIds: z.array(idSchema).min(1).max(100).optional(),
      })
      .strict(),
    description:
      "For a source-preserving plan, pass assetId or ordered assetIds to assemble completed videos at the inherited source duration, speed 1 and final canvas; returns composition for workspace_commit without rendering. Otherwise preview a saved plan's timeline, source-bound music cues and review obligations. Optionally validate revisionId: cut/event alignment, audio identity/gain/native mixing, ending duration and product media. Cue provenance is declared evidence, not automatic beat detection or listening. Shared audio starts at source zero; prepare a distinct trimmed asset before binding different excerpts.",
  },
  media_runtime_check: {
    schema: z.object({}).strict(),
    description:
      "Check backend temporary file access and real FFmpeg image extraction/gray decoding using a tiny synthetic fixture. No user files, uploads, persistent assets or model calls. Does not prove user video decoding, host image visibility or delivery. Use to diagnose media_inspect environment failures; do not repeatedly retry a failed check unchanged.",
  },
  production_scope_save: {
    schema: productionScopeSaveSchema,
    description:
      "Bind a project to a versioned formal target plan and review requirements. expectedScopeVersion=0 initializes; updates need the current version. No per-call disable switch. Rebinding invalidates prepared generations, asset assignments and optional review bindings. AI review is not required for delivery. Synced cloud dependencies require the same cloud connection to update.",
  },
  production_asset_assign: {
    schema: productionAssetAssignSchema,
    description:
      "Assign an owned asset to a formal project/scope/shot without requiring video or decorative-image AI review. prepared_generation requires completed output from that exact preparation; external use must be explicitly permitted by scope. Draft/experimental assets do not become formal automatically. Composition scenes must carry productionShotId.",
  },
  generation_prompt_preview: {
    schema: promptInputSchema.extend({
      model: z.string().min(1).max(120).optional(),
    }),
    description:
      "Compile a mode-specific prompt draft without calling a model. Supply target states and actual input responsibilities. For video, prefer sceneDirection: one complete shot-local paragraph with subject, setting, initial arrangement, timed action, settled result and camera; it replaces separate scene field prose without removing explicit constraints or reference bindings. Select model to use its reference syntax; omitted model uses descriptive labels only. Returns prompt, normalized direction and template/compiler versions. This draft is not submit-ready; pass direction and exact prompt to generation_prepare with the real model and references.",
  },
  generation_prepare: {
    schema: generationPrepareSchema,
    description:
      "Persist a frozen local or cloud generation request without uploading, quoting or generating. For EVERY video supply request={requestId,expectedVersion} from workspace_request_save with the verbatim brief and all attachments. Video attachments require verified recreate analysis, a bound remake plan and the actual source video as motion/source_video; stills/reconstruct/analysis_only cannot substitute. Use generation_trace_get for diagnosis. Supply input plus direction from prompt preview; plan={planId,expectedVersion,shotId,stage?} binds saved target intent; stage=video|first_frame|last_frame must match its draft and model kind. Remake prompts must match the compiled draft exactly; revise the plan instead of overriding. For other work, handwritten or changed prompts require promptOverride.reason. Returns referenceDelivery (prepared_not_submitted, video count, asset hashes, provider fields and analysis-only exclusions), preparedRequestId inside exact input, request hash, template/compiler versions, real provider field/array bindings, public output parameters and hashed private configuration. Critical video-reference images require a current hash-bound quick review even without storyboard; unknown is blocked before generation. Previous-end anchors must be actual media_inspect frames from the preceding shot. Pass input unchanged directly to job_submit; quote_create is optional only if the user asks for pricing; never remove its preparation ID. Plan, asset or model changes require preparation again. Cloud returns a server-owned prepared draft without uploading; quote binds verified uploaded bytes to an immutable derivative. input.production binds the persistent project scope and requires the matching plan.",
  },
  production_plan_validate: {
    schema: productionPlanSchema,
    description:
      "Validate a host-authored target shot plan independent of source shot count/timing. Record each media shot referenceChoice={strategy:motion_reference|stage_first_frame|direct,reason} (max 240 chars); referenceChecks flags missing choices without breaking legacy plans. Prefer sceneDirection for one complete video paragraph; keep it consistent with the structured states/actionStages, which remain saved. It must include visible subject/setting, current action with completion timing, final state and camera; semantic equivalence is host judgment. Optional process declares object identities, support, per-shot initial/end state, operation preconditions/effects, ordered approach/contact/completion/hold and real state anchors. Optional editing declares source-hashed audio cues/mix intent and final product/brand hold. See rikoko_guide topic=production-quality. Source IDs require a remake contract binding verified analysis and preserve/adapt/free requirements. Checks declared consistency, evidence ownership, coverage and duration; cannot judge pixels or sound. No model call.",
  },
  production_shot_prompts: {
    schema: z
      .object({
        planId: idSchema,
        expectedVersion: z.number().int().positive(),
        shotId: idSchema,
        subject: promptInputSchema.shape.subject,
        mode: promptInputSchema.shape.mode,
        setting: promptInputSchema.shape.setting,
        camera: promptInputSchema.shape.camera,
        model: z.string().min(1).max(120).optional(),
        imageModel: z.string().min(1).max(120).optional(),
        handoffDetail: z.enum(["compact", "full"]).default("compact"),
      })
      .strict(),
    description:
      "Compile image and video prompt drafts from the saved plan. Prefer shot.sceneDirection for a complete concise video scene; structured states/actionStages remain the validation contract and boundary-image source. Without it, legacy structured prose is retained. Carries process operations, supports, phase budgets and explicit generationConstraints into provider prompts. Returns referenceCheck for the saved route and, only for stage_first_frame, the expected starting state and quick checks. Reuse suitable frames; image generation is not mandatory. Returns hostInstructions with separate acceptanceCriteria, requirementUses and editing; never copy host checks into the provider prompt. Editorial brand/CTA copy in footage prompts is rejected. Returns plan-derived qualityReview obligations. Version and source evidence checked; no generation. For remakes, handoffDetail=compact returns selected source shots and neighboring boundary states; full restores evidence observations, events, segment details and complete neighbors. Use the returned detail access when needed. Boundary image prompts describe static states. Host supplies actual first/last frame references in the plan when using those modes.",
  },
  production_plan_save: {
    schema: z
      .object({
        plan: productionPlanSchema,
        planId: idSchema.optional(),
        expectedVersion: z.number().int().positive().optional(),
        request: productionRequestSchema.optional(),
      })
      .strict(),
    description:
      "Save a validated target production plan. Store your choices in plan.creativeChoices (decision/reason); userRequirements come only from the bound request and cannot be overwritten by the plan. Present the returned communication briefly, then continue within authorization without asking for routine approval. For a new attachment brief, first save workspace_request_save and pass request={requestId,expectedVersion}; all current attachments must occur in plan references or explicit request.excludedAssets with reasons. Never silently reuse another product's plan. The request binding survives edits and is rechecked before generation. Updating requires planId and expectedVersion; changing remake source/requirements/product facts/unknown decisions also needs remake.changeReason. Existing remake, process, audio and ending contracts cannot be removed. Shared audio requires an owned audible asset and its exact hash. Creates a default scoped project returned as productionProjectId; plan preparations inherit its scope and dimensions. Validation does not certify semantic fidelity. No model call.",
  },
  media_inspect: {
    schema: inspectSchema,
    description:
      "Extract native MCP images/grid and persist hash-bound inspection evidence from an owned image/video. Use count (default 3, max 12) for uniform samples OR ordered timesMs (max 12) for key action events within startMs/endMs. Times are requested seeks, not verified frame PTS; unsampled intervals remain unknown. Default: inspect critical images once for subject, major defects and starting state; reuse checks for unchanged bytes and use. Video review is optional only on user request. For an explicitly requested action review inspect critical intervals with gaps <=250 ms, using multiple bounded calls as needed. claimedStatic checks differences, never proves no motion. Local FFmpeg, no model call. Each frame has an owned assetId and source provenance; use that asset directly for previous_end, at the retained edit endpoint, instead of reimporting a PNG. Inspect pixels before media_review. Statistics never establish semantic correctness.",
  },
  media_review: {
    schema: mediaReviewSchema,
    description:
      "Optional evidence recording, not a final-delivery gate. Use one quick check for critical images; video/final review only on user request, never auto-regenerate. Record host/user judgment with checks={actionComplete,framing,continuity,noArtifacts}, inspectionIds and notes. Each check has status:pass|fail|unknown|not_applicable and reason (required except pass). Use decision=unreviewed with unknown checks when unable to inspect. For a stage_first_frame image bind production and record startingStateChecks={stage,count,arrangement,support}, each with status and a short reason. Stage and arrangement must pass; count/support may be not_applicable with a reason. Reuse its existing inspection. For process sources bind production={projectId,scopeVersion,shotId}; for final renders bind revisionId and current workspace_validate.productionScopeHash as expectedProductionScopeHash. Copy every returned qualityReview obligation into qualityChecks with obligationId,status,reason,method,range and operation holdMs. Passing operation ranges independently need start/middle/end samples with gaps <=250 ms; hold samples cannot substitute. Audio passes require actual host_listening or user_listening over the whole rendered mix. Generic visual checks cannot waive plan obligations. Video actionComplete=pass also needs actionRanges. Excerpt reviews never accept the whole asset. Formal remake final reviews additionally need passing requirementChecks. Validates evidence coverage and current binding, never judges pixels or hears sound itself.",
  },
  workspace_validate: {
    schema: z.object({ revisionId: idSchema }).strict(),
    description:
      "Read deterministic delivery checks: source ranges, discarded operation/hold frames, crop, placeholders, shot order, source-bound music cues/mix and ending duration. Returns inspection requests, plan-derived qualityReview obligations and productionScopeHash for final media_review.expectedProductionScopeHash. finalReady means technical delivery readiness; reviewAccepted separately describes optional review. Unreviewed output can be delivered. Do not run final AI review or auto-regenerate. Explicit visualKind=graphic marks intentional title/brand cards.",
  },
};
async function callProductionToolImpl(
  service: Service,
  c: Context,
  name: keyof typeof productionTools,
  raw: unknown,
): Promise<any> {
  const data: any = productionTools[name].schema.parse(raw);
  if (name === "director_case_record")
    return recordDirectorCase(service, c, data);
  if (name === "media_runtime_check") {
    await service.scoped(c, "read", async () => {});
    return mediaRuntimeCheck();
  }
  if (name === "production_scope_save")
    return saveProductionScope(service, c, data);
  if (name === "production_asset_assign")
    return assignProductionAsset(service, c, data);
  if (name === "media_inspect") return inspectMedia(service, c, data);
  if (name === "media_review") return reviewMedia(service, c, data);
  if (name === "workspace_validate")
    return validateWorkspace(service, c, data.revisionId);
  await service.scoped(
    c,
    ["production_plan_save", "generation_prepare"].includes(name)
      ? "write"
      : "read",
    async () => {},
  );
  const syntaxFor = async (modelId?: string) => {
    if (!modelId) return promptReferenceSyntax();
    const gateway = cloudConnection(service)?.gateway;
    const models = gateway
      ? await gateway.models(c)
      : service.provider.describe();
    const model = models.find((m: any) => m.id === modelId);
    if (!model)
      throw new AppError("CAPABILITY_UNAVAILABLE", "Unknown prompt model");
    return promptReferenceSyntax(model);
  };
  if (name === "generation_trace_get")
    return generationTraceGet(service, c, data.id);
  if (name === "production_method_resolve") {
    const source = data.sourceAssetId
      ? await service.get(c, "asset", data.sourceAssetId)
      : undefined;
    const subjects = await Promise.all(
      data.subjects.map((s: { assetId: string }) =>
        service.get(c, "asset", s.assetId),
      ),
    );
    const gateway = cloudConnection(service)?.gateway;
    const models = gateway
      ? await gateway.models(c)
      : service.provider.describe();
    const segments = await Promise.all(
      (data.sourceSegments ?? []).map((s: { assetId: string }) =>
        service.get(c, "asset", s.assetId),
      ),
    );
    return resolveProductionMethod(data, source, subjects, models, segments);
  }
  if (name === "video_model_resolve") {
    const assets = await Promise.all(
      data.references.map((r: { assetId: string }) =>
        service.get(c, "asset", r.assetId),
      ),
    );
    const gateway = cloudConnection(service)?.gateway;
    return resolveVideoModel(
      data,
      assets,
      gateway ? await gateway.models(c) : service.provider.describe(),
    );
  }
  if (name === "director_catalog") return directorCatalog(data);
  if (name === "generation_prompt_preview") {
    const { model, ...direction } = data;
    return compilePrompt(direction, await syntaxFor(model));
  }
  if (name === "production_plan_validate") {
    const result = validateProductionPlan(data);
    if (result.valid)
      await service.scoped(c, "read", (tx) =>
        assertEditingAssets(tx, c.accountId, result.plan),
      );
    if (result.valid && result.plan.remake)
      await service.scoped(c, "read", (tx) =>
        validateRemakeEvidence(service, tx, c.accountId, result.plan),
      );
    return { ...result, guidance: planGuidance(result.issues) };
  }
  if (name === "production_editing_preview") {
    const saved = await service.get(c, "production-plan", data.planId);
    if (saved.version !== data.expectedVersion)
      throw new AppError("PLAN_CONFLICT", "Use the current plan version", 409);
    const plan = productionPlanSchema.parse(saved.plan);
    if (data.assetId || data.assetIds) {
      if (data.revisionId || (data.assetId && data.assetIds))
        throw new AppError(
          "INVALID_INPUT",
          "Choose assembly assetId or revisionId, not both",
        );
      const asset = await Promise.all(
        (data.assetIds ?? [data.assetId]).map((id: string) =>
          service.get(c, "asset", id),
        ),
      );
      return {
        planId: saved.id,
        version: saved.version,
        projectId: saved.productionProjectId,
        composition: compositionSchema.parse(
          sourceEditComposition(plan, asset),
        ),
        rendered: false,
        next: "Assign this output to the saved scope/shot, then workspace_commit this composition. Original speed, source duration and final canvas are inherited; no fit_target.",
      };
    }
    await service.scoped(c, "read", (tx) =>
      assertEditingAssets(tx, c.accountId, plan),
    );
    const revision = data.revisionId
      ? await service.get(c, "revision", data.revisionId)
      : undefined;
    if (revision) {
      const project = await service.get(c, "project", revision.projectId);
      if (
        project.productionScope?.planId !== saved.id ||
        project.productionScope?.planVersion !== saved.version
      )
        throw new AppError(
          "PRODUCTION_SCOPE_CHANGED",
          "Choose a revision scoped to this exact plan version",
          409,
        );
    }
    if (!revision && plan.shots.some((s) => s.durationMs === undefined))
      throw new AppError(
        "TIMING_REQUIRED",
        "Supply shot durations before previewing the planned edit",
      );
    const composition = revision
      ? compositionSchema.parse(revision.composition)
      : compositionSchema.parse({
          schemaVersion: 1,
          title: plan.title,
          width: plan.width,
          height: plan.height,
          scenes: plan.shots.map((s) => ({
            id: s.id,
            productionShotId: s.id,
            durationMs: s.durationMs,
            visualKind: s.visualKind === "graphic" ? "graphic" : "placeholder",
          })),
        });
    const timeline = editingTimeline(composition);
    const syncPoints = (plan.editing?.audio?.syncPoints ?? []).map((point) => {
      const start = timeline.find((t) => t.shotId === point.shotId)?.startMs;
      const beatMs = plan.editing!.audio!.beatPoints.find(
        (b) => b.id === point.beatId,
      )?.timeMs;
      const targetMs = start === undefined ? undefined : start + point.offsetMs;
      return {
        ...point,
        targetMs,
        beatMs,
        deltaMs:
          targetMs === undefined || beatMs === undefined
            ? undefined
            : targetMs - beatMs,
      };
    });
    const assets = new Map<string, Entity>();
    if (revision)
      await service.scoped(c, "read", async (tx) => {
        const ids = new Set(
          [
            composition.audio?.assetId,
            plan.editing?.audio?.assetId,
            ...composition.scenes.flatMap((s) => [s.assetId, s.audioAssetId]),
            ...composition.events.map((e) => e.assetId),
          ].filter((id): id is string => !!id),
        );
        for (const id of ids) {
          const asset = await tx.get(id, c.accountId, "asset");
          if (asset) assets.set(id, asset);
        }
      });
    const issues = revision
      ? validateEditingComposition(plan, composition, assets)
      : syncPoints
          .filter(
            (p) =>
              p.deltaMs === undefined || Math.abs(p.deltaMs) > p.toleranceMs,
          )
          .map((p) => ({
            code: "MUSIC_SYNC_MISMATCH",
            severity: "error",
            message: `${p.description}: target ${p.targetMs} ms versus source ${p.beatMs} ms`,
          }));
    return {
      planId: saved.id,
      version: saved.version,
      revisionId: revision?.id,
      timeline,
      syncPoints,
      issues,
      valid: issues.length === 0,
      reviewObligations: productionReviewObligations(plan),
      generated: false,
      evidenceBoundary:
        "Checks declared cues and actual edit timing, never hears music or judges pixels. Changing audio bytes invalidates the cue map.",
    };
  }
  if (name === "production_shot_prompts") {
    const record = await service.get(c, "production-plan", data.planId);
    if (record.version !== data.expectedVersion)
      throw new AppError("PLAN_CONFLICT", "Use the current plan version", 409, {
        currentVersion: record.version,
        recordId: record.id,
      });
    const shot = record.plan.shots.find((s: any) => s.id === data.shotId);
    if (!shot) throw new AppError("INVALID_SHOT", "Unknown target shot");
    await service.scoped(c, "read", (tx) =>
      validateRemakeEvidence(service, tx, c.accountId, record.plan),
    );
    const direction = productionShotDirection(record.plan, shot);
    assertMethodMode(record.plan, data.mode);
    const videoSyntax = await syntaxFor(data.model);
    const imageSyntax = await syntaxFor(data.imageModel);
    if (record.plan.remake && data.camera && data.camera !== shot.camera)
      throw new AppError(
        "PLAN_DIRECTION_MISMATCH",
        "Revise the saved camera direction first",
      );
    const base = {
      subject: data.subject,
      setting: data.setting,
      camera: data.camera,
      ...direction,
    };
    const imageRefs = shot.references.filter(
      (r: any) =>
        r.usage !== "analysis_only" &&
        !["motion", "source_video", "first_frame", "last_frame"].includes(
          r.role,
        ),
    );
    const video = compilePrompt({ ...base, mode: data.mode }, videoSyntax);
    assertEditorialSeparation(record.plan, shot.id, video.prompt);
    return {
      planId: record.id,
      version: record.version,
      shotId: shot.id,
      referenceCheck: shotReferenceCheck(shot, record.plan.method),
      guidance: shotGuidance(
        record.id,
        record.version,
        shot.id,
        record.plan.method?.kind,
      ),
      qualityReviewRequired: false,
      hostInstructions: {
        directionStyle: shot.sceneDirection ? "authored_scene" : "structured",
        ...(shot.sceneDirection
          ? {
              stateContract: {
                initialState: shot.initialState,
                action: shot.action,
                actionStages: shot.actionStages ?? [],
                endState: shot.endState,
                camera: shot.camera,
              },
              directionBoundary:
                "sceneDirection is the complete visible scene, including subject, setting, timing and camera. It replaces the repeated state/action prose, not the saved contract. Check consistency before preparation; automatic validation cannot establish semantic equivalence.",
            }
          : {}),
        sourceVideo: shot.sourceVideo ?? null,
        sourceVideoWarning:
          shot.sourceShotIds?.length && !shot.sourceVideo
            ? "Source-linked shot has no explicit video-reference decision. Prefer the matching motion excerpt for action/camera remakes; otherwise record sourceVideo.strategy=reconstruct and its reason."
            : null,
        acceptanceCriteria: shot.acceptanceCriteria ?? [],
        requirementUses: shot.requirementUses ?? [],
        editing: record.plan.editing ?? null,
        evidenceBoundary:
          "These are host/editor obligations, not provider prompt text. Visual checks require actual pixels or user judgment; brightness and pixel counts cannot prove object identity, action or continuity. Encode required footage in shot states/action/generationConstraints.",
      },
      qualityReview: productionReviewObligations(record.plan, shot.id),
      ...(record.plan.remake
        ? {
            handoff: await service.scoped(c, "read", async (tx) => {
              const { report, binding } = await referenceEvidence(
                service,
                tx,
                c.accountId,
                record.plan.remake.analysisAssetId,
              );
              return {
                ...referenceHandoff(
                  report,
                  binding,
                  shot.sourceShotIds,
                  0,
                  20,
                  false,
                  data.handoffDetail,
                ),
                requirements: record.plan.remake.requirements.filter((r: any) =>
                  shot.requirementUses?.some(
                    (u: any) => u.requirementId === r.id,
                  ),
                ),
                productFacts: record.plan.remake.productFacts,
                targetNeighbors: {
                  previous: targetNeighbor(
                    record.plan.shots[record.plan.shots.indexOf(shot) - 1],
                    data.handoffDetail,
                  ),
                  next: targetNeighbor(
                    record.plan.shots[record.plan.shots.indexOf(shot) + 1],
                    data.handoffDetail,
                  ),
                },
              };
            }),
          }
        : {}),
      image:
        record.plan.method?.kind === "source_edit"
          ? null
          : compilePrompt(
              {
                ...base,
                ...productionShotDirection(record.plan, shot, "first_frame"),
                mode: imageRefs.length ? "image_edit" : "text_to_image",
              },
              imageSyntax,
            ),
      lastFrame:
        record.plan.method?.kind === "source_edit"
          ? null
          : compilePrompt(
              {
                ...base,
                ...productionShotDirection(record.plan, shot, "last_frame"),
                mode: imageRefs.length ? "image_edit" : "text_to_image",
              },
              imageSyntax,
            ),
      video,
    };
  }
  if (name === "production_plan_save") {
    const result = validateProductionPlan(data.plan);
    if (result.plan.method?.source)
      assertMethodSource(
        result.plan,
        await service.get(c, "asset", result.plan.method.source.assetId),
      );
    if (result.issues.some((i) => i.code === "REMAKE_REQUIREMENTS_REQUIRED"))
      throw new AppError(
        "REMAKE_REQUIREMENTS_REQUIRED",
        "Do not remove the source-bound remake requirements",
        409,
      );
    if (!result.valid)
      throw new AppError(
        "INVALID_PRODUCTION_PLAN",
        JSON.stringify(result.issues),
        400,
        {
          issues: result.issues.map((issue) => ({
            path: issue.shotId
              ? `shots.${result.plan.shots.findIndex((shot) => shot.id === issue.shotId)}`
              : "remake",
            code: issue.code,
            message: issue.message,
          })),
        },
      );
    for (const shot of result.plan.shots)
      for (const ref of shot.references)
        await service.get(c, "asset", ref.assetId);
    return service.scoped(c, "write", async (tx) => {
      const previous = data.planId
        ? await tx.get(data.planId, c.accountId, "production-plan")
        : undefined;
      if (previous?.plan.method && !result.plan.method)
        throw new AppError(
          "PRODUCTION_METHOD_REQUIRED",
          "Keep the selected production method when updating this plan",
          409,
        );
      if (
        data.planId &&
        (!previous || previous.version !== data.expectedVersion)
      )
        throw new AppError(
          "PLAN_CONFLICT",
          "Read the latest production plan and supply its version",
          409,
          previous
            ? { currentVersion: previous.version, recordId: previous.id }
            : undefined,
        );
      if (previous?.plan.remake && !result.plan.remake)
        throw new AppError(
          "REMAKE_REQUIREMENTS_REQUIRED",
          "A remake plan cannot silently become an unbound plan",
          409,
        );
      assertProductionQualityRetained(previous?.plan, result.plan);
      const requestBinding = data.request
        ? await bindProductionRequest(
            tx,
            c.accountId,
            result.plan,
            data.request,
          )
        : previous?.requestBinding;
      if (requestBinding)
        await validateProductionRequest(tx, c.accountId, {
          ...previous,
          plan: result.plan,
          requestBinding,
        } as Entity);
      await assertEditingAssets(tx, c.accountId, result.plan);
      if (previous?.plan.remake && result.plan.remake) {
        const { changeReason: oldReason, ...before } = previous.plan.remake;
        const { changeReason: newReason, ...after } = result.plan.remake;
        if (fingerprint(before) !== fingerprint(after) && !newReason)
          throw new AppError(
            "REMAKE_CHANGE_REASON_REQUIRED",
            "Explain the changed source, requirements, product facts, or uncertainty decisions in remake.changeReason",
            409,
          );
      }
      await validateRemakeEvidence(service, tx, c.accountId, result.plan);
      const plan = {
        id: previous?.id ?? randomUUID(),
        type: "production-plan",
        accountId: c.accountId,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        version: (previous?.version ?? 0) + 1,
        plan: result.plan,
        planHash: fingerprint(result.plan),
        ...(requestBinding ? { requestBinding } : {}),
        productionProjectId: previous?.productionProjectId ?? randomUUID(),
      };
      await syncProductionChange(service, tx, c, "plan", plan);
      await tx.put(plan);
      const existingProject = await tx.get(
        plan.productionProjectId,
        c.accountId,
        "project",
      );
      const project = {
        ...existingProject,
        id: plan.productionProjectId,
        type: "project",
        accountId: c.accountId,
        createdAt: existingProject?.createdAt ?? new Date().toISOString(),
        title: result.plan.title,
        productionScope: {
          version: (existingProject?.productionScope?.version ?? 0) + 1,
          planId: plan.id,
          planVersion: plan.version,
          requirements:
            existingProject?.productionScope?.requirements ??
            productionRequirementsSchema.parse({}),
        },
      };
      await syncProductionChange(service, tx, c, "scope", project);
      await tx.put(project);
      return {
        ...plan,
        communication: intentNotice(
          requestBinding?.userRequirements ?? [],
          result.plan.creativeChoices ?? [],
        ),
      };
    });
  }
  const input = operationSchema.parse(data.input);
  if (input.kind !== "generate")
    throw new AppError(
      "INVALID_INPUT",
      "generation_prepare accepts generate operations",
    );
  const gateway = cloudConnection(service)?.gateway;
  const result = gateway
    ? await gateway.prepare(c, data)
    : await prepareGeneration(service, c, data);
  const preparedPlan = data.plan
    ? await service.get(c, "production-plan", data.plan.planId)
    : undefined;
  const preparedShot = preparedPlan?.plan.shots.find(
    (s: { id: string }) => s.id === data.plan?.shotId,
  );
  return {
    ...result,
    ...(preparedShot
      ? {
          referenceCheck: shotReferenceCheck(
            preparedShot,
            preparedPlan?.plan.method,
          ),
        }
      : {}),
    referenceDelivery: referenceDelivery(result),
    guidance: preparedGuidance(result),
  };
}

export async function callProductionTool(
  service: Service,
  c: Context,
  name: keyof typeof productionTools,
  raw: unknown,
): Promise<any> {
  if (name === "production_plan_save")
    return tracedPreparation(service, c, raw, () =>
      callProductionToolImpl(service, c, name, raw),
    );
  return callProductionToolImpl(service, c, name, raw);
}
