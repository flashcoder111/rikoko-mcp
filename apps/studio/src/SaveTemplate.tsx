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
        "Saved to My templates. Your agent can find and reuse it; official updates will not overwrite it.",
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
        Save as personal template
      </button>
      {open && (
        <form aria-label="Save personal template" onSubmit={save}>
          <label>
            Template name
            <input
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={2000}
              placeholder="Describe when to use it, so your agent can find it"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <p>
            Save this version and its asset references for your account only.
          </p>
          <button disabled={disabled || busy || !name.trim()}>
            {busy ? "Saving…" : "Save template"}
          </button>
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      )}
      {message && <span role="status">{message}</span>}
    </span>
  );
}
