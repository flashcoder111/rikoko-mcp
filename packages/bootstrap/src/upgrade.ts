import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  realpath,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import {
  readInstallation,
  readPrivateJson,
  validateRelease,
  type Installation,
  type Release,
} from "./config.ts";

type Journal = {
  schemaVersion: 1;
  id: string;
  token: string;
  snapshotReady: boolean;
};
export const upgradeJournal = (home: string) => join(home, ".upgrade.json");
async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/** New MCP launchers and server processes must not race an offline data snapshot. */
export async function assertUpgradeAccess(home: string, token?: string) {
  if (!(await exists(upgradeJournal(home)))) return;
  const journal = await readJournal(home);
  if (!token || journal.token !== token)
    throw Error(
      "An upgrade is in progress. Wait for completion or run the installer with --recover.",
    );
}
async function readJournal(home: string): Promise<Journal> {
  const j = await readPrivateJson(upgradeJournal(home));
  if (
    j.schemaVersion !== 1 ||
    !/^[a-f0-9-]{36}$/.test(j.id) ||
    !/^[a-f0-9-]{36}$/.test(j.token) ||
    typeof j.snapshotReady !== "boolean"
  )
    throw Error("Invalid upgrade recovery journal; manual recovery required");
  return j;
}
async function saveJournal(home: string, j: Journal, first = false) {
  const file = upgradeJournal(home);
  if (first)
    await writeFile(file, JSON.stringify(j), { mode: 0o600, flag: "wx" });
  else {
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(j), { mode: 0o600, flag: "wx" });
    await rename(tmp, file);
  }
}
async function regularTree(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
    throw Error(
      "Upgrade requires regular data/config files, without symlinks or special files",
    );
  if (stat.isDirectory())
    for (const name of await readdir(path)) await regularTree(join(path, name));
}
async function regularDirectory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Installation directories must not be symlinks");
}
async function verifyInstallationHome(i: Installation, home: string) {
  if (
    (await realpath(i.home)) !== home ||
    basename(i.root) !== "app" ||
    (await realpath(dirname(i.root))) !== home
  )
    throw Error("Installation directory mismatch");
}

export type UpgradeOperations = {
  stop: (installationFile: string) => Promise<void>;
  // Holds the service port while files are offline, including for legacy launchers.
  reserve: (i: Installation) => Promise<() => Promise<void>>;
  assertIdle: (i: Installation) => Promise<void>;
  verify: (token: string, release: Release) => Promise<void>;
  start: (token: string) => Promise<void>;
};
export async function reserveUpgradePort(i: Installation) {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(i.port, "127.0.0.1", yes);
  });
  return () =>
    new Promise<void>((yes, no) =>
      server.close((error) => (error ? no(error) : yes())),
    );
}

/** Restore both program and pre-migration data. Never roll an old binary onto new data. */
export async function recoverUpgrade(
  homeInput: string,
  ops: UpgradeOperations,
) {
  const home = await realpath(homeInput),
    j = await readJournal(home);
  await regularDirectory(home);
  await regularDirectory(join(home, "backups"));
  const backup = join(home, "backups", j.id);
  await regularDirectory(backup);
  const file = (await exists(join(home, "installation.json")))
    ? join(home, "installation.json")
    : join(backup, "installation.json");
  const i = await readInstallation(file);
  await verifyInstallationHome(i, home);
  await ops.stop(file);
  const releasePort = await ops.reserve(i);
  try {
    if (await exists(join(backup, "app"))) {
      if (!j.snapshotReady)
        throw Error(
          "Missing complete upgrade snapshot; manual recovery required",
        );
      // Keep unsuccessful candidate files for diagnosis instead of deleting user data.
      const failed = join(backup, `failed-${randomUUID()}`);
      await mkdir(failed, { mode: 0o700 });
      if (await exists(join(home, "app")))
        await rename(join(home, "app"), join(failed, "app"));
      for (const name of [
        "data",
        "config",
        "installation.json",
        ".release.json",
      ]) {
        if (await exists(join(home, name)))
          await rename(join(home, name), join(failed, name));
        await cp(join(backup, name), join(home, name), {
          recursive: true,
          force: false,
          errorOnExist: true,
          preserveTimestamps: true,
        });
      }
      await rename(join(backup, "app"), join(home, "app"));
    }
  } finally {
    await releasePort();
  }
  await ops.start(j.token);
  await rm(upgradeJournal(home));
  return { restored: true, backup };
}

