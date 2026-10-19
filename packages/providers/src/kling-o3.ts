import type { Model } from "./index.js";

/** Conservative fal profile. Enable credentials and confirm the 15-second cost bound before paid use. */
export const klingO3Models: Model[] = [
  {
    id: "kling-o3-video-edit",
    name: "Kling O3 Pro · Video editing",
    description:
      "Edit 3–15-second MP4/MOV clips with up to 4 character or scene reference images. Preserve source audio and duration. Placeholder cost; review pricing before enabling. Review continuity.",
    endpoint: "fal-ai/kling-video/o3/pro/video-to-video/edit",
    kind: "video",
    maxCostCents: 100,
    priceVersion: "EXAMPLE-REPLACE-AFTER-PRICING-REVIEW",
    hardBoundConfirmed: false,
    parameters: { keep_audio: true },
    generationInput: {
      referenceSyntax: "kling",
      mode: "video_to_video",
      outputDurationSource: "source_video",
      maxTotalBytes: 41943040,
      bindings: [
        {
          field: "video_url",
          roles: ["source_video"],
          kind: "video",
          array: false,
          min: 1,
          max: 1,
          maxBytes: 20971520,
          mimeTypes: ["video/mp4", "video/quicktime"],
          containers: ["mp4", "mov"],
          minDimension: 720,
          maxDimension: 3840,
          minDurationMs: 3000,
          maxDurationMs: 15000,
        },
        {
          field: "image_urls",
          roles: ["character", "product", "scene", "style", "composition"],
          kind: "image",
          array: true,
          min: 0,
          max: 4,
          maxBytes: 10485760,
          maxPixels: 16777216,
        },
      ],
    },
  },
];
