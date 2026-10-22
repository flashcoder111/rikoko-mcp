import { applyTemplateSchema } from "./schema.js";
import { z } from "zod";
import { AppError } from "../../contracts/src/index.js";
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const promptContentSchema = z
  .object({
    mode: z.enum(["image", "video"]),
    text: z.string().trim().min(1).max(20000),
    parameters: z
      .record(
        key,
        z
          .object({
            default: z.string().max(4000),
            maxLength: z.number().int().min(1).max(4000),
          })
          .strict(),
      )
      .default({}),
  })
  .strict();
export const promptTemplateSchema = promptContentSchema
  .extend({
    kind: z.literal("prompt"),
    schemaVersion: z.literal(1),
    id: key,
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(2000).default(""),
    category: z.string().max(60).default("Prompt"),
    searchTerms: z.array(z.string().max(100)).max(30).optional(),
  })
  .superRefine((t, ctx) => {
    for (const m of t.text.matchAll(/\{\{([^{}]+)\}\}/g))
      if (!Object.hasOwn(t.parameters, m[1]))
        ctx.addIssue({ code: "custom", message: "Unknown prompt parameter" });
  });
export const applyPromptTemplateSchema = applyTemplateSchema.extend({
  parameters: z.record(key, z.string().max(4000)).default({}),
});
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;
export function renderPrompt(
  t: PromptTemplate,
  values: Record<string, string>,
) {
  if (Object.keys(values).some((k) => !Object.hasOwn(t.parameters, k)))
    throw new AppError("INVALID_INPUT", "Unknown prompt parameter");
  const params: Record<string, string> = Object.create(null);
  for (const [k, p] of Object.entries(t.parameters)) {
    params[k] = values[k] ?? p.default;
    if (params[k].length > p.maxLength)
      throw new AppError("INVALID_INPUT", `Parameter too long: ${k}`);
  }
  return t.text.replace(/\{\{([^{}]+)\}\}/g, (_, k: string) => params[k]);
}
