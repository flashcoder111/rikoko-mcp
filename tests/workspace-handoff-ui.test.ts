// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HermesHandoff from "../apps/studio/src/HermesHandoff";
import type { Snapshot } from "../apps/studio/src/api";
const call = vi.hoisted(() => vi.fn());
vi.mock("../apps/studio/src/api", () => ({ api: call }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  call.mockReset();
  vi.unstubAllGlobals();
});
const props = () => ({
  snapshot: { project: { id: "p" }, revision: { id: "r" } } as Snapshot,
  selectedSceneId: "scene",
  assetIds: ["audio"],
  draft: "改结尾文案",
  blocked: false,
  dirty: false,
});
it("blocks handoff until local changes are saved and passes explicit selection and materials", async () => {
  const input = props();
  await act(async () =>
    root.render(
      React.createElement(HermesHandoff, {
        ...input,
        blocked: true,
        dirty: true,
      }),
    ),
  );
  expect(container.querySelector("button")!.disabled).toBe(true);
  expect(call).not.toHaveBeenCalled();
  expect(container.textContent).toContain("请先保存并合成当前修改");
  call.mockResolvedValue({
    requestId: "req",
    prompt: "继续",
    hermesUrl: "hermes://rikoko-handoff?request=req&project=p",
    status: "prepared",
  });
  await act(async () => root.render(React.createElement(HermesHandoff, input)));
  await act(async () => container.querySelector("button")!.click());
  expect(call).toHaveBeenCalledWith(
    "workspace_handoff_prepare",
    expect.objectContaining({
      projectId: "p",
      revisionId: "r",
      selectedSceneId: "scene",
      assetIds: ["audio"],
      message: "改结尾文案",
    }),
  );
  expect(container.querySelector("a")?.href).toContain(
    "hermes://rikoko-handoff",
  );
  expect(container.textContent).toContain("由你发送继续");
});
it("discards a late preparation response when the selected scene changes", async () => {
  let finish!: (value: unknown) => void;
  call.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const input = props();
  await act(async () => root.render(React.createElement(HermesHandoff, input)));
  await act(async () => container.querySelector("button")!.click());
  await act(async () =>
    root.render(
      React.createElement(HermesHandoff, {
        ...input,
        selectedSceneId: "new-scene",
      }),
    ),
  );
  await act(async () =>
    finish({
      requestId: "old",
      prompt: "旧要求",
      hermesUrl: "hermes://rikoko-handoff?request=old&project=p",
      status: "prepared",
    }),
  );
  expect(container.querySelector("a")).toBeNull();
  expect(container.querySelector("button")!.disabled).toBe(false);
});
