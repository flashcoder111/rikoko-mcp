/** Reference controls mirror the current fal H3 Max API. Reference clips remain <=15 seconds combined. */
export const minimaxReferenceControls = {
  duration: { type: "number" as const, min: 1, max: 15 },
  resolution: { type: "enum" as const, values: ["480P", "768P", "1080P"] },
  aspect_ratio: {
    type: "enum" as const,
    values: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  },
};

import type { Model } from "./index.js";
/** Fixed profiles checked against fal's public schema/prices on 2026-10-11.
 * https://fal.ai/models/minimax/h3/text-to-video
 * Paid execution still requires FAL_KEY, ENABLE_PAID_PROVIDERS and account budget.
 */
export const h3Models: Model[] = ["16:9", "9:16", "1:1"].map((aspect) => ({
  id: `minimax-h3-768p-5s-${aspect.replace(":", "x")}`,
  name: `MiniMax H3 · ${aspect}`,
  description: "5–15 seconds · 768P · selectable aspect ratio",
  endpoint: "minimax/h3/text-to-video",
  kind: "video",
  maxCostCents: 90,
  priceVersion: "fal-h3-2026-10-11-768p-usd0.06-per-second",
  hardBoundConfirmed: true,
  parameters: {
    duration: 5,
    resolution: "768P",
    aspect_ratio: aspect,
    prompt_expansion_mode: "disabled",
    enable_safety_checker: true,
  },
  promptField: "prompt",
  allowedParameters: {
    duration: { type: "integer", min: 5, max: 15 },
    aspect_ratio: {
      type: "enum",
      values: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    },
  },
}));
