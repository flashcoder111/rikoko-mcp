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
import { gunzipSync } from "node:zlib";
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
  await copyFile(
    resolve("scripts/install.ps1"),
    join(root, "scripts/install.ps1"),
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
  expect(gunzipSync(bytes).includes(Buffer.from("LIBARCHIVE.xattr."))).toBe(
    false,
  );
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
  const windows = await readFile(join(output, "install.ps1"), "utf8");
  expect(windows).not.toContain("__VWB_RELEASE_BASE64__");
  const windowsEncoded = windows.match(/\$encodedRelease = '([^']+)'/)![1];
  expect(JSON.parse(Buffer.from(windowsEncoded, "base64").toString())).toEqual(
    result.release,
  );
  expect(result.windowsCommand).toContain("/install.ps1'");
  expect(result.windowsCommand).toContain("-File $script");
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
  expect(result.windowsCommand).toContain("a''$(false)/install.ps1'");
  await promisify(execFile)("bash", ["-n", "-c", result.command]);
});

it("builds a GitHub release installer without requiring an official generation service", async () => {
  const { root, output } = await fixture();
  await writeFile(
    join(root, "package.json"),
    '{"name":"fixture","version":"0.1.12"}',
  );
  const result = await buildInstaller(
    root,
    {
      version: "0.1.12",
      downloadBaseUrl:
        "https://github.com/flashcoder111/video-workbench/releases/download/v0.1.12",
    },
    output,
  );
  expect(result.release.archiveUrl).toBe(
    "https://github.com/flashcoder111/video-workbench/releases/download/v0.1.12/video-workbench-0.1.12.tar.gz",
  );
  expect(result.release.apiUrl).toBeUndefined();
  expect(result.release.templateUrl).toBeUndefined();
  await promisify(execFile)("bash", ["-n", join(output, "install.sh")]);
});

it("refuses a release label that does not match the source version", async () => {
  const { root, output } = await fixture();
  await expect(
    buildInstaller(root, { ...config, version: "0.1.12" }, output),
  ).rejects.toThrow(/must match package.json/);
  await expect(readFile(join(output, "install.sh"))).rejects.toThrow();
});
