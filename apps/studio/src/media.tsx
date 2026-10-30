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
        if (!r.ok) throw Error("Could not load media. Reconnect or refresh.");
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
    <img className="asset-thumb" src={url} alt={asset?.name ?? "Image asset"} />
  ) : (
    <span className="asset-thumb asset-type">
      {asset?.kind === "video"
        ? "Video"
        : asset?.kind === "audio"
          ? "Audio"
          : "Text"}
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
        <img className="generated-image" src={url} alt="Generated image" />
      ) : url && kind === "audio" ? (
        <div className="generated-audio">
          <span>Audio generated</span>
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
                : "Your preview will appear here")}
          </strong>
          <p>
            {job?.error?.message ??
              (active
                ? "Your task continues in the background. You can switch views or return later."
                : "Your generated and edited output stays with the same project.")}
          </p>
          {active && onCancel && (
            <button onClick={onCancel}>Cancel task</button>
          )}
          {job &&
            ["failed", "cancelled", "blocked_external"].includes(job.status) &&
            onRetry && <button onClick={onRetry}>Render again</button>}
        </div>
      )}
    </div>
  );
}
