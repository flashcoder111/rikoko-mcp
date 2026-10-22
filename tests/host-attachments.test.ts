import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseDocument } from "yaml";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import {
  hostLaunch,
  mergeHostConfig,
  readHostLaunch,
} from "../packages/mcp/src/host-config.js";
import { allowedMediaPath, HostFiles } from "../packages/mcp/src/host-files.js";
import { HostConnection } from "../packages/mcp/src/host-connection.js";
import { createMcpServer } from "../packages/mcp/src/index.js";

const directories: string[] = [];

it("exports a completed job through MCP with empty subtitles and keeps all attachments", async () => {
  const home = await mkdtemp(join(tmpdir(), "rikoko-export-"));
  directories.push(home);
  const media = [
    {
      assetId: randomUUID(),
      name: "video.mp4",
      mimeType: "video/mp4",
      url: "https://unused.test/video",
    },
    {
      assetId: randomUUID(),
      name: "captions.srt",
      mimeType: "text/plain",
      url: "https://unused.test/captions",
    },
    {
      assetId: randomUUID(),
      name: "preview.png",
      mimeType: "image/png",
      url: "https://unused.test/preview",
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(url.includes(media[1].assetId) ? "" : "fixture bytes"),
    ),
  );
  const files = new HostFiles(
    new HostConnection("http://127.0.0.1:4310", "fixture-key"),
    home,
    [],
  );
  const server = createMcpServer(
    async () => ({
      jobId: randomUUID(),
      status: "completed",
      purpose: "final",
      quality: { status: "unreviewed", finalReady: true, issues: [] },
      media,
    }),
    { client: "codex", files },
  );
  const client = new Client({ name: "export-regression", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  try {
    await client.connect(a);
    for (const name of ["workspace_export", "workspace_result"]) {
      const response = await client.callTool({
        name,
        arguments: { jobId: randomUUID() },
      });
      expect(response.isError).not.toBe(true);
      const result = (response.structuredContent as any).result;
      expect(result.deliveryWarning).toBeUndefined();
      expect(result.media).toHaveLength(3);
      expect(await readFile(result.media[0].localPath, "utf8")).toBe(
        "fixture bytes",
      );
      expect(await readFile(result.media[1].localPath, "utf8")).toBe("");
      expect(await readFile(result.media[2].localPath, "utf8")).toBe(
        "fixture bytes",
      );
    }
  } finally {
    await client.close();
    await server.close();
  }
});

it.each(["video/mp4", "audio/wav", "image/png", "application/octet-stream"])(
  "still rejects empty %s attachments",
  async (mimeType) => {
    const home = await mkdtemp(join(tmpdir(), "rikoko-empty-media-"));
    directories.push(home);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("")),
    );
    const files = new HostFiles(
      new HostConnection("http://127.0.0.1:4310", "fixture-key"),
      home,
      [],
    );
    await expect(
      files.materialize(randomUUID(), [
        {
          assetId: randomUUID(),
          name: "captions.srt",
          mimeType,
          url: "https://unused.test/file",
        },
      ]),
    ).rejects.toThrow("Empty media response");
  },
);
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "rikoko-attachments-"));
  directories.push(home);
  const launch = hostLaunch({
    client: "hermes",
    root: join(home, "project"),
    node: process.execPath,
    home,
    platform: "darwin",
  });
  const roots: string[] = JSON.parse(launch.env.VIDEOWORKBENCH_IMPORT_ROOTS);
  const attachment = join(roots[2], "image with spaces.png");
  await mkdir(roots[2], { recursive: true });
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(attachment, bytes);
  return { home, launch, roots, attachment, bytes };
}

it("adds only the macOS Hermes attachment directory using the selected client home", () => {
  const options = {
    root: "/project",
    node: "/bin/node",
    home: "/Users/target",
  };
  for (const client of [
    "hermes",
    "codex",
    "claude-code",
    "claude-desktop",
  ] as const) {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const roots = JSON.parse(
        hostLaunch({ ...options, client, platform }).env
          .VIDEOWORKBENCH_IMPORT_ROOTS,
      );
      expect(roots).toEqual([
        platform === "win32" ? "\\project\\artifacts" : "/project/artifacts",
        platform === "win32" ? "\\project\\media-inbox" : "/project/media-inbox",
        ...(client === "hermes" && platform === "darwin"
          ? ["/Users/target/Library/Application Support/Hermes/composer-images"]
          : []),
      ]);
    }
  }
});

