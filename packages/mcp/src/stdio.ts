import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./index.js";
import { resolve } from "node:path";
import { z } from "zod";
import { HostConnection, hostCredential } from "./host-connection.js";
import { HostFiles } from "./host-files.js";
import { ensureBackend } from "../../bootstrap/src/managed.ts";
try {
  if (process.env.VIDEOWORKBENCH_MANAGED_CONFIG) {
    const managed = await ensureBackend(
      process.env.VIDEOWORKBENCH_MANAGED_CONFIG,
    );
    if (
      process.env.VIDEOWORKBENCH_URL &&
      process.env.VIDEOWORKBENCH_URL !== managed.url
    )
      throw Error("Managed backend URL differs from MCP configuration");
    process.env.VIDEOWORKBENCH_URL = managed.url;
  }
  const connection = new HostConnection(
    process.env.VIDEOWORKBENCH_URL ?? "http://127.0.0.1:4310",
    await hostCredential(),
  );
  const client = z
    .enum(["codex", "hermes", "claude", "generic"])
    .parse(process.env.VIDEOWORKBENCH_CLIENT ?? "generic");
  const roots = z
    .array(z.string())
    .parse(JSON.parse(process.env.VIDEOWORKBENCH_IMPORT_ROOTS ?? "[]"));
  const files = process.env.VIDEOWORKBENCH_EXPORT_DIR
    ? new HostFiles(
        connection,
        resolve(process.env.VIDEOWORKBENCH_EXPORT_DIR),
        roots,
      )
    : undefined;
  await serveStdio(() =>
    createMcpServer((name, input) => connection.invoke(name, input), {
      client,
      files,
      resourceOrigin: process.env.PUBLIC_BASE_URL ?? connection.base,
    }),
  );
} catch {
  console.error(
    "Hypit MCP could not start. Check the client credential, URL and directory configuration. Run pnpm clients doctor.",
  );
  process.exitCode = 1;
}
