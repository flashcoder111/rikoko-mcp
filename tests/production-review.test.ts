import { scopeFixture } from "./production-fixture.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import {
  validateMediaResult,
  validateWorkspace,
} from "../packages/core/src/production-review.js";
import type { Context } from "../packages/contracts/src/index.js";

let db: Database, service: Service, dir: string, c: Context;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "review-contract-test-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider([], "", false),
  );
  c = await service.authenticate(
    (await service.createAccount("Review", 0)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

// Synthetic records exercise the review contract, not visual quality or decoding.
async function fixture(
  times = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 1900],
) {
  const asset = await service.registerAsset(
    c.accountId,
    Buffer.from(randomUUID()),
    {
      name: "contract-fixture.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: {
        kind: "video",
        durationMs: 2000,
        width: 320,
        height: 180,
        fps: 10,
      },
      provenance: { evidence: "test-fixture" },
    },
  );
  const evidence = {
    id: randomUUID(),
    type: "media-inspection",
    accountId: c.accountId,
    createdAt: new Date().toISOString(),
    assetId: asset.id,
    sourceSha256: asset.sha256,
    range: { startMs: 0, endMs: 2000 },
    frames: times.map((sourceTimeMs) => ({
      sourceTimeMs,
      requestedTimeMs: sourceTimeMs,
    })),
  };
  await service.scoped(c, "write", (tx) => tx.put(evidence));
  return { asset, evidence };
}
const pass = { status: "pass" };
function review(assetId: string, inspectionId: string) {
  return {
    assetId,
    inspectionIds: [inspectionId],
    decision: "accepted",
    reviewer: "host_agent",
    checks: {
      actionComplete: pass,
      framing: pass,
      continuity: pass,
      noArtifacts: pass,
    },
    actionRanges: [
      {
        startMs: 0,
        endMs: 2000,
        holdMs: 0,
        reason: "Check the complete lid closing action",
      },
    ],
    notes: "Contract fixture only; no actual semantic review claim.",
  };
}

