// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Credits from "../apps/studio/src/Credits";
import ManagementApp, {
  managementRoute,
} from "../apps/studio/src/ManagementApp";
import { api } from "../apps/studio/src/api";

vi.mock("../apps/studio/src/api", () => ({
  api: vi.fn(),
  statusLabels: { completed: "已完成" },
}));
vi.mock("../apps/studio/src/Dashboard", () => ({
  default: ({ onProject }: { onProject: (id: string) => void }) =>
    React.createElement(
      "button",
      { onClick: () => onProject("p") },
      "查看项目任务",
    ),
}));
vi.mock("../apps/studio/src/AssetLibrary", () => ({
  default: () => React.createElement("p", null, "素材管理"),
}));
vi.mock("../apps/studio/src/ProjectTable", () => ({
  default: ({ onProject }: { onProject: (id: string) => void }) =>
    React.createElement(
      "button",
      { onClick: () => onProject("p") },
      "查看项目任务",
    ),
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ connected: true }) })),
  );
  history.replaceState({}, "", "/");
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
it("routes old creation URLs to management views, preserving project context", () => {
  for (const path of ["/chat", "/workspace", "/?request=r"])
    expect(managementRoute(new URL(path, "http://localhost")).view).toBe(
      "overview",
    );
  for (const path of [
    "/workspace?project=p&revision=r",
    "/chat?project=p",
    "/?project=p",
  ])
    expect(managementRoute(new URL(path, "http://localhost"))).toEqual({
      view: "tasks",
      projectId: "p",
    });
  expect(managementRoute(new URL("http://localhost/plans")).view).toBe(
    "credits",
  );
  expect(managementRoute(new URL("http://localhost/tools")).view).toBe(
    "credits",
  );
  expect(managementRoute(new URL("http://localhost/recharge")).view).toBe(
    "recharge",
  );
});
it("offers only management navigation and opens projects as task records", async () => {
  await act(async () => root.render(React.createElement(ManagementApp)));
  expect(
    [...container.querySelectorAll("nav a")].map((a) => a.textContent),
  ).toEqual([
    "Projects",
    "Media library",
    "Templates",
    "Downloads",
    "Credits & usage",
    "Add credits",
  ]);
  expect(container.textContent).not.toMatch(
    /新建作品|开始创作|编辑器|官方综合套餐/,
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "查看项目任务")!
      .click(),
  );
  expect(location.pathname).toBe("/tasks");
  expect(location.search).toBe("?project=p");
});
it("opens recharge information and links to the official pricing page", async () => {
  await act(async () => root.render(React.createElement(ManagementApp)));
  const entry = container.querySelector<HTMLAnchorElement>(
    ".management-recharge",
  )!;
  await act(async () => entry.click());
  expect(location.pathname).toBe("/recharge");
  expect(container.textContent).toContain("purchasing is not open yet");
  const plans = [...container.querySelectorAll<HTMLElement>(".recharge-plan")];
  expect(
    plans.map((plan) => [
      plan.querySelector("h3")?.textContent,
      plan.querySelector(".recharge-price")?.textContent,
      plan.querySelector(".recharge-plan-credits")?.textContent,
    ]),
  ).toEqual([
    ["Starter", "$9.90 / month", "1,800 credits / month"],
    ["Pro", "$49.90 / month", "10,000 credits / month"],
    ["Ultra", "$129.90 / month", "27,000 credits / month"],
  ]);
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>(".recharge-period button")]
      .find((button) => button.textContent === "Yearly")!
      .click(),
  );
  expect(plans[1].textContent).toContain("$39.90");
  expect(plans[1].textContent).toContain("$478.80");
  expect(plans[2].textContent).toContain("$1,198.80");
  expect(plans.every((plan) => plan.querySelector("button")?.disabled)).toBe(
    true,
  );
  const packs = [...container.querySelectorAll<HTMLElement>(".recharge-pack")];
  expect(
    packs.map((pack) => [
      pack.querySelector("h3")?.textContent,
      pack.querySelector(".recharge-price")?.textContent,
    ]),
  ).toEqual([
    ["2,000 credits", "$15.00 USD"],
    ["5,000 credits", "$35.00 USD"],
    ["10,000 credits", "$65.00 USD"],
    ["20,000 credits", "$130.00 USD"],
  ]);
  expect(packs.every((pack) => pack.querySelector("button")?.disabled)).toBe(
    true,
  );
  const link = [...container.querySelectorAll("a")].find((a) =>
    a.textContent?.includes("View official pricing"),
  );
  expect(link?.href).toBe("https://rikoko.ai/commercial/pricing/");
});
it("connects automatically on first open and reconnects after a session expires", async () => {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ connected: url !== "/auth/session" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(React.createElement(ManagementApp)));
  expect(fetchMock).toHaveBeenCalledWith("/auth/local-session", {
    method: "POST",
  });
  expect(container.textContent).toContain("Connected");
  expect(container.querySelector('input[type="password"]')).toBeNull();
  await act(async () => window.dispatchEvent(new Event("session-expired")));
  expect(
    fetchMock.mock.calls.filter(([url]) => url === "/auth/local-session"),
  ).toHaveLength(2);
  expect(container.textContent).toContain("Connected");
});
it("retains manual authentication when local automatic connection is unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/auth/local-session"
        ? { ok: false, status: 404 }
        : { ok: true, status: 200, json: async () => ({ connected: false }) },
    ),
  );
  await act(async () => root.render(React.createElement(ManagementApp)));
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Connect workspace")!
      .click(),
  );
  expect(container.querySelector('input[type="password"]')).not.toBeNull();
});
it("uses explicit official credits and preserves a real zero without converting dollars", async () => {
  vi.mocked(api).mockResolvedValue({
    mode: "official",
    availableCredits: 0,
    reservedCredits: 20,
    balanceCredits: 20,
    availableCents: 9999,
    charges: [
      {
        jobId: "j",
        model: "MiniMax",
        status: "completed",
        chargedCredits: 3.5,
        chargedCents: 5,
        createdAt: "2026-10-21T08:00:00Z",
      },
    ],
  });
  await act(async () =>
    root.render(
      React.createElement(Credits, { connected: true, onConnect: vi.fn() }),
    ),
  );
  expect(
    [...container.querySelectorAll(".credits-stats strong")].map(
      (e) => e.textContent,
    ),
  ).toEqual(["0", "20", "20"]);
  expect(container.textContent).toContain("3.5 credits");
  expect(container.textContent).not.toContain("US$99.99");
});
it("labels cents-only responses as dollar allowance and does not mislabel custom-provider balances", async () => {
  vi.mocked(api).mockResolvedValue({
    mode: "official",
    availableCents: 450,
    reservedCents: 50,
    balanceCents: 500,
  });
  await act(async () =>
    root.render(
      React.createElement(Credits, { connected: true, onConnect: vi.fn() }),
    ),
  );
  expect(container.textContent).toContain("US$4.50");
  expect(container.textContent).toContain("no credit balance");
  expect(container.textContent).not.toContain("Available credits");
  vi.mocked(api).mockResolvedValue({ mode: "custom", availableCents: 999999 });
  await act(async () =>
    root.render(
      React.createElement(Credits, {
        key: "custom",
        connected: true,
        onConnect: vi.fn(),
      }),
    ),
  );
  expect(container.textContent).toContain("Using your own model provider");
  expect(container.querySelector(".credits-stats")).toBeNull();
});
it("shows failures without inventing a zero balance, and clears data on disconnect", async () => {
  vi.mocked(api).mockRejectedValue(new Error("余额服务暂不可用"));
  await act(async () =>
    root.render(
      React.createElement(Credits, { connected: true, onConnect: vi.fn() }),
    ),
  );
  expect(container.querySelector('[role="alert"]')!.textContent).toContain(
    "余额服务暂不可用",
  );
  expect(container.querySelector(".credits-stats")).toBeNull();
  vi.mocked(api).mockResolvedValue({
    mode: "official",
    availableCredits: 120,
    reservedCredits: 0,
    balanceCredits: 120,
  });
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Retry")!
      .click(),
  );
  expect(container.textContent).toContain("120");
  await act(async () =>
    root.render(
      React.createElement(Credits, { connected: false, onConnect: vi.fn() }),
    ),
  );
  expect(container.textContent).not.toContain("120");
  expect(container.querySelector(".credits-stats")).toBeNull();
});
