import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  copyFile,
  chmod,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  clients,
  clientConfigPath,
  hostLaunch,
  mergeHostConfig,
} from "../packages/mcp/src/host-config.js";
import {
  backendUrl,
  HostConnection,
  hostCredential,
} from "../packages/mcp/src/host-connection.js";
import { ensureBackend } from "../packages/bootstrap/src/managed.ts";
import { readPrivateText } from "../packages/bootstrap/src/config.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command = "doctor", clientInput = "codex"] = process.argv.slice(2);
const client = clients.find((name) => name === clientInput);
if (!client || !["doctor", "install", "config"].includes(command))
  throw Error(
    "Usage: pnpm clients <doctor|install|config> <codex|claude-desktop|claude-code|hermes>",
  );
const managedFile = process.env.VIDEOWORKBENCH_MANAGED_CONFIG;
const managed = managedFile ? await ensureBackend(managedFile) : undefined;
const base = managed?.url ?? backendUrl(process.env.VIDEOWORKBENCH_URL);
const credentialFile = managed
  ? join(managed.installation.home, "data", `${client}.key`)
  : undefined;
const identity = createHash("sha256")
  .update(`${root}\n${base}`)
  .digest("hex")
  .slice(0, 12);
const service = `ai.rikoko.mcp.${identity}.${client}`;
const clientHome = process.env.VIDEOWORKBENCH_CLIENT_HOME ?? homedir();
const skillPath =
  client === "codex"
    ? join(clientHome, ".codex/skills/rikoko/SKILL.md")
    : client === "claude-code"
      ? join(clientHome, ".claude/skills/rikoko/SKILL.md")
      : client === "hermes"
        ? join(clientHome, ".hermes/skills/rikoko/SKILL.md")
        : undefined;
const launch = hostLaunch({
  client,
  root,
  node: process.execPath,
  url: base,
  keychainService:
    !managed && process.platform === "darwin" ? service : undefined,
  managedConfig: managedFile,
  credentialFile,
});
const run = promisify(execFile);
async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}
async function connectCheck() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string",
    ),
  );
  const transport = new StdioClientTransport({
    ...launch,
    env: { ...env, ...launch.env },
    stderr: "pipe",
  });
  const test = new Client({
    name: `rikoko-${client}-doctor`,
    version: "1.0.0",
  });
  try {
    await test.connect(transport);
    const list = await test.listTools();
    const response = await test.callTool({
      name: "capabilities",
      arguments: {},
    });
    if (response.isError) throw Error("Backend capability check failed");
    const resources = test.getServerCapabilities()?.resources
      ? (await test.listResources()).resources
      : [];
    const hasEmbeddedUi =
      list.tools.some(
        (tool) => !!tool._meta?.ui || !!tool._meta?.["ui/resourceUri"],
      ) || resources.some((resource) => resource.uri.startsWith("ui://"));
    if (hasEmbeddedUi) throw Error("Unexpected embedded MCP UI");
    console.log(
      JSON.stringify(
        {
          client,
          protocol: "stdio",
          connected: true,
          tools: list.tools.map((t) => t.name),
          interaction: "native-conversation-media-and-content",
          inlineCardResource: false,
          paidTestExecuted: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await test.close();
  }
}
if (command === "config") {
  console.log(mergeHostConfig(client, "", launch));
} else if (command === "doctor") {
  try {
    await connectCheck();
  } catch {
    console.error(
      `rikoko ${client} connection failed. Check credential access and the running backend at ${base}.`,
    );
    process.exitCode = 1;
  }
} else {
  const path = clientConfigPath(client, clientHome);
  const existing = await readOptional(path);
  if (client === "hermes" && !existing)
    throw Error(
      "Hermes is not configured on this machine. Use 'pnpm clients config hermes' on its actual host instead.",
    );
  const updated = mergeHostConfig(client, existing, launch);
  const skill = skillPath
    ? await readFile(join(root, "skills/rikoko/SKILL.md"), "utf8")
    : undefined;
  const currentSkill = skillPath ? await readOptional(skillPath) : undefined;
  if (
    currentSkill &&
    currentSkill !== skill &&
    !currentSkill.includes("<!-- Managed by the rikoko installer.")
  )
    throw Error(`A different rikoko skill already exists at ${skillPath}`);
  await mkdir(join(root, "media-inbox"), { recursive: true });
  await mkdir(join(root, "artifacts"), { recursive: true });
  if (managed && credentialFile) {
    try {
      await readPrivateText(credentialFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const admin = (
        await readPrivateText(
          join(managed.installation.home, "data/local-admin.key"),
        )
      ).trim();
      const backend = new HostConnection(base, admin);
      const issued = (await backend.invoke("key_create", {
        name: `rikoko ${client}`,
        scopes: ["read", "write"],
        budgetCents: 0,
      })) as { id: string; key: string };
      try {
        await writeFile(credentialFile, issued.key + "\n", {
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        await backend.invoke("key_revoke", { keyId: issued.id });
        throw error;
      }
    }
  } else if (process.platform === "darwin") {
    let present = false;
    try {
      await hostCredential({ VIDEOWORKBENCH_KEYCHAIN_SERVICE: service });
      present = true;
    } catch {
      /* provision below */
    }
    if (!present) {
      const admin =
        process.env.VIDEOWORKBENCH_ADMIN_KEY ??
        (await readFile(join(root, ".data/local-admin.key"), "utf8")).trim();
      const backend = new HostConnection(base, admin);
      const issued = (await backend.invoke("key_create", {
        name: `rikoko ${client}`,
        scopes: ["read", "write"],
        budgetCents: 0,
      })) as { id: string; key: string };
      try {
        await run("/usr/bin/security", [
          "add-generic-password",
          "-U",
          "-s",
          service,
          "-a",
          "rikoko-mcp",
          "-w",
          issued.key,
        ]);
      } catch {
        await backend.invoke("key_revoke", { keyId: issued.id });
        throw Error(
          "Could not save credential in Keychain; the new key was revoked.",
        );
      }
    }
  } else if (!process.env.VIDEOWORKBENCH_API_KEY) {
    throw Error(
      "Set VIDEOWORKBENCH_API_KEY in the host's secret environment; the installer does not write plaintext credentials.",
    );
  }
  await connectCheck();
  if (updated !== existing) {
    await mkdir(dirname(path), { recursive: true });
    if (existing) {
      const backup = `${path}.rikoko-${Date.now()}.bak`;
      await copyFile(path, backup);
      await chmod(backup, 0o600);
    }
    const temp = `${path}.rikoko-tmp`;
    await writeFile(temp, updated, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  }
  if (skillPath && skill && currentSkill !== skill) {
    await mkdir(dirname(skillPath), { recursive: true });
    if (currentSkill) {
      const backup = `${skillPath}.rikoko-${Date.now()}.bak`;
      await copyFile(skillPath, backup);
      await chmod(backup, 0o600);
    }
    const temp = `${skillPath}.rikoko-tmp`;
    await writeFile(temp, skill, { mode: 0o644, flag: "wx" });
    await rename(temp, skillPath);
  }
  console.log(
    `Registered ${client}: ${path}${skillPath ? `; skill: ${skillPath}` : ""}. Reload the host's MCP connections to activate. Existing servers were preserved. The dedicated key has no paid-generation budget.`,
  );
}