it("records unknown without requiring invented visual evidence", async () => {
  const { asset } = await fixture();
  const unknown = { status: "unknown", reason: "This host cannot read images" };
  const result: any = await callTool(service, c, "media_review", {
    assetId: asset.id,
    inspectionIds: [],
    decision: "unreviewed",
    reviewer: "host_agent",
    checks: {
      actionComplete: unknown,
      framing: unknown,
      continuity: unknown,
      noArtifacts: unknown,
    },
    notes: "Awaiting a visual reviewer",
  });
  expect(result.schemaVersion).toBe(2);
  expect(result.checks.actionComplete.status).toBe("unknown");
  expect(
    (await validateMediaResult(service, c, [asset.id])).reviewAccepted,
  ).toBe(false);
});
it("rejects accepting an unknown check", async () => {
  const { asset, evidence } = await fixture();
  const input = review(asset.id, evidence.id);
  await expect(
    callTool(service, c, "media_review", {
      ...input,
      checks: {
        ...input.checks,
        actionComplete: { status: "unknown", reason: "Missing action view" },
      },
    }),
  ).rejects.toMatchObject({ code: "REVIEW_FAILED" });
});
it("requires a reason for not-applicable checks and disallows all-not-applicable acceptance", async () => {
  const { asset, evidence } = await fixture();
  const input = review(asset.id, evidence.id);
  await expect(
    callTool(service, c, "media_review", {
      ...input,
      checks: { ...input.checks, actionComplete: { status: "not_applicable" } },
    }),
  ).rejects.toThrow();
  const na = { status: "not_applicable", reason: "Not checked" };
  await expect(
    callTool(service, c, "media_review", {
      ...input,
      checks: {
        actionComplete: na,
        framing: na,
        continuity: na,
        noArtifacts: na,
      },
    }),
  ).rejects.toMatchObject({ code: "REVIEW_FAILED" });
});
it("does not let legacy booleans bypass declared action evidence", async () => {
  const { asset, evidence } = await fixture();
  await expect(
    callTool(service, c, "media_review", {
      ...review(asset.id, evidence.id),
      actionRanges: [],
      checks: {
        actionComplete: true,
        framing: true,
        continuity: true,
        noArtifacts: true,
      },
    }),
  ).rejects.toMatchObject({ code: "ACTION_EVIDENCE_REQUIRED" });
});
it("requires dense evidence inside the declared action range, even when the endpoints look covered", async () => {
  const { asset, evidence } = await fixture([0, 950, 1900]);
  await expect(
    callTool(service, c, "media_review", review(asset.id, evidence.id)),
  ).rejects.toMatchObject({ code: "INSPECTION_COVERAGE_REQUIRED" });
});
it("accepts an evidenced action while recording that sampled coverage is not semantic proof", async () => {
  const { asset, evidence } = await fixture();
  const result: any = await callTool(
    service,
    c,
    "media_review",
    review(asset.id, evidence.id),
  );
  expect(result.schemaVersion).toBe(2);
  expect(result.coverage.continuous).toBe(false);
  expect(result.coverage.maxSampleGapMs).toBe(250);
  expect(result.range).toEqual({ startMs: 0, endMs: 2000 });
  expect(
    (await validateMediaResult(service, c, [asset.id])).reviewAccepted,
  ).toBe(true);
});
it("allows a visually checked static shot to explain why action completion is not applicable", async () => {
  const { asset, evidence } = await fixture([0, 950, 1900]);
  const input = review(asset.id, evidence.id);
  const result: any = await callTool(service, c, "media_review", {
    ...input,
    actionRanges: [],
    checks: {
      ...input.checks,
      actionComplete: {
        status: "not_applicable",
        reason: "Intentional static product hold",
      },
    },
  });
  expect(result.checks.actionComplete.status).toBe("not_applicable");
});
it("never promotes acceptance of a selected interval into acceptance of the whole asset", async () => {
  const { asset, evidence } = await fixture();
  await callTool(service, c, "media_review", {
    ...review(asset.id, evidence.id),
    range: { startMs: 500, endMs: 1350 },
    actionRanges: [
      {
        startMs: 500,
        endMs: 1350,
        holdMs: 0,
        reason: "Inspect only the contact interval",
      },
    ],
  });
  expect(
    (await validateMediaResult(service, c, [asset.id])).reviewAccepted,
  ).toBe(false);
});
it("rejects evidence from another asset or an invalid review interval", async () => {
  const first = await fixture(),
    second = await fixture();
  await expect(
    callTool(
      service,
      c,
      "media_review",
      review(first.asset.id, second.evidence.id),
    ),
  ).rejects.toMatchObject({ code: "STALE_EVIDENCE" });
  await expect(
    callTool(service, c, "media_review", {
      ...review(first.asset.id, first.evidence.id),
      range: { startMs: 0, endMs: 2500 },
    }),
  ).rejects.toMatchObject({ code: "INVALID_INTERVAL" });
});
it("does not let an accepted interval hide a previously rejected full asset", async () => {
  const { asset, evidence } = await fixture();
  const input = review(asset.id, evidence.id);
  await callTool(service, c, "media_review", {
    ...input,
    decision: "needs_changes",
    checks: {
      ...input.checks,
      framing: { status: "fail", reason: "Product cropped" },
    },
  });
  await callTool(service, c, "media_review", {
    ...input,
    range: { startMs: 500, endMs: 1350 },
    actionRanges: [
      { startMs: 500, endMs: 1350, holdMs: 0, reason: "Selected interval" },
    ],
  });
  const result = await validateMediaResult(service, c, [asset.id]);
  expect(result.status).toBe("needs_changes");
  expect(result.reviewAccepted).toBe(false);
  expect(result.finalReady).toBe(true);
});
it("requires reinspection rather than silently upgrading legacy accepted records", async () => {
  const { asset } = await fixture();
  await service.scoped(c, "write", (tx) =>
    tx.put({
      id: randomUUID(),
      type: "media-review",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      assetId: asset.id,
      sourceSha256: asset.sha256,
      decision: "accepted",
      checks: {
        actionComplete: true,
        framing: true,
        continuity: true,
        noArtifacts: true,
      },
    }),
  );
  expect(
    (await validateMediaResult(service, c, [asset.id])).reviewAccepted,
  ).toBe(false);
});

