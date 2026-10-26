import { z } from "zod";
import { directorKitSchema, renderDirectorKit } from "./director-kits.js";
import { AppError, idSchema } from "../../contracts/src/index.js";
import { referenceRoleSchema } from "../../contracts/src/generation.js";
import {
  referenceToken,
  type PromptReferenceSyntax,
} from "../../providers/src/prompt-reference.js";
import {
  processDirectionSchema,
  renderProcessDirection,
} from "./production-process.js";
export const productionStateSchema = z
  .record(z.string().min(1).max(100), z.string().min(1).max(300))
  .refine((v) => Object.keys(v).length <= 50);
const promptStateSchema = z
  .union([productionStateSchema, z.string().max(1500)])
  .transform((value) => {
    if (typeof value !== "string") return value;
    try {
      const parsed = productionStateSchema.safeParse(JSON.parse(value));
      if (parsed.success) return parsed.data;
    } catch {
      /* Existing natural-language directions remain supported. */
    }
    return value;
  });
function renderState(state: string | Record<string, string>) {
  if (typeof state === "string") return state;
  return Object.entries(state)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([object, value]) => {
      const name = object.replace(/_/g, " ");
      return value === "unknown"
        ? `The state of ${name} is unknown.`
        : `The ${name} is ${value.replace(/[.!?]+$/, "")}.`;
    })
    .join(" ");
}
export const promptReferenceSchema = z
  .object({
    assetId: idSchema,
    role: referenceRoleSchema.exclude(["voice"]),
    usage: z.enum(["generation", "analysis_only"]).optional(),
    instruction: z.string().trim().min(1).max(1000),
    transfer: z.enum(["action", "camera", "rhythm"]).optional(),
    exclude: z.string().max(1000).optional(),
    actionType: z.string().max(100).optional(),
  })
  .strict()
  .refine(
    (r) => r.role !== "motion" || !!r.transfer,
    "Motion references must declare action, camera or rhythm responsibility",
  );
export const promptInputSchema = z
  .object({
    mode: z.enum([
      "text_to_image",
      "text_to_video",
      "image_edit",
      "image_to_video",
      "first_last_frame",
      "reference_to_video",
      "motion_transfer",
      "camera_transfer",
      "video_to_video",
    ]),
    subject: z.string().trim().min(1).max(1500),
    action: z.string().trim().min(1).max(1500),
    sceneDirection: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .optional()
      .describe(
        "Complete shot-local scene prose: subject/setting, starting arrangement, visible action and timing, settled ending and camera. Replaces their separate prose in the video prompt; structured state remains available for validation. Explicit constraints, process, kit and reference bindings still apply.",
      ),
    initialState: promptStateSchema.optional(),
    endState: promptStateSchema.refine(
      (v) => typeof v !== "string" || v.trim().length > 0,
    ),
    setting: z.string().max(1500).optional(),
    camera: z.string().max(1000).optional(),
    constraints: z.string().max(1500).optional(),
    process: processDirectionSchema.optional(),
    editing: z.string().trim().min(1).max(3000).optional(),
    actionType: z.string().max(100).optional(),
    references: z.array(promptReferenceSchema).max(12).default([]),
    directorKit: directorKitSchema.optional(),
  })
  .strict();
