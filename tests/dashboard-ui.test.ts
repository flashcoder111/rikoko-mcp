// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Dashboard from "../apps/studio/src/Dashboard";
import { api } from "../apps/studio/src/api";
import {
  jobProjectId,
  outputAssets,
  type DashboardData,
} from "../apps/studio/src/dashboard-data";

vi.mock("../apps/studio/src/api", () => ({ api: vi.fn() }));
vi.mock("../apps/studio/src/media", () => ({
  useAssetUrl: () => ({ url: "blob:preview", error: "" }),
}));
let root: Root, container: HTMLDivElement;
const entity = (id: string, type: string, extra = {}) => ({
  id,
  type,
  accountId: "a",
  createdAt: "2026-10-21T08:00:00Z",
  ...extra,
});
function fixture(): DashboardData {
  return {
    projects: [entity("p", "project", { title: "咖啡广告" })],
    revisions: [entity("r", "revision", { projectId: "p" })],
    assets: [
      entity("out", "asset", { kind: "image", name: "输出图片" }),
      entity("input", "asset", { kind: "video", name: "原始参考" }),
    ],
    jobs: [
      entity("done", "job", {
        status: "completed",
        revisionId: "r",
        input: { kind: "render" },
        outputs: ["out"],
      }),
      entity("failed", "job", {
        status: "failed",
        input: { kind: "generate", production: { projectId: "p" } },
        outputs: [],
        error: { message: "供应商返回错误" },
      }),
      entity("running", "job", {
        status: "running",
        input: { kind: "generate" },
        outputs: [],
      }),
    ],
    capabilities: {
      workspace: { conversationPlanner: "local-commands" },
      providers: [],
      generation: { mode: "custom", billingSource: "external", error: null },
    },
  };
}
const props = () => ({
  connected: true,
  onConnect: vi.fn(),
  onProject: vi.fn(),
  onLibrary: vi.fn(),
  onCredits: vi.fn(),
});
function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === label,
  )!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.open = true;
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
  const data = fixture();
  vi.mocked(api).mockImplementation(async (name, input: any) => {
    if (name === "capabilities") return data.capabilities;
    return (
      {
        project: data.projects,
        revision: data.revisions,
        asset: data.assets,
        job: data.jobs,
      } as Record<string, unknown>
    )[input.type];
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("maps render and generation jobs to their project and excludes input media from outputs", () => {
  const data = fixture();
  expect(jobProjectId(data.jobs[0], data.revisions)).toBe("p");
  expect(jobProjectId(data.jobs[1], data.revisions)).toBe("p");
  expect(jobProjectId(data.jobs[2], data.revisions)).toBeUndefined();
  data.jobs.push(entity("duplicate", "job", { outputs: ["out", "missing"] }));
  expect(outputAssets(data).map((asset) => asset.id)).toEqual(["out"]);
});
it("filters tasks, exposes errors, opens the correct project and previews a downloadable output", async () => {
  const input = props();
  await act(async () => root.render(React.createElement(Dashboard, input)));
  expect(container.querySelectorAll(".dashboard-task")).toHaveLength(3);
  await act(async () => button("需要关注").click());
  expect(container.querySelectorAll(".dashboard-task")).toHaveLength(1);
  expect(container.querySelector(".dashboard-tasks")!.textContent).toContain(
    "供应商返回错误",
  );
  await act(async () => button("查看项目任务").click());
  expect(input.onProject).toHaveBeenCalledWith("p");
  await act(async () => button("已完成").click());
  await act(async () => button("查看输出").click());
  expect(container.querySelector("dialog")!.open).toBe(true);
  expect(container.querySelector("a[download]")!.getAttribute("href")).toBe(
    "blob:preview",
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!
      .click(),
  );
  expect(container.querySelector("dialog")).toBeNull();
  expect(container.textContent).not.toContain("原始参考");
});
it("retains the last successful snapshot after refresh fails instead of showing zero counts", async () => {
  await act(async () => root.render(React.createElement(Dashboard, props())));
  vi.mocked(api).mockRejectedValue(new Error("服务暂不可用"));
  await act(async () => button("刷新").click());
  expect(container.querySelector('[role="alert"]')!.textContent).toContain(
    "上次成功读取",
  );
  expect(container.querySelectorAll(".dashboard-task")).toHaveLength(3);
});
it("does not read disconnected data and discards a pending response after disconnect", async () => {
  const input = props();
  input.connected = false;
  await act(async () => root.render(React.createElement(Dashboard, input)));
  expect(api).not.toHaveBeenCalled();
  await act(async () => button("连接工作空间").click());
  expect(input.onConnect).toHaveBeenCalledOnce();
  const resolutions: (() => void)[] = [];
  const data = fixture();
  vi.mocked(api).mockImplementation(
    (name, raw: any) =>
      new Promise((done) => {
        resolutions.push(() =>
          done(
            name === "capabilities"
              ? data.capabilities
              : (
                  {
                    project: data.projects,
                    revision: data.revisions,
                    asset: data.assets,
                    job: data.jobs,
                  } as Record<string, unknown>
                )[raw.type],
          ),
        );
      }),
  );
  await act(async () =>
    root.render(React.createElement(Dashboard, { ...input, connected: true })),
  );
  await act(async () => root.render(React.createElement(Dashboard, input)));
  await act(async () => resolutions.forEach((resolve) => resolve()));
  expect(container.textContent).not.toContain("咖啡广告");
  expect(
    container.querySelectorAll(".dashboard-stats strong")[0].textContent,
  ).toBe("—");
});
