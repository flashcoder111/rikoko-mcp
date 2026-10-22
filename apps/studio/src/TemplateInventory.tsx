import React, { useEffect, useState } from "react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import type { LibraryTemplate } from "../../../packages/templates/src/starters.js";
import type { LibraryPrompt } from "../../../packages/templates/src/library.js";
import { api } from "./api";
import SaveTemplate from "./SaveTemplate";
import "./template-inventory.css";
type Catalog = {
  templates: LibraryTemplate[];
  promptTemplates: LibraryPrompt[];
  configured: boolean;
  syncedAt?: string | null;
};
export default function TemplateInventory({
  connected,
  onConnect,
}: {
  connected: boolean;
  onConnect: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>(),
    [revisions, setRevisions] = useState<Entity[]>([]),
    [revisionId, setRevisionId] = useState(""),
    [query, setQuery] = useState(""),
    [scope, setScope] = useState("all"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (connected) {
      Promise.all([
        api<Catalog>("template_list"),
        api<Entity[]>("records_list", { type: "revision" }),
      ])
        .then(([c, r]) => {
          if (active) {
            setCatalog(c);
            setRevisions(r);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [connected]);
  async function refresh(sync = false) {
    setBusy(true);
    setError("");
    try {
      setCatalog(await api<Catalog>(sync ? "template_sync" : "template_list"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const items = [
    ...(catalog?.templates ?? []),
    ...(catalog?.promptTemplates ?? []),
  ].filter(
    (t) =>
      (scope === "all" ||
        (scope === "personal"
          ? t.sourceKind === "personal"
          : t.sourceKind !== "personal")) &&
      [t.title, t.description, ...(t.searchTerms ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const revision = revisions.find((r) => r.id === revisionId);
  return (
    <main className="dashboard template-inventory">
      <span className="dashboard-eyebrow">RIKOKO / TEMPLATES</span>
      <h1>模板库</h1>
      <p>
        管理官方与个人模板，在 Agent 对话中检索复用。官方更新不会覆盖你的修改。
      </p>
      {!connected ? (
        <div className="dashboard-callout">
          <p>连接工作空间后管理模板。</p>
          <button onClick={onConnect}>连接工作空间</button>
        </div>
      ) : (
        <>
          <div className="dashboard-filters">
            <input
              aria-label="搜索模板"
              placeholder="搜索名称或用途"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="模板来源"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">全部模板</option>
              <option value="personal">我的模板</option>
              <option value="official">官方模板</option>
            </select>
            <button disabled={busy} onClick={() => void refresh()}>
              刷新列表
            </button>
            {catalog?.configured && (
              <button disabled={busy} onClick={() => void refresh(true)}>
                更新官方模板
              </button>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          <section className="dashboard-panel">
            <h2>从作品保存</h2>
            <label>
              选择已保存版本
              <select
                aria-label="选择作品版本"
                value={revisionId}
                onChange={(e) => setRevisionId(e.target.value)}
              >
                <option value="">选择作品版本</option>
                {revisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.composition?.title ?? "作品"} · v{r.version ?? 1}
                  </option>
                ))}
              </select>
            </label>
            {revision && (
              <SaveTemplate
                key={revision.id}
                revisionId={revision.id}
                title={revision.composition.title}
                disabled={busy}
                onSaved={() => void refresh()}
              />
            )}
            {!revisions.length && (
              <p>在 Agent 对话中完成作品后，可在这里保存为个人模板。</p>
            )}
          </section>
          <div className="template-inventory-grid">
            {items.map((t) => (
              <article
                className="dashboard-panel"
                key={`${t.sourceKind}:${t.id}`}
              >
                <small>
                  {t.sourceKind === "personal"
                    ? "我的模板"
                    : t.sourceKind === "cloud"
                      ? "官方云端"
                      : "官方内置"}{" "}
                  · {"kind" in t ? "提示词" : "成片编排"} · v{t.version}
                </small>
                <h2>{t.title}</h2>
                <p>{t.description}</p>
                {t.updateAvailable && (
                  <p className="template-update">
                    来源有 v{t.updateAvailable.version}{" "}
                    更新。你的版本保持不变，可让 Agent 比较后按需调整。
                  </p>
                )}
                <details>
                  <summary>查看内容与复用方式</summary>
                  <p>
                    在 Agent 中说：使用「{t.title}」模板，结合我的新需求制作。
                  </p>
                  {"text" in t ? (
                    <pre>{t.text}</pre>
                  ) : (
                    <ol>
                      {t.composition.scenes.map((s) => (
                        <li key={s.id}>{s.text || "画面镜头"}</li>
                      ))}
                    </ol>
                  )}
                </details>
              </article>
            ))}
          </div>
          {!catalog && !error && <p role="status">正在读取模板…</p>}
          {catalog && !items.length && <p>没有匹配的模板。</p>}
          {catalog?.syncedAt && (
            <p>
              官方目录最近更新：{new Date(catalog.syncedAt).toLocaleString()}
            </p>
          )}
        </>
      )}
    </main>
  );
}
