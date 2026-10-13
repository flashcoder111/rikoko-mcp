import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildInstaller } from "./build-installer.js";
import {
  ensureBackend,
  stopBackend,
} from "../packages/bootstrap/src/managed.ts";
import { readInstallation } from "../packages/bootstrap/src/config.ts";
import { parse as parseToml } from "smol-toml";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { HostLaunch } from "../packages/mcp/src/host-config.js";

const run = promisify(execFile);
const root = resolve(".");
const directory = await mkdtemp(join(tmpdir(), "vwb-one-line-"));
const artifact = resolve("artifacts/installation");
await mkdir(artifact, { recursive: true });
const home = join(directory, "installed"),
  profile = join(directory, "client-home"),
  shims = join(directory, "bin");
const installerFile = join(home, "installation.json");
await mkdir(join(profile, ".codex"), { recursive: true });
await mkdir(shims);
const shellQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
await writeFile(
  join(shims, "node"),
  `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$@"\n`,
  { mode: 0o755 },
);
await writeFile(
  join(profile, ".claude.json"),
  JSON.stringify({
    theme: "preserved",
    mcpServers: { other: { command: "other" } },
  }),
);
await writeFile(
  join(profile, ".codex/config.toml"),
  '# preserved fixture\nmodel="unchanged"\n[mcp_servers.other]\ncommand="other"\n',
);
const result = await buildInstaller(
  root,
  {
    version: "0.1.0",
    downloadBaseUrl: "https://downloads.workbench.test/releases",
    apiUrl: "https://api.workbench.test",
    templateUrl: "https://templates.workbench.test",
  },
  join(directory, "release"),
);
// Only the HTTPS download transport is a fixture. Extraction, package install,
// build, native setup, detached server, MCP protocol and FFmpeg are real.
await writeFile(
  join(shims, "curl"),
  `#!/bin/bash
set -eu
output= url=
while [ "$#" -gt 0 ]; do
  case "$1" in -o) output="$2"; shift 2 ;; https:*) url="$1"; shift ;; *) shift ;; esac
done
[ "$url" = "$VWB_FIXTURE_URL" ] || { echo "Unexpected fixture URL" >&2; exit 1; }
/bin/cp "$VWB_FIXTURE_ARCHIVE" "$output"
`,
  { mode: 0o755 },
);
await writeFile(
  join(shims, "npm"),
  `#!/bin/bash
set -eu
while [ "$#" -gt 0 ] && [ "$1" != pnpm ]; do shift; done
shift
if [ "$1" = install ]; then exec "$VWB_FIXTURE_PNPM" install --offline --frozen-lockfile; fi
exec "$VWB_FIXTURE_PNPM" "$@"
`,
  { mode: 0o755 },
);
const pnpm = (await run("which", ["pnpm"])).stdout.trim();
const env = {
  ...process.env,
  PATH: `${shims}:${process.env.PATH}`,
  VIDEOWORKBENCH_CLIENT_HOME: profile,
  HYPIT_OFFICIAL_KEY: "",
  UV_OFFLINE: "true",
  VWB_FIXTURE_URL: result.release.archiveUrl,
  VWB_FIXTURE_ARCHIVE: join(directory, "release/video-workbench-0.1.0.tar.gz"),
  VWB_FIXTURE_PNPM: pnpm,
};
try {
  const first = await run(
    "bash",
    [join(directory, "release/install.sh"), "--dir", home],
    { env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000 },
  );
  await writeFile(
    join(artifact, "first-install.log"),
    first.stdout + first.stderr,
  );
  const before = await readFile(join(profile, ".codex/config.toml"), "utf8");
  const claudeBefore = await readFile(join(profile, ".claude.json"), "utf8");
  const installation = await readInstallation(installerFile);
  await stopBackend(installerFile);
  // Start actual stdio bridges from the installed host configs, with no backend running.
  const codex = (
    parseToml(before).mcp_servers as unknown as { hypit: HostLaunch }
  ).hypit;
  const claude = JSON.parse(claudeBefore).mcpServers.hypit as HostLaunch;
  await Promise.all(
    [codex, claude, codex].map(async (launch, index) => {
      const client = new Client({
        name: `installation-check-${index}`,
        version: "1.0.0",
      });
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      try {
        await client.connect(
          new StdioClientTransport({
            ...launch,
            env: { ...inherited, ...launch.env },
            stderr: "pipe",
          }),
        );
        const response = await client.callTool({
          name: "capabilities",
          arguments: {},
        });
        if (response.isError) throw Error("Installed MCP capabilities failed");
      } finally {
        await client.close();
      }
    }),
  );
  await ensureBackend(installerFile);
  const second = await run(
    "bash",
    [join(directory, "release/install.sh"), "--dir", home],
    { env, maxBuffer: 4 * 1024 * 1024, timeout: 180_000 },
  );
  await writeFile(
    join(artifact, "repeat-install.log"),
    second.stdout + second.stderr,
  );
  if (before !== (await readFile(join(profile, ".codex/config.toml"), "utf8")))
    throw Error("Repeated install changed host settings");
  if (
    !before.includes('model="unchanged"') ||
    !before.includes("mcp_servers.other")
  )
    throw Error("Existing settings were lost");
  if (
    claudeBefore !== (await readFile(join(profile, ".claude.json"), "utf8")) ||
    JSON.parse(claudeBefore).theme !== "preserved"
  )
    throw Error("Claude Code settings were lost");
  await run(join(home, "service"), ["restart"]);
  const final = {
    passed: true,
    checkedAt: new Date().toISOString(),
    transport: "local archive fixture for HTTPS download",
    dependencies:
      "isolated installation from existing package caches; system Node/uv/FFmpeg reused",
    officialAccount: "unbound; no real API or payment calls",
    mcp: "real Codex and Claude Code stdio profiles; temporary client settings",
    freeRender: "real FFmpeg via installed backend",
    repeatedInstall: "idempotent",
    simultaneousRestart:
      "three installed MCP bridges, one backend; service wrapper restart passed",
    instanceId: installation.instanceId,
  };
  await writeFile(
    join(artifact, "results.json"),
    JSON.stringify(final, null, 2),
  );
  console.log(JSON.stringify(final, null, 2));
} catch (error) {
  const e = error as { stdout?: string; stderr?: string; message?: string };
  await writeFile(
    join(artifact, "failure.log"),
    `${e.message}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`,
  );
  throw error;
} finally {
  await stopBackend(installerFile).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
