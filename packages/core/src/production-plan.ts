import { z } from "zod";
import { idSchema } from "../../contracts/src/index.js";
import {
  promptReferenceSchema,
  productionStateSchema,
} from "./production-prompts.js";
import {
  remakeSchema,
  requirementUseSchema,
} from "../../contracts/src/remake.js";
const state = productionStateSchema;
export const productionPlanSchema = z
  .object({
    title: z.string().min(1).max(160),
    width: z.number().int().min(144).max(1920),
    height: z.number().int().min(144).max(1920),
    remake: remakeSchema.optional(),
    shots: z
      .array(
        z
          .object({
            id: idSchema,
            visualKind: z.enum(["media", "graphic"]).default("media"),
            sourceShotIds: z.array(idSchema).max(20).default([]),
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
            requirementUses: z.array(requirementUseSchema).max(50).optional(),
            initialState: state,
            action: z.string().min(1).max(1500),
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
  const issues: {
    code: string;
    shotId: string;
    object?: string;
    message: string;
  }[] = [];
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
    plan.shots.some((s) => s.requirementUses?.length || s.sourceShotIds.length)
  ) {
    issues.push({
      code: "REMAKE_REQUIREMENTS_REQUIRED",
      shotId: "",
      message:
        "Source-shot claims and requirement uses need a source-bound remake plan",
    });
  }
  return {
    plan,
    issues,
    valid: issues.length === 0,
    evidenceBoundary:
      "Checks declared continuity and requirement coverage, not semantic fidelity or visual quality. The host must inspect actual frames and judge physical plausibility.",
  };
}

/** Shared by prompt drafting and preparation; target intent is compiled once and cannot be omitted. */
export function productionShotDirection(
  plan: ProductionPlan,
  shot: ProductionPlan["shots"][number],
  stage: "video" | "first_frame" | "last_frame" = "video",
) {
  const authored =
    shot.purpose || shot.actionStages || shot.acceptanceCriteria || plan.remake;
  const uses = shot.requirementUses ?? [];
  const constraints = authored
    ? [
        ...(stage === "video"
          ? [
              shot.purpose && `Shot purpose: ${shot.purpose}`,
              ...(shot.acceptanceCriteria ?? []).map(
                (x, i) => `Acceptance ${i + 1}: ${x}`,
              ),
              ...uses.map((use) => {
                const r = plan.remake?.requirements.find(
                  (r) => r.id === use.requirementId,
                );
                return (
                  r &&
                  `${r.mode === "preserve" ? "Preserve" : r.mode === "adapt" ? "Adapt" : "Creative choice"}: ${r.description}. Target application: ${use.application}${use.changeReason ? `. Change reason: ${use.changeReason}` : ""}`
                );
              }),
            ]
          : []),
        ...(plan.remake?.productFacts ?? []).map(
          (x) => `Target product fact: ${x}`,
        ),
      ]
        .filter(Boolean)
        .join("\n")
    : undefined;
  return {
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
  };
}
