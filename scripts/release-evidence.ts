import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

export function sourceFingerprint(files: Record<string, string>) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    )
    .digest("hex");
}

/** Human/provider acceptance is explicit and tied to this exact exported source. */
export async function checkReleaseEvidence(
  root: string,
  sourceSha256: string,
  raw: unknown,
  scope: "local" | "generation",
) {
  const required = [
    "clean-machine-install",
    "host-user-journey",
    "license-review",
    ...(scope === "generation" ? ["provider-live"] : []),
  ];
  const evidence = raw as {
    sourceSha256?: string;
    scope?: string;
    checks?: Array<{
      id: string;
      status: string;
      artifact: string;
      sha256: string;
    }>;
  } | null;
  if (
    !evidence ||
    evidence.sourceSha256 !== sourceSha256 ||
    evidence.scope !== scope ||
    !Array.isArray(evidence.checks)
  )
    return required.map((id) => ({
      id,
      status: "NOT_RUN",
      reason: "Missing acceptance evidence for this source and scope",
    }));
  const checks = [];
  for (const id of required) {
    const matches = evidence.checks.filter((c) => c?.id === id);
    const c = matches[0];
    let valid =
      matches.length === 1 &&
      c.status === "PASS" &&
      typeof c.artifact === "string" &&
      /^[a-f0-9]{64}$/.test(c.sha256);
    if (valid) {
      const file = resolve(root, c.artifact);
      valid = !isAbsolute(c.artifact) && file.startsWith(resolve(root) + sep);
      if (valid)
        valid = await readFile(file).then(
          (bytes) =>
            createHash("sha256").update(bytes).digest("hex") === c.sha256,
          () => false,
        );
    }
    checks.push({
      id,
      status: valid ? "PASS" : "NOT_RUN",
      reason: valid
        ? "Recorded acceptance artifact matches its hash"
        : "Missing, duplicate or invalid acceptance artifact",
    });
  }
  return checks;
}
