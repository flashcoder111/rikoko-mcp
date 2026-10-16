import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  validateRelease,
  initializeInstallation,
  readPrivateJson,
  bindOfficialKey,
} from "../packages/bootstrap/src/config.ts";
import {
  ensureBackend,
  managedEnvironment,
  stopBackend,
} from "../packages/bootstrap/src/managed.ts";
import { hostCredential } from "../packages/mcp/src/host-connection.js";
import { hostLaunch } from "../packages/mcp/src/host-config.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
const release = {
  version: "0.1.0",
  archiveUrl: "https://download.workbench.test/video-workbench.tar.gz",
  sha256: "a".repeat(64),
  apiUrl: "https://api.workbench.test",
  templateUrl: "https://templates.workbench.test",
};
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "vwb-install-"));
  dirs.push(home);
  return initializeInstallation({
    home,
    root: join(home, "app"),
    release,
    node: process.execPath,
    python: "/fixture/python",
    path: "/fixture/bin:/usr/bin",
  });
}

it("rejects placeholder endpoints, unsafe downloads and invalid release hashes before installation", () => {
  expect(validateRelease(release)).toEqual(release);
  for (const change of [
    { apiUrl: "https://api.example.com" },
    { apiUrl: "http://api.workbench.test" },
    { apiUrl: "https://secret@api.workbench.test" },
    { apiUrl: "https://api.workbench.test/v1" },
    { archiveUrl: "file:///tmp/source.tar.gz" },
    { archiveUrl: "https://download.workbench.test/a?key=secret" },
    { sha256: "unverified" },
    { version: "../../escape" },
  ])
    expect(() => validateRelease({ ...release, ...change })).toThrow();
});

it("defaults to official API and separate template distribution without including a shared key", async () => {
  const { installation, file } = await fixture();
  const config = JSON.parse(
    await readFile(join(installation.home, "config/models.json"), "utf8"),
  );
  expect(config).toEqual({
    schemaVersion: 1,
    mode: "official",
    official: { url: release.apiUrl, keyEnv: "RIKOKO_OFFICIAL_KEY" },
    templates: { url: release.templateUrl },
  });
  expect(
    await readPrivateJson(join(installation.home, "config/credentials.json")),
  ).toEqual({});
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(installation.port).toBeGreaterThan(0);
});

it("installs local editing without external endpoints or forwarding an inherited official key", async () => {
  const home = await mkdtemp(join(tmpdir(), "rikoko-local-install-"));
  dirs.push(home);
  const localRelease = {
    version: release.version,
    archiveUrl: release.archiveUrl,
    sha256: release.sha256,
  };
  expect(validateRelease(localRelease)).toEqual(localRelease);
  const { installation } = await initializeInstallation({
    home,
    root: join(home, "app"),
    release: localRelease,
    node: process.execPath,
    python: "/fixture/python",
    path: "/fixture/bin:/usr/bin",
  });
  expect(
    JSON.parse(await readFile(join(home, "config/models.json"), "utf8")),
  ).toEqual({
    schemaVersion: 1,
    mode: "custom",
    providers: [],
    templates: false,
  });
  const fetcher = vi.fn();
  expect(
    await bindOfficialKey(installation, localRelease, "must-not-send", fetcher),
  ).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await managedEnvironment(installation, { RIKOKO_OFFICIAL_KEY: "host-key" }),
  ).not.toHaveProperty("RIKOKO_OFFICIAL_KEY");
});

it("repeated setup preserves custom config, secrets, instance identity and port", async () => {
  const { installation, file } = await fixture();
  const custom = {
    schemaVersion: 1,
    mode: "custom",
    providers: [],
    templates: false,
  };
  await writeFile(
    join(installation.home, "config/models.json"),
    JSON.stringify(custom),
  );
  await writeFile(
    join(installation.home, "config/credentials.json"),
    '{"MY_KEY":"private"}',
  );
  const again = await initializeInstallation({ ...installation, release });
  expect(again.file).toBe(file);
  expect(again.installation).toEqual(installation);
  expect(
    JSON.parse(
      await readFile(join(installation.home, "config/models.json"), "utf8"),
    ),
  ).toEqual(custom);
  expect(
    await readPrivateJson(join(installation.home, "config/credentials.json")),
  ).toEqual({ MY_KEY: "private" });
});

