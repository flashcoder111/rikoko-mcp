import { afterEach, beforeEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportPublicSource } from "../scripts/export-public.js";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "public-export-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/app.ts"), "export const local = true;");
  await writeFile(join(root, "src/.env"), "PRIVATE=must-not-export");
  await writeFile(join(root, "src/models.local.json"), "{}");
  await writeFile(join(root, "private.key"), "not-public");
  await writeFile(join(root, "README.public.md"), "Public documentation");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: { build: "tsc", cloud: "private-cloud" },
      dependencies: {},
    }),
  );
  await writeFile(
    join(root, "public-release.json"),
    JSON.stringify({
      paths: ["src"],
      exclude: [],
      readme: "README.public.md",
      scripts: { build: "tsc" },
    }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("exports only allowlisted source, rewrites public commands, and leaves private inputs untouched", async () => {
  const out = join(root, "public");
  const result = await exportPublicSource(root, out);
  expect(result.files).toContain("src/app.ts");
  expect(result.files).not.toContain("src/.env");
  expect(result.files).not.toContain("src/models.local.json");
  expect(await readFile(join(out, "README.md"), "utf8")).toBe(
    "Public documentation",
  );
  expect(
    JSON.parse(await readFile(join(out, "package.json"), "utf8")).scripts,
  ).toEqual({ build: "tsc" });
  expect(await readFile(join(root, "private.key"), "utf8")).toBe("not-public");
  await expect(exportPublicSource(root, out)).rejects.toThrow();
});
it("refuses symlinked source rather than copying files outside the public tree", async () => {
  await symlink(join(root, "private.key"), join(root, "src/leak.ts"));
  await expect(exportPublicSource(root, join(root, "out"))).rejects.toThrow(
    /symlink/i,
  );
});
it("rejects path traversal in the release manifest", async () => {
  await writeFile(
    join(root, "public-release.json"),
    JSON.stringify({
      paths: ["../private"],
      exclude: [],
      readme: "README.public.md",
      scripts: {},
    }),
  );
  await expect(exportPublicSource(root, join(root, "out"))).rejects.toThrow(
    /path/i,
  );
});
it("rejects a selected file below a symlinked parent directory", async () => {
  await symlink(join(root, "src"), join(root, "alias"));
  await writeFile(
    join(root, "public-release.json"),
    JSON.stringify({
      paths: ["alias/app.ts"],
      exclude: [],
      readme: "README.public.md",
      scripts: {},
    }),
  );
  await expect(exportPublicSource(root, join(root, "out"))).rejects.toThrow(
    /symlink/i,
  );
});
it("refuses a new destination inside an exported source directory", async () => {
  await expect(
    exportPublicSource(root, join(root, "src/export")),
  ).rejects.toThrow(/overlap/i);
});
