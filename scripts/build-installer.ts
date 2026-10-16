import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateRelease } from "../packages/bootstrap/src/config.ts";
import { exportPublicSource } from "./export-public.js";

/** Build local artifacts only. Publication and live endpoint verification are separate. */
export async function buildInstaller(
  root: string,
  config: {
    version: string;
    downloadBaseUrl: string;
    apiUrl?: string;
    templateUrl?: string;
  },
  output: string,
) {
  const name = `video-workbench-${config.version}.tar.gz`;
  const base = new URL(config.downloadBaseUrl);
  if (
    base.search ||
    base.hash ||
    base.username ||
    base.password ||
    base.protocol !== "https:"
  )
    throw Error("Expected a public HTTPS download directory");
  const archiveUrl = `${config.downloadBaseUrl.replace(/\/$/, "")}/${name}`;
  validateRelease({ ...config, archiveUrl, sha256: "0".repeat(64) });
  await mkdir(output); // Never overwrite an existing release.
  await exportPublicSource(root, join(output, "video-workbench"));
  await promisify(execFile)(
    "tar",
    ["-czf", join(output, name), "-C", output, "video-workbench"],
    {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    },
  );
  const sha256 = createHash("sha256")
    .update(await readFile(join(output, name)))
    .digest("hex");
  const release = validateRelease({ ...config, archiveUrl, sha256 });
  const template = await readFile(join(root, "scripts/install.sh"), "utf8");
  if (template.split("__VWB_RELEASE_BASE64__").length !== 2)
    throw Error("Installer template marker must occur exactly once");
  const installer = template.replace(
    "__VWB_RELEASE_BASE64__",
    Buffer.from(JSON.stringify(release)).toString("base64"),
  );
  await writeFile(join(output, "install.sh"), installer, {
    mode: 0o755,
    flag: "wx",
  });
  await writeFile(
    join(output, "release.json"),
    JSON.stringify(release, null, 2) + "\n",
    { flag: "wx" },
  );
  await writeFile(join(output, `${name}.sha256`), `${sha256}  ${name}\n`, {
    flag: "wx",
  });
  const url = `${config.downloadBaseUrl.replace(/\/$/, "")}/install.sh`;
  const quoted = `'${url.replaceAll("'", "'\\''")}'`;
  const command = `curl -fsSL ${quoted} | bash`;
  return { directory: output, command, published: false, release };
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const input = process.argv[2];
  if (!input)
    throw Error(
      "Usage: pnpm release:installer config/distribution.local.json [new-output-directory]",
    );
  const config = JSON.parse(await readFile(input, "utf8"));
  const output = resolve(
    process.argv[3] ??
      join(
        root,
        "artifacts/installers",
        new Date().toISOString().replaceAll(":", "-"),
      ),
  );
  await mkdir(dirname(output), { recursive: true });
  console.log(
    JSON.stringify(await buildInstaller(root, config, output), null, 2),
  );
}
