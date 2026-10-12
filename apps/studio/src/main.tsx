import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Entity } from "../../../packages/contracts/src/index.js";
import type {
  Action,
  Commit,
  Edit,
  Proposal,
} from "../../../packages/core/src/workspace-contracts.js";
import { api, ApiError, type Snapshot, type Capabilities } from "./api";
import Chat, { type ChatProps } from "./Chat";
import Editor from "./Editor";
import LegacyApp from "./legacy";
import Templates from "./Templates";
import Plans from "./Plans";
import "./style.css";
import "./workspace.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./replica.css";
import "./models.css";

type Mode = "chat" | "studio" | "tools" | "templates" | "plans";
type Route = { mode: Mode; projectId?: string; revisionId?: string };
function readRoute(): Route {
  const params = new URLSearchParams(location.search);
  return {
    mode:
      location.pathname === "/workspace"
        ? "studio"
        : location.pathname === "/templates"
          ? "templates"
          : location.pathname === "/plans"
            ? "plans"
            : location.pathname === "/tools"
              ? "tools"
              : "chat",
    projectId: params.get("project") ?? undefined,
    revisionId: params.get("revision") ?? undefined,
  };
}
function App() {
  const [route, setRoute] = useState(readRoute),
    [connected, setConnected] = useState(false),
    [checking, setChecking] = useState(true);
  const [showConnect, setShowConnect] = useState(false),
    [keyDraft, setKeyDraft] = useState(""),
    [showProjects, setShowProjects] = useState(false),
    [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [projects, setProjects] = useState<Entity[]>([]),
    [assets, setAssets] = useState<Entity[]>([]),
    [snapshot, setSnapshot] = useState<Snapshot>(),
    [modelConnected, setModelConnected] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [draft, setDraft] = useState(""),
    [submitted, setSubmitted] = useState(""),
    [proposal, setProposal] = useState<Proposal>(),
    [attachments, setAttachments] = useState<Entity[]>([]),
    [selectedSceneId, setSelectedSceneId] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const routeRef = useRef(route);
  routeRef.current = route;
  const commitAttempt = useRef<{ fingerprint: string; input: Commit } | null>(
    null,
  );
  const processing = useRef(false);
  const authEpoch = useRef(0);
  const renderAttempt = useRef<{
    revisionId: string;
    idempotencyKey: string;
  } | null>(null);
  const proposalAttempt = useRef("");
  function navigate(next: Route, replace = false) {
    const params = new URLSearchParams({
      ...(next.projectId ? { project: next.projectId } : {}),
      ...(next.revisionId ? { revision: next.revisionId } : {}),
    });
    history[replace ? "replaceState" : "pushState"](
      {},
      "",
      `${next.mode === "studio" ? "/workspace" : next.mode === "templates" ? "/templates" : next.mode === "plans" ? "/plans" : next.mode === "tools" ? "/tools" : "/"}${params.size ? `?${params}` : ""}`,
    );
    setRoute(next);
    setShowProjects(false);
  }
  useEffect(() => {
    const handler = () => setRoute(readRoute());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  const loadLibrary = useCallback(async () => {
    const epoch = authEpoch.current;
    const [p, a, cap] = await Promise.all([
      api<Entity[]>("records_list", { type: "project" }),
      api<Entity[]>("records_list", { type: "asset" }),
      api<Capabilities>("capabilities"),
    ]);
    if (authEpoch.current !== epoch) return;
    setProjects(p);
    setAssets(a);
    setCapabilities(cap);
    setModelConnected(
      cap.workspace?.conversationPlanner === "configured-model",
    );
  }, []);
  const refreshProject = useCallback(async () => {
    const epoch = authEpoch.current;
    const target = routeRef.current;
    if (!target.projectId) return;
    const state = await api<Snapshot>("workspace_snapshot", {
      projectId: target.projectId,
      revisionId: target.revisionId,
    });
    if (
      authEpoch.current !== epoch ||
      routeRef.current.projectId !== target.projectId ||
      routeRef.current.revisionId !== target.revisionId
    )
      return;
    setSnapshot(state);
    setSelectedSceneId((current) =>
      (routeRef.current.mode === "studio" && !!current) ||
      state.revision?.composition.scenes.some((s) => s.id === current)
        ? current
        : (state.revision?.composition.scenes[0]?.id ?? ""),
    );
  }, []);
  useEffect(() => {
    fetch("/auth/session")
      .then(async (r) => {
        if (r.ok) setConnected((await r.json()).connected);
      })
      .catch(() => setError("无法连接本地服务。"))
      .finally(() => setChecking(false));
    const expired = () => {
      authEpoch.current++;
      setConnected(false);
      setShowConnect(true);
      setSnapshot(undefined);
      setProjects([]);
      setAssets([]);
      setCapabilities(undefined);
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (connected) void loadLibrary().catch((e) => setError(e.message));
  }, [connected, loadLibrary]);
  useEffect(() => {
    setSnapshot(undefined);
    setProposal(undefined);
    setSubmitted("");
    setAttachments([]);
    commitAttempt.current = null;
  }, [route.projectId]);
  useEffect(() => {
    if (!connected || !route.projectId) return;
    let active = true,
      loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        await refreshProject();
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "读取作品失败");
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1800);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [connected, route.projectId, route.revisionId, refreshProject]);
  const outputSignature =
    snapshot?.jobs.flatMap((j) => j.outputs ?? []).join(",") ?? "";
  useEffect(() => {
    if (connected && outputSignature)
      void loadLibrary().catch((e) => setError(e.message));
  }, [connected, outputSignature, loadLibrary]);
  async function run(label: string, action: () => Promise<void>) {
    if (processing.current) return;
    processing.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      processing.current = false;
      setBusy("");
    }
  }
  async function connect() {
    await run("连接工作空间…", async () => {
      const response = await fetch("/auth/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${keyDraft.trim()}` },
      });
      if (!response.ok)
        throw Error((await response.json()).error?.message ?? "连接失败");
      authEpoch.current++;
      setKeyDraft("");
      setConnected(true);
      setShowConnect(false);
    });
  }
  async function commit(
    action: Action,
    message: string,
    baseRevisionId = snapshot?.revision?.id,
  ) {
    const body = {
      action,
      message,
      origin:
        routeRef.current.mode === "studio"
          ? ("studio" as const)
          : ("chat" as const),
      ...(action.type === "create"
        ? {}
        : { projectId: snapshot?.project.id, baseRevisionId }),
    };
    const fingerprint = JSON.stringify(body);
    if (commitAttempt.current?.fingerprint !== fingerprint)
      commitAttempt.current = {
        fingerprint,
        input: { ...body, idempotencyKey: crypto.randomUUID() },
      };
    const result = await api<{
      projectId: string;
      revisionId: string;
      message: string;
    }>("workspace_commit", commitAttempt.current.input);
    commitAttempt.current = null;
    setProposal(undefined);
    setSubmitted("");
    setDraft("");
    setAttachments([]);
    setNotice(result.message);
    navigate({
      mode: routeRef.current.mode,
      projectId: result.projectId,
      revisionId: result.revisionId,
    });
    await loadLibrary();
  }
  function send() {
    if (!connected) {
      setShowConnect(true);
      return;
    }
    if (route.projectId && !snapshot) {
      setError("作品尚未加载，请稍候。");
      return;
    }
    const message = draft.trim();
    if (!message) return;
    void run("理解创作要求…", async () => {
      setSubmitted(message);
      setProposal(undefined);
      const result = await api<Proposal>("workspace_plan", {
        message,
        ...(snapshot
          ? {
              projectId: snapshot.project.id,
              revisionId: snapshot.revision?.id,
              ...(route.mode === "studio" && selectedSceneId
                ? { selectedSceneId }
                : {}),
            }
          : {}),
        assetIds: attachments.map((a) => a.id),
      });
      proposalAttempt.current = message;
      setProposal(result);
    });
  }
  function requestUpload(files: FileList) {
    if (!connected) {
      setShowConnect(true);
      return;
    }
    const selected = Array.from(files);
    if (selected.length + attachments.length > 14) {
      setError("一次最多附加 14 份素材。");
      return;
    }
    if (selected.some((f) => f.size > 100 * 1024 * 1024)) {
      setError("单个文件不能超过 100 MB。");
      return;
    }
    setUploadFiles(selected);
  }
  async function upload() {
    const files = uploadFiles;
    setUploadFiles([]);
    await run("正在上传素材…", async () => {
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        const intent = await api<{ uploadUrl: string }>("upload_create", {
          name: file.name,
          bytes: file.size,
          sha256: hash,
          source: "conversation-upload",
          license: "user-authorized",
          rightsConfirmed: true,
        });
        const response = await fetch(intent.uploadUrl, {
          method: "PUT",
          body: buffer,
        });
        const body = await response.json();
        if (!response.ok) throw Error(body.error?.message ?? "上传失败");
        setAttachments((previous) => [...previous, body.result]);
      }
      await loadLibrary();
      setNotice(`已添加 ${files.length} 份素材，可以在对话或工作台使用。`);
    });
  }
  async function retryRender(revisionId: string) {
    await run("重新提交合成…", async () => {
      const revision = snapshot?.revisions.find((r) => r.id === revisionId);
      if (!revision) return;
      const input = {
        kind: "render",
        revisionId,
        composition: revision.composition,
      };
      const quote = await api<{ id: string }>("quote_create", { input });
      if (renderAttempt.current?.revisionId !== revisionId)
        renderAttempt.current = {
          revisionId,
          idempotencyKey: `manual-render:${crypto.randomUUID()}`,
        };
      await api("job_submit", {
        quoteId: quote.id,
        input,
        idempotencyKey: renderAttempt.current.idempotencyKey,
      });
      renderAttempt.current = null;
      await refreshProject();
    });
  }
  const chatProps: ChatProps = {
    snapshot,
    draft,
    setDraft,
    proposal,
    submitted,
    attachments,
    busy,
    modelConnected,
    capabilities,
    onPlans: () => navigate({ ...route, mode: "plans" }),
    removeAttachment: (id) =>
      setAttachments((previous) => previous.filter((a) => a.id !== id)),
    onSend: send,
    onGeneratedAsset: (asset, openStudio) =>
      run("创建可编辑作品…", async () => {
        await commit(
          {
            type: "create",
            composition: {
              schemaVersion: 1,
              title: asset.name ?? "新生成的创作素材",
              width: Math.min(1920, asset.metadata?.width ?? 768),
              height: Math.min(1920, asset.metadata?.height ?? 432),
              fps: 24,
              language: "zh",
              scenes: [
                {
                  id: crypto.randomUUID(),
                  ...(asset.kind === "audio"
                    ? { audioAssetId: asset.id }
                    : { assetId: asset.id }),
                  sourceStartMs: 0,
                  durationMs: Math.max(
                    1000,
                    Math.min(600000, asset.metadata?.durationMs ?? 5000),
                  ),
                  color: "#121214",
                  text: "",
                  fit: "contain",
                  volume: 1,
                },
              ],
              events: [],
              captionStyle: {
                fontSize: 28,
                color: "#ffffff",
                background: "#151a22",
              },
            },
          },
          "使用生成素材开始剪辑",
        );
        if (openStudio)
          setRoute((current) => {
            const next = { ...current, mode: "studio" as const };
            history.replaceState(
              {},
              "",
              location.href.replace(location.pathname, "/workspace"),
            );
            return next;
          });
      }),
    onUpload: requestUpload,
    onApply: () =>
      proposal?.action &&
      void run("保存并合成预览…", () =>
        commit(
          proposal.action!,
          proposalAttempt.current,
          proposal.baseRevisionId,
        ),
      ),
    onDismiss: () => {
      setProposal(undefined);
      setSubmitted("");
    },
    onStudio: () => navigate({ ...route, mode: "studio" }),
    onCancel: (id) =>
      void run("正在取消任务…", async () => {
        await api("job_cancel", { jobId: id });
        await refreshProject();
      }),
    onRetry: (id) => void retryRender(id),
  };
  const behind =
    snapshot?.revision && snapshot.revision.id !== snapshot.headRevisionId;
  if (location.pathname === "/preview") return <LegacyApp />;
  return (
    <div className={`dual-app mode-${route.mode}`}>
      <header className="dual-header">
        <a
          className="dual-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate({ mode: "chat" });
          }}
        >
          Hypit<span>Studio</span>
        </a>
        <button
          className="project-menu-button"
          onClick={() => setShowProjects(!showProjects)}
          aria-expanded={showProjects}
        >
          作品
        </button>
        <nav className="mode-switch" aria-label="创作模式">
          <button
            aria-current={route.mode === "chat" ? "page" : undefined}
            onClick={() => navigate({ ...route, mode: "chat" })}
          >
            对话
          </button>
          <button
            aria-current={route.mode === "studio" ? "page" : undefined}
            onClick={() => navigate({ ...route, mode: "studio" })}
          >
            工作台
          </button>
        </nav>
        <span className="workspace-title">
          {snapshot?.revision?.composition.title ?? "New creation"}
        </span>
        <div className="header-account">
          {connected ? (
            <>
              <span className="connected-label">已连接</span>
              <button
                className="quiet"
                onClick={() =>
                  void run("断开连接…", async () => {
                    const response = await fetch("/auth/session", {
                      method: "DELETE",
                    });
                    if (!response.ok) throw Error("断开连接失败，请重试。");
                    authEpoch.current++;
                    setConnected(false);
                    setSnapshot(undefined);
                    setProjects([]);
                    setAssets([]);
                    setCapabilities(undefined);
                    setAttachments([]);
                    setProposal(undefined);
                  })
                }
              >
                断开
              </button>
            </>
          ) : (
            <button disabled={checking} onClick={() => setShowConnect(true)}>
              {checking ? "连接中…" : "连接工作空间"}
            </button>
          )}
        </div>
      </header>
      <div className={`dual-body ${showProjects ? "projects-open" : ""}`}>
        {route.mode !== "studio" && (
          <aside className="project-rail">
            <button
              className="new-project"
              disabled={!!busy}
              onClick={() => {
                navigate({ mode: "chat" });
                setAttachments([]);
                setNotice("");
                setError("");
                setDraft("");
                setProposal(undefined);
                setSubmitted("");
              }}
            >
              新建作品
            </button>
            <button
              disabled={!connected}
              onClick={() => navigate({ mode: "templates" })}
            >
              模板库
            </button>
            <button
              className={route.mode === "plans" ? "selected" : ""}
              onClick={() => navigate({ ...route, mode: "plans" })}
            >
              官方综合套餐
            </button>
            <span className="rail-heading">最近作品</span>
            <div className="project-items">
              {projects.map((project) => (
                <button
                  key={project.id}
                  disabled={!!busy}
                  className={route.projectId === project.id ? "selected" : ""}
                  onClick={() =>
                    navigate({ mode: "chat", projectId: project.id })
                  }
                >
                  <span>{project.title}</span>
                  <small>
                    {new Date(
                      project.updatedAt ?? project.createdAt,
                    ).toLocaleDateString()}
                  </small>
                </button>
              ))}
              {!projects.length && <p>你的创作和版本会保存在这里。</p>}
            </div>
            <button
              className="tools-link"
              disabled={!connected}
              onClick={() => navigate({ ...route, mode: "tools" })}
            >
              素材与用量工具
            </button>
            <p className="rail-footer">一份作品，两种创作方式。</p>
          </aside>
        )}
        {route.mode === "studio" && showProjects && (
          <div className="studio-project-menu">
            {projects.map((p) => (
              <button
                key={p.id}
                disabled={!!busy}
                onClick={() => navigate({ mode: "studio", projectId: p.id })}
              >
                {p.title}
              </button>
            ))}
            <button onClick={() => navigate({ mode: "chat" })}>新建作品</button>
          </div>
        )}
        <div className="dual-content">
          {(error || notice || busy || behind) && (
            <div className="feedback-bar">
              {error && (
                <div className="error-message" role="alert">
                  <span>{error}</span>
                  <button onClick={() => setError("")}>关闭</button>
                </div>
              )}
              {busy && <div role="status">{busy}</div>}
              {notice && !busy && (
                <div role="status">
                  {notice}
                  <button onClick={() => setNotice("")}>关闭</button>
                </div>
              )}
              {behind && (
                <div className="version-warning">
                  当前显示历史版本。
                  <button
                    disabled={!!busy}
                    onClick={() => {
                      setProposal(undefined);
                      navigate({
                        mode: route.mode,
                        projectId: route.projectId,
                      });
                    }}
                  >
                    加载最新版本
                  </button>
                </div>
              )}
            </div>
          )}
          {route.mode === "chat" && (
            <Chat key={snapshot?.project.id ?? "new"} {...chatProps} />
          )}
          {route.mode === "plans" && (
            <Plans
              connected={connected}
              onConnect={() => setShowConnect(true)}
            />
          )}
          {route.mode === "templates" &&
            (connected ? (
              <Templates
                onOpen={(projectId) => {
                  void loadLibrary();
                  navigate({ mode: "studio", projectId });
                }}
              />
            ) : (
              <div className="panel-empty">
                <p>连接工作空间后使用模板库。</p>
                <button onClick={() => setShowConnect(true)}>
                  连接工作空间
                </button>
              </div>
            ))}
          {route.mode === "studio" && (
            <Editor
              snapshot={snapshot}
              assets={assets}
              selectedSceneId={selectedSceneId}
              selectScene={setSelectedSceneId}
              busy={busy}
              chat={chatProps}
              onEdit={(edits: Edit[], message: string) =>
                void run("保存并合成预览…", () =>
                  commit({ type: "edit", edits }, message),
                )
              }
              onRestore={(id) =>
                void run("恢复历史版本…", () =>
                  commit(
                    { type: "restore", revisionId: id },
                    "从历史版本恢复作品",
                    snapshot?.headRevisionId ?? undefined,
                  ),
                )
              }
              onViewRevision={(id) => navigate({ ...route, revisionId: id })}
            />
          )}
          {route.mode === "tools" &&
            (connected ? (
              <LegacyApp />
            ) : (
              <div className="panel-empty">
                <p>连接工作空间后使用素材、字幕、配音与用量工具。</p>
                <button onClick={() => setShowConnect(true)}>
                  连接工作空间
                </button>
              </div>
            ))}
        </div>
      </div>
      {showConnect && (
        <div className="connection-backdrop">
          <form
            className="connection-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <span className="eyebrow">CONNECT YOUR WORKSPACE</span>
            <h2 id="connect-title">连接一次，继续创作。</h2>
            <p>使用已有工作空间 Key。连接后，对话和工作台共用登录状态。</p>
            <label>
              工作空间 API Key
              <input
                autoFocus
                type="password"
                autoComplete="off"
                required
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
            </label>
            <p className="field-note">
              本地 Key 位于 .data/local-admin.key。浏览器连接有效期为 24 小时。
            </p>
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <div className="action-row">
              <button className="primary" disabled={!!busy}>
                连接并开始
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setShowConnect(false);
                  setKeyDraft("");
                }}
              >
                稍后连接
              </button>
            </div>
          </form>
        </div>
      )}
      {!!uploadFiles.length && (
        <div className="connection-backdrop">
          <section
            className="connection-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
          >
            <h2 id="upload-title">添加 {uploadFiles.length} 份素材</h2>
            <p>
              请确认你有权使用这些图片、视频或音频。文件将保存到当前工作空间。
            </p>
            <ul>
              {uploadFiles.map((f, i) => (
                <li key={i}>{f.name}</li>
              ))}
            </ul>
            <div className="action-row">
              <button className="primary" onClick={() => void upload()}>
                我有使用权限，上传
              </button>
              <button onClick={() => setUploadFiles([])}>取消</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
