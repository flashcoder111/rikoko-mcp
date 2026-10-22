import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeInstallation } from "../packages/bootstrap/src/config.ts";
import {
  assertUpgradeAccess,
  recoverUpgrade,
  upgradeInstallation,
  type UpgradeOperations,
} from "../packages/bootstrap/src/upgrade.ts";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "rikoko-upgrade-"));
  homes.push(home);
  const release = {
    version: "0.1.30",
    archiveUrl: "https://downloads.rikoko.test/source.tar.gz",
    sha256: "a".repeat(64),
  };
  await initializeInstallation({
    home,
    root: join(home, "app"),
    release,
    node: process.execPath,
    python: "/fixture/python",
    path: process.env.PATH!,
  });
  await mkdir(join(home, "app"));
  await writeFile(join(home, "app/version"), "old");
  await writeFile(join(home, "data/project"), "user project");
  await writeFile(join(home, ".release.json"), JSON.stringify(release), {
    mode: 0o600,
  });
  const candidate = join(home, ".install-test/extracted/video-workbench");
  await mkdir(candidate, { recursive: true });
  await writeFile(join(candidate, "version"), "new");
  const unreserve = vi.fn(async () => {});
  const ops: UpgradeOperations = {
    stop: vi.fn(async () => {}),
    reserve: vi.fn(async () => unreserve),
    assertIdle: vi.fn(async () => {}),
    verify: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
  };
  return {
    home,
    candidate,
    release: { ...release, sha256: "b".repeat(64) },
    ops,
    unreserve,
  };
}
it("stages an upgrade, retains identity/config/data and protects the snapshot", async () => {
  const f = await fixture();
  const identity = await readFile(join(f.home, "installation.json"), "utf8");
  const config = await readFile(join(f.home, "config/models.json"), "utf8");
  f.ops.verify = vi.fn(async (token) => {
    await expect(assertUpgradeAccess(f.home)).rejects.toThrow("upgrade");
    await expect(assertUpgradeAccess(f.home, token)).resolves.toBeUndefined();
    expect(await readFile(join(f.home, "app/version"), "utf8")).toBe("new");
  });
  const result = await upgradeInstallation(
    f.home,
    f.candidate,
    f.release,
    f.ops,
  );
  expect(result.upgraded).toBe(true);
  expect(await readFile(join(f.home, "installation.json"), "utf8")).toBe(
    identity,
  );
  expect(await readFile(join(f.home, "config/models.json"), "utf8")).toBe(
    config,
  );
  expect(await readFile(join(f.home, "data/project"), "utf8")).toBe(
    "user project",
  );
  expect(await readFile(join(result.backup!, "app/version"), "utf8")).toBe(
    "old",
  );
  expect((await stat(result.backup!)).mode & 0o777).toBe(0o700);
  expect(f.unreserve).toHaveBeenCalledOnce();
  await expect(assertUpgradeAccess(f.home)).resolves.toBeUndefined();
});
it("restores the old application AND pre-migration data when verification fails", async () => {
  const f = await fixture();
  f.ops.verify = vi.fn(async () => {
    await writeFile(join(f.home, "data/project"), "new incompatible schema");
    await writeFile(join(f.home, "config/models.json"), "changed");
    throw Error("verification failure");
  });
  await expect(
    upgradeInstallation(f.home, f.candidate, f.release, f.ops),
  ).rejects.toThrow("restored");
  expect(await readFile(join(f.home, "app/version"), "utf8")).toBe("old");
  expect(await readFile(join(f.home, "data/project"), "utf8")).toBe(
    "user project",
  );
  expect(
    JSON.parse(await readFile(join(f.home, ".release.json"), "utf8")).sha256,
  ).toBe("a".repeat(64));
  expect(
    JSON.parse(await readFile(join(f.home, "config/models.json"), "utf8")).mode,
  ).toBe("custom");
});
it("refuses unfinished jobs without replacing the program or data", async () => {
  const f = await fixture();
  f.ops.assertIdle = vi.fn(async () => {
    throw Error("Unfinished jobs");
  });
  await expect(
    upgradeInstallation(f.home, f.candidate, f.release, f.ops),
  ).rejects.toThrow("restored");
  expect(f.ops.verify).not.toHaveBeenCalled();
  expect(await readFile(join(f.home, "app/version"), "utf8")).toBe("old");
});
it("retains recovery state when restart fails and supports an explicit retry", async () => {
  const f = await fixture();
  f.ops.start = vi.fn(async () => {
    throw Error("cannot start");
  });
  await expect(
    upgradeInstallation(f.home, f.candidate, f.release, f.ops),
  ).rejects.toThrow("--recover");
  await expect(assertUpgradeAccess(f.home)).rejects.toThrow("upgrade");
  f.ops.start = vi.fn(async () => {});
  await recoverUpgrade(f.home, f.ops);
  expect(await readFile(join(f.home, "app/version"), "utf8")).toBe("old");
  await expect(assertUpgradeAccess(f.home)).resolves.toBeUndefined();
});
it("does not overwrite a pending recovery journal", async () => {
  const f = await fixture();
  await writeFile(join(f.home, ".upgrade.json"), "pending", { mode: 0o600 });
  await expect(
    upgradeInstallation(f.home, f.candidate, f.release, f.ops),
  ).rejects.toThrow("--recover");
  expect(f.ops.stop).not.toHaveBeenCalled();
  expect(await readFile(join(f.home, ".upgrade.json"), "utf8")).toBe("pending");
});
it("rejects a candidate outside the staging directory before any changes", async () => {
  const f = await fixture();
  await expect(
    upgradeInstallation(f.home, "/tmp/other", f.release, f.ops),
  ).rejects.toThrow("staged");
  expect(f.ops.stop).not.toHaveBeenCalled();
  expect(await readdir(join(f.home, "data"))).toEqual(["project"]);
});

it("refuses to run an older release against newer data", async () => {
  const f = await fixture();
  await expect(
    upgradeInstallation(
      f.home,
      f.candidate,
      { ...f.release, version: "0.1.12" },
      f.ops,
    ),
  ).rejects.toThrow("Downgrades");
  expect(f.ops.stop).not.toHaveBeenCalled();
});
