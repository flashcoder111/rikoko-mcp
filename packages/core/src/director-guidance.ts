/** Read-only suggestions derived from records. Never grant authorization or execute work. */
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
