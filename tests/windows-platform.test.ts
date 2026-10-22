import { expect, it } from "vitest";
import { win32 } from "node:path";
import {
  pythonExecutable,
  serviceLauncher,
} from "../packages/bootstrap/src/platform.js";
import {
  clientConfigPath,
  hostLaunch,
  mergeHostConfig,
  readHostLaunch,
} from "../packages/mcp/src/host-config.js";

it("uses Windows venv and client paths, including relocated AppData and explicit Desktop config", () => {
  const home = "C:\\Users\\Test User";
  expect(pythonExecutable(home, "win32")).toBe(
    win32.join(home, "python/.venv/Scripts/python.exe"),
  );
  expect(clientConfigPath("codex", home, { platform: "win32" })).toBe(
    win32.join(home, ".codex/config.toml"),
  );
  expect(
    clientConfigPath("claude-desktop", home, {
      platform: "win32",
      appData: "D:\\Roaming",
    }),
  ).toBe("D:\\Roaming\\Claude\\claude_desktop_config.json");
  expect(
    clientConfigPath("claude-desktop", home, {
      platform: "win32",
      desktopConfig: "D:\\MSIX\\config.json",
    }),
  ).toBe("D:\\MSIX\\config.json");
  expect(() =>
    clientConfigPath("claude-desktop", home, {
      platform: "win32",
      desktopConfig: "relative.json",
    }),
  ).toThrow(/absolute/);
  expect(pythonExecutable("/fixture", "darwin")).toBe(
    "/fixture/python/.venv/bin/python",
  );
});

it("creates shell-safe service launchers without executing them", () => {
  const win = serviceLauncher(
    "C:\\O'Brien\\node.exe",
    "C:\\My App\\service.ts",
    "C:\\My App\\installation.json",
    "win32",
  );
  expect(win.name).toBe("service.ps1");
  expect(win.content).toContain("& 'C:\\O''Brien\\node.exe'");
  expect(win.content).toContain("exit $LASTEXITCODE");
  const unix = serviceLauncher(
    "/O'Brien/node",
    "/app/service.ts",
    "/app/install.json",
    "linux",
  );
  expect(unix.content).toContain("'/O'\\''Brien/node'");
  expect(unix.content).toContain('"${1:-start}"');
});

it("round-trips Windows launch paths and preserves unrelated host settings", () => {
  for (const client of ["codex", "claude-code", "claude-desktop"] as const) {
    const launch = hostLaunch({
      client,
      root: "C:\\Users\\Test User\\rikoko",
      node: "C:\\Program Files\\nodejs\\node.exe",
      platform: "win32",
    });
    expect(launch.args[1]).toBe(
      "file:///C:/Users/Test%20User/rikoko/node_modules/tsx/dist/loader.mjs",
    );
    const existing =
      client === "codex"
        ? '[mcp_servers.other]\ncommand="keep"\n'
        : '{"mcpServers":{"other":{"command":"keep"}}}';
    const merged = mergeHostConfig(client, existing, launch);
    expect(merged).toContain("keep");
    expect(readHostLaunch(client, merged)).toEqual(launch);
    expect(mergeHostConfig(client, merged, launch)).toBe(merged);
  }
});

it("preserves Windows process essentials without allowing provider keys to override them", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { managedEnvironment } =
    await import("../packages/bootstrap/src/managed.js");
  const home = await mkdtemp(join(tmpdir(), "rikoko-windows-env-"));
  try {
    await mkdir(join(home, "config"));
    await writeFile(
      join(home, "config/models.json"),
      JSON.stringify({ mode: "custom", providers: [] }),
    );
    await writeFile(join(home, "config/credentials.json"), "{}", {
      mode: 0o600,
    });
    const installation = {
      schemaVersion: 1 as const,
      home,
      root: home,
      node: "node.exe",
      python: "python.exe",
      path: "C:\\Windows",
      port: 4310,
      instanceId: "fixture",
    };
    const env = await managedEnvironment(installation, {
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      APPDATA: "C:\\Roaming",
      NODE_OPTIONS: "not-inherited",
      FAL_KEY: "not-inherited",
    });
    expect(env.SystemRoot).toBe("C:\\Windows");
    expect(env.TEMP).toBe("C:\\Temp");
    expect(env.APPDATA).toBe("C:\\Roaming");
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.FAL_KEY).toBeUndefined();
    await writeFile(
      join(home, "config/models.json"),
      JSON.stringify({ mode: "custom", providers: [{ keyEnv: "SYSTEMROOT" }] }),
    );
    await expect(managedEnvironment(installation, {})).rejects.toThrow(
      /credential environment/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
