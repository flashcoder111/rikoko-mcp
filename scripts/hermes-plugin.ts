import {
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
  lstat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.HERMES_HOME ?? join(homedir(), ".hermes");
const directory = join(home, "desktop-plugins", "rikoko-workspace");
const target = join(directory, "plugin.js");
const source = await readFile(
  join(root, "integrations/hermes/desktop-plugin.js"),
  "utf8",
);
const marker = "// rikoko managed Hermes Desktop plugin.";
await mkdir(directory, { recursive: true, mode: 0o700 });
if ((await lstat(directory)).isSymbolicLink())
  throw Error("Refusing a symlink plugin directory.");
try {
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error("Plugin target must be a regular file.");
  const existing = await readFile(target, "utf8");
  if (!existing.startsWith(marker))
    throw Error(
      "Existing plugin is not managed by rikoko; no changes written.",
    );
  if (existing === source) {
    console.log("rikoko Hermes desktop plugin is already up to date.");
    process.exit(0);
  }
  await copyFile(target, `${target}.${Date.now()}.bak`);
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const temporary = `${target}.${process.pid}.tmp`;
await writeFile(temporary, source, { mode: 0o600, flag: "wx" });
await rename(temporary, target);
console.log(
  "Installed rikoko Hermes desktop plugin. Hermes watches for updates; if needed use Reload desktop plugins. No message was sent.",
);
