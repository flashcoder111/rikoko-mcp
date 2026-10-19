import { z } from "zod";
import {
  AppError,
  compositionSchema,
  idSchema,
} from "../../contracts/src/index.js";
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const templateSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: key,
    version: z.number().int().positive(),
    title: z.string().min(1).max(160),
    description: z.string().max(2000).default(""),
    category: z.string().max(60).default("通用"),
    speech: z
      .object({
        mode: z.literal("optional"),
        anchors: z
          .array(
            z
              .object({
                eventId: idSchema,
                text: z.string().min(1).max(200),
                occurrence: z.number().int().min(1).max(500).default(1),
              })
              .strict(),
          )
          .max(100)
          .default([]),
      })
      .strict()
      .optional(),
    parameters: z
      .record(
        key,
        z
          .object({
            default: z.string().max(1000),
            maxLength: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .default({}),
    assets: z
      .array(
        z
          .object({
            id: key,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().min(1).max(104857600),
            name: z.string().max(120),
            license: z.string().min(1).max(100),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    composition: compositionSchema,
  })
  .strict()
  .superRefine((t, ctx) => {
    const ids = new Set(t.assets.map((a) => a.id));
    const refs = [
      ...t.composition.scenes.flatMap((s) => [s.assetId, s.audioAssetId]),
      ...t.composition.events.map((e) => e.assetId),
      t.composition.audio?.assetId,
    ].filter(Boolean);
    if (ids.size !== t.assets.length || refs.some((id) => !ids.has(id!)))
      ctx.addIssue({
        code: "custom",
        message: "Template references must use declared asset IDs",
      });
    const texts = [
      t.composition.title,
      ...t.composition.scenes.map((s) => s.text),
      ...t.composition.events.map((e) => e.text),
      ...(t.speech?.anchors.map((a) => a.text) ?? []),
    ];
    for (const text of texts)
      for (const match of text.matchAll(/\{\{([^{}]+)\}\}/g))
        if (!Object.hasOwn(t.parameters, match[1]))
          ctx.addIssue({
            code: "custom",
            message: "Unknown template parameter",
          });
    const anchors = t.speech?.anchors ?? [];
    if (
      new Set(anchors.map((a) => a.eventId)).size !== anchors.length ||
      anchors.some((a) => !t.composition.events.some((e) => e.id === a.eventId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Speech anchors must reference distinct template events",
      });
  });
export type Template = z.infer<typeof templateSchema>;
export const applyTemplateSchema = z
  .object({
    id: key,
    version: z.number().int().positive(),
    parameters: z.record(key, z.string().max(1000)).default({}),
    sceneAssets: z.record(idSchema, idSchema).default({}),
    speech: z
      .object({ assetId: idSchema, transcriptAssetId: idSchema })
      .strict()
      .optional(),
  })
  .strict();
export function instantiate(
  t: Template,
  raw: Record<string, string>,
  assets: Record<string, string> = {},
) {
  if (Object.keys(raw).some((k) => !Object.hasOwn(t.parameters, k)))
    throw new AppError("INVALID_INPUT", "Unknown template parameter");
  const values: Record<string, string> = Object.create(null);
  for (const [k, p] of Object.entries(t.parameters)) {
    const v = raw[k] ?? p.default;
    if (v.length > p.maxLength)
      throw new AppError("INVALID_INPUT", `Parameter too long: ${k}`);
    values[k] = v;
  }
  const replace = (s: string) =>
    s.replace(/\{\{([^{}]+)\}\}/g, (_, k: string) => values[k]);
  const asset = (id: string | undefined) => {
    if (!id) return undefined;
    if (!assets[id])
      throw new AppError(
        "ASSET_NOT_READY",
        "Template asset not downloaded",
        409,
      );
    return assets[id];
  };
  const c = structuredClone(t.composition);
  c.title = replace(c.title);
  c.scenes = c.scenes.map((s) => ({
    ...s,
    text: replace(s.text),
    assetId: asset(s.assetId),
    audioAssetId: asset(s.audioAssetId),
  }));
  c.events = c.events.map((e) => ({
    ...e,
    text: replace(e.text),
    assetId: asset(e.assetId),
  }));
  if (c.audio) c.audio.assetId = asset(c.audio.assetId)!;
  return compositionSchema.parse(c);
}
