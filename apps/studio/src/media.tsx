import React, { useEffect, useState } from "react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import { statusLabels, type Job } from "./api";

export function useAssetUrl(id?: string) {
  const [state, setState] = useState({ id: "", url: "", error: "" });
  useEffect(() => {
    if (!id) return;
    const abort = new AbortController();
    let url = "";
    fetch(`/api/assets/${encodeURIComponent(id)}/file`, {
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error("素材加载失败，请重新连接或刷新。");
        return r.blob();
      })
      .then((blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ id, url, error: "" });
      })
      .catch((e) => {
        if (!abort.signal.aborted) setState({ id, url: "", error: e.message });
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return state.id === id ? state : { url: "", error: "" };
}
export function AssetThumb({ asset }: { asset?: Entity }) {
  const { url } = useAssetUrl(
    asset && ["image", "video"].includes(asset.kind) ? asset.id : undefined,
  );
  return url && asset?.kind === "video" ? (
    <video
      className="asset-thumb"
      src={url}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = 0.1;
      }}
    />
  ) : url ? (
    <img className="asset-thumb" src={url} alt={asset?.name ?? "图片素材"} />
  ) : (
    <span className="asset-thumb asset-type">
      {asset?.kind === "video"
        ? "视频"
        : asset?.kind === "audio"
          ? "音频"
          : "文字"}
    </span>
  );
}
export function VideoPreview({
  job,
  kind = "video",
  compact = false,
  videoRef,
  onTime,
  onCancel,
  onRetry,
}: {
  job?: Job;
  kind?: "image" | "video" | "audio";
  compact?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onTime?: (seconds: number) => void;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const { url, error } = useAssetUrl(
    job?.status === "completed" ? job.outputs[0] : undefined,
  );
  const active = job && ["queued", "running"].includes(job.status);
  return (
    <div className={`result-preview ${compact ? "compact" : ""}`}>
      {url && kind === "image" ? (
        <img className="generated-image" src={url} alt="生成的图片" />
      ) : url && kind === "audio" ? (
        <div className="generated-audio">
          <span>音频已生成</span>
          <audio controls src={url} preload="metadata" />
        </div>
      ) : url ? (
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          src={url}
          onTimeUpdate={(e) => onTime?.(e.currentTarget.currentTime)}
        />
      ) : (
        <div className="preview-state" role="status">
          {active && <span className="progress-ring" />}
          <strong>
            {error ||
              (job
                ? (statusLabels[job.status] ?? job.status)
                : "预览会显示在这里")}
          </strong>
          <p>
            {job?.error?.message ??
              (active
                ? "任务在后台继续，可以切换模式或稍后回来。"
                : "制作与修改后的成片，保存在同一份作品里。")}
          </p>
          {active && onCancel && <button onClick={onCancel}>取消任务</button>}
          {job &&
            ["failed", "cancelled", "blocked_external"].includes(job.status) &&
            onRetry && <button onClick={onRetry}>重新合成</button>}
        </div>
      )}
    </div>
  );
}
