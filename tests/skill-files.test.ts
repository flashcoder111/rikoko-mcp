import { expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  symlink,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installSkillReferences } from "../packages/bootstrap/src/skill-files.js";
it("ships playbooks, preserves unrelated user files and backs up edited managed copies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skill-files-"));
  try {
    const source = join(dir, "source"),
      dest = join(dir, "dest");
    await mkdir(join(source, "references"), { recursive: true });
    await mkdir(join(dest, "references"), { recursive: true });
    await writeFile(join(source, "references/video-direction.md"), "new");
    await writeFile(join(dest, "references/video-direction.md"), "user edits");
    await writeFile(join(dest, "references/personal.md"), "keep");
    expect(await installSkillReferences(source, dest)).toEqual([
      "video-direction.md",
    ]);
    expect(
      await readFile(join(dest, "references/video-direction.md"), "utf8"),
    ).toBe("new");
    expect(await readFile(join(dest, "references/personal.md"), "utf8")).toBe(
      "keep",
    );
    const files = await readdir(join(dest, "references"));
    expect(files.filter((f) => f.endsWith(".bak"))).toHaveLength(1);
    await installSkillReferences(source, dest);
    expect(await readdir(join(dest, "references"))).toEqual(files);
    const linked = join(dir, "linked");
    await mkdir(linked);
    await symlink(join(dest, "references"), join(linked, "references"));
    await expect(installSkillReferences(source, linked)).rejects.toThrow(
      "symlink",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
