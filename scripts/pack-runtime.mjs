import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Produce a versioned dependency for the private platform. Never publish to npm.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(process.argv[2] ?? join(root, "artifacts/runtime"));
const temporary = await mkdtemp(join(tmpdir(), "rikoko-runtime-"));
try {
  const [packed] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary],
      { cwd: root, encoding: "utf8", maxBuffer: 10_000_000 },
    ),
  );
  const forbidden = packed.files.filter(
    ({ path }) =>
      /(^|\/)(?:node_modules|\.git|\.data|\.cloud-data|artifacts|outputs|research|apps\/cloud|apps\/website|cloud-storage)(\/|$)/.test(
        path,
      ) || /(?:^|\/)\.env|\.key(?:\.admin)?$|\.local\.json$/.test(path),
  );
  if (forbidden.length)
    throw new Error(
      `Private files in runtime: ${forbidden.map((f) => f.path).join(", ")}`,
    );
  for (const required of [
    "skills/rikoko/SKILL.md",
    ...(await readdir(join(root, "skills/rikoko/references")))
      .filter((name) => /^[a-z0-9-]+\.md$/.test(name))
      .map((name) => `skills/rikoko/references/${name}`),
    "packages/db/migrations/001_core.sql",
    "packages/contracts/schemas/composition.v1.json",
    "apps/studio/dist/index.html",
    "python/media_core/cli.py",
    "packages/render/fonts/NotoSansSC.ttf",
    "packages/render/fonts/NotoSerifSC.ttf",
    "packages/render/fonts/OFL-NotoSansSC.txt",
    "packages/render/fonts/OFL-NotoSerifSC.txt",
  ]) {
    if (!packed.files.some((f) => f.path === required))
      throw new Error(
        `Missing runtime file: ${required}; run pnpm build first`,
      );
  }
  const bytes = await readFile(join(temporary, packed.filename));
  await mkdir(destination, { recursive: true });
  const target = join(destination, packed.filename);
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!(await readFile(target)).equals(bytes))
      throw new Error(
        "Runtime version already exists with different bytes; increment package.json version first",
      );
  }
  const manifest = {
    name: packed.name,
    version: packed.version,
    file: packed.filename,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: packed.integrity,
    files: packed.files.map((f) => f.path),
  };
  await writeFile(
    join(destination, `${packed.filename}.json`),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        file: target,
        sha256: manifest.sha256,
        files: manifest.files.length,
        published: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
