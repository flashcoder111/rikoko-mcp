import type { Entity } from "../../contracts/src/index.js";

/** A preparation manifest, never a claim that a provider received or followed media. */
export function referenceDelivery(record: Entity | Record<string, any>) {
  const bindings = record.providerRequest?.referenceBindings ?? [];
  const references = (record.references ?? []).map((ref: any, i: number) => ({
    assetId: ref.assetId,
    role: ref.role,
    kind: ref.kind,
    sha256: ref.sha256,
    durationMs: ref.kind === "video" ? ref.metadata?.durationMs : undefined,
    field: bindings[i]?.field,
    index: bindings[i]?.index,
  }));
  const videoReferences = references.filter((ref: any) => ref.kind === "video");
  return {
    stage: "prepared_not_submitted",
    model: record.input?.model,
    mode: record.input?.mode ?? null,
    references,
    videoReferenceCount: videoReferences.length,
    analysisOnlyReferences: (record.prompt?.direction?.references ?? [])
      .filter((ref: any) => ref.usage === "analysis_only")
      .map((ref: any) => ({ assetId: ref.assetId, role: ref.role })),
    message: videoReferences.length
      ? "These video assets are bound to the provider fields shown. Preparation has not uploaded or submitted them; source influence and visual quality remain unverified."
      : "No video is bound to the provider request. Source analysis and extracted stills do not transmit source movement to the generation model.",
  };
}
