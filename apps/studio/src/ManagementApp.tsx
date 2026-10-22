import TemplateInventory from "./TemplateInventory";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Coins,
  Download,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
} from "lucide-react";
import type { Entity } from "../../../packages/contracts/src/index.js";
import { api } from "./api";
import Dashboard from "./Dashboard";
import AssetLibrary from "./AssetLibrary";
import Credits from "./Credits";
import UpdateNotice from "./UpdateNotice";

export type ManagementView =
  "overview" | "tasks" | "library" | "results" | "credits" | "templates";
export function managementRoute(url = new URL(location.href)): {
  view: ManagementView;
  projectId?: string;
} {
  const projectId = url.searchParams.get("project") || undefined;
  const view =
    url.pathname === "/templates"
      ? "templates"
      : url.pathname === "/library"
        ? "library"
        : ["/credits", "/plans", "/tools"].includes(url.pathname)
          ? "credits"
          : url.pathname === "/results"
            ? "results"
            : url.pathname === "/tasks" || projectId
              ? "tasks"
              : "overview";
  return { view, projectId };
}
const links = [
  { id: "overview", label: "概览", path: "/", icon: LayoutDashboard },
  { id: "tasks", label: "任务记录", path: "/tasks", icon: ListChecks },
  { id: "library", label: "素材库", path: "/library", icon: FolderOpen },
  { id: "templates", label: "模板库", path: "/templates", icon: FolderOpen },
  { id: "results", label: "结果下载", path: "/results", icon: Download },
  { id: "credits", label: "积分与用量", path: "/credits", icon: Coins },
] as const;

