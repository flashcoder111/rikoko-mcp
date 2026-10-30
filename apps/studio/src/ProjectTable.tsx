import React, { useEffect, useRef, useState } from "react";
import { FileAudio, FileText, Play, RefreshCw } from "lucide-react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import { MediaPreview } from "./Dashboard";
import {
  jobProjectId,
  loadDashboard,
  type DashboardData,
} from "./dashboard-data";

const statusLabels: Record<string, string> = {
  queued: "Queued",
  running: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  blocked_external: "Setup required",
  submission_unknown: "Needs review",
};
const taskLabels: Record<string, string> = {
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
function requestText(job: Entity) {
  const input = job.input ?? {};
  const text = [input.prompt, input.text, input.production?.brief].find(
    (value) => typeof value === "string" && value.trim(),
  );
  return text?.trim() ?? taskLabels[input.kind] ?? "Media task";
}
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}
function credits(job: Entity) {
  return job.billingSource === "credits" &&
    ["settled", "confirmed"].includes(job.billingStatus) &&
    typeof job.chargedCredits === "number" &&
    Number.isFinite(job.chargedCredits) &&
    job.chargedCredits >= 0
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(
        job.chargedCredits,
      )
    : "—";
}

export default function ProjectTable({
  connected,
  projectId,
  onProject,
  onConnect,
}: {
  connected: boolean;
  projectId?: string;
  onProject: (id?: string) => void;
  onConnect: () => void;
}) {
  const [data, setData] = useState<DashboardData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<string>();
  const [preview, setPreview] = useState<Entity>();
  const [limit, setLimit] = useState(30);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    setData(undefined);
    setError("");
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
        }
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : "Could not load the workspace",
          );
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    refreshRef.current = () => void refresh();
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
      refreshRef.current = () => {};
    };
  }, [connected]);
  useEffect(() => {
    setLimit(30);
    setExpanded(undefined);
  }, [projectId, query, status]);
  const projects = data?.projects ?? [];
  const search = query.trim().toLocaleLowerCase();
  const jobs = (data?.jobs ?? []).filter((job) => {
    const id = jobProjectId(job, data?.revisions ?? []);
    const project = projects.find((item) => item.id === id);
    return (
      (!projectId || id === projectId) &&
      (status === "all" || job.status === status) &&
      (!search ||
        [requestText(job), job.input?.model, project?.title].some((value) =>
          String(value ?? "")
            .toLocaleLowerCase()
            .includes(search),
        ))
    );
  });
  return (
    <main className="project-page" aria-label="Projects">
      <div className="project-page-title">
        <div>
          <h1>Projects</h1>
        </div>
        <button
          className="project-refresh"
          disabled={!connected || loading}
          onClick={() => refreshRef.current()}
          aria-label="Refresh projects"
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      {!connected && (
        <div className="project-message">
          Connect your workspace to view projects.{" "}
          <button onClick={onConnect}>Connect workspace</button>
        </div>
      )}
      {error && (
        <div className="project-message" role="alert">
          {error}
          {data && " · Showing the last successfully loaded records."}{" "}
          <button onClick={() => refreshRef.current()}>Retry</button>
        </div>
      )}
      <div className="project-toolbar">
        <label>
          <span className="sr-only">Search requests, models, or projects</span>
          <input
            type="search"
            placeholder="Search requests, models, or projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filter projects</span>
          <select
            aria-label="Filter projects"
            value={projectId ?? ""}
            onChange={(e) => onProject(e.target.value || undefined)}
          >
            <option value="">All projects</option>
            {projectId && !projects.some((p) => p.id === projectId) && (
              <option value={projectId}>Current project</option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title ?? "Untitled project"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter status</span>
          <select
            aria-label="Filter status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="project-table-scroll">
        <table className="project-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Model</th>
              <th>Status</th>
              <th>Credits</th>
              <th>Created</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.slice(0, limit).map((job) => {
              const media = (job.outputs ?? [])
                .map((id: string) =>
                  data?.assets.find(
                    (asset) =>
                      asset.id === id &&
                      ["video", "image", "audio"].includes(asset.kind),
                  ),
                )
                .filter(Boolean) as Entity[];
              const primary = media[0];
              const project = projects.find(
                (p) => p.id === jobProjectId(job, data?.revisions ?? []),
              );
              const isExpanded = expanded === job.id;
              return (
                <React.Fragment key={job.id}>
                  <tr>
                    <td>
                      <div className="project-request">
                        <button
                          className="project-thumb"
                          onClick={() =>
                            primary
                              ? setPreview(primary)
                              : setExpanded(isExpanded ? undefined : job.id)
                          }
                          aria-label={
                            primary ? "Preview output" : "View task details"
                          }
                        >
                          {primary?.kind === "image" ? (
                            <img
                              src={`/api/assets/${encodeURIComponent(primary.id)}/file`}
                              alt=""
                              loading="lazy"
                            />
                          ) : primary?.kind === "video" ? (
                            <>
                              <video
                                src={`/api/assets/${encodeURIComponent(primary.id)}/file`}
                                muted
                                playsInline
                                preload="metadata"
                              />
                              <span className="project-play">
                                <Play size={15} fill="currentColor" />
                              </span>
                            </>
                          ) : primary?.kind === "audio" ? (
                            <FileAudio size={19} />
                          ) : (
                            <FileText size={19} />
                          )}
                        </button>
                        <button
                          className="project-request-text"
                          aria-expanded={isExpanded}
                          onClick={() =>
                            setExpanded(isExpanded ? undefined : job.id)
                          }
                        >
                          <span>{requestText(job)}</span>
                          {project && (
                            <small>{project.title ?? "Untitled project"}</small>
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="project-model">{job.input?.model ?? "—"}</td>
                    <td>
                      <span className={`project-status status-${job.status}`}>
                        {statusLabels[job.status] ?? job.status}
                      </span>
                    </td>
                    <td className="project-number">{credits(job)}</td>
                    <td className="project-time">
                      {formatTime(job.createdAt)}
                    </td>
                    <td>
                      {primary && (
                        <a
                          className="project-download"
                          href={`/api/assets/${encodeURIComponent(primary.id)}/file`}
                          download={primary.name ?? `rikoko-${primary.id}`}
                        >
                          Download
                        </a>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="project-detail">
                      <td colSpan={6}>
                        <strong>Request details</strong>
                        <p>{requestText(job)}</p>
                        {job.error?.message && (
                          <p role="alert">{job.error.message}</p>
                        )}
                        {media.length > 1 && (
                          <div className="project-extra-outputs">
                            {media.slice(1).map((asset, index) => (
                              <button
                                key={asset.id}
                                onClick={() => setPreview(asset)}
                              >
                                View output {index + 2}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {!jobs.length && (
          <div className="project-empty">
            {loading && !data
              ? "Loading projects…"
              : !connected
                ? "Connect to view project activity"
                : error && !data
                  ? "Could not load projects. Please try again."
                  : "No matching tasks."}
          </div>
        )}
      </div>
      {jobs.length > limit && (
        <button
          className="project-more"
          onClick={() => setLimit((n) => n + 30)}
        >
          Show more
        </button>
      )}
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
