import React, { useEffect, useRef, useState } from "react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import type { Proposal } from "../../../packages/core/src/workspace-contracts.js";
import {
  duration,
  latestJob,
  seconds,
  statusLabels,
  type Snapshot,
  type Capabilities,
} from "./api";
import { AssetThumb, VideoPreview } from "./media";
import { ArrowUp, Plus, Sparkles, ArrowUpRight } from "lucide-react";
import Generation, { type GenerationRequest } from "./Generation";

export type ChatProps = {
  snapshot?: Snapshot;
  draft: string;
  setDraft: (value: string) => void;
  attachments: Entity[];
  removeAttachment: (id: string) => void;
  proposal?: Proposal;
  submitted: string;
  busy: string;
  selectedSceneId?: string;
  onSend: () => void;
  onGeneratedAsset: (asset: Entity, studio: boolean) => Promise<void>;
  onApply: () => void;
  onDismiss: () => void;
  onUpload: (files: FileList) => void;
  onStudio: () => void;
  onCancel: (jobId: string) => void;
  onRetry: (revisionId: string) => void;
  embedded?: boolean;
  modelConnected: boolean;
  capabilities?: Capabilities;
  onPlans: () => void;
  onLibrary?: () => void;
};
export default function Chat(props: ChatProps) {
  const { snapshot, draft, setDraft, attachments, proposal, busy } = props;
  const [creationMode, setCreationMode] = useState("edit");
  const [modelId, setModelId] = useState("");
  const models = (props.capabilities?.providers ?? []).filter(
    (m) => m.kind === creationMode,
  );
  const selectedModel =
    models.find((m) => m.id === modelId) ??
    models.find((m) => m.available) ??
    models[0];
  const official = props.capabilities?.generation.mode !== "custom";
  const [generation, setGeneration] = useState<GenerationRequest>();
  useEffect(() => {
    setCreationMode("edit");
    setGeneration(undefined);
  }, [props.snapshot?.project.id]);
  const [showHistory, setShowHistory] = useState(false);
  const messages = snapshot?.messages ?? [];
  const visible = showHistory ? messages.slice(-20) : messages.slice(-1);
  const current = snapshot?.revision;
  const job = latestJob(snapshot?.jobs ?? [], current?.id);
  const feed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showHistory)
      feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [
    current?.id,
    job?.status,
    proposal,
    generation,
    props.submitted,
    showHistory,
  ]);
  return (
    <section
      className={`conversation ${props.embedded ? "embedded" : ""}`}
      aria-label={props.embedded ? "工作台助手" : "创作对话"}
    >
      <div className="conversation-feed" ref={feed} aria-live="polite">
        {!messages.length && !props.submitted && !generation && (
          <div className="conversation-welcome">
            <span className="welcome-mark">
              <Sparkles size={28} />
            </span>
            <h1>{props.embedded ? "Describe your video" : "你想创作什么？"}</h1>
            <p>
              直接描述你想做的视频，Agent 会自动匹配剪辑结构和可复用素材。
              <br />
              没有参考视频也可以开始；有图片或视频时，直接附上。
            </p>
            <p className="small-muted">
              例如：帮咖啡店做一条 15 秒的新品短片，介绍生椰拿铁，温暖一点。
            </p>
          </div>
        )}
        {messages.length > 1 && !showHistory && (
          <button className="quiet" onClick={() => setShowHistory(true)}>
            查看之前的创作记录
          </button>
        )}
        {visible.map((message) => {
          const messageJob = latestJob(snapshot!.jobs, message.revisionId);
          return (
            <article className="conversation-turn" key={message.id}>
              <div className="user-bubble">{message.text}</div>
              <div className="assistant-message">
                <span className="speaker-label">
                  {message.origin === "studio"
                    ? "工作台更新"
                    : message.origin === "agent"
                      ? "Agent 更新"
                      : "创作助手"}{" "}
                  · 版本 {message.version}
                </span>
                <p>{message.summary}</p>
                {message.revisionId !== current?.id && (
                  <span className="small-muted">
                    {messageJob
                      ? statusLabels[messageJob.status]
                      : "版本已保存"}
                  </span>
                )}
              </div>
            </article>
          );
        })}
        {current && !props.embedded && (
          <article className="conversation-result">
            <div className="tool-label">
              <Sparkles size={15} /> rikoko · 视频结果{" "}
              <ArrowUpRight size={13} />
            </div>
            <div className="result-heading">
              <div>
                <span className="eyebrow">YOUR VIDEO</span>
                <h2>{current.composition.title}</h2>
              </div>
              <span className="version-badge">
                {current.id === snapshot?.headRevisionId
                  ? "当前版本"
                  : "历史版本"}
                {current.version ? ` · ${current.version}` : ""}
              </span>
            </div>
            <VideoPreview
              job={job}
              compact
              onCancel={() => job && props.onCancel(job.id)}
              onRetry={() => props.onRetry(current.id)}
            />
            <div className="result-details">
              <span>
                {seconds(duration(current))} · {current.composition.width}:
                {current.composition.height} ·{" "}
                {current.composition.scenes.length} 个镜头
              </span>
              <span>{job ? statusLabels[job.status] : "已保存"}</span>
            </div>
            <div className="result-actions">
              <button className="primary" onClick={props.onStudio}>
                打开工作台
              </button>
              {job?.status === "completed" && (
                <a
                  className="button-link"
                  href={`/api/assets/${job.outputs[0]}/file`}
                  download="video.mp4"
                >
                  下载视频
                </a>
              )}
              <button onClick={() => setDraft("字幕大一点")}>继续修改</button>
            </div>
            {job?.status === "completed" && (
              <details>
                <summary>查看视频文案</summary>
                <p>{current.composition.title}</p>
                {current.composition.scenes
                  .filter((scene) => scene.text)
                  .map((scene) => (
                    <p key={scene.id}>{scene.text}</p>
                  ))}
                {current.composition.events
                  .filter((event) => event.kind === "text" && event.text)
                  .map((event) => (
                    <p key={event.id}>{event.text}</p>
                  ))}
              </details>
            )}
          </article>
        )}
        {props.submitted && (
          <div className="conversation-turn">
            <div className="user-bubble">{props.submitted}</div>
            {busy === "理解创作要求…" && (
              <p className="assistant-message" role="status">
                正在整理可执行的方案…
              </p>
            )}
          </div>
        )}
        {proposal && (
          <article className="proposal-card">
            <span className="speaker-label">
              {proposal.status === "waiting_input"
                ? "等待补充"
                : proposal.action?.type === "create" ||
                    proposal.engine !== "local-commands"
                  ? "创作方案"
                  : "编辑方案"}
            </span>
            <p>{proposal.message}</p>
            {!!proposal.missingInputs?.length && (
              <ul>
                {proposal.missingInputs.map((item) => (
                  <li key={item.id}>
                    <strong>{item.required ? "需要补充" : "可选"}：</strong>
                    {item.prompt}
                    <span className="small-muted"> · {item.purpose}</span>
                  </li>
                ))}
              </ul>
            )}
            {proposal.action && (
              <>
                <div className="proposal-details">
                  {proposal.action.type === "create"
                    ? `${proposal.action.composition.scenes.length} 个镜头 · ${seconds(proposal.action.composition.scenes.reduce((s, c) => s + c.durationMs, 0))}`
                    : proposal.action.type === "edit"
                      ? `${proposal.action.edits.length} 项修改 · 保留原版`
                      : "恢复历史版本"}{" "}
                  · 本地合成 0 费用
                </div>
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={props.onApply}
                >
                  应用并生成预览
                </button>
              </>
            )}
            <button
              className="quiet"
              disabled={!!busy}
              onClick={props.onDismiss}
            >
              {proposal.action ? "调整要求" : "我来补充"}
            </button>
          </article>
        )}
        <Generation
          key={snapshot?.project.id ?? "new"}
          scope={snapshot?.project.id ?? "new"}
          request={generation}
          onUse={props.onGeneratedAsset}
          onReprompt={(prompt, model, kind) => {
            setCreationMode(kind ?? generation?.mediaKind ?? "video");
            if (model) setModelId(model);
            setDraft(prompt);
          }}
        />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            busy ||
            (!draft.trim() && !(creationMode === "edit" && attachments.length))
          )
            return;
          if (creationMode !== "edit") {
            if (!selectedModel?.available) return;
            setGeneration({
              prompt: draft.trim(),
              model: selectedModel.id,
              modelName: selectedModel.name,
              description: selectedModel.description,
              mediaKind: selectedModel.kind,
              billingSource: official ? "credits" : "external",
              nonce: crypto.randomUUID(),
            });
            setDraft("");
          } else props.onSend();
        }}
      >
        {props.selectedSceneId && (
          <div className="selection-context">正在针对所选镜头修改</div>
        )}
        {!!attachments.length && (
          <div className="attached-assets">
            {attachments.map((asset) => (
              <div key={asset.id}>
                <AssetThumb asset={asset} />
                <span>{asset.name}</span>
                <button
                  type="button"
                  aria-label={`移除附件 ${asset.name}`}
                  onClick={() => props.removeAttachment(asset.id)}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
        {!!attachments.length && creationMode !== "edit" && (
          <p className="composer-note">
            本次生成使用文字提示。已上传素材保留在素材库，可用于剪辑与编排。
          </p>
        )}
        <label
          className="sr-only"
          htmlFor={props.embedded ? "studio-prompt" : "chat-prompt"}
        >
          创作要求
        </label>
        <textarea
          id={props.embedded ? "studio-prompt" : "chat-prompt"}
          placeholder={
            current
              ? "描述修改，例如：删除最后一个镜头…"
              : creationMode === "image"
                ? "描述你想生成的图片…"
                : creationMode === "audio"
                  ? "输入配音文案，或描述音乐和音效…"
                  : "描述你想做的视频，不需要先选模板…"
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          maxLength={5000}
        />
        <div className="composer-bottom">
          <label className={`upload-button ${busy ? "disabled" : ""}`}>
            <Plus size={19} />
            <span className="sr-only">上传素材</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/*"
              multiple
              disabled={!!busy}
              onChange={(e) => {
                if (e.target.files?.length) props.onUpload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {props.onLibrary && (
            <button type="button" disabled={!!busy} onClick={props.onLibrary}>
              素材库
            </button>
          )}
          <select
            aria-label="创作方式"
            value={creationMode}
            onChange={(e) => setCreationMode(e.target.value)}
          >
            <option value="video">视频生成</option>
            <option value="image">图片生成</option>
            <option value="audio">音频生成</option>
            <option value="edit">自动创作与修改</option>
          </select>
          {creationMode !== "edit" && (
            <select
              aria-label="生成模型"
              value={selectedModel?.id ?? ""}
              disabled={!models.length}
              onChange={(e) => setModelId(e.target.value)}
            >
              {!models.length && <option value="">暂无可用模型</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.available}>
                  {m.name}
                  {m.available ? "" : " · 未启用"}
                </option>
              ))}
            </select>
          )}
          <button
            className="send-button"
            disabled={
              !!busy ||
              (!draft.trim() &&
                !(creationMode === "edit" && attachments.length)) ||
              (creationMode !== "edit" && !selectedModel?.available)
            }
            type="submit"
          >
            <ArrowUp size={18} />
            <span className="sr-only">发送</span>
          </button>
        </div>
        <p className="composer-note">
          {creationMode !== "edit"
            ? `${official ? "官方套餐额度" : "自有服务 · 供应商账户付费"} · ${selectedModel?.description || "生成前确认费用"}`
            : "Shift + Enter 换行 · 修改保留历史版本"}
        </p>
        {creationMode !== "edit" && !selectedModel?.available && (
          <div className="model-empty">
            {props.capabilities?.generation.error ??
              (official
                ? "连接官方套餐后，使用可用的图片、视频和音频模型。"
                : "当前类型尚未在 config 中启用。")}
            {official && (
              <button type="button" onClick={props.onPlans}>
                查看官方套餐
              </button>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
