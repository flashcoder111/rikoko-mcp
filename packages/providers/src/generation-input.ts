import {
  AppError,
  generationInputSchema,
  type Entity,
  type GenerationReference,
  type Operation,
} from "../../contracts/src/index.js";
import type { Model } from "./index.js";
export type ResolvedReference = GenerationReference & { url: string };
const referenceMimeTypes = {
  image: ["image/png", "image/jpeg", "image/webp"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  audio: ["audio/wav", "audio/mpeg", "audio/mp4"],
};
export function validateGenerationInput(model: Model, input: Operation) {
  if (input.kind !== "generate") return;
  const refs = input.references ?? [];
  if (!model.generationInput) {
    if (refs.length || input.mode || input.storyboard)
      throw new AppError(
        "REFERENCE_MODE_UNSUPPORTED",
        "This model profile does not declare reference generation; choose a compatible profile",
      );
    return;
  }
  const p = generationInputSchema.parse(model.generationInput);
  if (
    (p.mode === "image_edit"
      ? model.kind !== "image"
      : model.kind !== "video") ||
    input.mode !== p.mode
  )
    throw new AppError(
      "REFERENCE_MODE_UNSUPPORTED",
      "Generation mode does not match the selected model profile",
    );
  if (
    p.bindings.some(
      (b) =>
        b.field === (model.promptField ?? "prompt") ||
        Object.hasOwn(model.parameters, b.field),
    )
  )
    throw new AppError(
      "INVALID_PROVIDER_CONFIG",
      "Reference fields cannot override prompts or fixed parameters",
    );
  if (
    !refs.length ||
    refs.some((r) => !p.bindings.some((b) => b.roles.includes(r.role)))
  )
    throw new AppError(
      "INVALID_MODEL_INPUT",
      "Missing or unsupported reference role",
    );
  const unique = new Set(refs.map((r) => `${r.role}:${r.assetId}`));
  if (unique.size !== refs.length)
    throw new AppError(
      "INVALID_MODEL_INPUT",
      "Duplicate reference role and asset",
    );
  for (const b of p.bindings) {
    const count = refs.filter((r) => b.roles.includes(r.role)).length;
    if (count < b.min || count > b.max)
      throw new AppError(
        "INVALID_MODEL_INPUT",
        `Reference count for ${b.field} must be ${b.min}..${b.max}`,
      );
  }
}
export function validateGenerationAssets(
  model: Model,
  input: Operation,
  assets: Entity[],
) {
  validateGenerationInput(model, input);
  if (input.kind !== "generate" || !model.generationInput) return;
  const p = model.generationInput,
    refs = input.references ?? [];
  let bytes = 0;
  const durations = new Map<string, number>();
  for (let i = 0; i < refs.length; i++) {
    const a = assets[i],
      b = p.bindings.find((b) => b.roles.includes(refs[i].role))!;
    if (
      !a ||
      a.id !== refs[i].assetId ||
      a.kind !== b.kind ||
      !Number.isSafeInteger(a.bytes) ||
      a.bytes <= 0 ||
      !referenceMimeTypes[b.kind].includes(a.mime)
    )
      throw new AppError(
        "INVALID_MEDIA",
        "Reference must be an owned, probed image, video or audio of the declared kind",
      );
    bytes += a.bytes;
    if (a.bytes > b.maxBytes || bytes > p.maxTotalBytes)
      throw new AppError(
        "REFERENCE_LIMIT",
        "Reference files exceed the quoted byte limits",
      );
    if (
      b.kind === "image" &&
      (!Number.isFinite(a.metadata?.width) ||
        !Number.isFinite(a.metadata?.height) ||
        a.metadata.width <= 0 ||
        a.metadata.height <= 0 ||
        (b.maxPixels && a.metadata.width * a.metadata.height > b.maxPixels))
    )
      throw new AppError(
        "REFERENCE_LIMIT",
        "Reference image dimensions exceed the configured limits or are unknown",
      );
    if (b.kind !== "image") {
      const duration = a.metadata?.durationMs;
      const total = (durations.get(b.field) ?? 0) + duration;
      if (
        !Number.isSafeInteger(duration) ||
        duration <= 0 ||
        duration < (b.minDurationMs ?? 0) ||
        duration > (b.maxDurationMs ?? 600000) ||
        total > (b.maxTotalDurationMs ?? 600000)
      )
        throw new AppError(
          "REFERENCE_LIMIT",
          "Reference duration exceeds the configured limits or is unknown",
        );
      durations.set(b.field, total);
    }
  }
}
export function generationPayload(
  model: Model,
  input: Operation,
  resolved: ResolvedReference[] = [],
) {
  if (input.kind !== "generate") return {};
  validateGenerationInput(model, input);
  const refs = input.references ?? [];
  if (
    refs.length !== resolved.length ||
    refs.some(
      (r, i) =>
        r.assetId !== resolved[i].assetId || r.role !== resolved[i].role,
    )
  )
    throw new AppError(
      "INVALID_MODEL_INPUT",
      "References must be resolved in the quoted order",
    );
  const result: Record<string, string | string[]> = {};
  for (const b of model.generationInput?.bindings ?? []) {
    const urls = resolved
      .filter((r) => b.roles.includes(r.role))
      .map((r) => {
        const data = /^data:([^;,]+);base64,/.exec(r.url);
        if (data) {
          const body = r.url.slice(data[0].length);
          if (
            referenceMimeTypes[b.kind].includes(data[1]) &&
            body.length > 0 &&
            body.length <= Math.ceil(b.maxBytes / 3) * 4 &&
            body.length % 4 === 0 &&
            /^[A-Za-z0-9+/]*={0,2}$/.test(body)
          )
            return r.url;
        } else {
          try {
            const url = new URL(r.url);
            if (
              url.protocol === "https:" &&
              !url.username &&
              !url.password &&
              !url.hash
            )
              return r.url;
          } catch {
            /* The error below intentionally omits the reference URL. */
          }
        }
        throw new AppError(
          "INVALID_MEDIA",
          "Resolved reference must be a controlled HTTPS URL or a bounded media data URI",
        );
      });
    if (urls.length) result[b.field] = b.array ? urls : urls[0];
  }
  return result;
}
