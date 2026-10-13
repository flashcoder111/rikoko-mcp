import { readFile, access, mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
const stage = process.argv[2];
if (stage === "provenance") {
  for (const path of [
    "docs/integrations/code-manifest.json",
    "docs/integrations/model-manifest.json",
    "fixtures/manifest.json",
    "docs/integrations/services.json",
    "THIRD_PARTY_NOTICES.md",
    "docs/acceptance/support-matrix.md",
  ]) {
    await access(path);
    console.log("FOUND", path);
  }
  console.log(
    "Source manifest structure checked. This does not certify third-party model or hosted-service licensing.",
  );
} else if (stage === "release") {
  const files: string[] = [];
  async function walk(path: string) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const p = join(path, item.name);
      if (item.isDirectory()) await walk(p);
      else if (!p.endsWith(".pyc")) files.push(p);
    }
  }
  for (const root of [
    "apps/server/src",
    "apps/worker/src",
    "apps/studio/dist",
    "packages",
    "scripts",
    "deploy",
  ])
    await walk(root);
  files.push(
    "package.json",
    "pnpm-lock.yaml",
    "python/pyproject.toml",
    "python/uv.lock",
    "README.md",
  );
  const manifest = [];
  for (const file of files) {
    const bytes = await readFile(file);
    if (/(?:sk_live_|AKIA)[A-Za-z0-9]{16,}/.test(bytes.toString()))
      throw Error(`Possible secret: ${file}`);
    manifest.push({
      path: file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await mkdir("artifacts/release", { recursive: true });
  await writeFile(
    "artifacts/release/source-manifest.json",
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    "Source manifest and limited secret-pattern check written. Clean container build, image digest/SBOM and final license approval remain NOT_RUN.",
  );
  process.exitCode = 2;
} else {
  const blockers: Record<string, string> = {
    "media-ai":
      "WhisperX weights/environment, annotated speech and face samples, ASR/alignment/framing quality and human listening review are not validated.",
    live: "Provider model profiles, environment injection, per-model costs and paid budget are not configured; no live request made.",
    clients:
      "Hermes, Codex and Claude Code real client journeys are not yet executed. SDK integration test is separate.",
  };
  if (!blockers[stage])
    throw Error("Use provenance, media-ai, live, clients or release");
  console.log(
    JSON.stringify(
      { stage, status: "NOT_RUN", reason: blockers[stage] },
      null,
      2,
    ),
  );
  process.exitCode = 2;
}
