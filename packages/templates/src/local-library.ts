import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  AppError,
  idSchema,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import { Service } from "../../core/src/index.js";
import { libraryMetadataSchema } from "../../core/src/library-metadata.js";
import { sha256 } from "../../storage/src/index.js";
import { starterAssets, starterTemplates } from "./starters.js";
import { instantiate } from "./schema.js";

export const organizeAssetSchema = z
  .object({
    assetId: idSchema,
    name: z.string().trim().min(1).max(120).optional(),
    library: libraryMetadataSchema,
  })
  .strict();
export async function organizeAsset(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = organizeAssetSchema.parse(raw);
  return service.scoped(c, "write", async (tx) => {
    const asset = await tx.get(input.assetId, c.accountId, "asset");
    if (!asset) throw new AppError("NOT_FOUND", "素材不存在", 404);
    return tx.put({
      ...asset,
      ...(input.name ? { name: input.name } : {}),
      library: input.library,
    });
  });
}
export async function starterBytes(id: string) {
  const asset = starterAssets.find((a) => a.id === id);
  if (!asset) throw new AppError("NOT_FOUND", "内置素材不存在", 404);
  const bytes = await readFile(
    new URL(`./bundled/${asset.file}`, import.meta.url),
  );
  if (sha256(bytes) !== asset.sha256 || bytes.byteLength !== asset.bytes)
    throw new AppError("ASSET_HASH_MISMATCH", "内置素材校验失败", 500);
  return bytes;
}
export async function starterPreview(id: string) {
  if (!starterTemplates.some((t) => t.id === id))
    throw new AppError("NOT_FOUND", "模板示例不存在", 404);
  return readFile(new URL(`./bundled/previews/${id}.mp4`, import.meta.url));
}
// A stable ID plus a transaction makes concurrent imports reuse the same account-owned asset.
export async function importStarter(service: Service, c: Context, id: string) {
  await service.scoped(c, "write", async () => {});
  const item = starterAssets.find((a) => a.id === id);
  if (!item) throw new AppError("NOT_FOUND", "内置素材不存在", 404);
  const existing = (await service.list(c, "asset")).find(
    (a) => a.sha256 === item.sha256,
  );
  if (existing) return existing;
  const bytes = await starterBytes(id);
  const assetId = `builtin-${sha256(new TextEncoder().encode(`${c.accountId}:${item.sha256}`)).slice(0, 40)}`;
  const storageKey = `${c.accountId}/${assetId}`;
  await service.storage.put(storageKey, bytes);
  return service.scoped(c, "write", async (tx) => {
    const existing = (await tx.list(c.accountId, "asset")).find(
      (a) => a.sha256 === item.sha256,
    );
    if (existing) return existing;
    return tx.put({
      id: assetId,
      accountId: c.accountId,
      type: "asset",
      createdAt: new Date().toISOString(),
      name: item.name,
      kind: "image",
      mime: "image/png",
      bytes: item.bytes,
      sha256: item.sha256,
      storageKey,
      expiresAt: null,
      metadata: {
        kind: "image",
        codec: "png",
        width: item.width,
        height: item.height,
      },
      provenance: {
        source: "rikoko-starter",
        license: "Apache-2.0",
        rightsConfirmed: true,
        evidence: "original-bundled-artwork",
      },
      library: { category: item.category, tags: item.tags, favorite: false },
    });
  });
}
export async function validateSceneAssets(
  service: Service,
  c: Context,
  sceneIds: string[],
  raw: Record<string, string>,
) {
  const result: Record<string, Entity> = Object.create(null);
  for (const [sceneId, assetId] of Object.entries(raw)) {
    if (!sceneIds.includes(sceneId))
      throw new AppError("INVALID_INPUT", "模板中不存在这个镜头");
    const asset = await service.get(c, "asset", assetId);
    if (!["image", "video"].includes(asset.kind))
      throw new AppError("INVALID_INPUT", "画面只能使用图片或视频");
    result[sceneId] = asset;
  }
  return result;
}
export function bindSceneAssets(
  composition: ReturnType<typeof instantiate>,
  bindings: Record<string, Entity>,
) {
  for (const scene of composition.scenes) {
    const asset = bindings[scene.id];
    if (!asset) continue;
    scene.assetId = asset.id;
    scene.sourceStartMs = 0;
    scene.speed = 1;
    scene.fit = "contain";
    // Do not turn a user's short clip into an invalid source range.
    if (asset.kind === "video" && asset.metadata?.durationMs)
      scene.durationMs = Math.min(scene.durationMs, asset.metadata.durationMs);
  }
  return composition;
}
export async function prepareStarter(
  service: Service,
  c: Context,
  input: {
    id: string;
    version: number;
    parameters: Record<string, string>;
    sceneAssets: Record<string, string>;
  },
) {
  await service.scoped(c, "write", async () => {});
  const template = starterTemplates.find(
    (t) => t.id === input.id && t.version === input.version,
  );
  if (!template) throw new AppError("NOT_FOUND", "模板版本不存在", 404);
  const bindings = await validateSceneAssets(
    service,
    c,
    template.composition.scenes.map((s) => s.id),
    input.sceneAssets,
  );
  // Validate text before importing any media.
  const placeholder = Object.fromEntries(
    template.assets.map((a) => [a.id, a.id]),
  );
  const composition = instantiate(template, input.parameters, placeholder);
  const needed = new Set(
    composition.scenes.filter((s) => !bindings[s.id]).map((s) => s.assetId),
  );
  const mapping: Record<string, string> = {};
  for (const id of needed)
    if (id) mapping[id] = (await importStarter(service, c, id)).id;
  for (const scene of composition.scenes)
    if (!bindings[scene.id] && scene.assetId)
      scene.assetId = mapping[scene.assetId];
  return {
    composition: bindSceneAssets(composition, bindings),
    template: { id: template.id, version: template.version },
    reuse: {
      existingScenes: Object.keys(bindings).length,
      bundledScenes: composition.scenes.length - Object.keys(bindings).length,
      generationRequests: 0,
    },
  };
}
