import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createApp } from "../apps/server/src/app.js";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { updateChecker } from "../packages/core/src/update-check.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createMcpServer } from "../packages/mcp/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";

it("requires authentication and exposes the same read-only status over HTTP and MCP without jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rikoko-update-test-"));
  const db = await Database.open();
  const service = new Service(db, new LocalStorage(dir));
  const account = await service.createAccount("Update test", 0);
  const context = await service.authenticate(account.key);
  const app = createApp(service);
  const expected = {
    ...updateChecker.snapshot(),
    status: "unavailable" as const,
    errorCode: "http" as const,
  };
  const check = vi.spyOn(updateChecker, "check").mockResolvedValue(expected);
  const server = createMcpServer((name, input) =>
    callTool(service, context, name, input),
  );
  const client = new Client({ name: "update-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const request = (key?: string) =>
    app.request("http://localhost/api/tools/update_check", {
      method: "POST",
      headers: {
        Host: "localhost",
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ force: true }),
    });
  try {
    expect((await request()).status).toBe(401);
    expect(check).not.toHaveBeenCalled();
    const http = await request(account.key);
    expect(http.status).toBe(200);
    expect((await http.json()).result).toEqual(expected);
    expect(check).toHaveBeenCalledWith(true);
    await server.connect(st);
    await client.connect(ct);
    const tool = (await client.listTools()).tools.find(
      (item) => item.name === "update_check",
    );
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    });
    const result = await client.callTool({
      name: "update_check",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ result: expected });
    expect(check).toHaveBeenLastCalledWith(false);
    expect(client.getInstructions()).toContain("call update_check once");
    await service.scoped(context, "read", async (tx) => {
      expect(await tx.list(context.accountId, "job")).toHaveLength(0);
    });
  } finally {
    check.mockRestore();
    await client.close();
    await server.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
