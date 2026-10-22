import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  inspectLegacySkill,
  archiveLegacySkill,
  restoreLegacySkill,
  recoverMigrationLock,
} from "../packages/bootstrap/src/skill-migration.js";
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const p of dirs.splice(0)) await rm(p, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "guide-migration-"));
  dirs.push(root);
  const source = join(root, "host/skills/rikoko"),
    archives = join(root, "archives");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "official", { mode: 0o600 });
  const known = [
    {
      revision: "fixture",
      files: {
        "SKILL.md": createHash("sha256").update("official").digest("hex"),
      },
    },
  ];
  return { source, archives, known };
}
it("archives only recognized bytes after backend verification and restores exactly", async () => {
  const f = await fixture();
  const before = await inspectLegacySkill(f.source, f.known);
  expect(before.status).toBe("official");
  await expect(
    archiveLegacySkill(f.source, f.archives, false, f.known),
  ).rejects.toThrow("backend");
  const result = await archiveLegacySkill(f.source, f.archives, true, f.known);
  expect((await inspectLegacySkill(f.source, f.known)).status).toBe("absent");
  expect(
    (await archiveLegacySkill(f.source, f.archives, true, f.known)).status,
  ).toBe("absent");
  await restoreLegacySkill(f.source, f.archives, result.backupId!);
  expect(await readFile(join(f.source, "SKILL.md"), "utf8")).toBe("official");
  expect((await stat(join(f.source, "SKILL.md"))).mode & 0o777).toBe(0o600);
});
it("keeps modified files, personal references and linked targets untouched", async () => {
  const f = await fixture();
  await writeFile(join(f.source, "personal.md"), "experience");
  expect((await inspectLegacySkill(f.source, f.known)).status).toBe(
    "needs_review",
  );
  await expect(
    archiveLegacySkill(f.source, f.archives, true, f.known),
  ).rejects.toThrow("review");
  await rm(f.source, { recursive: true });
  const target = join(dirs.at(-1)!, "shared");
  await mkdir(target);
  await writeFile(join(target, "SKILL.md"), "personal");
  await symlink(target, f.source);
  expect((await inspectLegacySkill(f.source, f.known)).status).toBe(
    "needs_review",
  );
  await expect(
    archiveLegacySkill(f.source, f.archives, true, f.known),
  ).rejects.toThrow();
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("personal");
});
it("never overwrites a new skill or restores changed archives", async () => {
  const f = await fixture();
  const result = await archiveLegacySkill(f.source, f.archives, true, f.known);
  await mkdir(f.source);
  await expect(
    restoreLegacySkill(f.source, f.archives, result.backupId!),
  ).rejects.toThrow("exists");
  await rm(f.source, { recursive: true });
  await writeFile(
    join(f.archives, result.backupId!, "skill/SKILL.md"),
    "changed",
  );
  await expect(
    restoreLegacySkill(f.source, f.archives, result.backupId!),
  ).rejects.toThrow("changed");
});

it("archives a customized copy only when its exact preview fingerprint is explicitly accepted", async () => {
  const f = await fixture();
  await writeFile(join(f.source, "SKILL.md"), "my direction");
  const preview = await inspectLegacySkill(f.source, f.known);
  await expect(
    archiveLegacySkill(f.source, f.archives, true, f.known, "0".repeat(64)),
  ).rejects.toThrow("review");
  const backup = await archiveLegacySkill(
    f.source,
    f.archives,
    true,
    f.known,
    preview.fingerprint,
  );
  await restoreLegacySkill(f.source, f.archives, backup.backupId!);
  expect(await readFile(join(f.source, "SKILL.md"), "utf8")).toBe(
    "my direction",
  );
});
it("refuses a shared skills container and preserves the target", async () => {
  const f = await fixture();
  const shared = join(dirs.at(-1)!, "shared");
  await mkdir(shared);
  await rm(f.source, { recursive: true });
  await rm(join(f.source, ".."), { recursive: true });
  await symlink(shared, join(f.source, ".."));
  await mkdir(join(shared, "rikoko"));
  await writeFile(join(shared, "rikoko/SKILL.md"), "official");
  expect((await inspectLegacySkill(f.source, f.known)).status).toBe(
    "needs_review",
  );
  await expect(
    archiveLegacySkill(f.source, f.archives, true, f.known),
  ).rejects.toThrow("review");
  expect(await readFile(join(shared, "rikoko/SKILL.md"), "utf8")).toBe(
    "official",
  );
});
it("an active migration lock cannot be recovered or raced", async () => {
  const { recoverMigrationLock } =
    await import("../packages/bootstrap/src/skill-migration.js");
  const f = await fixture();
  await mkdir(join(f.archives, ".migration-lock"), { recursive: true });
  await writeFile(
    join(f.archives, ".migration-lock/owner.json"),
    JSON.stringify({ pid: process.pid }),
  );
  await expect(
    archiveLegacySkill(f.source, f.archives, true, f.known),
  ).rejects.toThrow("lock");
  await expect(recoverMigrationLock(f.archives)).rejects.toThrow("active");
  expect(await readFile(join(f.source, "SKILL.md"), "utf8")).toBe("official");
});

it("serializes stale recovery against another recoverer and a new migration", async () => {
  const f = await fixture();
  await mkdir(join(f.archives, ".migration-lock"), { recursive: true });
  await writeFile(
    join(f.archives, ".migration-lock/owner.json"),
    JSON.stringify({ pid: 123456789 }),
  );
  const interleaved: Promise<unknown>[] = [];
  vi.spyOn(process, "kill").mockImplementation(() => {
    // Both operations begin after the stale owner was inspected, before retirement.
    interleaved.push(
      recoverMigrationLock(f.archives).catch((error) => error),
      archiveLegacySkill(f.source, f.archives, true, f.known).catch(
        (error) => error,
      ),
    );
    throw Object.assign(new Error("exited"), { code: "ESRCH" });
  });
  expect(await recoverMigrationLock(f.archives)).toEqual({
    status: "recovered",
  });
  for (const result of await Promise.all(interleaved)) {
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("guard");
  }
  vi.restoreAllMocks();
  expect(
    (await archiveLegacySkill(f.source, f.archives, true, f.known)).status,
  ).toBe("archived");
});

it("preserves an interrupted guard for manual inspection", async () => {
  const f = await fixture();
  await mkdir(join(f.archives, ".migration-guard"), { recursive: true });
  await expect(recoverMigrationLock(f.archives)).rejects.toThrow("manually");
  await expect(
    archiveLegacySkill(f.source, f.archives, true, f.known),
  ).rejects.toThrow("guard");
  expect(await readFile(join(f.source, "SKILL.md"), "utf8")).toBe("official");
});
