import { z } from "zod";
import {
  captionFonts,
  captionPresets,
  captionStyleSchema,
  captionStylePatchSchema,
} from "../../contracts/src/caption-style.js";
import { idSchema, type Context } from "../../contracts/src/index.js";
import type { Service } from "../../core/src/index.js";
import { prepareCaptionStyle } from "../../core/src/caption-style.js";
import { readReferenceReport } from "./reference-tools.js";

export const captionStylePrepareSchema = z
  .object({
    description: z.string().trim().max(2000).default(""),
    analysisAssetId: idSchema.optional(),
    preset: z.enum(["clean", "cinematic", "bold", "soft"]).optional(),
    currentStyle: captionStyleSchema.optional(),
    overrides: captionStylePatchSchema.optional(),
  })
  .strict();

export const captionTools = {
  caption_style_prepare: {
    schema: captionStylePrepareSchema,
    description:
      "Prepare a subtitle style from text and/or an owned completed reference analysis (visualStyle). Works when the reference has NO subtitles. Returns a style and a style edit; no render, transcription, model call or charge. Built-in local rules provide suggestions, not exact font recognition. For free-form descriptions use your reasoning to supply validated overrides; disclose unmatched requests. Choose bundled noto-sans-sc or noto-serif-sc for portable Chinese/Latin fonts, weight 300/400/500/600/700, stroke and shadow. Numeric sizes are output pixels. User overrides win over the reference. Apply style to composition.captionStyle or pass edit to workspace_commit, preserving accepted visuals, speech and timing. Missing reference analysis must not block text-only styling. SRT contains timing/text only, not styling.",
  },
} as const;

export async function prepareCaptionStyleTool(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = captionStylePrepareSchema.parse(raw);
  await service.scoped(c, "read", async () => {});
  const report = input.analysisAssetId
    ? await readReferenceReport(service, c, input.analysisAssetId)
    : undefined;
  const result = prepareCaptionStyle({
    ...input,
    referenceStyle: report?.visualStyle.description,
  });
  return {
    ...result,
    fonts: captionFonts.map(({ id, label }) => ({ id, label })),
    presets: Object.entries(captionPresets).map(([id, value]) => ({
      id,
      label: value.label,
    })),
    ...(report
      ? {
          reference: {
            analysisAssetId: input.analysisAssetId,
            visualStyle: report.visualStyle.description,
            evidenceIds: report.visualStyle.evidenceIds,
          },
        }
      : {}),
    rendered: false,
  };
}
