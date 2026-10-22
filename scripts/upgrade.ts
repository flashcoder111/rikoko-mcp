// Invoked only for the installer-owned home, never for a source checkout.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  recoverUpgrade,
  reserveUpgradePort,
  upgradeInstallation,
  type UpgradeOperations,
} from "../packages/bootstrap/src/upgrade.ts";
import {
  ensureBackend,
  stopBackend,
} from "../packages/bootstrap/src/managed.ts";

const [mode, homeArg, candidate, releaseFile] = process.argv.slice(2);
if (
  !["apply", "recover"].includes(mode) ||
  !homeArg ||
  (mode === "apply" && (!candidate || !releaseFile))
)
  throw Error(
    "Usage: upgrade.ts apply <home> <candidate> <release.json> | recover <home>",
  );
const home = resolve(homeArg),
  file = join(home, "installation.json");
const ops: UpgradeOperations = {
  stop: stopBackend,
  reserve: reserveUpgradePort,
  async assertIdle(i) {
    // Use the installed database engine without applying candidate migrations.
    const { PGlite } = await import(
      pathToFileURL(
        join(i.root, "node_modules/@electric-sql/pglite/dist/index.js"),
      ).href
    );
    const db = new PGlite(join(home, "data/db"));
    try {
      const result = await db.query(
        "SELECT count(*)::int AS count FROM entities WHERE type='job' AND COALESCE(data->>'status','') NOT IN ('completed','failed','cancelled')",
      );
      if (result.rows[0].count !== 0)
        throw Error(
          "Unfinished jobs exist. Finish or reconcile them before upgrading.",
        );
    } finally {
      await db.close();
    }
  },
  async verify(token, release) {
    const root = join(home, "app");
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (pkg.version !== release.version)
      throw Error("Candidate package version differs from release metadata");
    await promisify(execFile)(
      process.execPath,
      [
        "--experimental-strip-types",
        join(root, "scripts/setup.ts"),
        "--home",
        home,
        "--release",
        join(home, ".release.json"),
        "--client",
        "none",
      ],
      {
        cwd: root,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          RIKOKO_OFFICIAL_KEY: "",
          RIKOKO_UPGRADE_TOKEN: token,
          RIKOKO_UPGRADE_VERIFY: "1",
        },
      },
    );
  },
  async start(token) {
    process.env.RIKOKO_UPGRADE_TOKEN = token;
    delete process.env.RIKOKO_UPGRADE_VERIFY;
    try {
      await ensureBackend(file);
    } finally {
      delete process.env.RIKOKO_UPGRADE_TOKEN;
    }
  },
};
const workerFile = join(home, ".install-lock/worker-pid");
await writeFile(workerFile, String(process.pid), { mode: 0o600, flag: "wx" });
try {
  const result =
    mode === "recover"
      ? await recoverUpgrade(home, ops)
      : await upgradeInstallation(
          home,
          candidate,
          JSON.parse(await readFile(releaseFile, "utf8")),
          ops,
        );
  console.log(JSON.stringify(result));
} finally {
  await unlink(workerFile);
}
