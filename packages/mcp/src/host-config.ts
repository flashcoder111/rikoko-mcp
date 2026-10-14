import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parseDocument } from "yaml";
import { backendUrl } from "./host-connection.js";

export const clients = [
  "codex",
  "claude-desktop",
  "claude-code",
  "hermes",
] as const;
export type ClientName = (typeof clients)[number];
export type HostLaunch = {
  command: string;
  args: string[];
  env: Record<string, string>;
};
export function hostLaunch(options: {
  client: ClientName;
  root: string;
  node: string;
  url?: string;
  keychainService?: string;
  managedConfig?: string;
  credentialFile?: string;
}): HostLaunch {
  return {
    command: options.node,
    args: [
      "--import",
      join(options.root, "node_modules/tsx/dist/loader.mjs"),
      join(options.root, "packages/mcp/src/stdio.ts"),
    ],
    env: {
      VIDEOWORKBENCH_URL: backendUrl(options.url),
      VIDEOWORKBENCH_CLIENT: options.client.startsWith("claude")
        ? "claude"
        : options.client,
      VIDEOWORKBENCH_EXPORT_DIR: join(
        options.root,
        ".data/host-media",
        options.client,
      ),
      VIDEOWORKBENCH_IMPORT_ROOTS: JSON.stringify([
        join(options.root, "artifacts"),
        join(options.root, "media-inbox"),
      ]),
      ...(options.keychainService
        ? { VIDEOWORKBENCH_KEYCHAIN_SERVICE: options.keychainService }
        : {}),
      ...(options.managedConfig
        ? { VIDEOWORKBENCH_MANAGED_CONFIG: options.managedConfig }
        : {}),
      ...(options.credentialFile
        ? { VIDEOWORKBENCH_CREDENTIAL_FILE: options.credentialFile }
        : {}),
    },
  };
}
export function clientConfigPath(client: ClientName, home: string) {
  return client === "codex"
    ? join(home, ".codex/config.toml")
    : client === "claude-desktop"
      ? join(
          home,
          "Library/Application Support/Claude/claude_desktop_config.json",
        )
      : client === "claude-code"
        ? join(home, ".claude.json")
        : join(home, ".hermes/config.yaml");
}
function matching(old: unknown, desired: unknown) {
  if (old === undefined) return;
  // Do not overwrite a different workspace/server with the same name.
  const previous = old as HostLaunch;
  const next = desired as HostLaunch;
  if (
    previous.command !== next.command ||
    JSON.stringify(previous.args) !== JSON.stringify(next.args) ||
    JSON.stringify(previous.env) !== JSON.stringify(next.env)
  )
    throw Error(
      "An existing rikoko MCP entry differs. Preserve it; choose its original workspace or review the configuration manually.",
    );
}
export function mergeHostConfig(
  client: ClientName,
  existing: string,
  launch: HostLaunch,
) {
  if (client === "codex") {
    const config = existing.trim() ? parseToml(existing) : {};
    const old = (config.mcp_servers as Record<string, unknown> | undefined)
      ?.rikoko;
    matching(old, launch);
    if (old) return existing;
    return `${existing.trimEnd()}\n\n[mcp_servers.rikoko]\ncommand = ${JSON.stringify(launch.command)}\nargs = ${JSON.stringify(launch.args)}\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\n[mcp_servers.rikoko.env]\n${Object.entries(
      launch.env,
    )
      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
      .join("\n")}\n`;
  }
  if (client === "hermes") {
    const doc = parseDocument(existing || "{}", { uniqueKeys: true });
    if (doc.errors.length)
      throw Error("Existing Hermes YAML is invalid; no changes written.");
    const data = doc.toJS() as { mcp_servers?: Record<string, unknown> };
    const old = data?.mcp_servers?.rikoko;
    matching(old, launch);
    if (old) return existing;
    doc.setIn(["mcp_servers", "rikoko"], {
      ...launch,
      timeout: 120,
      connect_timeout: 30,
    });
    return doc.toString();
  }
  const config = existing.trim() ? JSON.parse(existing) : {};
  const old = config.mcpServers?.rikoko;
  matching(old, launch);
  if (old) return existing;
  config.mcpServers = {
    ...config.mcpServers,
    rikoko: {
      ...(client === "claude-code" ? { type: "stdio" } : {}),
      ...launch,
    },
  };
  return JSON.stringify(config, null, 2) + "\n";
}
