import { z } from "zod";
import {
  AppError,
  generationModeSchema,
  generationReferenceSchema,
  type Entity,
} from "../../contracts/src/index.js";
import {
  faceStatusSchema,
  combinedFaceStatus,
  videoModelFamily,
  videoModelRank,
  videoPolicySchema,
  type VideoPolicy,
} from "../../contracts/src/video-policy.js";
import { validateGenerationAssets } from "../../providers/src/generation-input.js";
import type { FalProvider, Model } from "../../providers/src/index.js";

export const videoModelResolveSchema = z
  .object({
    faces: faceStatusSchema,
    reason: z.string().trim().min(1).max(500),
    references: z
      .array(
        generationReferenceSchema
          .extend({
            faces: faceStatusSchema,
            reason: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(12)
      .default([]),
    mode: generationModeSchema.optional(),
    model: z.string().min(1).max(120).optional(),
    userChoice: videoPolicySchema.shape.userChoice,
  })
  .strict();

export function publicGenerationModel(
  model: ReturnType<FalProvider["describe"]>[number],
): Model {
  const profile = model.generationInput;
  const { references, ...limits } = profile ?? { references: [] };
  return {
    id: model.id,
    name: model.name,
    endpoint: "",
    kind: model.kind,
    parameters: model.fixedParameters ?? {},
    maxCostCents: model.maxCostCents,
    hardBoundConfirmed: false,
    priceVersion: model.priceVersion,
    ...(profile
      ? {
          generationInput: {
            ...limits,
            mode: profile.mode,
            maxTotalBytes: profile.maxTotalBytes,
            bindings: references.map((b, i) => ({
              ...b,
              field: `reference_${i}`,
            })),
          },
        }
      : {}),
  };
}

/** Host/user semantic observations. No face detector, uploads, or generation. */
export function resolveVideoModel(
  raw: unknown,
  assets: Entity[],
  models: ReturnType<FalProvider["describe"]>,
) {
  const input = videoModelResolveSchema.parse(raw);
  const reviews = input.references
    .filter(
      (r, i) =>
        assets[i]?.kind !== "audio" &&
        input.references.findIndex((other) => other.assetId === r.assetId) ===
          i,
    )
    .map((r) => {
      const asset = assets.find((a) => a.id === r.assetId);
      if (!asset || !["image", "video"].includes(asset.kind) || !asset.sha256)
        throw new AppError(
          "INVALID_MEDIA",
          "Inspect owned images/videos with verified hashes before selecting a video model",
        );
      return {
        assetId: asset.id,
        sha256: asset.sha256,
        faces: r.faces,
        reason: r.reason,
      };
    });
  // Reusing an asset in two roles must not discard a conflicting observation.
  for (const r of input.references) {
    if (reviews.some((v) => v.assetId === r.assetId && v.faces !== r.faces))
      throw new AppError(
        "INVALID_INPUT",
        "The same asset must have one consistent face assessment",
      );
  }
  const videoPolicy: VideoPolicy = videoPolicySchema.parse({
    faces: input.faces,
    reason: input.reason,
    references: reviews,
    ...(input.userChoice ? { userChoice: input.userChoice } : {}),
  });
  const faces = combinedFaceStatus(videoPolicy);
  const references = input.references.map(({ assetId, role }) => ({
    assetId,
    role,
  }));
  const excluded: { modelId: string; reason: string }[] = [];
  const candidates = models
    .filter((m) => m.kind === "video")
    .filter((m) => {
      const family = videoModelFamily(m);
      let reason;
      if (!m.available) reason = "Model is not configured/available";
      else if (faces !== "absent" && !["minimax", "kling"].includes(family))
        reason =
          family === "seedance"
            ? "SEEDANCE_FACE_BLOCKED"
            : "Face tasks support MiniMax or Kling";
      else if (input.mode && m.generationInput?.mode !== input.mode)
        reason = "Incompatible input mode";
      else {
        try {
          validateGenerationAssets(
            publicGenerationModel(m),
            {
              kind: "generate",
              model: m.id,
              prompt: "Compatibility check",
              parameters: {},
              ...(m.generationInput ? { mode: m.generationInput.mode } : {}),
              ...(references.length ? { references } : {}),
            },
            assets,
          );
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          reason = e.message;
        }
      }
      if (reason) excluded.push({ modelId: m.id, reason });
      return !reason;
    })
    .sort((a, b) => videoModelRank(a, faces) - videoModelRank(b, faces));
  const requested = input.userChoice?.model ?? input.model;
  const selected = requested
    ? candidates.find((m) => m.id === requested)
    : candidates[0];
  const confirmed = selected && input.userChoice?.model === selected.id;
  const choiceRequired =
    faces !== "absent" ||
    (!!selected && !requested && videoModelRank(selected, faces) !== 0);
  const ready = !!selected && (!choiceRequired || !!confirmed);
  return {
    status: !candidates.length
      ? "capability_gap"
      : ready
        ? "ready"
        : "user_choice_required",
    faceStatus: faces,
    defaultPreference: faces === "absent" ? "Seedance Mini" : "MiniMax",
    candidates: candidates.map((m) => ({
      modelId: m.id,
      name: m.name,
      family: videoModelFamily(m),
      mode: m.generationInput?.mode ?? "text_to_video",
    })),
    excluded,
    recommendedModel: candidates[0]?.id ?? null,
    selectedModel: selected?.id ?? null,
    videoPolicy,
    ...(selected
      ? {
          input: {
            model: selected.id,
            videoPolicy,
            ...(selected.generationInput
              ? { mode: selected.generationInput.mode }
              : {}),
            ...(references.length ? { references } : {}),
          },
        }
      : {}),
    userInteraction: {
      required: !ready,
      message:
        faces !== "absent"
          ? "任务涉及人脸或尚不能确认无人脸，不能调用 Seedance 系列。默认推荐兼容的 MiniMax，也可以选择 Kling。请确认模型后继续。"
          : "默认使用兼容的 Seedance Mini；若不可用或不支持当前输入，请确认其他模型后继续。",
      choices: candidates.map((m) => ({ model: m.id, label: m.name })),
      instruction:
        "Ask in the original conversation. Record userChoice only after the user chooses; reuse an existing explicit choice for this unchanged task. Do not infer confirmation from the recommendation.",
    },
    generated: false,
    evidenceBoundary:
      "Host/user assessment of actual pixels and the brief, not automatic face detection or identity recognition. Inspect the complete supplied video; sampled frames cannot establish absence throughout. Unknown blocks all Seedance variants. Model choice is separate from spending authorization.",
  };
}
