import { expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMcpServer } from "../packages/mcp/src/index.js";
import { tools } from "../packages/mcp/src/tools.js";

it("routes the only guide tool to the configured backend without a local skill", async () => {
  const invoke = vi.fn(async () => ({
    topic: "overview",
    markdown: "Backend director guide",
    source: "backend",
  }));
  const server = createMcpServer(invoke, { client: "codex" });
  const client = new Client({ name: "mcp-only", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    expect(
      (await client.listTools()).tools.filter((t) => t.name === "rikoko_guide"),
    ).toHaveLength(1);
    const result = await client.callTool({
      name: "rikoko_guide",
      arguments: { topic: "overview" },
    });
    expect(invoke).toHaveBeenCalledWith("rikoko_guide", { topic: "overview" });
    expect(result.structuredContent).toMatchObject({
      result: { markdown: "Backend director guide", configuredHost: "codex" },
    });
    expect(client.getInstructions()!.length).toBeLessThan(7800);
    expect(client.getInstructions()).toContain("creative decisions");
  } finally {
    await client.close();
    await server.close();
  }
});
it("exposes guidance through the same backend tool registry as HTTP", () => {
  expect(Object.hasOwn(tools, "rikoko_guide")).toBe(true);
});

it("serves identical authenticated HTTP and bridged guides with no jobs or purchases", async () => {
  const { Database } = await import("../packages/db/src/index.js");
  const { Service } = await import("../packages/core/src/index.js");
  const { LocalStorage } = await import("../packages/storage/src/index.js");
  const { createApp } = await import("../apps/server/src/app.js");
  const { HostConnection } =
    await import("../packages/mcp/src/host-connection.js");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "guide-api-")),
    db = await Database.open();
  const svc = new Service(db, new LocalStorage(dir));
  const account = await svc.createAccount("Guide", 0);
  const c = await svc.authenticate(account.key);
  const app = createApp(svc);
  const request = (key?: string) =>
    app.request("http://localhost/api/tools/rikoko_guide", {
      method: "POST",
      headers: {
        Host: "localhost",
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ topic: "overview" }),
    });
  try {
    expect((await request()).status).toBe(401);
    const response = await request(account.key);
    expect(response.status).toBe(200);
    const direct = (await response.json()).result;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) =>
        app.fetch(
          new Request(input, {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers)),
              Host: "localhost",
            },
          }),
        ),
    );
    const bridge = new HostConnection("http://localhost", account.key);
    expect(await bridge.invoke("rikoko_guide", { topic: "overview" })).toEqual(
      direct,
    );
    await svc.scoped(c, "read", async (tx) => {
      expect(await tx.list(c.accountId, "job")).toHaveLength(0);
      expect(await tx.list(c.accountId, "quote")).toHaveLength(0);
    });
  } finally {
    vi.unstubAllGlobals();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
