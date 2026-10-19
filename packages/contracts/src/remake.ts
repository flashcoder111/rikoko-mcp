import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const text = z.string().trim().min(1).max(1000);
export const remakeSchema = z
  .object({
    analysisAssetId: id,
    analysisSha256: z.string().regex(/^[a-f0-9]{64}$/),
    changeReason: text.optional(),
    productFacts: z.array(text).max(30).default([]),
    requirements: z
      .array(
        z
          .object({
            id,
            mode: z.enum(["preserve", "adapt", "free"]),
            origin: z.enum(["reference", "user"]).default("reference"),
            description: text,
            sourceShotIds: z.array(id).max(20).default([]),
            evidenceIds: z.array(id).max(30).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    unknownDecisions: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative().max(99),
            disposition: z.enum(["blocking", "not_applicable"]),
            reason: text,
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const requirementUseSchema = z
  .object({
    requirementId: id,
    application: text,
    changeReason: text.optional(),
  })
  .strict();
