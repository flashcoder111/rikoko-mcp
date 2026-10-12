import React, { useEffect, useState } from "react";
import type {
  Composition,
  Entity,
} from "../../../packages/contracts/src/index.js";
import { envelopeGain } from "../../../packages/contracts/src/audio.js";
import type { Edit } from "../../../packages/core/src/workspace-contracts.js";
import { api } from "./api";

type Scene = Composition["scenes"][number];
export default function AudioControls({
  scene,
  assets,
  timeMs,
  edit,
}: {
  scene: Scene;
  assets: Entity[];
  timeMs: number;
  edit: (edits: Edit[]) => void;
}) {
  const [fadeIn, setFadeIn] = useState(0.5),
    [fadeOut, setFadeOut] = useState(0.5);
  const [wave, setWave] = useState<{ peaks: number[]; durationMs: number }>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const sourceId = scene.audioAssetId ?? scene.assetId;
  const source = assets.find((a) => a.id === sourceId);
  const startMs = scene.audioAssetId
    ? (scene.audioSourceStartMs ?? 0)
    : scene.sourceStartMs;
  const sourceDuration = Math.round(scene.durationMs * (scene.speed ?? 1));
  useEffect(() => {
    let live = true;
    setWave(undefined);
    setError("");
    if (!source?.metadata?.hasAudio) return;
    const timer = setTimeout(() => {
      void api<{ peaks: number[]; durationMs: number }>("asset_waveform", {
        assetId: sourceId,
        startMs,
        durationMs: Math.min(600_000, Math.max(100, sourceDuration)),
        bins: 256,
      }).then(
        (value) => {
          if (live) setWave(value);
        },
        (err) => {
          if (live) setError(err.message);
        },
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sourceId, source?.metadata?.hasAudio, startMs, sourceDuration, retry]);
  const points = scene.volumeEnvelope ?? [];
  const playhead = Math.max(0, Math.min(scene.durationMs, Math.round(timeMs)));
  function updatePoint(index: number, gain: number) {
    edit([
      {
        type: "audio_envelope",
        sceneId: scene.id,
        points: points.map((p, i) => (i === index ? { ...p, gain } : p)),
      },
    ]);
  }
  return (
    <div className="audio-controls">
      <label>
        成片速度 · 画面与声音同步
        <select
          aria-label="成片速度"
          value={scene.speed ?? 1}
          onChange={(e) =>
            edit([
              {
                type: "scene_speed",
                sceneId: scene.id,
                speed: Number(e.target.value),
              },
            ])
          }
        >
          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
          {scene.speed &&
            ![0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].includes(scene.speed) && (
              <option value={scene.speed}>{scene.speed}×</option>
            )}
        </select>
      </label>
      <p className="audio-hint">保留音高；背景音乐保持原速。</p>
      {source?.metadata?.hasAudio ? (
        <>
          <p className="audio-hint">
            源音频波形
            {sourceDuration > 600_000 ? "（仅显示前 10 分钟源素材）" : ""} ·
            绿线为音量曲线
          </p>
          {error ? (
            <p role="status">
              {error}{" "}
              <button onClick={() => setRetry((n) => n + 1)}>重试波形</button>
            </p>
          ) : wave ? (
            <svg
              viewBox="0 0 320 72"
              role="img"
              aria-label="音频波形和音量曲线"
              className="audio-waveform"
            >
              {wave.peaks.map((peak, i) => (
                <line
                  key={i}
                  x1={(i * 320) / wave.peaks.length}
                  x2={(i * 320) / wave.peaks.length}
                  y1={36 - peak * 34}
                  y2={36 + peak * 34}
                  stroke="#818ca2"
                />
              ))}
              <polyline
                fill="none"
                stroke="#a5dfb1"
                strokeWidth="2"
                points={Array.from(
                  { length: 65 },
                  (_, i) =>
                    `${i * 5},${68 - envelopeGain(points, ((i / 64) * wave.durationMs) / (scene.speed ?? 1)) * 64}`,
                ).join(" ")}
              />
            </svg>
          ) : (
            <p role="status">正在分析波形…</p>
          )}
        </>
      ) : (
        <p className="audio-hint">此镜头暂无声音素材。</p>
      )}
      <div className="input-pair">
        <label>
          淡入（秒）
          <input
            aria-label="淡入秒数"
            type="number"
            min="0"
            max={scene.durationMs / 1000}
            step="0.1"
            value={fadeIn}
            onChange={(e) => setFadeIn(Number(e.target.value))}
          />
        </label>
        <label>
          淡出（秒）
          <input
            aria-label="淡出秒数"
            type="number"
            min="0"
            max={scene.durationMs / 1000}
            step="0.1"
            value={fadeOut}
            onChange={(e) => setFadeOut(Number(e.target.value))}
          />
        </label>
      </div>
      <button
        onClick={() =>
          edit([
            {
              type: "audio_fade",
              sceneId: scene.id,
              inMs: Math.round(fadeIn * 1000),
              outMs: Math.round(fadeOut * 1000),
            },
          ])
        }
      >
        应用淡入淡出
      </button>
      <p className="audio-hint">
        应用淡入淡出会替换下面的曲线。百分比相对于原声音量。
      </p>
      {points.map((point, i) => (
        <label className="volume-point" key={point.timeMs}>
          {(point.timeMs / 1000).toFixed(2)} 秒 · {Math.round(point.gain * 100)}
          %
          <input
            aria-label={`音量点 ${i + 1}`}
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={point.gain}
            onChange={(e) => updatePoint(i, Number(e.target.value))}
          />
          <button
            aria-label={`删除音量点 ${i + 1}`}
            onClick={() =>
              edit([
                {
                  type: "audio_envelope",
                  sceneId: scene.id,
                  points: points.filter((_, n) => n !== i),
                },
              ])
            }
          >
            删除
          </button>
        </label>
      ))}
      <button
        disabled={
          points.length >= 64 || points.some((p) => p.timeMs === playhead)
        }
        onClick={() =>
          edit([
            {
              type: "audio_envelope",
              sceneId: scene.id,
              points: [
                ...points,
                { timeMs: playhead, gain: envelopeGain(points, playhead) },
              ].sort((a, b) => a.timeMs - b.timeMs),
            },
          ])
        }
      >
        在播放位置添加音量点 · {(playhead / 1000).toFixed(2)} 秒
      </button>
      {points.length > 0 && (
        <button
          onClick={() =>
            edit([{ type: "audio_envelope", sceneId: scene.id, points: [] }])
          }
        >
          清除音量曲线
        </button>
      )}
    </div>
  );
}
