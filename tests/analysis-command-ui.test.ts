// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Chat, { type ChatProps } from "../apps/studio/src/Chat.js";
vi.mock("../apps/studio/src/media", () => ({
  AssetThumb: () => null,
  VideoPreview: () => null,
}));
vi.mock("../apps/studio/src/Generation", () => ({ default: () => null }));
vi.mock("../apps/studio/src/api", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  api: vi.fn(),
}));
import { api } from "../apps/studio/src/api.js";
it("switches or reads analysis defaults without submitting a draft or dropping attachments", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const input: ChatProps = {
    draft: "原有要求\n/analysis 复刻",
    setDraft: vi.fn(),
    attachments: [
      {
        id: "video",
        type: "asset",
        accountId: "a",
        createdAt: "now",
        kind: "video",
      },
    ],
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
  };
  const submit = async () => {
    await act(async () => {
      root.render(React.createElement(Chat, input));
    });
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
  };
  try {
    vi.mocked(api).mockResolvedValue({ detail: "recreate", scope: "account" });
    await submit();
    expect(api).toHaveBeenCalledWith("reference_analysis_settings", {
      detail: "recreate",
    });
    expect(input.setDraft).toHaveBeenLastCalledWith("原有要求");
    expect(container.textContent).toContain("Recreation");
    expect(input.onSend).not.toHaveBeenCalled();
    expect(input.removeAttachment).not.toHaveBeenCalled();
    input.draft = "/analysis";
    await submit();
    expect(api).toHaveBeenLastCalledWith("reference_analysis_settings", {});
    vi.mocked(api).mockClear();
    input.draft = "/analysis high";
    await submit();
    expect(api).not.toHaveBeenCalled();
    expect(container.textContent).toContain("overview");
    expect(input.onSend).not.toHaveBeenCalled();
    vi.mocked(api).mockRejectedValueOnce(new Error("连接失败"));
    input.draft = "/analysis shots";
    await submit();
    expect(container.textContent).toContain("连接失败");
    expect(input.setDraft).not.toHaveBeenLastCalledWith("/analysis shots");
    expect(input.removeAttachment).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});