export async function upgradeInstallation(
  homeInput: string,
  candidateInput: string,
  rawRelease: unknown,
  ops: UpgradeOperations,
) {
  if (!resolve(candidateInput).startsWith(`${resolve(homeInput)}/.install-`))
    throw Error("Candidate must be staged inside this installation");
  await regularDirectory(resolve(homeInput));
  await regularDirectory(resolve(candidateInput));
  const home = await realpath(homeInput),
    candidate = await realpath(candidateInput),
    release = validateRelease(rawRelease);
  if (
    !candidate.startsWith(`${home}/.install-`) ||
    !candidate.endsWith("/extracted/video-workbench")
  )
    throw Error("Candidate must be staged inside this installation");
  const file = join(home, "installation.json"),
    i = await readInstallation(file);
  await verifyInstallationHome(i, home);
  // Dependency managers create legitimate links inside node_modules; the archive
  // itself has already been checked before extraction by install.sh.
  const candidateStat = await lstat(candidate);
  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink())
    throw Error("Invalid candidate directory");
  await regularDirectory(home);
  await regularDirectory(join(home, "app"));
  const staging = candidate.slice(home.length + 1).split("/");
  if (staging.length !== 3) throw Error("Invalid candidate staging path");
  await regularDirectory(join(home, staging[0]));
  await regularDirectory(join(home, staging[0], "extracted"));
  const previous = validateRelease(
    await readPrivateJson(join(home, ".release.json")),
  );
  const oldVersion = previous.version.split("-")[0].split(".").map(Number);
  const newVersion = release.version.split("-")[0].split(".").map(Number);
  const differing = newVersion.findIndex(
    (part, index) => part !== oldVersion[index],
  );
  if (differing !== -1 && newVersion[differing] < oldVersion[differing])
    throw Error(
      "Downgrades require a matching data backup; use interrupted-upgrade recovery instead",
    );
  if (previous.sha256 === release.sha256) return { upgraded: false };
  if (await exists(upgradeJournal(home)))
    throw Error(
      "Interrupted upgrade found. Run the installer with --recover first.",
    );
  const j: Journal = {
    schemaVersion: 1,
    id: randomUUID(),
    token: randomUUID(),
    snapshotReady: false,
  };
  const backup = join(home, "backups", j.id);
  await mkdir(join(home, "backups"), { recursive: true, mode: 0o700 });
  await regularDirectory(join(home, "backups"));
  await mkdir(backup, { recursive: true, mode: 0o700 });
  await saveJournal(home, j, true);
  let releasePort: (() => Promise<void>) | undefined;
  try {
    await ops.stop(file);
    releasePort = await ops.reserve(i);
    await ops.assertIdle(i);
    for (const name of [
      "data",
      "config",
      "installation.json",
      ".release.json",
    ]) {
      await regularTree(join(home, name));
      await cp(join(home, name), join(backup, name), {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
      });
    }
    j.snapshotReady = true;
    await saveJournal(home, j);
    await rename(join(home, "app"), join(backup, "app"));
    await rename(candidate, join(home, "app"));
    await writeFile(join(home, ".release.json"), JSON.stringify(release), {
      mode: 0o600,
    });
    await releasePort();
    releasePort = undefined;
    await ops.verify(j.token, release);
    await ops.stop(file);
    await ops.start(j.token);
    await rm(upgradeJournal(home));
    return { upgraded: true, backup };
  } catch (error) {
    if (releasePort) {
      await releasePort();
      releasePort = undefined;
    }
    try {
      await recoverUpgrade(home, ops);
    } catch {
      throw new Error(
        "Upgrade did not complete and automatic recovery could not finish. Close MCP clients and rerun the installer with --recover. The recovery journal and backups were retained.",
        { cause: error },
      );
    }
    throw new Error(
      "Upgrade failed; the previous program, configuration and data were restored.",
      { cause: error },
    );
  }
}
