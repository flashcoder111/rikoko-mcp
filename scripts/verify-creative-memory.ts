/** Real HTTP/MCP + process restart check. Uses disposable local data and no providers. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "rikoko-memory-runtime-"));
let child: ChildProcess | undefined;
let client: Client | undefined;
async function start() {
  // Intentionally do not inherit credentials, remote database URLs or paid model configuration.
  const processChild = spawn(
    process.execPath,
    ["--import", "tsx", "apps/server/src/index.ts"],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DATA_DIR: dir,
        HOST: "127.0.0.1",
        PORT: "0",
        ENABLE_PAID_PROVIDERS: "false",
        ENABLE_CREATIVE_AGENT: "false",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  child = processChild;
  const origin = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Local startup timed out")),
      15000,
    );
    let buffer = "";
    processChild.stderr!.on("data", (chunk) => {
      buffer = (buffer + String(chunk)).slice(-4096);
      const match = buffer.match(/rikoko: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    processChild.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    processChild.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Local server exited: ${code}`));
    });
  });
  const key = (await readFile(join(dir, "local-admin.key"), "utf8")).trim();
  client = new Client({ name: "local-memory-verifier", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
}
async function stop() {
  await client?.close();
  client = undefined;
  const running = child;
  child = undefined;
  if (!running || running.exitCode !== null || running.signalCode !== null)
    return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => running.kill("SIGKILL"), 5000);
    running.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    running.kill("SIGTERM");
  });
}
async function call(name: string, input: Record<string, unknown>) {
  const result = await client!.callTool({ name, arguments: input });
  assert.ok(!result.isError, `Tool failed: ${name}`);
  return (result.structuredContent as { result: Record<string, any> }).result;
}
try {
  await start();
  const tools = await client!.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "rule_upsert"));
  const source = {
    kind: "user_instruction",
    text: "验证：以后口播字幕最多两行",
  };
  const saved = await call("rule_set_save", {
    name: "本地验证规范",
    source,
    idempotencyKey: "set",
  });
  const rule = await call("rule_upsert", {
    ruleSetId: saved.record.id,
    definition: { target: "captions.maxLines", operator: "lte", value: 2 },
    source,
    idempotencyKey: "rule",
  });
  const before = await call("creative_context_resolve", {
    taskKind: "talking_head",
  });
  assert.equal(before.rules[0].id, rule.record.id);
  await stop();
  await start();
  const recovered = await call("memory_get", { id: rule.record.id });
  assert.equal(recovered.definition.value, 2);
  const changed = await call("rule_upsert", {
    id: recovered.id,
    expectedVersion: recovered.version,
    definition: { target: "captions.maxLines", operator: "lte", value: 1 },
    source,
    idempotencyKey: "update",
  });
  assert.equal(changed.record.version, 2);
  const after = await call("creative_context_resolve", {
    taskKind: "talking_head",
  });
  assert.equal(after.rules[0].definition.value, 1);
  assert.notEqual(after.id, before.id);
  assert.equal((await call("records_list", { type: "job" })).length, 0);
  console.log(
    "PASS: real local MCP discovery, rule creation, process restart recovery, incremental update and versioned context; zero media jobs.",
  );
} finally {
  await stop();
  await rm(dir, { recursive: true, force: true });
}
