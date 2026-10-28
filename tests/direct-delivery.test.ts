import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { workspaceResult } from "../packages/core/src/delivery.js";
import { validateWorkspace } from "../packages/core/src/production-review.js";
import { validateStoryboardInput } from "../packages/core/src/storyboard-state.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { Worker } from "../apps/worker/src/worker.js";
import { resultText } from "../packages/mcp/src/presentation.js";

let db: Database, service: Service, dir: string, c: any;
const network = vi.fn();
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "direct-delivery-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider([], "", false, network),
  );
  c = await service.authenticate(
    (await service.createAccount("Delivery", 0)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
// Synthetic records test delivery policy, not real decoding or visual quality.
async function asset(kind: "video" | "image" = "video") {
  return service.registerAsset(c.accountId, Buffer.from(randomUUID()), {
    provenance: { evidence: "test-fixture" },
    name: `fixture.${kind === "video" ? "mp4" : "png"}`,
    kind,
    mime: kind === "video" ? "video/mp4" : "image/png",
    metadata: {
      kind,
      width: 320,
      height: 180,
      ...(kind === "video" ? { durationMs: 2000, fps: 25 } : {}),
    },
  });
}
async function completed(a: any, revisionId?: string) {
  const job = {
    id: randomUUID(),
    type: "job",
    accountId: c.accountId,
    createdAt: new Date().toISOString(),
    status: "completed",
    outputs: [a.id],
    revisionId,
  };
  await service.scoped(c, "write", (tx) => tx.put(job));
  return job;
}
it("delivers an unreviewed completed video by default without inspection, model calls or new jobs", async () => {
  const a = await asset(),
    job = await completed(a);
  const before: any = await callTool(service, c, "records_list", {
    type: "job",
  });
  const result = await workspaceResult(service, c, job.id);
  expect(result).toMatchObject({
    purpose: "final",
    mediaAcceptance: {
      status: "unreviewed",
      finalReady: true,
      reviewAccepted: false,
    },
  });
  expect(result.media).toHaveLength(1);
  expect(resultText(result)).not.toContain("record acceptance");
  expect(await callTool(service, c, "records_list", { type: "job" })).toEqual(
    before,
  );
  expect(
    await callTool(service, c, "records_list", { type: "media-review" }),
  ).toEqual([]);
  expect(network).not.toHaveBeenCalled();
});
it("delivers a composed video with no final review while retaining explicit previews", async () => {
  const a = await asset();
  const project = await service.createProject(c, {
    title: "Direct",
    brief: "test",
  });
  const revision = await service.addRevision(c, project.id, {
    schemaVersion: 1,
    title: "Direct",
    width: 320,
    height: 180,
    scenes: [{ id: "s", assetId: a.id, durationMs: 2000 }],
  });
  const job = await completed(a, revision.id);
  expect((await workspaceResult(service, c, job.id)).quality).toMatchObject({
    status: "unreviewed",
    finalReady: true,
    reviewAccepted: false,
  });
  const preview = await workspaceResult(service, c, job.id, "preview");
  expect(resultText(preview, "hermes")).not.toContain("MEDIA:");
  const bad = await service.addRevision(c, project.id, {
    ...revision.composition,
    scenes: [{ id: "s", durationMs: 2000 }],
  });
  const badJob = await completed(a, bad.id);
  await expect(workspaceResult(service, c, badJob.id)).rejects.toMatchObject({
    code: "DELIVERY_VALIDATION_REQUIRED",
  });
  expect((await validateWorkspace(service, c, bad.id)).issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "PLACEHOLDER_SCENE" }),
    ]),
  );
});
it("keeps rejected optional feedback without forcing review, regeneration or relabeling it as accepted", async () => {
  const a = await asset(),
    job = await completed(a);
  await service.scoped(c, "write", (tx) =>
    tx.put({
      id: randomUUID(),
      type: "media-review",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      assetId: a.id,
      sourceSha256: a.sha256,
      schemaVersion: 2,
      decision: "needs_changes",
    }),
  );
  expect(
    (await workspaceResult(service, c, job.id)).mediaAcceptance,
  ).toMatchObject({
    status: "needs_changes",
    finalReady: true,
    reviewAccepted: false,
  });
  expect(network).not.toHaveBeenCalled();
});
it("rejects missing bytes and cross-account delivery without calling a model", async () => {
  const a = await asset(),
    job = await completed(a);
  const other = await service.authenticate(
    (await service.createAccount("Other", 0)).key,
  );
  await expect(workspaceResult(service, other, job.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await service.storage.delete(a.storageKey);
  await expect(workspaceResult(service, c, job.id)).rejects.toMatchObject({
    code: "DELIVERY_MEDIA_UNAVAILABLE",
  });
});
it("records a quick key-image review once; identical retries preserve the storyboard version and video gate", async () => {
  const a = await asset("image");
  const board = {
    id: randomUUID(),
    type: "storyboard",
    accountId: c.accountId,
    createdAt: new Date().toISOString(),
    version: 1,
    shots: [{ sourceShotId: "s", durationMs: 2000, references: [] }],
  };
  await service.scoped(c, "write", (tx) => tx.put(board));
  const input: any = {
    kind: "generate",
    model: "fixture",
    mode: "image_to_video",
    prompt: "Hold",
    references: [{ role: "first_frame", assetId: a.id }],
    storyboard: {
      storyboardId: board.id,
      version: 1,
      sourceShotId: "s",
      stage: "video",
    },
  };
  const validate = () =>
    service.scoped(c, "read", (tx) =>
      validateStoryboardInput(tx, c.accountId, input),
    );
  await expect(validate()).rejects.toMatchObject({
    code: "STORYBOARD_REVIEW_REQUIRED",
  });
  const review = {
    storyboardId: board.id,
    expectedVersion: 1,
    sourceShotId: "s",
    imageAssetId: a.id,
    decision: "accepted",
    checks: { identity: true, product: true, composition: true },
    notes: "Subject, major defects and starting state checked once (fixture).",
  };
  const first: any = await callTool(
    service,
    c,
    "reference_storyboard_review",
    review,
  );
  expect(first.version).toBe(2);
  expect(
    await callTool(service, c, "reference_storyboard_review", review),
  ).toEqual(first);
  expect(
    await callTool(service, c, "reference_storyboard_review", {
      ...review,
      expectedVersion: 2,
    }),
  ).toEqual(first);
  input.storyboard.version = 2;
  await expect(validate()).resolves.toBeUndefined();
  const rejected: any = await callTool(
    service,
    c,
    "reference_storyboard_review",
    {
      ...review,
      expectedVersion: 2,
      decision: "rejected",
      checks: { ...review.checks, product: false },
      notes: "User identified wrong product; no automatic regeneration.",
    },
  );
  input.storyboard.version = rejected.version;
  await expect(validate()).rejects.toMatchObject({
    code: "STORYBOARD_REVIEW_REQUIRED",
  });
  expect(network).not.toHaveBeenCalled();
});

it("does not duplicate a standalone critical-image review or accept changed bytes", async () => {
  const a = await asset("image");
  const inspection = {
    id: randomUUID(),
    type: "media-inspection",
    accountId: c.accountId,
    createdAt: new Date().toISOString(),
    assetId: a.id,
    sourceSha256: a.sha256,
    frames: [{ sourceTimeMs: 0 }],
  };
  await service.scoped(c, "write", (tx) => tx.put(inspection));
  const review = {
    assetId: a.id,
    inspectionIds: [inspection.id],
    decision: "accepted",
    reviewer: "host_agent",
    checks: {
      actionComplete: { status: "not_applicable", reason: "Still image" },
      framing: true,
      continuity: true,
      noArtifacts: true,
    },
    notes:
      "One quick subject, major-defect and state check; synthetic fixture.",
  };
  const first = await callTool(service, c, "media_review", review);
  expect(await callTool(service, c, "media_review", review)).toEqual(first);
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...a, sha256: "f".repeat(64) }),
  );
  await expect(
    callTool(service, c, "media_review", review),
  ).rejects.toMatchObject({ code: "STALE_EVIDENCE" });
});
it("rejects corrupt outputs and invalid metadata without authorizing regeneration", async () => {
  const a = await asset(),
    job = await completed(a);
  await service.storage.put(a.storageKey, Buffer.from("changed bytes"));
  await expect(workspaceResult(service, c, job.id)).rejects.toMatchObject({
    code: "DELIVERY_MEDIA_UNAVAILABLE",
  });
  const b = await asset(),
    otherJob = await completed(b);
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...b, metadata: { ...b.metadata, durationMs: 0 } }),
  );
  await expect(workspaceResult(service, c, otherJob.id)).rejects.toMatchObject({
    code: "DELIVERY_VALIDATION_REQUIRED",
  });
  expect(network).not.toHaveBeenCalled();
});
it("advertises direct delivery and does not reinterpret unreviewed cases as successful trials", async () => {
  const capabilities: any = await callTool(service, c, "capabilities", {});
  expect(capabilities.reviewPolicy).toMatchObject({
    finalAiReview: "host_self_check_with_available_capabilities",
    automaticQualityRegeneration: false,
  });
  expect(capabilities.visualReview.finalReviewRequired).toBe(false);
  expect(capabilities.directorLibrary.automaticPromotion).toBe(false);
});

