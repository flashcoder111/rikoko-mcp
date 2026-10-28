import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { createMcpServer } from "../packages/mcp/src/index.js";
import {
  directorKnowledge,
  directorResponsibility,
} from "../packages/guidance/src/director.js";
import { preparationRecordHash } from "../packages/core/src/generation-preparation.js";
import { resultText } from "../packages/mcp/src/presentation.js";
import { remakeFixture } from "./video-workflow-fixture.js";

let db: Database,
  service: Service,
  dir: string,
  c: Awaited<ReturnType<Service["authenticate"]>>;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "host-director-contract-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  c = await service.authenticate(
    (await service.createAccount("Director contracts", 0)).key,
  );
});
afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
const treatment = {
  intent: "Let the audience notice a reaction",
  approach: "Hold on the listener before the cut",
  successCriteria: ["Reaction is visible"],
};
const plan = {
  title: "Reaction",
  width: 720,
  height: 1280,
  treatment,
  knowledge: {
    format: "formats/talking-head-ads",
    crafts: ["craft/image-direction"],
  },
  shots: [{ id: "reaction", initialState: {}, action: "Pause", endState: {} }],
};

it("sends current task guidance in both MCP text and structured output and shares entry responsibility", async () => {
  const server = createMcpServer((name, input) =>
    callTool(service, c, name, input),
  );
  const client = new Client({ name: "director-contract", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    const output = await client.callTool({
      name: "production_plan_save",
      arguments: { plan },
    });
    expect(output.isError).not.toBe(true);
    const data = (output.structuredContent as any).result;
    const text = output.content as { type: string; text: string }[];
    expect(JSON.parse(text[0].text).guidance).toEqual(data.guidance);
    expect(data.guidance.treatment).toEqual(treatment);
    expect(data.guidance.readingPath.formats[0].topic).toBe(
      "formats/talking-head-ads",
    );
    const knowledgeResult = await client.callTool({
      name: "rikoko_guide",
      arguments: {
        topic: "knowledge",
        selection: {
          format: "formats/talking-head-ads",
          modelId: "example/model",
          mode: "text_to_video",
        },
      },
    });
    expect(knowledgeResult.isError).not.toBe(true);
    expect((knowledgeResult.content as any)[0].text).toContain(
      "Model coverage: general_only",
    );
    expect(
      (knowledgeResult.structuredContent as any).result.readingPath.formats[0]
        .topic,
    ).toBe("formats/talking-head-ads");
    expect(data.guidance.responsibility).toBe(directorResponsibility);
    for (const name of ["rikoko_create", "rikoko_resume"]) {
      const prompt = await client.getPrompt({
        name,
        arguments:
          name === "rikoko_create"
            ? { request: "Make a short scene" }
            : { projectId: data.productionProjectId },
      });
      expect((prompt.messages[0].content as any).text).toContain(
        directorResponsibility,
      );
    }
    expect(
      resultText({
        jobId: "fixture",
        status: "completed",
        purpose: "final",
        guidance: data.guidance,
        quality: { finalReady: true, status: "unreviewed", issues: [] },
      }),
    ).toContain(JSON.stringify(data.guidance));
  } finally {
    await client.close();
    await server.close();
  }
});

it("pins existing plan knowledge, permits explicit adoption, and never fabricates old treatment", async () => {
  const saved = await callTool(service, c, "production_plan_save", { plan });
  const oldGuide = "0".repeat(64);
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...saved, guideVersion: oldGuide }),
  );
  const edited = await callTool(service, c, "production_plan_save", {
    planId: saved.id,
    expectedVersion: saved.version,
    plan: { ...saved.plan, title: "Same work" },
  });
  expect(edited.guideVersion).toBe(oldGuide);
  expect(edited.guidance.knowledgeChanged).toBe(true);
  const adopted = await callTool(service, c, "production_plan_save", {
    planId: saved.id,
    expectedVersion: edited.version,
    plan: edited.plan,
    guidanceUpdateReason: "Use the current evidence-bound self-check method",
  });
  expect(adopted.guideVersion).not.toBe(oldGuide);
  expect(adopted.guidanceUpdate.previousGuideVersion).toBe(oldGuide);
  const { treatment: _t, ...withoutTreatment } = adopted.plan;
  await expect(
    callTool(service, c, "production_plan_save", {
      planId: saved.id,
      expectedVersion: adopted.version,
      plan: withoutTreatment,
    }),
  ).rejects.toMatchObject({ code: "TREATMENT_REQUIRED" });
  const legacy = await callTool(service, c, "production_plan_save", {
    plan: withoutTreatment,
  });
  const resumed = await callTool(service, c, "workspace_snapshot", {
    projectId: legacy.productionProjectId,
  });
  expect(resumed.guidance.treatment).toBeNull();
  expect(resumed.guidance.readingPath.formats[0].topic).toBe(
    "formats/talking-head-ads",
  );
});

