// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  instance: undefined as any,
  callServerTool: vi.fn(),
  sendMessage: vi.fn(),
  updateModelContext: vi.fn(),
}));
vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: class {
    constructor() {
      bridge.instance = this;
    }
    callServerTool = bridge.callServerTool;
    sendMessage = bridge.sendMessage;
    updateModelContext = bridge.updateModelContext;
    connect = async () => {};
    openLink = async () => {};
  },
}));
const result = (jobId: string, status = "completed") => ({
  structuredContent: {
    result: {
      jobId,
      projectId: "same-project",
      revisionId: jobId,
      status,
      title: jobId,
      media: [],
    },
  },
});
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  bridge.sendMessage.mockResolvedValue({});
  bridge.updateModelContext.mockResolvedValue({});
  document.body.innerHTML = `
    <h2 id="title"></h2><p id="status"></p><div id="pending"></div>
    <span id="pending-label"></span><video id="video"></video>
    <img id="image"><audio id="audio"></audio><div id="files"></div>
    <button id="refresh"></button><button id="studio"></button>
    <form id="followup"><textarea id="request"></textarea>
    <button id="send"></button><textarea id="fallback" hidden></textarea></form>`;
  await import("../apps/mcp-card/src/main.js");
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
});

it("synchronizes the studio head before fetching media and returning context to the original conversation", async () => {
  bridge.instance.ontoolresult(result("old-job"));
  bridge.callServerTool
    .mockResolvedValueOnce({
      structuredContent: {
        result: {
          headRevisionId: "new-revision",
          jobs: [{ id: "new-job", revisionId: "new-revision" }],
        },
      },
    })
    .mockResolvedValueOnce(result("new-job"));
  element("refresh").click();
  await vi.waitFor(() => {
    expect(element("title").textContent).toBe("new-job");
  });
  expect(bridge.callServerTool.mock.calls.map(([request]) => request)).toEqual([
    { name: "workspace_snapshot", arguments: { projectId: "same-project" } },
    { name: "workspace_result", arguments: { jobId: "new-job" } },
  ]);
  expect(bridge.updateModelContext.mock.calls[0][0].content[0].text).toContain(
    "new-revision",
  );
  element<HTMLTextAreaElement>("request").value = "裁剪到 2 秒";
  element("followup").dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(bridge.sendMessage).toHaveBeenCalledOnce());
  const message = bridge.sendMessage.mock.calls[0][0];
  expect(message.role).toBe("user");
  expect(message.content[0].text).toContain("same-project");
  expect(message.content[0].text).toContain("裁剪到 2 秒");
  expect(message.content[0].text).toContain("workspace_snapshot");
});

it("leaves a copyable original-conversation request when the host rejects card messages", async () => {
  bridge.instance.ontoolresult(result("job"));
  bridge.sendMessage.mockResolvedValue({ isError: true });
  element<HTMLTextAreaElement>("request").value = "放大字幕";
  element("followup").dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(element("fallback").hidden).toBe(false));
  expect(element<HTMLTextAreaElement>("fallback").value).toContain("放大字幕");
  expect(element("status").textContent).not.toContain("已交给");
  expect(bridge.callServerTool).not.toHaveBeenCalled();
});

it("ignores an old poll completing after a newer tool result arrives", async () => {
  let finish!: (value: unknown) => void;
  bridge.callServerTool.mockReturnValueOnce(
    new Promise((resolve) => (finish = resolve)),
  );
  bridge.instance.ontoolresult(result("old-job", "running"));
  expect(bridge.callServerTool).toHaveBeenCalledOnce();
  bridge.instance.ontoolresult(result("new-job"));
  finish(result("old-job"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(element("title").textContent).toBe("new-job");
  expect(element<HTMLButtonElement>("refresh").disabled).toBe(false);
});
