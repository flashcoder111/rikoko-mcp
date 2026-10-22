import React, { useEffect, useRef, useState } from "react";
import { api, type Snapshot } from "./api";

type Handoff = {
  requestId: string;
  prompt: string;
  hermesUrl: string;
  status: "prepared";
};
export default function HermesHandoff({
  snapshot,
  selectedSceneId,
  assetIds,
  draft,
  blocked,
  dirty,
}: {
  snapshot?: Snapshot;
  selectedSceneId?: string;
  assetIds: string[];
  draft: string;
  blocked: boolean;
  dirty: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Handoff>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const text = message ?? draft;
  const signature = JSON.stringify([
    snapshot?.project.id,
    snapshot?.revision?.id,
    selectedSceneId,
    assetIds,
    text,
  ]);
  const current = useRef(signature);
  current.current = signature;
  const attempt = useRef({ signature, key: crypto.randomUUID() });
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setPrepared(undefined);
    setNotice("");
  }, [signature]);
  async function prepare() {
    if (blocked || pending.current || !text.trim() || !snapshot?.revision)
      return;
    if (attempt.current.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    pending.current = true;
    setWorking(true);
    setNotice("");
    try {
      const result = await api<Handoff>("workspace_handoff_prepare", {
        projectId: snapshot.project.id,
        revisionId: snapshot.revision.id,
        selectedSceneId,
        assetIds,
        message: text.trim(),
        idempotencyKey: attempt.current.key,
      });
      if (mounted.current && current.current === signature) setPrepared(result);
    } catch (e) {
      if (mounted.current && current.current === signature)
        setNotice(e instanceof Error ? e.message : "准备失败，请重试。");
    } finally {
      pending.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  async function copyPrompt() {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(prepared.prompt);
      setNotice("已复制，请粘贴到 Hermes 原会话发送。");
    } catch {
      setNotice("无法自动复制，请选中上方指令手动复制。");
    }
  }
  return (
    <details className="hermes-handoff">
      <summary>交给 Hermes 继续</summary>
      <p>携带当前作品、选中镜头和已附加素材，回到 Hermes 原会话继续处理。</p>
      {dirty && <p role="status">请先保存并合成当前修改，再交给 Hermes。</p>}
      <label>
        继续修改的要求
        <textarea
          aria-label="交给 Hermes 的要求"
          value={text}
          maxLength={5000}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="例如：保留画面，帮我调整结尾文案和配乐节奏"
        />
      </label>
      <button
        type="button"
        disabled={blocked || working || !text.trim() || !snapshot?.revision}
        onClick={() => void prepare()}
      >
        {working ? "正在准备…" : "准备交给 Hermes"}
      </button>
      {prepared && !blocked && (
        <div className="hermes-handoff-ready">
          <a href={prepared.hermesUrl}>打开 Hermes，选择原会话</a>
          <p>
            选择会话后带入输入框，由你发送继续。需要安装 rikoko 的 Hermes
            桌面插件；未安装时可复制下方指令到原会话。
          </p>
          <textarea
            aria-label="Hermes 继续指令"
            readOnly
            value={prepared.prompt}
            rows={4}
          />
          <button type="button" onClick={() => void copyPrompt()}>
            复制继续指令
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <small>准备交接不会调用模型或生成视频。</small>
    </details>
  );
}
