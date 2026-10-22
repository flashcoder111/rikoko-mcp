import { z } from "zod";

export const faceStatusSchema = z.enum(["present", "absent", "unknown"]);
export type FaceStatus = z.infer<typeof faceStatusSchema>;
export const videoPolicySchema = z
  .object({
    // The requested scene, independently of the supplied visual references.
    faces: faceStatusSchema,
    reason: z.string().trim().min(1).max(500),
    references: z
      .array(
        z
          .object({
            assetId: z.string().min(1).max(120),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            faces: faceStatusSchema,
            reason: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(12),
    userChoice: z
      .object({
        model: z.string().min(1).max(120),
        confirmed: z.literal(true),
      })
      .strict()
      .optional(),
  })
  .strict();
export type VideoPolicy = z.infer<typeof videoPolicySchema>;
export type VideoFamily = "seedance" | "minimax" | "kling" | "other";
export type VideoModelIdentity = {
  id: string;
  name?: string;
  endpoint?: string;
  videoFamily?: VideoFamily;
};

export function videoModelFamily(model: VideoModelIdentity): VideoFamily {
  const identity = `${model.endpoint ?? ""} ${model.id} ${model.name ?? ""}`;
  // A Seedance endpoint cannot be relabelled as a face-capable model.
  if (/seedance/i.test(identity) || model.videoFamily === "seedance")
    return "seedance";
  if (/minimax/i.test(identity)) return "minimax";
  if (/kling/i.test(identity)) return "kling";
  return model.videoFamily ?? "other";
}
export function combinedFaceStatus(policy?: VideoPolicy): FaceStatus {
  if (!policy) return "unknown";
  const statuses = [policy.faces, ...policy.references.map((r) => r.faces)];
  return statuses.includes("present")
    ? "present"
    : statuses.includes("unknown")
      ? "unknown"
      : "absent";
}
export function videoModelRank(model: VideoModelIdentity, faces: FaceStatus) {
  const family = videoModelFamily(model);
  if (faces !== "absent")
    return family === "minimax" ? 0 : family === "kling" ? 1 : 100;
  return family === "seedance" &&
    /mini/i.test(`${model.id} ${model.name ?? ""} ${model.endpoint ?? ""}`)
    ? 0
    : family === "minimax"
      ? 1
      : family === "kling"
        ? 2
        : 3;
}
export function remapVideoPolicy(
  policy: VideoPolicy | undefined,
  mappings: { sourceAssetId: string; assetId: string }[],
) {
  return policy
    ? {
        ...policy,
        references: policy.references.map((r) => ({
          ...r,
          assetId:
            mappings.find((m) => m.sourceAssetId === r.assetId)?.assetId ??
            r.assetId,
        })),
      }
    : undefined;
}
