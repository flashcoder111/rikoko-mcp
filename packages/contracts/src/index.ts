import { z } from "zod";
import {
  captionStyleSchema,
  captionStylePatchSchema,
} from "./caption-style.js";
export * from "./caption-style.js";
import { videoImportOperationSchema } from "./asset-import.js";
import { referenceOperationSchema } from "./reference-analysis.js";
import {
  generationModeSchema,
  generationReferenceSchema,
  storyboardLinkSchema,
  generationTargetSchema,
  productionLinkSchema,
} from "./generation.js";
export * from "./reference-analysis.js";
export * from "./generation.js";
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const ms = z.number().int().min(0).max(3_600_000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const volumeEnvelopeSchema = z
  .array(
    z
      .object({
        timeMs: ms,
        gain: z.number().min(0).max(1),
      })
      .strict(),
  )
  .max(64);
export const wordSchema = z
  .object({
    id: idSchema,
    text: z.string().min(1).max(200),
    startMs: ms,
    endMs: ms,
    speaker: z.string().max(80).optional(),
  })
  .strict()
  .refine((w) => w.endMs > w.startMs, "Word end must follow start");
export const sceneSchema = z
  .object({
    id: idSchema,
    durationMs: ms.min(100),
    assetId: idSchema.optional(),
    visualKind: z.enum(["graphic", "placeholder"]).optional(),
    productionShotId: idSchema.optional(),
    audioAssetId: idSchema.optional(),
    audioSourceStartMs: ms.optional(),
    sourceStartMs: ms.default(0),
    color: color.default("#173b42"),
    text: z.string().max(1000).default(""),
    words: z.array(wordSchema).max(500).optional(),
    speechAlignment: z
      .object({
        sourceAssetId: idSchema,
        transcriptAssetId: idSchema,
      })
      .strict()
      .optional(),
    fit: z.enum(["contain", "cover"]).default("contain"),
    volume: z.number().min(0).max(2).default(1),
    speed: z.number().min(0.25).max(4).optional(),
    volumeEnvelope: volumeEnvelopeSchema.optional(),
  })
  .strict();
export const eventSchema = z
  .object({
    id: idSchema,
    sceneId: idSchema,
    wordId: idSchema.optional(),
    offsetMs: ms.default(0),
    durationMs: ms.min(50),
    kind: z.enum(["card", "text", "broll", "sound"]),
    text: z.string().max(200).default(""),
    assetId: idSchema.optional(),
    gain: z.number().min(0).max(2).optional(),
    audioSourceStartMs: ms.optional(),
  })
  .strict();
export const compositionSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().min(1).max(160),
    width: z
      .number()
      .int()
      .min(144)
      .max(1920)
      .refine((n) => n % 2 === 0),
    height: z
      .number()
      .int()
      .min(144)
      .max(1920)
      .refine((n) => n % 2 === 0),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).default(24),
    language: z.string().min(2).max(20).default("en"),
    scenes: z.array(sceneSchema).min(1).max(100),
    events: z.array(eventSchema).max(300).default([]),
    captionStyle: captionStyleSchema.default({
      fontSize: 28,
      color: "#ffffff",
      background: "#151a22",
    }),
    audio: z
      .object({
        assetId: idSchema.optional(),
        toneHz: z.number().min(40).max(1000).optional(),
        gain: z.number().min(0).max(1).default(0.1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    let total = 0;
    for (const s of c.scenes) {
      if (ids.has(s.id))
        ctx.addIssue({ code: "custom", message: "Duplicate scene ID" });
      ids.add(s.id);
      total += s.durationMs;
      if (
        s.speechAlignment &&
        (!s.words?.length || s.audioAssetId !== s.speechAlignment.sourceAssetId)
      )
        ctx.addIssue({
          code: "custom",
          message: "Speech alignment needs words and its matching audio source",
        });
      let pointTime = -1;
      for (const point of s.volumeEnvelope ?? []) {
        if (point.timeMs <= pointTime || point.timeMs > s.durationMs)
          ctx.addIssue({
            code: "custom",
            message: "Invalid volume envelope timeline",
          });
        pointTime = point.timeMs;
      }
      let end = 0;
      const wordIds = new Set();
      for (const w of s.words ?? []) {
        if (w.startMs < end || w.endMs > s.durationMs || wordIds.has(w.id))
          ctx.addIssue({ code: "custom", message: "Invalid word timeline" });
        end = w.endMs;
        wordIds.add(w.id);
      }
    }
    if (total > 600_000)
      ctx.addIssue({
        code: "custom",
        message: "Composition limit: 10 minutes",
      });
    const eventIds = new Set();
    for (const e of c.events) {
      const s = c.scenes.find((s) => s.id === e.sceneId);
      const w = s?.words?.find((w) => w.id === e.wordId);
      const start = (w?.startMs ?? 0) + e.offsetMs;
      if (
        eventIds.has(e.id) ||
        !s ||
        (e.wordId && !w) ||
        start + e.durationMs > (s?.durationMs ?? 0) ||
        (["broll", "sound"].includes(e.kind) && !e.assetId)
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid event anchor or interval",
        });
      eventIds.add(e.id);
    }
  });
export type Composition = z.infer<typeof compositionSchema>;
export const transcriptSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: z.string(),
    durationMs: ms,
    words: z.array(wordSchema),
    evidence: z.enum(["precomputed", "local-real", "provider-live"]),
  })
  .strict()
  .superRefine((t, c) => {
    let end = 0;
    const ids = new Set();
    for (const w of t.words) {
      if (w.startMs < end || w.endMs > t.durationMs || ids.has(w.id))
        c.addIssue({
          code: "custom",
          message: "Invalid transcript times or IDs",
        });
      end = w.endMs;
      ids.add(w.id);
    }
  });
