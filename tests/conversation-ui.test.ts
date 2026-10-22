// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Chat, { type ChatProps } from "../apps/studio/src/Chat.js";

vi.mock("../apps/studio/src/media", () => ({
  AssetThumb: () => null,
  VideoPreview: () => null,
}));
vi.mock("../apps/studio/src/Generation", () => ({
  default: ({ request }: { request?: { model: string; prompt: string } }) =>
    request
      ? React.createElement(
          "output",
          { "data-model": request.model },
          request.prompt,
        )
      : null,
}));
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
  expect(container.textContent).not.toContain("应用并合成预览");
});

function withModels(): ChatProps {
  return {
    ...props(),
    capabilities: {
      workspace: { conversationPlanner: "local-commands" },
      generation: { mode: "custom", billingSource: "external", error: null },
      providers: [
        {
          id: "future-video",
          name: "Future model",
          kind: "video",
          available: true,
          description: "配置中的未来模型",
          maxCostCents: 1,
        },
        {
          id: "minimax-text",
          name: "MiniMax",
          kind: "video",
          available: true,
          description: "文字生成",
          maxCostCents: 1,
        },
        {
          id: "disabled-video",
          name: "Disabled",
          kind: "video",
          available: false,
          description: "尚未启用",
          maxCostCents: 1,
        },
        {
          id: "reference-video",
          name: "Reference",
          kind: "video",
          available: true,
          description: "首帧生成",
          maxCostCents: 1,
          generationInput: { mode: "image_to_video" },
        },
      ],
    },
  };
}
async function submit(input: ChatProps, draft: string) {
  input.draft = draft;
  await act(async () => root.render(React.createElement(Chat, input)));
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

it("prepares requirements without sending or quoting and preserves the existing brief", async () => {
  const input = withModels();
  await submit(input, "咖啡店短片\n/brief 做成15秒、9:16竖屏");
  expect(input.setDraft).toHaveBeenLastCalledWith(
    "咖啡店短片\nCreative brief: 做成15秒、9:16竖屏",
  );
  expect(input.onSend).not.toHaveBeenCalled();
  expect(container.querySelector("output")).toBeNull();
  await submit(input, "咖啡店短片\n/aspect 0:16");
  expect(container.textContent).toContain(
    "Include duration and aspect ratio in your creative brief",
  );
  expect(input.onSend).not.toHaveBeenCalled();
});

it("selects a catalog model without a purchase, retains the draft and uses that model on the next send", async () => {
  const input = withModels();
  await submit(input, "咖啡店短片\n/model future-video");
  expect(input.setDraft).toHaveBeenLastCalledWith("咖啡店短片");
  expect(
    container.querySelector<HTMLSelectElement>('select[aria-label="生成模型"]')!
      .value,
  ).toBe("future-video");
  expect(container.querySelector("output")).toBeNull();
  expect(input.onSend).not.toHaveBeenCalled();
  await submit(input, "咖啡店短片");
  expect(container.querySelector("output")?.getAttribute("data-model")).toBe(
    "future-video",
  );
  expect(container.querySelector("output")?.textContent).toBe("咖啡店短片");
});

it("blocks unknown, disabled and reference-only model choices without changing an explicit selection", async () => {
  const input = withModels();
  await submit(input, "/model future-video");
  for (const id of ["not-configured", "disabled-video", "reference-video"]) {
    await submit(input, `/model ${id}`);
    expect(
      container.querySelector<HTMLSelectElement>(
        'select[aria-label="生成模型"]',
      )!.value,
    ).toBe("future-video");
    expect(container.querySelector("output")).toBeNull();
  }
  expect(input.onSend).not.toHaveBeenCalled();
});

it("does not silently fallback when an explicitly selected model disappears", async () => {
  const input = withModels();
  await submit(input, "/model future-video");
  input.capabilities!.providers = input.capabilities!.providers.filter(
    (m) => m.id !== "future-video",
  );
  await submit(input, "咖啡店短片");
  expect(container.querySelector("output")).toBeNull();
  expect(
    container.querySelector<HTMLButtonElement>(".send-button")!.disabled,
  ).toBe(true);
  await submit(input, "/model auto");
  expect(
    container.querySelector<HTMLSelectElement>('select[aria-label="生成模型"]')!
      .value,
  ).toBe("minimax-text");
  expect(container.querySelector("output")).toBeNull();
});

it("allows command help even without available generation models and blocks commands while busy", async () => {
  const input = withModels();
  input.capabilities!.providers = [];
  await submit(input, "/video");
  input.draft = "/help";
  await act(async () => root.render(React.createElement(Chat, input)));
  expect(
    container.querySelector<HTMLButtonElement>(".send-button")!.disabled,
  ).toBe(false);
  await submit(input, "/help");
  expect(container.textContent).not.toContain("/duration");
  expect(container.textContent).not.toContain("/aspect");
  expect(container.textContent).toContain("/speech");
  expect(input.onSend).not.toHaveBeenCalled();
  input.busy = "上传中";
  vi.mocked(input.setDraft).mockClear();
  await submit(input, "/edit");
  expect(input.setDraft).not.toHaveBeenCalled();
});

it("keeps independent video, image, speech and music selections across mode switches", async () => {
  const input = withModels();
  input.capabilities!.providers.push(
    {
      id: "image-choice",
      name: "Image",
      kind: "image",
      available: true,
      description: "",
      maxCostCents: 1,
    },
    {
      id: "speech-choice",
      name: "Speech",
      kind: "audio",
      category: "speech",
      available: true,
      description: "",
      maxCostCents: 1,
    },
    {
      id: "music-choice",
      name: "Music",
      kind: "audio",
      category: "music",
      available: true,
      description: "",
      maxCostCents: 1,
    },
  );
  const choices = {
    video: "future-video",
    image: "image-choice",
    speech: "speech-choice",
    audio: "music-choice",
  };
  for (const id of Object.values(choices)) await submit(input, `/model ${id}`);
  for (const [role, id] of Object.entries(choices)) {
    await submit(input, `/${role}`);
    expect(
      container.querySelector<HTMLSelectElement>(
        'select[aria-label="生成模型"]',
      )!.value,
    ).toBe(id);
  }
  await submit(input, "/model auto");
  await submit(input, "/video");
  expect(
    container.querySelector<HTMLSelectElement>('select[aria-label="生成模型"]')!
      .value,
  ).toBe("future-video");
  await submit(input, "/models");
  const groups = container.querySelectorAll(".composer-model-group");
  expect(groups).toHaveLength(4);
  expect(groups[2].textContent).toContain("speech-choice");
  expect(groups[2].textContent).not.toContain("music-choice");
  expect(groups[3].textContent).toContain("music-choice");
  expect(input.onSend).not.toHaveBeenCalled();
  expect(container.querySelector("output")).toBeNull();
});

it("offers a slash menu and leaves reference files as an explicit upload step", async () => {
  const input = props();
  await submit(input, "咖啡店短片\n/reference 产品外观");
  expect(input.setDraft).toHaveBeenLastCalledWith(
    "咖啡店短片\nReference purpose: 产品外观",
  );
  expect(container.textContent).toContain("请通过 + 上传文件");
  input.draft = "咖啡店短片\n/";
  await act(async () => root.render(React.createElement(Chat, input)));
  const item = [
    ...container.querySelectorAll<HTMLButtonElement>(
      ".composer-commands > button",
    ),
  ].find((b) => b.textContent?.includes("/style"))!;
  await act(async () => item.click());
  expect(input.setDraft).toHaveBeenLastCalledWith("咖啡店短片\n/style ");
});

it("defaults post-production speech to Eleven v3 and blocks reference-dependent cloned speech in the text composer", async () => {
  const input = withModels();
  input.capabilities!.providers = [
    {
      id: "minimax-speech",
      name: "MiniMax Speech",
      kind: "audio",
      category: "speech",
      description: "alternative",
      available: true,
      maxCostCents: 1,
    },
    {
      id: "minimax-cloned-speech",
      name: "Cloned speech",
      kind: "audio",
      category: "speech",
      requiresVoiceProfile: true,
      description: "needs voice asset",
      available: true,
      maxCostCents: 1,
    },
    {
      id: "elevenlabs-voice",
      name: "ElevenLabs Eleven v3",
      kind: "audio",
      category: "speech",
      description: "post-production",
      available: true,
      maxCostCents: 1,
    },
  ];
  await submit(input, "/speech");
  await submit(input, "修改后的配音");
  expect(container.querySelector("output")?.getAttribute("data-model")).toBe(
    "elevenlabs-voice",
  );
  await submit(input, "/model minimax-cloned-speech");
  expect(container.textContent).toContain("结构化参考输入");
  expect(input.onSend).not.toHaveBeenCalled();
});
