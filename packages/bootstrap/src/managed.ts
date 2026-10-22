import { spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertUpgradeAccess } from "./upgrade.ts";
import {
  readInstallation,
  readPrivateJson,
  type Installation,
} from "./config.ts";

export async function managedEnvironment(
  i: Installation,
  source: NodeJS.ProcessEnv = process.env,
) {
  const env: NodeJS.ProcessEnv = {};
  await assertUpgradeAccess(i.home, source.RIKOKO_UPGRADE_TOKEN);
  for (const name of [
    "HOME",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "TEMP",
    "TMP",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "RIKOKO_DOWNLOAD_PROXY",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "https_proxy",
    "http_proxy",
    "RIKOKO_UPGRADE_TOKEN",
    "RIKOKO_UPGRADE_VERIFY",
  ])
    if (source[name]) env[name] = source[name];
  if (source.RIKOKO_DOWNLOAD_PROXY !== undefined)
    env.RIKOKO_DOWNLOAD_PROXY = source.RIKOKO_DOWNLOAD_PROXY;
  const modelFile = join(i.home, "config/models.json");
  const model = JSON.parse(await readFile(modelFile, "utf8"));
  const credentials = await readPrivateJson(
    join(i.home, "config/credentials.json"),
  );
  const names: unknown[] =
    model.mode === "official"
      ? [model.official?.keyEnv]
      : (model.providers ?? []).map((p: { keyEnv: string }) => p.keyEnv);
  const forbidden =
    /^(?:NODE_|LD_|DYLD_|PYTHON|PATH$|HOME$|SYSTEMROOT$|WINDIR$|COMSPEC$|PATHEXT$|USERPROFILE$|LOCALAPPDATA$|APPDATA$|TEMP$|TMP$|DATABASE_URL$|DATA_DIR$|HOST$|PORT$|RIKOKO_CONFIG_FILE$|VIDEOWORKBENCH_)/;
  for (const name of names) {
    if (
      typeof name !== "string" ||
      !/^[A-Z][A-Z0-9_]{0,100}$/.test(name) ||
      forbidden.test(name)
    )
      throw Error("Invalid provider credential environment name");
    const value = credentials[name];
    if (value !== undefined) {
      if (typeof value !== "string" || !value.trim() || value.includes("\0"))
        throw Error("Invalid provider credential");
      env[name] = value;
    }
  }
  return Object.assign(env, {
    PATH: i.path,
    HOST: "127.0.0.1",
    PORT: String(i.port),
    DATA_DIR: join(i.home, "data"),
    RIKOKO_CONFIG_FILE: modelFile,
    MEDIA_PYTHON: i.python,
    VIDEOWORKBENCH_INSTANCE_ID: i.instanceId,
    VIDEOWORKBENCH_PID_FILE: join(i.home, "data/server.pid"),
  });
}
async function startBackend(i: Installation) {
  const env = await managedEnvironment(i);
  const log = await open(join(i.home, "data/server.log"), "a", 0o600);
  try {
    const child = spawn(
      i.node,
      [
        "--import",
        pathToFileURL(join(i.root, "node_modules/tsx/dist/loader.mjs")).href,
        join(i.root, "apps/server/src/index.ts"),
      ],
      {
        cwd: i.root,
        env,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    await new Promise<void>((yes, no) => {
      child.once("spawn", yes);
      child.once("error", no);
    });
    child.unref();
  } finally {
    await log.close();
  }
}
export async function ensureBackend(
  file: string,
  options: {
    fetcher?: typeof fetch;
    start?: (i: Installation) => Promise<void> | void;
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
) {
  const i = await readInstallation(file);
  await assertUpgradeAccess(i.home, process.env.RIKOKO_UPGRADE_TOKEN);
  const fetcher = options.fetcher ?? fetch;
  const url = `http://127.0.0.1:${i.port}`;
  async function ready() {
    let response: Response;
    try {
      response = await fetcher(`${url}/health`, {
        redirect: "error",
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      return false;
    }
    if (response.status === 503) return false;
    const body = await response.json().catch(() => ({}));
    if (
      !response.ok ||
      body.status !== "ok" ||
      body.instanceId !== i.instanceId
    )
      throw Error(
        "Local port is occupied by another service; no credentials were sent",
      );
    return true;
  }
  if (await ready()) return { installation: i, url };
  await (options.start ?? startBackend)(i);
  const deadline = Date.now() + (options.timeoutMs ?? 25_000);
  do {
    await new Promise((r) => setTimeout(r, options.intervalMs ?? 150));
    if (await ready()) return { installation: i, url };
  } while (Date.now() < deadline);
  throw Error(
    `Local service did not become ready. Inspect ${join(i.home, "data/server.log")}`,
  );
}

export async function stopBackend(file: string) {
  const i = await readInstallation(file);
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${i.port}/health`, {
      redirect: "error",
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // A server can close its listening socket while still draining a worker.
    // Do not report it stopped until its recorded process has actually exited.
    const raw = await readFile(join(i.home, "data/server.pid"), "utf8").catch(
      (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
      },
    );
    if (raw.trim()) {
      const pid = Number(raw.trim());
      if (!Number.isInteger(pid) || pid <= 1)
        throw Error("Invalid server PID file");
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
        throw error;
      }
      throw Error(
        "Service health is unavailable but its process is still alive; wait before upgrading",
      );
    }
    return;
  }
  const health = await response.json().catch(() => ({}));
  const pid = Number(
    (await readFile(join(i.home, "data/server.pid"), "utf8")).trim(),
  );
  if (
    !response.ok ||
    health.instanceId !== i.instanceId ||
    health.pid !== pid ||
    !Number.isInteger(pid) ||
    pid <= 1
  )
    throw Error("Refusing to stop an unverified service");
  process.kill(pid, "SIGTERM");
  for (let n = 0; n < 100; n++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
  }
  throw Error("Service is still finishing a job; wait before restarting");
}
