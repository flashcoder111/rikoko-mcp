// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CaptionStyleControls from "../apps/studio/src/CaptionStyleControls.js";
import { captionCss } from "../apps/studio/src/caption-style.js";
import { prepareCaptionStyle } from "../packages/core/src/caption-style.js";

const call = vi.hoisted(() => vi.fn());
vi.mock("../apps/studio/src/api", () => ({ api: call }));
afterEach(() => {
  vi.unstubAllGlobals();
  call.mockReset();
});
it("lets users select a real font and weight and apply text-only styling through the same MCP tool", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  call.mockImplementation(async (_name, input) => prepareCaptionStyle(input));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container),
    onChange = vi.fn();
  const style = { fontSize: 28, color: "#ffffff", background: "#151a22" };
  try {
    await act(async () =>
      root.render(
        React.createElement(CaptionStyleControls, {
          style,
          assets: [],
          onChange,
        }),
      ),
    );
    const change = async (label: string, value: string) => {
      const control = container.querySelector<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >(`[aria-label="${label}"]`)!;
      await act(async () => {
        control.value = value;
        control.dispatchEvent(
          new Event(control.tagName === "SELECT" ? "change" : "input", {
            bubbles: true,
          }),
        );
      });
    };
    await change("字幕字体", "noto-serif-sc");
    expect(onChange).toHaveBeenLastCalledWith({ fontFamily: "noto-serif-sc" });
    await change("字幕粗细", "700");
    expect(onChange).toHaveBeenLastCalledWith({ fontWeight: 700 });
    // React's native value setter is necessary to simulate typing with its value tracker.
    await act(
      async () =>
        (container.querySelector<HTMLDetailsElement>(
          ".caption-style-suggest",
        )!.open = true),
    );
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "电影感，宋体，白字，细描边，轻微阴影，无底框");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector("button")!.click());
    expect(call).toHaveBeenCalledWith(
      "caption_style_prepare",
      expect.objectContaining({
        description: expect.stringContaining("电影感"),
      }),
    );
    expect(call.mock.calls[0][1]).not.toHaveProperty("analysisAssetId");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fontFamily: "noto-serif-sc",
        strokeWidth: 1,
        shadowOpacity: 0.5,
        backgroundOpacity: 0,
      }),
    );
    expect(container.textContent).toContain("保存作品后");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
it("scales all text effects with the preview, while SRT remains separate", () => {
  const css = captionCss(
    {
      fontSize: 40,
      color: "#ffffff",
      background: "#151a22",
      fontFamily: "noto-serif-sc",
      fontWeight: 700,
      strokeWidth: 2,
      strokeColor: "#111111",
      shadowOpacity: 0.5,
      shadowOffsetX: 2,
      shadowOffsetY: 4,
      shadowBlur: 6,
      backgroundOpacity: 0,
    },
    0.5,
  );
  expect(css).toMatchObject({
    fontFamily: '"Rikoko Serif", serif',
    fontWeight: 700,
    fontSize: 20,
    WebkitTextStroke: "2px #111111",
    textShadow: "1px 2px 3px #00000080",
    backgroundColor: "#151a2200",
  });
});
