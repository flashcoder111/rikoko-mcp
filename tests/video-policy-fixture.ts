import type { VideoPolicy } from "../packages/contracts/src/video-policy.js";

/** Synthetic contract evidence only; never a real-media face inspection. */
export function faceFreeFixturePolicy(
  assets: { id: string; sha256?: string; kind?: string }[],
): VideoPolicy {
  return {
    faces: "absent",
    reason: "Synthetic face-free contract fixture",
    references: assets
      .filter(
        (a, i) =>
          a.kind !== "audio" && assets.findIndex((b) => b.id === a.id) === i,
      )
      .map((a) => ({
        assetId: a.id,
        sha256: a.sha256 ?? "a".repeat(64),
        faces: "absent",
        reason: "Synthetic fixture",
      })),
  };
}
