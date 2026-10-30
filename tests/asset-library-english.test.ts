// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import AssetLibrary from "../apps/studio/src/AssetLibrary";
import { api } from "../apps/studio/src/api";

vi.mock("../apps/studio/src/api", () => ({ api: vi.fn() }));
vi.mock("../apps/studio/src/media", () => ({ AssetThumb: () => null }));

it("displays English category labels while keeping stored category values compatible", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(api).mockResolvedValue({});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        React.createElement(AssetLibrary, {
          assets: [
            {
              id: "asset",
              accountId: "a",
              type: "asset",
              createdAt: "2026-10-30",
              kind: "image",
              name: "Photo",
              library: { category: "商品", favorite: false, tags: [] },
            },
          ],
          onRefresh: async () => {},
          onUpload: () => {},
        }),
      ),
    );
    expect(container.textContent).toContain("Products");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Organize")!
        .click(),
    );
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Media category"]',
    )!;
    await act(async () => {
      select.value = "人物";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector<HTMLFormElement>(".asset-organize-form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(api).toHaveBeenCalledWith(
      "asset_organize",
      expect.objectContaining({
        library: expect.objectContaining({ category: "人物" }),
      }),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  }
});