it("migrates only legacy Hermes roots while preserving comments, timeouts and other servers", async () => {
  const { launch, roots } = await fixture();
  const legacy = {
    ...launch,
    env: {
      ...launch.env,
      VIDEOWORKBENCH_IMPORT_ROOTS: JSON.stringify(roots.slice(0, 2)),
    },
  };
  const doc = parseDocument(
    mergeHostConfig(
      "hermes",
      "# keep this\nmcp_servers:\n  other:\n    command: other\n",
      legacy,
    ),
  );
  doc.setIn(["mcp_servers", "rikoko", "timeout"], 987);
  const before = doc.toString();
  const next = mergeHostConfig("hermes", before, launch);
  const data = parseDocument(next).toJS();
  expect(next).toContain("# keep this");
  expect(data.mcp_servers.other).toEqual({ command: "other" });
  expect(data.mcp_servers.rikoko.timeout).toBe(987);
  expect(readHostLaunch("hermes", next)).toEqual(launch);
  expect(mergeHostConfig("hermes", next, launch)).toBe(next);
  expect(() =>
    mergeHostConfig("hermes", before, { ...launch, command: "/other/node" }),
  ).toThrow("differs");
  expect(() =>
    mergeHostConfig("hermes", before, {
      ...launch,
      env: { ...launch.env, VIDEOWORKBENCH_URL: "https://other.example" },
    }),
  ).toThrow("differs");
});

it("does not silently broaden a custom or explicitly empty allowlist", async () => {
  const { launch, roots } = await fixture();
  for (const custom of [
    [],
    [roots[1]],
    [...roots.slice(0, 2), "/custom/media"],
  ]) {
    const previous = {
      ...launch,
      env: {
        ...launch.env,
        VIDEOWORKBENCH_IMPORT_ROOTS: JSON.stringify(custom),
      },
    };
    const existing = mergeHostConfig("hermes", "", previous);
    expect(() => mergeHostConfig("hermes", existing, launch)).toThrow(
      "differs",
    );
    expect(
      JSON.parse(
        readHostLaunch("hermes", existing)!.env.VIDEOWORKBENCH_IMPORT_ROOTS,
      ),
    ).toEqual(custom);
  }
});

it.each(["hermes", "codex", "claude-code", "claude-desktop"] as const)(
  "reads the actual %s launch for diagnostics and rejects malformed entries",
  (client) => {
    const launch = hostLaunch({
      client,
      root: "/installed",
      node: "/installed/node",
    });
    launch.env.VIDEOWORKBENCH_IMPORT_ROOTS = '["/custom/media"]';
    expect(readHostLaunch(client, mergeHostConfig(client, "", launch))).toEqual(
      launch,
    );
    expect(readHostLaunch(client, "")).toBeUndefined();
    expect(() => readHostLaunch(client, "invalid [")).toThrow();
  },
);

it("allows an existing root when another configured directory has not been created", async () => {
  const { roots, attachment } = await fixture();
  await expect(allowedMediaPath(attachment, roots)).resolves.toBe(
    await realpath(attachment),
  );
  await mkdir(roots[1], { recursive: true });
  await writeFile(join(roots[1], "clip.mp4"), "sample");
  await rm(roots[2], { recursive: true });
  await expect(
    allowedMediaPath(join(roots[1], "clip.mp4"), roots),
  ).resolves.toBe(await realpath(join(roots[1], "clip.mp4")));
});

it("returns recovery instructions and continues blocking sibling paths and escaping symlinks", async () => {
  const { home, roots, attachment } = await fixture();
  const outside = join(home, "private.png");
  await writeFile(outside, "private");
  const sibling = roots[2] + "-other";
  await mkdir(sibling);
  await writeFile(join(sibling, "private.png"), "private");
  const link = join(roots[2], "escape.png");
  await symlink(outside, link);
  for (const file of [outside, link, join(sibling, "private.png")]) {
    await expect(allowedMediaPath(file, roots)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("reload the host's MCP connection"),
    });
  }
  await expect(allowedMediaPath(outside, roots)).rejects.toThrow(roots[1]);
  await expect(allowedMediaPath(attachment, [])).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    allowedMediaPath(attachment, ["relative"]),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(
    allowedMediaPath(join(roots[2], "missing.png"), roots),
  ).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: expect.stringContaining("Attach it again"),
  });
});

it("imports Hermes attachment bytes over MCP and exposes actionable failures without uploading rejected files", async () => {
  const { home, roots, attachment, bytes } = await fixture();
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
    Response.json({
      result: {
        id: url.endsWith("upload_create") ? "upload-fixture" : "asset-fixture",
      },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const files = new HostFiles(
    new HostConnection("http://127.0.0.1:4310", "fixture-key"),
    join(home, "exports"),
    roots,
  );
  const server = createMcpServer(async () => ({}), { client: "hermes", files });
  const client = new Client({ name: "hermes-attachment-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(
      tools.tools.find((tool) => tool.name === "asset_import_file")
        ?.description,
    ).toContain(roots[2]);
    const input = {
      path: attachment,
      license: "test fixture",
      rightsConfirmed: true,
    };
    const result = await client.callTool({
      name: "asset_import_file",
      arguments: input,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      result: { id: "asset-fixture" },
    });
    expect(fetcher.mock.calls[1][1]?.body).toEqual(new Uint8Array(bytes));
    fetcher.mockClear();
    const denied = join(home, "outside.png");
    await writeFile(denied, bytes);
    const error = await client.callTool({
      name: "asset_import_file",
      arguments: { ...input, path: denied },
    });
    expect(error.isError).toBe(true);
    expect(JSON.stringify(error.content)).toContain("Configured directories:");
    expect(JSON.stringify(error.content)).toContain(
      "VIDEOWORKBENCH_IMPORT_ROOTS",
    );
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await server.close();
  }
});
