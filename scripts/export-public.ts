import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, lstat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { requiredSkillReferences } from "../packages/bootstrap/src/skill-files.js";

const safePath = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !isAbsolute(p) &&
      !p.includes("\\") &&
      !p.split("/").some((part) => !part || part === ".." || part === "."),
    "Invalid release path",
  );
const manifestSchema = z
  .object({
    paths: z.array(safePath).min(1),
    exclude: z.array(safePath),
    readme: safePath,
    scripts: z.record(z.string(), z.string()),
  })
  .strict();
function excluded(path: string, explicit: string[]) {
  return (
    explicit.some((p) => path === p || path.startsWith(`${p}/`)) ||
    path
      .split("/")
      .some(
        (part) =>
          [
            "node_modules",
            "dist",
            "coverage",
            "__pycache__",
            ".venv",
            ".git",
            ".data",
            ".cloud-data",
            ".DS_Store",
          ].includes(part) ||
          (part.startsWith(".env") && part !== ".env.example") ||
          /(?:\.local\.json|\.key(?:\.admin)?|\.pyc|\.log)$/.test(part),
      )
  );
}

/** Produces a reviewable source snapshot only; never initializes Git or publishes anything. */
export async function exportPublicSource(root: string, destination: string) {
  const source = resolve(root),
    output = resolve(destination);
  const contains = (parent: string, child: string) => {
    const path = relative(parent, child);
    return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
  };
  if (contains(output, source))
    throw Error("Output path must not contain the source workspace");
  async function rejectSymlinks(path: string) {
    let current = source;
    for (const part of path.split("/")) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink())
        throw Error(`Refusing symlink in public source: ${path}`);
    }
  }
  await rejectSymlinks("public-release.json");
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(join(source, "public-release.json"), "utf8")),
  );
  for (const path of manifest.paths) {
    if (contains(join(source, path), output))
      throw Error("Output path overlaps selected source");
    await rejectSymlinks(path);
  }
  const selected = new Map<string, { bytes: Buffer; mode: number }>();
  async function collect(path: string) {
    if (excluded(path, manifest.exclude)) return;
    const absolute = join(source, path);
    if (absolute === output || absolute.startsWith(output + "/"))
      throw Error("Output path overlaps selected source");
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink())
      throw Error(`Refusing symlink in public source: ${path}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(absolute)).sort())
        await collect(`${path}/${name}`);
    } else if (stat.isFile())
      selected.set(path, {
        bytes: await readFile(absolute),
        mode: stat.mode & 0o111 ? 0o755 : 0o644,
      });
    else throw Error(`Unsupported file in public source: ${path}`);
  }
  for (const path of manifest.paths) await collect(path);
  for (const [path, file] of selected) {
    if (!path.endsWith("/SKILL.md")) continue;
    for (const ref of requiredSkillReferences(file.bytes.toString("utf8"))) {
      if (
        !/^references\/[a-z0-9-]+\.md$/.test(ref) ||
        !selected
          .get(`${dirname(path)}/${ref}`)
          ?.bytes.toString("utf8")
          .trim()
      )
        throw Error(
          `Required skill reference is absent from public export: ${dirname(path)}/${ref}`,
        );
    }
  }
  for (const path of ["package.json", manifest.readme]) {
    await rejectSymlinks(path);
  }
  const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  selected.set("package.json", {
    bytes: Buffer.from(
      JSON.stringify(
        { ...pkg, private: true, scripts: manifest.scripts },
        null,
        2,
      ) + "\n",
    ),
    mode: 0o644,
  });
  selected.set("README.md", {
    bytes: await readFile(join(source, manifest.readme)),
    mode: 0o644,
  });
  // Fail on an existing destination. Never wipe a previous export or user directory.
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const hashes: Record<string, string> = {};
  for (const [path, { bytes, mode }] of selected) {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await writeFile(join(output, path), bytes, { flag: "wx", mode });
    hashes[path] = createHash("sha256").update(bytes).digest("hex");
  }
  await writeFile(
    join(output, "SOURCE_MANIFEST.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        status: "local-review-snapshot",
        files: hashes,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  return { directory: output, files: [...selected.keys()].sort() };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const destination = join(
    root,
    "artifacts/public-source",
    new Date().toISOString().replaceAll(":", "-"),
  );
  const result = await exportPublicSource(root, destination);
  console.log(
    JSON.stringify(
      {
        directory: result.directory,
        fileCount: result.files.length,
        published: false,
      },
      null,
      2,
    ),
  );
}