it("loads only the selected provider's secrets and ignores host database and paid-provider environment", async () => {
  const { installation } = await fixture();
  await writeFile(
    join(installation.home, "config/credentials.json"),
    JSON.stringify({
      RIKOKO_OFFICIAL_KEY: "user-key",
      MY_KEY: "other-key",
      NODE_OPTIONS: "evil",
    }),
  );
  const env = await managedEnvironment(installation, {
    HOME: "/fixture",
    DATABASE_URL: "postgres://wrong",
    FAL_KEY: "wrong",
    NODE_OPTIONS: "evil",
  });
  expect(env.RIKOKO_OFFICIAL_KEY).toBe("user-key");
  expect(env.MY_KEY).toBeUndefined();
  expect(env.DATABASE_URL).toBeUndefined();
  expect(env.FAL_KEY).toBeUndefined();
  expect(env.NODE_OPTIONS).toBeUndefined();
  expect(env.HOST).toBe("127.0.0.1");
  expect(env.DATA_DIR).toBe(join(installation.home, "data"));
  await writeFile(
    join(installation.home, "config/models.json"),
    JSON.stringify({ mode: "custom", providers: [{ keyEnv: "MY_KEY" }] }),
  );
  const custom = await managedEnvironment(installation, {
    RIKOKO_OFFICIAL_KEY: "inherited",
  });
  expect(custom.RIKOKO_OFFICIAL_KEY).toBeUndefined();
  expect(custom.MY_KEY).toBe("other-key");
});

it("uses private credential files without putting the token into the MCP configuration", async () => {
  const { installation, file } = await fixture();
  const credential = join(installation.home, "data/codex.key");
  await writeFile(credential, "local-user-key\n", { mode: 0o600 });
  const launch = hostLaunch({
    client: "codex",
    root: installation.root,
    node: process.execPath,
    managedConfig: file,
    credentialFile: credential,
  });
  expect(launch.env.VIDEOWORKBENCH_MANAGED_CONFIG).toBe(file);
  expect(launch.env.VIDEOWORKBENCH_CREDENTIAL_FILE).toBe(credential);
  expect(JSON.stringify(launch)).not.toContain("local-user-key");
  expect(await hostCredential(launch.env)).toBe("local-user-key");
  await chmod(credential, 0o644);
  await expect(hostCredential(launch.env)).rejects.toThrow(
    /private|permission/i,
  );
});

it("reuses the right backend and refuses occupied ports before sending any credentials", async () => {
  const { installation, file } = await fixture();
  const start = vi.fn();
  const fetcher = vi.fn(async () =>
    Response.json({ status: "ok", instanceId: installation.instanceId }),
  );
  await ensureBackend(file, { fetcher, start });
  expect(start).not.toHaveBeenCalled();
  fetcher.mockImplementation(async () =>
    Response.json({ status: "ok", instanceId: "different-installation" }),
  );
  await expect(ensureBackend(file, { fetcher, start })).rejects.toThrow(
    /occupied|other/i,
  );
  expect(start).not.toHaveBeenCalled();
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain("Authorization");
});

