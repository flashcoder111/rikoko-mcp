import React, { useRef, useState } from "react";
import { api } from "./api";
export default function SaveTemplate({
  revisionId,
  title,
  disabled,
  onSaved,
}: {
  revisionId: string;
  title: string;
  disabled: boolean;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(title),
    [description, setDescription] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const attempt = useRef<{ hash: string; key: string } | undefined>(undefined);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    const input = { revisionId, title: name.trim(), description };
    const hash = JSON.stringify(input);
    if (attempt.current?.hash !== hash)
      attempt.current = { hash, key: crypto.randomUUID() };
    try {
      await api("template_save", {
        ...input,
        idempotencyKey: attempt.current.key,
      });
      setMessage(
        "已保存到我的模板，Agent 可以检索复用。官方更新不会覆盖此模板。",
      );
      setOpen(false);
      onSaved?.();
      attempt.current = undefined;
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="save-personal-template">
      <button
        disabled={disabled || busy}
        onClick={() => {
          setName(title);
          setOpen(!open);
          setMessage("");
        }}
      >
        保存为我的模板
      </button>
      {open && (
        <form aria-label="保存个人模板" onSubmit={save}>
          <label>
            模板名称
            <input
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            用途描述
            <textarea
              maxLength={2000}
              placeholder="说明适合什么场景，方便 Agent 检索"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <p>保存当前已保存版本及素材引用，仅当前账户可用。</p>
          <button disabled={disabled || busy || !name.trim()}>
            {busy ? "正在保存…" : "保存模板"}
          </button>
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>
            取消
          </button>
        </form>
      )}
      {message && <span role="status">{message}</span>}
    </span>
  );
}
