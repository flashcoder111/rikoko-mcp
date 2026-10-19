import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  AppError,
  idSchema,
  operationSchema,
  generationReferenceSchema,
  type Context,
  type GenerationReference,
  type Entity,
} from "../../contracts/src/index.js";
import { Service, fingerprint } from "../../core/src/index.js";
import { extractReferenceMedia } from "../../core/src/reference-media.js";
import { readReferenceReport } from "./reference-tools.js";
import { validateStoryboardInput } from "../../core/src/storyboard-state.js";
import { cloudConnection } from "../../cloud-client/src/index.js";
import { serviceMode } from "../../core/src/service-info.js";
import { referenceShotPrompts } from "../../core/src/reference-prompts.js";
import { generationDurationMs } from "../../providers/src/generation-parameters.js";
import { generationTargetSchema } from "../../contracts/src/generation.js";

const prompt = z.string().min(1).max(5000);
const targetReference = generationReferenceSchema
  .extend({
    role: z.enum(["character", "product", "scene", "style"]),
    instruction: z.string().min(1).max(500),
  })
  .strict();
const prepareSchema = z
  .object({
    analysisAssetId: idSchema,
    brief: z.string().min(1).max(2000),
    references: z.array(targetReference).max(10).default([]),
    shots: z
      .array(
        z
          .object({
            sourceShotId: idSchema,
            durationMs: z.number().int().min(100).max(600000).optional(),
            frameTimeMs: z.number().int().min(0).optional(),
            useSourceComposition: z.boolean().default(false),
            motionPurpose: z.enum(["action", "camera", "rhythm"]).optional(),
            motionExclusions: z.string().min(1).max(1000).optional(),
            motionRange: z
              .object({
                startMs: z.number().int().min(0),
                endMs: z.number().int().positive(),
              })
              .strict()
              .refine((r) => r.endMs > r.startMs)
              .optional(),
            imagePrompt: prompt.optional(),
            videoPrompt: prompt.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .strict();
const target = {
  storyboardId: idSchema,
  expectedVersion: z.number().int().positive(),
  sourceShotId: idSchema,
};
const reviewSchema = z
  .object({
    ...target,
    imageAssetId: idSchema,
    decision: z.enum(["accepted", "rejected"]),
    checks: z
      .object({
        identity: z.boolean(),
        product: z.boolean(),
        composition: z.boolean(),
      })
      .strict(),
    notes: z.string().min(1).max(2000),
  })
  .strict();
const quoteSchema = z
  .object({
    ...target,
    stage: z.enum(["image", "video"]),
    model: z.string().min(1).max(120),
    prompt: prompt.optional(),
    regenerate: z.boolean().default(false),
    parameters: z.record(z.string(), z.json()).default({}),
    target: generationTargetSchema.optional(),
    lastFrameAssetId: idSchema.optional(),
    preparedRequestId: idSchema.optional(),
  })
  .strict();
export const storyboardTools = {
  reference_storyboard_prepare: {
    schema: prepareSchema,
    description:
      "Prepare up to 12 selected shots from an owned v2 analysis: extract real composition frames and optional motion excerpts locally, attach target character/product/scene/style images with explicit roles, and save source observations, never target-generation prompts. No model call or purchase. Review the source times: estimates are not frame-accurate. Author a target plan and compile it with production_shot_prompts before preparation. Use idempotencyKey for retries. Read the persisted storyboard via record_get(type=storyboard).",
  },
  reference_storyboard_review: {
    schema: reviewSchema,
    description:
      "Record an actual visual review of an owned target image for one storyboard shot. Accept only after the user or a vision-capable reviewer has checked identity, product and composition; mark irrelevant checks true and explain in notes. This tool does not see or evaluate images. It increments the storyboard version and invalidates previous quotes; rejected images cannot drive video. It does not buy or render anything.",
  },
  reference_storyboard_quote: {
    schema: quoteSchema,
    description:
      "Quote one storyboard image-edit or video step using a compatible model. Supply preparedRequestId to quote its frozen operation without rebuilding text or inputs; its storyboard/version/stage/model must match. A saved target-plan preparation is required; raw source observations cannot be quoted. Returns exact input for job_submit after price agreement. Accepted images are reused unless regenerate=true. Video requires a reviewed target image and any requested motion reference. Prefer available MiniMax. After generation use reference_adapt and workspace_commit.",
  },
};

function getShot(board: Entity, version: number, sourceShotId: string) {
  if (board.version !== version)
    throw new AppError(
      "STORYBOARD_CONFLICT",
      "Read the latest storyboard version before editing or quoting",
      409,
    );
  const shot = board.shots.find(
    (s: { sourceShotId: string }) => s.sourceShotId === sourceShotId,
  );
  if (!shot)
    throw new AppError(
      "INVALID_SHOT",
      "Shot does not belong to this storyboard",
    );
  return shot;
}
export async function callStoryboardTool(
  service: Service,
  c: Context,
  name: keyof typeof storyboardTools,
  raw: unknown,
): Promise<any> {
  await service.scoped(c, "write", async () => {});
  if (name === "reference_storyboard_prepare") {
    const input = prepareSchema.parse(raw);
    const inputHash = fingerprint(input);
    const boardId = input.idempotencyKey
      ? `storyboard-${fingerprint([c.accountId, input.idempotencyKey])}`
      : randomUUID();
    const previous = await service.scoped(c, "read", (tx) =>
      tx.get(boardId, c.accountId, "storyboard"),
    );
    if (previous) {
      if (previous.inputHash !== inputHash)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "Storyboard preparation input changed",
          409,
        );
      return previous;
    }
    const report = await readReferenceReport(service, c, input.analysisAssetId);
    if (report.analysis?.detail === "overview")
      throw new AppError(
        "ANALYSIS_DETAIL_REQUIRED",
        "Overview sections cannot drive a shot storyboard. Analyze at shots or recreate detail first.",
      );
    if (
      new Set(input.shots.map((s) => s.sourceShotId)).size !==
      input.shots.length
    )
      throw new AppError("INVALID_SHOT", "Choose each source shot only once");
    for (const ref of input.references) {
      const asset = await service.get(c, "asset", ref.assetId);
      if (asset.kind !== "image")
        throw new AppError(
          "INVALID_MEDIA",
          "Character, product, scene and style references must be images",
        );
    }
    const drafts = input.shots.map((selection) => {
      const shot = report.shots.find((s) => s.id === selection.sourceShotId);
      if (!shot)
        throw new AppError("INVALID_SHOT", "Unknown analyzed source shot");
      if (
        selection.motionRange &&
        (!selection.motionPurpose || !selection.motionExclusions)
      )
        throw new AppError(
          "REFERENCE_RESPONSIBILITY_REQUIRED",
          "A motion excerpt needs motionPurpose and motionExclusions; do not automatically transfer both action and camera",
        );
      // A near-start composition frame is a draft aid, never an automatically accepted target first frame.
      const frameTimeMs =
        selection.frameTimeMs ??
        shot.startMs +
          Math.min(100, Math.floor((shot.endMs - shot.startMs) / 10));
      if (
        frameTimeMs < shot.startMs ||
        frameTimeMs >= shot.endMs ||
        (selection.motionRange &&
          (selection.motionRange.endMs <= shot.startMs ||
            selection.motionRange.startMs >= shot.endMs))
      )
        throw new AppError(
          "INVALID_INTERVAL",
          "Choose a frame inside this shot and a motion excerpt overlapping it",
        );
      const legend = input.references
        .map(
          (r, i) =>
            `Image ${i + (selection.useSourceComposition ? 2 : 1)}: ${r.role}; ${r.instruction}`,
        )
        .join("\n");
      const observation = referenceShotPrompts(
        report,
        shot,
        input.brief,
        legend,
        selection,
      );
      return {
        sourceShotId: shot.id,
        sourceStartMs: shot.startMs,
        sourceEndMs: shot.endMs,
        durationMs: selection.durationMs ?? shot.endMs - shot.startMs,
        frameTimeMs,
        motionRange: selection.motionRange,
        useSourceComposition: selection.useSourceComposition,
        motionPurpose: selection.motionPurpose,
        motionExclusions: selection.motionExclusions,
        ...observation,
        sourceDetails: shot.details,
        sourceVisualStyle: shot.visualStyle ?? report.visualStyle.description,
        evidenceIds: shot.evidenceIds,
        transition: shot.transition,
      };
    });
    const extracted = await extractReferenceMedia(
      service,
      c,
      report.source.assetId,
      drafts,
    );
    const board = {
      id: boardId,
      accountId: c.accountId,
      type: "storyboard",
      createdAt: new Date().toISOString(),
      version: 1,
      inputHash,
      analysisAssetId: input.analysisAssetId,
      source: report.source,
      brief: input.brief,
      promptMethod: "source-observation-only",
      unknowns: report.unknowns,
      coverageGaps: report.coverage.gaps,
      shots: drafts.map((draft, i) => ({
        ...draft,
        ...extracted[i],
        references: [
          ...(draft.useSourceComposition
            ? [
                {
                  assetId: extracted[i].frame.assetId,
                  role: "composition",
                  instruction: "Source composition only",
                },
              ]
            : []),
          ...input.references,
        ],
      })),
    };
    return service.scoped(c, "write", async (tx) => {
      const concurrent = await tx.get(boardId, c.accountId, "storyboard");
      if (concurrent && concurrent.inputHash !== inputHash)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "Storyboard preparation input changed",
          409,
        );
      return concurrent ?? tx.put(board);
    });
  }
  if (name === "reference_storyboard_review") {
    const input = reviewSchema.parse(raw);
    if (
      input.decision === "accepted" &&
      !Object.values(input.checks).every(Boolean)
    )
      throw new AppError(
        "STORYBOARD_REVIEW_REQUIRED",
        "Resolve failed visual checks before accepting the image",
      );
    return service.scoped(c, "write", async (tx) => {
      const board = await tx.get(input.storyboardId, c.accountId, "storyboard");
      if (!board) throw new AppError("NOT_FOUND", "Storyboard not found", 404);
      getShot(board, input.expectedVersion, input.sourceShotId);
      const image = await tx.get(input.imageAssetId, c.accountId, "asset");
      if (!image || image.kind !== "image")
        throw new AppError("INVALID_MEDIA", "Review requires an owned image");
      const review = {
        imageAssetId: image.id,
        sha256: image.sha256,
        decision: input.decision,
        checks: input.checks,
        notes: input.notes,
        reviewedAt: new Date().toISOString(),
        reviewerKeyId: c.keyId,
      };
      return tx.put({
        ...board,
        version: board.version + 1,
        shots: board.shots.map((s: any) =>
          s.sourceShotId === input.sourceShotId ? { ...s, review } : s,
        ),
      });
    });
  }
  const input = quoteSchema.parse(raw);
  const gateway = cloudConnection(service)?.gateway;
  if (!gateway && serviceMode(service) === "official")
    throw new AppError(
      "REFERENCE_GATEWAY_UNAVAILABLE",
      "Official reference generation requires rikoko-platform support; payment sources are never switched",
      409,
    );
  const board = await service.get(c, "storyboard", input.storyboardId),
    shot = getShot(board, input.expectedVersion, input.sourceShotId);
  if (
    input.stage === "image" &&
    shot.review?.decision === "accepted" &&
    !input.regenerate
  )
    return {
      status: "reused",
      imageAssetId: shot.review.imageAssetId,
      storyboardId: board.id,
      version: board.version,
      instruction:
        "Use the accepted image for the video stage, or explicitly request regeneration.",
    };
  if (input.stage === "video" && shot.review?.decision !== "accepted")
    throw new AppError(
      "STORYBOARD_REVIEW_REQUIRED",
      "Inspect and accept the target image first",
    );
  const models = gateway ? await gateway.models(c) : service.provider.models;
  const model = models.find((m: any) => m.id === input.model),
    mode = model?.generationInput?.mode;
  if (
    !mode ||
    (input.stage === "image"
      ? mode !== "image_edit"
      : !["image_to_video", "reference_to_video", "first_last_frame"].includes(
          mode,
        ))
  )
    throw new AppError(
      "REFERENCE_MODE_UNSUPPORTED",
      "Select an explicitly configured image-edit or image/reference-to-video model",
    );
  if (input.preparedRequestId) {
    const prepared = await service.get(
      c,
      "generation-preparation",
      input.preparedRequestId,
    );
    if (!prepared.plan)
      throw new AppError(
        "PRODUCTION_PLAN_REQUIRED",
        "Bind storyboard generation to a saved target plan",
        409,
      );
    const operation = operationSchema.parse(prepared.input);
    const link = {
      storyboardId: board.id,
      version: board.version,
      sourceShotId: shot.sourceShotId,
      stage: input.stage,
    };
    if (
      operation.kind !== "generate" ||
      operation.model !== input.model ||
      fingerprint(operation.storyboard) !== fingerprint(link) ||
      (input.prompt !== undefined && input.prompt !== operation.prompt) ||
      Object.entries(input.parameters).some(
        ([key, value]) =>
          fingerprint(value) !== fingerprint(operation.parameters[key]),
      ) ||
      (input.target &&
        fingerprint(input.target) !== fingerprint(operation.target)) ||
      (input.lastFrameAssetId &&
        !operation.references?.some(
          (r) =>
            r.role === "last_frame" && r.assetId === input.lastFrameAssetId,
        ))
    )
      throw new AppError(
        "PREPARED_REQUEST_MISMATCH",
        "Use the saved preparation unchanged with its matching storyboard, version, stage and model",
        409,
      );
    const durationMs = generationDurationMs(model!, operation.parameters);
    if (
      input.stage === "video" &&
      (!durationMs || durationMs < shot.durationMs)
    )
      throw new AppError(
        "GENERATION_TOO_SHORT",
        "The prepared output does not cover this storyboard shot",
      );
    return {
      status: "quote_required",
      input: operation,
      quote: gateway
        ? await gateway.quote(c, operation)
        : await service.quote(c, operation),
      targetDurationMs: shot.durationMs,
      generationDurationMs: durationMs,
      instruction:
        "Obtain agreement to this quote, then use job_submit with this exact prepared input and a stable idempotencyKey.",
    };
  }
  throw new AppError(
    "PRODUCTION_PLAN_REQUIRED",
    "Storyboard observations cannot be quoted as target prompts. Save a target plan and supply its preparedRequestId.",
    409,
  );
}
