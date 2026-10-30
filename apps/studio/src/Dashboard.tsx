import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CircleAlert,
  Clapperboard,
  FolderOpen,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import { useAssetUrl } from "./media";
import {
  activeStatuses,
  attentionStatuses,
  jobProjectId,
  loadDashboard,
  outputAssets,
  type DashboardData,
} from "./dashboard-data";

const labels: Record<string, string> = {
  queued: "Queued",
  running: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  blocked_external: "Setup required",
  submission_unknown: "Needs review",
};
const taskNames: Record<string, string> = {
  generate: "Generate media",
  render: "Render video",
  trim: "Edit video",
  transcribe: "Transcribe",
  captions: "Add captions",
  tts: "Generate voiceover",
  translate: "Translate",
  analyze: "Analyze media",
  reference_analyze: "Analyze reference video",
  import_video: "Import video",
};
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function Badge({ status }: { status: string }) {
  return (
    <span
      className={`dashboard-badge ${activeStatuses.has(status) ? "active" : attentionStatuses.has(status) ? "attention" : status === "completed" ? "done" : ""}`}
    >
      <i />
      {labels[status] ?? status}
    </span>
  );
}
export function MediaPreview({
  asset,
  onClose,
}: {
  asset: Entity;
  onClose: () => void;
}) {
  const { url, error } = useAssetUrl(asset.id);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="dashboard-preview"
      onCancel={onClose}
      aria-labelledby="dashboard-preview-title"
    >
      <header>
        <h2 id="dashboard-preview-title">{asset.name ?? "Task output"}</h2>
        <button autoFocus aria-label="Close preview" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !url ? (
        <p role="status">Loading media…</p>
      ) : asset.kind === "image" ? (
        <img src={url} alt={asset.name ?? "Output image"} />
      ) : asset.kind === "audio" ? (
        <audio controls src={url} />
      ) : (
        <video controls playsInline src={url} />
      )}
      {url && (
        <a
          className="dashboard-download"
          href={url}
          download={asset.name ?? `rikoko-${asset.id}`}
        >
          <ArrowDownToLine size={16} />
          Download file
        </a>
      )}
    </dialog>
  );
}
function MediaCard({
  asset,
  onPreview,
}: {
  asset: Entity;
  onPreview: () => void;
}) {
  // Direct authenticated media URLs allow the browser to request metadata without
  // downloading every full video as a blob for its thumbnail.
  const src = `/api/assets/${encodeURIComponent(asset.id)}/file`;
  return (
    <button className="dashboard-media-card" onClick={onPreview}>
      <div className="dashboard-thumbnail">
        {asset.kind === "image" ? (
          <img src={src} alt="" loading="lazy" />
        ) : asset.kind === "video" ? (
          <video src={src} muted playsInline preload="metadata" />
        ) : (
          <Layers3 size={28} />
        )}
        <span>
          {asset.kind === "video"
            ? "Video"
            : asset.kind === "image"
              ? "Image"
              : "Audio"}
        </span>
      </div>
      <strong>{asset.name ?? "Untitled output"}</strong>
      <small>{date(asset.createdAt)}</small>
    </button>
  );
}

