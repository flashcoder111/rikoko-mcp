import React, { useEffect, useState } from "react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import {
  assetCategories,
  assetCategory,
  matchesAsset,
} from "../../../packages/core/src/library-metadata.js";
import { starterAssets } from "../../../packages/templates/src/starters.js";
import { api } from "./api";
import { AssetThumb } from "./media";
import "./templates.css";

const categoryLabels: Record<string, string> = {
  全部: "All categories",
  未分类: "Uncategorized",
  人物: "People",
  商品: "Products",
  场景: "Scenes",
  背景: "Backgrounds",
  品牌: "Brand",
  配乐: "Music",
  音效: "Sound effects",
  成片: "Final videos",
};
const categoryLabel = (value: string) => categoryLabels[value] ?? value;
const starterNames: Record<string, string> = {
  "starter-product-stage": "Cream product stage",
  "starter-coffee-corner": "Coffee illustration",
  "starter-paper-notes": "Paper and notes",
  "starter-ranking-blocks": "Blue steps",
  "starter-event-sunset": "Sunset arch",
  "starter-brand-orbit": "Green geometric illustration",
  "starter-software-overview": "Software overview",
  "starter-software-focus": "Feature walkthrough",
  "starter-software-ready": "Finished result",
  "starter-change-before": "Before organizing",
  "starter-change-after": "After organizing",
  "starter-change-summary": "Organization comparison",
  "starter-feedback-intro": "Feedback scene",
  "starter-feedback-quote": "Testimonial card",
  "starter-feedback-source": "Testimonial source",
};
const starterName = (id: string, fallback: string) =>
  starterNames[id] ?? fallback;

export default function AssetLibrary({
  assets,
  onRefresh,
  onPick,
  onUpload,
  title,
}: {
  assets: Entity[];
  onRefresh: () => Promise<void>;
  onPick?: (asset: Entity) => void;
  onUpload: (files: FileList) => void;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [kind, setKind] = useState("all");
  const [tab, setTab] = useState("mine");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Entity>();
  const [name, setName] = useState("");
  const [editCategory, setEditCategory] = useState("未分类");
  const [tags, setTags] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);
  useEffect(() => setVisibleCount(24), [query, category, kind, tab]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(
    asset: Entity,
    favorite = !!asset.library?.favorite,
    rename = false,
  ) {
    await api("asset_organize", {
      assetId: asset.id,
      name: rename ? name : asset.name,
      library: {
        category: rename ? editCategory : assetCategory(asset),
        tags: rename
          ? [
              ...new Set(
                tags
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              ),
            ]
          : (asset.library?.tags ?? []),
        favorite,
      },
    });
    await onRefresh();
    if (rename) setEditing(undefined);
  }
  const media = assets.filter(
    (a) =>
      ["image", "video", "audio"].includes(a.kind) &&
      (kind === "all" || a.kind === kind) &&
      (matchesAsset(a, query, category, tab === "favorites") ||
        (!!query.trim() &&
          matchesAsset(a, "", category, tab === "favorites") &&
          categoryLabel(assetCategory(a))
            .toLowerCase()
            .includes(query.trim().toLowerCase()))),
  );
  const bundled = starterAssets.filter(
    (a) =>
      (kind === "all" || kind === "image") &&
      (category === "全部" || a.category === category) &&
      [a.name, starterName(a.id, a.name), categoryLabel(a.category), ...a.tags]
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="asset-catalog" aria-label="Media library">
      <div className="template-heading">
        <div>
          <span className="eyebrow">YOUR MEDIA</span>
          <h1>
            {title ?? (onPick ? "Choose reusable media" : "Media library")}
          </h1>
          <p>Keep your favorite media here for your next project.</p>
        </div>
        <label className="library-upload">
          Upload media
          <input
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.length) onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="library-tabs" aria-label="Media source">
        {[
          ["mine", "My media"],
          ["favorites", "Favorited"],
          ["builtin", "Built-in illustrations"],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="library-filters">
        <input
          aria-label="Search media names or tags"
          placeholder="Search names or tags"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {["全部", ...assetCategories].map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
        <select
          aria-label="Media type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
          <option value="audio">Audio</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {tab === "builtin" && (
        <p className="library-note">
          {starterAssets.length} built-in illustrations are ready to use. Upload
          your own product or store photos to My media.
        </p>
      )}
      <div className="asset-catalog-grid">
        {tab === "builtin"
          ? bundled.map((a) => (
              <article key={a.id}>
                <img
                  className="catalog-thumb"
                  src={`/api/starter-assets/${a.id}/file`}
                  alt={starterName(a.id, a.name)}
                  loading="lazy"
                />
                <strong>{starterName(a.id, a.name)}</strong>
                <small>{categoryLabel(a.category)}</small>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const asset = await api<Entity>("asset_import_starter", {
                        id: a.id,
                      });
                      await onRefresh();
                      if (onPick) onPick(asset);
                      else setTab("mine");
                    })
                  }
                >
                  {onPick ? "Use illustration" : "Add to my media"}
                </button>
              </article>
            ))
          : media.slice(0, visibleCount).map((a) => (
              <article key={a.id}>
                <AssetThumb asset={a} />
                <strong>{a.name}</strong>
                <small>
                  {categoryLabel(assetCategory(a))}
                  {a.library?.tags?.length
                    ? ` · ${a.library.tags.join(" / ")}`
                    : ""}
                </small>
                <div className="catalog-actions">
                  {onPick && (
                    <button disabled={busy} onClick={() => onPick(a)}>
                      Use media
                    </button>
                  )}
                  <button
                    disabled={busy}
                    aria-label={`${a.library?.favorite ? "Remove from favorites" : "Favorite"} ${a.name}`}
                    aria-pressed={!!a.library?.favorite}
                    onClick={() =>
                      void run(() => save(a, !a.library?.favorite))
                    }
                  >
                    {a.library?.favorite ? "Favorited" : "Favorite"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditing(a);
                      setName(a.name);
                      setEditCategory(assetCategory(a));
                      setTags((a.library?.tags ?? []).join(", "));
                    }}
                  >
                    Organize
                  </button>
                  <a
                    href={`/api/assets/${encodeURIComponent(a.id)}/file`}
                    download={a.name ?? `rikoko-${a.id}`}
                  >
                    Download
                  </a>
                  <a
                    href={`/api/assets/${encodeURIComponent(a.id)}/file`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                </div>
              </article>
            ))}
      </div>
      {tab !== "builtin" && media.length > visibleCount && (
        <button onClick={() => setVisibleCount((count) => count + 24)}>
          Show more media ({media.length - visibleCount} remaining)
        </button>
      )}
      {!(tab === "builtin" ? bundled.length : media.length) && (
        <div className="panel-empty">
          <p>
            {query || category !== "全部" || kind !== "all"
              ? "No matching media. Try a different category or search."
              : tab === "favorites"
                ? "Favorite media to find it more easily next time."
                : "Upload images, videos, or audio, or start with a built-in illustration."}
          </p>
          {tab !== "builtin" && (
            <button
              onClick={() => {
                setTab("builtin");
                setCategory("全部");
                setQuery("");
                setKind("all");
              }}
            >
              Browse illustrations
            </button>
          )}
        </div>
      )}
      {editing && (
        <form
          className="asset-organize-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => save(editing, !!editing.library?.favorite, true));
          }}
        >
          <h2>Organize media</h2>
          <label>
            Name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Category
            <select
              aria-label="Media category"
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
            >
              {assetCategories.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tags (comma-separated, up to 12)
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <button disabled={busy} type="submit">
            Save changes
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(undefined)}
          >
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
