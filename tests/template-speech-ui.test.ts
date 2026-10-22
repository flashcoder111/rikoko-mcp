// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Templates from "../apps/studio/src/Templates.js";
import { starterTemplates } from "../packages/templates/src/starters.js";
import type { Entity } from "../packages/contracts/src/index.js";

const calls = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>());
vi.mock("../apps/studio/src/api", async (original) => ({
  ...(await original<object>()),
  api: calls,
}));
vi.mock("../apps/studio/src/media", () => ({ AssetThumb: () => null }));
vi.mock("../apps/studio/src/AssetLibrary", () => ({ default: () => null }));
afterEach(() => {
  vi.unstubAllGlobals();
  calls.mockReset();
});

it("shows speech controls only for supported templates and prepares with existing audio and transcript", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls.mockImplementation(async (name) =>
    name === "template_list"
      ? { templates: starterTemplates }
      : name === "template_prepare"
        ? { composition: starterTemplates[0].composition }
        : { projectId: "project" },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onOpen = vi.fn();
  try {
    await act(async () =>
      root.render(
        React.createElement(Templates, {
          onOpen,
          onRefresh: vi.fn(async () => {}),
          onUpload: vi.fn(),
          assets: [
            {
              id: "voice",
              kind: "audio",
              name: "我的口播",
              metadata: { hasAudio: true, durationMs: 6000 },
            },
            {
              id: "transcript",
              kind: "transcript",
              name: "口播转写",
              metadata: { sourceAssetId: "voice" },
            },
            {
              id: "unrelated",
              kind: "transcript",
              name: "其他转写",
              metadata: { sourceAssetId: "other" },
            },
          ].map((asset) => ({
            accountId: "fixture-account",
            type: "asset",
            createdAt: "2026-10-16T00:00:00.000Z",
            ...asset,
          })) satisfies Entity[],
        }),
      ),
    );
    const choose = (title: string) =>
      [...container.querySelectorAll("button")].find(
        (b) => b.querySelector("strong")?.textContent === title,
      )!;
    await act(async () => choose("前后变化").click());
    expect(container.querySelector('[aria-label="口播音频"]')).toBeNull();
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "返回全部模板")!
        .click(),
    );
    await act(async () => choose("商品卖点").click());
    const voice = container.querySelector<HTMLSelectElement>(
      '[aria-label="口播音频"]',
    )!;
    expect(voice).not.toBeNull();
    await act(async () => {
      voice.value = "voice";
      voice.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const transcript = container.querySelector<HTMLSelectElement>(
      '[aria-label="对应转写"]',
    )!;
    expect(transcript.textContent).not.toContain("其他转写");
    await act(async () => {
      transcript.value = "transcript";
      transcript.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(calls).toHaveBeenCalledWith(
      "template_prepare",
      expect.objectContaining({
        speech: { assetId: "voice", transcriptAssetId: "transcript" },
      }),
    );
    expect(onOpen).toHaveBeenCalledWith("project");
    expect(
      calls.mock.calls.some(([name]) =>
        ["quote_create", "job_submit"].includes(name),
      ),
    ).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
