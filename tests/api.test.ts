import { beforeEach, afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";
import { assertPublicIp } from "../packages/storage/src/download.js";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
let db: Database,
  dir: string,
  key: string,
  service: Service,
  app: ReturnType<typeof createApp>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "api-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  key = (await service.createAccount("API", 0)).key;
  app = createApp(service);
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
it("protects APIs, origins, hosts and malformed bodies", async () => {
  expect(
    (
      await app.request("http://localhost/api/tools/usage_get", {
        method: "POST",
        headers: { Host: "localhost" },
        body: "{}",
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await app.request("http://evil.test/health", {
        headers: { Host: "evil.test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request("http://localhost/health", {
        headers: { Host: "localhost", Origin: "https://evil.test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request("http://localhost/api/tools/project_create", {
        method: "POST",
        headers: {
          Host: "localhost",
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: '{"title":""}',
      })
    ).status,
  ).toBe(400);
});
it("discovers and calls tools through the real MCP v2 client", async () => {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost/mcp"),
    {
      requestInit: {
        headers: { Host: "localhost", Authorization: `Bearer ${key}` },
      },
      fetch: async (input, init) => app.fetch(new Request(input, init)),
    },
  );
  const client = new Client({ name: "acceptance-client", version: "1.0.0" });
  await client.connect(transport);
  expect(client.getInstructions()).toContain("/rikoko help");
  const capabilities = await client.callTool({
    name: "capabilities",
    arguments: {},
  });
  const catalog = (capabilities.structuredContent as any).result;
  expect(catalog.commands.agentEntry).toBe("/rikoko");
  expect(catalog.commands.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "model" }),
      expect.objectContaining({ name: "reference" }),
    ]),
  );
  expect(catalog.commands.selectionIsConsent).toBe(false);
  expect(catalog.providers).toEqual([]);
  const list = await client.listTools();
  expect(list.tools.some((t) => t.name === "job_submit")).toBe(true);
  expect(list.tools.every((t) => !t._meta)).toBe(true);
  expect(client.getServerCapabilities()?.resources).toBeUndefined();
  const result = await client.callTool({
    name: "project_create",
    arguments: { title: "MCP real client" },
  });
  expect(result.isError).not.toBe(true);
  expect(JSON.stringify(result)).toContain("MCP real client");
  const committed = await client.callTool({
    name: "workspace_commit",
    arguments: {
      message: "Through MCP",
      idempotencyKey: "mcp-create",
      action: {
        type: "create",
        composition: {
          schemaVersion: 1,
          title: "Native conversation",
          width: 360,
          height: 640,
          language: "en",
          scenes: [{ id: "one", durationMs: 1000 }],
        },
      },
    },
  });
  expect(committed.isError).not.toBe(true);
  const command = (committed.structuredContent as any).result;
  expect(command.conversation).toBeUndefined();
  expect(JSON.stringify(committed.content)).toContain("[Open workspace]");
  const asset = await service.registerAsset(
    (await service.authenticate(key)).accountId,
    new Uint8Array([1]),
    {
      name: "MCP output.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: {},
      provenance: { evidence: "contract-mock" },
    },
  );
  await db.transaction(async (tx) => {
    const job = await tx.get(command.jobId);
    await tx.put({ ...job!, status: "completed", outputs: [asset.id] });
  });
  const delivered = await client.callTool({
    name: "workspace_result",
    arguments: { jobId: command.jobId, purpose: "preview" },
  });
  expect(delivered.content).toHaveLength(1);
  expect(delivered.content[0].type).toBe("text");
  const output = (delivered.structuredContent as any).result;
  expect(output.workspace).toBe(command.workspace);
  expect(output.media[0].assetId).toBe(asset.id);
  expect(output.conversation).toBeUndefined();
  expect(output.outputs).toEqual([
    { assetId: asset.id, name: "MCP output.mp4", mimeType: "video/mp4" },
  ]);
  expect(JSON.stringify(delivered.content)).toContain("Preview —");
  expect(JSON.stringify(delivered)).toContain("/delivery/");
  const snapshot = await client.callTool({
    name: "workspace_snapshot",
    arguments: { projectId: command.projectId },
  });
  expect((snapshot.structuredContent as any).result.links).toEqual({
    workspace: command.workspace,
  });
  await client.close();
});
it("blocks private IPv4, IPv6, mapped addresses and special ranges", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.2",
    "192.168.1.4",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "100.64.0.1",
  ])
    expect(() => assertPublicIp(ip)).toThrow();
  expect(() => assertPublicIp("1.1.1.1")).not.toThrow();
});
