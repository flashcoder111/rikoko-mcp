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
const builtinEnglish: Record<string, { title: string; description: string }> = {
  "rikoko-starter-product": {
    title: "Product highlights",
    description:
      "Introduce a product, show its benefits, and invite viewers to take action.",
  },
  "rikoko-starter-store": {
    title: "New at your store",
    description:
      "Showcase a new arrival with store photos, featured products, and visit details.",
  },
  "rikoko-starter-tutorial": {
    title: "Three-step tutorial",
    description:
      "Explain a topic in three steps for guides, tips, or product introductions.",
  },
  "rikoko-starter-list": {
    title: "Three-point list",
    description:
      "Present ideas, recommendations, or reminders in a clear list.",
  },
  "rikoko-starter-event": {
    title: "Event invitation",
    description: "Present the theme, highlights, time, and place of an event.",
  },
  "rikoko-starter-brand": {
    title: "Brand introduction",
    description: "Introduce your brand and its value across three scenes.",
  },
  "rikoko-starter-software": {
    title: "Software feature introduction",
    description:
      "Show a use case, demonstrate a feature, and invite viewers to try it.",
  },
  "rikoko-starter-before-after": {
    title: "Before and after",
    description:
      "Show the starting point, the transformation, and what changed.",
  },
  "rikoko-starter-testimonial": {
    title: "Customer testimonial",
    description:
      "Present genuine customer feedback with its context and source.",
  },
};
const displayTemplate = (template: LibraryTemplate | LibraryPrompt) =>
  template.sourceKind === "builtin" && builtinEnglish[template.id]
    ? builtinEnglish[template.id]
    : { title: template.title, description: template.description };
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
      [
        t.title,
        t.description,
        displayTemplate(t).title,
        displayTemplate(t).description,
        ...(t.searchTerms ?? []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const revision = revisions.find((r) => r.id === revisionId);
  return (
    <main className="dashboard template-inventory">
      <span className="dashboard-eyebrow">RIKOKO / TEMPLATES</span>
      <h1>Templates</h1>
      <p>
        Manage official and personal templates for reuse in your agent. Official
        updates do not overwrite your changes.
      </p>
      {!connected ? (
        <div className="dashboard-callout">
          <p>Connect your workspace to manage templates.</p>
          <button onClick={onConnect}>Connect workspace</button>
        </div>
      ) : (
        <>
          <div className="dashboard-filters">
            <input
              aria-label="Search templates"
              placeholder="Search names or descriptions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Template source"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">All templates</option>
              <option value="personal">My templates</option>
              <option value="official">Official templates</option>
            </select>
            <button disabled={busy} onClick={() => void refresh()}>
              Refresh list
            </button>
            {catalog?.configured && (
              <button disabled={busy} onClick={() => void refresh(true)}>
                Update official templates
              </button>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          <section className="dashboard-panel">
            <h2>Save from a project</h2>
            <label>
              Select a saved version
              <select
                aria-label="Select a project version"
                value={revisionId}
                onChange={(e) => setRevisionId(e.target.value)}
              >
                <option value="">Select a project version</option>
                {revisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.composition?.title ?? "Project"} · v{r.version ?? 1}
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
              <p>
                After creating a project with your agent, save it here as a
                personal template.
              </p>
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
                    ? "My templates"
                    : t.sourceKind === "cloud"
                      ? "Official cloud"
                      : "Built-in"}{" "}
                  · {"kind" in t ? "Prompt" : "Composition"} · v{t.version}
                </small>
                <h2>{displayTemplate(t).title}</h2>
                <p>{displayTemplate(t).description}</p>
                {t.updateAvailable && (
                  <p className="template-update">
                    Source version v{t.updateAvailable.version} is available.
                    Your version remains unchanged; ask your agent to compare
                    them.
                  </p>
                )}
                <details>
                  <summary>View content and reuse instructions</summary>
                  <p>
                    Ask your agent: Use template “{t.id}” for my new project.
                  </p>
                  {"text" in t ? (
                    <pre>{t.text}</pre>
                  ) : (
                    <ol>
                      {t.composition.scenes.map((s) => (
                        <li key={s.id}>{s.text || "Scene"}</li>
                      ))}
                    </ol>
                  )}
                </details>
              </article>
            ))}
          </div>
          {!catalog && !error && <p role="status">Loading templates…</p>}
          {catalog && !items.length && <p>No matching templates.</p>}
          {catalog?.syncedAt && (
            <p>
              Official catalog last updated:{" "}
              {new Date(catalog.syncedAt).toLocaleString()}
            </p>
          )}
        </>
      )}
    </main>
  );
}
