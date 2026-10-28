import {
  directorKnowledge,
  type DirectorExcerpt,
} from "../../guidance/src/director.js";
import { createHash } from "node:crypto";
import type { ProductionPlan } from "./production-plan.js";
import type { Service } from "./index.js";
import type { Context, Entity } from "../../contracts/src/index.js";
/** Read-only suggestions derived from records. Never grant authorization or execute work. */
export async function directorGuidance(
  stage:
    | "request"
    | "analysis"
    | "plan"
    | "shot"
    | "prepared"
    | "material"
    | "final"
    | "resume",
  context: {
    plan?: ProductionPlan;
    shotId?: string;
    guideVersion?: string;
    basedOn?: Record<string, unknown>;
    blockers?: Issue[];
    unresolvedRelations?: boolean;
    image?: boolean;
    modelId?: string;
    mode?: string;
  } = {},
) {
  const { plan } = context;
  const keys: DirectorExcerpt[] = [];
  if ((stage === "request" || stage === "plan") && !plan?.treatment)
    keys.push("intent");
  if (stage === "analysis") keys.push("reference");
  if (stage === "plan" && !plan?.method) keys.push("method");
  if (stage === "shot" || stage === "prepared") {
    keys.push(context.image ? "image" : "preparation");
    if (context.unresolvedRelations) keys.push("performance");
  }
  // Supply picture-making knowledge while authoring, before any output exists.
  if (["request", "plan", "shot"].includes(stage) && !keys.includes("image"))
    keys.push("image");
  if (stage === "material") keys.push("quality");
  if (stage === "final") keys.push("review");
  if (["plan", "final"].includes(stage) && plan?.editing)
    keys.push("sound_text");
  const knowledge = await directorKnowledge(keys, {
    ...plan?.knowledge,
    ...(context.modelId ? { modelId: context.modelId } : {}),
    ...(context.mode ? { mode: context.mode } : {}),
  });
  const basedOn = {
    ...context.basedOn,
    ...(context.shotId ? { shotId: context.shotId } : {}),
  };
  return {
    stage,
    ...knowledge,
    basedOn,
    // Identical evidence/intent yields the same key. Clients can reuse resolved work.
    decisionKey: createHash("sha256")
      .update(
        JSON.stringify({
          stage,
          basedOn,
          plan,
          keys,
          version: knowledge.guideVersion,
          selection: knowledge.readingPath.selection,
        }),
      )
      .digest("hex"),
    treatment: plan?.treatment ?? null,
    creativeChoices: plan?.creativeChoices ?? [],
    shotPurpose:
      plan?.shots.find((s) => s.id === context.shotId)?.purpose ?? null,
    blockers: context.blockers ?? [],
    decisions: keys.map((key) => ({
      kind: "creative_choice" as const,
      topic: key,
      owner: "host_agent" as const,
    })),
    boundGuideVersion: context.guideVersion ?? null,
    knowledgeChanged:
      !!context.guideVersion && context.guideVersion !== knowledge.guideVersion,
    versionBoundary:
      "Current guidance does not rewrite accepted plans or frozen paid inputs. Retain their bound version; revise and prepare explicitly if the work changes.",
  };
}

