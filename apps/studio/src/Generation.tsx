import React, { useEffect, useRef, useState } from "react";
import {
  Download,
  ArrowUpRight,
  RotateCcw,
  Sparkles,
  LoaderCircle,
} from "lucide-react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import { api, type Job, statusLabels } from "./api";
import { VideoPreview } from "./media";
export type GenerationRequest = {
  prompt: string;
  model: string;
  modelName: string;
  description: string;
  mediaKind: "image" | "video" | "audio";
  billingSource: "credits" | "external";
  nonce: string;
};
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
  const [quote, setQuote] = useState<{
    id: string;
    maxCostCents?: number;
    maxCents?: number;
    maxChargeCents?: number;
    fixedChargeCents?: number;
    billingSource?: "credits" | "external";
  }>();
  const [job, setJob] = useState<Job>();
  const [asset, setAsset] = useState<Entity>();
  const [details, setDetails] = useState<GenerationRequest>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const attempt = useRef("");
  const sequence = useRef(0);
  const storageKey = `hypit-generation:${scope}`;
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
    setQuote(undefined);
    setJob(undefined);
    setPrompt(request.prompt);
    setDetails(request);
    setAsset(undefined);
    attempt.current = request.nonce;
    void api<typeof quote>("quote_create", {
      input: {
        kind: "generate",
        model: request.model,
        prompt: request.prompt,
        parameters: {},
      },
    })
      .then((q) => {
        if (seq === sequence.current) setQuote(q);
      })
      .catch((e) => {
        if (seq === sequence.current)
          setError(
            e.code === "CAPABILITY_UNAVAILABLE"
              ? "所选模型暂不可用，请刷新模型目录或查看当前连接状态。"
              : e.message,
          );
      })
      .finally(() => {
        if (seq === sequence.current) setBusy(false);
      });
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
  async function generate() {
    if (!request || !quote || busy) return;
    setBusy(true);
    setError("");
    const seq = sequence.current;
    try {
      const j = await api<Job>("job_submit", {
        quoteId: quote.id,
        idempotencyKey: attempt.current,
        input: {
          kind: "generate",
          model: request.model,
          prompt: request.prompt,
          parameters: {},
        },
      });
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ id: j.id, prompt: request.prompt, details: request }),
      );
      if (seq === sequence.current) {
        setJob(j);
        setQuote(undefined);
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
  const cents = quote?.maxChargeCents ?? quote?.maxCents ?? quote?.maxCostCents;
  const external =
    (quote?.billingSource ?? details?.billingSource) === "external";
  return (
    <article className="generation-turn">
      {prompt && <div className="user-bubble">{prompt}</div>}
      <div className="tool-label">
        <Sparkles size={15} /> Hypit · {label} <ArrowUpRight size={13} />
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
        </>
      ) : (
        <div className="pollo-pending">
          <Sparkles size={28} />
          <span>
            {busy ? "正在获取报价" : error ? "暂时无法生成" : "生成前确认"}
          </span>
          {quote && (
            <>
              <p>
                {details?.modelName} {details?.description}
                <br />
                {external
                  ? "供应商费用上限"
                  : quote.fixedChargeCents !== undefined
                    ? "本次消耗官方套餐额度"
                    : "官方套餐额度预留上限"}{" "}
                {typeof cents === "number"
                  ? `US$${(cents / 100).toFixed(2)}`
                  : "尚未取得"}
                <br />
                {external
                  ? "由你的供应商账户付费，不扣官方套餐额度。"
                  : quote.fixedChargeCents !== undefined
                    ? "成功生成按本次报价扣费，可在 API 调用账单查看。"
                    : "先预留额度，费用核对后结算，可在 API 调用账单查看。"}
              </p>
              <button
                className="primary"
                disabled={busy || typeof cents !== "number"}
                onClick={() => void generate()}
              >
                确认并生成
              </button>
            </>
          )}
          {busy && <LoaderCircle className="spin" size={18} />}
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
