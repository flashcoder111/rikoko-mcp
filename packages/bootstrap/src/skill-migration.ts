import {
  readFile,
  readdir,
  lstat,
  mkdir,
  rename,
  writeFile,
  rm,
  readlink,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import knownVersions from "./legacy-skill-manifests.json";
type Known = { revision: string; files: Record<string, string> };
type Entry = {
  kind: "file" | "directory" | "link" | "other";
  sha256?: string;
  mode: number;
  target?: string;
};
const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
async function inventory(path: string) {
  const entries: Record<string, Entry> = {};
  async function visit(relative: string) {
    const absolute = join(path, relative),
      info = await lstat(absolute);
    const mode = info.mode & 0o777;
    if (info.isSymbolicLink()) {
      entries[relative] = {
        kind: "link",
        mode,
        target: await readlink(absolute),
      };
      return;
    }
    if (info.isDirectory()) {
      entries[relative] = { kind: "directory", mode };
      for (const child of (await readdir(absolute)).sort())
        await visit(relative ? `${relative}/${child}` : child);
      return;
    }
    if (info.isFile() && info.size <= 2_000_000)
      entries[relative] = {
        kind: "file",
        mode,
        sha256: hash(await readFile(absolute)),
      };
    else entries[relative] = { kind: "other", mode };
  }
  await visit("");
  return entries;
}
async function linkedContainer(path: string) {
  // Host/skills and Host may themselves be shared links. Never mutate their targets.
  for (const parent of [
    dirname(resolve(path)),
    dirname(dirname(resolve(path))),
  ]) {
    try {
      if ((await lstat(parent)).isSymbolicLink()) return parent;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}
/** Never follows symlinks, or treats the managed marker as ownership proof. */
export async function inspectLegacySkill(
  path: string,
  known: Known[] = knownVersions,
) {
  const linked = await linkedContainer(path);
  if (linked)
    return { status: "needs_review" as const, path, linkedContainer: linked };
  if (!(await exists(path))) return { status: "absent" as const, path };
  const entries = await inventory(path);
  const files = Object.fromEntries(
    Object.entries(entries)
      .filter(([, e]) => e.kind === "file")
      .map(([p, e]) => [p, e.sha256]),
  );
  const match = known.find((v) => {
    const expectedDirs = new Set([""]);
    for (const p of Object.keys(v.files)) {
      let d = dirname(p);
      while (d !== ".") {
        expectedDirs.add(d);
        d = dirname(d);
      }
    }
    return (
      Object.entries(entries).every(([p, e]) =>
        e.kind === "file"
          ? v.files[p] === e.sha256
          : e.kind === "directory" && expectedDirs.has(p),
      ) &&
      JSON.stringify(Object.entries(files).sort()) ===
        JSON.stringify(Object.entries(v.files).sort())
    );
  });
  return {
    status: match ? ("official" as const) : ("needs_review" as const),
    path,
    revision: match?.revision,
    entries,
    fingerprint: hash(JSON.stringify(entries)),
  };
}
async function guarded<T>(root: string, work: () => Promise<T>) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink())
    throw Error("Archive directory must not be a symlink");
  const guard = join(root, ".migration-guard");
  try {
    await mkdir(guard, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw Error(
        "Migration guard exists: retry after the operation finishes; if interrupted, inspect its owner manually. No files changed.",
      );
    throw error;
  }
  try {
    await writeFile(
      join(guard, "owner.json"),
      JSON.stringify({ pid: process.pid }),
      { flag: "wx", mode: 0o600 },
    );
    return await work();
  } finally {
    await rm(guard, { recursive: true });
  }
}
async function locked<T>(root: string, work: () => Promise<T>) {
  const lock = join(root, ".migration-lock");
  // Acquisition and stale-lock recovery must serialize against the same guard.
  await guarded(root, async () => {
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw Error(
          "Migration lock exists: another operation may be active. If its owner has exited, use migrate-skill --recover-lock. No files changed.",
        );
      throw error;
    }
    try {
      await writeFile(
        join(lock, "owner.json"),
        JSON.stringify({ pid: process.pid }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      await rm(lock, { recursive: true });
      throw error;
    }
  });
  try {
    return await work();
  } finally {
    await rm(lock, { recursive: true });
  }
}
export async function archiveLegacySkill(
  path: string,
  archiveRoot: string,
  backendVerified: boolean,
  known: Known[] = knownVersions,
  approvedFingerprint?: string,
): Promise<{ status: string; backupId?: string }> {
  const source = resolve(path),
    root = resolve(archiveRoot);
  if (root === source || root.startsWith(source + "/"))
    throw Error("Archive must be outside the skill directory");
  return locked(root, async () => {
    const inspection = await inspectLegacySkill(source, known);
    if (inspection.status === "absent") return { status: "absent" };
    if (!backendVerified)
      throw Error("Verify the MCP-only backend before migration");
    const explicitlyReviewed =
      !!approvedFingerprint &&
      inspection.fingerprint === approvedFingerprint &&
      inspection.entries &&
      Object.values(inspection.entries).every(
        (e) => e.kind === "file" || e.kind === "directory",
      );
    if (inspection.status !== "official" && !explicitlyReviewed)
      throw Error("Local changes or links need review; no files were removed");
    const backupId = randomUUID(),
      backup = join(root, backupId);
    await mkdir(backup, { mode: 0o700 });
    await writeFile(
      join(backup, "migration.json"),
      JSON.stringify({ version: 1, source, backupId, inspection }, null, 2) +
        "\n",
      { mode: 0o600, flag: "wx" },
    );
    if (
      (await inspectLegacySkill(source, known)).fingerprint !==
      inspection.fingerprint
    )
      throw Error("Skill changed during migration; retry inspection");
    // Atomic move preserves bytes and modes; cross-device errors leave the source intact.
    await rename(source, join(backup, "skill"));
    return { status: "archived", backupId };
  });
}
export async function restoreLegacySkill(
  path: string,
  archiveRoot: string,
  backupId: string,
) {
  if (!/^[a-f0-9-]{36}$/.test(backupId)) throw Error("Invalid backup ID");
  const source = resolve(path),
    root = resolve(archiveRoot);
  return locked(root, async () => {
    if (await linkedContainer(source))
      throw Error("Linked destination container needs manual review");
    const backup = join(root, backupId);
    if ((await lstat(backup)).isSymbolicLink())
      throw Error("Invalid linked backup");
    const meta = JSON.parse(
      await readFile(join(backup, "migration.json"), "utf8"),
    );
    if (
      meta.source !== source ||
      meta.backupId !== backupId ||
      meta.version !== 1
    )
      throw Error("Backup belongs to another installation");
    if (await exists(source))
      throw Error("Destination already exists; nothing overwritten");
    const payload = join(backup, "skill");
    if (
      (await lstat(payload)).isSymbolicLink() ||
      hash(JSON.stringify(await inventory(payload))) !==
        meta.inspection.fingerprint
    )
      throw Error("Backup changed; preserve it for manual recovery");
    await mkdir(dirname(source), { recursive: true });
    await rename(payload, source);
    return { status: "restored", path: source, backupId };
  });
}

/** Explicit recovery only; never kills a process or guesses that an active lock expired. */
export async function recoverMigrationLock(archiveRoot: string) {
  const root = resolve(archiveRoot),
    lock = join(root, ".migration-lock");
  if (!(await exists(root))) return { status: "absent" };
  return guarded(root, async () => {
    if (!(await exists(lock))) return { status: "absent" };
    if (
      (await lstat(root)).isSymbolicLink() ||
      (await lstat(lock)).isSymbolicLink()
    )
      throw Error("Linked migration lock needs manual review");
    const { pid } = JSON.parse(
      await readFile(join(lock, "owner.json"), "utf8"),
    );
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw Error("Unknown lock owner; inspect manually");
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        throw Error("Cannot establish that the migration owner exited");
      const retired = join(root, `.retired-lock-${randomUUID()}`);
      await rename(lock, retired);
      await rm(retired, { recursive: true });
      return { status: "recovered" };
    }
    throw Error("Migration owner is still active; no files changed");
  });
}
