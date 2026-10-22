import type { Model } from "./index.js";

/** Current fal catalog checked 2026-10-21. Exact schemas and price evidence:
 * docs/integrations/latest-models.md and tests/fixtures/fal-latest-schemas.json.
 * No promotional rate is used as a permanent cost bound.
 */
const image = {
  kind: "image" as const,
  array: false,
  min: 1,
  max: 1,
  maxBytes: 10 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp"],
};
const aspects = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
function frameVariants(
  base: Model,
  endpoint: string,
  autoAspect = false,
): Model[] {
  return [false, true].map((last): Model => ({
    ...base,
    id: base.id.replace(/-text$/, last ? "-first-last" : "-first-frame"),
    name: base.name!.replace(
      "Text to video",
      last ? "First and last frames" : "First frame",
    ),
    endpoint,
    parameters: {
      ...base.parameters,
      ...(autoAspect ? { aspect_ratio: "auto" } : {}),
    },
    generationInput: {
      mode: last ? "first_last_frame" : "image_to_video",
      referenceSyntax: "descriptive",
      outputDurationMs: 5000,
      maxTotalBytes: 20 * 1024 * 1024,
      bindings: [
        { ...image, field: "image_url", roles: ["first_frame"] },
        ...(last
          ? [
              {
                ...image,
                field: "end_image_url",
                roles: ["last_frame" as const],
              },
            ]
          : []),
      ],
    },
  }));
}
const flux: Model = {
  id: "flux-3-max-text",
  name: "FLUX 3 Max · Text to video",
  description:
    "5–20 seconds · 720p/1080p · native audio · face-free tasks under rikoko policy",
  endpoint: "blackforestlabs/flux-3-max/text-to-video",
  kind: "video",
  maxCostCents: 580,
  hardBoundConfirmed: true,
  priceVersion: "fal-2026-10-21-flux-3-max-list-1080p-usd0.29-per-second",
  parameters: {
    duration: 5,
    resolution: "720p",
    generate_audio: true,
    reasoning_level: "low",
  },
  allowedParameters: {
    duration: { type: "integer", min: 5, max: 20 },
    resolution: { type: "enum", values: ["720p", "1080p"] },
  },
};
const h3: Model = {
  id: "minimax-h3-max-text",
  name: "MiniMax H3 Max · Text to video",
  description: "1–15 seconds · 480P/768P/1080P · prompt expansion disabled",
  endpoint: "minimax/h3-max/text-to-video",
  kind: "video",
  // Upstream can run ~0.7s long; reserve 16s at the highest non-promotional rate.
  maxCostCents: 256,
  hardBoundConfirmed: true,
  priceVersion: "fal-2026-10-21-h3-max-list-1080p-usd0.16-per-second-16s-bound",
  parameters: {
    duration: 5,
    resolution: "768P",
    prompt_expansion_mode: "disabled",
    enable_safety_checker: true,
    sync_mode: false,
  },
  allowedParameters: {
    duration: { type: "number", min: 1, max: 15 },
    resolution: { type: "enum", values: ["480P", "768P", "1080P"] },
  },
};
const seedance: Model = {
  id: "seedance-2-5-text",
  name: "Seedance 2.5 US · Text to video",
  description:
    "Face-free only · 4–30 seconds · 480p/720p/1080p · cost bound requires review",
  endpoint: "bytedance/seedance-2.5/us/text-to-video",
  kind: "video",
  // Token billing depends on actual output dimensions; this is NOT a reviewed quote.
  maxCostCents: 5000,
  hardBoundConfirmed: false,
  priceVersion: "UNREVIEWED-seedance-2.5-output-token-bound",
  parameters: {
    duration: "5",
    resolution: "720p",
    generate_audio: true,
    bitrate_mode: "standard",
    codec: "H264",
  },
  allowedParameters: {
    duration: {
      type: "enum",
      values: Array.from({ length: 27 }, (_, i) => String(i + 4)),
    },
    resolution: { type: "enum", values: ["480p", "720p", "1080p"] },
  },
};
const nano: Model = {
  id: "nano-banana-2-1-text",
  name: "Nano Banana 2.1 · Text to image",
  description: "One image · 1K/2K/4K · token-based cost bound requires review",
  endpoint: "google/nano-banana-2.1",
  kind: "image",
  minPromptLength: 3,
  // Public per-image examples exclude unbounded text/thinking output: keep unavailable.
  maxCostCents: 100,
  hardBoundConfirmed: false,
  priceVersion: "UNREVIEWED-nano-banana-2.1-token-bound",
  parameters: {
    num_images: 1,
    resolution: "1K",
    aspect_ratio: "1:1",
    output_format: "png",
    safety_tolerance: "4",
    sync_mode: false,
    thinking_level: "minimal",
    limit_generations: true,
    enable_web_search: false,
  },
  allowedParameters: {
    resolution: { type: "enum", values: ["1K", "2K", "4K"] },
    aspect_ratio: {
      type: "enum",
      values: [
        ...aspects,
        "3:2",
        "5:4",
        "4:5",
        "2:3",
        "4:1",
        "1:4",
        "8:1",
        "1:8",
      ],
    },
  },
};
export const latestModels: Model[] = [
  {
    ...flux,
    parameters: { ...flux.parameters, aspect_ratio: "16:9" },
    allowedParameters: {
      ...flux.allowedParameters,
      aspect_ratio: { type: "enum", values: [...aspects, "2:1"] },
    },
  },
  ...frameVariants(flux, "blackforestlabs/flux-3-max/image-to-video", true),
  {
    ...h3,
    parameters: { ...h3.parameters, aspect_ratio: "16:9" },
    allowedParameters: {
      ...h3.allowedParameters,
      aspect_ratio: { type: "enum", values: aspects },
    },
  },
  ...frameVariants(h3, "minimax/h3-max/image-to-video"),
  {
    ...seedance,
    parameters: { ...seedance.parameters, aspect_ratio: "16:9" },
    allowedParameters: {
      ...seedance.allowedParameters,
      aspect_ratio: { type: "enum", values: aspects },
    },
  },
  ...frameVariants(seedance, "bytedance/seedance-2.5/us/image-to-video", true),
  nano,
  {
    ...nano,
    id: "nano-banana-2-1-edit",
    name: "Nano Banana 2.1 · Image editing",
    endpoint: "google/nano-banana-2.1/edit",
    generationInput: {
      mode: "image_edit",
      referenceSyntax: "descriptive",
      maxTotalBytes: 40 * 1024 * 1024,
      bindings: [
        {
          ...image,
          field: "image_urls",
          array: true,
          max: 4,
          maxPixels: 4096 * 4096,
          roles: ["composition", "character", "product", "scene", "style"],
        },
      ],
    },
  },
  {
    id: "krea-3-berry",
    name: "Krea 3 Berry · Text to image",
    description: "One 1024 × 1024 PNG · quality variant · low reasoning",
    endpoint: "krea/v3/text-to-image",
    kind: "image",
    maxCostCents: 5,
    hardBoundConfirmed: true,
    priceVersion: "fal-2026-10-21-krea-v3-usd0.025-per-output-mp",
    parameters: {
      model: "berry",
      image_size: { width: 1024, height: 1024 },
      reasoning_level: "low",
      output_format: "png",
      sync_mode: false,
      enable_safety_checker: true,
    },
  },
];
