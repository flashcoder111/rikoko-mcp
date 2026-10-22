import { z } from "zod";
import {
  AppError,
  generationTargetSchema,
  type Entity,
} from "../../contracts/src/index.js";
import {
  generationDurationMs,
  resolveGenerationParameters,
  type AllowedParameters,
} from "./generation-parameters.js";
export function checkGenerationTarget(
  model: {
    parameters?: Record<string, unknown>;
    fixedParameters?: Record<string, unknown>;
    allowedParameters?: AllowedParameters;
    generationInput?: {
      outputDurationMs?: number;
      outputDurationSource?: string;
    };
  },
  input: {
    parameters: Record<string, unknown>;
    mode?: string;
    references?: { assetId: string; role: string }[];
    target?: z.infer<typeof generationTargetSchema>;
  },
  assets: Entity[] = [],
) {
  const parameters = resolveGenerationParameters(
    { ...model, parameters: model.parameters ?? model.fixedParameters ?? {} },
    input.parameters,
  );
  let ratio: number | undefined;
  let aspectSource = "profile";
  const frame = input.references?.find((r) => r.role === "first_frame");
  if (["image_to_video", "first_last_frame"].includes(input.mode ?? "")) {
    const a = assets.find((a) => a.id === frame?.assetId);
    ratio = a?.metadata?.width / a?.metadata?.height;
    aspectSource = "first_frame";
    const last = assets.find((a) =>
      input.references?.some(
        (r) => r.role === "last_frame" && r.assetId === a.id,
      ),
    );
    if (
      last &&
      Number.isFinite(ratio) &&
      Math.abs(last.metadata?.width / last.metadata?.height / ratio! - 1) > 0.02
    )
      throw new AppError(
        "FRAME_ASPECT_MISMATCH",
        "First and last frames must have matching aspect ratios",
      );
  } else if (
    typeof parameters.aspect_ratio === "string" &&
    /^\d+:\d+$/.test(parameters.aspect_ratio)
  ) {
    const [w, h] = parameters.aspect_ratio.split(":").map(Number);
    ratio = w / h;
  } else if (parameters.width && parameters.height)
    ratio = Number(parameters.width) / Number(parameters.height);
  else if (parameters.image_size && typeof parameters.image_size === "object") {
    const size = parameters.image_size as Record<string, unknown>;
    if (
      typeof size.width === "number" &&
      typeof size.height === "number" &&
      Number.isFinite(size.width) &&
      Number.isFinite(size.height) &&
      size.width > 0 &&
      size.height > 0
    )
      ratio = size.width / size.height;
  }
  let durationMs = generationDurationMs(model, input.parameters);
  if (model.generationInput?.outputDurationSource === "source_video") {
    const source = assets.find((a) =>
      input.references?.some(
        (r) => r.role === "source_video" && r.assetId === a.id,
      ),
    );
    durationMs = source?.metadata?.durationMs;
    if (input.mode === "video_to_video" && ratio === undefined && source) {
      ratio = source.metadata?.width / source.metadata?.height;
      aspectSource = "source_video";
    }
  }
  const target = input.target;
  if (
    target?.minDurationMs &&
    (!durationMs || durationMs < target.minDurationMs)
  )
    throw new AppError(
      "GENERATION_TOO_SHORT",
      "The requested generation does not cover the target action duration",
    );
  const mismatch =
    target && Number.isFinite(ratio)
      ? Math.abs(ratio! / (target.width / target.height) - 1) > 0.02
      : false;
  if (target?.aspectPolicy === "match" && (!Number.isFinite(ratio) || mismatch))
    throw new AppError(
      "GENERATION_ASPECT_MISMATCH",
      "Select a matching output aspect ratio or matching first frame. Explicitly choose contain/allow_crop only when that layout is intended",
    );
  return {
    durationMs,
    aspectRatio: Number.isFinite(ratio) ? ratio : null,
    aspectSource,
    target,
    warnings: mismatch
      ? [
          {
            code: "GENERATION_ASPECT_MISMATCH",
            message: `Output will use the explicitly selected ${target!.aspectPolicy} policy`,
          },
        ]
      : [],
  };
}