export default function ManagementApp() {
  const [route, setRoute] = useState(managementRoute),
    [menu, setMenu] = useState(false);
  const [connected, setConnected] = useState(false),
    [checking, setChecking] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false),
    [keyDraft, setKeyDraft] = useState("");
  const [assets, setAssets] = useState<Entity[]>([]),
    [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const epoch = useRef(0),
    pending = useRef(false);
  const clear = useCallback(() => {
    epoch.current++;
    setConnected(false);
    setAssets([]);
    setFiles([]);
    setKeyDraft("");
    setNotice("");
  }, []);
  useEffect(() => {
    let active = true;
    const expired = () => {
      clear();
      setConnectOpen(true);
    };
    const pop = () => {
      setRoute(managementRoute());
      setMenu(false);
    };
    window.addEventListener("session-expired", expired);
    window.addEventListener("popstate", pop);
    const initialEpoch = epoch.current;
    void fetch("/auth/session")
      .then(async (response) => {
        if (!response.ok) throw Error("无法读取连接状态，请重新连接。");
        const session = await response.json();
        if (active && initialEpoch === epoch.current)
          setConnected(session.connected === true);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
      epoch.current++;
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("popstate", pop);
    };
  }, [clear]);
  function navigate(view: ManagementView, projectId?: string) {
    const path = links.find((link) => link.id === view)!.path;
    history.pushState(
      {},
      "",
      `${path}${projectId ? `?${new URLSearchParams({ project: projectId })}` : ""}`,
    );
    setRoute({ view, projectId });
    setMenu(false);
    setError("");
    setNotice("");
  }
  const loadAssets = useCallback(async () => {
    const requestEpoch = epoch.current;
    const records = await api<Entity[]>("records_list", { type: "asset" });
    if (requestEpoch === epoch.current) setAssets(records);
  }, []);
  useEffect(() => {
    if (connected && route.view === "library")
      void loadAssets().catch((err) => setError(err.message));
  }, [connected, route.view, loadAssets]);
  async function run(label: string, action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请重试。");
    } finally {
      pending.current = false;
      setBusy("");
    }
  }
  async function connect() {
    await run("正在连接…", async () => {
      const response = await fetch("/auth/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${keyDraft.trim()}` },
      });
      if (!response.ok)
        throw Error((await response.json()).error?.message ?? "连接失败");
      epoch.current++;
      setKeyDraft("");
      setConnected(true);
      setConnectOpen(false);
    });
  }
  function requestUpload(selected: FileList) {
    if (!connected) {
      setConnectOpen(true);
      return;
    }
    if (
      selected.length > 14 ||
      Array.from(selected).some((file) => file.size > 100 * 1024 * 1024)
    ) {
      setError("一次最多上传 14 份素材，单个文件不能超过 100 MB。");
      return;
    }
    setFiles(Array.from(selected));
  }
  async function upload() {
    const selected = files;
    setFiles([]);
    await run("正在上传素材…", async () => {
      const requestEpoch = epoch.current;
      try {
        for (const file of selected) {
          if (requestEpoch !== epoch.current) return;
          const buffer = await file.arrayBuffer();
          const hash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");
          if (requestEpoch !== epoch.current) return;
          const intent = await api<{ uploadUrl: string }>("upload_create", {
            name: file.name,
            bytes: file.size,
            sha256: hash,
            source: "library-upload",
            license: "user-authorized",
            rightsConfirmed: true,
          });
          if (requestEpoch !== epoch.current) return;
          const response = await fetch(intent.uploadUrl, {
            method: "PUT",
            body: buffer,
          });
          if (response.status === 401)
            window.dispatchEvent(new Event("session-expired"));
          if (!response.ok)
            throw Error((await response.json()).error?.message ?? "上传失败");
        }
        if (requestEpoch === epoch.current)
          setNotice(`已上传 ${selected.length} 份素材。`);
      } finally {
        if (requestEpoch === epoch.current) await loadAssets();
      }
    });
  }
  return (
    <div className="dual-app management-app">
      <header className="management-header">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("overview");
          }}
          className="management-brand"
        >
          <span>R</span>rikoko
        </a>
        <span className="management-header-label">本地工作空间</span>
        <button
          className="management-menu"
          aria-label="切换导航"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Menu size={20} />
        </button>
        <div className="management-connection">
          <span>{checking ? "连接中…" : connected ? "已连接" : "未连接"}</span>
          {!connected && (
            <button
              disabled={checking || !!busy}
              onClick={() => setConnectOpen(true)}
            >
              连接工作空间
            </button>
          )}
        </div>
      </header>
      <div className="management-body">
        <aside className={`management-sidebar ${menu ? "is-open" : ""}`}>
          <span className="dashboard-eyebrow">MY WORKSPACE</span>
          <nav aria-label="工作空间导航">
            {links.map(({ id, path, label, icon: Icon }) => (
              <a
                key={id}
                href={path}
                aria-current={route.view === id ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(id);
                }}
              >
                <Icon size={18} />
                {label}
              </a>
            ))}
          </nav>
          <div className="management-sidebar-bottom">
            <p>
              在宿主 Agent 中创作，
              <br />
              在这里管理素材和结果。
            </p>
            {connected && (
              <button
                disabled={!!busy}
                onClick={() =>
                  void run("正在断开…", async () => {
                    const response = await fetch("/auth/session", {
                      method: "DELETE",
                    });
                    if (!response.ok) throw Error("断开失败，请重试。");
                    clear();
                  })
                }
              >
                <LogOut size={15} />
                断开连接
              </button>
            )}
          </div>
        </aside>
        <div className="management-content">
          {connected && <UpdateNotice key={epoch.current} />}
          {(busy || error || notice) && (
            <div className="management-feedback">
              {error && (
                <p role="alert">
                  {error}
                  <button onClick={() => setError("")}>关闭</button>
                </p>
              )}
              {busy && <p role="status">{busy}</p>}
              {notice && !busy && <p role="status">{notice}</p>}
            </div>
          )}
          {route.view === "templates" ? (
            <TemplateInventory
              key={`templates-${connected}`}
              connected={connected}
              onConnect={() => setConnectOpen(true)}
            />
          ) : route.view === "credits" ? (
            <Credits
              key={`credits-${connected}`}
              connected={connected}
              onConnect={() => setConnectOpen(true)}
            />
          ) : route.view === "library" ? (
            connected ? (
              <AssetLibrary
                key={epoch.current}
                title="素材库"
                assets={assets}
                onRefresh={loadAssets}
                onUpload={requestUpload}
              />
            ) : (
              <main className="dashboard">
                <span className="dashboard-eyebrow">
                  RIKOKO / MEDIA LIBRARY
                </span>
                <h1>素材库</h1>
                <div className="dashboard-callout">
                  <p>连接工作空间后上传、整理和下载素材。</p>
                  <button onClick={() => setConnectOpen(true)}>
                    连接工作空间
                  </button>
                </div>
              </main>
            )
          ) : (
            <Dashboard
              connected={connected}
              view={route.view}
              projectId={route.projectId}
              onConnect={() => setConnectOpen(true)}
              onProject={(id) =>
                navigate(route.view === "results" ? "results" : "tasks", id)
              }
              onLibrary={() => navigate("library")}
              onCredits={() => navigate("credits")}
            />
          )}
        </div>
      </div>
      {connectOpen && (
        <div className="connection-backdrop">
          <form
            className="connection-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <span className="eyebrow">CONNECT WORKSPACE</span>
            <h2 id="connect-title">连接工作空间</h2>
            <p>使用工作空间 Key 查看任务、素材和账户用量。</p>
            <label>
              工作空间 API Key
              <input
                type="password"
                autoComplete="off"
                required
                autoFocus
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
              />
            </label>
            <p className="field-note">本地 Key 位于 .data/local-admin.key。</p>
            {error && <p role="alert">{error}</p>}
            <div className="action-row">
              <button className="primary" disabled={!!busy}>
                连接
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setConnectOpen(false);
                  setKeyDraft("");
                }}
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}
      {!!files.length && (
        <div className="connection-backdrop">
          <section
            className="connection-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
          >
            <h2 id="upload-title">上传 {files.length} 份素材</h2>
            <p>请确认你有权使用这些图片、视频或音频。</p>
            <ul>
              {files.map((file, index) => (
                <li key={index}>{file.name}</li>
              ))}
            </ul>
            <div className="action-row">
              <button className="primary" onClick={() => void upload()}>
                我有使用权限，上传
              </button>
              <button onClick={() => setFiles([])}>取消</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
