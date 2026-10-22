import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const guideResultSchema = z.object({
  topic: z.string().min(1),
  markdown: z.string().min(1),
  sha256: hash,
  availableTopics: z.array(z.string().min(1)),
  configuredHost: z.string(),
  guideProtocol: z.string(),
  guideVersion: hash,
  runtimeVersion: z.string().min(1),
  source: z.literal("backend"),
  requiredContracts: z.array(z.string()),
  requiredTools: z.array(z.string()),
});
export const guideCapabilitiesSchema = z.object({
  protocol: z.string(),
  version: hash,
  topics: z.record(z.string(), hash),
  source: z.literal("backend"),
  skillRequired: z.literal(false),
});
