import { it, expect } from "vitest";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";
import { readGuide } from "../packages/guidance/src/reader.js";
import { checkDirectorGuides } from "../packages/guidance/src/doctor.js";

it.each(["codex", "claude", "hermes", "generic"])(
  "%s real stdio bridge reads backend guides without any Skill directory",
  async (host) => {
    const dir = await mkdtemp(join(tmpdir(), "rikoko-stdio-guides-")),
      db = await Database.open();
    const service = new Service(db, new LocalStorage(dir));
    const { key } = await service.createAccount("Stdio guides", 0);
    const app = createApp(service);
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No test port");
    const client = new Client({ name: "stdio-guide-test", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", resolve("packages/mcp/src/stdio.ts")],
      cwd: resolve("."),
      env: {
        PATH: process.env.PATH ?? "",
        VIDEOWORKBENCH_URL: `http://127.0.0.1:${address.port}`,
        VIDEOWORKBENCH_API_KEY: key,
        VIDEOWORKBENCH_CLIENT: host,
        VIDEOWORKBENCH_IMPORT_ROOTS: "[]",
      },
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const call = async (name: string, args: Record<string, unknown>) => {
        const r = await client.callTool({ name, arguments: args });
        expect(r.isError).not.toBe(true);
        return (r.structuredContent as any).result;
      };
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(
        await checkDirectorGuides(names, await call("capabilities", {}), call),
      ).toMatchObject({
        available: true,
        source: "backend",
        skillRequired: false,
      });
      const overview = await call("rikoko_guide", { topic: "overview" });
      expect(overview).toEqual({
        ...(await readGuide({ topic: "overview" })),
        configuredHost: host,
      });
    } finally {
      await client.close();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  30000,
);
