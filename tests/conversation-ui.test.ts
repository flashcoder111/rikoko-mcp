// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Chat, { type ChatProps } from "../apps/studio/src/Chat.js";

vi.mock("../apps/studio/src/media", () => ({
  AssetThumb: () => null,
  VideoPreview: () => null,
}));
vi.mock("../apps/studio/src/Generation", () => ({ default: () => null }));
let root: Root, container: HTMLDivElement;
const props = (): ChatProps => ({
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
  vi.unstubAllGlobals();
});
it("submits an attachment-only reply through the actual form and blocks an empty turn", async () => {
  const input = props();
  await act(async () => root.render(React.createElement(Chat, input)));
  expect(
    container.querySelector<HTMLButtonElement>(".send-button")!.disabled,
  ).toBe(true);
  input.attachments = [
    {
      id: "photo",
      type: "asset",
      accountId: "a",
      createdAt: "now",
      kind: "image",
      name: "product.png",
    },
  ];
  await act(async () => root.render(React.createElement(Chat, input)));
  expect(
    container.querySelector<HTMLButtonElement>(".send-button")!.disabled,
  ).toBe(false);
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(input.onSend).toHaveBeenCalledOnce();
  input.busy = "上传中";
  await act(async () => root.render(React.createElement(Chat, input)));
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(input.onSend).toHaveBeenCalledOnce();
});
it("shows concrete missing material and its purpose without offering a premature render", async () => {
  const input = props();
  input.proposal = {
    engine: "local-commands",
    status: "waiting_input",
    message: "收到后继续",
    missingInputs: [
      {
        id: "product",
        kind: "image",
        prompt: "请发送正面照片",
        purpose: "开头产品特写",
        required: true,
      },
      {
        id: "logo",
        kind: "image",
        prompt: "也可以提供 logo",
        purpose: "片尾标识",
        required: false,
      },
    ],
  };
  await act(async () => root.render(React.createElement(Chat, input)));
  expect(container.textContent).toContain("需要补充：请发送正面照片");
  expect(container.textContent).toContain("开头产品特写");
  expect(container.textContent).toContain("可选：也可以提供 logo");
  expect(container.textContent).not.toContain("应用并生成预览");
});
