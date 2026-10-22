import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exportPublicSource } from "./export-public.js";
import { checkReleaseEvidence, sourceFingerprint } from "./release-evidence.js";

export async function verifyRelease(args: string[]) {
  const root = resolve(".");
  let automated = false,
    evidenceFile: string | undefined,
    scope: "local" | "generation" = "local";
  for (let n = 0; n < args.length; n++) {
    if (args[n] === "--automated") automated = true;
    else if (args[n] === "--evidence" && args[n + 1]) evidenceFile = args[++n];
    else if (
      args[n] === "--scope" &&
      ["local", "generation"].includes(args[n + 1])
    )
      scope = args[++n] as typeof scope;
    else
      throw Error(
        "Usage: pnpm verify release [--automated] [--scope local|generation] [--evidence file.json]",
      );
  }
  const directory = join(
    root,
    "artifacts/release",
    new Date().toISOString().replaceAll(":", "-"),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const snapshot = await exportPublicSource(root, join(directory, "source"));
  const manifest = JSON.parse(
    await readFile(join(snapshot.directory, "SOURCE_MANIFEST.json"), "utf8"),
  );
  const validationFiles = [
    "scripts/verify.ts",
    "scripts/verify-release.ts",
    "scripts/release-evidence.ts",
    "scripts/verify-installation.ts",
    "scripts/export-public.ts",
    "scripts/build-installer.ts",
    "scripts/verify-licenses.ts",
    "public-release.json",
    ".github/workflows/ci.yml",
    "tests/release-evidence.test.ts",
  ];
  async function fingerprint(files: Record<string, string>) {
    const hashes = { ...files };
    for (const path of validationFiles)
      hashes[`validation:${path}`] = createHash("sha256")
        .update(await readFile(join(root, path)))
        .digest("hex");
    return sourceFingerprint(hashes);
  }
  const sourceSha256 = await fingerprint(manifest.files);
  const checks: Array<{ id: string; status: string; exitCode: number | null }> =
    [];
  const commands: Array<[string, string, string[]]> = [
    ["build", "pnpm", ["build"]],
    ["tests", "pnpm", ["test"]],
    ["media", "pnpm", ["test:media"]],
    ["licenses", "pnpm", ["exec", "tsx", "scripts/verify-licenses.ts"]],
    ["installer-syntax", "bash", ["-n", "scripts/install.sh"]],
    [
      "installation-upgrade-rollback",
      "pnpm",
      ["exec", "tsx", "scripts/verify-installation.ts"],
    ],
  ];
  const secretMatches: string[] = [];
  for (const path of snapshot.files) {
    if (
      /(?:sk_live_|AKIA)[A-Za-z0-9]{16,}/.test(
        (await readFile(join(snapshot.directory, path))).toString(),
      )
    )
      secretMatches.push(path);
  }
  await writeFile(
    join(directory, "source-secret-patterns.log"),
    JSON.stringify({
      matchedPaths: secretMatches,
      boundary:
        "Limited known-pattern check, not a complete secrets or licensing audit",
    }),
  );
  let automatedPassed = secretMatches.length === 0;
  checks.push({
    id: "source-secret-patterns",
    status: automatedPassed ? "PASS" : "FAIL",
    exitCode: automatedPassed ? 0 : 1,
  });
  for (const [id, command, argv] of automatedPassed ? commands : []) {
    console.log(`Release check: ${id}`);
    const result = await new Promise<{ code: number | null; output: string }>(
      (yes) => {
        const child = spawn(command, argv, {
          cwd: root,
          env: {
            ...process.env,
            RIKOKO_INSTALLATION_REPORT_DIR: join(directory, "installation"),
            RIKOKO_LICENSE_REPORT_DIR: join(directory, "licenses"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        const collect = (chunk: Buffer) => {
          output += chunk.toString();
        };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60_000);
        child.on("error", () => {
          clearTimeout(timer);
          yes({ code: null, output: "Could not start check" });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          yes({ code, output });
        });
      },
    );
    await writeFile(join(directory, `${id}.log`), result.output, {
      mode: 0o600,
    });
    checks.push({
      id,
      status: result.code === 0 ? "PASS" : "FAIL",
      exitCode: result.code,
    });
    if (result.code !== 0) {
      automatedPassed = false;
      break;
    }
  }
  // Refuse to certify a moving worktree using results from an earlier source state.
  const after = await exportPublicSource(root, join(directory, "source-after"));
  const afterManifest = JSON.parse(
    await readFile(join(after.directory, "SOURCE_MANIFEST.json"), "utf8"),
  );
  const unchanged = (await fingerprint(afterManifest.files)) === sourceSha256;
  automatedPassed &&= unchanged;
  checks.push({
    id: "unchanged-source",
    status: unchanged ? "PASS" : "FAIL",
    exitCode: unchanged ? 0 : 1,
  });
  const evidence = evidenceFile
    ? JSON.parse(await readFile(resolve(evidenceFile), "utf8"))
    : null;
  const acceptance = await checkReleaseEvidence(
    root,
    sourceSha256,
    evidence,
    scope,
  );
  const releaseReady =
    automatedPassed && acceptance.every((c) => c.status === "PASS");
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    scope,
    sourceSha256,
    platform: `${process.platform}-${process.arch}`,
    automatedPassed,
    releaseReady,
    checks,
    acceptance,
    paidRequests: 0,
    boundary:
      "Automated installation uses cached dependencies and temporary MCP profiles. Real host UI, clean-machine installation, model quality and licensing require separately recorded evidence.",
  };
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    join(directory, "evidence-template.json"),
    JSON.stringify(
      {
        sourceSha256,
        scope,
        checks: acceptance.map(({ id }) => ({
          id,
          status: "NOT_RUN",
          artifact: "",
          sha256: "",
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      { ...report, report: join(directory, "report.json") },
      null,
      2,
    ),
  );
  return automatedPassed ? (automated || releaseReady ? 0 : 2) : 1;
}
