import { z } from "zod";
import {
  userRequirementSchema,
  type UserRequirement,
} from "./production-intent.js";
import {
  compositionSchema,
  captionStylePatchSchema,
  idSchema,
  sceneSchema,
  volumeEnvelopeSchema,
} from "../../contracts/src/index.js";

const ms = z.number().int().min(0).max(3_600_000);
export const editSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("sound"),
      sceneId: idSchema,
      eventId: idSchema,
      assetId: idSchema.nullable(),
      offsetMs: ms.default(0),
      durationMs: ms.min(50).optional(),
      gain: z.number().min(0).max(2).default(1),
      audioSourceStartMs: ms.default(0),
      wordId: idSchema.optional(),
    })
    .strict(),
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
  captionStylePatchSchema.extend({ type: z.literal("style") }).strict(),
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
    templatePreparationId: idSchema.optional(),
    creativeContextId: idSchema.optional(),
    requestId: idSchema.optional(),
    requestVersion: z.number().int().positive().optional(),
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
    creativeContextId: idSchema.optional(),
    requestId: idSchema.optional(),
    requestVersion: z.number().int().positive().optional(),
    projectId: idSchema.optional(),
    revisionId: idSchema.optional(),
    selectedSceneId: idSchema.optional(),
    message: z.string().trim().max(5000).default(""),
    assetIds: z.array(idSchema).max(14).default([]),
  })
  .strict();
export const missingInputSchema = z
  .object({
    id: idSchema,
    kind: z.enum(["image", "video", "audio", "text"]),
    prompt: z.string().trim().min(1).max(1000),
    purpose: z.string().trim().min(1).max(500),
    required: z.boolean().default(true),
    sceneId: idSchema.optional(),
  })
  .strict();
export const requestSaveSchema = z
  .object({
    userRequirements: z.array(userRequirementSchema).min(1).max(50).optional(),
    creativeContextId: idSchema.optional(),
    requestId: idSchema.optional(),
    requestVersion: z.number().int().positive().optional(),
    projectId: idSchema.optional(),
    revisionId: idSchema.optional(),
    selectedSceneId: idSchema.optional(),
    message: z.string().trim().max(5000).default(""),
    assetIds: z.array(idSchema).max(14).default([]),
    missingInputs: z.array(missingInputSchema).max(14).optional(),
  })
  .strict();
export type MissingInput = z.infer<typeof missingInputSchema>;
export type CreationRequest = {
  userRequirements?: UserRequirement[];
  communication?: ReturnType<
    typeof import("./production-intent.js").intentNotice
  >;
  creativeContextId?: string;
  requestId: string;
  requestVersion: number;
  originalMessage: string;
  turns: { message: string; assetIds: string[] }[];
  assetIds: string[];
  missingInputs: MissingInput[];
  status: "waiting_input" | "ready" | "submitted";
  projectId?: string;
  revisionId?: string;
  selectedSceneId?: string;
  jobId?: string;
  proposal?: Proposal;
};
export type Edit = z.infer<typeof editSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Commit = z.infer<typeof commitSchema>;
export type PlanInput = z.infer<typeof planSchema>;
export type Proposal = {
  templatePreparationId?: string;
  creativeContextId?: string;
  requestId?: string;
  requestVersion?: number;
  status?: "waiting_input" | "ready";
  missingInputs?: MissingInput[];
  message: string;
  action?: Action;
  baseRevisionId?: string;
  projectId?: string;
  engine: "local-commands" | "configured-model" | "template-library";
  autoApply?: boolean;
  reuse?: {
    templateId: string;
    templateTitle: string;
    assetIds: string[];
    generationRequests: 0;
  };
};