it("delivers renderer outputs including empty subtitles and legacy thumbnail metadata", async () => {
  const video = await asset(),
    job = await completed(video);
  const subtitles = await service.registerAsset(c.accountId, Buffer.alloc(0), {
    name: "captions.srt",
    kind: "subtitle",
    mime: "text/plain",
    metadata: {},
    provenance: { evidence: "fixture" },
  });
  const thumbnail = await service.registerAsset(
    c.accountId,
    Buffer.from("thumbnail fixture"),
    {
      name: "preview.png",
      kind: "image",
      mime: "image/png",
      metadata: {},
      provenance: { evidence: "fixture" },
    },
  );
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...job, outputs: [video.id, subtitles.id, thumbnail.id] }),
  );
  expect((await workspaceResult(service, c, job.id)).media).toHaveLength(3);
});

it("renders and directly delivers a real local video, empty captions and thumbnail without AI review", async () => {
  const committed: any = await callTool(service, c, "workspace_commit", {
    action: {
      type: "create",
      composition: {
        schemaVersion: 1,
        title: "Direct local render",
        width: 320,
        height: 180,
        scenes: [
          {
            id: "card",
            visualKind: "graphic",
            durationMs: 1000,
            color: "#153a44",
          },
        ],
      },
    },
    message: "Render the requested graphic card",
    idempotencyKey: randomUUID(),
  });
  await new Worker(service).tick();
  const result = await workspaceResult(service, c, committed.jobId);
  expect(result.status).toBe("completed");
  expect(result.quality).toMatchObject({
    finalReady: true,
    reviewAccepted: false,
    status: "unreviewed",
  });
  expect(result.media.map((m) => m.mimeType)).toEqual([
    "video/mp4",
    "text/plain",
    "image/png",
  ]);
  expect(network).not.toHaveBeenCalled();
});
