import SaveTemplate from "./SaveTemplate";
import React, { useEffect, useRef, useState } from "react";
import {
  Scissors,
  Undo2,
  Redo2,
  Trash2,
  Plus,
  Search,
  Grid2X2,
  List,
  Download,
  PanelBottom,
  PanelRight,
  SlidersHorizontal,
  X,
  Music2,
  Type,
  Film,
  ZoomIn,
  ZoomOut,
  History,
  Save,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import type {
  Composition,
  Entity,
} from "../../../packages/contracts/src/index.js";
import { applyEdits } from "../../../packages/core/src/editing.js";
import type { Edit } from "../../../packages/core/src/workspace-contracts.js";
import Chat, { type ChatProps } from "./Chat";
import { latestJob, type Snapshot } from "./api";
import { AssetThumb } from "./media";
import StudioPlayer, { Filmstrip, timestamp } from "./StudioPlayer";
import AudioControls from "./AudioControls";
import CaptionStyleControls from "./CaptionStyleControls";
import HermesHandoff from "./HermesHandoff";
import {
  assetCategories,
  matchesAsset,
} from "../../../packages/core/src/library-metadata.js";
export default function Editor({
  snapshot,
  assets,
  selectedSceneId,
  selectScene,
  busy,
  onEdit,
  onRestore,
  onViewRevision,
  onLatest,
  chat,
}: {
  snapshot?: Snapshot;
  assets: Entity[];
  selectedSceneId: string;
  selectScene: (id: string) => void;
  busy: string;
  onEdit: (edits: Edit[], message: string) => void;
  onRestore: (id: string) => void;
  onViewRevision: (id: string) => void;
  onLatest?: () => void;
  chat: ChatProps;
}) {
  const revision = snapshot?.revision;
  const [history, setHistory] = useState<Edit[][]>([[]]),
    [cursor, setCursor] = useState(0),
    [localError, setLocalError] = useState("");
  const [timelineEditing, setTimelineEditing] = useState(false);
  const [time, setTime] = useState(0),
    [search, setSearch] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [filter, setFilter] = useState("all"),
    [libraryScope, setLibraryScope] = useState("project"),
    [assetPurpose, setAssetPurpose] = useState("全部"),
    [sort, setSort] = useState("date"),
    [list, setList] = useState(false),
    [side, setSide] = useState(false),
    [inspector, setInspector] = useState(""),
    [mobile, setMobile] = useState("preview"),
    [zoom, setZoom] = useState(1),
    [selectedAssetId, setSelectedAssetId] = useState("");
  const [trimStart, setTrimStart] = useState(0),
    [trimEnd, setTrimEnd] = useState(0);
  const [loadedRevision, setLoadedRevision] = useState("");
  const pendingSave = useRef("");
  const track = useRef<HTMLDivElement>(null);
  const dragScene = useRef("");
  const edits = history[cursor] ?? [];
  const dirty = edits.length > 0;
  let composition: Composition | undefined;
  try {
    composition = revision
      ? applyEdits(revision.composition, edits)
      : undefined;
  } catch {
    composition = revision?.composition;
  }
  const scenes = composition?.scenes ?? [],
    scene = scenes.find((s) => s.id === selectedSceneId),
    index = scenes.findIndex((s) => s.id === selectedSceneId),
    total = scenes.reduce((n, s) => n + s.durationMs, 0),
    offset = scenes
      .slice(0, Math.max(0, index))
      .reduce((n, s) => n + s.durationMs, 0);
  const job = latestJob(snapshot?.jobs ?? [], revision?.id);
  const historical = !!revision && revision.id !== snapshot?.headRevisionId;
  useEffect(() => setTime((value) => Math.min(value, total / 1000)), [total]);
  useEffect(() => {
    let saved: { history: Edit[][]; cursor: number } | undefined;
    if (
      pendingSave.current &&
      revision?.id &&
      pendingSave.current !== revision.id
    ) {
      sessionStorage.removeItem(`rikoko-draft:${pendingSave.current}`);
      pendingSave.current = "";
    }
    if (revision && !historical)
      try {
        const raw = sessionStorage.getItem(`rikoko-draft:${revision.id}`);
        if (raw) {
          saved = JSON.parse(raw);
          if (saved)
            applyEdits(revision.composition, saved.history[saved.cursor]);
        }
      } catch {
        saved = undefined;
      }
    setHistory(saved?.history ?? [[]]);
    setCursor(saved?.cursor ?? 0);
    setTime(0);
    setSelectedAssetId("");
    setLoadedRevision(revision?.id ?? "");
  }, [revision?.id]);
  useEffect(() => {
    if (revision?.id && loadedRevision === revision.id && !historical) {
      sessionStorage.setItem(
        `rikoko-draft:${revision.id}`,
        JSON.stringify({ history, cursor }),
      );
    }
  }, [history, cursor, revision?.id, loadedRevision, historical]);
  useEffect(() => {
    setTrimStart(0);
    setTrimEnd((scene?.durationMs ?? 0) / 1000);
  }, [scene?.id, scene?.text, scene?.durationMs]);
  function edit(change: Edit[]) {
    if (!revision || historical || busy) return;
    try {
      const last = edits.at(-1),
        current = change[0];
      const consolidate =
        change.length === 1 &&
        last &&
        [
          "style",
          "caption",
          "scene_audio",
          "music",
          "format",
          "scene_fit",
          "audio_envelope",
        ].includes(current.type) &&
        last.type === current.type &&
        (!("sceneId" in last) ||
          ("sceneId" in current && last.sceneId === current.sceneId));
      const nextEdits = consolidate
        ? [...edits.slice(0, -1), { ...last, ...current } as Edit]
        : [...edits, ...change];
      if (nextEdits.length > 50) throw Error("请先保存当前修改，再继续编辑。");
      applyEdits(revision.composition, nextEdits);
      setHistory((h) => [...h.slice(0, cursor + 1), nextEdits]);
      sessionStorage.setItem(
        `rikoko-draft:${revision.id}`,
        JSON.stringify({
          history: [...history.slice(0, cursor + 1), nextEdits],
          cursor: cursor + 1,
        }),
      );
      setCursor(cursor + 1);
      setLocalError("");
      setSelectedAssetId("");
    } catch (e) {
      setLocalError((e as Error).message);
    }
  }
  function seek(n: number) {
    setSelectedAssetId("");
    setTime(Math.max(0, Math.min(total / 1000, n)));
  }
  function split() {
    if (!scene) return;
    const atMs = Math.round(time * 1000 - offset);
    if (atMs < 100 || atMs > scene.durationMs - 100) {
      setLocalError("请将播放头移到所选片段内部，再分割。");
      return;
    }
    edit([{ type: "split", sceneId: scene.id, atMs }]);
  }
  function remove() {
    if (scene) edit([{ type: "delete", sceneId: scene.id }]);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setCursor((n) =>
          e.shiftKey ? Math.min(history.length - 1, n + 1) : Math.max(0, n - 1),
        );
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "s")
        split();
      else if (e.key === "Escape") setInspector("");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const projectAssets = new Set([
    ...scenes.flatMap((s) => [s.assetId, s.audioAssetId]),
    composition?.audio?.assetId,
    ...(snapshot?.jobs.flatMap((j) => j.outputs) ?? []),
    ...chat.attachments.map((a) => a.id),
  ]);
  const media = assets
    .filter(
      (a) =>
        ["video", "image", "audio"].includes(a.kind) &&
        (libraryScope === "all" || projectAssets.has(a.id)) &&
        (filter === "all" || a.kind === filter) &&
        matchesAsset(a, search, assetPurpose),
    )
    .sort((a, b) =>
      sort === "name"
        ? String(a.name).localeCompare(String(b.name))
        : String(b.createdAt).localeCompare(String(a.createdAt)),
    );
  function addAsset(asset: Entity) {
    if (asset.kind === "audio") {
      edit([{ type: "music", assetId: asset.id, gain: 0.3 }]);
      return;
    }
    edit([
      {
        type: "insert",
        atIndex: scenes.length,
        scene: {
          id: crypto.randomUUID(),
          assetId: asset.id,
          durationMs:
            asset.kind === "video"
              ? Math.min(30000, asset.metadata?.durationMs ?? 5000)
              : 3000,
          sourceStartMs: 0,
          color: "#121214",
          text: "",
          fit: "contain",
          volume: 1,
        },
      },
    ]);
  }
  function save() {
    if (revision) pendingSave.current = revision.id;
    if (dirty) onEdit(edits, `工作台剪辑：${edits.length} 项修改`);
  }
  useEffect(() => {
    if (scenes.length && !scenes.some((s) => s.id === selectedSceneId))
      selectScene(scenes[0].id);
  }, [scenes, selectedSceneId, selectScene]);
  const selectedAsset = assets.find((a) => a.id === selectedAssetId);
  return (
    <div
      className={`replica-studio ${side ? "media-side" : ""} ${inspector ? "has-inspector" : ""} mobile-${mobile}`}
    >
      <nav className="studio-mobile-tabs" aria-label="工作台面板">
        {[
          ["preview", "预览"],
          ["chat", "对话"],
          ["timeline", "剪辑"],
          ["media", "素材"],
        ].map(([id, name]) => (
          <button
            key={id}
            aria-pressed={mobile === id}
            onClick={() => {
              setMobile(id);
              if (id === "timeline") setTimelineEditing(true);
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      <aside className="vizard-chat">
        <HermesHandoff
          key={`handoff:${snapshot?.project.id ?? "new"}`}
          snapshot={snapshot}
          selectedSceneId={scene?.id}
          assetIds={chat.attachments.map((asset) => asset.id)}
          draft={chat.draft}
          blocked={dirty || !!busy || historical}
          dirty={dirty}
        />
        <Chat
          key={`chat:${snapshot?.project.id ?? "new"}`}
          {...chat}
          embedded
          selectedSceneId={scene?.id}
        />
      </aside>
      <main className="workbench-main">
        <div className="preview-area">
          <StudioPlayer
            composition={composition}
            assets={assets}
            job={job}
            dirty={dirty}
            time={time}
            setTime={setTime}
            selectedAsset={
              selectedAsset
                ? {
                    id: selectedAsset.id,
                    kind: selectedAsset.kind,
                    name: selectedAsset.name,
                  }
                : undefined
            }
            onAnnotate={(text, frame) => {
              if (frame) {
                const files = new DataTransfer();
                files.items.add(frame);
                chat.onUpload(files.files);
              }
              chat.setDraft(text);
              setMobile("chat");
            }}
          />
          <div className="edit-status">
            <button
              disabled={!scene || historical || !!busy}
              onClick={() => {
                setInspector("caption");
                setMobile("timeline");
              }}
            >
              <Type size={13} />
              改文案
            </button>
            <button
              disabled={!scene || historical || !!busy}
              onClick={() => {
                setInspector("audio");
                setMobile("timeline");
              }}
            >
              <Music2 size={13} />
              换音乐
            </button>
            <button
              className={timelineEditing ? "active" : ""}
              onClick={() => setTimelineEditing(!timelineEditing)}
            >
              <Scissors size={13} />
              {timelineEditing ? "收起剪辑" : "剪辑"}
            </button>
            <span>
              {dirty
                ? `${edits.length} 项未保存修改`
                : historical
                  ? "正在查看历史版本"
                  : job?.status === "completed"
                    ? "修改已保存"
                    : "可直接在时间线上编辑"}
            </span>
            <button
              onClick={() =>
                setInspector(inspector === "versions" ? "" : "versions")
              }
            >
              <History size={13} />{" "}
              {revision ? `Version ${revision.version}` : "版本"}
            </button>
            {revision && (
              <SaveTemplate
                revisionId={revision.id}
                title={revision.composition.title}
                disabled={dirty || !!busy}
              />
            )}
            {dirty && (
              <button className="pink" disabled={!!busy} onClick={save}>
                <Save size={13} />
                保存并合成预览
              </button>
            )}
            {job?.status === "completed" && !dirty && (
              <a
                href={`/api/assets/${job.outputs[0]}/file`}
                download="video.mp4"
              >
                <Download size={13} />
                导出
              </a>
            )}
          </div>
          <p className="edit-render-note">
            改文案、换音乐会复用现有素材，只重新合成视频，不会重新生成画面。
          </p>
          {historical && onLatest && (
            <div className="workspace-latest" role="status">
              作品已有新版本。
              {dirty
                ? "请先保留当前草稿，再查看最新修改。"
                : "可载入 Hermes 或其他页面保存的最新修改。"}
              <button disabled={dirty || !!busy} onClick={onLatest}>
                载入最新版本
              </button>
            </div>
          )}
        </div>
        <section
          className={`editing-timeline ${timelineEditing ? "expanded" : "compact-timeline"}`}
          aria-label="剪辑时间线"
        >
          <div className="timeline-toolbar">
            <button
              title="撤销 ⌘Z"
              aria-label="撤销"
              disabled={!cursor}
              onClick={() => setCursor(cursor - 1)}
            >
              <Undo2 size={16} />
            </button>
            <button
              title="重做 ⇧⌘Z"
              aria-label="重做"
              disabled={cursor >= history.length - 1}
              onClick={() => setCursor(cursor + 1)}
            >
              <Redo2 size={16} />
            </button>
            <i />
            <button
              title="在播放头处分割 S"
              aria-label="分割"
              disabled={!scene || historical}
              onClick={split}
            >
              <Scissors size={16} />
            </button>
            <button
              title="删除片段"
              aria-label="删除片段"
              disabled={!scene || scenes.length < 2 || historical}
              onClick={remove}
            >
              <Trash2 size={16} />
            </button>
            <button
              className={inspector === "clip" ? "active" : ""}
              onClick={() => setInspector(inspector === "clip" ? "" : "clip")}
            >
              <SlidersHorizontal size={15} />
              编辑
            </button>
            <span className="toolbar-spacer" />
            <button
              title="缩小时间线"
              onClick={() => setZoom(Math.max(1, zoom - 0.5))}
            >
              <ZoomOut size={15} />
            </button>
            <input
              aria-label="时间线缩放"
              type="range"
              min={1}
              max={5}
              step={0.5}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <button
              title="放大时间线"
              onClick={() => setZoom(Math.min(5, zoom + 0.5))}
            >
              <ZoomIn size={15} />
            </button>
          </div>
          <div className="timeline-scroll">
            <div
              className="timeline-canvas"
              ref={track}
              style={{ width: `${zoom * 100}%` }}
            >
              <div
                className="time-ruler"
                role="slider"
                tabIndex={0}
                aria-label="播放位置"
                aria-valuemin={0}
                aria-valuemax={total / 1000}
                aria-valuenow={time}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") seek(time + 0.1);
                  if (e.key === "ArrowLeft") seek(time - 0.1);
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const b = e.currentTarget.getBoundingClientRect();
                  seek((((e.clientX - b.left) / b.width) * total) / 1000);
                }}
                onPointerMove={(e) => {
                  if (e.buttons) {
                    const b = e.currentTarget.getBoundingClientRect();
                    seek((((e.clientX - b.left) / b.width) * total) / 1000);
                  }
                }}
              >
                {Array.from({ length: 11 }, (_, i) => (
                  <span key={i}>{(((total / 1000) * i) / 10).toFixed(1)}s</span>
                ))}
              </div>
              <div className="video-track">
                {scenes.map((s, i) => (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`镜头 ${i + 1}`}
                    aria-pressed={s.id === selectedSceneId}
                    key={s.id}
                    className={`timeline-clip ${s.id === selectedSceneId ? "selected" : ""}`}
                    style={{ width: `${(s.durationMs / total) * 100}%` }}
                    draggable={!historical}
                    onDragStart={() => {
                      dragScene.current = s.id;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragScene.current)
                        edit([
                          {
                            type: "move",
                            sceneId: dragScene.current,
                            toIndex: i,
                          },
                        ]);
                      dragScene.current = "";
                    }}
                    onClick={() => {
                      selectScene(s.id);
                      seek(
                        scenes
                          .slice(0, i)
                          .reduce((n, c) => n + c.durationMs, 0) / 1000,
                      );
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        selectScene(s.id);
                        setInspector("clip");
                      }
                    }}
                    onDoubleClick={() => setInspector("clip")}
                  >
                    {assets.find((a) => a.id === s.assetId)?.kind ===
                    "image" ? (
                      <AssetThumb
                        asset={assets.find((a) => a.id === s.assetId)}
                      />
                    ) : (
                      <Filmstrip
                        assetId={s.assetId}
                        start={s.sourceStartMs / 1000}
                        duration={(s.durationMs * (s.speed ?? 1)) / 1000}
                        count={Math.min(
                          12,
                          Math.max(2, Math.round((s.durationMs / total) * 24)),
                        )}
                      />
                    )}
                    <span className="clip-name">
                      <Film size={10} /> {i + 1} ·{" "}
                      {(s.durationMs / 1000).toFixed(1)}s
                    </span>
                    <span
                      className="trim-edge left"
                      title="拖动裁切开头"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        e.currentTarget.dataset.x = String(e.clientX);
                      }}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        const dx =
                          e.clientX - Number(e.currentTarget.dataset.x);
                        const ms = Math.round(
                          (dx / (track.current?.clientWidth ?? 1)) * total,
                        );
                        if (ms > 0)
                          edit([
                            {
                              type: "trim",
                              sceneId: s.id,
                              startMs: Math.min(s.durationMs - 100, ms),
                              endMs: s.durationMs,
                            },
                          ]);
                      }}
                    />
                    <span
                      className="trim-edge right"
                      title="拖动裁切结尾"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        e.currentTarget.dataset.x = String(e.clientX);
                      }}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        const dx =
                          e.clientX - Number(e.currentTarget.dataset.x);
                        const ms = Math.round(
                          (dx / (track.current?.clientWidth ?? 1)) * total,
                        );
                        if (ms < 0)
                          edit([
                            {
                              type: "trim",
                              sceneId: s.id,
                              startMs: 0,
                              endMs: Math.max(100, s.durationMs + ms),
                            },
                          ]);
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="caption-track">
                {scenes.map((s, i) => (
                  <button
                    key={s.id}
                    style={{ width: `${(s.durationMs / total) * 100}%` }}
                    onClick={() => {
                      selectScene(s.id);
                      setInspector("caption");
                    }}
                  >
                    <Type size={11} />
                    {s.text || `字幕 ${i + 1}`}
                  </button>
                ))}
              </div>
              <div
                className="audio-track"
                onClick={() => setInspector("audio")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setInspector("audio");
                }}
              >
                <Music2 size={12} />
                {composition?.audio?.assetId
                  ? (assets.find((a) => a.id === composition.audio!.assetId)
                      ?.name ?? "背景音乐")
                  : "原声音轨 · 点击调整音量或添加配乐"}
              </div>
              {!!total && (
                <div
                  className="playhead"
                  style={{
                    left: `${Math.min(100, ((time * 1000) / total) * 100)}%`,
                  }}
                >
                  <span />
                </div>
              )}
            </div>
          </div>
          {localError && (
            <div className="timeline-error" role="alert">
              {localError}
              <button onClick={() => setLocalError("")}>
                <X size={13} />
              </button>
            </div>
          )}
        </section>
        <div className="media-divider">
          <button
            title="素材放在底部"
            aria-pressed={!side}
            onClick={() => setSide(false)}
          >
            <PanelBottom size={13} />
          </button>
          <button
            title="素材放在侧边"
            aria-pressed={side}
            onClick={() => setSide(true)}
          >
            <PanelRight size={13} />
          </button>
        </div>
        <section className="media-library">
          <header>
            <strong>素材</strong>
            <select
              aria-label="素材范围"
              value={libraryScope}
              onChange={(e) => setLibraryScope(e.target.value)}
            >
              <option value="project">本作品</option>
              <option value="all">全部素材</option>
            </select>
            <select
              aria-label="素材用途分类"
              value={assetPurpose}
              onChange={(e) => setAssetPurpose(e.target.value)}
            >
              {["全部", ...assetCategories].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {chat.onLibrary && <button onClick={chat.onLibrary}>素材库</button>}
            <div className="toolbar-spacer" />
            {searchOpen && (
              <input
                autoFocus
                aria-label="搜索素材"
                placeholder="搜索名称或标签…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
            <button title="搜索素材" onClick={() => setSearchOpen(!searchOpen)}>
              <Search size={15} />
            </button>
            <select
              aria-label="素材类型"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">ALL</option>
              <option value="video">VIDEO</option>
              <option value="image">IMAGE</option>
              <option value="audio">AUDIO</option>
            </select>
            <select
              aria-label="素材排序"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="date">↓ DATE</option>
              <option value="name">NAME</option>
            </select>
            <button
              title="网格视图"
              className={!list ? "active" : ""}
              onClick={() => setList(false)}
            >
              <Grid2X2 size={14} />
            </button>
            <button
              title="列表视图"
              className={list ? "active" : ""}
              onClick={() => setList(true)}
            >
              <List size={14} />
            </button>
            <label className="media-upload" title="上传素材">
              <Plus size={16} />
              <input
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                onChange={(e) => {
                  if (e.target.files?.length) chat.onUpload(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </header>
          <div className={`media-grid ${list ? "list-view" : ""}`}>
            {media.map((a) => (
              <article
                key={a.id}
                className={selectedAssetId === a.id ? "selected" : ""}
              >
                <button
                  className="media-preview-button"
                  onClick={() => {
                    setSelectedAssetId(a.id);
                    setTime(0);
                    setMobile("preview");
                  }}
                >
                  <AssetThumb asset={a} />
                  {job?.outputs[0] === a.id && (
                    <span className="final-badge">FINAL</span>
                  )}
                  <span className="media-duration">
                    {a.kind === "image"
                      ? "IMAGE"
                      : timestamp((a.metadata?.durationMs ?? 0) / 1000)}
                  </span>
                  <span className="media-name">{a.name}</span>
                </button>
                <div className="media-actions">
                  {["image", "video"].includes(a.kind) && (
                    <button
                      className="replace-asset-button"
                      disabled={!scene || historical || !!busy}
                      onClick={() =>
                        scene &&
                        edit([
                          {
                            type: "visual",
                            sceneId: scene.id,
                            assetId: a.id,
                            preserveAudio: true,
                            fit: "contain",
                          },
                        ])
                      }
                    >
                      替换画面
                    </button>
                  )}
                  <button
                    title="添加到时间线"
                    disabled={!revision || historical}
                    onClick={() => addAsset(a)}
                  >
                    <Plus size={14} />
                  </button>
                  <a
                    href={`/api/assets/${a.id}/file`}
                    download={a.name}
                    aria-label={`下载 ${a.name}`}
                  >
                    <Download size={13} />
                  </a>
                </div>
              </article>
            ))}
            {!media.length && (
              <p className="empty-library">
                从素材库复用已有画面，或上传自己的素材。
              </p>
            )}
          </div>
        </section>
      </main>
      {inspector && (
        <aside className="clip-inspector">
          <header>
            <strong>
              {inspector === "versions"
                ? "版本记录"
                : inspector === "audio"
                  ? "声音与配乐"
                  : inspector === "caption"
                    ? "字幕"
                    : "片段编辑"}
            </strong>
            <button aria-label="关闭编辑面板" onClick={() => setInspector("")}>
              <X size={17} />
            </button>
          </header>
          {inspector === "versions" ? (
            <div className="version-list">
              {snapshot?.revisions.map((r) => (
                <article key={r.id}>
                  <strong>Version {r.version}</strong>
                  <small>{new Date(r.createdAt).toLocaleString()}</small>
                  <button disabled={dirty} onClick={() => onViewRevision(r.id)}>
                    查看
                  </button>
                  <button disabled={!!busy} onClick={() => onRestore(r.id)}>
                    恢复为新版本
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <fieldset disabled={!!busy || historical || !scene}>
              <span className="inspector-kicker">
                CLIP {index + 1} ·{" "}
                {((scene?.durationMs ?? 0) / 1000).toFixed(1)}s
              </span>
              {(inspector === "caption" || inspector === "clip") && (
                <>
                  <label>
                    文案 / 字幕
                    <textarea
                      aria-label="镜头字幕"
                      value={scene?.text ?? ""}
                      maxLength={1000}
                      onChange={(e) =>
                        scene &&
                        edit([
                          {
                            type: "caption",
                            sceneId: scene.id,
                            text: e.target.value,
                          },
                        ])
                      }
                      rows={3}
                    />
                  </label>
                  <p className="edit-help">
                    输入后即时预览，保存时一起应用。这里只修改独立字幕，不会改变配音或视频画面里的文字。
                  </p>
                  {composition && (
                    <CaptionStyleControls
                      key={revision?.id}
                      style={composition.captionStyle}
                      assets={assets}
                      onChange={(style) => edit([{ type: "style", ...style }])}
                    />
                  )}
                </>
              )}
              {inspector === "clip" && (
                <>
                  <hr />
                  <label>保留区间（秒）</label>
                  <div className="input-pair">
                    <input
                      aria-label="裁剪起点"
                      type="number"
                      min={0}
                      step={0.1}
                      value={trimStart}
                      onChange={(e) => setTrimStart(Number(e.target.value))}
                    />
                    <input
                      aria-label="裁剪终点"
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={trimEnd}
                      onChange={(e) => setTrimEnd(Number(e.target.value))}
                    />
                  </div>
                  <button
                    className="wide"
                    onClick={() =>
                      scene &&
                      edit([
                        {
                          type: "trim",
                          sceneId: scene.id,
                          startMs: Math.round(trimStart * 1000),
                          endMs: Math.round(trimEnd * 1000),
                        },
                      ])
                    }
                  >
                    应用裁剪
                  </button>
                  <div className="input-pair">
                    <button
                      disabled={index <= 0}
                      onClick={() =>
                        scene &&
                        edit([
                          {
                            type: "move",
                            sceneId: scene.id,
                            toIndex: index - 1,
                          },
                        ])
                      }
                    >
                      <ArrowLeft size={14} />
                      前移
                    </button>
                    <button
                      disabled={index >= scenes.length - 1}
                      onClick={() =>
                        scene &&
                        edit([
                          {
                            type: "move",
                            sceneId: scene.id,
                            toIndex: index + 1,
                          },
                        ])
                      }
                    >
                      后移
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <hr />
                  <label>
                    画幅
                    <select
                      value={`${composition?.width}:${composition?.height}`}
                      onChange={(e) => {
                        const [width, height] = e.target.value
                          .split(":")
                          .map(Number);
                        edit([{ type: "format", width, height }]);
                      }}
                    >
                      <option
                        value={`${composition?.width}:${composition?.height}`}
                      >
                        当前 {composition?.width} × {composition?.height}
                      </option>
                      <option value="1080:1920">9:16 · 1080P</option>
                      <option value="1920:1080">16:9 · 1080P</option>
                      <option value="1080:1080">1:1 · 1080P</option>
                      <option value="768:432">16:9 · 768 × 432</option>
                    </select>
                  </label>
                  <label>
                    填充方式
                    <select
                      value={scene?.fit ?? "contain"}
                      onChange={(e) =>
                        scene?.assetId &&
                        edit([
                          {
                            type: "scene_fit",
                            sceneId: scene.id,
                            fit: e.target.value as "contain" | "cover",
                          },
                        ])
                      }
                    >
                      <option value="contain">适应画布</option>
                      <option value="cover">填满画布</option>
                    </select>
                  </label>
                </>
              )}
              {(inspector === "audio" || inspector === "clip") && (
                <>
                  <hr />
                  {scene && (
                    <AudioControls
                      key={scene.id}
                      scene={scene}
                      assets={assets}
                      timeMs={time * 1000 - offset}
                      edit={edit}
                    />
                  )}
                  <label>
                    原声音量 · {Math.round((scene?.volume ?? 1) * 100)}%
                    <input
                      aria-label="原声音量"
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={scene?.volume ?? 1}
                      onChange={(e) =>
                        scene &&
                        edit([
                          {
                            type: "scene_audio",
                            sceneId: scene.id,
                            volume: Number(e.target.value),
                          },
                        ])
                      }
                    />
                  </label>
                  <label>
                    背景音乐
                    <select
                      aria-label="背景音乐"
                      value={composition?.audio?.assetId ?? ""}
                      onChange={(e) =>
                        edit([
                          {
                            type: "music",
                            assetId: e.target.value || null,
                            gain: 0.3,
                          },
                        ])
                      }
                    >
                      <option value="">无背景音乐</option>
                      {assets
                        .filter((a) => a.kind === "audio")
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="music-upload">
                    <Plus size={14} />
                    上传音乐
                    <input
                      type="file"
                      accept="audio/*"
                      aria-label="上传背景音乐"
                      onChange={(e) => {
                        if (e.target.files?.length)
                          chat.onUpload(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <p className="edit-help">
                    上传完成后在上方选择音乐，播放预览即可试听。原视频中混合的人声与音乐会一起受“原声音量”影响。
                  </p>
                  {composition?.audio && (
                    <label>
                      配乐音量 · {Math.round(composition.audio.gain * 100)}%
                      <input
                        aria-label="配乐音量"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={composition.audio.gain}
                        onChange={(e) =>
                          edit([
                            { type: "music", gain: Number(e.target.value) },
                          ])
                        }
                      />
                    </label>
                  )}
                </>
              )}
            </fieldset>
          )}
          <footer>
            <button
              className="pink wide"
              disabled={!dirty || !!busy}
              onClick={save}
            >
              <Save size={14} />
              保存并合成预览
            </button>
            <p>
              复用现有素材，不会重新生成画面。保存后创建新版本，可撤销编辑或恢复历史版本。
            </p>
          </footer>
        </aside>
      )}
    </div>
  );
}