it("revokes whole-asset acceptance when a later excerpt review finds a defect", async () => {
  const { asset, evidence } = await fixture();
  const input = review(asset.id, evidence.id);
  await callTool(service, c, "media_review", input);
  await callTool(service, c, "media_review", {
    ...input,
    range: { startMs: 500, endMs: 1350 },
    actionRanges: [],
    decision: "needs_changes",
    checks: {
      ...input.checks,
      noArtifacts: {
        status: "fail",
        reason: "Defect noticed in the contact interval",
      },
    },
  });
  const result = await validateMediaResult(service, c, [asset.id]);
  expect(result.status).toBe("needs_changes");
  expect(result.reviewAccepted).toBe(false);
  expect(result.finalReady).toBe(true);
});
it("requires a genuine middle sample rather than three timestamps near the endpoints", async () => {
  const { asset, evidence } = await fixture([0, 1, 1900]);
  const input = review(asset.id, evidence.id);
  await expect(
    callTool(service, c, "media_review", {
      ...input,
      actionRanges: [],
      checks: {
        ...input.checks,
        actionComplete: { status: "not_applicable", reason: "Static display" },
      },
    }),
  ).rejects.toMatchObject({ code: "INSPECTION_COVERAGE_REQUIRED" });
});
it("invalidates accepted media after its bytes change", async () => {
  const { asset, evidence } = await fixture();
  await callTool(service, c, "media_review", review(asset.id, evidence.id));
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...asset, sha256: "changed-fixture-hash" }),
  );
  expect(
    (await validateMediaResult(service, c, [asset.id])).reviewAccepted,
  ).toBe(false);
  await expect(
    callTool(service, c, "media_review", review(asset.id, evidence.id)),
  ).rejects.toMatchObject({ code: "STALE_EVIDENCE" });
});
it("requires evidence before recording pass or fail findings even for an unreviewed decision", async () => {
  const { asset, evidence } = await fixture();
  await expect(
    callTool(service, c, "media_review", {
      ...review(asset.id, evidence.id),
      inspectionIds: [],
      decision: "unreviewed",
    }),
  ).rejects.toMatchObject({ code: "INSPECTION_REQUIRED" });
});

it("revokes final-cut acceptance after a defect is found in an excerpt of its rendered output", async () => {
  const { asset, evidence } = await fixture();
  const project = await service.createProject(c, {
    title: "Final review",
    brief: "Contract fixture",
  });
  const revision = await service.addRevision(c, project.id, {
    schemaVersion: 1,
    title: "Final review",
    width: 320,
    height: 180,
    scenes: [
      {
        id: "main",
        productionShotId: "main",
        assetId: asset.id,
        durationMs: 2000,
      },
    ],
  });
  await service.scoped(c, "write", (tx) =>
    tx.put({
      id: randomUUID(),
      type: "job",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      status: "completed",
      revisionId: revision.id,
      outputs: [asset.id],
    }),
  );
  const input = review(asset.id, evidence.id);
  await callTool(service, c, "media_review", input);
  await scopeFixture(service, c, project.id, asset.id, 320, 180, "main");
  await callTool(service, c, "media_review", {
    ...input,
    revisionId: revision.id,
  });
  expect(
    (await validateWorkspace(service, c, revision.id)).reviewAccepted,
  ).toBe(true);
  await expect(
    callTool(service, c, "media_review", {
      ...input,
      revisionId: revision.id,
      range: { startMs: 500, endMs: 1350 },
      actionRanges: [],
      decision: "needs_changes",
    }),
  ).rejects.toMatchObject({ code: "REVIEW_REVISION_MISMATCH" });
  await callTool(service, c, "media_review", {
    ...input,
    range: { startMs: 500, endMs: 1350 },
    actionRanges: [],
    decision: "needs_changes",
    checks: {
      ...input.checks,
      noArtifacts: { status: "fail", reason: "Defect in rendered excerpt" },
    },
  });
  const result = await validateWorkspace(service, c, revision.id);
  expect(result.status).toBe("needs_changes");
  expect(result.reviewAccepted).toBe(false);
  expect(result.finalReady).toBe(true);
});

