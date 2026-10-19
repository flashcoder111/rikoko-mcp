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
export const productionTools = {
  production_scope_save: {
    schema: productionScopeSaveSchema,
    description:
      "Bind a project to a versioned formal target plan and review requirements. expectedScopeVersion=0 initializes; updates need the current version. No per-call disable switch. Rebinding invalidates prepared generations, asset assignments and final reviews. Synced cloud dependencies require the same cloud connection to update.",
  },
  production_asset_assign: {
    schema: productionAssetAssignSchema,
    description:
      "Assign a visually accepted asset to a formal project/scope/shot. prepared_generation requires completed output from that exact preparation; external use must be explicitly permitted by scope. Draft/experimental assets do not become formal automatically. Composition scenes must carry productionShotId.",
  },
  generation_prompt_preview: {
    schema: promptInputSchema.extend({
      model: z.string().min(1).max(120).optional(),
    }),
    description:
      "Compile a mode-specific prompt draft without calling a model. Supply target states and actual input responsibilities. Select model to use its reference syntax; omitted model uses descriptive labels only. Returns prompt, normalized direction and template/compiler versions. This draft is not submit-ready; pass direction and exact prompt to generation_prepare with the real model and references.",
  },
  generation_prepare: {
    schema: generationPrepareSchema,
    description:
      "Persist a frozen local or cloud generation request without uploading, quoting or generating. Supply input plus direction from prompt preview; plan={planId,expectedVersion,shotId,stage?} binds saved target intent; stage=video|first_frame|last_frame must match its draft and model kind. Remake prompts must match the compiled draft exactly; revise the plan instead of overriding. For other work, handwritten or changed prompts require promptOverride.reason. Returns preparedRequestId inside exact input, request hash, template/compiler versions, real provider field/array bindings, public output parameters and hashed private configuration. Pass input unchanged to quote_create/job_submit; never remove its preparation ID. Plan, asset or model changes require preparation again. Cloud returns a server-owned prepared draft without uploading; quote binds verified uploaded bytes to an immutable derivative. input.production binds the persistent project scope and requires the matching plan.",
  },
  production_plan_validate: {
    schema: productionPlanSchema,
    description:
      "Validate a host-authored target shot plan independent of source shot count/timing. Source IDs require a remake contract binding a verified Gemini recreate report/hash, preserve/adapt/free requirements and source evidence. Every remake shot needs purpose, camera, actionStages, acceptanceCriteria and mapped requirementUses. Checks requirement coverage, evidence ownership/provenance, unresolved unknowns and persistent object states across cuts; unknown states and explained time jumps are supported. Returns issues, never invokes an AI director.",
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
      })
      .strict(),
    description:
      "Compile image and video prompt drafts directly from a saved target plan's initial/action/end states and reference responsibilities. Version and source evidence checked; no generation. For remakes also returns the relevant Gemini handoff, requirements and target neighbors. Returns first-frame and end-state image descriptions plus the mode-specific video prompt. Host supplies actual first/last frame references in the plan when using those modes.",
  },
  production_plan_save: {
    schema: z
      .object({
        plan: productionPlanSchema,
        planId: idSchema.optional(),
        expectedVersion: z.number().int().positive().optional(),
      })
      .strict(),
    description:
      "Save a validated target production plan, with independent shot IDs, desired states and explicit reference responsibilities. Updating requires planId and expectedVersion; changing remake source/requirements/product facts/unknown decisions also needs remake.changeReason. Existing remake contracts cannot be removed. Creates a default scoped project returned as productionProjectId; plan preparations inherit its scope and dimensions. Validation does not certify semantic fidelity. No model call.",
  },
  media_inspect: {
    schema: inspectSchema,
    description:
      "Extract native MCP images/grid and persist hash-bound inspection evidence from an owned image/video. Use count (default 3, max 12) for uniform samples OR ordered timesMs (max 12) for key action events within startMs/endMs. Times are requested seeks, not verified frame PTS; unsampled intervals remain unknown. For action review inspect critical intervals with gaps <=250 ms, using multiple bounded calls as needed. claimedStatic checks differences, never proves no motion. Local FFmpeg, no model call. Inspect pixels before media_review.",
  },
  media_review: {
    schema: mediaReviewSchema,
    description:
      "Record visual judgment with checks={actionComplete,framing,continuity,noArtifacts}; each check is {status:pass|fail|unknown|not_applicable,reason?}, with reason required except pass. Legacy booleans remain inputs, never exempt from evidence checks. Use decision=unreviewed with unknown checks and no inspections when unable to see. Acceptance requires matching inspectionIds, applicable passes and notes. Video actionComplete=pass requires declared actionRanges [{startMs,endMs,reason}] with samples <=250 ms apart; three overall frames alone do not establish a completed action. Optional range reviews an excerpt, never the whole asset. revisionId requires full rendered-output review. Historical accepted records need v2 re-review before final delivery. Formal remake revision acceptance also requires requirementChecks=[{requirementId,status:pass|fail|unknown,reason}] with every preserve/adapt requirement passing. Unknown/failed requirements block final acceptance. This tool validates evidence coverage, not visual correctness.",
  },
  workspace_validate: {
    schema: z.object({ revisionId: idSchema }).strict(),
    description:
      "Read deterministic delivery checks: source ranges, discarded tails, cover crop fractions, unresolved placeholders, and revision-bound review state. Returns media_inspect requests for each scene. A completed render is unreviewed until the host inspects and accepts it. Explicit visualKind=graphic marks intentional title/brand cards.",
  },
};
export async function callProductionTool(
  service: Service,
  c: Context,
  name: keyof typeof productionTools,
  raw: unknown,
): Promise<any> {
  const data: any = productionTools[name].schema.parse(raw);
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
  if (name === "generation_prompt_preview") {
    const { model, ...direction } = data;
    return compilePrompt(direction, await syntaxFor(model));
  }
  if (name === "production_plan_validate") {
    const result = validateProductionPlan(data);
    if (result.valid && result.plan.remake)
      await service.scoped(c, "read", (tx) =>
        validateRemakeEvidence(service, tx, c.accountId, result.plan),
      );
    return result;
  }
  if (name === "production_shot_prompts") {
    const record = await service.get(c, "production-plan", data.planId);
    if (record.version !== data.expectedVersion)
      throw new AppError("PLAN_CONFLICT", "Use the current plan version", 409);
    const shot = record.plan.shots.find((s: any) => s.id === data.shotId);
    if (!shot) throw new AppError("INVALID_SHOT", "Unknown target shot");
    await service.scoped(c, "read", (tx) =>
      validateRemakeEvidence(service, tx, c.accountId, record.plan),
    );
    const direction = productionShotDirection(record.plan, shot);
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
    return {
      planId: record.id,
      version: record.version,
      shotId: shot.id,
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
                ),
                requirements: record.plan.remake.requirements.filter((r: any) =>
                  shot.requirementUses?.some(
                    (u: any) => u.requirementId === r.id,
                  ),
                ),
                productFacts: record.plan.remake.productFacts,
                targetNeighbors: {
                  previous:
                    record.plan.shots[record.plan.shots.indexOf(shot) - 1] ??
                    null,
                  next:
                    record.plan.shots[record.plan.shots.indexOf(shot) + 1] ??
                    null,
                },
              };
            }),
          }
        : {}),
      image: compilePrompt(
        {
          ...base,
          ...productionShotDirection(record.plan, shot, "first_frame"),
          mode: imageRefs.length ? "image_edit" : "text_to_image",
        },
        imageSyntax,
      ),
      lastFrame: compilePrompt(
        {
          ...base,
          ...productionShotDirection(record.plan, shot, "last_frame"),
          mode: imageRefs.length ? "image_edit" : "text_to_image",
        },
        imageSyntax,
      ),
      video: compilePrompt({ ...base, mode: data.mode }, videoSyntax),
    };
  }
  if (name === "production_plan_save") {
    const result = validateProductionPlan(data.plan);
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
      );
    for (const shot of result.plan.shots)
      for (const ref of shot.references)
        await service.get(c, "asset", ref.assetId);
    return service.scoped(c, "write", async (tx) => {
      const previous = data.planId
        ? await tx.get(data.planId, c.accountId, "production-plan")
        : undefined;
      if (
        data.planId &&
        (!previous || previous.version !== data.expectedVersion)
      )
        throw new AppError(
          "PLAN_CONFLICT",
          "Read the latest production plan and supply its version",
          409,
        );
      if (previous?.plan.remake && !result.plan.remake)
        throw new AppError(
          "REMAKE_REQUIREMENTS_REQUIRED",
          "A remake plan cannot silently become an unbound plan",
          409,
        );
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
      return plan;
    });
  }
  const input = operationSchema.parse(data.input);
  if (input.kind !== "generate")
    throw new AppError(
      "INVALID_INPUT",
      "generation_prepare accepts generate operations",
    );
  const gateway = cloudConnection(service)?.gateway;
  if (!gateway) return prepareGeneration(service, c, data);
  return gateway.prepare(c, data);
}