const wording = {
  text_to_image: "Create a still image of the specified subject and state.",
  text_to_video:
    "Create one continuous shot with a clear preparation, completed action and visible settled result.",
  image_edit:
    "Create the target still image using each supplied image only for its assigned visual facts.",
  image_to_video:
    "Start from the supplied first frame. Perform the described action and hold the completed result visibly before ending.",
  first_last_frame:
    "Begin at the supplied first frame and arrive naturally at the supplied last frame. Preserve subject identity and physical continuity throughout the transition.",
  reference_to_video:
    "Create the described target scene. Use supplied references only for their explicitly assigned appearance or movement properties.",
  motion_transfer:
    "Apply the assigned movement pattern to the target subject. Keep the target's appearance, setting and requested camera composition.",
  camera_transfer:
    "Apply the assigned camera path to the target scene. Keep target subjects and their described actions independent of the reference's subjects.",
  video_to_video:
    "Edit the supplied source video according to the requested changes while preserving all specified unchanged properties.",
};
export function compilePrompt(
  raw: unknown,
  syntax: PromptReferenceSyntax = "descriptive",
) {
  const input = promptInputSchema.parse(raw);
  const references = input.references.filter(
    (r) => r.usage !== "analysis_only",
  );
  const has = (role: string) => references.some((r) => r.role === role);
  if (
    (input.mode.startsWith("text_to_") && references.length) ||
    (input.mode === "image_edit" &&
      references.some((r) => ["motion", "source_video"].includes(r.role)))
  )
    throw new AppError(
      "REFERENCE_MODE_UNSUPPORTED",
      "Prompt references do not match the selected mode",
    );
  if (
    (["image_to_video", "first_last_frame"].includes(input.mode) &&
      !has("first_frame")) ||
    (input.mode === "first_last_frame" && !has("last_frame")) ||
    (["motion_transfer", "camera_transfer"].includes(input.mode) &&
      !has("motion")) ||
    (input.mode === "video_to_video" && !has("source_video"))
  )
    throw new AppError(
      "MISSING_REFERENCE",
      "This prompt mode requires its actual frame or video references",
    );
  let image = 0,
    video = 0;
  if (
    ["motion_transfer", "camera_transfer"].includes(input.mode) &&
    !references.some(
      (r) =>
        r.role === "motion" &&
        r.transfer === (input.mode === "motion_transfer" ? "action" : "camera"),
    )
  )
    throw new AppError(
      "REFERENCE_RESPONSIBILITY_MISMATCH",
      "The motion reference must declare the selected action or camera transfer responsibility",
    );
  const bindings = references.map((r) => ({
    ...r,
    token: referenceToken(
      syntax,
      r.role,
      ["motion", "source_video"].includes(r.role) ? ++video : ++image,
    ),
  }));
  const kit = input.directorKit
    ? renderDirectorKit(input.directorKit, input.mode)
    : undefined;
  const prompt = [
    kit?.text,
    input.mode === "image_to_video" && input.process?.operations.length === 0
      ? "Preserve the supplied first frame's completed state. Only the explicitly described camera movement or micro-motion is allowed; do not introduce objects or begin an operation."
      : wording[input.mode],
    ...(input.sceneDirection
      ? [input.sceneDirection]
      : [
          `Subject: ${input.subject}`,
          input.setting && `Setting: ${input.setting}`,
          input.initialState &&
            `At the start: ${renderState(input.initialState)}`,
          `Main action: ${input.action}`,
          `Required final state: ${renderState(input.endState)}`,
          input.camera && `Camera: ${input.camera}`,
        ]),
    input.constraints && `Keep these constraints: ${input.constraints}`,
    input.process && renderProcessDirection(input.process),
    input.editing && `Editing direction: ${input.editing}`,
    ...bindings.map(
      (r) =>
        `${r.token} supplies ${r.transfer ?? r.role}: ${r.instruction}${r.exclude ? `. Do not transfer: ${r.exclude}` : ""}.`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
  if (prompt.length > 20000)
    throw new AppError(
      "PROMPT_TOO_LONG",
      "Shorten the declared direction to fit 20000 characters; constraints are never truncated and additional segments require an accepted budget",
    );
  return {
    templateVersion: input.sceneDirection
      ? "rikoko-scene-direction-v1"
      : kit
        ? `rikoko-director-${kit.id}-r${kit.version}`
        : input.process || input.editing
          ? "rikoko-direction-v3"
          : "rikoko-direction-v2",
    compilerVersion: input.sceneDirection
      ? "rikoko-prompt-compiler-v5"
      : kit
        ? "rikoko-prompt-compiler-v4"
        : input.process || input.editing
          ? "rikoko-prompt-compiler-v3"
          : "rikoko-prompt-compiler-v2",
    referenceSyntax: syntax,
    direction: input,
    ...(kit
      ? {
          directorKit: {
            id: kit.id,
            version: kit.version,
            recipe: kit.recipe,
            validation: kit.validation,
            requirements: kit.requirements,
          },
        }
      : {}),
    readyForSubmission: false,
    prompt,
    bindings,
    warnings: bindings
      .filter(
        (r) =>
          r.transfer === "action" &&
          input.actionType &&
          r.actionType &&
          r.actionType !== input.actionType,
      )
      .map((r) => ({
        code: "ACTION_REFERENCE_MISMATCH",
        assetId: r.assetId,
        targetAction: input.actionType,
        referenceAction: r.actionType,
      })),
  };
}
