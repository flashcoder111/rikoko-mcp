// Runs with Node's native type stripping; keep bootstrap imports dependency-free.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  initializeInstallation,
  readPrivateJson,
  readPrivateText,
  validateRelease,
  bindOfficialKey,
} from "../packages/bootstrap/src/config.ts";
import {
  ensureBackend,
  stopBackend,
} from "../packages/bootstrap/src/managed.ts";

const run = promisify(execFile);
const args = process.argv.slice(2);
const options: Record<string, string> = {};
for (let n = 0; n < args.length; n += 2) {
  if (!["--home", "--release", "--client"].includes(args[n]) || !args[n + 1])
    throw Error(
      "Usage: setup.ts --home <directory> --release <release.json> [--client auto|codex|claude-code|claude-desktop]",
    );
  options[args[n]] = args[n + 1];
}
if (!options["--home"] || !options["--release"])
  throw Error("Installation directory and release file are required");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = validateRelease(
  JSON.parse(await readFile(options["--release"], "utf8")),
);
const clientHome = process.env.VIDEOWORKBENCH_CLIENT_HOME ?? homedir();
const present = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const requested = options["--client"] ?? "auto";
let clients: string[];
if (requested === "auto") {
  clients = [];
  if (await present(join(clientHome, ".codex"))) clients.push("codex");
  if (
    (await present(join(clientHome, ".claude.json"))) ||
    (await present(join(clientHome, ".claude")))
  )
    clients.push("claude-code");
  if (
    process.platform === "darwin" &&
    (await present(join(clientHome, "Library/Application Support/Claude")))
  )
    clients.push("claude-desktop");
  if (!clients.length)
    throw Error(
      "未检测到客户端。请在同一安装命令后加 --client codex 或 --client claude-code。",
    );
} else if (["codex", "claude-code", "claude-desktop"].includes(requested))
  clients = [requested];
else throw Error("Unsupported client");
if (clients.includes("claude-desktop") && process.platform !== "darwin")
  throw Error(
    "Claude Desktop 安装当前仅支持 macOS；其他系统请使用 Claude Code。",
  );

const { installation, file } = await initializeInstallation({
  home: options["--home"],
  root,
  release,
  node: process.execPath,
  python: join(root, "python/.venv/bin/python"),
  path: process.env.PATH ?? "/usr/bin:/bin",
});
const credentialsFile = join(installation.home, "config/credentials.json");
const credentials = await readPrivateJson(credentialsFile);
const model = JSON.parse(
  await readFile(join(installation.home, "config/models.json"), "utf8"),
);
const connected = await bindOfficialKey(
  installation,
  release,
  process.env.HYPIT_OFFICIAL_KEY,
);
delete process.env.HYPIT_OFFICIAL_KEY;
if (connected) await stopBackend(file);
const backend = await ensureBackend(file);
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const control = join(installation.home, "service");
if (!(await present(control)))
  await writeFile(
    control,
    `#!/bin/sh\nexec ${quote(installation.node)} --experimental-strip-types ${quote(join(root, "scripts/service.ts"))} "\${1:-start}" ${quote(file)}\n`,
    { mode: 0o700, flag: "wx" },
  );
for (const client of clients) {
  const { stdout } = await run(
    process.execPath,
    [
      "--import",
      join(root, "node_modules/tsx/dist/loader.mjs"),
      join(root, "scripts/clients.ts"),
      "install",
      client,
    ],
    {
      cwd: root,
      env: { ...process.env, VIDEOWORKBENCH_MANAGED_CONFIG: file },
      maxBuffer: 1024 * 1024,
    },
  );
  console.log(stdout.trim());
}
// One real, free render checks the media path as well as the MCP connection.
const admin = (
  await readPrivateText(join(installation.home, "data/local-admin.key"))
).trim();
async function call(name: string, input: unknown) {
  const response = await fetch(`${backend.url}/api/tools/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${admin}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw Error(`安装自检未通过：${name} HTTP ${response.status}`);
  return (await response.json()).result;
}
const created = await call("workspace_commit", {
  action: {
    type: "create",
    composition: {
      schemaVersion: 1,
      title: "Welcome to rikoko",
      width: 320,
      height: 180,
      scenes: [
        {
          id: "welcome",
          durationMs: 1000,
          text: "Ready to create",
          color: "#173b42",
        },
      ],
    },
  },
  message: "安装自检：本地免费样片",
  idempotencyKey: "installation-smoke-v1",
});
const deadline = Date.now() + 60_000;
let completed = false;
while (Date.now() < deadline) {
  const job = await call("record_get", { type: "job", id: created.jobId });
  if (job.status === "completed") {
    completed = true;
    break;
  }
  if (["failed", "cancelled", "blocked_external"].includes(job.status))
    throw Error("本地样片导出失败，请检查 data/server.log；未调用付费模型。");
  await new Promise((r) => setTimeout(r, 250));
}
if (!completed) throw Error("本地样片导出超时，请检查 data/server.log。");
console.log(
  `\n安装完成：${clients.join(", ")}。请重载客户端 MCP 连接。\n本地工作台：${backend.url}\n自有模型配置：${join(installation.home, "config/models.json")}\n私有凭据文件：${credentialsFile}\n免费样片：导出成功；付费调用：0。`,
);
console.log(
  model.mode === "custom"
    ? "保留现有自有供应商配置。"
    : connected
      ? "官方 API：用户 Key 已验证并绑定。"
      : credentials[model.official?.keyEnv]
        ? "官方 API：保留已有用户凭据，本次未重新验证。"
        : "官方 API 地址已配置，尚未绑定用户 Key；本地编辑与导出可用。",
);
