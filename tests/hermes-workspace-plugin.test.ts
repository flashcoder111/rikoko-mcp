// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

// Exercise the shipped no-build ESM plugin against the documented SDK boundary.
// Hermes supplies these three imports; the test supplies a deterministic host.
const source = readFileSync("integrations/hermes/desktop-plugin.js", "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace(/export function /g, "function ")
  .replace("export default {", "const plugin = {");
function load(host: any) {
  return new Function(
    "React",
    "host",
    "useValue",
    "ROUTES_AREA",
    `const {useEffect,useState}=React;\n${source}\nreturn {plugin,readHandoff,handoffPrompt};`,
  )(React, host, (atom: any) => atom.get(), "routes");
}
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});
it("validates link IDs and requires latest-state reads and submitted-request recovery", async () => {
  const plugin = load({});
  expect(
    plugin.readHandoff("#/rikoko-handoff?request=req&project=project"),
  ).toEqual({ request: "req", project: "project" });
  expect(
    plugin.readHandoff(
      "#/rikoko-handoff?request=bad%0Ainstruction&project=project",
    ),
  ).toBeNull();
  expect(plugin.readHandoff("#/other?request=req&project=project")).toBeNull();
  expect(
    plugin.handoffPrompt({ request: "req", project: "project" }),
  ).toContain("请求已经 submitted");
  expect(
    plugin.handoffPrompt({ request: "req", project: "project" }),
  ).toContain("workspace_snapshot");
});
it("loads the selected existing session and appends the handoff without sending or replacing its draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.location.hash = "#/rikoko-handoff?request=req&project=project";
  const host = {
    state: {
      profile: { get: () => "default" },
      connectionId: { get: () => "local" },
    },
    request: vi.fn(async () => ({
      sessions: [
        { id: "chosen", title: "原会话" },
        { id: "other", title: "其他会话" },
      ],
    })),
    openSession: vi.fn(async () => {}),
    composer: {
      insertText: vi.fn(async () => true),
      submit: vi.fn(),
      setDraft: vi.fn(),
    },
    notify: vi.fn(),
    notifyError: vi.fn(),
  };
  const loaded = load(host),
    contributions: any[] = [];
  loaded.plugin.register({
    register: (entry: any) => contributions.push(entry),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(contributions[0].render()));
    const select = container.querySelector("select")!;
    expect(select.value).toBe("");
    await act(async () => {
      select.value = "chosen";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => container.querySelector("button")!.click());
    expect(host.openSession).toHaveBeenCalledWith("chosen", {
      profile: "default",
    });
    expect(host.composer.insertText).toHaveBeenCalledWith(
      "chosen",
      loaded.handoffPrompt({ request: "req", project: "project" }),
      { mode: "block" },
    );
    expect(host.composer.submit).not.toHaveBeenCalled();
    expect(host.composer.setDraft).not.toHaveBeenCalled();
    expect(host.notifyError).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
