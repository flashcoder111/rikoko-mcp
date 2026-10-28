import { z } from "zod";
export const guideProtocol = "rikoko-director-guide-v1";
export const legacyGuideTopics = [
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
export const formatTopics = [
  "formats/ugc-ads",
  "formats/talking-head-ads",
  "formats/product-ads",
  "formats/process-broll",
] as const;
export const craftTopics = [
  "craft/production-method",
  "craft/video-direction",
  "craft/directing-examples",
  "craft/image-direction",
  "craft/production-quality",
  "craft/visual-review",
  "craft/media-operations",
  "craft/presenter-performance",
  "craft/product-staging",
] as const;
export const canonicalGuideTopics = [
  "knowledge",
  "formats/index",
  ...formatTopics,
  "craft/index",
  ...craftTopics,
  "models/index",
  "models/prompt-writing",
  "models/seedance-mini",
  "models/minimax-h3",
  "support/overview",
  "support/host-codex",
  "support/host-claude",
  "support/host-hermes",
  "support/analysis-preflight",
  "support/director-kits",
  "support/commands",
  "support/creative-memory",
] as const;
export type CanonicalGuideTopic = (typeof canonicalGuideTopics)[number];
export const guideAliases: Record<
  (typeof legacyGuideTopics)[number],
  CanonicalGuideTopic
> = {
  overview: "support/overview",
  "host-codex": "support/host-codex",
  "host-claude": "support/host-claude",
  "host-hermes": "support/host-hermes",
  "analysis-preflight": "support/analysis-preflight",
  "production-method": "craft/production-method",
  "video-direction": "craft/video-direction",
  "directing-examples": "craft/directing-examples",
  "director-kits": "support/director-kits",
  "ugc-ads": "formats/ugc-ads",
  "talking-head-ads": "formats/talking-head-ads",
  "image-direction": "craft/image-direction",
  "process-broll": "formats/process-broll",
  "production-quality": "craft/production-quality",
  "visual-review": "craft/visual-review",
  commands: "support/commands",
  "media-operations": "craft/media-operations",
  "creative-memory": "support/creative-memory",
};
export const guideTopics = [
  ...legacyGuideTopics,
  ...canonicalGuideTopics,
] as const;
export const directorLayers = ["formats", "craft", "models"] as const;
export type GuideLayer = (typeof directorLayers)[number] | "support";
export type GuideEntry = {
  topic: string;
  path: string;
  title: string;
  layer: GuideLayer;
  kind: "index" | "guide";
  related: string[];
  scope?: { modelIds: string[]; modes?: string[] };
  evidence: {
    status:
      | "existing_guidance"
      | "structure_only"
      | "official_documentation"
      | "external_example"
      | "rikoko_tested";
    sources: { title: string; url: string; note?: string }[];
  };
};
const entry = (
  topic: CanonicalGuideTopic,
  title: string,
  related: CanonicalGuideTopic[] = [],
): GuideEntry => ({
  topic,
  path: `${topic === "knowledge" ? "index" : topic}.md`,
  title,
  layer:
    topic === "knowledge" ? "support" : (topic.split("/")[0] as GuideLayer),
  kind: topic === "knowledge" || topic.endsWith("/index") ? "index" : "guide",
  related,
  evidence: {
    status:
      topic === "knowledge" || topic.endsWith("/index")
        ? "structure_only"
        : "existing_guidance",
    sources: [],
  },
});
const sources = {
  tiktok: {
    title: "TikTok Creative Codes",
    url: "https://ads.tiktok.com/business/en-US/creative-codes",
    note: "Reviewed 2026-10-27; advertising structure, not model validation.",
  },
  presenter: {
    title: "Descript: Talking-head videos (Brandon Copple)",
    url: "https://www.descript.com/blog/article/tips-for-making-a-talking-head-video-that-people-want-to-watch",
    note: "Updated 2026-07-29; production/editorial guidance; examples in rikoko are authored adaptations.",
  },
  googleAction: {
    title: "Google: Action ABCDs Summary",
    url: "https://services.google.com/fh/files/misc/action_abcds_summary.pdf",
    note: "Reviewed 2026-10-27; visible product, concrete use and contextual CTA.",
  },
  googleExamples: {
    title: "YouTube: ABCDs of effective video ads",
    url: "https://www.youtube.com/intl/en_us/ads/abcds-of-effective-video-ads/",
    note: "Publisher-described campaign examples; no claim of independent playback or conversion reproduction.",
  },
  runway: {
    title: "Runway: Gen-4 Video Prompting Guide",
    url: "https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide",
    note: "Reviewed 2026-10-27; transferable image/motion planning only, not a Mini/H3-specific tested rule.",
  },
  seedance: {
    title: "ByteDance: Seedance 2.0 series prompt guide",
    url: "https://docs.volcengine.com/docs/ark/seedance-2-0-prompt-guide?lang=zh",
    note: "Updated 2026-09-22; family-level examples, not Mini-specific empirical evidence.",
  },
  seedanceExamples: {
    title: "ByteDance: Seedance 2.0 launch examples",
    url: "https://seed.bytedance.com/en/blog/seedance-2-0-official-launch",
    note: "Reference-role example from the publisher; not a Mini result or independent playback review.",
  },
  seeapiText: {
    title: "SeeAPI: Seedance 2.0 Mini text API",
    url: "https://www.seeapi.com/docs/seedance-2-mini/text-to-video/",
  },
  seeapiFrames: {
    title: "SeeAPI: Seedance 2.0 Mini frame API",
    url: "https://www.seeapi.com/docs/seedance-2-mini/image-to-video/",
  },
  seeapiReferences: {
    title: "SeeAPI: Seedance 2.0 Mini reference API",
    url: "https://www.seeapi.com/docs/seedance-2-mini/reference-to-video/",
    note: "API contracts reviewed 2026-10-27; rikoko profiles may bind fewer inputs.",
  },
  falMini: {
    title: "fal: Seedance 2.0 Mini reference API",
    url: "https://fal.ai/models/bytedance/seedance-2.0/mini/reference-to-video/api",
    note: "Reference token spelling; actual rikoko adapter/binding order remains authoritative.",
  },
  h3Base: {
    title: "MiniMax H3: base rewrite guide",
    url: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md",
    note: "File revision 5d9b308, reviewed 2026-10-27; rewrite conventions are not rikoko request fields.",
  },
  h3Reference: {
    title: "MiniMax H3: reference rewrite guide",
    url: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md",
    note: "File revision 5d9b308, reviewed 2026-10-27; retain deployment/adapter distinctions.",
  },
  falH3: {
    title: "fal: H3 Max reference API",
    url: "https://fal.ai/models/minimax/h3-max/reference-to-video/api",
    note: "Reviewed 2026-10-27; prose reference labels and prompt expansion settings.",
  },
};
function sourced(
  guide: GuideEntry,
  evidenceSources: GuideEntry["evidence"]["sources"],
  status:
    "official_documentation" | "external_example" = "official_documentation",
): GuideEntry {
  return { ...guide, evidence: { status, sources: evidenceSources } };
}
/** One catalog owns paths, classification, links and evidence; aliases never copy prose. */
export const guideCatalog: GuideEntry[] = [
  entry("knowledge", "Director knowledge", [
    "formats/index",
    "craft/index",
    "models/index",
  ]),
  entry("formats/index", "Content formats", [...formatTopics]),
  sourced(
    entry("formats/ugc-ads", "UGC advertising", [
      "craft/video-direction",
      "craft/image-direction",
      "craft/production-quality",
      "craft/media-operations",
      "craft/presenter-performance",
      "craft/product-staging",
    ]),
    [sources.tiktok],
  ),
  sourced(
    entry("formats/talking-head-ads", "Talking-head advertising", [
      "craft/video-direction",
      "craft/image-direction",
      "craft/media-operations",
      "craft/visual-review",
      "craft/presenter-performance",
    ]),
    [sources.tiktok, sources.presenter],
  ),
  sourced(
    entry("formats/product-ads", "Product advertising", [
      "craft/product-staging",
      "craft/image-direction",
      "craft/production-quality",
      "craft/media-operations",
      "craft/visual-review",
    ]),
    [sources.googleAction, sources.googleExamples],
  ),
  entry("formats/process-broll", "Physical processes and B-roll", [
    "craft/video-direction",
    "craft/production-quality",
    "craft/visual-review",
  ]),
  entry("craft/index", "Directing craft", [...craftTopics]),
  entry("craft/production-method", "Production relationship and method", [
    "craft/video-direction",
    "models/prompt-writing",
  ]),
  entry("craft/video-direction", "Video direction", [
    "craft/directing-examples",
    "models/prompt-writing",
  ]),
  entry("craft/directing-examples", "Shot-direction examples", [
    "craft/video-direction",
    "craft/production-quality",
  ]),
  entry("craft/image-direction", "Images, framing and starting states", [
    "craft/video-direction",
  ]),
  entry("craft/production-quality", "Continuity, process and quality", [
    "craft/media-operations",
    "craft/visual-review",
  ]),
  entry("craft/visual-review", "Observe and judge the work"),
  entry("craft/media-operations", "Sound, captions and editing", [
    "craft/visual-review",
  ]),
  sourced(
    entry(
      "craft/presenter-performance",
      "Presenter performance and speech-led editing",
      [
        "craft/media-operations",
        "craft/visual-review",
        "formats/talking-head-ads",
      ],
    ),
    [sources.presenter],
    "external_example",
  ),
  sourced(
    entry(
      "craft/product-staging",
      "Product staging, material and visual proof",
      [
        "craft/image-direction",
        "craft/production-quality",
        "formats/product-ads",
      ],
    ),
    [sources.runway],
  ),
  entry("models/index", "Model-specific writing", [
    "models/prompt-writing",
    "models/seedance-mini",
    "models/minimax-h3",
  ]),
  entry("models/prompt-writing", "Compiler and model-reference writing", [
    "craft/video-direction",
    "support/director-kits",
  ]),
  {
    ...sourced(
      entry("models/seedance-mini", "Seedance 2.0 Mini writing", [
        "models/prompt-writing",
        "craft/product-staging",
      ]),
      [
        sources.seeapiText,
        sources.seeapiFrames,
        sources.seeapiReferences,
        sources.falMini,
        sources.seedance,
        sources.seedanceExamples,
      ],
    ),
    scope: {
      modelIds: [
        "seedance-mini-text",
        "seedance-mini-first-frame",
        "seedance-mini-first-last",
        "seedance-mini-references",
        "web-seeapi-seedance-mini-text",
        "web-seeapi-seedance-mini-image",
        "web-seeapi-seedance-mini-frames",
        "web-seeapi-seedance-mini-references",
      ],
      modes: [
        "text_to_video",
        "image_to_video",
        "first_last_frame",
        "reference_to_video",
      ],
    },
  },
  {
    ...sourced(
      entry("models/minimax-h3", "MiniMax H3 and H3 Max writing", [
        "models/prompt-writing",
        "craft/presenter-performance",
        "craft/product-staging",
      ]),
      [sources.h3Base, sources.h3Reference, sources.falH3],
    ),
    scope: {
      modelIds: [
        "minimax-h3-768p-5s-16x9",
        "minimax-h3-768p-5s-9x16",
        "minimax-h3-768p-5s-1x1",
        "minimax-storyboard-i2v",
        "minimax-storyboard-first-last",
        "minimax-storyboard-references",
        "minimax-h3-max-text",
        "minimax-h3-max-first-frame",
        "minimax-h3-max-first-last",
      ],
      modes: [
        "text_to_video",
        "image_to_video",
        "first_last_frame",
        "reference_to_video",
      ],
    },
  },
  entry("support/overview", "Director responsibility and workflow", [
    "knowledge",
  ]),
  entry("support/host-codex", "Codex integration"),
  entry("support/host-claude", "Claude integration"),
  entry("support/host-hermes", "Hermes integration"),
  entry("support/analysis-preflight", "Reference-analysis tools", [
    "craft/video-direction",
  ]),
  entry("support/director-kits", "Prompt-kit tools and evidence", [
    "formats/ugc-ads",
    "formats/talking-head-ads",
    "models/prompt-writing",
  ]),
  entry("support/commands", "Commands and capabilities"),
  entry("support/creative-memory", "Creative memory and case ownership"),
];
export const planKnowledgeSchema = z
  .object({
    format: z.enum(formatTopics).optional(),
    crafts: z.array(z.enum(craftTopics)).max(craftTopics.length).optional(),
  })
  .strict();
export const knowledgeSelectionSchema = planKnowledgeSchema
  .extend({
    modelId: z.string().trim().min(1).max(200).optional(),
    mode: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export type KnowledgeSelection = z.infer<typeof knowledgeSelectionSchema>;
export const guideSchema = z
  .object({
    topic: z.enum(guideTopics).default("overview"),
    selection: knowledgeSelectionSchema.optional(),
  })
  .strict();
export type GuideTopic = (typeof guideTopics)[number];
export function canonicalGuideTopic(topic: GuideTopic): CanonicalGuideTopic {
  return Object.hasOwn(guideAliases, topic)
    ? guideAliases[topic as keyof typeof guideAliases]
    : (topic as CanonicalGuideTopic);
}
export function guideEntry(topic: GuideTopic): GuideEntry {
  return guideCatalog.find((g) => g.topic === canonicalGuideTopic(topic))!;
}
export const guideFiles = () =>
  Object.fromEntries(
    guideTopics.map((topic) => [topic, guideEntry(topic).path]),
  );
export const guideCatalogSnapshot = () => ({
  layers: directorLayers,
  entries: guideCatalog,
  aliases: guideAliases,
});

/** Selection is explicit; do not guess content from titles or transfer model syntax by family name. */
export function selectKnowledge(
  selection: KnowledgeSelection = {},
  defaults: string[] = [],
  catalog: GuideEntry[] = guideCatalog,
) {
  const formats = catalog.filter(
    (g) =>
      g.layer === "formats" &&
      g.kind === "guide" &&
      g.topic === selection.format,
  );
  const topics = new Set([
    ...(selection.crafts ?? []),
    ...formats.flatMap((g) => g.related),
    ...defaults,
  ]);
  const craft = catalog.filter(
    (g) => g.layer === "craft" && g.kind === "guide" && topics.has(g.topic),
  );
  const models = !selection.modelId
    ? []
    : catalog.filter(
        (g) =>
          g.layer === "models" &&
          g.kind === "guide" &&
          (!g.scope ||
            (g.scope.modelIds.includes(selection.modelId!) &&
              (!g.scope.modes?.length ||
                (!!selection.mode && g.scope.modes.includes(selection.mode))))),
      );
  return {
    selection,
    formats,
    craft,
    models,
    modelCoverage: !selection.modelId
      ? ("not_selected" as const)
      : models.some((g) => g.scope)
        ? ("specific" as const)
        : ("general_only" as const),
    instruction:
      "Read the selected format, relevant craft, then writing for the actual model and input mode. Sources describe their evidence boundary; external guidance does not require a new paid trial before use. Selection never changes the model, authorizes work or rewrites prepared inputs.",
  };
}
export const guideRequirements = (topic: GuideTopic): string[] => {
  topic = (Object.entries(guideAliases).find(
    ([, canonical]) => canonical === canonicalGuideTopic(topic),
  )?.[0] ?? topic) as GuideTopic;
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
