import React, { useEffect, useRef, useState } from "react";
import {
  Download,
  ArrowUpRight,
  RotateCcw,
  Sparkles,
  LoaderCircle,
} from "lucide-react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import type {
  FaceStatus,
  VideoPolicy,
} from "../../../packages/contracts/src/video-policy.js";
import { videoModelFamily } from "../../../packages/contracts/src/video-policy.js";
import type { resolveVideoModel } from "../../../packages/core/src/video-model-selection.js";
import { api, type Job, statusLabels } from "./api";
import { VideoPreview } from "./media";
import {
  summarizeTaskUsage,
  usageText,
} from "../../../packages/core/src/task-usage.js";
export type GenerationRequest = {
  prompt: string;
  model: string;
  modelName: string;
  modelExplicit?: boolean;
  description: string;
  mediaKind: "image" | "video" | "audio";
  billingSource: "credits" | "external" | "testing";
  nonce: string;
  speech?: { language: string; voice: string };
  videoPolicy?: VideoPolicy;
};
function operation(request: GenerationRequest) {
  return request.speech
    ? {
        kind: "tts",
        engine: "fal",
        model: request.model,
        text: request.prompt,
        ...request.speech,
      }
    : {
        kind: "generate",
        model: request.model,
        prompt: request.prompt,
        parameters: {},
        ...(request.videoPolicy ? { videoPolicy: request.videoPolicy } : {}),
      };
}
export default function Generation({
  scope,
  request,
  onUse,
  onReprompt,
}: {
  scope: string;
  request?: GenerationRequest;
  onUse: (asset: Entity, studio: boolean) => Promise<void>;
  onReprompt: (
    prompt: string,
    model?: string,
    kind?: "image" | "video" | "audio",
  ) => void;
}) {
  const [job, setJob] = useState<Job>();
  const [asset, setAsset] = useState<Entity>();
  const [details, setDetails] = useState<GenerationRequest>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [faceStatus, setFaceStatus] = useState<FaceStatus>();
  const [selection, setSelection] =
    useState<ReturnType<typeof resolveVideoModel>>();
  const sequence = useRef(0);
  const storageKey = `rikoko-generation:${scope}`;
  useEffect(() => {
    if (request) return;
    let live = true;
    const seq = sequence.current;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        id: string;
        prompt: string;
        details?: GenerationRequest;
      };
      if (typeof saved.id !== "string") throw Error("Invalid saved job");
      void api<Job>("record_get", { type: "job", id: saved.id })
        .then((restored) => {
          if (live && seq === sequence.current) {
            setJob(restored);
            setPrompt(typeof saved.prompt === "string" ? saved.prompt : "");
            setDetails(saved.details);
          }
        })
        .catch(() => {
          if (live && seq === sequence.current)
            sessionStorage.removeItem(storageKey);
        });
    } catch {
      sessionStorage.removeItem(storageKey);
    }
    return () => {
      live = false;
    };
  }, [storageKey, request]);
  useEffect(() => {
    if (!request) return;
    const seq = ++sequence.current;
    setBusy(true);
    setError("");
    setJob(undefined);
    setPrompt(request.prompt);
    setDetails(request);
    setAsset(undefined);
    setFaceStatus(undefined);
    setSelection(undefined);
    if (request.mediaKind === "video") setBusy(false);
    else void generate(request, seq);
  }, [request]);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let live = true;
    const timer = setInterval(() => {
      void api<Job>("record_get", { type: "job", id: job.id })
        .then((j) => {
          if (live) setJob(j);
        })
        .catch((e) => {
          if (live)
            setError(
              e.code === "CAPABILITY_UNAVAILABLE"
                ? "所选模型暂不可用，请刷新模型目录或查看当前连接状态。"
                : e.message,
            );
        });
    }, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);
  useEffect(() => {
    setAsset(undefined);
    if (job?.status !== "completed" || !job.outputs[0]) return;
    let live = true;
    void api<Entity>("record_get", { type: "asset", id: job.outputs[0] })
      .then((a) => {
        if (live) setAsset(a);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [job?.id, job?.status, job?.outputs[0]]);
  async function resolveVideo(faces: FaceStatus, chosenModel?: string) {
    if (!request) return;
    const seq = sequence.current;
    setBusy(true);
    setError("");
    setFaceStatus(faces);
    try {
      const family = videoModelFamily({
        id: request.model,
        name: request.modelName,
      });
      const priorChoice =
        request.modelExplicit && ["minimax", "kling"].includes(family)
          ? request.model
          : undefined;
      const confirmedModel = chosenModel ?? priorChoice;
      const result = await api<ReturnType<typeof resolveVideoModel>>(
        "video_model_resolve",
        {
          faces,
          reason:
            "User assessment of the requested scene in the video composer",
          references: [],
          ...(faces === "absent" && request.modelExplicit
            ? { model: request.model }
            : {}),
          ...(confirmedModel
            ? { userChoice: { model: confirmedModel, confirmed: true } }
            : {}),
        },
      );
      if (seq !== sequence.current) return;
      setSelection(result);
      if (result.status === "ready" && result.selectedModel) {
        const selected = result.candidates.find(
          (m) => m.modelId === result.selectedModel,
        )!;
        const confirmedRequest = {
          ...request,
          model: selected.modelId,
          modelName: selected.name,
          videoPolicy: result.videoPolicy,
        };
        setDetails(confirmedRequest);
        await generate(confirmedRequest, seq);
      }
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }
  async function generate(request: GenerationRequest, seq: number) {
    setBusy(true);
    setError("");
    try {
      const j = await api<Job>("job_submit", {
        idempotencyKey: request.nonce,
        input: operation(request),
      });
      if (seq === sequence.current) {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            id: j.id,
            prompt: request.prompt,
            details: request,
          }),
        );
        setJob(j);
      }
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }
  async function use(studio: boolean) {
    if (!job?.outputs[0]) return;
    setBusy(true);
    try {
      await onUse(
        await api<Entity>("record_get", { type: "asset", id: job.outputs[0] }),
        studio,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!request && !job) return null;
  const mediaKind = asset?.kind ?? details?.mediaKind ?? "video";
  const label =
    mediaKind === "image"
      ? "图片生成"
      : mediaKind === "audio"
        ? "音频生成"
        : "视频生成";
  return (
    <article className="generation-turn">
      {prompt && <div className="user-bubble">{prompt}</div>}
      <div className="tool-label">
        <Sparkles size={15} /> rikoko · {label} <ArrowUpRight size={13} />
      </div>
      {job ? (
        <>
          <VideoPreview
            job={job}
            kind={mediaKind}
            compact
            onCancel={() =>
              void api("job_cancel", { jobId: job.id })
                .then(() => api<Job>("record_get", { type: "job", id: job.id }))
                .then(setJob)
                .catch((e) => setError(e.message))
            }
          />
          <div className="inline-result-actions">
            {job.status === "completed" && job.outputs[0] && (
              <>
                <a href={`/api/assets/${job.outputs[0]}/file`} download>
                  <Download size={15} /> 下载
                </a>
                <button disabled={busy} onClick={() => void use(true)}>
                  <ArrowUpRight size={15} /> 打开工作台
                </button>
                <button disabled={busy} onClick={() => void use(false)}>
                  继续剪辑
                </button>
              </>
            )}
            <button
              onClick={() =>
                onReprompt(
                  prompt,
                  details?.model ?? job.input?.model ?? job.model,
                  mediaKind,
                )
              }
            >
              <RotateCcw size={15} /> 调整提示词
            </button>
          </div>
          <p className="generation-status">
            {job.status === "completed"
              ? "生成完成"
              : (statusLabels[job.status] ?? job.status)}{" "}
            ·{" "}
            {details?.modelName ?? job.input?.model ?? job.model ?? "生成模型"}
          </p>
          <p className="generation-usage" aria-label="本次生成用量">
            {usageText(summarizeTaskUsage([job]))}
          </p>
        </>
      ) : request?.mediaKind === "video" && !details?.videoPolicy ? (
        <div className="pollo-pending">
          {!selection ? (
            <>
              <p>
                视频内容是否涉及人脸？无人脸默认使用 Seedance
                Mini；涉及人脸则推荐 MiniMax，也可选择 Kling。
              </p>
              <div className="inline-result-actions">
                <button
                  disabled={busy}
                  onClick={() => void resolveVideo("absent")}
                >
                  不涉及人脸
                </button>
                <button
                  disabled={busy}
                  onClick={() => void resolveVideo("present")}
                >
                  涉及人脸
                </button>
                <button
                  disabled={busy}
                  onClick={() => void resolveVideo("unknown")}
                >
                  不确定
                </button>
              </div>
            </>
          ) : (
            <>
              <p>{selection.userInteraction.message}</p>
              {selection.status === "capability_gap" && (
                <p>当前没有兼容且可用的模型，请检查模型配置。</p>
              )}
              <div className="inline-result-actions">
                {selection.candidates.map((m) => (
                  <button
                    key={m.modelId}
                    disabled={busy}
                    onClick={() => void resolveVideo(faceStatus!, m.modelId)}
                  >
                    使用 {m.name}
                    {m.modelId === selection.recommendedModel ? "（推荐）" : ""}
                  </button>
                ))}
                <button
                  disabled={busy}
                  onClick={() => {
                    setSelection(undefined);
                    setFaceStatus(undefined);
                  }}
                >
                  重新选择人脸状态
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="pollo-pending">
          <Sparkles size={28} />
          <span>{busy ? "正在提交生成" : "暂时无法生成"}</span>
          <p>
            {details?.modelName} {details?.description}
          </p>
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            request && (
              <button
                className="primary"
                onClick={() =>
                  void generate(details ?? request, sequence.current)
                }
              >
                重试提交
              </button>
            )
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="generation-error">
          {error}
        </p>
      )}
      <p className="generation-description">
        生成结果会直接出现在这里。可下载、修改提示词，或进入工作台继续剪辑。
      </p>
    </article>
  );
}
