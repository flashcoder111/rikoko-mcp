// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import UpdateNotice from "../apps/studio/src/UpdateNotice";
import { api } from "../apps/studio/src/api";
import {
  UPDATE_COMMAND,
  UPDATE_INTERVAL_MS,
  UPDATE_MANIFEST_URL,
  type UpdateStatus,
} from "../packages/contracts/src/updates.js";

vi.mock("../apps/studio/src/api", () => ({ api: vi.fn() }));
let root: Root, container: HTMLDivElement;
const result = (
  status: UpdateStatus["status"] = "update_available",
): UpdateStatus => ({
  status,
  currentVersion: "0.1.30",
  latestVersion: "0.1.31",
  releaseNotes: "修复问题 <script>untrusted()</script>",
  checkedAt: "2026-10-22T00:00:00Z",
  nextCheckAt: null,
  manifestUrl: UPDATE_MANIFEST_URL,
  upgradeCommand: UPDATE_COMMAND,
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("checks on mount, safely renders notes, copies the fixed short-link command and supports manual refresh", async () => {
  vi.mocked(api).mockResolvedValue(result());
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  await act(async () => root.render(React.createElement(UpdateNotice)));
  expect(api).toHaveBeenCalledWith("update_check", { force: false });
  expect(container.textContent).toContain("Update available: 0.1.31");
  expect(container.textContent).toContain("--dir");
  expect(container.querySelector("script")).toBeNull();
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Copy upgrade command")!
      .click(),
  );
  expect(copy).toHaveBeenCalledWith(UPDATE_COMMAND);
  expect(container.textContent).toContain("Upgrade command copied");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Check for updates")!
      .click(),
  );
  expect(api).toHaveBeenLastCalledWith("update_check", { force: true });
});
it.each(["unavailable", "up_to_date", "ahead"] as const)(
  "shows %s without an upgrade action",
  async (status) => {
    vi.mocked(api).mockResolvedValue(result(status));
    await act(async () => root.render(React.createElement(UpdateNotice)));
    expect(container.querySelector("code")).toBeNull();
    const text =
      status === "unavailable"
        ? "Update check unavailable"
        : status === "ahead"
          ? "Current version is newer than the public release"
          : "Up to date";
    expect(container.textContent).toContain(text);
  },
);
it("shows a service failure and provides clipboard fallback", async () => {
  vi.mocked(api).mockRejectedValueOnce(Error("offline"));
  await act(async () => root.render(React.createElement(UpdateNotice)));
  expect(container.textContent).toContain("Update check unavailable");
  vi.mocked(api).mockResolvedValue(result());
  await act(async () => container.querySelector("button")!.click());
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    Error("permission denied"),
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Copy upgrade command")!
      .click(),
  );
  expect(container.textContent).toContain(
    "Select the command below to copy it",
  );
});
it("polls every six hours and stops when disconnected/unmounted", async () => {
  vi.useFakeTimers();
  vi.mocked(api).mockResolvedValue(result());
  await act(async () => root.render(React.createElement(UpdateNotice)));
  await act(async () => vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS));
  expect(api).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS));
  expect(api).toHaveBeenCalledTimes(2);
});
