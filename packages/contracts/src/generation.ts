import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
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
    minDurationMs: z.number().int().min(0).optional(),
    maxDurationMs: z.number().int().positive().max(600000).optional(),
    maxTotalDurationMs: z.number().int().positive().max(600000).optional(),
  })
  .strict();
export const generationInputSchema = z
  .object({
    mode: generationModeSchema,
    bindings: z.array(bindingSchema).min(1).max(10),
    maxTotalBytes: z
      .number()
      .int()
      .positive()
      .max(40 * 1024 * 1024),
    outputDurationMs: z.number().int().min(100).max(600000).optional(),
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
    }
    const required = (role: string) =>
      profile.bindings.some(
        (b) =>
          b.roles.includes(role as GenerationReference["role"]) && b.min > 0,
      );
    if (
      profile.mode === "image_edit" &&
      profile.bindings.some((b) => b.kind !== "image")
    )
      ctx.addIssue({
        code: "custom",
        message: "Image editing accepts image references",
      });
    if (profile.mode !== "image_edit" && !profile.outputDurationMs)
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
  });
export type GenerationInput = z.infer<typeof generationInputSchema>;
