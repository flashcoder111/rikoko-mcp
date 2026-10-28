import { afterEach, beforeEach, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";

let db: Database,
  service: Service,
  directory: string,
  key: string,
  server: ReturnType<typeof serve>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "native-chat-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(join(directory, "assets")));
  key = (await service.createAccount("Native chat contract", 0)).key;
  server = serve({
    fetch: createApp(service).fetch,
    hostname: "127.0.0.1",
    port: 0,
  });
  if (!server.listening)
    await new Promise<void>((done) => server.once("listening", done));
});
afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

it.each(["codex", "hermes", "claude", "generic"])(
  "%s delivers completed media in the original conversation without opening embedded UI",
  async (host) => {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No test port");
    const exports = join(directory, host);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        resolve("packages/mcp/src/stdio.ts"),
      ],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        VIDEOWORKBENCH_URL: `http://127.0.0.1:${address.port}`,
        VIDEOWORKBENCH_API_KEY: key,
        VIDEOWORKBENCH_CLIENT: host,
        VIDEOWORKBENCH_EXPORT_DIR: exports,
        VIDEOWORKBENCH_IMPORT_ROOTS: JSON.stringify([directory]),
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "native-chat-test", version: "1" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.every((tool) => !tool._meta)).toBe(true);
      expect(client.getServerCapabilities()?.resources).toBeUndefined();
      expect(client.getInstructions()).toContain("in this conversation");
      expect(client.getInstructions()).toContain(
        "Deliver existing technically ready media",
      );
      for (const name of ["rikoko_create", "rikoko_resume"]) {
        const prompt = await client.getPrompt({
          name,
          arguments:
            name === "rikoko_create"
              ? { request: "Make a local clip" }
              : { projectId: "project" },
        });
        expect(JSON.stringify(prompt)).toContain(
          "workspace_result purpose=final",
        );
      }
      const committed = await client.callTool({
        name: "workspace_commit",
        arguments: {
          action: {
            type: "create",
            composition: {
              schemaVersion: 1,
              title: "Native chat contract",
              width: 360,
              height: 640,
              scenes: [{ id: "one", durationMs: 1000 }],
            },
          },
          message: "Create a local clip",
          idempotencyKey: `native-chat-${host}`,
        },
      });
      expect(committed.isError, JSON.stringify(committed.content)).not.toBe(
        true,
      );
      const command = (committed.structuredContent as any).result;
      const context = await service.authenticate(key);
      const bytes = Buffer.from("contract fixture, not an actual video");
      const asset = await service.registerAsset(context.accountId, bytes, {
        name: "result.mp4",
        kind: "video",
        mime: "video/mp4",
        metadata: {},
        provenance: { evidence: "contract-mock" },
      });
      await db.transaction(async (tx) => {
        const job = await tx.get(command.jobId);
        await tx.put({ ...job!, status: "completed", outputs: [asset.id] });
      });
      const delivered = await client.callTool({
        name: "workspace_result",
        arguments: { jobId: command.jobId, purpose: "preview" },
      });
      expect(delivered.isError).not.toBe(true);
      expect(delivered.content).toHaveLength(1);
      expect(delivered.content[0].type).toBe("text");
      const result = (delivered.structuredContent as any).result;
      expect(result.workspace).toContain("/workspace?project=");
      expect(result.media[0].assetId).toBe(asset.id);
      expect(result.textContent.title).toBe("Native chat contract");
      expect(result.outputs[0].assetId).toBe(asset.id);
      expect(result.quality.finalReady).toBe(false);
      expect(JSON.stringify(delivered.content)).not.toContain("MEDIA:");
      expect(JSON.stringify(delivered)).not.toContain("ui://");
      expect(await readdir(exports).catch(() => [])).toEqual([]);
      const final = await client.callTool({
        name: "workspace_result",
        arguments: { jobId: command.jobId, purpose: "final" },
      });
      expect(final.isError).toBe(true);

      // Explicit preview export saves inspection files and never creates another job.
      const downloaded = await client.callTool({
        name: "workspace_export",
        arguments: { jobId: command.jobId, purpose: "preview" },
      });
      expect(downloaded.isError).not.toBe(true);
      const output = (downloaded.structuredContent as any).result;
      expect(await readFile(output.media[0].localPath)).toEqual(bytes);
      expect(await service.list(context, "job")).toHaveLength(1);
    } finally {
      await client.close();
    }
  },
);
