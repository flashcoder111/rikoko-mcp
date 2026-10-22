// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Editor from "../apps/studio/src/Editor";
import { compositionSchema } from "../packages/contracts/src/index.js";
import type { Snapshot } from "../apps/studio/src/api";

vi.mock("../apps/studio/src/StudioPlayer", () => ({
  default: () => null,
  Filmstrip: () => null,
  timestamp: (v: number) => String(v),
}));
vi.mock("../apps/studio/src/Chat", () => ({ default: () => null }));
vi.mock("../apps/studio/src/media", () => ({ AssetThumb: () => null }));
vi.mock("../apps/studio/src/AudioControls", () => ({ default: () => null }));
vi.mock("../apps/studio/src/CaptionStyleControls", () => ({
  default: () => null,
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function fixture() {
  const revision = {
    id: "revision",
    type: "revision",
    projectId: "project",
    accountId: "a",
    createdAt: "now",
    version: 1,
    composition: compositionSchema.parse({
      schemaVersion: 1,
      title: "测试",
      width: 360,
      height: 640,
      language: "zh",
      scenes: [
        { id: "one", durationMs: 3000, text: "原文案", assetId: "video" },
      ],
    }),
  };
  const snapshot: Snapshot = {
    project: {
      id: "project",
      type: "project",
      accountId: "a",
      createdAt: "now",
    },
    revision,
    headRevisionId: revision.id,
    revisions: [revision],
    jobs: [],
    messages: [],
    links: { workspace: "", conversation: "" },
  };
  return {
    snapshot,
    assets: [
      {
        id: "music",
        type: "asset",
        accountId: "a",
        createdAt: "now",
        kind: "audio",
        name: "轻快音乐",
      },
    ],
    selectedSceneId: "one",
    selectScene: vi.fn(),
    busy: "",
    onEdit: vi.fn(),
    onRestore: vi.fn(),
    onViewRevision: vi.fn(),
    onLatest: vi.fn(),
    chat: {
      draft: "",
      setDraft: vi.fn(),
      attachments: [],
      removeAttachment: vi.fn(),
      submitted: "",
      busy: "",
      onSend: vi.fn(),
      onGeneratedAsset: vi.fn(),
      onApply: vi.fn(),
      onDismiss: vi.fn(),
      onUpload: vi.fn(),
      onStudio: vi.fn(),
      onCancel: vi.fn(),
      onRetry: vi.fn(),
      modelConnected: false,
      onPlans: vi.fn(),
    },
  };
}
function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === label,
  )!;
}
it("saves typed copy and music together without a separate apply step, and supports undo", async () => {
  const props = fixture();
  await act(async () => root.render(React.createElement(Editor, props)));
  await act(async () => button("改文案").click());
  const textarea = container.querySelector<HTMLTextAreaElement>(
    '[aria-label="镜头字幕"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, "新文案");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(button("保存并合成预览").disabled).toBe(false);
  await act(async () => button("换音乐").click());
  const music = container.querySelector<HTMLSelectElement>(
    '[aria-label="背景音乐"]',
  )!;
  await act(async () => {
    music.value = "music";
    music.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => button("保存并合成预览").click());
  expect(props.onEdit).toHaveBeenCalledWith(
    [
      { type: "caption", sceneId: "one", text: "新文案" },
      { type: "music", assetId: "music", gain: 0.3 },
    ],
    expect.any(String),
  );
  expect(props.snapshot.revision!.composition.scenes[0].assetId).toBe("video");
  expect(container.textContent).toContain("不会重新生成画面");
  expect(container.textContent).not.toContain("保存并生成预览");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="撤销"]')!.click(),
  );
  expect(music.value).toBe("");
  expect(container.textContent).toContain("请先保存并合成当前修改");
});
it("offers latest-version loading without discarding local edits", async () => {
  const props = fixture();
  props.snapshot.headRevisionId = "newer";
  await act(async () => root.render(React.createElement(Editor, props)));
  expect(button("改文案").disabled).toBe(true);
  await act(async () => button("载入最新版本").click());
  expect(props.onLatest).toHaveBeenCalledOnce();
});
