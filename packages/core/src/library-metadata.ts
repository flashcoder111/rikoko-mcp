import { z } from "zod";
import type { Entity } from "../../contracts/src/index.js";

export const assetCategories = [
  "未分类",
  "人物",
  "商品",
  "场景",
  "背景",
  "品牌",
  "配乐",
  "音效",
  "成片",
] as const;
export const libraryMetadataSchema = z
  .object({
    category: z.enum(assetCategories).default("未分类"),
    tags: z.array(z.string().trim().min(1).max(24)).max(12).default([]),
    favorite: z.boolean().default(false),
  })
  .strict();
export function assetCategory(asset: Entity): string {
  return (
    asset.library?.category ??
    (asset.provenance?.source === "local-executor" &&
    asset.kind === "video" &&
    asset.name === "video.mp4"
      ? "成片"
      : "未分类")
  );
}
export function matchesAsset(
  asset: Entity,
  query: string,
  category = "全部",
  favorites = false,
) {
  const text = [
    asset.name,
    assetCategory(asset),
    ...(asset.library?.tags ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return (
    (!query.trim() || text.includes(query.trim().toLocaleLowerCase())) &&
    (category === "全部" || assetCategory(asset) === category) &&
    (!favorites || !!asset.library?.favorite)
  );
}
