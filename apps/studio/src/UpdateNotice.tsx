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
      if (active.current) setCopyStatus("Upgrade command copied");
    } catch {
      if (active.current)
        setCopyStatus(
          "Could not copy automatically. Select the command below to copy it.",
        );
    }
  }
  const available = result?.status === "update_available";
  const message =
    error || result?.status === "unavailable"
      ? "Update check unavailable. You can continue using rikoko."
      : result?.status === "up_to_date"
        ? "Up to date"
        : result?.status === "ahead"
          ? `Current version is newer than the public release ${result.latestVersion}`
          : available
            ? `Update available: ${result.latestVersion}`
            : "Checking for updates…";
  return (
    <section
      className={`rikoko-updates${available ? " has-update" : ""}`}
      aria-label="Software updates"
    >
      <div className="rikoko-updates-summary">
        <p role="status">
          {result && <span>rikoko {result.currentVersion} · </span>}
          {busy ? "Checking for updates…" : message}
        </p>
        <button disabled={busy} onClick={() => void check(true)}>
          Check for updates
        </button>
      </div>
      {result?.checkedAt && (
        <small>
          Last checked: {new Date(result.checkedAt).toLocaleString()}
        </small>
      )}
      {available && (
        <div className="rikoko-update-details">
          {result.releaseNotes && (
            <p className="rikoko-release-notes">{result.releaseNotes}</p>
          )}
          <p>
            For command-line installations, wait for tasks to finish and close
            your MCP client before running the command below. Keep your original
            --dir for custom installations, then reconnect MCP. Source and
            remote deployments should be updated by their maintainer.
          </p>
          <code>{UPDATE_COMMAND}</code>
          <div>
            <button onClick={() => void copy()}>Copy upgrade command</button>
            <span role="status">{copyStatus}</span>
          </div>
        </div>
      )}
    </section>
  );
}