export async function completedJobGuidance(
  service: Service,
  c: Context,
  job: Entity,
) {
  if (
    job.status !== "completed" ||
    !["generate", "reference_analyze"].includes(job.input?.kind)
  )
    return undefined;
  const preparation = job.input.preparedRequestId
    ? await service.scoped(c, "read", (tx) =>
        tx.get(
          job.input.preparedRequestId,
          c.accountId,
          "generation-preparation",
        ),
      )
    : undefined;
  return directorGuidance(
    job.input.kind === "reference_analyze" ? "analysis" : "material",
    {
      plan: preparation?.plan?.directorIntent,
      shotId: preparation?.plan?.shotId,
      guideVersion:
        preparation?.plan?.guideVersion ?? preparation?.guideVersion,
      basedOn: {
        jobId: job.id,
        outputAssetIds: job.outputs,
        preparedRequestId: preparation?.id,
        planId: preparation?.plan?.planId,
        planVersion: preparation?.plan?.expectedVersion,
      },
      modelId: preparation?.input?.model,
      mode: preparation?.input?.mode ?? preparation?.prompt?.direction?.mode,
    },
  );
}
type Issue = { code: string; message: string; shotId?: string };
type Suggestion = { tool: string; reason: string };
const creativeChoice = {
  kind: "creative_choice" as const,
  question:
    "First resolve whether the source is the material to edit, temporal evidence to transfer, or inspiration to reinterpret. Inherit that production method; do not redesign preserved actions, camera or timing.",
};
export function planGuidance(issues: Issue[]) {
  return {
    stage: "target_planning",
    blockers: issues,
    decisions: [creativeChoice],
    suggestions: issues.length
      ? []
      : [
          {
            tool: "production_plan_save",
            reason:
              "Save this target if it expresses your chosen direction; structural validity is not a visual judgment.",
          },
        ],
    guideTopics: ["video-direction"],
    basedOn: { source: "submitted_plan" },
  };
}
export function shotGuidance(
  planId: string,
  planVersion: number,
  shotId: string,
  method?: string,
) {
  return {
    stage: "shot_preparation",
    blockers: [],
    decisions: [
      {
        kind: "creative_choice",
        question: method
          ? `Inherit the saved ${method} method and its actual inputs. Do not choose a different route or create a first frame for source editing.`
          : "Read referenceCheck: choose this shot's reference route and verify its starting state before video preparation. Reuse suitable inputs; image generation is not mandatory.",
      },
    ],
    suggestions: [
      {
        tool: "generation_prepare",
        reason:
          "Prepare the chosen image/video stage with its exact compiled prompt and direction; this does not submit generation.",
      },
    ],
    guideTopics: ["video-direction"],
    basedOn: { planId, planVersion, shotId },
  };
}
export function preparedGuidance(result: {
  preparedRequestId?: string;
  requestHash?: string;
  readyForSubmission?: boolean;
}) {
  return {
    stage: "generation_prepared",
    blockers: [],
    decisions: [],
    suggestions:
      result.readyForSubmission === true
        ? [
            {
              tool: "job_submit",
              reason:
                "Only submit the unchanged prepared input when requested by the user and within scope/budget; this suggestion is not authorization.",
            },
          ]
        : [],
    guideTopics: ["video-direction"],
    basedOn: {
      preparedRequestId: result.preparedRequestId,
      requestHash: result.requestHash,
    },
  };
}
export function snapshotGuidance(
  project: { id: string },
  revision: { id: string } | null | undefined,
  jobs: { id: string; revisionId?: string; status?: string }[],
  latest: { id: string } | null | undefined = revision,
) {
  const relevant = jobs.filter((j) => j.revisionId === latest?.id);
  const historical = revision?.id !== latest?.id;
  const suggestions: Suggestion[] = historical
    ? [
        {
          tool: "workspace_snapshot",
          reason:
            "You inspected a historical revision. Read the current head before deciding how to edit; never replay old composition over newer changes.",
        },
      ]
    : revision
      ? [
          {
            tool: "workspace_commit",
            reason:
              "Apply requested edits against the current head revision, reusing accepted assets.",
          },
        ]
      : [
          {
            tool: "production_method_resolve",
            reason:
              "Before choosing models or authoring shots, resolve the input relationship from the brief. Source editing inherits the original timeline; reinterpretation authors new shots.",
          },
        ];
  if (relevant.length)
    suggestions.unshift({
      tool: "workspace_result",
      reason:
        "Read existing render jobs before another write; status and technical delivery readiness remain authoritative.",
    });
  return {
    stage: revision ? "existing_edit" : "target_planning",
    blockers: [],
    decisions: revision ? [] : [creativeChoice],
    suggestions,
    guideTopics: revision ? ["media-operations"] : ["video-direction"],
    basedOn: {
      projectId: project.id,
      revisionId: latest?.id,
      inspectedRevisionId: revision?.id,
      headRevisionId: latest?.id,
      jobIds: relevant.map((j) => j.id),
    },
  };
}
