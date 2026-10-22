import { access } from "node:fs/promises";
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
  const { verifyRelease } = await import("./verify-release.js");
  process.exitCode = await verifyRelease(process.argv.slice(3));
} else {
  const blockers: Record<string, string> = {
    "media-ai":
      "This command does not run model weights or human quality acceptance. Record evidence for the exact release source; no current environment state is inferred.",
    live: "This command does not purchase provider requests. Use explicitly authorized model trials and record their evidence for the exact release source.",
    clients:
      "This command does not operate real host UIs. Record the supported client/system journeys for the exact release source; SDK tests alone do not satisfy this gate.",
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
