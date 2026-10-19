import {
  readdir,
  mkdir,
  readFile,
  writeFile,
  rename,
  lstat,
  copyFile,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
export function requiredSkillReferences(skill: string) {
  return [
    ...new Set(
      [...skill.matchAll(/\]\((references\/[^)]+)\)/g)].map((m) => m[1]),
    ),
  ];
}

/** Update only the managed skill; never touch host settings, credentials or backend state. */
export async function installManagedSkill(source: string, destination: string) {
  const skill = await readFile(join(source, "SKILL.md"), "utf8");
  await validateSkillReferences(source);
  await mkdir(destination, { recursive: true });
  if (!(await lstat(destination)).isDirectory())
    throw Error("Skill destination must be a regular directory");
  const target = join(destination, "SKILL.md");
  let current = "";
  try {
    if (!(await lstat(target)).isFile())
      throw Error("Skill target must be a regular file");
    current = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (
    current &&
    current !== skill &&
    !current.includes("<!-- Managed by the rikoko installer.")
  )
    throw Error(`A different rikoko skill already exists at ${target}`);

  // Publish the entrypoint after its required files are present.
  const references = await installSkillReferences(source, destination);
  if (current !== skill) {
    if (current) {
      const backup = `${target}.rikoko-${Date.now()}.bak`;
      await copyFile(target, backup);
      await chmod(backup, 0o600);
    }
    const temporary = `${target}.rikoko-${process.pid}.tmp`;
    await writeFile(temporary, skill, { mode: 0o644, flag: "wx" });
    await rename(temporary, target);
  }
  return { path: target, updated: current !== skill, references };
}
export async function validateSkillReferences(source: string) {
  let skill: string;
  try {
    skill = await readFile(join(source, "SKILL.md"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const reference of requiredSkillReferences(skill)) {
    if (!/^references\/[a-z0-9-]+\.md$/.test(reference))
      throw Error(`Invalid skill reference: ${reference}`);
    try {
      if (
        (await lstat(join(source, "references"))).isSymbolicLink() ||
        !(await lstat(join(source, reference))).isFile()
      )
        throw Error("Expected regular reference files");
      if (!(await readFile(join(source, reference), "utf8")).trim())
        throw Error("Empty reference");
    } catch {
      throw Error(
        `Required skill reference is missing or invalid: ${reference}`,
      );
    }
  }
}
/** Ship supporting playbooks along with SKILL.md; back up edited copies before replacing. */
export async function installSkillReferences(
  source: string,
  destination: string,
) {
  await validateSkillReferences(source);
  const from = join(source, "references"),
    to = join(destination, "references");
  let entries;
  try {
    entries = await readdir(from, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  await mkdir(to, { recursive: true });
  if ((await lstat(to)).isSymbolicLink())
    throw Error("Skill references directory must not be a symlink");
  const installed = [];
  for (const file of entries) {
    if (!file.isFile() || !/^[a-z0-9-]+\.md$/.test(file.name)) continue;
    const target = join(to, file.name),
      bytes = await readFile(join(from, file.name));
    try {
      if (!(await lstat(target)).isFile())
        throw Error("Skill reference target must be a regular file");
      if (bytes.equals(await readFile(target))) {
        installed.push(file.name);
        continue;
      }
      await copyFile(target, `${target}.rikoko-${Date.now()}.bak`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const temp = `${target}.rikoko-${process.pid}.tmp`;
    await writeFile(temp, bytes, { mode: 0o644, flag: "wx" });
    await rename(temp, target);
    installed.push(file.name);
  }
  return installed;
}