it("advertises the review contract without claiming to verify the host's vision", async () => {
  const capabilities: any = await callTool(service, c, "capabilities", {});
  expect(capabilities.visualReview).toMatchObject({
    schemaVersion: 2,
    hostVisionVerified: false,
    checkStatuses: ["pass", "fail", "unknown", "not_applicable"],
    actionEvidence: { requiredForPass: true, maxSampleGapMs: 250 },
  });
});

it("accepts rounded endpoint sampling for 24 fps footage", async () => {
  const { asset, evidence } = await fixture([0, 979, 1958]);
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...asset, metadata: { ...asset.metadata, fps: 24 } }),
  );
  const input = review(asset.id, evidence.id);
  await expect(
    callTool(service, c, "media_review", {
      ...input,
      actionRanges: [],
      checks: {
        ...input.checks,
        actionComplete: {
          status: "not_applicable",
          reason: "No narrative action in this chart",
        },
      },
    }),
  ).resolves.toMatchObject({ decision: "accepted" });
});

it("does not treat a single sampled moment as evidence of a completed action", async () => {
  const { asset, evidence } = await fixture();
  await expect(
    callTool(service, c, "media_review", {
      ...review(asset.id, evidence.id),
      actionRanges: [
        {
          startMs: 500,
          endMs: 501,
          reason: "Only one instant is not an action sequence",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "INSPECTION_COVERAGE_REQUIRED" });
});

it("preserves failed creative findings and unknown sound without blocking technical delivery", async () => {
  const { asset, evidence } = await fixture();
  const input = review(asset.id, evidence.id);
  await callTool(service, c, "media_review", {
    ...input,
    decision: "needs_changes",
    workAssessment: [
      {
        criterion: "Final response remains visible",
        aspect: "visual",
        status: "fail",
        method: "frames",
        range: { startMs: 1500, endMs: 2000 },
        reason: "Observed interval lacks the listener",
        repairTarget: "editing",
      },
      {
        criterion: "The line is intelligible",
        aspect: "audio",
        status: "unknown",
        method: "unobserved",
        reason: "This fixture has no listening evidence",
      },
    ],
  });
  const result = await validateMediaResult(service, c, [asset.id]);
  expect(result.finalReady).toBe(true);
  expect(result.reviewAccepted).toBe(false);
  expect(result.media[0].workJudgment.status).toBe("has_failures");
  expect(result.media[0].workJudgment.findings[1].status).toBe("unknown");
});

it.each(["motion", "audio"])(
  "does not let sampled frames certify %s in work assessment",
  async (aspect) => {
    const { asset, evidence } = await fixture();
    await expect(
      callTool(service, c, "media_review", {
        ...review(asset.id, evidence.id),
        workAssessment: [
          {
            criterion: "Full movement and sound",
            aspect,
            status: "pass",
            method: "frames",
            range: { startMs: 0, endMs: 2000 },
            reason: "Only images were available",
          },
        ],
      }),
    ).rejects.toThrow("frames cannot certify");
  },
);

it("does not attach a frame finding to an interval absent from its inspections", async () => {
  const { asset, evidence } = await fixture([0]);
  await expect(
    callTool(service, c, "media_review", {
      ...review(asset.id, evidence.id),
      decision: "needs_changes",
      workAssessment: [
        {
          criterion: "Ending visible",
          aspect: "visual",
          status: "fail",
          method: "frames",
          range: { startMs: 1500, endMs: 2000 },
          reason: "Not actually inspected",
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "INSPECTION_COVERAGE_REQUIRED" });
});
