import React, { useEffect, useState } from "react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import type { Template } from "../../../packages/templates/src/schema.js";
import { api } from "./api";
import "./templates.css";
export default function Templates({
  onOpen,
}: {
  onOpen: (projectId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<{
    templates: (Template & { hash: string })[];
    syncedAt?: string;
    configured?: boolean;
  }>({ templates: [] });
  const [selected, setSelected] = useState<Template>();
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void api<typeof snapshot>("template_list")
      .then((v) => {
        if (live) setSnapshot(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function update() {
    setBusy(true);
    setError("");
    try {
      setSnapshot(await api("template_sync"));
      setSelected(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ project: Entity; revision: Entity }>(
        "template_apply",
        { id: selected.id, version: selected.version, parameters },
      );
      const input = {
        kind: "render",
        revisionId: result.revision.id,
        composition: result.revision.composition,
      };
      const quote = await api<Entity>("quote_create", { input });
      await api("job_submit", {
        quoteId: quote.id,
        input,
        idempotencyKey: `template-${result.revision.id}`,
      });
      onOpen(result.project.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="template-library">
      <div className="template-heading">
        <div>
          <span className="eyebrow">TEMPLATE LIBRARY</span>
          <h1>从一个模板开始</h1>
          <p>免费更新模板，在本地创建和渲染作品。无需开通付费 API。</p>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void update()}
        >
          {busy ? "处理中…" : "更新模板"}
        </button>
      </div>
      <p className="template-sync-time">
        {snapshot.syncedAt
          ? `最近更新：${new Date(snapshot.syncedAt).toLocaleString()}`
          : "还未更新模板。点击更新获取可用版本。"}
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!snapshot.templates.length && !busy && (
        <div className="panel-empty">模板库暂为空，已有作品仍可继续编辑。</div>
      )}
      <div className="template-grid">
        {snapshot.templates.map((t) => (
          <button
            className={`template-item ${selected?.id === t.id ? "selected" : ""}`}
            key={t.id}
            onClick={() => {
              setSelected(t);
              setParameters(
                Object.fromEntries(
                  Object.entries(t.parameters).map(([k, v]) => [k, v.default]),
                ),
              );
            }}
          >
            <small>
              {t.category} · v{t.version}
            </small>
            <strong>{t.title}</strong>
            <span>{t.description}</span>
            <span>
              {t.composition.scenes.length} 个镜头 · {t.composition.width} ×{" "}
              {t.composition.height}
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <form
          className="template-form"
          onSubmit={(e) => {
            e.preventDefault();
            void apply();
          }}
        >
          <h2>{selected.title}</h2>
          {Object.entries(selected.parameters).map(([k, p]) => (
            <label key={k}>
              {k}
              <input
                value={parameters[k] ?? p.default}
                maxLength={p.maxLength}
                onChange={(e) =>
                  setParameters({ ...parameters, [k]: e.target.value })
                }
              />
            </label>
          ))}
          <p>
            创建后固定使用 v{selected.version}。后续模板更新不会覆盖你的作品。
          </p>
          <button className="primary" disabled={busy}>
            创建作品并预览
          </button>
        </form>
      )}
    </section>
  );
}
