import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { AppError } from "./index.js";

// Only explicit public diagnostics cross the HTTP/MCP boundary. Never serialize
// Error, cause, command, stderr, request headers or arbitrary provider payloads.
export const publicErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  traceId: z.string().uuid(),
  recovery: z.object({
    action: z.enum([
      "fix_input",
      "refresh_state",
      "wait",
      "check_environment",
      "inspect_state",
    ]),
    retrySameInput: z.boolean(),
    instruction: z.string(),
  }),
  details: z
    .object({
      stage: z.string().optional(),
      reason: z.string().optional(),
      systemCode: z.string().optional(),
      exitCode: z.number().optional(),
      signal: z.string().optional(),
      currentVersion: z.number().optional(),
      recordId: z.string().optional(),
      generationTraceId: z.string().optional(),
      issues: z
        .array(
          z.object({ path: z.string(), code: z.string(), message: z.string() }),
        )
        .optional(),
    })
    .optional(),
});
export type PublicError = z.infer<typeof publicErrorSchema>;

export function errorRecovery(code: string): PublicError["recovery"] {
  if (
    [
      "VIDEO_FACE_REVIEW_REQUIRED",
      "VIDEO_FACE_REVIEW_STALE",
      "SEEDANCE_FACE_BLOCKED",
      "VIDEO_FACE_MODEL_UNSUPPORTED",
      "VIDEO_MODEL_CHOICE_REQUIRED",
    ].includes(code)
  )
    return {
      action: "fix_input",
      retrySameInput: false,
      instruction:
        "Inspect the brief and every actual image/video (all frames, not just its opening); unknown is not absent. Call video_model_resolve. Present/unknown blocks every Seedance variant. Ask the user to choose MiniMax (recommended) or Kling, reusing an existing explicit choice where applicable. Carry the returned videoPolicy into a fresh preparation; do not remove the policy or references to bypass this gate.",
    };
  if (code === "GUIDE_UNAVAILABLE")
    return {
      action: "check_environment",
      retrySameInput: false,
      instruction:
        "Repair/update the executing backend director-guide bundle and reconnect. Preserve existing tasks; do not repeatedly retry, install an old Skill, or bypass production contracts.",
    };
  if (code === "CRITICAL_IMAGE_REVIEW_REQUIRED")
    return {
      action: "inspect_state",
      retrySameInput: false,
      instruction:
        "Read details.issues for each image. Use media_inspect and actually view its pixels, or obtain user judgment on that exact image. Record media_review with passing framing/continuity/noArtifacts. Keep unknown when pixels are unavailable. Never infer a pass from brightness or pixel counts; never regenerate to resolve this gate.",
    };
  if (
    [
      "CONTINUITY_FRAME_REQUIRED",
      "CONTINUITY_SOURCE_MISMATCH",
      "CONTINUITY_EDIT_ENDPOINT_MISMATCH",
    ].includes(code)
  )
    return {
      action: "fix_input",
      retrySameInput: false,
      instruction:
        "Use media_inspect on the preceding shot's selected video at its retained edit endpoint. Bind the returned image asset and real source provenance, review the critical image, and revise the same plan. A full-clip tail may not match a trimmed scene. Do not relabel the image or create another project to bypass continuity.",
    };
  if (code === "EDITORIAL_COPY_IN_GENERATION")
    return {
      action: "fix_input",
      retrySameInput: false,
      instruction:
        "Keep brand/CTA copy in editing and acceptanceCriteria in the plan. Author footage-only states/action/camera/generationConstraints, save the plan, then call production_shot_prompts and generation_prepare again. Do not strip preparation IDs or use promptOverride to bypass the plan.",
    };
  if (code === "BACKEND_TOOL_UNAVAILABLE")
    return {
      action: "check_environment",
      retrySameInput: false,
      instruction:
        "The MCP bridge advertises a tool the backend does not provide. Update/restart the matching backend runtime and reload the host MCP connection. Repeating arguments or reconnecting only the bridge cannot add a missing backend tool.",
    };
  if (
    ["DELIVERY_MEDIA_UNAVAILABLE", "DELIVERY_VALIDATION_REQUIRED"].includes(
      code,
    )
  )
    return {
      action:
        code === "DELIVERY_MEDIA_UNAVAILABLE"
          ? "check_environment"
          : "fix_input",
      retrySameInput: false,
      instruction:
        "Keep the completed job and existing media. Inspect the reported storage/technical issue or read workspace_validate for the scene details, then repair the existing file or composition. Do not start AI review or automatically regenerate footage.",
    };
  if (["MEDIA_BUSY", "RESULT_NOT_READY"].includes(code))
    return {
      action: "wait",
      retrySameInput: true,
      instruction:
        "Wait before checking again. Poll the existing job; never resubmit generation.",
    };
  if (
    [
      "PLAN_CONFLICT",
      "REVISION_CONFLICT",
      "SCOPE_CONFLICT",
      "PRODUCTION_SCOPE_CHANGED",
    ].includes(code)
  )
    return {
      action: "refresh_state",
      retrySameInput: false,
      instruction:
        "Read the latest owned plan/project/scope, reconcile the intended changes, then supply its current version. Do not blindly replace the version and replay stale content.",
    };
  if (code === "IMPORT_FAILED" || code === "EXPORT_FAILED")
    return {
      action: "check_environment",
      retrySameInput: false,
      instruction:
        "Check the host attachment/export directory and its access permissions. For import, inspect existing asset records before retrying an upload whose outcome is unknown. For export, reuse the completed job. Do not regenerate media.",
    };
  if (code.startsWith("MEDIA_") && code !== "MEDIA_TOO_LARGE")
    return {
      action: "check_environment",
      retrySameInput: false,
      instruction:
        code === "MEDIA_TIMEOUT"
          ? "The media operation exceeded its execution budget. Inspect the failed stage; use a smaller interval/sample count only for extraction timeouts, then retry once. Do not regenerate assets."
          : "Inspect the diagnostic stage and reason on the backend that runs media processing. Check the source/storage and FFmpeg there; use media_runtime_check when available. Do not repeatedly retry unchanged input or regenerate assets.",
    };
  if (code === "INTERNAL" || code.startsWith("BACKEND_"))
    return {
      action: "inspect_state",
      retrySameInput: false,
      instruction:
        "The operation outcome may be unknown. Read existing records/jobs before retrying a write; retain the traceId for diagnosis. Never replay a paid submission to check progress.",
    };
  return {
    action: "fix_input",
    retrySameInput: false,
    instruction:
      "Read the error and field paths, correct the indicated input or prerequisite before retrying. Do not remove required preparation evidence or critical-image checks. Final AI review is not a delivery prerequisite. For production-plan errors, validate the plan object first; save it as {plan, planId?, expectedVersion?}.",
  };
}

export function publicError(
  error: unknown,
  fallbackCode = "INTERNAL",
  fallbackMessage = "Request failed",
): PublicError {
  const code =
    error instanceof AppError
      ? error.code
      : error instanceof ZodError
        ? "INVALID_INPUT"
        : fallbackCode;
  const issues =
    error instanceof ZodError
      ? error.issues.map((i) => ({
          path: i.path.map(String).join("."),
          code: i.code,
          message: i.message,
        }))
      : undefined;
  const message =
    error instanceof AppError
      ? error.message
      : issues
        ? issues.map((i) => `${i.path || "input"}: ${i.message}`).join("; ")
        : fallbackMessage;
  // An HTTP error already normalized by our backend retains its correlation ID.
  if (error instanceof RemoteAppError) return error.publicError;
  return publicErrorSchema.parse({
    code,
    message,
    traceId: randomUUID(),
    recovery: errorRecovery(code),
    details: issues
      ? { issues }
      : error instanceof AppError
        ? error.details
        : undefined,
  });
}

export class RemoteAppError extends AppError {
  constructor(
    readonly publicError: PublicError,
    status: number,
  ) {
    super(publicError.code, publicError.message, status, publicError.details);
  }
}
