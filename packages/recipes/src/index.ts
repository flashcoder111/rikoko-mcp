import { z } from "zod";
import {
  compositionSchema,
  type Composition,
} from "../../contracts/src/index.js";
export const recipeSchema = z.object({
  mode: z.enum(["reference-remix", "from-scratch", "rawcut"]),
  title: z.string().min(1).max(160),
  product: z
    .object({
      name: z.string().max(80),
      description: z.string().max(500),
      cta: z.string().max(160),
    })
    .optional(),
  referenceAssetId: z.string().optional(),
  analysisAssetId: z.string().optional(),
  observations: z
    .array(
      z.object({
        startMs: z.number().nonnegative(),
        endMs: z.number().positive(),
        observation: z.string().max(2000),
      }),
    )
    .default([]),
  scenes: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(1000),
        durationMs: z.number().int().min(100),
        assetId: z.string().optional(),
        audioAssetId: z.string().optional(),
        sourceStartMs: z.number().int().nonnegative().default(0),
      }),
    )
    .max(100)
    .optional(),
  width: z.number().default(360),
  height: z.number().default(640),
  language: z.string().default("en"),
});
export function planRecipe(raw: unknown) {
  const input = recipeSchema.parse(raw);
  if (input.mode === "reference-remix" && !input.referenceAssetId)
    throw new Error("Reference remix requires a reference asset");
  if (input.mode === "rawcut" && !input.scenes?.every((s) => s.assetId))
    throw new Error("Rawcut requires source scenes");
  const p = input.product;
  const scenes: {
    id: string;
    text: string;
    durationMs: number;
    assetId?: string;
    audioAssetId?: string;
    sourceStartMs?: number;
  }[] = input.scenes ?? [
    { id: "hook", text: p ? `Meet ${p.name}` : input.title, durationMs: 2500 },
    {
      id: "details",
      text: p?.description ?? "Add your story and assets",
      durationMs: 3500,
    },
    { id: "cta", text: p?.cta ?? "Make it yours", durationMs: 2500 },
  ];
  const composition: Composition = compositionSchema.parse({
    schemaVersion: 1,
    title: input.title,
    width: input.width,
    height: input.height,
    language: input.language,
    scenes: scenes.map((s, i) => ({
      ...s,
      color: ["#173b42", "#403148", "#233956"][i % 3],
    })),
  });
  return {
    schemaVersion: 1,
    recipeVersion: "templates-v1",
    mode: input.mode,
    referenceAssetId: input.referenceAssetId,
    analysisAssetId: input.analysisAssetId ?? null,
    observations: input.observations,
    analysisEvidence: input.observations.length
      ? "precomputed"
      : "not_available",
    planningMethod: "deterministic-template",
    facts: input.product ?? null,
    composition,
    missing: scenes.flatMap((s) =>
      s.assetId
        ? []
        : [
            {
              sceneId: s.id,
              capability: "visual",
              localFallback: "original-graphic",
            },
          ],
    ),
  };
}
export function selectTranscript(
  words: {
    id: string;
    text: string;
    startMs: number;
    endMs: number;
    speaker?: string;
  }[],
  input: { wordIds?: string[]; speaker?: string; query?: string },
) {
  const chosen = words.filter(
    (w) =>
      input.wordIds?.includes(w.id) ||
      (input.speaker && w.speaker === input.speaker) ||
      (input.query &&
        w.text.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())),
  );
  const segments: { startMs: number; endMs: number; wordIds: string[] }[] = [];
  for (const word of chosen) {
    const last = segments.at(-1);
    if (last && word.startMs - last.endMs < 500) {
      last.endMs = word.endMs;
      last.wordIds.push(word.id);
    } else
      segments.push({
        startMs: word.startMs,
        endMs: word.endMs,
        wordIds: [word.id],
      });
  }
  return { method: "explicit-transcript-selection", segments };
}
