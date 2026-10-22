import type { Model } from "./index.js";

/** fal schemas checked 2026-10-21. No paid enablement or reviewed cost bound is implied.
 * https://fal.ai/models/bytedance/seedance-2.0/mini/text-to-video/api
 * https://fal.ai/models/bytedance/seedance-2.0/mini/image-to-video/api
 * https://fal.ai/models/bytedance/seedance-2.0/mini/reference-to-video/api
 * Conservative reference sizes stay within rikoko's existing transport limits.
 */
const base: Model = {
  id: "seedance-mini-text",
  name: "Seedance 2.0 Mini · Text to video",
  description:
    "Face-free tasks only. Verify the account's pricing/cost bound before enabling.",
  endpoint: "bytedance/seedance-2.0/mini/text-to-video",
  kind: "video",
  maxCostCents: 300,
  priceVersion: "EXAMPLE-REPLACE-AFTER-PRICING-REVIEW",
  hardBoundConfirmed: false,
  parameters: {
    duration: "5",
    resolution: "720p",
    aspect_ratio: "16:9",
    generate_audio: true,
    codec: "H264",
  },
  allowedParameters: {
    duration: {
      type: "enum",
      values: Array.from({ length: 12 }, (_, i) => String(i + 4)),
    },
    resolution: { type: "enum", values: ["480p", "720p"] },
    aspect_ratio: {
      type: "enum",
      values: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
  },
};
const image = {
  kind: "image" as const,
  min: 1,
  max: 1,
  array: false,
  maxBytes: 20 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp"],
};
export const seedanceMiniModels: Model[] = [
  base,
  {
    ...base,
    id: "seedance-mini-first-frame",
    name: "Seedance 2.0 Mini · First frame",
    endpoint: "bytedance/seedance-2.0/mini/image-to-video",
    generationInput: {
      mode: "image_to_video",
      outputDurationMs: 5000,
      maxTotalBytes: 40 * 1024 * 1024,
      bindings: [{ ...image, field: "image_url", roles: ["first_frame"] }],
    },
  },
  {
    ...base,
    id: "seedance-mini-first-last",
    name: "Seedance 2.0 Mini · First and last frames",
    endpoint: "bytedance/seedance-2.0/mini/image-to-video",
    generationInput: {
      mode: "first_last_frame",
      outputDurationMs: 5000,
      maxTotalBytes: 40 * 1024 * 1024,
      bindings: [
        { ...image, field: "image_url", roles: ["first_frame"] },
        { ...image, field: "end_image_url", roles: ["last_frame"] },
      ],
    },
  },
  {
    ...base,
    id: "seedance-mini-references",
    name: "Seedance 2.0 Mini · Image and video references",
    endpoint: "bytedance/seedance-2.0/mini/reference-to-video",
    generationInput: {
      mode: "reference_to_video",
      referenceSyntax: "seedance",
      outputDurationMs: 5000,
      maxTotalBytes: 40 * 1024 * 1024,
      bindings: [
        {
          ...image,
          field: "image_urls",
          roles: ["character", "product", "scene", "style", "composition"],
          array: true,
          min: 0,
          max: 9,
        },
        {
          field: "video_urls",
          roles: ["motion"],
          kind: "video",
          array: true,
          min: 0,
          max: 3,
          maxBytes: 20 * 1024 * 1024,
          mimeTypes: ["video/mp4", "video/quicktime"],
          containers: ["mp4", "mov"],
          minDurationMs: 2000,
          maxDurationMs: 15000,
          maxTotalDurationMs: 15000,
          minDimension: 640,
          maxDimension: 1112,
          maxPixels: 927408,
        },
      ],
    },
  },
];
