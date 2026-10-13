import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildInstaller } from "../scripts/build-installer.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
const config = {
  version: "0.1.0",
  downloadBaseUrl: "https://downloads.workbench.test/releases",
  apiUrl: "https://api.workbench.test",
  templateUrl: "https://templates.workbench.test",
};
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "installer-release-"));
  dirs.push(dir);
  const root = join(dir, "source");
  await mkdir(join(root, "scripts"), { recursive: true });
  await copyFile(
    resolve("scripts/install.sh"),
    join(root, "scripts/install.sh"),
  );
  await writeFile(join(root, "README.public.md"), "Fixture public source");
  await writeFile(
    join(root, "package.json"),
    '{"name":"fixture","version":"0.1.0"}',
  );
  await writeFile(
    join(root, "public-release.json"),
    JSON.stringify({
      paths: ["scripts"],
      exclude: [],
      readme: "README.public.md",
      scripts: {},
    }),
  );
  return { dir, root, output: join(dir, "release") };
}
it("builds a public, hash-verified download and a syntax-valid installer without publishing", async () => {
  const { root, output } = await fixture();
  const result = await buildInstaller(root, config, output);
  const bytes = await readFile(join(output, "video-workbench-0.1.0.tar.gz"));
  expect(result.release.sha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  expect(result.published).toBe(false);
  expect(result.command).toBe(
    "curl -fsSL 'https://downloads.workbench.test/releases/install.sh' | bash",
  );
  const script = await readFile(join(output, "install.sh"), "utf8");
  expect(script).not.toContain("__VWB_RELEASE_BASE64__");
  const encoded = script.match(/local vwb_release='([^']+)'/)![1];
  expect(JSON.parse(Buffer.from(encoded, "base64").toString())).toEqual(
    result.release,
  );
  await promisify(execFile)("bash", ["-n", join(output, "install.sh")]);
  await expect(buildInstaller(root, config, output)).rejects.toThrow();
});
it("refuses to produce a public installer with unconfigured official addresses", async () => {
  const { root, output } = await fixture();
  await expect(
    buildInstaller(
      root,
      { ...config, apiUrl: "https://api.example.com" },
      output,
    ),
  ).rejects.toThrow(/real HTTPS/);
  await expect(readFile(join(output, "install.sh"))).rejects.toThrow();
});
it("shell-quotes download paths so the displayed one-liner cannot execute URL text", async () => {
  const { root, output } = await fixture();
  const result = await buildInstaller(
    root,
    {
      ...config,
      downloadBaseUrl: "https://downloads.workbench.test/a'$(false)",
    },
    output,
  );
  expect(result.command).toContain("a'\\''$(false)");
  await promisify(execFile)("bash", ["-n", "-c", result.command]);
});
