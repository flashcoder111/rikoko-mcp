import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { callTool } from "./prepared-request-fixture.js";
import type { Context } from "../packages/contracts/src/index.js";
import { createMcpServer } from "../packages/mcp/src/index.js";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

let db: Database, service: Service, dir: string, c: Context, stranger: Context;
const fetcher = vi.fn(() => {
  throw Error("No network allowed in director workflow tests");
});
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "director-tests-"));
  db = await Database.open();
  service = new Service(
    db,
    new LocalStorage(dir),
    new FalProvider(
      [
        {
          id: "silent",
          kind: "video",
          endpoint: "minimax/h3/text-to-video",
          maxCostCents: 10,
          priceVersion: "fixture",
          hardBoundConfirmed: true,
          parameters: { duration: 5, aspect_ratio: "9:16" },
        },
        {
          id: "native",
          kind: "video",
          endpoint: "minimax/h3/text-to-video",
          maxCostCents: 10,
          priceVersion: "fixture",
          hardBoundConfirmed: true,
          parameters: {
            duration: 5,
            aspect_ratio: "9:16",
            generate_audio: true,
          },
        },
      ],
      "fixture",
      true,
      fetcher,
    ),
  );
  c = await service.authenticate(
    (await service.createAccount("director", 1000)).key,
  );
  stranger = await service.authenticate(
    (await service.createAccount("other", 1000)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
const shot = {
  id: "host",
  initialState: { presenter: "holding the bottle" },
  action: "Explain one approved benefit while holding the bottle",
  endState: { presenter: "holding the bottle" },
  promptKits: {
    image: { id: "creator-image-v1", version: 1, recipe: "product-in-hand" },
    video: {
      id: "talking-head-v1",
      version: 1,
      recipe: "friendly-explainer",
      dialogue: "This bottle fits in my bag.",
    },
  },
};
async function prepare() {
  const plan: any = await callTool(service, c, "production_plan_save", {
    plan: { title: "Ad fixture", width: 720, height: 1280, shots: [shot] },
  });
  const drafts: any = await callTool(service, c, "production_shot_prompts", {
    planId: plan.id,
    expectedVersion: 1,
    shotId: "host",
    subject: "Adult presenter",
    mode: "text_to_video",
    model: "native",
  });
  const input = {
    kind: "generate",
    model: "native",
    prompt: drafts.video.prompt,
    target: { width: 720, height: 1280 },
  };
  const request = {
    input,
    direction: drafts.video.direction,
    plan: {
      planId: plan.id,
      expectedVersion: 1,
      shotId: "host",
      stage: "video",
    },
  };
  return {
    plan,
    drafts,
    request,
    prep: (await callTool(service, c, "generation_prepare", request)) as any,
  };
}
it("discovers kits and guides over MCP and binds the saved choice through preparation without paid calls", async () => {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer((name, input) =>
    callTool(service, c, name, input),
  );
  const client = new Client({ name: "director-fixture", version: "1" });
  await server.connect(st);
  await client.connect(ct);
  try {
    const catalog: any = await client.callTool({
      name: "director_catalog",
      arguments: { format: "talking-head-ad" },
    });
    expect(catalog.structuredContent.result.kits).toHaveLength(3);
    const guide: any = await client.callTool({
      name: "rikoko_guide",
      arguments: { topic: "director-kits" },
    });
    expect(guide.isError).not.toBe(true);
    expect(guide.structuredContent.result.markdown).toContain(
      "director_catalog",
    );
    const tools = await client.listTools();
    expect(
      tools.tools.find((t) => t.name === "director_catalog")?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.tools.find((t) => t.name === "director_case_record")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
  } finally {
    await client.close();
    await server.close();
  }
  const { drafts, request, prep } = await prepare();
  expect(drafts.image.direction.directorKit.id).toBe("creator-image-v1");
  expect(drafts.image.prompt).not.toContain(shot.promptKits.video.dialogue);
  expect(prep.prompt.direction.directorKit).toEqual(shot.promptKits.video);
  expect(prep.prompt.templateVersion).toBe(
    "rikoko-director-talking-head-v1-r1",
  );
  expect(prep.readyForSubmission).toBe(true);
  const capabilities: any = await callTool(service, c, "capabilities", {});
  expect(capabilities.directorLibrary.caseRecordType).toBe("director-case");
  expect(
    capabilities.generationPreparation.supportedTemplateVersions,
  ).toContain(prep.prompt.templateVersion);
  await expect(
    callTool(service, c, "generation_prepare", {
      ...request,
      input: { ...request.input, model: "silent" },
    }),
  ).rejects.toMatchObject({ code: "DIRECTOR_AUDIO_REQUIRED" });
  await expect(
    callTool(service, c, "generation_prepare", {
      ...request,
      direction: {
        ...request.direction,
        directorKit: { ...shot.promptKits.video, recipe: "calm-expert" },
      },
    }),
  ).rejects.toMatchObject({ code: "PLAN_DIRECTION_MISMATCH" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects misattributed inputs/reviews and retains negative review evidence", async () => {
  const { prep } = await prepare();
  await service.scoped(c, "write", async (tx) => {
    const base = {
      accountId: c.accountId,
      type: "job",
      createdAt: "fixture",
      status: "completed",
      input: prep.input,
      preparedRequestId: prep.id,
      outputs: ["negative-output"],
    };
    await tx.put({ ...base, id: "negative-job" });
    await tx.put({
      ...base,
      id: "changed-input-job",
      input: { ...prep.input, parameters: { duration: 99 } },
    });
    await tx.put({
      ...base,
      id: "unbound-job",
      preparedRequestId: "missing-preparation",
    });
    await tx.put({
      id: "negative-output",
      accountId: c.accountId,
      type: "asset",
      createdAt: "fixture",
      sha256: "b".repeat(64),
    });
    await tx.put({
      id: "negative-review",
      accountId: c.accountId,
      type: "media-review",
      createdAt: "fixture",
      assetId: "negative-output",
      sourceSha256: "b".repeat(64),
      decision: "needs_changes",
      notes: "Synthetic wrong words",
    });
    await tx.put({
      id: "wrong-byte-review",
      accountId: c.accountId,
      type: "media-review",
      createdAt: "fixture",
      assetId: "negative-output",
      sourceSha256: "c".repeat(64),
      decision: "accepted",
    });
    await tx.put({
      id: "composition-review",
      accountId: c.accountId,
      type: "media-review",
      createdAt: "fixture",
      assetId: "negative-output",
      sourceSha256: "b".repeat(64),
      revisionId: "revision",
      decision: "accepted",
    });
  });
  for (const jobId of ["changed-input-job", "unbound-job"])
    await expect(
      callTool(service, c, "director_case_record", {
        jobId,
        lesson: "Mismatch",
      }),
    ).rejects.toMatchObject({ code: "DIRECTOR_CASE_UNBOUND" });
  for (const reviewId of [
    "wrong-byte-review",
    "composition-review",
    "nonexistent-review",
  ])
    await expect(
      callTool(service, c, "director_case_record", {
        jobId: "negative-job",
        assetId: "negative-output",
        reviewId,
        lesson: "Mismatch",
      }),
    ).rejects.toMatchObject({ code: "DIRECTOR_CASE_REVIEW_MISMATCH" });
  const negative: any = await callTool(service, c, "director_case_record", {
    jobId: "negative-job",
    assetId: "negative-output",
    reviewId: "negative-review",
    lesson: "Wrong words in a synthetic fixture",
    nextChange: "Shorter passage",
  });
  expect(negative.outcome).toBe("needs_changes");
  expect(negative.elapsedMs).toBeNull();
  expect(negative.chargedCents).toBeNull();
  const records: any = await callTool(service, c, "records_list", {
    type: "director-case",
  });
  expect(records.some((r: any) => r.id === negative.id)).toBe(true);
  const catalog: any = await callTool(service, c, "director_catalog", {});
  expect(catalog.kits.every((k: any) => k.validation === "candidate")).toBe(
    true,
  );
});
it("records attributable failed/unreviewed/accepted trial snapshots, isolates accounts, and deduplicates retries", async () => {
  const { prep } = await prepare();
  await service.scoped(c, "write", async (tx) => {
    await tx.put({
      id: "kit-job",
      accountId: c.accountId,
      type: "job",
      createdAt: "2026-10-19T00:00:00Z",
      finishedAt: "2026-10-19T00:00:10Z",
      status: "completed",
      testing: true,
      input: prep.input,
      preparedRequestId: prep.id,
      outputs: ["kit-output"],
      chargedCents: 0,
      currency: "USD",
    });
    await tx.put({
      id: "kit-output",
      accountId: c.accountId,
      type: "asset",
      createdAt: "fixture",
      sha256: "a".repeat(64),
    });
    await tx.put({
      id: "kit-review",
      accountId: c.accountId,
      type: "media-review",
      createdAt: "fixture",
      assetId: "kit-output",
      sourceSha256: "a".repeat(64),
      decision: "accepted",
      reviewer: "host_agent",
      notes: "Synthetic test, not a real quality claim",
    });
    await tx.put({
      id: "failed-kit-job",
      accountId: c.accountId,
      type: "job",
      createdAt: "fixture",
      status: "failed",
      input: prep.input,
      preparedRequestId: prep.id,
    });
    await tx.put({
      id: "pending-kit-job",
      accountId: c.accountId,
      type: "job",
      createdAt: "fixture",
      status: "running",
      input: prep.input,
      preparedRequestId: prep.id,
    });
  });
  const data = {
    jobId: "kit-job",
    assetId: "kit-output",
    reviewId: "kit-review",
    lesson: "Fixture evidence binding only",
  };
  const saved: any = await callTool(service, c, "director_case_record", data);
  expect(saved).toMatchObject({
    outcome: "reviewer_accepted",
    testing: true,
    elapsedMs: 10000,
    model: "native",
    kit: shot.promptKits.video,
  });
  expect(
    ((await callTool(service, c, "director_case_record", data)) as any).id,
  ).toBe(saved.id);
  expect(
    (
      (await callTool(service, c, "record_get", {
        type: "director-case",
        id: saved.id,
      })) as any
    ).prompt,
  ).toBe(prep.prompt.text);
  await expect(
    callTool(service, stranger, "director_case_record", data),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    callTool(service, stranger, "record_get", {
      type: "director-case",
      id: saved.id,
    }),
  ).rejects.toThrow();
  await expect(
    callTool(service, c, "director_case_record", {
      ...data,
      assetId: "other-output",
    }),
  ).rejects.toMatchObject({ code: "DIRECTOR_CASE_ASSET_MISMATCH" });
  await expect(
    callTool(service, c, "director_case_record", {
      ...data,
      assetId: undefined,
    }),
  ).rejects.toMatchObject({ code: "DIRECTOR_CASE_REVIEW_MISMATCH" });
  expect(
    (
      (await callTool(service, c, "director_case_record", {
        jobId: "kit-job",
        lesson: "No review yet",
      })) as any
    ).outcome,
  ).toBe("unreviewed");
  expect(
    (
      (await callTool(service, c, "director_case_record", {
        jobId: "failed-kit-job",
        lesson: "Transport failure",
      })) as any
    ).outcome,
  ).toBe("technical_failure");
  await expect(
    callTool(service, c, "director_case_record", {
      jobId: "pending-kit-job",
      lesson: "Wait",
    }),
  ).rejects.toMatchObject({ code: "DIRECTOR_CASE_PENDING" });
  expect(fetcher).not.toHaveBeenCalled();
});
