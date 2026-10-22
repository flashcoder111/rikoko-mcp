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
      matchesAsset(a, query, category, tab === "favorites"),
  );
  const bundled = starterAssets.filter(
    (a) =>
      (kind === "all" || kind === "image") &&
      (category === "全部" || a.category === category) &&
      [a.name, ...a.tags].join(" ").includes(query.trim()),
  );
  return (
    <section className="asset-catalog" aria-label="素材库">
      <div className="template-heading">
        <div>
          <span className="eyebrow">YOUR MEDIA</span>
          <h1>{title ?? (onPick ? "选择可复用素材" : "素材库")}</h1>
          <p>把满意的画面留在这里，下次直接使用。</p>
        </div>
        <label className="library-upload">
          上传素材
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
      <div className="library-tabs" aria-label="素材来源">
        {[
          ["mine", "我的素材"],
          ["favorites", "已收藏"],
          ["builtin", "内置插画"],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="library-filters">
        <input
          aria-label="搜索素材名称或标签"
          placeholder="搜索名称或标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="素材用途"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {["全部", ...assetCategories].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          aria-label="媒体类型"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">所有类型</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
          <option value="audio">音频</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {tab === "builtin" && (
        <p className="library-note">
          6
          张原创图形插画，已随应用提供，可直接使用。商品与门店的真实照片请上传到“我的素材”。
        </p>
      )}
      <div className="asset-catalog-grid">
        {tab === "builtin"
          ? bundled.map((a) => (
              <article key={a.id}>
                <img
                  className="catalog-thumb"
                  src={`/api/starter-assets/${a.id}/file`}
                  alt={a.name}
                  loading="lazy"
                />
                <strong>{a.name}</strong>
                <small>
                  {a.category} · {a.tags.join(" / ")}
                </small>
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
                  {onPick ? "使用这张插画" : "加入我的素材"}
                </button>
              </article>
            ))
          : media.slice(0, visibleCount).map((a) => (
              <article key={a.id}>
                <AssetThumb asset={a} />
                <strong>{a.name}</strong>
                <small>
                  {assetCategory(a)}
                  {a.library?.tags?.length
                    ? ` · ${a.library.tags.join(" / ")}`
                    : ""}
                </small>
                <div className="catalog-actions">
                  {onPick && (
                    <button disabled={busy} onClick={() => onPick(a)}>
                      使用素材
                    </button>
                  )}
                  <button
                    disabled={busy}
                    aria-label={`${a.library?.favorite ? "取消收藏" : "收藏"} ${a.name}`}
                    aria-pressed={!!a.library?.favorite}
                    onClick={() =>
                      void run(() => save(a, !a.library?.favorite))
                    }
                  >
                    {a.library?.favorite ? "已收藏" : "收藏"}
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
                    整理
                  </button>
                  <a
                    href={`/api/assets/${encodeURIComponent(a.id)}/file`}
                    download={a.name ?? `rikoko-${a.id}`}
                  >
                    下载
                  </a>
                  <a
                    href={`/api/assets/${encodeURIComponent(a.id)}/file`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看
                  </a>
                </div>
              </article>
            ))}
      </div>
      {tab !== "builtin" && media.length > visibleCount && (
        <button onClick={() => setVisibleCount((count) => count + 24)}>
          显示更多素材（还有 {media.length - visibleCount} 份）
        </button>
      )}
      {!(tab === "builtin" ? bundled.length : media.length) && (
        <div className="panel-empty">
          <p>
            {query || category !== "全部" || kind !== "all"
              ? "没有匹配的素材，试试其他分类或关键词。"
              : tab === "favorites"
                ? "收藏常用素材，下次更容易找到。"
                : "上传已有图片、视频和音频，或从内置插画开始。"}
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
              浏览内置插画
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
          <h2>整理素材</h2>
          <label>
            名称
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            用途
            <select
              aria-label="整理素材用途"
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
            >
              {assetCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            标签（用逗号分隔，最多 12 个）
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <button disabled={busy} type="submit">
            保存分类
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(undefined)}
          >
            取消
          </button>
        </form>
      )}
    </section>
  );
}
