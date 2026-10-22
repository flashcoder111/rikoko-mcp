import React, { useEffect, useRef, useState } from "react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import type { Proposal } from "../../../packages/core/src/workspace-contracts.js";
import {
  analysisCommand,
  analysisSettingLabels,
  parseAnalysisSetting,
  type AnalysisSetting,
} from "../../../packages/core/src/analysis-commands.js";
import {
  duration,
  api,
  latestJob,
  seconds,
  statusLabels,
  type Snapshot,
  type Capabilities,
} from "./api";
import { AssetThumb, VideoPreview } from "./media";
import { ArrowUp, Plus, Sparkles, ArrowUpRight } from "lucide-react";
import Generation, { type GenerationRequest } from "./Generation";
import {
  creativeCommands,
  draftCommand,
  commandRequirement,
  defaultGenerationModel,
  textGenerationModel,
  generationRole,
  generationRoles,
} from "../../../packages/core/src/commands.js";

const composerCommands = [...creativeCommands, analysisCommand];

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
  const [speechLanguage, setSpeechLanguage] = useState("zh");
  const [speechVoice, setSpeechVoice] = useState("");
  const [modelIds, setModelIds] = useState<Record<string, string>>({});
  const modelId = modelIds[creationMode] ?? "";
  function setModelId(id: string, role = creationMode) {
    setModelIds((previous) => ({ ...previous, [role]: id }));
  }
  const [commandPanel, setCommandPanel] = useState<"help" | "models">();
  const [commandNotice, setCommandNotice] = useState("");
  const analysisCommandState = useRef({ version: 0, pending: false });
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const [menuDismissed, setMenuDismissed] = useState(false);
  const command = draftCommand(draft);
  const commandSuggestions =
    command && !menuDismissed
      ? composerCommands.filter((item) => item.name.startsWith(command.name))
      : [];
  const models = (props.capabilities?.providers ?? []).filter(
    (m) => generationRole(m) === creationMode,
  );
  const selectedModel = modelId
    ? models.find((m) => m.id === modelId)
    : defaultGenerationModel(models);
  const official = props.capabilities?.generation.mode !== "custom";
  const [generation, setGeneration] = useState<GenerationRequest>();
  useEffect(() => {
    analysisCommandState.current = {
      version: analysisCommandState.current.version + 1,
      pending: false,
    };
    setCreationMode("edit");
    setModelIds({});
    setCommandPanel(undefined);
    setCommandNotice("");
    setGeneration(undefined);
  }, [props.snapshot?.project.id]);
  const [showHistory, setShowHistory] = useState(false);
  const messages = snapshot?.messages ?? [];
  const visible = showHistory ? messages.slice(-20) : messages.slice(-1);
  const current = snapshot?.revision;
  const job = latestJob(snapshot?.jobs ?? [], current?.id);
  const feed = useRef<HTMLDivElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const commandMenu = useRef<HTMLDivElement>(null);
  function changeMode(mode: string) {
    setCreationMode(mode);
  }
  function chooseModel(id: string) {
    const model = props.capabilities?.providers.find((m) => m.id === id);
    if (!model?.available) {
      setCommandNotice(
        "该模型尚未接入或未启用，请从当前目录选择。原模型保持不变。",
      );
      return false;
    }
    if (!textGenerationModel(model)) {
      setCommandNotice(
        "该档案需要结构化参考输入，请在 Agent 中使用 /rikoko model 并附上素材；当前输入框仅支持文字生成。",
      );
      return false;
    }
    const role = generationRole(model);
    setCreationMode(role);
    setModelId(model.id, role);
    setCommandNotice(`已选择 ${model.name}。发送创作要求即可生成。`);
    return true;
  }
  function runCommand() {
    if (!command) return false;
    const { name, argument, prefix } = command;
    const clear = () => setDraft(prefix);
    if (["help", "models"].includes(name) || !name) {
      if (argument) {
        setCommandNotice("此指令无需参数。补充要求请使用 /brief。");
        return true;
      }
      setCommandPanel(name === "models" ? "models" : "help");
      setCommandNotice("");
      clear();
    } else if (name === "analysis") {
      void runAnalysisCommand(argument, prefix, draft);
    } else if (name === "model") {
      setCommandPanel("models");
      if (!argument) setCommandNotice("请从模型目录选择，或输入 /model auto。");
      else if (argument.toLowerCase() === "auto") {
        setModelId("", creationMode === "edit" ? "video" : creationMode);
        if (creationMode === "edit") setCreationMode("video");
        setCommandNotice(
          "已恢复自动选择：无人脸视频优先使用 Seedance Mini；涉及人脸时停用 Seedance，推荐 MiniMax，也可选择 Kling，并与你确认。后期配音默认 ElevenLabs Eleven v3。",
        );
        clear();
      } else if (chooseModel(argument)) clear();
    } else if (["video", "image", "speech", "audio", "edit"].includes(name)) {
      if (argument) {
        setCommandNotice("切换方式无需参数；请换行填写创作要求。");
        return true;
      }
      changeMode(name);
      setCommandNotice("已切换创作方式，原有草稿与附件已保留。");
      clear();
    } else {
      const result = commandRequirement(name, argument);
      if ("error" in result) setCommandNotice(result.error);
      else {
        const label = result.text.split("：")[0] + "：";
        const lines = prefix.split("\n");
        const index =
          name === "style"
            ? lines.findIndex((line) => line.startsWith(label))
            : -1;
        if (index >= 0) lines[index] = result.text;
        else lines.push(result.text);
        const nextDraft = lines.filter(Boolean).join("\n");
        if (nextDraft.length > 5000) {
          setCommandNotice("创作要求超过 5000 字符，请缩短后重试。");
          return true;
        }
        setDraft(nextDraft);
        setCommandNotice(
          name === "reference"
            ? "已补充用途说明。请通过 + 上传文件；用途文字不会导入素材，也不会把附件自动传给生成模型。"
            : "已补充到草稿，发送前仍可修改。时长、画幅等要求直接用自然语言描述即可。",
        );
      }
    }
    return true;
  }
  async function runAnalysisCommand(
    argument: string,
    prefix: string,
    original: string,
  ) {
    if (analysisCommandState.current.pending) return;
    const version = analysisCommandState.current.version;
    try {
      const detail = parseAnalysisSetting(argument);
      analysisCommandState.current.pending = true;
      setCommandNotice(detail ? "正在保存分析精度…" : "正在读取分析精度…");
      const result = await api<{ detail: AnalysisSetting }>(
        "reference_analysis_settings",
        detail ? { detail } : {},
      );
      if (version !== analysisCommandState.current.version) return;
      if (currentDraft.current === original) setDraft(prefix);
      setCommandNotice(
        `${detail ? "已切换账号默认分析精度" : "当前账号默认分析精度"}：${analysisSettingLabels[result.detail]}。仅影响后续分析，尚未开始分析或产生费用。`,
      );
    } catch (error) {
      if (version === analysisCommandState.current.version)
        setCommandNotice(
          error instanceof Error ? error.message : "分析精度设置失败，请重试。",
        );
    } finally {
      if (version === analysisCommandState.current.version)
        analysisCommandState.current.pending = false;
    }
  }
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
                  应用并合成预览
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
            const selected = props.capabilities?.providers.find(
              (m) => m.id === model,
            );
            const role = selected
              ? generationRole(selected)
              : (kind ?? generation?.mediaKind ?? "video");
            setCreationMode(role);
            if (model) setModelId(model, role);
            setDraft(prompt);
          }}
        />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (runCommand()) return;
          if (!draft.trim() && !(creationMode === "edit" && attachments.length))
            return;
          if (creationMode !== "edit") {
            if (
              !selectedModel?.available ||
              !textGenerationModel(selectedModel)
            )
              return;
            setGeneration({
              prompt: draft.trim(),
              model: selectedModel.id,
              modelName: selectedModel.name,
              modelExplicit: !!modelId,
              description: selectedModel.description,
              mediaKind: selectedModel.kind,
              billingSource: official ? "credits" : "external",
              nonce: crypto.randomUUID(),
              ...(creationMode === "speech"
                ? {
                    speech: {
                      language: speechLanguage,
                      voice: speechVoice.trim() || "default",
                    },
                  }
                : {}),
            });
            setDraft("");
          } else props.onSend();
        }}
      >
        {(commandPanel || commandSuggestions.length > 0) && (
          <div
            ref={commandMenu}
            className="composer-commands"
            aria-label="rikoko 指令"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setCommandPanel(undefined);
                setMenuDismissed(true);
                promptInput.current?.focus();
              }
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              const buttons = [
                ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                  ":scope > button:not(:disabled), .composer-model-group > button:not(:disabled)",
                ),
              ];
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (!buttons.length) return;
              e.preventDefault();
              buttons[
                (index + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                  buttons.length
              ]?.focus();
            }}
          >
            <div className="composer-commands-heading">
              <strong>
                {commandPanel === "models" ? "当前模型" : "创作指令"}
              </strong>
              <button
                type="button"
                onClick={() => {
                  setCommandPanel(undefined);
                  setMenuDismissed(true);
                }}
              >
                收起
              </button>
            </div>
            {commandPanel === "models" ? (
              <>
                {!props.capabilities?.providers.some((m) =>
                  ["video", "image", "audio"].includes(m.kind),
                ) && <p>暂无生成模型。接入后会自动显示在这里。</p>}
                {generationRoles.map((role) => (
                  <div className="composer-model-group" key={role.id}>
                    <strong>{role.label}</strong>
                    {!props.capabilities?.providers.some(
                      (m) => generationRole(m) === role.id,
                    ) && <p>暂无已接入模型</p>}
                    {props.capabilities?.providers
                      .filter((m) => generationRole(m) === role.id)
                      .map((model) => (
                        <button
                          type="button"
                          key={model.id}
                          aria-pressed={modelIds[role.id] === model.id}
                          disabled={
                            !!busy ||
                            !model.available ||
                            !textGenerationModel(model)
                          }
                          onClick={() => {
                            if (
                              chooseModel(model.id) &&
                              command?.name === "model"
                            )
                              setDraft(command.prefix);
                          }}
                        >
                          <strong>{model.name}</strong>
                          <span>
                            {model.id} ·{" "}
                            {!model.available
                              ? "未启用"
                              : !textGenerationModel(model)
                                ? "需在 Agent 中绑定参考素材"
                                : "可用"}
                          </span>
                          <span>{model.description}</span>
                          {model.fixedParameters &&
                            Object.keys(model.fixedParameters).length > 0 && (
                              <span>
                                {Object.entries(model.fixedParameters)
                                  .map(
                                    ([key, value]) =>
                                      `${({ duration: "时长（秒）", aspect_ratio: "画幅", resolution: "分辨率", width: "宽度", height: "高度", num_images: "图片数量" } as Record<string, string>)[key] ?? key}：${value}`,
                                  )
                                  .join(" · ")}
                              </span>
                            )}
                        </button>
                      ))}
                  </div>
                ))}
                <p>
                  列表来自当前连接。未接入的模型不会被自动替代；选择模型不产生费用。
                </p>
              </>
            ) : (
              (commandPanel === "help"
                ? composerCommands
                : commandSuggestions
              ).map((item) => (
                <button
                  type="button"
                  key={item.name}
                  disabled={!!busy}
                  onClick={() => {
                    setDraft(
                      [
                        command?.prefix ?? draft,
                        `/${item.name}${item.usage.includes("<") ? " " : ""}`,
                      ]
                        .filter(Boolean)
                        .join("\n"),
                    );
                    setCommandPanel(undefined);
                    setMenuDismissed(false);
                    promptInput.current?.focus();
                  }}
                >
                  <strong>{item.usage}</strong>
                  <span>{item.description}</span>
                </button>
              ))
            )}
          </div>
        )}
        {commandNotice && (
          <p className="composer-note" role="status">
            {commandNotice}
          </p>
        )}
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
        {creationMode === "speech" && (
          <div className="composer-speech-controls">
            <label>
              配音语言
              <select
                aria-label="配音语言"
                value={speechLanguage}
                onChange={(e) => setSpeechLanguage(e.target.value)}
                disabled={!!busy}
              >
                {[
                  ["zh", "中文"],
                  ["en", "English"],
                  ["ja", "日本語"],
                  ["ko", "한국어"],
                  ["de", "Deutsch"],
                  ["fr", "Français"],
                  ["es", "Español"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              音色
              <input
                aria-label="配音音色"
                value={speechVoice}
                onChange={(e) => setSpeechVoice(e.target.value)}
                placeholder="使用模型预设音色"
                maxLength={80}
                disabled={!!busy}
              />
            </label>
            <span>用于后期修改或替换配音；视频原生声音默认保留。</span>
          </div>
        )}
        <textarea
          ref={promptInput}
          id={props.embedded ? "studio-prompt" : "chat-prompt"}
          placeholder={
            current
              ? "描述修改，例如：删除最后一个镜头…"
              : creationMode === "image"
                ? "描述你想生成的图片…"
                : creationMode === "speech"
                  ? "输入需要朗读的配音文案…"
                  : creationMode === "audio"
                    ? "描述音乐或音效…"
                    : "描述你想做的视频，不需要先选模板…"
          }
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setCommandPanel(undefined);
            setMenuDismissed(false);
          }}
          rows={2}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (
              e.key === "ArrowDown" &&
              commandMenu.current &&
              command &&
              !command.argument
            ) {
              const first =
                commandMenu.current.querySelector<HTMLButtonElement>(
                  ":scope > button:not(:disabled), .composer-model-group > button:not(:disabled)",
                );
              if (first) {
                e.preventDefault();
                first.focus();
              }
            }
            if (e.key === "Escape") {
              setCommandPanel(undefined);
              setMenuDismissed(true);
            }
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
          <button
            type="button"
            aria-label="查看斜杠指令"
            disabled={!!busy}
            onClick={() => {
              setCommandPanel(commandPanel ? undefined : "help");
              setMenuDismissed(false);
            }}
          >
            /
          </button>
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
            onChange={(e) => changeMode(e.target.value)}
          >
            {generationRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
            <option value="edit">自动创作与修改</option>
          </select>
          {creationMode !== "edit" && (
            <select
              aria-label="生成模型"
              value={selectedModel?.id ?? ""}
              disabled={!models.length}
              onChange={(e) => setModelId(e.target.value)}
            >
              {!selectedModel && <option value="">请选择可用模型</option>}
              {models.map((m) => (
                <option
                  key={m.id}
                  value={m.id}
                  disabled={!m.available || !textGenerationModel(m)}
                >
                  {m.name}
                  {m.available ? "" : " · 未启用"}
                  {m.generationInput ? " · 需参考素材" : ""}
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
              (!command &&
                creationMode !== "edit" &&
                (!selectedModel?.available ||
                  !textGenerationModel(selectedModel)))
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
            : "输入 / 查看指令 · Shift + Enter 换行 · 修改保留历史版本"}
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
