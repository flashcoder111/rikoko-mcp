import {
  AppError,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";
import {
  validateGenerationAssets,
  type ResolvedReference,
} from "../../providers/src/generation-input.js";
import { sha256 } from "../../storage/src/index.js";
import { validateStoryboardInput } from "./storyboard-state.js";
import type { Service } from "./index.js";
import { validatePreparedGeneration } from "./generation-preparation.js";
export async function generationReferences(
  service: Service,
  job: Entity,
  input: Extract<Operation, { kind: "generate" }>,
): Promise<ResolvedReference[]> {
  const refs = input.references ?? [];
  const assets = await service.db.transaction(async (tx) => {
    await validatePreparedGeneration(service, tx, job.accountId, input);
    await validateStoryboardInput(tx, job.accountId, input);
    const list: Entity[] = [];
    for (const ref of refs) {
      const asset = await tx.get(ref.assetId, job.accountId, "asset");
      if (!asset)
        throw new AppError("NOT_FOUND", "Generation reference not found", 404);
      list.push(asset);
    }
    return list;
  });
  validateGenerationAssets(service.provider.validate(input), input, assets);
  const resolved: ResolvedReference[] = [];
  for (let i = 0; i < refs.length; i++) {
    const asset = assets[i],
      snapshot = job.referenceAssets?.[i];
    if (
      !snapshot ||
      snapshot.assetId !== asset.id ||
      snapshot.role !== refs[i].role ||
      snapshot.sha256 !== asset.sha256 ||
      snapshot.bytes !== asset.bytes
    )
      throw new AppError(
        "REFERENCE_CHANGED",
        "Reference no longer matches the quoted asset",
      );
    let url: string;
    if (service.storage.providerUrl)
      url = await service.storage.providerUrl(asset.storageKey);
    else {
      if (service.provider.referenceDelivery?.(input) !== "data_uri")
        throw new AppError(
          "CAPABILITY_UNAVAILABLE",
          "Reference delivery is not configured",
        );
      const bytes = await service.storage.read(asset.storageKey);
      if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256)
        throw new AppError(
          "REFERENCE_CHANGED",
          "Reference bytes no longer match the quoted asset",
        );
      url = `data:${asset.mime};base64,${Buffer.from(bytes).toString("base64")}`;
    }
    resolved.push({ ...refs[i], url });
  }
  return resolved;
}
