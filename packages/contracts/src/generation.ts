import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const productionLinkSchema = z
  .object({
    projectId: id,
    scopeVersion: z.number().int().positive(),
    shotId: id,
  })
  .strict();
export const generationTargetSchema = z
  .object({
    width: z.number().int().min(144).max(4096),
    height: z.number().int().min(144).max(4096),
    aspectPolicy: z.enum(["match", "contain", "allow_crop"]).default("match"),
    minDurationMs: z.number().int().min(100).max(600000).optional(),
  })
  .strict();
export const referenceRoleSchema = z.enum([
  "composition",
  "character",
  "product",
  "scene",
  "style",
  "first_frame",
  "last_frame",
  "motion",
  "voice",
  "source_video",
]);
export const generationModeSchema = z.enum([
  "image_edit",
  "image_to_video",
  "first_last_frame",
  "reference_to_video",
  "video_to_video",
  "voice_clone",
]);
export const generationReferenceSchema = z
  .object({
    assetId: id,
    role: referenceRoleSchema,
  })
  .strict();
export type GenerationReference = z.infer<typeof generationReferenceSchema>;
export const storyboardLinkSchema = z
  .object({
    storyboardId: id,
    version: z.number().int().positive(),
    sourceShotId: id,
    stage: z.enum(["image", "video"]),
  })
  .strict();
const bindingSchema = z
  .object({
    field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/),
    roles: z.array(referenceRoleSchema).min(1).max(10),
    kind: z.enum(["image", "video", "audio"]),
    array: z.boolean(),
    min: z.number().int().min(0).max(12),
    max: z.number().int().min(1).max(12),
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(20 * 1024 * 1024),
    maxPixels: z.number().int().positive().max(40_000_000).optional(),
    mimeTypes: z
      .array(z.string().regex(/^(?:image|video|audio)\/[a-z0-9.+-]+$/))
      .min(1)
      .max(10)
      .optional(),
    containers: z
      .array(z.enum(["mp4", "mov", "webm", "other"]))
      .min(1)
      .max(4)
      .optional(),
    minDimension: z.number().int().positive().max(4096).optional(),
    maxDimension: z.number().int().positive().max(4096).optional(),
    minDurationMs: z.number().int().min(0).optional(),
    maxDurationMs: z.number().int().positive().max(600000).optional(),
    maxTotalDurationMs: z.number().int().positive().max(600000).optional(),
  })
  .strict();
export const generationInputSchema = z
  .object({
    mode: generationModeSchema,
    referenceSyntax: z.enum(["descriptive", "kling", "seedance"]).optional(),
    bindings: z.array(bindingSchema).min(1).max(10),
    maxTotalBytes: z
      .number()
      .int()
      .positive()
      .max(40 * 1024 * 1024),
    outputDurationMs: z.number().int().min(100).max(600000).optional(),
    outputDurationSource: z.literal("source_video").optional(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    const roles = new Set<string>(),
      fields = new Set<string>();
    for (const b of profile.bindings) {
      if (
        fields.has(b.field) ||
        [
          "prompt",
          "text",
          "model",
          "__proto__",
          "constructor",
          "prototype",
        ].includes(b.field) ||
        b.min > b.max ||
        (!b.array && b.max !== 1)
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid or conflicting reference field",
        });
      fields.add(b.field);
      for (const role of b.roles) {
        const kind = ["motion", "source_video"].includes(role)
          ? "video"
          : role === "voice"
            ? "audio"
            : "image";
        if (roles.has(role) || b.kind !== kind)
          ctx.addIssue({
            code: "custom",
            message:
              "Reference roles must have a unique, matching media binding",
          });
        roles.add(role);
      }
      if ((b.minDurationMs ?? 0) > (b.maxDurationMs ?? Infinity))
        ctx.addIssue({
          code: "custom",
          message: "Invalid reference duration bounds",
        });
      if (
        b.mimeTypes?.some((mime) => !mime.startsWith(`${b.kind}/`)) ||
        (b.containers && b.kind !== "video") ||
        (b.kind === "audio" && (b.minDimension || b.maxDimension)) ||
        (b.minDimension ?? 0) > (b.maxDimension ?? Infinity)
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid reference format or dimension bounds",
        });
    }
    const required = (role: string) =>
      profile.bindings.some(
        (b) =>
          b.roles.length === 1 &&
          b.roles[0] === role &&
          !b.array &&
          b.min === 1 &&
          b.max === 1,
      );
    if (
      profile.mode === "image_edit" &&
      profile.bindings.some((b) => b.kind !== "image")
    )
      ctx.addIssue({
        code: "custom",
        message: "Image editing accepts image references",
      });
    if (
      profile.outputDurationSource &&
      (profile.mode !== "video_to_video" || profile.outputDurationMs)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Source duration is only valid for video editing and cannot also be fixed",
      });
    if (
      !["image_edit", "voice_clone"].includes(profile.mode) &&
      !profile.outputDurationMs &&
      !profile.outputDurationSource
    )
      ctx.addIssue({
        code: "custom",
        message: "Video profile requires its quoted output duration",
      });
    if (
      ["image_to_video", "first_last_frame"].includes(profile.mode) &&
      !required("first_frame")
    )
      ctx.addIssue({ code: "custom", message: "First frame must be required" });
    if (profile.mode === "first_last_frame" && !required("last_frame"))
      ctx.addIssue({ code: "custom", message: "Last frame must be required" });
    if (profile.mode === "video_to_video" && !required("source_video"))
      ctx.addIssue({
        code: "custom",
        message: "Source video must be required",
      });
    if (
      profile.mode === "voice_clone" &&
      (!required("voice") || profile.bindings.some((b) => b.kind !== "audio"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Voice cloning requires a single audio voice reference",
      });
  });
export type GenerationInput = z.infer<typeof generationInputSchema>;

export const voiceCloneSchema = z
  .object({
    voiceId: z.string().regex(/^[\w-]{1,80}$/),
    provider: z.literal("minimax"),
    reuseModel: z.literal("minimax-cloned-speech"),
    activationRequiredWithinDays: z.literal(7),
  })
  .strict();
