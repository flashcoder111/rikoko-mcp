// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import SaveTemplate from "../apps/studio/src/SaveTemplate";
const api = vi.hoisted(() => vi.fn());
vi.mock("../apps/studio/src/api", () => ({ api }));
afterEach(() => {
  api.mockReset();
  vi.unstubAllGlobals();
});
it("saves an owned revision through the editor and retains the idempotency key on network retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        React.createElement(SaveTemplate, {
          revisionId: "rev-1",
          title: "Coffee ritual",
          disabled: false,
        }),
      ),
    );
    await act(async () => el.querySelector("button")!.click());
    api
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ id: "personal-1" });
    const submit = () =>
      el
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    await act(async () => {
      submit();
    });
    expect(el.textContent).toContain("offline");
    await act(async () => {
      submit();
    });
    expect(api.mock.calls[0][1]).toEqual(api.mock.calls[1][1]);
    expect(api.mock.calls[1][1]).toMatchObject({
      revisionId: "rev-1",
      title: "Coffee ritual",
    });
    expect(el.textContent).toContain("Agent 可以检索复用");
    expect(el.querySelector("form")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});
it("prevents saving an unsaved editing draft as though it were the persisted revision", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const el = document.createElement("div");
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        React.createElement(SaveTemplate, {
          revisionId: "rev",
          title: "Draft",
          disabled: true,
        }),
      ),
    );
    expect(el.querySelector("button")!.disabled).toBe(true);
    expect(api).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
