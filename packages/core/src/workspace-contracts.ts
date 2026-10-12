import { z } from "zod";
import {
  compositionSchema,
  idSchema,
  sceneSchema,
  volumeEnvelopeSchema,
} from "../../contracts/src/index.js";

const ms = z.number().int().min(0).max(3_600_000);
export const editSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("scene_speed"),
      sceneId: idSchema,
      speed: z.number().min(0.25).max(4),
    })
    .strict(),
  z
    .object({
      type: z.literal("audio_envelope"),
      sceneId: idSchema,
      points: volumeEnvelopeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("audio_fade"),
      sceneId: idSchema,
      inMs: ms,
      outMs: ms,
    })
    .strict(),
  z
    .object({
      type: z.literal("scene_fit"),
      sceneId: idSchema,
      fit: z.enum(["contain", "cover"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("caption"),
      sceneId: idSchema,
      text: z.string().max(1000),
    })
    .strict(),
  z.object({ type: z.literal("delete"), sceneId: idSchema }).strict(),
  z
    .object({
      type: z.literal("move"),
      sceneId: idSchema,
      toIndex: z.number().int().min(0).max(99),
    })
    .strict(),
  z.object({ type: z.literal("split"), sceneId: idSchema, atMs: ms }).strict(),
  z
    .object({
      type: z.literal("trim"),
      sceneId: idSchema,
      startMs: ms,
      endMs: ms,
    })
    .strict(),
  z
    .object({
      type: z.literal("delete_words"),
      sceneId: idSchema,
      wordIds: z.array(idSchema).min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("visual"),
      sceneId: idSchema,
      assetId: idSchema,
      fit: z.enum(["contain", "cover"]).optional(),
      preserveAudio: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("scene_audio"),
      sceneId: idSchema,
      volume: z.number().min(0).max(2),
      audioAssetId: idSchema.nullable().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("insert"),
      scene: sceneSchema,
      atIndex: z.number().int().min(0).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("style"),
      fontSize: z.number().int().min(12).max(96).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      background: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("music"),
      gain: z.number().min(0).max(1),
      assetId: idSchema.nullable().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("format"),
      width: z.number().int().min(144).max(1920),
      height: z.number().int().min(144).max(1920),
    })
    .strict(),
]);
export const actionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("create"), composition: compositionSchema })
    .strict(),
  z
    .object({
      type: z.literal("edit"),
      edits: z.array(editSchema).min(1).max(50),
    })
    .strict(),
  z.object({ type: z.literal("restore"), revisionId: idSchema }).strict(),
]);
export const commitSchema = z
  .object({
    projectId: idSchema.optional(),
    baseRevisionId: idSchema.optional(),
    action: actionSchema,
    message: z.string().min(1).max(5000),
    origin: z.enum(["chat", "studio", "agent"]).default("agent"),
    idempotencyKey: z.string().min(1).max(100),
  })
  .strict();
export const planSchema = z
  .object({
    projectId: idSchema.optional(),
    revisionId: idSchema.optional(),
    selectedSceneId: idSchema.optional(),
    message: z.string().trim().min(1).max(5000),
    assetIds: z.array(idSchema).max(14).default([]),
  })
  .strict();
export type Edit = z.infer<typeof editSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Commit = z.infer<typeof commitSchema>;
export type PlanInput = z.infer<typeof planSchema>;
export type Proposal = {
  message: string;
  action?: Action;
  baseRevisionId?: string;
  projectId?: string;
  engine: "local-commands" | "configured-model";
};
