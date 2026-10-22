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
import { z } from "zod";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  clients,
  clientConfigPath,
  hostLaunch,
  mergeHostConfig,
  readHostLaunch,
  type HostLaunch,
} from "../packages/mcp/src/host-config.js";
import {
  backendUrl,
  HostConnection,
  hostCredential,
} from "../packages/mcp/src/host-connection.js";
import { ensureBackend } from "../packages/bootstrap/src/managed.ts";
import { readPrivateText } from "../packages/bootstrap/src/config.ts";
import {
  inspectLegacySkill,
  archiveLegacySkill,
  restoreLegacySkill,
  recoverMigrationLock,
} from "../packages/bootstrap/src/skill-migration.js";
import { checkDirectorGuides } from "../packages/guidance/src/doctor.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command = "doctor", clientInput = "codex"] = process.argv.slice(2);
const extraArgs = process.argv.slice(4);
const checkMedia = extraArgs.includes("--media");
const applyMigration = extraArgs.includes("--apply");
const recoverLock = extraArgs.join() === "--recover-lock";
const approvedFingerprint =
  extraArgs[1] === "--accept-fingerprint" ? extraArgs[2] : undefined;
const backupIndex = extraArgs.indexOf("--backup");
const backupId = backupIndex >= 0 ? extraArgs[backupIndex + 1] : undefined;
const validExtras =
  command === "doctor"
    ? extraArgs.length === 0 || extraArgs.join() === "--media"
    : command === "migrate-skill"
      ? extraArgs.length === 0 ||
        extraArgs.join() === "--apply" ||
        recoverLock ||
        (extraArgs.length === 3 &&
          extraArgs[0] === "--apply" &&
          !!approvedFingerprint &&
          /^[a-f0-9]{64}$/.test(approvedFingerprint))
      : command === "restore-skill"
        ? extraArgs.length === 2 && backupIndex === 0 && !!backupId
        : extraArgs.length === 0;
if (!validExtras)
  throw Error(
    "Unsupported options: doctor [--media], migrate-skill [--apply [--accept-fingerprint <sha256>] | --recover-lock], restore-skill --backup <id>",
  );
const client = clients.find((name) => name === clientInput);
if (
  !client ||
  ![
    "doctor",
    "install",
    "config",
    "sync-skill",
    "migrate-skill",
    "restore-skill",
  ].includes(command)
)
  throw Error(
    "Usage: pnpm clients <doctor|install|config|migrate-skill|restore-skill> <codex|claude-desktop|claude-code|hermes> [--media for doctor]",
  );
const clientHome = process.env.VIDEOWORKBENCH_CLIENT_HOME ?? homedir();
const skillPath =
  client === "codex"
    ? join(clientHome, ".codex/skills/rikoko/SKILL.md")
    : client === "claude-code"
      ? join(clientHome, ".claude/skills/rikoko/SKILL.md")
      : client === "hermes"
        ? join(clientHome, ".hermes/skills/rikoko/SKILL.md")
        : undefined;