export default function Dashboard({
  connected,
  onConnect,
  view = "overview",
  projectId,
  onProject,
  onLibrary,
  onCredits,
}: {
  connected: boolean;
  onConnect: () => void;
  view?: "overview" | "tasks" | "results";
  projectId?: string;
  onProject: (id?: string) => void;
  onLibrary: () => void;
  onCredits: () => void;
}) {
  const [data, setData] = useState<DashboardData>();
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const [projectLimit, setProjectLimit] = useState(6),
    [taskLimit, setTaskLimit] = useState(8),
    [mediaLimit, setMediaLimit] = useState(4);
  const [preview, setPreview] = useState<Entity>();
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    setData(undefined);
    setError("");
    setUpdated("");
    setPreview(undefined);
    if (!connected) {
      setLoading(false);
      return;
    }
    let active = true,
      pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const next = await loadDashboard();
        if (active) {
          setData(next);
          setError("");
          setUpdated(new Date().toLocaleTimeString("en-US"));
        }
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : "Could not load workspace",
          );
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    refreshRef.current = () => void refresh();
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
      refreshRef.current = () => {};
    };
  }, [connected]);
  const projects = data?.projects ?? [];
  const jobs = (data?.jobs ?? []).filter(
    (job) =>
      !projectId || jobProjectId(job, data?.revisions ?? []) === projectId,
  );
  const outputs = data ? outputAssets({ ...data, jobs }) : [];
  useEffect(() => {
    setTaskLimit(8);
    setMediaLimit(4);
    setFilter("all");
  }, [projectId, view]);
  const filteredProjects = projects.filter((project) =>
    String(project.title ?? "")
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const filteredJobs = jobs.filter(
    (job) =>
      filter === "all" ||
      (filter === "active"
        ? activeStatuses.has(job.status)
        : filter === "attention"
          ? attentionStatuses.has(job.status)
          : job.status === "completed"),
  );
  const available =
    data?.capabilities.providers.filter((model) => model.available).length ?? 0;
  const stats = [
    {
      label: "Projects",
      value: projects.length,
      icon: FolderOpen,
      note: "Your creative projects",
    },
    {
      label: "In progress",
      value: jobs.filter((job) => activeStatuses.has(job.status)).length,
      icon: LoaderCircle,
      note: "Queued and processing tasks",
    },
    {
      label: "Needs attention",
      value: jobs.filter((job) => attentionStatuses.has(job.status)).length,
      icon: CircleAlert,
      note: "Failures, setup issues, and tasks needing review",
    },
    {
      label: "Media outputs",
      value: outputs.length,
      icon: Clapperboard,
      note: "Files created by your tasks",
    },
  ];
  return (
    <main
      className={`dashboard dashboard-view-${view}`}
      aria-label={
        view === "tasks"
          ? "Tasks"
          : view === "results"
            ? "Downloads"
            : "Workspace overview"
      }
    >
      <div className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">RIKOKO / MY WORKSPACE</span>
          <h1>
            {view === "tasks"
              ? "Tasks"
              : view === "results"
                ? "Downloads"
                : "Workspace"}
          </h1>
          <p>Create with your agent and view progress and results here.</p>
        </div>
        <div className="dashboard-actions">
          <button
            disabled={!connected || loading}
            onClick={() => refreshRef.current()}
          >
            <RefreshCw
              size={15}
              className={loading ? "dashboard-spinning" : ""}
            />
            Refresh
          </button>
          {!connected && (
            <button className="primary" onClick={onConnect}>
              Connect workspace
            </button>
          )}
        </div>
      </div>
      {!connected && (
        <div className="dashboard-callout">
          <FolderOpen size={22} />
          <div>
            <strong>Connect to view your projects and tasks</strong>
            <p>
              Create with rikoko MCP in Codex, Claude, or Hermes, then return
              here to see the results.
            </p>
          </div>
        </div>
      )}
      {error && (
        <div className="dashboard-error" role="alert">
          {error}
          {data && " · Showing the last successfully loaded data."}
          <button disabled={loading} onClick={() => refreshRef.current()}>
            Retry
          </button>
        </div>
      )}
      <section
        className="dashboard-stats"
        aria-label="Workspace statistics"
        hidden={view !== "overview"}
      >
        {stats.map(({ label, value, icon: Icon, note }) => (
          <div key={label}>
            <span>
              <Icon size={16} />
              {label}
            </span>
            <strong>{data ? value : "—"}</strong>
            <small>{note}</small>
          </div>
        ))}
      </section>
      {view !== "overview" && (
        <label className="dashboard-project-filter">
          Filter by project
          <select
            aria-label="Filter projects"
            value={projectId ?? ""}
            onChange={(event) => onProject(event.target.value || undefined)}
          >
            <option value="">All projects</option>
            {projectId &&
              !projects.some((project) => project.id === projectId) && (
                <option value={projectId}>Current project</option>
              )}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title ?? "Untitled project"}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="dashboard-columns" hidden={view === "results"}>
        <div className="dashboard-main-column">
          <section className="dashboard-panel" hidden={view !== "overview"}>
            <div className="dashboard-section-heading">
              <div>
                <h2>Recent projects</h2>
                <p>View tasks and results by project.</p>
              </div>
              <label className="dashboard-search">
                <Search size={15} />
                <input
                  aria-label="Search projects"
                  placeholder="Search projects"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setProjectLimit(6);
                  }}
                />
              </label>
            </div>
            <div className="dashboard-project-list">
              {filteredProjects.slice(0, projectLimit).map((project) => {
                const projectJobs = jobs.filter(
                  (job) =>
                    jobProjectId(job, data?.revisions ?? []) === project.id,
                );
                const recent = projectJobs[0];
                return (
                  <button
                    key={project.id}
                    className="dashboard-project"
                    onClick={() => onProject(project.id)}
                  >
                    <span className="dashboard-project-icon">
                      <FolderOpen size={20} />
                    </span>
                    <span className="dashboard-project-title">
                      <strong>{project.title ?? "Untitled project"}</strong>
                      <small>
                        {date(project.updatedAt ?? project.createdAt)} ·{" "}
                        {projectJobs.length} tasks
                      </small>
                    </span>
                    {recent ? (
                      <Badge status={recent.status} />
                    ) : (
                      <span className="dashboard-muted">No tasks yet</span>
                    )}
                    <ArrowUpRight size={16} />
                  </button>
                );
              })}
            </div>
            {!filteredProjects.length && (
              <div className="dashboard-empty">
                {loading && !data
                  ? "Loading projects…"
                  : !connected
                    ? "Connect to see projects"
                    : error && !data
                      ? "Could not load projects. Please try again."
                      : query
                        ? "No matching projects."
                        : "No projects yet. Start your first video with your agent."}
              </div>
            )}
            {filteredProjects.length > projectLimit && (
              <button
                className="dashboard-more"
                onClick={() => setProjectLimit((n) => n + 12)}
              >
                Show more projects
              </button>
            )}
          </section>
          <section className="dashboard-panel">
            <div className="dashboard-section-heading">
              <div>
                <h2>Tasks</h2>
                <p>Local generation, analysis, and rendering history.</p>
              </div>
              <span className="dashboard-muted">{jobs.length} tasks</span>
            </div>
            <div className="dashboard-filters" aria-label="Task status">
              {[
                ["all", "All"],
                ["active", "In progress"],
                ["attention", "Needs attention"],
                ["completed", "Completed"],
              ].map(([id, title]) => (
                <button
                  key={id}
                  aria-pressed={filter === id}
                  onClick={() => {
                    setFilter(id);
                    setTaskLimit(8);
                  }}
                >
                  {title}
                </button>
              ))}
            </div>
            <div className="dashboard-tasks">
              {filteredJobs.slice(0, taskLimit).map((job) => {
                const projectId = jobProjectId(job, data?.revisions ?? []);
                const project = projects.find((p) => p.id === projectId);
                const media = outputs.filter((asset) =>
                  (job.outputs ?? []).includes(asset.id),
                );
                return (
                  <article key={job.id} className="dashboard-task">
                    <div className="dashboard-task-line">
                      <span className="dashboard-task-icon">
                        {job.status === "completed" ? (
                          <Check size={17} />
                        ) : attentionStatuses.has(job.status) ? (
                          <CircleAlert size={17} />
                        ) : (
                          <Layers3 size={17} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {taskNames[job.input?.kind] ?? "Media task"}
                        </strong>
                        <small>
                          {project?.title ?? "Standalone task"}
                          {job.input?.model ? ` · ${job.input.model}` : ""}
                        </small>
                      </div>
                      <Badge status={job.status} />
                    </div>
                    <div className="dashboard-task-meta">
                      <span>{date(job.createdAt)}</span>
                      {project && (
                        <button onClick={() => onProject(project.id)}>
                          View project tasks
                          <ArrowUpRight size={13} />
                        </button>
                      )}
                      {media.map((asset, index) => (
                        <button
                          key={asset.id}
                          onClick={() => setPreview(asset)}
                        >
                          View output{media.length > 1 ? ` ${index + 1}` : ""}
                        </button>
                      ))}
                    </div>
                    {job.error?.message && (
                      <details className="dashboard-task-error">
                        <summary>View error details</summary>
                        <p>{job.error.message}</p>
                      </details>
                    )}
                  </article>
                );
              })}
            </div>
            {!filteredJobs.length && (
              <div className="dashboard-empty">
                {loading && !data
                  ? "Loading tasks…"
                  : error && !data
                    ? "Could not load tasks. Please try again."
                    : "No matching tasks."}
              </div>
            )}
            {filteredJobs.length > taskLimit && (
              <button
                className="dashboard-more"
                onClick={() => setTaskLimit((n) => n + 16)}
              >
                Show more tasks
              </button>
            )}
          </section>
        </div>
        <aside className="dashboard-side-column" hidden={view !== "overview"}>
          <section className="dashboard-panel dashboard-service">
            <span className="dashboard-eyebrow">CONNECTION</span>
            <h2>Workspace status</h2>
            <dl>
              <div>
                <dt>Local service</dt>
                <dd>
                  <i className={connected ? "online" : ""} />
                  {connected ? "Connected" : "Disconnected"}
                </dd>
              </div>
              <div>
                <dt>Model services</dt>
                <dd>{data ? `${available} models available` : "—"}</dd>
              </div>
              <div>
                <dt>Service type</dt>
                <dd>
                  {data
                    ? data.capabilities.generation.mode === "official"
                      ? "Official service"
                      : "Custom service"
                    : "—"}
                </dd>
              </div>
            </dl>
            {data?.capabilities.generation.error && (
              <p className="dashboard-service-error">
                {data.capabilities.generation.error}
              </p>
            )}
            <button disabled={!connected} onClick={onCredits}>
              View credits and usage
              <ArrowUpRight size={15} />
            </button>
          </section>
          <section className="dashboard-agent-note">
            <span className="dashboard-eyebrow">MADE WITH YOUR AGENT</span>
            <h2>Create with your agent</h2>
            <p>
              Describe your video and attach references in your agent. Tasks and
              outputs will be saved in the same workspace.
            </p>
            <div>
              <span>Codex</span>
              <span>Claude</span>
              <span>Hermes</span>
            </div>
          </section>
        </aside>
      </div>
      <section
        className="dashboard-panel dashboard-outputs"
        hidden={view === "tasks"}
      >
        <div className="dashboard-section-heading">
          <div>
            <h2>{view === "results" ? "All outputs" : "Recent outputs"}</h2>
            <p>Preview and download your images, videos, and audio.</p>
          </div>
          <button disabled={!connected} onClick={onLibrary}>
            All media
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="dashboard-media-grid">
          {outputs.slice(0, mediaLimit).map((asset) => (
            <MediaCard
              key={asset.id}
              asset={asset}
              onPreview={() => setPreview(asset)}
            />
          ))}
        </div>
        {!outputs.length && (
          <div className="dashboard-empty">
            {loading && !data
              ? "Loading outputs…"
              : error && !data
                ? "Could not load outputs. Please try again."
                : "Images, videos, and audio created by tasks will appear here."}
          </div>
        )}
        {outputs.length > mediaLimit && (
          <button
            className="dashboard-more"
            onClick={() => setMediaLimit((n) => n + 8)}
          >
            Show more outputs
          </button>
        )}
      </section>
      <footer className="dashboard-footer">
        <span>rikoko MCP · Local workspace</span>
        <span>
          {updated
            ? `Last updated ${updated} · Refreshes every 10 seconds`
            : loading
              ? "Loading workspace…"
              : "Waiting for connection"}
        </span>
      </footer>
      {preview && (
        <MediaPreview
          key={preview.id}
          asset={preview}
          onClose={() => setPreview(undefined)}
        />
      )}
    </main>
  );
}
