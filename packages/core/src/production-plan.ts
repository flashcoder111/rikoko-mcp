import { z } from "zod";
import type { ReferenceReport } from "../../contracts/src/reference-analysis.js";
import { sourceTimelineDirection } from "./source-timeline.js";
import { creativeChoiceSchema } from "./production-intent.js";
import {
  productionMethodSchema,
  methodPlanIssues,
  methodDirection,
} from "./production-method.js";
import {
  referenceChoiceSchema,
  shotReferenceCheck,
} from "./shot-reference-choice.js";
import {
  imageDirectorKitSchema,
  videoDirectorKitSchema,
} from "./director-kits.js";
import { AppError, idSchema } from "../../contracts/src/index.js";
import {
  promptReferenceSchema,
  promptInputSchema,
  productionStateSchema,
} from "./production-prompts.js";
import {
  remakeSchema,
  requirementUseSchema,
} from "../../contracts/src/remake.js";
import {
  productionProcessSchema,
  processShotSchema,
  processShotDirection,
  validateProductionProcess,
} from "./production-process.js";
import {
  productionEditingSchema,
  validateProductionEditing,
  editingShotDirection,
} from "./production-editing.js";
const state = productionStateSchema;
export const productionPlanSchema = z
  .object({
    creativeChoices: z.array(creativeChoiceSchema).max(30).optional(),
    title: z.string().min(1).max(160),
    width: z.number().int().min(144).max(1920),
    height: z.number().int().min(144).max(1920),
    method: productionMethodSchema.optional(),
    remake: remakeSchema.optional(),
    process: productionProcessSchema.optional(),
    editing: productionEditingSchema.optional(),
    shots: z
      .array(
        z
          .object({
            id: idSchema,
            visualKind: z.enum(["media", "graphic"]).default("media"),
            sourceShotIds: z.array(idSchema).max(20).default([]),
            sourceShotDirections: z
              .array(
                z
                  .object({
                    sourceShotId: idSchema,
                    direction: z.string().trim().min(1).max(600),
                    referenceAssetIds: z.array(idSchema).max(12).default([]),
                  })
                  .strict(),
              )
              .min(1)
              .max(20)
              .optional(),
            referenceChoice: referenceChoiceSchema.optional(),
            sourceVideo: z
              .discriminatedUnion("strategy", [
                z
                  .object({
                    strategy: z.literal("reference"),
                    assetId: idSchema,
                  })
                  .strict(),
                z
                  .object({
                    strategy: z.literal("reconstruct"),
                    reason: z.string().trim().min(1).max(1000),
                  })
                  .strict(),
              ])
              .optional(),
            purpose: z.string().trim().min(1).max(1000).optional(),
            actionStages: z
              .array(z.string().trim().min(1).max(400))
              .max(16)
              .optional(),
            camera: z.string().trim().min(1).max(1000).optional(),
            acceptanceCriteria: z
              .array(z.string().trim().min(1).max(500))
              .max(20)
              .optional(),
            generationConstraints: z
              .array(z.string().trim().min(1).max(500))
              .max(20)
              .optional(),
            productFactIndices: z
              .array(z.number().int().nonnegative())
              .max(30)
              .optional(),
            requirementUses: z.array(requirementUseSchema).max(50).optional(),
            process: processShotSchema.optional(),
            promptKits: z
              .object({
                image: imageDirectorKitSchema.optional(),
                video: videoDirectorKitSchema.optional(),
              })
              .strict()
              .optional(),
            initialState: state,
            action: z.string().min(1).max(1500),
            sceneDirection: promptInputSchema.shape.sceneDirection,
            endState: state,
            transition: z
              .enum(["continuous", "time_jump", "independent"])
              .default("continuous"),
            transitionReason: z.string().min(1).max(1000).optional(),
            references: z.array(promptReferenceSchema).max(12).default([]),
            durationMs: z.number().int().min(100).max(600000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type ProductionPlan = z.infer<typeof productionPlanSchema>;
export function validateProductionPlan(raw: unknown) {
  const plan = productionPlanSchema.parse(raw);
  const processValidation = validateProductionProcess(plan);
  const issues: {
    code: string;
    shotId: string;
    object?: string;
    message: string;
  }[] = [
    ...processValidation.issues,
    ...validateProductionEditing(plan),
    ...methodPlanIssues(plan),
  ];
  const ids = new Set<string>();
  const known: Record<string, string> = Object.create(null);
  for (const shot of plan.shots) {
    if (ids.has(shot.id))
      issues.push({
        code: "DUPLICATE_SHOT",
        shotId: shot.id,
        message: "Target shot IDs must be unique",
      });
    ids.add(shot.id);
    const videoRefs = shot.references.filter(
      (ref) =>
        ref.usage !== "analysis_only" &&
        ["motion", "source_video"].includes(ref.role),
    );
    const sourceVideo = shot.sourceVideo;
    if (
      (sourceVideo?.strategy === "reference" &&
        !videoRefs.some((ref) => ref.assetId === sourceVideo.assetId)) ||
      (sourceVideo?.strategy === "reconstruct" && videoRefs.length > 0)
    )
      issues.push({
        code: "SOURCE_VIDEO_STRATEGY_MISMATCH",
        shotId: shot.id,
        message:
          "A reference strategy must bind its actual motion/source_video asset for generation; reconstruction must explain the omission and must not claim to send video.",
      });
    if (shot.transition !== "continuous") {
      if (!shot.transitionReason)
        issues.push({
          code: "TRANSITION_REASON_REQUIRED",
          shotId: shot.id,
          message: "Explain off-screen changes or independent scenes",
        });
      for (const key of Object.keys(known)) delete known[key];
    }
    for (const [object, value] of Object.entries(shot.initialState)) {
      if (
        known[object] &&
        value !== "unknown" &&
        known[object] !== "unknown" &&
        known[object] !== value
      )
        issues.push({
          code: "STATE_DISCONTINUITY",
          shotId: shot.id,
          object,
          message: `Previous end: ${known[object]}; next start: ${value}`,
        });
    }
    Object.assign(known, shot.initialState, shot.endState);
  }
  for (const shot of plan.shots) {
    const directions = shot.sourceShotDirections;
    if (!directions) continue;
    const ids = new Set(directions.map((d) => d.sourceShotId));
    if (
      !plan.method?.source ||
      ids.size !== directions.length ||
      ids.size !== shot.sourceShotIds.length ||
      shot.sourceShotIds.some((id) => !ids.has(id)) ||
      directions.some((d) =>
        d.referenceAssetIds.some(
          (id) =>
            !shot.references.some(
              (r) =>
                r.assetId === id &&
                r.usage !== "analysis_only" &&
                !["motion", "source_video"].includes(r.role),
            ),
        ),
      )
    )
      issues.push({
        code: "SOURCE_SHOT_DIRECTION_INVALID",
        shotId: shot.id,
        message:
          "Map every source shot once and use only this shot's actual visual references.",
      });
  }
  if (plan.remake) {
    const requirements = new Map(
      plan.remake.requirements.map((r) => [r.id, r]),
    );
    if (requirements.size !== plan.remake.requirements.length)
      issues.push({
        code: "DUPLICATE_REQUIREMENT",
        shotId: "",
        message: "Requirement IDs must be unique",
      });
    const covered = new Set<string>();
    const mappedSources = new Map<string, Set<string>>();
    for (const shot of plan.shots) {
      const factIndices = shot.productFactIndices ?? [];
      if (
        new Set(factIndices).size !== factIndices.length ||
        factIndices.some((index) => index >= plan.remake!.productFacts.length)
      )
        issues.push({
          code: "REMAKE_PRODUCT_FACT_INVALID",
          shotId: shot.id,
          message: "Select each existing product fact index at most once",
        });
      if (
        !shot.purpose ||
        !shot.camera ||
        !shot.acceptanceCriteria?.length ||
        !shot.actionStages
      )
        issues.push({
          code: "REMAKE_SHOT_DIRECTION_REQUIRED",
          shotId: shot.id,
          message:
            "Supply purpose, camera, actionStages (empty for a hold), and acceptanceCriteria",
        });
      const seenUses = new Set<string>();
      for (const use of shot.requirementUses ?? []) {
        const requirement = requirements.get(use.requirementId);
        if (!requirement || seenUses.has(use.requirementId)) {
          issues.push({
            code: "REMAKE_REQUIREMENT_INVALID",
            shotId: shot.id,
            message: "Use each known requirement at most once per shot",
          });
          continue;
        }
        seenUses.add(use.requirementId);
        covered.add(use.requirementId);
        const mapped = mappedSources.get(requirement.id) ?? new Set<string>();
        for (const id of shot.sourceShotIds) mapped.add(id);
        mappedSources.set(requirement.id, mapped);
        if (requirement.mode === "adapt" && !use.changeReason)
          issues.push({
            code: "REMAKE_ADAPTATION_REASON_REQUIRED",
            shotId: shot.id,
            message: `Explain how and why ${requirement.id} changes`,
          });
        if (
          requirement.origin === "reference" &&
          !requirement.sourceShotIds.some((id) =>
            shot.sourceShotIds.includes(id),
          )
        )
          issues.push({
            code: "REMAKE_SOURCE_MAPPING_REQUIRED",
            shotId: shot.id,
            message: `Include a source shot supporting ${requirement.id}`,
          });
      }
    }
    for (const requirement of requirements.values()) {
      if (requirement.mode !== "free" && !covered.has(requirement.id))
        issues.push({
          code: "REMAKE_REQUIREMENT_UNCOVERED",
          shotId: "",
          message: `Map ${requirement.id} to a target shot`,
        });
      else if (
        requirement.mode !== "free" &&
        requirement.origin === "reference" &&
        !requirement.sourceShotIds.every((id) =>
          mappedSources.get(requirement.id)?.has(id),
        )
      )
        issues.push({
          code: "REMAKE_SOURCE_MAPPING_REQUIRED",
          shotId: "",
          message: `Cover all source shots supporting ${requirement.id} across its target shots`,
        });
    }
  } else if (
    plan.shots.some(
      (s) =>
        s.requirementUses?.length ||
        s.sourceShotIds.length ||
        s.productFactIndices?.length,
    )
  ) {
    issues.push({
      code: "REMAKE_REQUIREMENTS_REQUIRED",
      shotId: "",
      message:
        "Source-shot claims, product fact selections and requirement uses need a source-bound remake plan",
    });
  }
  return {
    plan,
    issues,
    recommendations: processValidation.recommendations,
    referenceChecks: plan.shots
      .filter((shot) => shot.visualKind === "media")
      .map((shot) => ({
        shotId: shot.id,
        ...shotReferenceCheck(shot, plan.method),
      })),
    valid: issues.length === 0,
    evidenceBoundary:
      "Checks declared continuity, process preconditions/effects, action budgets, editing intent and requirement coverage. The host must inspect actual frames and listen to audio to judge physical plausibility, timing and quality.",
  };
}

/** Shared by prompt drafting and preparation; target intent is compiled once and cannot be omitted. */
export function productionShotDirection(
  plan: ProductionPlan,
  shot: ProductionPlan["shots"][number],
  stage: "video" | "first_frame" | "last_frame" = "video",
  report?: ReferenceReport,
) {
  if (plan.method?.kind === "source_edit" && stage === "video")
    return {
      sceneDirection: [
        methodDirection(plan.method),
        sourceTimelineDirection(plan, shot, report),
        shot.sceneDirection?.startsWith(methodDirection(plan.method))
          ? shot.sceneDirection
              .slice(methodDirection(plan.method).length)
              .trim()
          : shot.sceneDirection,
        ...(shot.generationConstraints ?? []),
        ...(shot.actionStages ?? []).map(
          (action) => `Target action: ${action}`,
        ),
        ...(shot.camera ? [`Target camera: ${shot.camera}`] : []),
        editingShotDirection(plan, shot.id, true),
      ]
        .filter(Boolean)
        .join("\n"),
      action: plan.method.change,
      initialState: shot.initialState,
      endState: shot.endState,
      references: shot.references,
    };
  const authored =
    plan.method ||
    shot.purpose ||
    shot.actionStages ||
    shot.acceptanceCriteria ||
    shot.generationConstraints ||
    plan.remake;
  const productFacts = plan.remake?.productFacts ?? [];
  const selectedProductFacts =
    shot.productFactIndices?.map((index) => productFacts[index]) ??
    productFacts;
  const process = processShotDirection(plan, shot, stage);
  const editing =
    stage === "video"
      ? editingShotDirection(plan, shot.id, !!shot.sceneDirection)
      : undefined;
  const constraints = authored
    ? [
        // Review requirements and editorial intent remain in the plan and host response.
        // Only deliberately authored on-screen constraints belong in provider prompts.
        ...(plan.method && plan.method.kind !== "adaptation"
          ? [methodDirection(plan.method)]
          : []),
        ...(shot.generationConstraints ?? []),
        // Omission preserves existing plans. An explicit selection projects
        // only relevant facts; [] leaves their application to shot-local states
        // and requirements while retaining every fact in the canonical plan.
        ...selectedProductFacts.map((x) => `Target product fact: ${x}`),
      ]
        .filter(Boolean)
        .join("\n")
    : undefined;
  return {
    // Always bind absence too: a caller must not inject prose that replaces
    // the saved states/action, including through a boundary-image draft.
    sceneDirection: stage === "video" ? shot.sceneDirection : undefined,
    action:
      stage === "first_frame"
        ? "Depict the state before the main action begins"
        : stage === "last_frame"
          ? "Depict the completed action's final state"
          : shot.action +
            (shot.actionStages?.length
              ? `\nOrdered action stages: ${shot.actionStages.map((x, i) => `${i + 1}. ${x}`).join("; ")}`
              : ""),
    initialState: stage === "last_frame" ? shot.endState : shot.initialState,
    endState: stage === "first_frame" ? shot.initialState : shot.endState,
    ...(shot.promptKits
      ? {
          directorKit:
            stage === "video" ? shot.promptKits.video : shot.promptKits.image,
        }
      : {}),
    references:
      stage === "video"
        ? shot.references
        : shot.references.filter(
            (r) =>
              r.usage !== "analysis_only" &&
              !["motion", "source_video", "first_frame", "last_frame"].includes(
                r.role,
              ),
          ),
    ...(authored
      ? { camera: shot.camera, constraints: constraints || undefined }
      : {}),
    ...(process ? { process } : {}),
    ...(editing ? { editing } : {}),
  };
}

/** Do not silently rewrite mixed editorial/generation prose; make the host fix its plan. */
export function assertEditorialSeparation(
  plan: ProductionPlan,
  shotId: string,
  prompt: string,
) {
  const ending = plan.editing?.ending;
  if (!ending?.shotIds.includes(shotId)) return;
  const copy = [ending.brandText, ending.cta].filter(
    (value): value is string => !!value?.trim(),
  );
  const containsCopy = copy.some((value) => {
    const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
      "iu",
    ).test(prompt);
  });
  if (containsCopy)
    throw new AppError(
      "EDITORIAL_COPY_IN_GENERATION",
      "This shot's provider prompt contains text reserved for an editorial overlay. Move that copy to editing. Revise the saved shot action/camera/references or generationConstraints to describe only footage, then recompile and prepare. Keep acceptanceCriteria and remake requirements in the plan.",
      409,
      {
        stage: "provider_prompt",
        issues: [
          {
            path: shotId,
            code: "EDITORIAL_COPY_IN_GENERATION",
            message:
              "Revise the saved shot with production_plan_save; preserve editorial copy in editing and review criteria in the plan.",
          },
        ],
      },
    );
}
