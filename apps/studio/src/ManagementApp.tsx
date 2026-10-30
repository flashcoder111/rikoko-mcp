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
import ProjectTable from "./ProjectTable";
import Recharge from "./Recharge";

export type ManagementView =
  | "overview"
  | "tasks"
  | "library"
  | "results"
  | "credits"
  | "recharge"
  | "templates";
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
        : url.pathname === "/recharge"
          ? "recharge"
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
  { id: "overview", label: "Projects", path: "/", icon: LayoutDashboard },
  { id: "tasks", label: "Projects", path: "/tasks", icon: ListChecks },
  { id: "library", label: "Media library", path: "/library", icon: FolderOpen },
  { id: "templates", label: "Templates", path: "/templates", icon: FolderOpen },
  { id: "results", label: "Downloads", path: "/results", icon: Download },
  { id: "credits", label: "Credits & usage", path: "/credits", icon: Coins },
  { id: "recharge", label: "Add credits", path: "/recharge", icon: Coins },
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
  const autoConnect = useCallback(async (requestEpoch: number) => {
    const response = await fetch("/auth/local-session", { method: "POST" });
    if (response.status === 404) return false;
    if (!response.ok)
      throw Error(
        "Automatic connection failed. Make sure the local service is running and try again.",
      );
    if (requestEpoch === epoch.current) {
      setConnected(true);
      setConnectOpen(false);
      setError("");
    }
    return true;
  }, []);
  const requestConnect = useCallback(() => {
    const requestEpoch = epoch.current;
    setChecking(true);
    void autoConnect(requestEpoch)
      .then((automatic) => {
        if (!automatic && requestEpoch === epoch.current) setConnectOpen(true);
      })
      .catch((err) => {
        if (requestEpoch === epoch.current) setError(err.message);
      })
      .finally(() => {
        if (requestEpoch === epoch.current) setChecking(false);
      });
  }, [autoConnect]);
  useEffect(() => {
    let active = true;
    const expired = () => {
      clear();
      requestConnect();
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
        if (!response.ok && response.status !== 401)
          throw Error("Could not check the connection. Please reconnect.");
        const session = response.ok
          ? await response.json()
          : { connected: false };
        if (!active || initialEpoch !== epoch.current) return;
        if (session.connected === true) setConnected(true);
        else await autoConnect(initialEpoch);
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
  }, [clear, autoConnect, requestConnect]);
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
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      pending.current = false;
      setBusy("");
    }
  }
  async function connect() {
    await run("Connecting…", async () => {
      const response = await fetch("/auth/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${keyDraft.trim()}` },
      });
      if (!response.ok)
        throw Error(
          (await response.json()).error?.message ?? "Connection failed",
        );
      epoch.current++;
      setKeyDraft("");
      setConnected(true);
      setConnectOpen(false);
    });
  }
  function requestUpload(selected: FileList) {
    if (!connected) {
      requestConnect();
      return;
    }
    if (
      selected.length > 14 ||
      Array.from(selected).some((file) => file.size > 100 * 1024 * 1024)
    ) {
      setError("Upload up to 14 files at a time, each no larger than 100 MB.");
      return;
    }
    setFiles(Array.from(selected));
  }
  async function upload() {
    const selected = files;
    setFiles([]);
    await run("Uploading files…", async () => {
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
            throw Error(
              (await response.json()).error?.message ?? "Upload failed",
            );
        }
        if (requestEpoch === epoch.current)
          setNotice(`Uploaded ${selected.length} files.`);
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
        <span className="management-header-label">Local workspace</span>
        <button
          className="management-menu"
          aria-label="Toggle navigation"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Menu size={20} />
        </button>
        <div className="management-connection">
          <span>
            {checking
              ? "Connecting…"
              : connected
                ? "Connected"
                : "Disconnected"}
          </span>
          <a
            href="/recharge"
            className="management-recharge"
            onClick={(event) => {
              event.preventDefault();
              navigate("recharge");
            }}
          >
            Add credits
          </a>
          {!connected && (
            <button disabled={checking || !!busy} onClick={requestConnect}>
              Connect workspace
            </button>
          )}
        </div>
      </header>
      <div className="management-body">
        <aside className={`management-sidebar ${menu ? "is-open" : ""}`}>
          <span className="dashboard-eyebrow">MY WORKSPACE</span>
          <nav aria-label="Workspace navigation">
            {links
              .filter(({ id }) => id !== "tasks")
              .map(({ id, path, label, icon: Icon }) => (
                <a
                  key={id}
                  href={path}
                  aria-current={
                    route.view === id ||
                    (id === "overview" && route.view === "tasks")
                      ? "page"
                      : undefined
                  }
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
            {connected && <UpdateNotice key={epoch.current} />}
            {connected && (
              <button
                disabled={!!busy}
                onClick={() =>
                  void run("Disconnecting…", async () => {
                    const response = await fetch("/auth/session", {
                      method: "DELETE",
                    });
                    if (!response.ok)
                      throw Error("Could not disconnect. Please try again.");
                    clear();
                  })
                }
              >
                <LogOut size={15} />
                Disconnect
              </button>
            )}
          </div>
        </aside>
        <div className="management-content">
          {(busy || error || notice) && (
            <div className="management-feedback">
              {error && (
                <p role="alert">
                  {error}
                  <button onClick={() => setError("")}>Close</button>
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
              onConnect={requestConnect}
            />
          ) : route.view === "recharge" ? (
            <Recharge onCredits={() => navigate("credits")} />
          ) : route.view === "credits" ? (
            <Credits
              key={`credits-${connected}`}
              connected={connected}
              onConnect={requestConnect}
              onRecharge={() => navigate("recharge")}
            />
          ) : route.view === "library" ? (
            connected ? (
              <AssetLibrary
                key={epoch.current}
                title="Media library"
                assets={assets}
                onRefresh={loadAssets}
                onUpload={requestUpload}
              />
            ) : (
              <main className="dashboard">
                <span className="dashboard-eyebrow">
                  RIKOKO / MEDIA LIBRARY
                </span>
                <h1>Media library</h1>
                <div className="dashboard-callout">
                  <p>
                    Connect your workspace to upload, organize, and download
                    media.
                  </p>
                  <button onClick={requestConnect}>Connect workspace</button>
                </div>
              </main>
            )
          ) : route.view === "results" ? (
            <Dashboard
              connected={connected}
              view={route.view}
              projectId={route.projectId}
              onConnect={requestConnect}
              onProject={(id) =>
                navigate(route.view === "results" ? "results" : "tasks", id)
              }
              onLibrary={() => navigate("library")}
              onCredits={() => navigate("credits")}
            />
          ) : (
            <ProjectTable
              connected={connected}
              projectId={route.projectId}
              onProject={(id) => navigate("tasks", id)}
              onConnect={requestConnect}
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
            <h2 id="connect-title">Connect workspace</h2>
            <p>
              Use your workspace key to access tasks, media, and account usage.
            </p>
            <label>
              Workspace API key
              <input
                type="password"
                autoComplete="off"
                required
                autoFocus
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
              />
            </label>
            <p className="field-note">
              Your local key is stored in .data/local-admin.key.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="action-row">
              <button className="primary" disabled={!!busy}>
                Connect
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setConnectOpen(false);
                  setKeyDraft("");
                }}
              >
                Cancel
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
            <h2 id="upload-title">Upload {files.length} files</h2>
            <p>
              Confirm that you have permission to use these images, videos, or
              audio files.
            </p>
            <ul>
              {files.map((file, index) => (
                <li key={index}>{file.name}</li>
              ))}
            </ul>
            <div className="action-row">
              <button className="primary" onClick={() => void upload()}>
                I have permission to use these files
              </button>
              <button onClick={() => setFiles([])}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
