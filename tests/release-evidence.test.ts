import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkReleaseEvidence,
  sourceFingerprint,
} from "../scripts/release-evidence.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
it("fingerprints source content deterministically and invalidates changed content", () => {
  expect(sourceFingerprint({ b: "2", a: "1" })).toBe(
    sourceFingerprint({ a: "1", b: "2" }),
  );
  expect(sourceFingerprint({ a: "1" })).not.toBe(sourceFingerprint({ a: "2" }));
});
it("never accepts absent or stale evidence, and requires live evidence only for generation", async () => {
  expect(
    await checkReleaseEvidence(".", "current", null, "local"),
  ).toHaveLength(3);
  const checks = await checkReleaseEvidence(
    ".",
    "current",
    { sourceSha256: "old", checks: [] },
    "generation",
  );
  expect(checks).toHaveLength(4);
  expect(checks.every((c) => c.status === "NOT_RUN")).toBe(true);
});
it("accepts matching evidence and rejects modified, duplicated or escaping artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "rikoko-release-evidence-"));
  dirs.push(root);
  await writeFile(
    join(root, "acceptance.md"),
    "Actual recorded acceptance fixture",
  );
  const sha256 = createHash("sha256")
    .update("Actual recorded acceptance fixture")
    .digest("hex");
  const evidence = {
    sourceSha256: "current",
    scope: "local",
    checks: [
      "clean-machine-install",
      "host-user-journey",
      "license-review",
    ].map((id) => ({ id, status: "PASS", artifact: "acceptance.md", sha256 })),
  };
  expect(
    (await checkReleaseEvidence(root, "current", evidence, "local")).every(
      (c) => c.status === "PASS",
    ),
  ).toBe(true);
  const duplicate = {
    ...evidence,
    checks: [...evidence.checks, evidence.checks[0]],
  };
  expect(
    (await checkReleaseEvidence(root, "current", duplicate, "local"))[0].status,
  ).toBe("NOT_RUN");
  evidence.checks[0].artifact = "../outside.md";
  expect(
    (await checkReleaseEvidence(root, "current", evidence, "local"))[0].status,
  ).toBe("NOT_RUN");
  await writeFile(join(root, "acceptance.md"), "changed");
  expect(
    (await checkReleaseEvidence(root, "current", evidence, "local")).every(
      (c) => c.status === "NOT_RUN",
    ),
  ).toBe(true);
});
