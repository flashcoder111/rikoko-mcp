import { z } from "zod";
import { AppError } from "../../contracts/src/index.js";
import type { ProductionPlan } from "./production-plan.js";

/** Host decisions and inspection results, never provider prompt text. */
export const referenceChoiceSchema = z
  .object({
    strategy: z.enum(["motion_reference", "stage_first_frame", "direct"]),
    reason: z.string().trim().min(1).max(240),
  })
  .strict();

const stateCheck = z
  .object({
    status: z.enum(["pass", "fail", "unknown", "not_applicable"]),
    reason: z.string().trim().min(1).max(240),
  })
  .strict();
export const startingStateChecksSchema = z
  .object({
    stage: stateCheck,
    count: stateCheck,
    arrangement: stateCheck,
    support: stateCheck,
  })
  .strict();

type Shot = ProductionPlan["shots"][number];
export function requiresStartingStateReview(
  shot: Shot | undefined,
  assetId: string,
) {
  return (
    shot?.referenceChoice?.strategy === "stage_first_frame" &&
    shot.references.some(
      (r) =>
        r.role === "first_frame" &&
        r.usage !== "analysis_only" &&
        r.assetId === assetId,
    )
  );
}

export function shotReferenceCheck(
  shot: Shot,
  method?: ProductionPlan["method"],
) {
  const refs = shot.references.filter((r) => r.usage !== "analysis_only");
  return {
    choice: shot.referenceChoice ?? null,
    status: method
      ? "inherited_method"
      : shot.referenceChoice
        ? "recorded"
        : "choose_before_generation",
    ...(method ? { method: method.kind } : {}),
    firstFrameAssetIds: refs
      .filter((r) => r.role === "first_frame")
      .map((r) => r.assetId),
    motionAssetIds: refs
      .filter((r) => ["motion", "source_video"].includes(r.role))
      .map((r) => r.assetId),
    decision: method
      ? "Inherit the saved production method. Do not select a new route independently for this shot."
      : shot.referenceChoice
        ? "Use the recorded route; revise the plan if inputs change."
        : "Choose motion_reference for motion transfer, stage_first_frame when starting state needs a visual anchor, or direct when existing inputs suffice. Save referenceChoice with a short reason.",
    ...(shot.referenceChoice?.strategy === "stage_first_frame"
      ? {
          startingStateReview: {
            expectedState: shot.initialState,
            checks: ["stage", "count", "arrangement", "support"],
            instruction:
              "Inspect the existing or generated first frame once. Record startingStateChecks with the shot's production binding; check support and room for the next action. Reuse unchanged accepted evidence.",
          },
        }
      : {}),
    imageGenerationRequired: false,
  };
}

export function assertShotReferenceChoice(shot: Shot, mode?: string) {
  const choice = shot.referenceChoice?.strategy;
  if (!choice) return; // Historical plans remain usable.
  const refs = shot.references.filter((r) => r.usage !== "analysis_only");
  const motion = refs.some((r) => ["motion", "source_video"].includes(r.role));
  const first = refs.some((r) => r.role === "first_frame");
  const matches =
    choice === "stage_first_frame"
      ? first && ["image_to_video", "first_last_frame"].includes(mode ?? "")
      : choice === "motion_reference"
        ? motion &&
          [
            "reference_to_video",
            "motion_transfer",
            "camera_transfer",
            "video_to_video",
          ].includes(mode ?? "")
        : !motion && !first;
  if (!matches)
    throw new AppError(
      "SHOT_REFERENCE_CHOICE_MISMATCH",
      "The saved referenceChoice must match the actual video mode and generation references. Reuse a suitable existing frame or revise the choice; generating an image is not mandatory.",
      409,
      {
        stage: "shot_reference_choice",
        issues: [
          {
            path: `shots.${shot.id}.referenceChoice`,
            code: "SHOT_REFERENCE_CHOICE_MISMATCH",
            message: `${choice} does not match ${mode ?? "unspecified mode"} and its references`,
          },
        ],
      },
    );
}

export function startingStateAccepted(value: unknown) {
  const result = startingStateChecksSchema.safeParse(value);
  return (
    result.success &&
    result.data.stage.status === "pass" &&
    result.data.arrangement.status === "pass" &&
    [result.data.count, result.data.support].every((check) =>
      ["pass", "not_applicable"].includes(check.status),
    )
  );
}
