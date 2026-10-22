import React, { useEffect, useRef, useState } from "react";
import {
  UPDATE_COMMAND,
  UPDATE_INTERVAL_MS,
  type UpdateStatus,
} from "../../../packages/contracts/src/updates.js";
import { api } from "./api";
import "./updates.css";

/** Mounted only for a connected workspace; unmount discards pending responses. */
export default function UpdateNotice() {
  const [result, setResult] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const active = useRef(false);
  const pending = useRef(false);
  async function check(force = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setCopyStatus("");
    try {
      const next = await api<UpdateStatus>("update_check", { force });
      if (active.current) {
        setResult(next);
        setError(false);
      }
    } catch {
      if (active.current) {
        setError(true);
        setResult(null);
      }
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    void check();
    const timer = window.setInterval(() => void check(), UPDATE_INTERVAL_MS);
    return () => {
      active.current = false;
      window.clearInterval(timer);
    };
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      if (active.current) setCopyStatus("已复制升级命令");
    } catch {
      if (active.current) setCopyStatus("无法自动复制，请选中下方命令复制。");
    }
  }
  const available = result?.status === "update_available";
  const message =
    error || result?.status === "unavailable"
      ? "暂时无法检查更新，不影响继续使用。"
      : result?.status === "up_to_date"
        ? "已是最新正式版"
        : result?.status === "ahead"
          ? `当前版本高于公开正式版 ${result.latestVersion}`
          : available
            ? `发现新版本 ${result.latestVersion}`
            : "正在检查更新…";
  return (
    <section
      className={`rikoko-updates${available ? " has-update" : ""}`}
      aria-label="软件更新"
    >
      <div className="rikoko-updates-summary">
        <p role="status">
          {result && <span>rikoko {result.currentVersion} · </span>}
          {busy ? "正在检查更新…" : message}
        </p>
        <button disabled={busy} onClick={() => void check(true)}>
          检查更新
        </button>
      </div>
      {result?.checkedAt && (
        <small>上次检查：{new Date(result.checkedAt).toLocaleString()}</small>
      )}
      {available && (
        <div className="rikoko-update-details">
          {result.releaseNotes && (
            <p className="rikoko-release-notes">{result.releaseNotes}</p>
          )}
          <p>
            通过安装命令安装的本地版本：等待任务结束，关闭 MCP
            客户端，再在终端运行以下命令。自定义安装目录需保留原来的
            --dir；完成后重新连接 MCP。源码或远程部署请由维护者更新。
          </p>
          <code>{UPDATE_COMMAND}</code>
          <div>
            <button onClick={() => void copy()}>复制升级命令</button>
            <span role="status">{copyStatus}</span>
          </div>
        </div>
      )}
    </section>
  );
}
