import { createHash, randomUUID } from "node:crypto";
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
const artifact = resolve(
  process.env.RIKOKO_INSTALLATION_REPORT_DIR ?? "artifacts/installation",
);
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
const version = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
).version;
const result = await buildInstaller(
  root,
  {
    version,
    downloadBaseUrl: "https://downloads.workbench.test/releases",
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
  RIKOKO_OFFICIAL_KEY: "",
  UV_OFFLINE: "true",
  VWB_FIXTURE_URL: result.release.archiveUrl,
  VWB_FIXTURE_ARCHIVE: join(
    directory,
    `release/video-workbench-${version}.tar.gz`,
  ),
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
    parseToml(before).mcp_servers as unknown as { rikoko: HostLaunch }
  ).rikoko;
  const claude = JSON.parse(claudeBefore).mcpServers.rikoko as HostLaunch;
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
  // Preserve an existing user file, credentials and identity through an actual
  // installer upgrade and a candidate that fails after starting its backend.
  const sentinel = join(home, "data/user-sentinel.txt");
  await writeFile(sentinel, "existing user content");
  const identityBefore = await readFile(installerFile, "utf8");
  const configBefore = await readFile(join(home, "config/models.json"), "utf8");
  const keyBefore = await readFile(join(home, "data/local-admin.key"), "utf8");
  async function tool(name: string, input: unknown) {
    const response = await fetch(
      `http://127.0.0.1:${installation.port}/api/tools/${name}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${keyBefore.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok)
      throw Error(`Installed data check failed: ${response.status}`);
    return (await response.json()).result;
  }
  const originals: Array<{ type: string; record: { id: string } }> = [];
  for (const type of ["project", "revision", "asset"]) {
    for (const record of await tool("records_list", { type }))
      originals.push({ type, record });
  }
  if (
    !originals.some(({ type }) => type === "project") ||
    !originals.some(({ type }) => type === "asset")
  )
    throw Error("Missing persisted installation sample");
  async function assetHash(id: string) {
    const response = await fetch(
      `http://127.0.0.1:${installation.port}/api/assets/${id}/file`,
      {
        headers: { Authorization: `Bearer ${keyBefore.trim()}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw Error("Preserved media is inaccessible");
    return createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex");
  }
  const mediaHashes = new Map<string, string>();
  for (const { type, record } of originals)
    if (type === "asset")
      mediaHashes.set(record.id, await assetHash(record.id));
  async function assertPreserved() {
    for (const [path, value] of [
      [sentinel, "existing user content"],
      [installerFile, identityBefore],
      [join(home, "config/models.json"), configBefore],
      [join(home, "data/local-admin.key"), keyBefore],
      [join(profile, ".codex/config.toml"), before],
      [join(profile, ".claude.json"), claudeBefore],
    ])
      if ((await readFile(path, "utf8")) !== value)
        throw Error("Upgrade changed preserved user state");
    for (const { type, record } of originals) {
      if (
        JSON.stringify(await tool("record_get", { type, id: record.id })) !==
        JSON.stringify(record)
      )
        throw Error(
          "Upgrade changed an existing project, revision or asset record",
        );
    }
    for (const [id, hash] of mediaHashes)
      if ((await assetHash(id)) !== hash)
        throw Error("Upgrade changed existing media bytes");
  }
  async function candidateInstaller(label: string, fail: boolean) {
    const source = join(directory, "release/video-workbench");
    await writeFile(join(source, "upgrade-fixture.txt"), label);
    if (fail)
      await writeFile(
        join(source, "scripts/setup.ts"),
        "\nthrow Error('Intentional upgrade acceptance failure');\n",
        { flag: "a" },
      );
    const archive = join(directory, `${label}.tar.gz`);
    await run(
      "tar",
      ["-czf", archive, "-C", join(directory, "release"), "video-workbench"],
      { env: { ...process.env, COPYFILE_DISABLE: "1" } },
    );
    const release = {
      ...result.release,
      sha256: createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
    };
    const script = join(directory, `${label}.sh`);
    await writeFile(
      script,
      (await readFile(join(root, "scripts/install.sh"), "utf8")).replace(
        "__VWB_RELEASE_BASE64__",
        Buffer.from(JSON.stringify(release)).toString("base64"),
      ),
    );
    return { script, archive, release };
  }
  const upgrade = await candidateInstaller("upgrade", false);
  const upgraded = await run("bash", [upgrade.script, "--dir", home], {
    env: { ...env, VWB_FIXTURE_ARCHIVE: upgrade.archive },
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  await writeFile(
    join(artifact, "upgrade.log"),
    upgraded.stdout + upgraded.stderr,
  );
  await assertPreserved();
  if (
    JSON.parse(await readFile(join(home, ".release.json"), "utf8")).sha256 !==
    upgrade.release.sha256
  )
    throw Error("Upgrade did not activate candidate");
  const bad = await candidateInstaller("failed-upgrade", true);
  let rejected = false;
  try {
    await run("bash", [bad.script, "--dir", home], {
      env: { ...env, VWB_FIXTURE_ARCHIVE: bad.archive },
      timeout: 240_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    await writeFile(
      join(artifact, "rollback.log"),
      (e.stdout ?? "") + (e.stderr ?? ""),
    );
    if (
      !e.stderr?.includes(
        "previous program, configuration and data were restored",
      )
    )
      throw error;
    rejected = true;
  }
  if (!rejected) throw Error("Failing candidate unexpectedly succeeded");
  await assertPreserved();
  if (
    JSON.parse(await readFile(join(home, ".release.json"), "utf8")).sha256 !==
    upgrade.release.sha256
  )
    throw Error("Rollback did not restore previous release");
  await ensureBackend(installerFile);
  // Exercise the recovery CLI using a recreated interrupted-activation journal.
  // The original upgrade backup still contains the previous application/data.
  const activated = JSON.parse(
    upgraded.stdout
      .split("\n")
      .find((line) => line.startsWith('{"upgraded":true'))!,
  );
  const id = activated.backup.split("/").at(-1);
  await writeFile(
    join(home, ".upgrade.json"),
    JSON.stringify({
      schemaVersion: 1,
      id,
      token: randomUUID(),
      snapshotReady: true,
    }),
    { mode: 0o600 },
  );
  const deadOwner = (
    await run(process.execPath, ["-e", "console.log(process.pid)"])
  ).stdout.trim();
  await mkdir(join(home, ".install-lock"));
  await writeFile(join(home, ".install-lock/pid"), deadOwner);
  const recovered = await run(
    "bash",
    [upgrade.script, "--dir", home, "--recover"],
    {
      env: { ...env, VWB_FIXTURE_ARCHIVE: upgrade.archive },
      timeout: 240_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  await writeFile(
    join(artifact, "recovery.log"),
    recovered.stdout + recovered.stderr,
  );
  await assertPreserved();
  if (
    JSON.parse(await readFile(join(home, ".release.json"), "utf8")).sha256 !==
    result.release.sha256
  )
    throw Error(
      "Interrupted upgrade recovery did not restore original release",
    );
  await ensureBackend(installerFile);
  const final = {
    passed: true,
    checkedAt: new Date().toISOString(),
    transport: "local archive fixture for HTTPS download",
    dependencies:
      "isolated installation from existing package caches; system Node/uv/FFmpeg reused",
    officialAccount: "custom/local mode; no real API or payment calls",
    mcp: "real Codex and Claude Code stdio profiles; temporary client settings",
    freeRender: "real FFmpeg via installed backend",
    repeatedInstall: "idempotent",
    upgrade:
      "actual installer upgrade; existing projects, revisions, asset bytes, config, credentials and client settings preserved",
    recovery:
      "real --recover CLI with recreated interrupted journal and exited lock owner",
    rollback:
      "candidate setup failure after startup; previous application and data restored",
    platform: `${process.platform}-${process.arch}`,
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
