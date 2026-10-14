import React, { useEffect, useRef, useState } from "react";
import type {
  Composition,
  Entity,
} from "../../../packages/contracts/src/index.js";
import type { LibraryTemplate } from "../../../packages/templates/src/starters.js";
import { api } from "./api";
import { AssetThumb } from "./media";
import AssetLibrary from "./AssetLibrary";
import LibraryPicker from "./LibraryPicker";
import "./templates.css";

export default function Templates({
  onOpen,
  assets,
  onRefresh,
  onUpload,
}: {
  onOpen: (projectId: string) => void;
  assets: Entity[];
  onRefresh: () => Promise<void>;
  onUpload: (files: FileList) => void;
}) {
  const [snapshot, setSnapshot] = useState<{
    templates: LibraryTemplate[];
    syncedAt?: string;
    configured?: boolean;
  }>({ templates: [] });
  const [selected, setSelected] = useState<LibraryTemplate>();
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [slot, setSlot] = useState<string>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showDemo, setShowDemo] = useState(true);
  const demoVideo = useRef<HTMLVideoElement>(null);
  const editingForm = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const applying = useRef(false);
  const attempt = useRef<
    { fingerprint: string; key: string; composition?: Composition } | undefined
  >(undefined);
  useEffect(() => {
    let live = true;
    void api<typeof snapshot>("template_list")
      .then((v) => {
        if (live) setSnapshot(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!playing || !selected) return;
    const timer = setTimeout(
      () => setFrame((f) => (f + 1) % selected.composition.scenes.length),
      selected.composition.scenes[frame]?.durationMs ?? 3000,
    );
    return () => clearTimeout(timer);
  }, [playing, selected, frame]);
  async function update() {
    setBusy(true);
    setError("");
    try {
      setSnapshot(await api("template_sync"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!selected || applying.current) return;
    applying.current = true;
    setBusy(true);
    setError("");
    const input = {
      id: selected.id,
      version: selected.version,
      parameters,
      sceneAssets: bindings,
    };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    const current = attempt.current;
    try {
      if (!current.composition)
        current.composition = (
          await api<{ composition: Composition }>("template_prepare", input)
        ).composition;
      const result = await api<{ projectId: string }>("workspace_commit", {
        action: { type: "create", composition: current.composition },
        message: `从模板「${selected.title}」创建作品，复用已有素材`,
        origin: "studio",
        idempotencyKey: current.key,
      });
      await onRefresh();
      onOpen(result.projectId);
      attempt.current = undefined;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      applying.current = false;
    }
  }
  const templates = snapshot.templates
    .filter(
      (t) =>
        (category === "全部" || t.category === category) &&
        `${t.title} ${t.description} ${t.category} ${(t.searchTerms ?? []).join(" ")}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => Number(!!b.isNew) - Number(!!a.isNew));
  const scene = selected?.composition.scenes[frame];
  const chosenAsset = scene && assets.find((a) => a.id === bindings[scene.id]);
  const caption = scene?.text.replace(
    /\{\{([^{}]+)\}\}/g,
    (_, k) => parameters[k] ?? selected?.parameters[k]?.default ?? "",
  );
  return (
    <section className="template-library">
      <div className="template-heading">
        <div>
          <span className="eyebrow">START WITH A TEMPLATE</span>
          <h1>选一个模板，做成你的作品</h1>
          <p>先复用画面和剪辑结构，再改文案与素材。本地模板无需模型额度。</p>
        </div>
        {snapshot.configured && (
          <button disabled={busy} onClick={() => void update()}>
            {busy ? "处理中…" : "更新云端模板"}
          </button>
        )}
      </div>
      {!selected && (
        <div className="library-filters">
          <input
            aria-label="搜索成片模板"
            placeholder="搜索用途，例如商品、教程、门店"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="模板分类"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {[
              "全部",
              ...new Set(snapshot.templates.map((t) => t.category)),
            ].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {(query || category !== "全部") && (
            <button
              onClick={() => {
                setQuery("");
                setCategory("全部");
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      )}
      {!selected && (
        <p className="library-note" role="status">
          {loading
            ? "正在加载模板…"
            : `共 ${templates.length} 个模板 · 选中后可播放成片示例`}
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!selected && (
        <div className="template-grid">
          {templates.map((t) => (
            <button
              disabled={busy}
              className="template-item"
              key={t.id}
              onClick={() => {
                setSelected(t);
                setBindings({});
                setParameters(
                  Object.fromEntries(
                    Object.entries(t.parameters).map(([k, v]) => [
                      k,
                      v.default,
                    ]),
                  ),
                );
                setFrame(0);
                setPlaying(false);
                setShowDemo(true);
                setSlot(undefined);
                setError("");
              }}
            >
              {t.coverAssetId ? (
                <img
                  className="template-cover"
                  src={`/api/starter-assets/${t.coverAssetId}/file`}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="template-cover template-cloud-cover">
                  {t.title}
                </div>
              )}
              <div className="template-card-meta">
                <small>
                  {t.category} · {t.sourceKind === "builtin" ? "内置" : "云端"}
                </small>
                {t.isNew && <span className="template-new">新增</span>}
              </div>
              <strong>{t.title}</strong>
              <span>{t.description}</span>
              <small>
                {t.composition.scenes.length} 个镜头 ·{" "}
                {t.composition.scenes.reduce(
                  (sum, s) => sum + s.durationMs,
                  0,
                ) / 1000}{" "}
                秒 ·{" "}
                {t.composition.width < t.composition.height
                  ? "竖屏"
                  : t.composition.width > t.composition.height
                    ? "横屏"
                    : "方形"}
              </small>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="template-selection-actions">
          <button
            disabled={busy}
            onClick={() => {
              setSelected(undefined);
              setPlaying(false);
            }}
          >
            返回全部模板
          </button>
          <button
            onClick={() => editingForm.current?.querySelector("input")?.focus()}
          >
            修改文案与画面
          </button>
        </div>
      )}
      {!selected && !loading && !error && !templates.length && (
        <p className="panel-empty">没有匹配的模板，试试其他用途。</p>
      )}
      {selected && (
        <div className="template-customize">
          <div className="template-storyboard">
            <h2>{selected.title}</h2>
            {selected.preparation && (
              <p className="template-preparation">{selected.preparation}</p>
            )}
            {selected.sourceKind === "builtin" && (
              <details
                className="template-demo"
                key={selected.id}
                open={showDemo}
                onToggle={(e) => {
                  setShowDemo(e.currentTarget.open);
                  if (!e.currentTarget.open) demoVideo.current?.pause();
                }}
              >
                <summary>播放成片示例</summary>
                <video
                  ref={demoVideo}
                  controls
                  playsInline
                  preload="metadata"
                  poster={
                    selected.coverAssetId
                      ? `/api/starter-assets/${selected.coverAssetId}/file`
                      : undefined
                  }
                  src={`/api/starter-templates/${selected.id}/preview`}
                />
                <p className="library-note">
                  这是默认内容的成片。修改后的效果请在下方分镜中检查，再生成预览。
                </p>
              </details>
            )}
            <h3>分镜预览</h3>
            <div
              className="template-stage"
              style={{
                aspectRatio: `${selected.composition.width}/${selected.composition.height}`,
                background: scene?.color,
              }}
            >
              {chosenAsset ? (
                chosenAsset.kind === "video" ? (
                  <video
                    key={chosenAsset.id}
                    src={`/api/assets/${encodeURIComponent(chosenAsset.id)}/file`}
                    controls
                    playsInline
                    muted
                  />
                ) : (
                  <img
                    src={`/api/assets/${encodeURIComponent(chosenAsset.id)}/file`}
                    alt={chosenAsset.name}
                  />
                )
              ) : selected.sourceKind === "builtin" && scene?.assetId ? (
                <img
                  src={`/api/starter-assets/${scene.assetId}/file`}
                  alt="内置示例插画"
                />
              ) : (
                <span>模板画面在创建后加载</span>
              )}
              <div
                className="template-caption"
                style={{
                  color: selected.composition.captionStyle.color,
                  background: `${selected.composition.captionStyle.background}e6`,
                }}
              >
                {caption}
              </div>
            </div>
            <div className="storyboard-controls">
              <button onClick={() => setPlaying(!playing)}>
                {playing ? "暂停分镜预览" : "播放分镜预览"}
              </button>
              <span>
                {frame + 1} / {selected.composition.scenes.length}
              </span>
            </div>
            <p className="library-note">
              分镜预览用于检查文案和素材；最终字幕排版与声音以合成结果为准。内置插画可直接使用，也可换成自己的照片。
            </p>
            <div className="storyboard-steps">
              {selected.composition.scenes.map((s, i) => (
                <button
                  key={s.id}
                  aria-pressed={frame === i}
                  aria-label={`查看第 ${i + 1} 个镜头：${selected.sceneLabels?.[s.id] ?? s.id}`}
                  onClick={() => {
                    setFrame(i);
                    setPlaying(false);
                    setShowDemo(false);
                    demoVideo.current?.pause();
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
          <form
            ref={editingForm}
            className="template-form"
            onSubmit={(e) => {
              e.preventDefault();
              void apply();
            }}
          >
            <h2>1. 换成你的文案</h2>
            {Object.entries(selected.parameters).map(([k, p]) => (
              <label key={k}>
                {selected.parameterLabels?.[k] ?? k}
                <input
                  aria-label={selected.parameterLabels?.[k] ?? k}
                  disabled={busy}
                  value={parameters[k] ?? p.default}
                  maxLength={p.maxLength}
                  required={k === "text1" && selected.sourceKind === "builtin"}
                  onFocus={() => {
                    const index = selected.composition.scenes.findIndex((s) =>
                      s.text.includes(`{{${k}}}`),
                    );
                    if (index >= 0) {
                      setFrame(index);
                      setPlaying(false);
                      setShowDemo(false);
                      demoVideo.current?.pause();
                    }
                  }}
                  onChange={(e) =>
                    setParameters({ ...parameters, [k]: e.target.value })
                  }
                />
                <small className="template-character-count">
                  {(parameters[k] ?? p.default).length} / {p.maxLength} 字
                </small>
              </label>
            ))}
            <h2>2. 选择要复用的画面</h2>
            {selected.composition.scenes.map((s, i) => {
              const a = assets.find((x) => x.id === bindings[s.id]);
              return (
                <div className="template-slot" key={s.id}>
                  {a ? (
                    <AssetThumb asset={a} />
                  ) : selected.sourceKind === "builtin" && s.assetId ? (
                    <img
                      src={`/api/starter-assets/${s.assetId}/file`}
                      alt="模板默认插画"
                    />
                  ) : (
                    <span className="slot-number">{i + 1}</span>
                  )}
                  <div>
                    <strong>
                      {selected.sceneLabels?.[s.id] ?? `第 ${i + 1} 个镜头`}
                    </strong>
                    <small>{a?.name ?? "使用模板原有画面"}</small>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setSlot(s.id)}
                  >
                    换画面
                  </button>
                  {a && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setBindings((previous) => {
                          const next = { ...previous };
                          delete next[s.id];
                          return next;
                        })
                      }
                    >
                      还原
                    </button>
                  )}
                </div>
              );
            })}
            <div className="template-reuse-summary" role="status">
              <strong>本次无需生成新图片或视频</strong>
              <p>
                {Object.keys(bindings).length} 个镜头使用你的素材，
                {selected.composition.scenes.length -
                  Object.keys(bindings).length}{" "}
                个镜头沿用模板。只进行本地合成；后续修改字幕也会保留画面。
              </p>
            </div>
            <button className="primary" disabled={busy}>
              {busy ? "正在准备作品…" : "使用这些素材，生成预览"}
            </button>
          </form>
        </div>
      )}
      {slot && (
        <LibraryPicker label="替换模板画面" onClose={() => setSlot(undefined)}>
          <AssetLibrary
            assets={assets.filter((a) => ["image", "video"].includes(a.kind))}
            onRefresh={onRefresh}
            onUpload={onUpload}
            onPick={(a) => {
              if (!["image", "video"].includes(a.kind)) return;
              setBindings((b) => ({ ...b, [slot]: a.id }));
              setSlot(undefined);
            }}
          />
        </LibraryPicker>
      )}
      {snapshot.syncedAt && (
        <p className="template-sync-time">
          云端模板更新于 {new Date(snapshot.syncedAt).toLocaleString()}
        </p>
      )}
    </section>
  );
}
