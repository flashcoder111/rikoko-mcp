// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProjectTable from "../apps/studio/src/ProjectTable";
import { api } from "../apps/studio/src/api";

vi.mock("../apps/studio/src/api", () => ({ api: vi.fn() }));
vi.mock("../apps/studio/src/Dashboard", () => ({
  MediaPreview: () => React.createElement("div", null, "预览"),
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(api).mockImplementation(async (name, input: any) => {
    if (name === "capabilities")
      return { providers: [], generation: { mode: "official" } } as any;
    const records: Record<string, any[]> = {
      project: [
        {
          id: "p",
          type: "project",
          accountId: "a",
          title: "产品广告",
          createdAt: "2026-10-29",
        },
      ],
      revision: [],
      asset: [
        {
          id: "asset",
          type: "asset",
          accountId: "a",
          kind: "image",
          name: "成片.png",
          createdAt: "2026-10-29",
        },
      ],
      job: [
        {
          id: "one",
          type: "job",
          accountId: "a",
          createdAt: "2026-10-30",
          input: {
            kind: "generate",
            prompt: "展示产品特写",
            model: "model-a",
            production: { projectId: "p" },
          },
          status: "completed",
          outputs: ["asset"],
          billingSource: "credits",
          billingStatus: "settled",
          chargedCredits: 12,
        },
        {
          id: "two",
          type: "job",
          accountId: "a",
          createdAt: "2026-10-29",
          input: { kind: "generate", prompt: "海边场景", model: "model-b" },
          status: "failed",
          outputs: [],
          billingSource: "credits",
          billingStatus: "pending",
          chargedCredits: 99,
          error: { message: "测试错误" },
        },
      ],
    };
    return records[input.type] as any;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("shows actual jobs and settled credits, expands details and filters status", async () => {
  await act(async () =>
    root.render(
      React.createElement(ProjectTable, {
        connected: true,
        onConnect: vi.fn(),
        onProject: vi.fn(),
      }),
    ),
  );
  expect(container.textContent).toContain("展示产品特写");
  expect(container.textContent).toContain("model-a");
  expect(container.textContent).toContain("12");
  expect(container.textContent).not.toContain("99");
  expect(
    container.querySelector("a[download]")?.getAttribute("href"),
  ).toContain("/api/assets/asset/file");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("海边场景"))!
      .click(),
  );
  expect(container.textContent).toContain("测试错误");
  const filter = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Filter status"]',
  )!;
  await act(async () => {
    filter.value = "completed";
    filter.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).not.toContain("海边场景");
  expect(container.textContent).toContain("展示产品特写");
});
