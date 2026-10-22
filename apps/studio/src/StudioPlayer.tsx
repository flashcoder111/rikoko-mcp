import { captionCss } from "./caption-style";
import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Download,
  Pencil,
  Square,
  MoveUpRight,
  Undo2,
  Trash2,
  X,
} from "lucide-react";
import type {
  Composition,
  Entity,
} from "../../../packages/contracts/src/index.js";
import { useAssetUrl } from "./media";
import { type Job } from "./api";
import { envelopeGain } from "../../../packages/contracts/src/audio.js";
import { PreviewAudio } from "./preview-audio";
import { sceneCaptionInterval } from "../../../packages/contracts/src/captions.js";
export const timestamp = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export function Filmstrip({
  assetId,
  start = 0,
  duration = 5,
  count = 8,
}: {
  assetId?: string;
  start?: number;
  duration?: number;
  count?: number;
}) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    setFrames([]);
    if (!assetId) return;
    let live = true;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = `/api/assets/${encodeURIComponent(assetId)}/file`;
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 64;
    let index = 0;
    const captured: string[] = [];
    const seek = () => {
      video.currentTime = Math.min(
        Math.max(0, video.duration - 0.05),
        start + (duration * (index + 0.15)) / count,
      );
    };
    video.onloadeddata = seek;
    video.onseeked = () => {
      if (!live) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scale = Math.max(100 / video.videoWidth, 64 / video.videoHeight);
      ctx.drawImage(
        video,
        (100 - video.videoWidth * scale) / 2,
        (64 - video.videoHeight * scale) / 2,
        video.videoWidth * scale,
        video.videoHeight * scale,
      );
      captured.push(canvas.toDataURL("image/jpeg", 0.65));
      index++;
      if (index < count) seek();
      else setFrames([...captured]);
    };
    return () => {
      live = false;
      video.onloadeddata = null;
      video.onseeked = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [assetId, start, duration, count]);
  return (
    <span className="filmstrip">
      {frames.map((src, i) => (
        <img src={src} alt="" key={i} />
      ))}
    </span>
  );
}
export default function StudioPlayer({
  composition,
  assets,
  job,
  dirty,
  time,
  setTime,
  onAnnotate,
  selectedAsset,
}: {
  composition?: Composition;
  assets: Entity[];
  job?: Job;
  dirty: boolean;
  time: number;
  setTime: (n: number) => void;
  onAnnotate: (text: string, frame?: File) => void;
  selectedAsset?: { id: string; kind: string; name: string };
}) {
  const video = useRef<HTMLVideoElement>(null),
    audio = useRef<HTMLAudioElement>(null),
    music = useRef<HTMLAudioElement>(null),
    container = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 360 });
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const ratio = (composition?.width ?? 16) / (composition?.height ?? 9);
  const frameWidth = Math.min(size.width - 24, (size.height - 24) * ratio);
  const frameHeight = frameWidth / ratio;
  const [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false),
    [rate, setRate] = useState(1),
    [annotating, setAnnotating] = useState(false),
    [color, setColor] = useState("#ff6b9f"),
    [drawTool, setDrawTool] = useState("pen");
  const [strokes, setStrokes] = useState<
    { x: number; y: number; color: string; tool: string }[][]
  >([]);
  const drawing = useRef(false);
  const sound = useRef(new PreviewAudio());
  useEffect(() => () => sound.current.close(), []);
  const total =
    (composition?.scenes.reduce((n, s) => n + s.durationMs, 0) ?? 0) / 1000;
  let offset = 0;
  const scene = composition?.scenes.find((s, i) => {
    if (
      time < offset + s.durationMs / 1000 ||
      i === composition.scenes.length - 1
    )
      return true;
    offset += s.durationMs / 1000;
    return false;
  });
  const rendered = !dirty && job?.status === "completed" && !selectedAsset;
  const captionInterval = scene ? sceneCaptionInterval(scene) : undefined;
  const showCaption =
    captionInterval &&
    (time - offset) * 1000 >= captionInterval.startMs &&
    (time - offset) * 1000 < captionInterval.endMs;
  const assetId =
    selectedAsset?.id ?? (rendered ? job.outputs[0] : scene?.assetId);
  const { url, error } = useAssetUrl(assetId);
  const { url: audioUrl } = useAssetUrl(
    !rendered && !selectedAsset ? scene?.audioAssetId : undefined,
  );
  const { url: musicUrl } = useAssetUrl(
    !rendered && !selectedAsset ? composition?.audio?.assetId : undefined,
  );
  const isImage =
    selectedAsset?.kind === "image" ||
    (!rendered &&
      assets.find((a) => a.id === scene?.assetId)?.kind === "image");
  const isAudio = selectedAsset?.kind === "audio";
  const position =
    selectedAsset || rendered
      ? time
      : (time - offset) * (scene?.speed ?? 1) +
        (scene?.sourceStartMs ?? 0) / 1000;
  useEffect(() => {
    const v = video.current;
    if (v && Math.abs(v.currentTime - position) > 0.18)
      v.currentTime = position;
    const a = audio.current;
    if (a) {
      const t =
        (time - offset) * (scene?.speed ?? 1) +
        (scene?.audioSourceStartMs ?? 0) / 1000;
      if (Math.abs(a.currentTime - t) > 0.18) a.currentTime = t;
    }
    if (
      music.current &&
      Number.isFinite(music.current.duration) &&
      music.current.duration > 0
    ) {
      const t = time % music.current.duration;
      if (Math.abs(music.current.currentTime - t) > 0.18)
        music.current.currentTime = t;
    }
  }, [time, position, url, audioUrl, musicUrl, scene?.speed]);
  useEffect(() => {
    sound.current.retain([video.current, audio.current, music.current]);
    for (const el of [video.current, audio.current, music.current]) {
      if (!el) continue;
      el.playbackRate =
        rate *
        (el === music.current || rendered || selectedAsset
          ? 1
          : (scene?.speed ?? 1));
      el.preservesPitch = true;
      el.muted = muted;
      if (el === video.current && audioUrl) el.muted = true;
      if (playing) void el.play().catch(() => {});
      else el.pause();
    }
  }, [
    playing,
    muted,
    rate,
    url,
    audioUrl,
    musicUrl,
    scene?.volume,
    scene?.speed,
    composition?.audio?.gain,
    rendered,
    selectedAsset,
  ]);
  useEffect(() => {
    for (const el of [video.current, audio.current, music.current]) {
      if (!el) continue;
      const gain =
        el === music.current
          ? (composition?.audio?.gain ?? 0.1)
          : rendered || selectedAsset
            ? 1
            : (scene?.volume ?? 1) *
              envelopeGain(scene?.volumeEnvelope, (time - offset) * 1000);
      sound.current.setGain(el, gain);
    }
  }, [
    time,
    offset,
    scene,
    rendered,
    selectedAsset,
    composition?.audio?.gain,
    url,
    audioUrl,
    musicUrl,
    playing,
  ]);
  useEffect(() => {
    if (!playing || selectedAsset) return;
    let prev = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const next = time + ((now - prev) / 1000) * rate;
      prev = now;
      if (next >= total) {
        setPlaying(false);
        setTime(0);
      } else setTime(next);
    }, 40);
    return () => clearInterval(timer);
  }, [playing, time, total, rate, selectedAsset]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const stroke of strokes) {
      ctx.beginPath();
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.strokeStyle = stroke[0]?.color ?? color;
      const first = stroke[0],
        last = stroke.at(-1);
      if (first && last && first.tool === "rectangle") {
        ctx.strokeRect(
          first.x * c.width,
          first.y * c.height,
          (last.x - first.x) * c.width,
          (last.y - first.y) * c.height,
        );
        continue;
      }
      if (first && last && first.tool === "arrow") {
        const x = last.x * c.width,
          y = last.y * c.height,
          a = Math.atan2(
            (last.y - first.y) * c.height,
            (last.x - first.x) * c.width,
          );
        ctx.moveTo(first.x * c.width, first.y * c.height);
        ctx.lineTo(x, y);
        ctx.lineTo(x - 16 * Math.cos(a - 0.5), y - 16 * Math.sin(a - 0.5));
        ctx.moveTo(x, y);
        ctx.lineTo(x - 16 * Math.cos(a + 0.5), y - 16 * Math.sin(a + 0.5));
        ctx.stroke();
        continue;
      }
      stroke.forEach((p, i) =>
        i
          ? ctx.lineTo(p.x * c.width, p.y * c.height)
          : ctx.moveTo(p.x * c.width, p.y * c.height),
      );
      ctx.stroke();
    }
  }, [strokes, annotating, color]);
  return (
    <section className="studio-player" ref={container}>
      <div className="player-stage" ref={stage}>
        <span className="preview-filename">
          {selectedAsset?.name ?? composition?.title ?? "Preview"}
        </span>
        {url ? (
          isImage ? (
            <img className="stage-media" src={url} alt={selectedAsset?.name} />
          ) : isAudio ? (
            <audio controls src={url} />
          ) : (
            <video
              className="stage-media"
              ref={video}
              src={url}
              playsInline
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = position;
              }}
              onError={() => setPlaying(false)}
              onEnded={() => {
                if (selectedAsset) setPlaying(false);
              }}
              onTimeUpdate={(e) => {
                if (selectedAsset) setTime(e.currentTarget.currentTime);
              }}
              style={{
                objectFit: rendered ? "contain" : (scene?.fit ?? "contain"),
              }}
            />
          )
        ) : scene && !scene.assetId ? (
          <div
            className="color-stage"
            style={{
              background: scene.color,
              aspectRatio: `${composition!.width}/${composition!.height}`,
            }}
          />
        ) : (
          <div className="player-empty">
            {error ||
              (job && ["running", "queued"].includes(job.status)
                ? "Rendering your video…"
                : "Select a media item below to preview it here.")}
          </div>
        )}
        {!rendered && !selectedAsset && scene?.text && showCaption && (
          <div
            className="live-caption"
            style={{
              ...captionCss(
                composition!.captionStyle,
                frameWidth / composition!.width,
              ),
              width: frameWidth * 0.94,
              bottom: (size.height - frameHeight) / 2 + frameHeight * 0.1,
            }}
          >
            {scene.text}
          </div>
        )}
        {audioUrl && <audio ref={audio} src={audioUrl} />}{" "}
        {musicUrl && <audio ref={music} src={musicUrl} loop />}
        {annotating && (
          <canvas
            className="annotation-canvas"
            ref={canvas}
            width={1280}
            height={720}
            onPointerDown={(e) => {
              drawing.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              const b = e.currentTarget.getBoundingClientRect();
              setStrokes((s) => [
                ...s,
                [
                  {
                    x: (e.clientX - b.left) / b.width,
                    y: (e.clientY - b.top) / b.height,
                    color,
                    tool: drawTool,
                  },
                ],
              ]);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const b = e.currentTarget.getBoundingClientRect();
              setStrokes((s) =>
                s.map((v, i) =>
                  i === s.length - 1
                    ? [
                        ...v,
                        {
                          x: (e.clientX - b.left) / b.width,
                          y: (e.clientY - b.top) / b.height,
                          color,
                          tool: drawTool,
                        },
                      ]
                    : v,
                ),
              );
            }}
            onPointerUp={() => {
              drawing.current = false;
            }}
          />
        )}
      </div>
      {annotating ? (
        <div className="annotation-tools">
          <button
            title="画笔"
            className={drawTool === "pen" ? "active" : ""}
            onClick={() => setDrawTool("pen")}
          >
            <Pencil size={17} />
          </button>
          <button
            title="箭头"
            className={drawTool === "arrow" ? "active" : ""}
            onClick={() => setDrawTool("arrow")}
          >
            <MoveUpRight size={17} />
          </button>
          <button
            title="矩形"
            className={drawTool === "rectangle" ? "active" : ""}
            onClick={() => setDrawTool("rectangle")}
          >
            <Square size={17} />
          </button>
          {["#ff6b9f", "#ffd54a", "#39d47a", "#ffffff"].map((c) => (
            <button
              aria-label={`颜色 ${c}`}
              key={c}
              className={color === c ? "active" : ""}
              style={{
                background: c,
                width: 20,
                height: 20,
                padding: 0,
                borderRadius: "50%",
              }}
              onClick={() => setColor(c)}
            />
          ))}
          <button
            title="撤销标注"
            onClick={() => setStrokes((s) => s.slice(0, -1))}
          >
            <Undo2 size={16} />
          </button>
          <button title="清除标注" onClick={() => setStrokes([])}>
            <Trash2 size={16} />
          </button>
          <span>Annotating · {timestamp(time)}</span>
          <button onClick={() => setAnnotating(false)}>
            <X size={16} />
            取消
          </button>
          <button
            className="pink"
            onClick={() => {
              const points = strokes.flat();
              const region = points.length
                ? `，标注范围 x ${Math.round(Math.min(...points.map((p) => p.x)) * 100)}–${Math.round(Math.max(...points.map((p) => p.x)) * 100)}%，y ${Math.round(Math.min(...points.map((p) => p.y)) * 100)}–${Math.round(Math.max(...points.map((p) => p.y)) * 100)}%`
                : "";
              const message = `在 ${time.toFixed(1)} 秒的画面${region}，我想修改：`;
              const capture = document.createElement("canvas");
              const stageNode = stage.current;
              if (stageNode && canvas.current) {
                capture.width = stageNode.clientWidth;
                capture.height = stageNode.clientHeight;
                const ctx = capture.getContext("2d");
                const media = stageNode.querySelector("video,img") as
                  HTMLVideoElement | HTMLImageElement | null;
                if (ctx) {
                  ctx.fillStyle = "#131315";
                  ctx.fillRect(0, 0, capture.width, capture.height);
                  if (media) {
                    const b = media.getBoundingClientRect(),
                      p = stageNode.getBoundingClientRect();
                    const w =
                        media instanceof HTMLVideoElement
                          ? media.videoWidth
                          : media.naturalWidth,
                      h =
                        media instanceof HTMLVideoElement
                          ? media.videoHeight
                          : media.naturalHeight;
                    const scale = Math.min(b.width / w, b.height / h);
                    if (w && h)
                      ctx.drawImage(
                        media,
                        b.left - p.left + (b.width - w * scale) / 2,
                        b.top - p.top + (b.height - h * scale) / 2,
                        w * scale,
                        h * scale,
                      );
                  }
                  ctx.drawImage(
                    canvas.current,
                    0,
                    0,
                    capture.width,
                    capture.height,
                  );
                  capture.toBlob((blob) =>
                    onAnnotate(
                      message,
                      blob
                        ? new File([blob], `frame-${time.toFixed(1)}s.png`, {
                            type: "image/png",
                          })
                        : undefined,
                    ),
                  );
                } else onAnnotate(message);
              } else onAnnotate(message);
              setAnnotating(false);
            }}
          >
            带入对话
          </button>
        </div>
      ) : (
        <div className="player-controls">
          <button
            aria-label={playing ? "暂停" : "播放"}
            onClick={() => {
              sound.current.resume();
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <span>
            {timestamp(time)} /{" "}
            {timestamp(selectedAsset ? video.current?.duration || 0 : total)}
          </span>
          <div className="controls-spacer" />
          <button
            title="在当前画面标注"
            onClick={() => {
              setPlaying(false);
              setAnnotating(true);
            }}
          >
            <Pencil size={16} />
          </button>
          <button
            aria-label={muted ? "取消静音" : "静音"}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <select
            aria-label="预览播放速度"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
          >
            {[0.5, 1, 1.5, 2].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
          {assetId && (
            <a
              aria-label="下载预览素材"
              href={`/api/assets/${assetId}/file`}
              download
            >
              <Download size={17} />
            </a>
          )}
          <button
            title="全屏"
            onClick={() => void container.current?.requestFullscreen()}
          >
            <Maximize size={17} />
          </button>
        </div>
      )}
    </section>
  );
}
