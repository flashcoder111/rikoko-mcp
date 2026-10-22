import { z } from "zod";
export const guideProtocol = "rikoko-director-guide-v1";
export const guideTopics = [
  "overview",
  "host-codex",
  "host-claude",
  "host-hermes",
  "analysis-preflight",
  "production-method",
  "video-direction",
  "directing-examples",
  "director-kits",
  "ugc-ads",
  "talking-head-ads",
  "image-direction",
  "process-broll",
  "production-quality",
  "visual-review",
  "commands",
  "media-operations",
  "creative-memory",
] as const;
export const guideSchema = z
  .object({ topic: z.enum(guideTopics).default("overview") })
  .strict();
export type GuideTopic = (typeof guideTopics)[number];
export const guideRequirements = (topic: GuideTopic): string[] => {
  if (topic === "overview")
    return [
      "capabilities",
      "workspace_request_save",
      "production_plan_save",
      "video_model_resolve",
      "task_usage",
    ];
  if (topic === "production-method")
    return [
      "production_method_resolve",
      "video_model_resolve",
      "production_plan_save",
      "production_editing_preview",
    ];
  if (
    ["video-direction", "directing-examples", "process-broll"].includes(topic)
  )
    return [
      "production_plan_validate",
      "production_plan_save",
      "production_shot_prompts",
      "generation_prepare",
    ];
  if (["director-kits", "ugc-ads", "talking-head-ads"].includes(topic))
    return ["director_catalog", "production_shot_prompts"];
  if (topic === "visual-review")
    return ["media_inspect", "media_review", "workspace_result"];
  if (topic === "analysis-preflight")
    return ["reference_analyze", "reference_analysis_get"];
  return ["capabilities"];
};
