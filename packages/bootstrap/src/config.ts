import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, writeFile, readFile, rename } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join, resolve } from "node:path";

export type Release = {
  version: string;
  archiveUrl: string;
  sha256: string;
  apiUrl: string;
  templateUrl: string;
};
export type Installation = {
  schemaVersion: 1;
  home: string;
  root: string;
  node: string;
  python: string;
  path: string;
  port: number;
  instanceId: string;
};
export function validateRelease(raw: unknown): Release {
  const r = raw as Release;
  if (
    !r ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(r.version) ||
    !/^[a-f0-9]{64}$/.test(r.sha256)
  )
    throw Error("Invalid release version or SHA-256");
  for (const key of ["archiveUrl", "apiUrl", "templateUrl"] as const) {
    const url = new URL(r[key]);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /(^|\.)(example\.(com|org|net)|invalid|localhost)$/.test(url.hostname) ||
      (key !== "archiveUrl" && url.pathname !== "/")
    )
      throw Error("Release requires real HTTPS download and service addresses");
  }
  return {
    version: r.version,
    archiveUrl: r.archiveUrl,
    sha256: r.sha256,
    apiUrl: new URL(r.apiUrl).origin,
    templateUrl: new URL(r.templateUrl).origin,
  };
}

/** Secrets must be regular, owner-only files; do not follow a final symlink. */
export async function readPrivateText(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size > 1024 * 1024 ||
      (process.platform !== "win32" &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    )
      throw Error("Credential file must be private (owner only, mode 0600)");
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
export async function readPrivateJson(path: string) {
  return JSON.parse(await readPrivateText(path));
}
export async function bindOfficialKey(
  i: Installation,
  release: Release,
  candidate?: string,
  fetcher: typeof fetch = fetch,
) {
  validateRelease(release);
  if (!candidate?.trim()) return false;
  const model = JSON.parse(
    await readFile(join(i.home, "config/models.json"), "utf8"),
  );
  const keyEnv = model.official?.keyEnv;
  if (
    model.mode !== "official" ||
    model.official?.url !== release.apiUrl ||
    typeof keyEnv !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,80}_OFFICIAL_KEY$/.test(keyEnv)
  )
    return false;
  const file = join(i.home, "config/credentials.json");
  const credentials = await readPrivateJson(file);
  if (credentials[keyEnv]) return false;
  const key = candidate.trim();
  const response = await fetcher(`${release.apiUrl}/v1/usage`, {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  await response.body?.cancel();
  if (!response.ok)
    throw Error(
      `官方用户 Key 验证未通过（HTTP ${response.status}）；未保存凭据，请检查后重试。`,
    );
  credentials[keyEnv] = key;
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(credentials, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, file);
  return true;
}
export async function readInstallation(file: string): Promise<Installation> {
  const i = (await readPrivateJson(file)) as Installation;
  if (
    i.schemaVersion !== 1 ||
    ![i.home, i.root, i.node, i.python].every(
      (p) => typeof p === "string" && isAbsolute(p),
    ) ||
    typeof i.path !== "string" ||
    !Number.isInteger(i.port) ||
    i.port < 1024 ||
    i.port > 65535 ||
    !/^[a-f0-9-]{36}$/.test(i.instanceId)
  )
    throw Error("Invalid local installation configuration");
  return i;
}
async function writeOnce(file: string, value: unknown) {
  try {
    await writeFile(file, JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((yes, no) =>
    server.close((error) => (error ? no(error) : yes())),
  );
  return port;
}
export async function initializeInstallation(options: {
  home: string;
  root: string;
  release: Release;
  node: string;
  python: string;
  path: string;
}) {
  const release = validateRelease(options.release);
  const home = resolve(options.home),
    root = resolve(options.root);
  for (const path of [home, join(home, "config"), join(home, "data")])
    await mkdir(path, { recursive: true, mode: 0o700 });
  const file = join(home, "installation.json");
  let installation: Installation;
  try {
    installation = await readInstallation(file);
    if (installation.home !== home || installation.root !== root)
      throw Error("Existing installation belongs to a different directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeOnce(file, {
      schemaVersion: 1,
      home,
      root,
      node: options.node,
      python: options.python,
      path: options.path,
      port: await freePort(),
      instanceId: randomUUID(),
    });
    installation = await readInstallation(file);
  }
  await writeOnce(join(home, "config/models.json"), {
    schemaVersion: 1,
    mode: "official",
    official: { url: release.apiUrl, keyEnv: "RIKOKO_OFFICIAL_KEY" },
    templates: { url: release.templateUrl },
  });
  await writeOnce(join(home, "config/credentials.json"), {});
  // Validate existing secrets without displaying their contents.
  await readPrivateJson(join(home, "config/credentials.json"));
  return { installation, file };
}