const archiveRoot = join(
  clientHome,
  ".local/share/rikoko/skill-archives",
  client,
);
if (command === "sync-skill") {
  console.log(
    "Deprecated: rikoko director guides now come through MCP. Upgrade/reconnect MCP, run clients doctor, then clients migrate-skill <host> to inspect the legacy installation. No files changed.",
  );
  process.exit(0);
}
if (command === "restore-skill") {
  if (!skillPath || !backupId)
    throw Error("No legacy Skill location or backup ID for this host");
  console.log(
    JSON.stringify(
      await restoreLegacySkill(dirname(skillPath), archiveRoot, backupId),
      null,
      2,
    ),
  );
  process.exit(0);
}
if (command === "migrate-skill" && recoverLock) {
  console.log(JSON.stringify(await recoverMigrationLock(archiveRoot), null, 2));
  process.exit(0);
}
if (command === "migrate-skill" && !applyMigration) {
  console.log(
    JSON.stringify(
      skillPath
        ? await inspectLegacySkill(dirname(skillPath))
        : { status: "not_applicable" },
      null,
      2,
    ),
  );
  process.exit(0);
}
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
const launch = hostLaunch({
  client,
  root,
  node: process.execPath,
  url: base,
  keychainService:
    !managed && process.platform === "darwin" ? service : undefined,
  managedConfig: managedFile,
  credentialFile,
  home: clientHome,
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
async function connectCheck(
  profile: HostLaunch = launch,
  configSource = "generated",
) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string",
    ),
  );
  const transport = new StdioClientTransport({
    ...profile,
    env: { ...env, ...profile.env },
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
    const guideMetadata = await checkDirectorGuides(
      list.tools.map((t) => t.name),
      (response.structuredContent as any)?.result,
      async (name, args) => {
        const guide = await test.callTool({ name, arguments: args });
        if (guide.isError) throw Error(`Guide unavailable: ${args.topic}`);
        return (guide.structuredContent as any)?.result;
      },
    );
    const legacySkill = skillPath
      ? await inspectLegacySkill(dirname(skillPath))
      : { status: "not_applicable" };
    const resources = test.getServerCapabilities()?.resources
      ? (await test.listResources()).resources
      : [];
    const hasEmbeddedUi =
      list.tools.some(
        (tool) => !!tool._meta?.ui || !!tool._meta?.["ui/resourceUri"],
      ) || resources.some((resource) => resource.uri.startsWith("ui://"));
    if (hasEmbeddedUi) throw Error("Unexpected embedded MCP UI");
    let mediaRuntime: unknown = {
      checked: false,
      instruction:
        "Use doctor <client> --media for backend synthetic FFmpeg extraction checks.",
    };
    if (checkMedia) {
      if (!list.tools.some((t) => t.name === "media_runtime_check")) {
        mediaRuntime = {
          checked: false,
          ready: false,
          reason:
            "Runtime does not expose media_runtime_check; update the runtime and reconnect.",
        };
        process.exitCode = 1;
      } else {
        const media = await test.callTool({
          name: "media_runtime_check",
          arguments: {},
        });
        const valid = z
          .object({ result: z.object({ ready: z.literal(true) }) })
          .safeParse(media.structuredContent);
        const ready = !media.isError && valid.success;
        mediaRuntime = {
          checked: true,
          ready,
          ...(media.structuredContent ?? {
            reason:
              "Missing structured diagnostic response. The backend may be older than this MCP bridge; update/restart the matching runtime and reconnect.",
            content: media.content,
          }),
        };
        if (!ready) process.exitCode = 1;
      }
    }
    console.log(
      JSON.stringify(
        {
          client,
          protocol: "stdio",
          connected: true,
          tools: list.tools.map((t) => t.name),
          interaction: "native-conversation-media-and-content",
          inlineCardResource: false,
          productionGuide: {
            ...guideMetadata,
            hostVisionVerified: false,
            hostDeliveryVerified: false,
          },
          legacySkill,
          migrationComplete: ["absent", "not_applicable"].includes(
            legacySkill.status,
          ),
          bridgeVersion: test.getServerVersion()?.version,
          paidTestExecuted: false,
          mediaRuntime,
          configSource,
          importRoots: JSON.parse(
            profile.env.VIDEOWORKBENCH_IMPORT_ROOTS ??
              env.VIDEOWORKBENCH_IMPORT_ROOTS ??
              "[]",
          ),
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
} else if (command === "migrate-skill") {
  if (!skillPath) throw Error("This host has no managed legacy Skill");
  const path = clientConfigPath(client, clientHome);
  const installed = readHostLaunch(client, await readOptional(path));
  if (!installed)
    throw Error("Verify an installed MCP profile before applying migration");
  await connectCheck(installed, path);
  console.log(
    JSON.stringify(
      await archiveLegacySkill(
        dirname(skillPath),
        archiveRoot,
        true,
        undefined,
        approvedFingerprint,
      ),
      null,
      2,
    ),
  );
} else if (command === "doctor") {
  try {
    const path = clientConfigPath(client, clientHome);
    const installed = readHostLaunch(client, await readOptional(path));
    await connectCheck(installed ?? launch, installed ? path : "generated");
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Guide verification failed",
    );
    console.error(
      `rikoko ${client} connection failed. Check the installed MCP profile, credential access and backend connection.`,
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
  console.log(
    `Registered ${client}: ${path}; director guides: MCP backend (no Skill installed). Reload the host's MCP connections to activate. Existing servers were preserved. The dedicated key has no paid-generation budget.`,
  );
}
