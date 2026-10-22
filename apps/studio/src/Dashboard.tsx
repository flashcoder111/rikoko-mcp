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
  queued: "排队中",
  running: "处理中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  blocked_external: "等待配置",
  submission_unknown: "需要核对",
};
const taskNames: Record<string, string> = {
  generate: "生成素材",
  render: "合成视频",
  trim: "剪辑视频",
  transcribe: "生成字幕",
  captions: "处理字幕",
  tts: "生成配音",
  translate: "翻译内容",
  analyze: "分析素材",
  reference_analyze: "分析参考视频",
  import_video: "导入视频",
};
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString("zh-CN", {
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
function MediaPreview({
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
        <h2 id="dashboard-preview-title">{asset.name ?? "任务输出"}</h2>
        <button autoFocus aria-label="关闭预览" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !url ? (
        <p role="status">正在加载媒体…</p>
      ) : asset.kind === "image" ? (
        <img src={url} alt={asset.name ?? "输出图片"} />
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
          下载文件
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
            ? "视频"
            : asset.kind === "image"
              ? "图片"
              : "音频"}
        </span>
      </div>
      <strong>{asset.name ?? "未命名输出"}</strong>
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
          setUpdated(new Date().toLocaleTimeString("zh-CN"));
        }
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "读取工作空间失败");
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
      label: "项目",
      value: projects.length,
      icon: FolderOpen,
      note: "你的创作记录",
    },
    {
      label: "进行中",
      value: jobs.filter((job) => activeStatuses.has(job.status)).length,
      icon: LoaderCircle,
      note: "排队与处理中的任务",
    },
    {
      label: "需要关注",
      value: jobs.filter((job) => attentionStatuses.has(job.status)).length,
      icon: CircleAlert,
      note: "失败、配置或状态待核对",
    },
    {
      label: "媒体输出",
      value: outputs.length,
      icon: Clapperboard,
      note: "任务产出的可查看文件",
    },
  ];
  return (
    <main
      className={`dashboard dashboard-view-${view}`}
      aria-label={
        view === "tasks"
          ? "任务记录"
          : view === "results"
            ? "结果下载"
            : "工作空间概览"
      }
    >
      <div className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">RIKOKO / MY WORKSPACE</span>
          <h1>
            {view === "tasks"
              ? "任务记录"
              : view === "results"
                ? "结果下载"
                : "工作空间"}
          </h1>
          <p>创作交给 Agent，进度和结果在这里查看。</p>
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
            刷新
          </button>
          {!connected && (
            <button className="primary" onClick={onConnect}>
              连接工作空间
            </button>
          )}
        </div>
      </div>
      {!connected && (
        <div className="dashboard-callout">
          <FolderOpen size={22} />
          <div>
            <strong>连接后查看你的项目和任务</strong>
            <p>
              在 Codex、Claude 或 Hermes 中通过 rikoko MCP
              制作，回到这里查看结果。
            </p>
          </div>
        </div>
      )}
      {error && (
        <div className="dashboard-error" role="alert">
          {error}
          {data && " · 正在显示上次成功读取的数据。"}
          <button disabled={loading} onClick={() => refreshRef.current()}>
            重试
          </button>
        </div>
      )}
      <section
        className="dashboard-stats"
        aria-label="工作空间统计"
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
          按项目查看
          <select
            aria-label="筛选项目"
            value={projectId ?? ""}
            onChange={(event) => onProject(event.target.value || undefined)}
          >
            <option value="">全部项目</option>
            {projectId &&
              !projects.some((project) => project.id === projectId) && (
                <option value={projectId}>当前项目</option>
              )}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title ?? "未命名项目"}
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
                <h2>最近项目</h2>
                <p>按项目查看相关任务与结果。</p>
              </div>
              <label className="dashboard-search">
                <Search size={15} />
                <input
                  aria-label="搜索项目"
                  placeholder="搜索项目"
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
                      <strong>{project.title ?? "未命名项目"}</strong>
                      <small>
                        {date(project.updatedAt ?? project.createdAt)} ·{" "}
                        {projectJobs.length} 个任务
                      </small>
                    </span>
                    {recent ? (
                      <Badge status={recent.status} />
                    ) : (
                      <span className="dashboard-muted">尚无任务</span>
                    )}
                    <ArrowUpRight size={16} />
                  </button>
                );
              })}
            </div>
            {!filteredProjects.length && (
              <div className="dashboard-empty">
                {loading && !data
                  ? "正在读取项目…"
                  : !connected
                    ? "连接后显示项目"
                    : error && !data
                      ? "暂时无法读取项目，请重试。"
                      : query
                        ? "没有找到匹配的项目。"
                        : "还没有项目。在 Agent 对话中开始你的第一条视频。"}
              </div>
            )}
            {filteredProjects.length > projectLimit && (
              <button
                className="dashboard-more"
                onClick={() => setProjectLimit((n) => n + 12)}
              >
                查看更多项目
              </button>
            )}
          </section>
          <section className="dashboard-panel">
            <div className="dashboard-section-heading">
              <div>
                <h2>任务记录</h2>
                <p>生成、分析和合成的本地记录。</p>
              </div>
              <span className="dashboard-muted">{jobs.length} 个任务</span>
            </div>
            <div className="dashboard-filters" aria-label="任务状态">
              {[
                ["all", "全部"],
                ["active", "进行中"],
                ["attention", "需要关注"],
                ["completed", "已完成"],
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
                          {taskNames[job.input?.kind] ?? "媒体任务"}
                        </strong>
                        <small>
                          {project?.title ?? "独立任务"}
                          {job.input?.model ? ` · ${job.input.model}` : ""}
                        </small>
                      </div>
                      <Badge status={job.status} />
                    </div>
                    <div className="dashboard-task-meta">
                      <span>{date(job.createdAt)}</span>
                      {project && (
                        <button onClick={() => onProject(project.id)}>
                          查看项目任务
                          <ArrowUpRight size={13} />
                        </button>
                      )}
                      {media.map((asset, index) => (
                        <button
                          key={asset.id}
                          onClick={() => setPreview(asset)}
                        >
                          查看输出{media.length > 1 ? ` ${index + 1}` : ""}
                        </button>
                      ))}
                    </div>
                    {job.error?.message && (
                      <details className="dashboard-task-error">
                        <summary>查看错误详情</summary>
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
                  ? "正在读取任务…"
                  : error && !data
                    ? "暂时无法读取任务，请重试。"
                    : "当前没有此类任务。"}
              </div>
            )}
            {filteredJobs.length > taskLimit && (
              <button
                className="dashboard-more"
                onClick={() => setTaskLimit((n) => n + 16)}
              >
                查看更多任务
              </button>
            )}
          </section>
        </div>
        <aside className="dashboard-side-column" hidden={view !== "overview"}>
          <section className="dashboard-panel dashboard-service">
            <span className="dashboard-eyebrow">CONNECTION</span>
            <h2>工作空间状态</h2>
            <dl>
              <div>
                <dt>本地服务</dt>
                <dd>
                  <i className={connected ? "online" : ""} />
                  {connected ? "已连接" : "未连接"}
                </dd>
              </div>
              <div>
                <dt>模型服务</dt>
                <dd>{data ? `${available} 个可用模型` : "—"}</dd>
              </div>
              <div>
                <dt>调用方式</dt>
                <dd>
                  {data
                    ? data.capabilities.generation.mode === "official"
                      ? "官方服务"
                      : "自定义服务"
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
              查看积分与用量
              <ArrowUpRight size={15} />
            </button>
          </section>
          <section className="dashboard-agent-note">
            <span className="dashboard-eyebrow">MADE WITH YOUR AGENT</span>
            <h2>创作在宿主 Agent 中完成</h2>
            <p>
              在你常用的 Agent
              中描述视频、附上参考素材。任务和输出会保存在同一个工作空间。
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
            <h2>{view === "results" ? "所有输出" : "最近输出"}</h2>
            <p>查看图片、视频和音频，下载需要的结果。</p>
          </div>
          <button disabled={!connected} onClick={onLibrary}>
            全部素材
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
              ? "正在读取输出…"
              : error && !data
                ? "暂时无法读取输出，请重试。"
                : "任务产出图片、视频或音频后，会显示在这里。"}
          </div>
        )}
        {outputs.length > mediaLimit && (
          <button
            className="dashboard-more"
            onClick={() => setMediaLimit((n) => n + 8)}
          >
            查看更多输出
          </button>
        )}
      </section>
      <footer className="dashboard-footer">
        <span>rikoko MCP · 本地工作空间</span>
        <span>
          {updated
            ? `上次读取 ${updated} · 每 10 秒刷新本地记录`
            : loading
              ? "正在读取工作空间…"
              : "等待连接"}
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
