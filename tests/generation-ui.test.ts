// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Generation from "../apps/studio/src/Generation.js";

const calls = vi.hoisted(() =>
  vi.fn(async (name: string, _args?: any) =>
    name === "quote_create"
      ? { id: "q", maxCents: 5 }
      : { id: "j", status: "queued", outputs: [] },
  ),
);
vi.mock("../apps/studio/src/api", async (original) => ({
  ...(await original<object>()),
  api: calls,
}));
vi.mock("../apps/studio/src/media", () => ({ VideoPreview: () => null }));
afterEach(() => {
  vi.unstubAllGlobals();
  calls.mockClear();
  sessionStorage.clear();
});

it("submits requested speech directly without a quote or price confirmation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        React.createElement(Generation, {
          scope: "speech-test",
          request: {
            prompt: "新的旁白",
            model: "elevenlabs-voice",
            modelName: "Eleven v3",
            mediaKind: "audio",
            description: "后期配音",
            billingSource: "external",
            nonce: "once",
            speech: { language: "zh", voice: "Aria" },
          },
          onUse: vi.fn(),
          onReprompt: vi.fn(),
        }),
      ),
    );
    const expected = {
      kind: "tts",
      engine: "fal",
      model: "elevenlabs-voice",
      text: "新的旁白",
      language: "zh",
      voice: "Aria",
    };
    expect(calls.mock.calls.some(([name]) => name === "quote_create")).toBe(
      false,
    );
    expect(container.textContent).not.toContain("确认并生成");
    expect(calls).toHaveBeenCalledWith("job_submit", {
      idempotencyKey: "once",
      input: expected,
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("retries an uncertain submission with the same idempotency key and no quote", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls.mockRejectedValueOnce(new Error("Connection interrupted"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        React.createElement(Generation, {
          scope: "retry-test",
          request: {
            prompt: "A bottle",
            model: "image",
            modelName: "Image",
            mediaKind: "image",
            description: "",
            billingSource: "external",
            nonce: "stable-retry",
          },
          onUse: vi.fn(),
          onReprompt: vi.fn(),
        }),
      ),
    );
    expect(container.textContent).toContain("Connection interrupted");
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "重试提交",
    )!;
    await act(async () => retry.click());
    const submissions = calls.mock.calls.filter(
      ([name]) => name === "job_submit",
    );
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[0]).toEqual([
      "job_submit",
      {
        idempotencyKey: "stable-retry",
        input: {
          kind: "generate",
          model: "image",
          prompt: "A bottle",
          parameters: {},
        },
      },
    ]);
    expect(calls.mock.calls.some(([name]) => name === "quote_create")).toBe(
      false,
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("waits for face assessment and an explicit MiniMax/Kling choice before video submission", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls.mockImplementation(async (name: string, args?: any) => {
    if (name !== "video_model_resolve")
      return { id: "j", status: "queued", outputs: [] };
    const confirmed = args.userChoice?.model;
    return {
      status: confirmed ? "ready" : "user_choice_required",
      faceStatus: args.faces,
      selectedModel: confirmed ?? "minimax-video",
      recommendedModel: "minimax-video",
      videoPolicy: {
        faces: args.faces,
        reason: args.reason,
        references: [],
        ...(confirmed ? { userChoice: args.userChoice } : {}),
      },
      candidates: [
        { modelId: "minimax-video", name: "MiniMax" },
        { modelId: "kling-video", name: "Kling" },
      ],
      userInteraction: {
        required: !confirmed,
        message: "涉及人脸，不能调用 Seedance，请选择 MiniMax 或 Kling。",
      },
    } as any;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const click = async (text: string) =>
    act(async () => {
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === text)!
        .click();
    });
  try {
    await act(async () =>
      root.render(
        React.createElement(Generation, {
          scope: "face-interaction",
          request: {
            prompt: "A presenter",
            model: "seedance-mini-text",
            modelName: "Seedance Mini",
            mediaKind: "video",
            description: "",
            billingSource: "external",
            nonce: "face-once",
          },
          onUse: vi.fn(),
          onReprompt: vi.fn(),
        }),
      ),
    );
    expect(calls).not.toHaveBeenCalled();
    await click("涉及人脸");
    expect(calls.mock.calls.some(([name]) => name === "job_submit")).toBe(
      false,
    );
    expect(container.textContent).toContain("不能调用 Seedance");
    await click("使用 Kling");
    expect(calls).toHaveBeenCalledWith(
      "job_submit",
      expect.objectContaining({
        idempotencyKey: "face-once",
        input: expect.objectContaining({
          model: "kling-video",
          videoPolicy: expect.objectContaining({
            faces: "present",
            userChoice: { model: "kling-video", confirmed: true },
          }),
        }),
      }),
    );
    expect(calls.mock.calls.some(([name]) => name === "quote_create")).toBe(
      false,
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
