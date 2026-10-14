import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import {
  backendUrl,
  HostConnection,
  hostCredential,
} from "../packages/mcp/src/host-connection.js";
import {
  clients,
  hostLaunch,
  mergeHostConfig,
} from "../packages/mcp/src/host-config.js";
import { allowedMediaPath, HostFiles } from "../packages/mcp/src/host-files.js";
import { resultText } from "../packages/mcp/src/presentation.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "rikoko-host-"));
  dirs.push(dir);
  return dir;
}

it("preserves existing host settings and installs four repeatable secret-free profiles", () => {
  for (const client of clients) {
    const launch = hostLaunch({
      client,
      root: "/Users/test/My Project",
      node: "/opt/bin/node",
      keychainService: "test-service",
    });
    const existing =
      client === "codex"
        ? '# keep comment\nmodel="unchanged"\n[mcp_servers.other]\ncommand="other"\n'
        : client === "hermes"
          ? "# keep comment\nmodel: unchanged\nmcp_servers:\n  other:\n    command: other\n"
          : JSON.stringify({
              model: "unchanged",
              mcpServers: { other: { command: "other" } },
            });
    const next = mergeHostConfig(client, existing, launch);
    const parsed =
      client === "codex"
        ? parseToml(next)
        : client === "hermes"
          ? parseYaml(next)
          : JSON.parse(next);
    expect(parsed.model).toBe("unchanged");
    expect((parsed.mcp_servers ?? parsed.mcpServers).other.command).toBe(
      "other",
    );
    expect((parsed.mcp_servers ?? parsed.mcpServers).rikoko.args[2]).toContain(
      "My Project/packages/mcp/src/stdio.ts",
    );
    expect(next).not.toContain("VIDEOWORKBENCH_API_KEY");
    expect(mergeHostConfig(client, next, launch)).toBe(next);
    expect(() =>
      mergeHostConfig(client, next, { ...launch, command: "/different/node" }),
    ).toThrow("differs");
  }
});

it("rejects invalid config rather than replacing it and restricts credential destinations", async () => {
  const launch = hostLaunch({
    client: "codex",
    root: "/tmp/root",
    node: "/bin/node",
  });
  expect(() =>
    mergeHostConfig("claude-desktop", "broken json", launch),
  ).toThrow();
  expect(() => mergeHostConfig("hermes", "a: 1\na: 2", launch)).toThrow();
  expect(backendUrl("http://localhost:4310")).toBe("http://localhost:4310");
  expect(backendUrl("https://video.example.com/")).toBe(
    "https://video.example.com",
  );
  for (const url of [
    "http://video.example.com",
    "https://secret@example.com",
    "https://example.com/?token=x",
    "https://example.com/redirect",
    "file:///tmp/a",
  ])
    expect(() => backendUrl(url)).toThrow();
  expect(await hostCredential({ VIDEOWORKBENCH_API_KEY: " test-key " })).toBe(
    "test-key",
  );
  await expect(hostCredential({})).rejects.toThrow("credential unavailable");
});

it("limits native imports to configured media directories, including symlink targets", async () => {
  const root = await temp(),
    allowed = join(root, "allowed"),
    elsewhere = join(root, "elsewhere");
  await mkdir(allowed);
  await mkdir(elsewhere);
  await writeFile(join(allowed, "clip.mp4"), "sample");
  await writeFile(join(elsewhere, "private.mp4"), "private");
  await writeFile(join(allowed, "config.json"), "{}");
  await symlink(join(elsewhere, "private.mp4"), join(allowed, "escape.mp4"));
  expect(
    await allowedMediaPath(join(allowed, "clip.mp4"), [allowed]),
  ).toContain("clip.mp4");
  for (const path of [
    join(allowed, "escape.mp4"),
    join(elsewhere, "private.mp4"),
    join(allowed, "config.json"),
    "clip.mp4",
  ])
    await expect(allowedMediaPath(path, [allowed])).rejects.toThrow();
});

it("uploads actual bytes and exports through authenticated owned-asset endpoints, not returned URLs", async () => {
  const root = await temp();
  const bytes = new Uint8Array([10, 20, 30, 40]);
  await writeFile(join(root, "sample.mp4"), bytes);
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("upload_create"))
      return Response.json({ result: { id: "upload-1" } });
    if (url.endsWith("uploads/upload-1"))
      return Response.json({ result: { id: "asset-1" } });
    return new Response(bytes);
  });
  const files = new HostFiles(
    new HostConnection("http://127.0.0.1:4310", "fixture-key"),
    join(root, "exports"),
    [root],
  );
  expect(
    await files.importFile({
      path: join(root, "sample.mp4"),
      license: "test",
      rightsConfirmed: true,
    }),
  ).toEqual({ id: "asset-1" });
  expect(calls[1].init?.body).toEqual(bytes);
  const exported = await files.materialize("job-1", [
    {
      assetId: "asset-1",
      url: "https://untrusted.example/steal",
      name: "../../unsafe.mp4",
      mimeType: "video/mp4",
    },
  ]);
  expect(calls.at(-1)?.url).toBe(
    "http://127.0.0.1:4310/api/assets/asset-1/file",
  );
  expect(calls.at(-1)?.init?.redirect).toBe("error");
  expect(new Headers(calls.at(-1)?.init?.headers).get("authorization")).toBe(
    "Bearer fixture-key",
  );
  expect(await readFile(exported[0].localPath!)).toEqual(Buffer.from(bytes));
  expect(exported[0].localPath).not.toContain("unsafe");
  const subtitles = await files.materialize("job-1", [
    {
      assetId: "captions",
      name: "captions.srt",
      mimeType: "text/plain",
      url: "https://media.example/subtitles",
    },
  ]);
  expect(subtitles[0].localPath).toMatch(/\.srt$/);
  await expect(files.materialize("../escape", [])).rejects.toThrow();
});

it("returns completed video with host-native attachment instructions and an optional workspace link", () => {
  const result = {
    jobId: "job",
    projectId: "project",
    revisionId: "revision",
    status: "completed",
    workspace: "http://127.0.0.1:4310/workspace?project=project",
    media: [
      {
        assetId: "asset",
        mimeType: "video/mp4",
        name: "video",
        url: "https://media.example/video",
        localPath: "/tmp/My Project/video.mp4",
      },
    ],
  };
  for (const client of ["codex", "hermes", "claude", "generic"] as const) {
    const text = resultText(result, client);
    expect(text).toContain(`[打开工作台](<${result.workspace}>)`);
    expect(text).toContain("https://media.example/video");
    expect(text).toContain("Local attachment:");
  }
  expect(resultText(result, "codex", true)).toContain(
    "![video](</tmp/My Project/video.mp4>)",
  );
  expect(resultText(result, "hermes", true)).toContain(
    "MEDIA:/tmp/My Project/video.mp4",
  );
  expect(resultText(result, "claude")).toContain("workspace_snapshot");
  expect(resultText({ jobId: "job", status: "queued" })).toContain(
    "do not submit another generation",
  );
});
