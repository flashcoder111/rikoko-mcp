import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type Context } from "../packages/contracts/src/index.js";
import {
  publicError,
  RemoteAppError,
} from "../packages/contracts/src/error-contract.js";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";
import { createMcpServer } from "../packages/mcp/src/index.js";
import { HostConnection } from "../packages/mcp/src/host-connection.js";
import { HostFiles } from "../packages/mcp/src/host-files.js";
import { toolError } from "../packages/mcp/src/errors.js";
import { extractInspectionFrame } from "../packages/core/src/media-runtime.js";
import {
  mediaFailure,
  type MediaStage,
} from "../packages/core/src/media-diagnostics.js";

let db: Database,
  service: Service,
  dir: string,
  client: Client,
  http: ReturnType<typeof serve>,
  connection: HostConnection,
  accountId: string,
  context: Context;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rikoko-reliability-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(join(dir, "assets")));
  const account = await service.createAccount("Reliability fixture", 0);
  context = await service.authenticate(account.key);
  accountId = context.accountId;
  http = serve({
    fetch: createApp(service).fetch,
    hostname: "127.0.0.1",
    port: 0,
  });
  if (!http.listening)
    await new Promise<void>((resolve) => http.once("listening", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw Error("No HTTP port");
  connection = new HostConnection(
    `http://127.0.0.1:${address.port}`,
    account.key,
  );
  const server = createMcpServer(
    (name, input) => connection.invoke(name, input),
    {
      client: "hermes",
      files: new HostFiles(connection, join(dir, "exports"), [dir]),
    },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  client = new Client({ name: "reliability", version: "1" });
  await client.connect(a);
});
afterAll(async () => {
  await client?.close();
  if (http) await new Promise<void>((resolve) => http.close(() => resolve()));
  await db?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const plan = {
  title: "Free reliability check",
  width: 640,
  height: 640,
  shots: [
    {
      id: "shot-a",
      initialState: { lid: "open" },
      action: "Close the lid",
      endState: { lid: "closed" },
    },
  ],
};

it("runs real upload, plan validation/save/recovery, and FFmpeg inspection through MCP and HTTP", async () => {
  const runtime: any = await client.callTool({
    name: "media_runtime_check",
    arguments: {},
  });
  expect(runtime.isError, JSON.stringify(runtime)).not.toBe(true);
  expect(runtime.structuredContent.result.ready).toBe(true);
  const source = join(dir, "source");
  const png = join(dir, "fixture.png");
  await writeFile(
    source,
    Buffer.concat([Buffer.from("P6\n16 16\n255\n"), Buffer.alloc(768, 100)]),
  );
  await extractInspectionFrame(source, png, AbortSignal.timeout(25000));
  const imported: any = await client.callTool({
    name: "asset_import_file",
    arguments: {
      path: png,
      license: "Synthetic test fixture",
      rightsConfirmed: true,
    },
  });
  expect(imported.isError, JSON.stringify(imported)).not.toBe(true);
  const asset = imported.structuredContent.result;
  expect(asset.id).toBeTruthy();
  const validated: any = await client.callTool({
    name: "production_plan_validate",
    arguments: plan,
  });
  expect(validated.structuredContent.result.valid).toBe(true);
  const saved: any = await client.callTool({
    name: "production_plan_save",
    arguments: { plan },
  });
  expect(saved.isError, JSON.stringify(saved)).not.toBe(true);
  const record = saved.structuredContent.result;
  const conflict: any = await client.callTool({
    name: "production_plan_save",
    arguments: { plan, planId: record.id, expectedVersion: 99 },
  });
  expect(conflict.isError).toBe(true);
  expect(conflict.structuredContent.error).toMatchObject({
    code: "PLAN_CONFLICT",
    details: { currentVersion: 1, recordId: record.id },
    recovery: { action: "refresh_state", retrySameInput: false },
  });
  expect(JSON.parse(conflict.content[0].text).error).toEqual(
    conflict.structuredContent.error,
  );
  const current: any = await client.callTool({
    name: "record_get",
    arguments: { id: record.id, type: "production-plan" },
  });
  const updated: any = await client.callTool({
    name: "production_plan_save",
    arguments: {
      plan,
      planId: record.id,
      expectedVersion: current.structuredContent.result.version,
    },
  });
  expect(updated.structuredContent.result.version).toBe(2);
  const inspected: any = await client.callTool({
    name: "media_inspect",
    arguments: { assetId: asset.id },
  });
  expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
  expect(
    inspected.content.filter((block: any) => block.type === "image"),
  ).toHaveLength(1);
  expect(inspected.structuredContent.result.frames[0].image).toBeUndefined();
  expect(inspected.structuredContent.result.sourceSha256).toBe(asset.sha256);
  await service.storage.delete(asset.storageKey);
  const missing: any = await client.callTool({
    name: "media_inspect",
    arguments: { assetId: asset.id },
  });
  expect(missing.structuredContent.error).toMatchObject({
    code: "MEDIA_SOURCE_MISSING",
    details: { stage: "source_read", reason: "source_not_found" },
    recovery: { retrySameInput: false },
  });
  expect(JSON.stringify(missing)).not.toContain(dir);
  expect(await service.list(context, "job")).toHaveLength(0);
});

it("returns schema field paths and preserves a backend trace through the host bridge", async () => {
  try {
    await connection.invoke("production_plan_save", {
      plan: { ...plan, shots: [{ ...plan.shots[0], action: 123 }] },
    });
    throw Error("Expected validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteAppError);
    const normalized = publicError(error);
    expect(normalized.details?.issues?.[0].path).toBe("plan.shots.0.action");
    expect(normalized.recovery.retrySameInput).toBe(false);
    expect(toolError(error).structuredContent.error.traceId).toBe(
      normalized.traceId,
    );
  }
});

it("returns repairable plan continuity issues before saving invalid state", async () => {
  const invalid = {
    ...plan,
    shots: [...plan.shots, { ...plan.shots[0], id: "shot-b" }],
  };
  const validated: any = await client.callTool({
    name: "production_plan_validate",
    arguments: invalid,
  });
  expect(validated.isError).not.toBe(true);
  expect(validated.structuredContent.result).toMatchObject({
    valid: false,
    issues: [expect.objectContaining({ code: "STATE_DISCONTINUITY" })],
  });
  const failed: any = await client.callTool({
    name: "production_plan_save",
    arguments: { plan: invalid },
  });
  expect(failed.structuredContent.error).toMatchObject({
    code: "INVALID_PRODUCTION_PLAN",
    details: {
      issues: [
        expect.objectContaining({
          path: "shots.1",
          code: "STATE_DISCONTINUITY",
        }),
      ],
    },
  });
});

it("distinguishes real corrupt media decoding from a timeout", async () => {
  const bytes = Buffer.from("not a real video");
  const asset = await service.registerAsset(accountId, bytes, {
    name: "bad.mp4",
    kind: "video",
    mime: "video/mp4",
    metadata: { durationMs: 1000, fps: 25 },
    provenance: { evidence: "corrupt-test-fixture" },
  });
  const result: any = await client.callTool({
    name: "media_inspect",
    arguments: { assetId: asset.id, count: 1 },
  });
  expect(result.structuredContent.error).toMatchObject({
    code: "MEDIA_PROCESS_FAILED",
    details: { stage: "extract_frame", reason: "invalid_or_undecodable_media" },
  });
});

it.each([1.02, 2])(
  "samples video frames when audio extends the container to %s seconds",
  async (audioDuration) => {
    const path = join(dir, `audio-tail-${audioDuration}.mp4`);
    await promisify(execFile)("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=64x64:rate=24:duration=1",
      "-f",
      "lavfi",
      "-i",
      `anullsrc=r=48000:cl=mono:d=${audioDuration}`,
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      path,
    ]);
    const asset = await service.registerAsset(accountId, await readFile(path), {
      name: "audio-tail.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: { durationMs: Math.round(audioDuration * 1000), fps: 24 },
      provenance: { evidence: "local-test-fixture" },
    });
    const result: any = await client.callTool({
      name: "media_inspect",
      arguments: { assetId: asset.id, count: 3 },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(
      result.content.filter((block: any) => block.type === "image"),
    ).toHaveLength(3);
    expect(result.structuredContent.result.sampling.requestedTimesMs).toEqual([
      0, 479, 958,
    ]);
    expect(result.structuredContent.result.range.endMs).toBe(
      Math.round(audioDuration * 1000),
    );
    // Explicit event samples must never be silently moved to earlier pixels.
    const exact: any = await client.callTool({
      name: "media_inspect",
      arguments: { assetId: asset.id, timesMs: [990] },
    });
    expect(exact.structuredContent.error).toMatchObject({
      code: "MEDIA_OUTPUT_MISSING",
      details: { stage: "read_frame" },
    });
  },
);

it.each([
  [{ code: "ENOENT" }, "extract_frame", "MEDIA_DEPENDENCY_MISSING"],
  [{ code: "ENOENT" }, "source_read", "MEDIA_SOURCE_MISSING"],
  [{ code: "ENOENT" }, "read_frame", "MEDIA_OUTPUT_MISSING"],
  [{ code: "EACCES" }, "source_write", "MEDIA_PERMISSION_DENIED"],
  [{ code: "ENOSPC" }, "register_frame", "MEDIA_STORAGE_FULL"],
  [{ killed: true, signal: "SIGTERM" }, "extract_frame", "MEDIA_TIMEOUT"],
  [{ name: "AbortError" }, "gray_frame", "MEDIA_TIMEOUT"],
] as const)(
  "classifies media failures by operation stage",
  (error, stage, code) => {
    expect(mediaFailure(error, stage as MediaStage).code).toBe(code);
  },
);

it("does not expose raw stderr, commands, paths or secrets in diagnostics", () => {
  const secret = "https://user:password@private.invalid/input?token=secret";
  const error = Object.assign(new Error(secret), {
    code: 1,
    stderr: `Invalid data found ${secret} /Users/private/input`,
    cmd: secret,
  });
  const result = toolError(mediaFailure(error, "extract_frame"));
  expect(result.structuredContent.error.details).toMatchObject({
    reason: "invalid_or_undecodable_media",
    exitCode: 1,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /password|token=|Users\/private|cmd|stderr/,
  );
  expect(JSON.stringify(toolError(error))).not.toContain(secret);
  const validation = z
    .object({ shots: z.array(z.object({ action: z.string() })) })
    .safeParse({ shots: [{ action: 3 }] });
  if (validation.success) throw Error("Expected schema failure");
  expect(
    toolError(validation.error).structuredContent.error.details?.issues?.[0]
      .path,
  ).toBe("shots.0.action");
});

it("reports a missing backend FFmpeg executable and recovers after the environment is restored", async () => {
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = join(dir, "missing-bin");
    const result: any = await client.callTool({
      name: "media_runtime_check",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({
      code: "MEDIA_DEPENDENCY_MISSING",
      details: { stage: "extract_frame", systemCode: "ENOENT" },
      recovery: { retrySameInput: false },
    });
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
  const restored: any = await client.callTool({
    name: "media_runtime_check",
    arguments: {},
  });
  expect(restored.structuredContent.result.ready).toBe(true);
});

it.each(["not json", "{}", "null"])(
  "does not treat malformed backend success as a completed write: %s",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );
    try {
      const host = new HostConnection("http://127.0.0.1:1", "test-only");
      await expect(
        host.invoke("production_plan_save", { plan }),
      ).rejects.toMatchObject({ code: "BACKEND_RESPONSE_INVALID" });
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it("does not automatically replay a write after a transport failure", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValue(new Error("private connection details"));
  vi.stubGlobal("fetch", fetcher);
  try {
    const host = new HostConnection("http://127.0.0.1:1", "test-only");
    await expect(
      host.invoke("production_plan_save", { plan }),
    ).rejects.toMatchObject({ code: "BACKEND_TRANSPORT_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("identifies bridge/backend version skew without mislabeling missing assets", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "NOT_FOUND", message: "Tool not found" },
          }),
          { status: 404 },
        ),
    ),
  );
  try {
    const host = new HostConnection("http://127.0.0.1:1", "test-only");
    try {
      await host.invoke("media_runtime_check", {});
      throw Error("Expected missing backend tool");
    } catch (error) {
      expect(publicError(error)).toMatchObject({
        code: "BACKEND_TOOL_UNAVAILABLE",
        recovery: { action: "check_environment", retrySameInput: false },
      });
    }
    await expect(
      host.request("/api/assets/missing/file"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    vi.unstubAllGlobals();
  }
});