export const operationSchema = z.discriminatedUnion("kind", [
  videoImportOperationSchema,
  referenceOperationSchema,
  z
    .object({
      kind: z.literal("render"),
      composition: compositionSchema,
      revisionId: idSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("trim"),
      assetId: idSchema,
      segments: z
        .array(
          z
            .object({ startMs: ms, endMs: ms })
            .strict()
            .refine((s) => s.endMs > s.startMs),
        )
        .min(1)
        .max(30),
      width: z
        .number()
        .int()
        .min(144)
        .max(1920)
        .default(360)
        .refine((n) => n % 2 === 0),
      height: z
        .number()
        .int()
        .min(144)
        .max(1920)
        .default(640)
        .refine((n) => n % 2 === 0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("captions"),
      assetId: idSchema,
      transcript: transcriptSchema,
      style: captionStylePatchSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("transcribe"),
      assetId: idSchema,
      engine: z.enum(["local", "fal"]).default("local"),
      model: z.string().min(1).max(120).optional(),
      language: z.string().max(20).default("en"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tts"),
      text: z.string().min(1).max(5000),
      language: z.string().max(20).default("en"),
      voice: z
        .string()
        .regex(/^[\w -]{1,80}$/)
        .default("default"),
      engine: z.literal("fal").default("fal"),
      model: z.string().min(1).max(120).default("elevenlabs-voice"),
      voiceAssetId: idSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("generate"),
      model: z.string().min(1).max(120),
      prompt: z.string().min(1).max(5000),
      parameters: z.record(z.string(), z.json()).default({}),
      mode: generationModeSchema.optional(),
      references: z.array(generationReferenceSchema).min(1).max(12).optional(),
      storyboard: storyboardLinkSchema.optional(),
      preparedRequestId: idSchema.optional(),
      production: productionLinkSchema.optional(),
      target: generationTargetSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("translate"),
      model: z.string().min(1).max(120),
      text: z.string().min(1).max(10000),
      language: z.string().min(2).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal("analyze"),
      assetId: idSchema,
      model: z.string().min(1).max(120).optional(),
      observations: z
        .array(
          z.object({
            startMs: ms,
            endMs: ms,
            observation: z.string().max(2000),
          }),
        )
        .max(100)
        .optional(),
    })
    .strict(),
]);
export const referenceAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary: z.string().min(1).max(5000),
    observations: z
      .array(
        z
          .object({
            startMs: ms,
            endMs: ms,
            observation: z.string().min(1).max(2000),
          })
          .strict()
          .refine((o) => o.endMs > o.startMs),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const translationSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: z.string().min(2).max(20),
    text: z.string().min(1).max(10000),
  })
  .strict();
export type Operation = z.infer<typeof operationSchema>;
export function isPaidOperation(input: Operation) {
  return (
    input.kind === "generate" ||
    input.kind === "translate" ||
    input.kind === "reference_analyze" ||
    (input.kind === "analyze" && !!input.model) ||
    ((input.kind === "tts" || input.kind === "transcribe") &&
      input.engine === "fal")
  );
}

export const eventBindingsSchema = z
  .array(
    z.object({ eventId: idSchema, wordId: idSchema.optional(), offsetMs: ms }),
  )
  .max(300);
export const scenePatchSchema = z
  .object({
    productionShotId: idSchema.optional(),
    durationMs: ms.min(100).optional(),
    assetId: idSchema.optional(),
    audioAssetId: idSchema.optional(),
    audioSourceStartMs: ms.optional(),
    sourceStartMs: ms.optional(),
    color: color.optional(),
    text: z.string().max(1000).optional(),
    words: z.array(wordSchema).max(500).optional(),
    fit: z.enum(["contain", "cover"]).optional(),
    volume: z.number().min(0).max(2).optional(),
  })
  .strict();
export const revisionPatchSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("scene"),
    sceneId: idSchema,
    changes: scenePatchSchema,
    eventBindings: eventBindingsSchema.optional(),
  }),
  z.object({
    type: z.literal("style"),
    style: compositionSchema.shape.captionStyle,
  }),
  z.object({
    type: z.literal("language"),
    eventBindings: eventBindingsSchema.optional(),
    language: z.string().min(2).max(20),
    scenes: z
      .array(
        z.object({
          sceneId: idSchema,
          text: z.string().max(1000),
          audioAssetId: idSchema,
          durationMs: ms.min(100),
          words: z.array(wordSchema).optional(),
        }),
      )
      .min(1),
  }),
  z.object({
    type: z.literal("format"),
    width: z.number(),
    height: z.number(),
  }),
]);
export type RevisionPatch = z.infer<typeof revisionPatchSchema>;
export type Context = {
  accountId: string;
  keyId: string;
  scopes: string[];
  budgetCents: number;
};
export type Entity = {
  id: string;
  accountId: string;
  type: string;
  createdAt: string;
  [key: string]: any;
};
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const requireValue = (
  value: unknown,
  code: string,
  message: string,
  status = 400,
): asserts value => {
  if (!value) throw new AppError(code, message, status);
};

export function isOfficialOperation(input: Operation) {
  return (
    input.kind === "generate" ||
    input.kind === "reference_analyze" ||
    ((input.kind === "tts" || input.kind === "transcribe") &&
      input.engine === "fal")
  );
}
