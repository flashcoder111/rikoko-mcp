import { z } from "zod";
import { AppError } from "../../contracts/src/index.js";

const rule = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("number"),
      min: z.number().finite().positive(),
      max: z.number().finite().positive().max(4096),
    })
    .strict()
    .refine((r) => r.max >= r.min),
  z
    .object({
      type: z.literal("enum"),
      values: z
        .array(z.union([z.string().max(40), z.number().finite(), z.boolean()]))
        .min(1)
        .max(30),
    })
    .strict(),
  z
    .object({
      type: z.literal("integer"),
      min: z.number().int().positive(),
      max: z.number().int().positive().max(4096),
    })
    .strict()
    .refine((r) => r.max >= r.min),
]);
// Output controls only. URLs, prompts, model names and input bindings are never overridable.
export const allowedParametersSchema = z
  .object({
    duration: rule.optional(),
    aspect_ratio: rule.optional(),
    resolution: rule.optional(),
  })
  .strict();
export type AllowedParameters = z.infer<typeof allowedParametersSchema>;
export function resolveGenerationParameters(
  model: {
    parameters: Record<string, unknown>;
    allowedParameters?: AllowedParameters;
  },
  overrides: Record<string, unknown> = {},
) {
  const allowed = allowedParametersSchema.parse(model.allowedParameters ?? {});
  for (const [key, value] of Object.entries(overrides)) {
    const spec = allowed[key as keyof AllowedParameters];
    if (
      !spec ||
      (spec.type === "enum"
        ? !spec.values.includes(value as any)
        : typeof value !== "number" ||
          !Number.isFinite(value) ||
          (spec.type === "integer" && !Number.isInteger(value)) ||
          value < spec.min ||
          value > spec.max)
    )
      throw new AppError(
        "INVALID_MODEL_INPUT",
        `Unsupported generation parameter ${key}; undeclared parameters remain fixed by the model profile`,
      );
  }
  return { ...model.parameters, ...overrides };
}

export function generationDurationMs(
  model: {
    parameters?: Record<string, unknown>;
    fixedParameters?: Record<string, unknown>;
    generationInput?: { outputDurationMs?: number };
    allowedParameters?: AllowedParameters;
  },
  overrides: Record<string, unknown> = {},
) {
  const values = resolveGenerationParameters(
    { ...model, parameters: model.parameters ?? model.fixedParameters ?? {} },
    overrides,
  );
  const duration = Number(values.duration);
  if (
    !model.allowedParameters?.duration &&
    model.generationInput?.outputDurationMs
  )
    return model.generationInput.outputDurationMs;
  return Number.isFinite(duration) && duration > 0
    ? Math.round(duration * 1000)
    : model.generationInput?.outputDurationMs;
}