it("starts a missing backend and waits for its own ready health response", async () => {
  const { installation, file } = await fixture();
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("connection refused"))
    .mockResolvedValueOnce(new Response("starting", { status: 503 }))
    .mockResolvedValue(
      Response.json({ status: "ok", instanceId: installation.instanceId }),
    );
  const start = vi.fn();
  await ensureBackend(file, { fetcher, start, intervalMs: 1 });
  expect(start).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("binds only a verified individual official key and never forwards it to templates or a changed origin", async () => {
  const { installation } = await fixture();
  const fetcher = vi.fn(async () => Response.json({ balanceCents: 0 }));
  expect(
    await bindOfficialKey(installation, release, "individual-key", fetcher),
  ).toBe(true);
  const [url, options] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe(release.apiUrl + "/v1/usage");
  expect(options.redirect).toBe("error");
  expect(new Headers(options.headers).get("Authorization")).toBe(
    "Bearer individual-key",
  );
  expect(
    await bindOfficialKey(installation, release, "replacement-key", fetcher),
  ).toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(
    await readPrivateJson(join(installation.home, "config/credentials.json")),
  ).toEqual({ RIKOKO_OFFICIAL_KEY: "individual-key" });
  await writeFile(
    join(installation.home, "config/models.json"),
    JSON.stringify({
      mode: "official",
      official: {
        url: "https://elsewhere.workbench.test",
        keyEnv: "DIFFERENT_KEY",
      },
    }),
  );
  expect(
    await bindOfficialKey(installation, release, "must-not-send", fetcher),
  ).toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
  await writeFile(
    join(installation.home, "config/models.json"),
    JSON.stringify({
      mode: "official",
      official: { url: release.apiUrl, keyEnv: "NODE_OPTIONS" },
    }),
  );
  expect(
    await bindOfficialKey(installation, release, "must-not-send", fetcher),
  ).toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("binds to the key name already selected by an existing managed installation", async () => {
  const { installation } = await fixture();
  await writeFile(
    join(installation.home, "config/models.json"),
    JSON.stringify({
      mode: "official",
      official: { url: release.apiUrl, keyEnv: "PREVIOUS_OFFICIAL_KEY" },
    }),
  );
  const fetcher = vi.fn(async () => Response.json({ balanceCents: 0 }));
  expect(
    await bindOfficialKey(installation, release, "individual-key", fetcher),
  ).toBe(true);
  expect(
    await readPrivateJson(join(installation.home, "config/credentials.json")),
  ).toEqual({ PREVIOUS_OFFICIAL_KEY: "individual-key" });
});

it("failed official authentication does not store a token or change local credentials", async () => {
  const { installation } = await fixture();
  await expect(
    bindOfficialKey(
      installation,
      release,
      "invalid-key",
      async () => new Response("no", { status: 401 }),
    ),
  ).rejects.toThrow(/401/);
  expect(
    await readPrivateJson(join(installation.home, "config/credentials.json")),
  ).toEqual({});
});

it("reports a bounded startup failure when a process never becomes ready", async () => {
  const { file } = await fixture();
  await expect(
    ensureBackend(file, {
      fetcher: async () => {
        throw Error("offline");
      },
      start: () => {},
      intervalMs: 1,
      timeoutMs: 2,
    }),
  ).rejects.toThrow(/did not become ready/);
});

it("starts and stops a real managed local service without touching the developer database", async () => {
  const home = await mkdtemp(join(tmpdir(), "vwb-managed-service-"));
  dirs.push(home);
  const { file, installation } = await initializeInstallation({
    home,
    root: resolve("."),
    release,
    node: process.execPath,
    python: resolve("python/.venv/bin/python"),
    path: process.env.PATH ?? "/usr/bin:/bin",
  });
  try {
    const backend = await ensureBackend(file);
    const health = await (await fetch(`${backend.url}/health`)).json();
    expect(health.instanceId).toBe(installation.instanceId);
    expect(health.pid).not.toBe(process.pid);
    expect((await stat(join(home, "data/local-admin.key"))).mode & 0o777).toBe(
      0o600,
    );
    expect((await ensureBackend(file)).url).toBe(backend.url);
  } finally {
    await stopBackend(file);
  }
  await stopBackend(file); // Already stopped is harmless.
});