it("requires target decisions for new source-edit observations without inventing orientation", async () => {
  const f = await remakeFixture(service, c);
  await service.scoped(c, "write", (tx) =>
    tx.put({
      ...f.source,
      metadata: { ...f.source.metadata, width: 1280, height: 720 },
    }),
  );
  f.plan.method = {
    kind: "source_edit",
    relationship: "edit_source",
    change: "Replace appearance only",
    preserve: ["action", "camera", "timing", "framing"],
    executionMode: "reference_to_video",
    source: {
      assetId: f.source.id,
      sha256: f.source.sha256,
      width: 1280,
      height: 720,
      durationMs: 2000,
    },
  };
  f.plan.shots[0].durationMs = 2000;
  f.plan.shots[0].references = [
    {
      assetId: f.source.id,
      role: "motion",
      transfer: "action",
      instruction: "Preserve source performance",
    },
  ];
  await expect(
    callTool(service, c, "production_plan_save", { plan: f.plan }),
  ).rejects.toMatchObject({ code: "SOURCE_RELATION_DECISION_REQUIRED" });
  const legacy = {
    id: "legacy-source-plan",
    type: "production-plan",
    accountId: c.accountId,
    createdAt: new Date().toISOString(),
    version: 1,
    plan: f.plan,
  };
  await service.scoped(c, "write", (tx) => tx.put(legacy));
  await expect(
    callTool(service, c, "production_plan_save", {
      planId: legacy.id,
      expectedVersion: 1,
      plan: f.plan,
      guidanceUpdateReason: "Adopt the current source relation method",
    }),
  ).rejects.toMatchObject({ code: "SOURCE_RELATION_DECISION_REQUIRED" });
  const validated = await callTool(
    service,
    c,
    "production_plan_validate",
    f.plan,
  );
  expect(
    validated.guidance.blockers.some(
      (i: any) => i.code === "SOURCE_RELATION_DECISION_REQUIRED",
    ),
  ).toBe(true);
});

it("uses one verified version for every method excerpt and binds optional knowledge without changing legacy hashes", async () => {
  const knowledge = await directorKnowledge([
    "intent",
    "reference",
    "performance",
    "method",
    "preparation",
    "image",
    "sound_text",
    "quality",
    "review",
  ]);
  expect(knowledge.content).toHaveLength(9);
  expect(
    knowledge.content.every(
      (entry) => entry.text.length > 100 && entry.sha256.length === 64,
    ),
  ).toBe(true);
  const legacy = {
    protocol: "fixture",
    input: { prompt: "frozen" },
    plan: { expectedVersion: 1 },
  };
  expect(preparationRecordHash(legacy)).toBe(
    preparationRecordHash({ ...legacy, guideVersion: undefined }),
  );
  expect(preparationRecordHash(legacy)).not.toBe(
    preparationRecordHash({ ...legacy, guideVersion: knowledge.guideVersion }),
  );
});

it("delivers picture-making methods before the first plan without requiring a format or generating media", async () => {
  const server = createMcpServer((name, input) =>
    callTool(service, c, name, input),
  );
  const client = new Client({ name: "first-picture-director", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  const jobsBefore = await service.scoped(c, "read", (tx) =>
    tx.list(c.accountId, "job"),
  );
  try {
    const output = await client.callTool({
      name: "workspace_request_save",
      arguments: {
        message: "Make a cafe presenter introducing her coffee",
        assetIds: [],
      },
    });
    expect(output.isError).not.toBe(true);
    const data = (output.structuredContent as any).result;
    const text = output.content as { type: string; text: string }[];
    expect(JSON.parse(text[0].text).guidance).toEqual(data.guidance);
    expect(data.guidance.content.map((g: any) => g.key)).toContain("image");
    expect(data.guidance.readingPath.craft.map((g: any) => g.topic)).toContain(
      "craft/image-creation",
    );
    const guide = await client.callTool({
      name: "rikoko_guide",
      arguments: { topic: "craft/image-creation" },
    });
    expect(guide.isError).not.toBe(true);
    const full = (guide.structuredContent as any).result;
    expect(full.guideVersion).toBe(data.guidance.guideVersion);
    expect(full.markdown).toContain("Worked example: coffee presenter");
    expect((guide.content as any)[0].text).toContain(full.markdown);
    expect(full.evidence.status).not.toBe("rikoko_tested");
    const prompt = await client.getPrompt({
      name: "rikoko_create",
      arguments: { request: "A cafe scene" },
    });
    expect((prompt.messages[0].content as any).text).toContain(
      'topic:"craft/image-creation"',
    );
    expect(
      await service.scoped(c, "read", (tx) => tx.list(c.accountId, "job")),
    ).toEqual(jobsBefore);
  } finally {
    await client.close();
    await server.close();
  }
});
