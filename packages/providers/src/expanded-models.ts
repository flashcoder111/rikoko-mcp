import type { Model } from "./index.js";

/** Public fal schemas/prices reviewed 2026-10-21; see docs/integrations/expanded-models.md.
 * Bounds cover every exposed duration/resolution and reference combination.
 * Credentials, paid enablement and per-request authorization are still required.
 */
const frame = {
  kind: "image" as const,
  array: false,
  min: 1,
  max: 1,
  maxBytes: 10 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp"],
};
const kling: Model = {
  id: "kling-v3-pro-text",
  name: "Kling 3.0 Pro · Text to video",
  description: "3–15 seconds · native audio · selectable aspect ratio",
  endpoint: "fal-ai/kling-video/v3/pro/text-to-video",
  kind: "video",
  maxCostCents: 252,
  priceVersion: "fal-2026-10-21-kling-v3-pro-audio-usd0.168-per-second",
  hardBoundConfirmed: true,
  parameters: {
    duration: "5",
    generate_audio: true,
    enable_safety_checker: true,
  },
  allowedParameters: {
    duration: {
      type: "enum",
      values: Array.from({ length: 13 }, (_, i) => String(i + 3)),
    },
  },
};
const wan: Model = {
  id: "wan-v2-6-text",
  name: "Wan 2.6 · Text to video",
  description:
    "5/10/15 seconds · 720p/1080p · face-free tasks under rikoko policy",
  endpoint: "wan/v2.6/text-to-video",
  kind: "video",
  maxCostCents: 225,
  priceVersion: "fal-2026-10-21-wan-v2.6-1080p-usd0.15-per-second",
  hardBoundConfirmed: true,
  maxPromptLength: 1500,
  parameters: {
    duration: "5",
    resolution: "720p",
    enable_prompt_expansion: false,
    multi_shots: false,
    enable_safety_checker: true,
  },
  allowedParameters: {
    duration: { type: "enum", values: ["5", "10", "15"] },
    resolution: { type: "enum", values: ["720p", "1080p"] },
  },
};
const hailuo: Model = {
  id: "minimax-hailuo-2-3-text",
  name: "MiniMax Hailuo 2.3 · Text to video",
  description: "6/10 seconds · 768p · prompt optimization disabled",
  endpoint: "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
  kind: "video",
  maxCostCents: 56,
  priceVersion: "fal-2026-10-21-hailuo-2.3-standard-usd0.56-per-10s",
  hardBoundConfirmed: true,
  parameters: {
    duration: "6",
    prompt_optimizer: false,
    enable_safety_checker: true,
  },
  allowedParameters: { duration: { type: "enum", values: ["6", "10"] } },
};
const flux: Model = {
  id: "flux-2-pro-text",
  name: "FLUX.2 Pro · Text to image",
  description: "One 1024 × 1024 image · PNG",
  endpoint: "fal-ai/flux-2-pro",
  kind: "image",
  // Conservatively round 1024² up to two decimal megapixels and then to cents.
  maxCostCents: 5,
  priceVersion: "fal-2026-10-21-flux-2-pro-usd0.03-first-mp-0.015-extra-mp",
  hardBoundConfirmed: true,
  parameters: {
    image_size: { width: 1024, height: 1024 },
    output_format: "png",
    enable_safety_checker: true,
    safety_tolerance: "2",
    sync_mode: false,
  },
};

export const expandedModels: Model[] = [
  {
    ...kling,
    parameters: { ...kling.parameters, aspect_ratio: "16:9" },
    allowedParameters: {
      ...kling.allowedParameters,
      aspect_ratio: { type: "enum", values: ["16:9", "9:16", "1:1"] },
    },
  },
  ...([false, true] as const).map((last): Model => ({
    ...kling,
    id: last ? "kling-v3-pro-first-last" : "kling-v3-pro-first-frame",
    name: `Kling 3.0 Pro · ${last ? "First and last frames" : "First frame"}`,
    description: "3–15 seconds · native audio · aspect ratio from first frame",
    endpoint: "fal-ai/kling-video/v3/pro/image-to-video",
    generationInput: {
      mode: last ? "first_last_frame" : "image_to_video",
      referenceSyntax: "descriptive",
      outputDurationMs: 5000,
      maxTotalBytes: 20 * 1024 * 1024,
      bindings: [
        { ...frame, field: "start_image_url", roles: ["first_frame"] },
        ...(last
          ? [
              {
                ...frame,
                field: "end_image_url",
                roles: ["last_frame" as const],
              },
            ]
          : []),
      ],
    },
  })),
  {
    ...wan,
    parameters: { ...wan.parameters, aspect_ratio: "16:9" },
    allowedParameters: {
      ...wan.allowedParameters,
      aspect_ratio: {
        type: "enum",
        values: ["16:9", "9:16", "1:1", "4:3", "3:4"],
      },
    },
  },
  {
    ...wan,
    id: "wan-v2-6-first-frame",
    name: "Wan 2.6 · First frame",
    endpoint: "wan/v2.6/image-to-video",
    generationInput: {
      mode: "image_to_video",
      outputDurationMs: 5000,
      maxTotalBytes: 10 * 1024 * 1024,
      bindings: [
        {
          ...frame,
          field: "image_url",
          roles: ["first_frame"],
          minDimension: 240,
          maxDimension: 4096,
        },
      ],
    },
  },
  hailuo,
  {
    ...hailuo,
    id: "minimax-hailuo-2-3-first-frame",
    name: "MiniMax Hailuo 2.3 · First frame",
    endpoint: "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
    generationInput: {
      mode: "image_to_video",
      outputDurationMs: 6000,
      maxTotalBytes: 10 * 1024 * 1024,
      bindings: [{ ...frame, field: "image_url", roles: ["first_frame"] }],
    },
  },
  flux,
  {
    ...flux,
    id: "flux-2-pro-edit",
    name: "FLUX.2 Pro · Image editing",
    description:
      "One 1024 × 1024 PNG · 1–4 reference images, at most 1024² pixels each",
    endpoint: "fal-ai/flux-2-pro/edit",
    // Four inputs at <=2 decimal MP each, output <=2 MP: 3 + 9 × 1.5 = 16.5 cents.
    maxCostCents: 17,
    generationInput: {
      mode: "image_edit",
      referenceSyntax: "descriptive",
      maxTotalBytes: 40 * 1024 * 1024,
      bindings: [
        {
          ...frame,
          field: "image_urls",
          array: true,
          max: 4,
          maxPixels: 1024 * 1024,
          roles: ["composition", "character", "product", "scene", "style"],
        },
      ],
    },
  },
];
