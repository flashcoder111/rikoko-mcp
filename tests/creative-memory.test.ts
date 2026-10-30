import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

let db: Database, service: Service, dir: string, key: string;
let app: ReturnType<typeof createApp>;
const source = { kind: "user_instruction", text: "以后按此规范制作" };
const composition = {
  schemaVersion: 1,
  title: "规范测试",
  width: 360,
  height: 640,
  scenes: [{ id: "one", durationMs: 3000, text: "你好" }],
};
async function call(name: string, input: unknown, token = key) {
  const response = await app.request(`http://localhost/api/tools/${name}`, {
    method: "POST",
    headers: {
      Host: "localhost",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return { status: response.status, ...((await response.json()) as any) };
}
async function ok(name: string, input: unknown, token = key) {
  const response = await call(name, input, token);
  expect(response, JSON.stringify(response)).toMatchObject({ status: 200 });
  return response.result;
}
async function ruleSet() {
  return (
    await ok("rule_set_save", {
      name: "口播规范",
      scope: { kind: "account" },
      source,
      idempotencyKey: "set",
    })
  ).record;
}
async function rule(setId: string, idempotencyKey = "rule") {
  return ok("rule_upsert", {
    ruleSetId: setId,
    definition: { target: "output.aspectRatio", operator: "eq", value: "9:16" },
    source,
    idempotencyKey,
  });
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rikoko-memory-"));
  db = await Database.open(join(dir, "db"));
  service = new Service(db, new LocalStorage(join(dir, "assets")));
  key = (await service.createAccount("Memory", 0)).key;
  app = createApp(service);
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

it("persists typed rules on disk, deduplicates retries and resolves them after restart", async () => {
  const set = await ruleSet();
  const first = await rule(set.id);
  expect(first.action).toBe("added");
  expect(await rule(set.id)).toEqual(first);
  expect((await rule(set.id, "same-content")).action).toBe("unchanged");
  await db.close();
  db = await Database.open(join(dir, "db"));
  service = new Service(db, new LocalStorage(join(dir, "assets")));
  app = createApp(service);
  const resolved = await ok("creative_context_resolve", {});
  expect(resolved.rules).toHaveLength(1);
  expect(resolved.rules[0].definition.value).toBe("9:16");
  expect(resolved.conflicts).toEqual([]);
  expect(await ok("records_list", { type: "job" })).toEqual([]);
});

it("patches individual rules with optimistic versions, detects conflicts and retains history", async () => {
  const set = await ruleSet();
  const first = (await rule(set.id)).record;
  const conflict = await call("rule_upsert", {
    ruleSetId: set.id,
    definition: { target: "output.aspectRatio", operator: "eq", value: "16:9" },
    source,
    idempotencyKey: "conflict",
  });
  expect(conflict).toMatchObject({
    status: 409,
    error: { code: "RULE_CONFLICT" },
  });
  const updated = await ok("rule_upsert", {
    id: first.id,
    expectedVersion: 1,
    definition: { target: "output.aspectRatio", operator: "eq", value: "16:9" },
    source,
    idempotencyKey: "update",
  });
  expect(updated.record).toMatchObject({
    id: first.id,
    version: 2,
    ruleSetId: set.id,
  });
  expect(
    (
      await call("rule_upsert", {
        id: first.id,
        expectedVersion: 1,
        strength: "preferred",
        source,
        idempotencyKey: "stale",
      })
    ).status,
  ).toBe(409);
  const history = await ok("memory_history", { id: first.id });
  expect(history.items.map((x: any) => x.version)).toEqual([2, 1]);
  expect(history.items[1].definition.value).toBe("9:16");
  expect(
    (
      await call("rule_upsert", {
        ruleSetId: set.id,
        definition: { target: "__proto__.x", operator: "eq", value: true },
        source,
        idempotencyKey: "invalid",
      })
    ).status,
  ).toBe(400);
});

it("keeps drafts and unresolved conditions out of effective rules and isolates accounts", async () => {
  const set = await ruleSet();
  await ok("rule_upsert", {
    ruleSetId: set.id,
    definition: { target: "visual.mood", operator: "guidance", value: "温暖" },
    status: "draft",
    source: { kind: "agent_inference", text: "可能喜欢" },
    idempotencyKey: "draft",
  });
  const conditional = await ok("rule_upsert", {
    ruleSetId: set.id,
    definition: { target: "output.durationMs", operator: "lte", value: 15000 },
    when: { taskKind: "talking_head" },
    source,
    idempotencyKey: "conditional",
  });
  expect((await ok("creative_context_resolve", {})).unresolved).toHaveLength(1);
  expect(
    (await ok("creative_context_resolve", { taskKind: "talking_head" })).rules,
  ).toHaveLength(1);
  expect(
    (await ok("creative_context_resolve", { taskKind: "ad" })).rules,
  ).toHaveLength(0);
  const other = (await service.createAccount("Other", 0)).key;
  expect((await ok("memory_search", {}, other)).items).toEqual([]);
  expect((await call("memory_get", { id: set.id }, other)).status).toBe(404);
  expect(
    (
      await call(
        "rule_upsert",
        {
          id: conditional.record.id,
          expectedVersion: 1,
          strength: "preferred",
          source,
          idempotencyKey: "steal",
        },
        other,
      )
    ).status,
  ).toBe(404);
  await ok("memory_archive", {
    id: conditional.record.id,
    expectedVersion: 1,
    idempotencyKey: "archive",
  });
  expect(
    (await ok("creative_context_resolve", { taskKind: "talking_head" })).rules,
  ).toEqual([]);
});

it("stores characters with owned references and separate looks; missing media is reported", async () => {
  const c = await service.authenticate(key);
  const asset = await service.registerAsset(
    c.accountId,
    Buffer.from("fixture"),
    {
      name: "portrait.png",
      kind: "image",
      mime: "image/png",
      metadata: {},
      provenance: {},
    },
  );
  const character = (
    await ok("memory_save", {
      kind: "character",
      name: "小林",
      data: {
        aliases: ["主持人"],
        description: "虚构角色",
        referenceAssetIds: [asset.id],
      },
      source,
      idempotencyKey: "character",
    })
  ).record;
  const look = (
    await ok("memory_save", {
      kind: "character-look",
      name: "红衣",
      data: {
        characterId: character.id,
        description: "红色外套",
        referenceAssetIds: [],
      },
      source,
      idempotencyKey: "look",
    })
  ).record;
  expect((await ok("memory_search", { query: "主持人" })).items[0].id).toBe(
    character.id,
  );
  const resolved = await ok("creative_context_resolve", {
    characterIds: [character.id],
    lookIds: [look.id],
  });
  expect(resolved.characters[0].data.referenceAssetIds).toEqual([asset.id]);
  expect(resolved.references).toEqual([
    { assetId: asset.id, role: "character", characterId: character.id },
  ]);
  const other = (await service.createAccount("Other", 0)).key;
  expect(
    (
      await call(
        "memory_save",
        {
          kind: "character",
          name: "bad",
          data: { referenceAssetIds: [asset.id] },
          source,
          idempotencyKey: "bad",
        },
        other,
      )
    ).status,
  ).toBe(404);
  await db.transaction((tx) =>
    tx.query("DELETE FROM entities WHERE id=$1", [asset.id]),
  );
  expect(
    (await ok("creative_context_resolve", { characterIds: [character.id] }))
      .missingInputs,
  ).toHaveLength(1);
});

it("pins the resolved context into requests and revisions and blocks deterministic violations", async () => {
  const set = await ruleSet();
  const first = (await rule(set.id)).record;
  const context = await ok("creative_context_resolve", {});
  const request = await ok("workspace_request_save", {
    message: "按规范制作",
    creativeContextId: context.id,
  });
  const bad = await call("workspace_commit", {
    requestId: request.requestId,
    requestVersion: request.requestVersion,
    message: "bad",
    idempotencyKey: "bad-render",
    action: {
      type: "create",
      composition: { ...composition, width: 640, height: 360 },
    },
  });
  expect(bad).toMatchObject({ status: 409, error: { code: "RULE_VIOLATION" } });
  const result = await ok("workspace_commit", {
    requestId: request.requestId,
    requestVersion: request.requestVersion,
    message: "good",
    idempotencyKey: "good-render",
    action: { type: "create", composition },
  });
  await ok("rule_upsert", {
    id: first.id,
    expectedVersion: 1,
    definition: { target: "output.aspectRatio", operator: "eq", value: "16:9" },
    source,
    idempotencyKey: "later",
  });
  const snapshot = await ok("workspace_snapshot", {
    projectId: result.projectId,
  });
  expect(snapshot.revision.creativeContext.rules[0]).toMatchObject({
    version: 1,
    definition: { value: "9:16" },
  });
  expect((await ok("creative_context_resolve", {})).rules[0].version).toBe(2);
});

it("deletes local records and history without deleting independent media", async () => {
  const set = await ruleSet();
  const first = (await rule(set.id)).record;
  const deleted = await ok("memory_delete", {
    id: first.id,
    expectedVersion: 1,
    idempotencyKey: "delete",
  });
  expect(deleted.deletedId).toBe(first.id);
  expect((await call("memory_get", { id: first.id })).status).toBe(404);
  expect((await call("memory_history", { id: first.id })).status).toBe(404);
  expect((await ok("creative_context_resolve", {})).rules).toEqual([]);
});

it("supports a real MCP client maintaining incremental rules and exposes read-only annotations", async () => {
  const client = new Client({ name: "memory-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: {
        headers: { Host: "localhost", Authorization: `Bearer ${key}` },
      },
      fetch: async (input, init) => app.fetch(new Request(input, init)),
    }),
  );
  try {
    expect(client.getInstructions()).toContain("optional aids");
    const list = await client.listTools();
    expect(
      list.tools.find((tool) => tool.name === "memory_search")?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    expect(
      list.tools.find((tool) => tool.name === "memory_delete")?.annotations
        ?.destructiveHint,
    ).toBe(true);
    const saved = await client.callTool({
      name: "rule_set_save",
      arguments: { name: "Agent 规范", source, idempotencyKey: "mcp-set" },
    });
    const set = (saved.structuredContent as any).result.record;
    const added = await client.callTool({
      name: "rule_upsert",
      arguments: {
        ruleSetId: set.id,
        definition: { target: "captions.maxLines", operator: "lte", value: 2 },
        source,
        idempotencyKey: "mcp-rule",
      },
    });
    expect(added.isError).not.toBe(true);
    expect((await ok("rule_list", { ruleSetId: set.id })).items).toHaveLength(
      1,
    );
    const readKey = await ok("key_create", {
      name: "Read",
      scopes: ["read"],
      budgetCents: 0,
    });
    expect((await ok("memory_get", { id: set.id }, readKey.key)).id).toBe(
      set.id,
    );
    expect(
      (
        await call(
          "rule_set_save",
          { name: "Denied", source, idempotencyKey: "readonly" },
          readKey.key,
        )
      ).status,
    ).toBe(403);
  } finally {
    await client.close();
  }
});

it("handles brand and series scopes, preferred overrides and cross-set hard conflicts", async () => {
  const brand = (
    await ok("memory_save", {
      kind: "brand",
      name: "A",
      source,
      idempotencyKey: "brand",
    })
  ).record;
  const series = (
    await ok("memory_save", {
      kind: "series",
      name: "教程",
      data: { brandId: brand.id },
      source,
      idempotencyKey: "series",
    })
  ).record;
  const global = await ruleSet();
  const scoped = (
    await ok("rule_set_save", {
      name: "系列规范",
      scope: { kind: "series", id: series.id },
      source,
      idempotencyKey: "series-rules",
    })
  ).record;
  const make = (
    ruleSetId: string,
    value: string,
    strength: string,
    idempotencyKey: string,
  ) =>
    ok("rule_upsert", {
      ruleSetId,
      definition: { target: "output.aspectRatio", operator: "eq", value },
      strength,
      source,
      idempotencyKey,
    });
  await make(global.id, "9:16", "preferred", "global");
  const specific = (await make(scoped.id, "16:9", "preferred", "specific"))
    .record;
  const context = await ok("creative_context_resolve", { seriesId: series.id });
  expect(context.input.brandId).toBe(brand.id);
  expect(context.rules.map((r: any) => r.id)).toEqual([specific.id]);
  expect(context.overridden).toHaveLength(1);
  expect(
    (await ok("creative_context_resolve", {})).rules[0].definition.value,
  ).toBe("9:16");
  const otherBrand = (
    await ok("memory_save", {
      kind: "brand",
      name: "B",
      source,
      idempotencyKey: "brand-b",
    })
  ).record;
  expect(
    (
      await call("creative_context_resolve", {
        brandId: otherBrand.id,
        seriesId: series.id,
      })
    ).status,
  ).toBe(400);
  const hard = (await make(global.id, "9:16", "required", "hard")).record;
  await ok("rule_upsert", {
    id: specific.id,
    expectedVersion: specific.version,
    strength: "required",
    source,
    idempotencyKey: "specific-hard",
  });
  const conflicted = await ok("creative_context_resolve", {
    seriesId: series.id,
  });
  expect(conflicted.conflicts[0].ruleIds).toContain(hard.id);
  const plan = await ok("workspace_plan", {
    message: "脚本：你好",
    creativeContextId: conflicted.id,
  });
  expect(plan.status).toBe("waiting_input");
  expect(plan.action).toBeUndefined();
});

it("validates numeric intervals, composition constraints and reports visual rules as unverified", async () => {
  const set = await ruleSet();
  const add = (
    target: string,
    operator: string,
    value: number | string,
    idempotencyKey: string,
  ) =>
    ok("rule_upsert", {
      ruleSetId: set.id,
      definition: { target, operator, value },
      source,
      idempotencyKey,
    });
  await add("output.durationMs", "gte", 2000, "min");
  await add("output.durationMs", "lte", 4000, "max");
  await add("editing.shotDurationMs", "eq", 3000, "shot");
  await add("output.language", "eq", "zh", "lang");
  await add("captions.maxLines", "lte", 2, "lines");
  await add("visual.mood", "guidance", "自然", "mood");
  expect(
    (
      await call("rule_upsert", {
        ruleSetId: set.id,
        definition: {
          target: "output.durationMs",
          operator: "gte",
          value: 5000,
        },
        source,
        idempotencyKey: "bad-range",
      })
    ).status,
  ).toBe(409);
  const context = await ok("creative_context_resolve", {});
  expect(context.reviewRequired).toHaveLength(2);
  const result = await ok("workspace_commit", {
    creativeContextId: context.id,
    message: "hi",
    idempotencyKey: "range-commit",
    action: { type: "create", composition: { ...composition, language: "zh" } },
  });
  const snapshot = await ok("workspace_snapshot", {
    projectId: result.projectId,
  });
  expect(
    snapshot.revision.creativeRuleChecks.filter(
      (check: any) => check.status === "passed",
    ),
  ).toHaveLength(4);
  expect(
    snapshot.revision.creativeRuleChecks.filter(
      (check: any) => check.status === "unverified",
    ),
  ).toHaveLength(2);
  expect(
    (
      await call("workspace_commit", {
        creativeContextId: context.id,
        message: "bad",
        idempotencyKey: "language-bad",
        action: {
          type: "create",
          composition: { ...composition, language: "en" },
        },
      })
    ).status,
  ).toBe(409);
  expect(
    (await ok("memory_search", { kind: "creative-rule", limit: 2 })).nextOffset,
  ).toBe(2);
  expect(
    (await ok("memory_history", { id: set.id, limit: 2 })).nextOffset,
  ).toBe(2);
});

it("uses explicit character identity rules, validates looks, voices and retired references", async () => {
  const c = await service.authenticate(key);
  const asset = await service.registerAsset(
    c.accountId,
    Buffer.from("portrait"),
    {
      name: "face.png",
      kind: "image",
      mime: "image/png",
      metadata: {},
      provenance: {},
    },
  );
  const character = (
    await ok("memory_save", {
      kind: "character",
      name: "主角",
      data: { referenceAssetIds: [asset.id] },
      source,
      idempotencyKey: "hero",
    })
  ).record;
  const second = (
    await ok("memory_save", {
      kind: "character",
      name: "另一个人",
      source,
      idempotencyKey: "second",
    })
  ).record;
  const look = (
    await ok("memory_save", {
      kind: "character-look",
      name: "造型",
      data: {
        characterId: character.id,
        description: "红外套",
        referenceAssetIds: [asset.id],
      },
      source,
      idempotencyKey: "outfit",
    })
  ).record;
  const voice = (
    await ok("memory_save", {
      kind: "voice-profile",
      name: "讲述音色",
      data: {
        provider: "configured-provider",
        voiceId: "voice-id",
        characterId: character.id,
      },
      source,
      idempotencyKey: "voice",
    })
  ).record;
  const set = await ruleSet();
  const identity = (
    await ok("rule_upsert", {
      ruleSetId: set.id,
      definition: {
        target: "character.identity",
        operator: "eq",
        value: character.id,
      },
      source,
      idempotencyKey: "identity",
    })
  ).record;
  await ok("rule_upsert", {
    ruleSetId: set.id,
    definition: {
      target: "audio.voiceProfile",
      operator: "eq",
      value: voice.id,
    },
    source,
    idempotencyKey: "voice-rule",
  });
  const context = await ok("creative_context_resolve", { lookIds: [look.id] });
  expect(context.characters[0].id).toBe(character.id);
  expect(context.references[0].lookId).toBe(look.id);
  expect(context.voices[0].data.voiceId).toBe("voice-id");
  expect(
    (await ok("creative_context_resolve", { characterIds: [second.id] }))
      .conflicts,
  ).toHaveLength(1);
  await ok("rule_upsert", {
    id: identity.id,
    expectedVersion: 1,
    strength: "preferred",
    source,
    idempotencyKey: "prefer",
  });
  expect(
    (await ok("creative_context_resolve", { characterIds: [second.id] }))
      .overridden,
  ).toHaveLength(1);
  expect(
    (
      await call("creative_context_resolve", {
        characterIds: [second.id],
        lookIds: [look.id],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("memory_delete", {
        id: character.id,
        expectedVersion: 1,
        idempotencyKey: "dependent-delete",
      })
    ).status,
  ).toBe(409);
  await ok("memory_archive", {
    id: voice.id,
    expectedVersion: 1,
    idempotencyKey: "retire-voice",
  });
  expect((await ok("creative_context_resolve", {})).missingInputs).toHaveLength(
    1,
  );
  await ok("memory_archive", {
    id: character.id,
    expectedVersion: 1,
    idempotencyKey: "retire-hero",
  });
  expect((await ok("creative_context_resolve", {})).missingInputs).toHaveLength(
    2,
  );
  expect(
    (await call("creative_context_resolve", { characterIds: [character.id] }))
      .status,
  ).toBe(409);
  expect(
    (
      await call("workspace_commit", {
        creativeContextId: context.id,
        message: "stale",
        idempotencyKey: "stale-person",
        action: { type: "create", composition },
      })
    ).status,
  ).toBe(409);
});

it("supports safe patches, scoped characters and rejects fabricated provenance or invalid data", async () => {
  const brand = (
    await ok("memory_save", {
      kind: "brand",
      name: "品牌",
      source,
      idempotencyKey: "b",
    })
  ).record;
  const character = (
    await ok("memory_save", {
      kind: "character",
      name: "小林",
      data: { brandId: brand.id, aliases: ["主持人"] },
      source,
      idempotencyKey: "c",
    })
  ).record;
  expect(
    (await call("creative_context_resolve", { characterIds: [character.id] }))
      .status,
  ).toBe(409);
  expect(
    (
      await ok("creative_context_resolve", {
        brandId: brand.id,
        characterIds: [character.id],
      })
    ).missingInputs,
  ).toHaveLength(1);
  const updated = (
    await ok("memory_save", {
      id: character.id,
      kind: "character",
      expectedVersion: 1,
      data: { description: "保持名字和别名", brandId: null },
      source,
      idempotencyKey: "patch",
    })
  ).record;
  expect(updated).toMatchObject({
    name: "小林",
    data: { aliases: ["主持人"], description: "保持名字和别名" },
  });
  expect(updated.data.brandId).toBeUndefined();
  expect(
    (
      await call("memory_save", {
        id: character.id,
        kind: "character",
        expectedVersion: 1,
        name: "过期",
        source,
        idempotencyKey: "old",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call("memory_save", {
        kind: "character",
        name: "错误",
        data: { unknown: true },
        source,
        idempotencyKey: "unknown",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("memory_save", {
        kind: "character",
        name: "来源",
        source: { ...source, requestId: "not-owned" },
        idempotencyKey: "source",
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await call("memory_save", {
        kind: "character",
        name: "推测",
        status: "active",
        source: { kind: "agent_inference", text: "推测" },
        idempotencyKey: "inference",
      })
    ).status,
  ).toBe(400);
  const draft = (
    await ok("memory_save", {
      kind: "character",
      name: "待确认",
      source: { kind: "agent_inference", text: "推测" },
      idempotencyKey: "draft-person",
    })
  ).record;
  expect(draft.status).toBe("draft");
  expect((await ok("memory_search", { status: "draft" })).items[0].id).toBe(
    draft.id,
  );
  expect(
    (
      await call("memory_save", {
        kind: "brand",
        name: "Changed retry",
        source,
        idempotencyKey: "b",
      })
    ).status,
  ).toBe(409);
});

it("requires project scope ownership, preserves request context and protects concurrent updates", async () => {
  const project = await ok("project_create", { title: "Scoped" });
  const set = (
    await ok("rule_set_save", {
      name: "作品规范",
      scope: { kind: "project", id: project.id },
      source,
      idempotencyKey: "project-set",
    })
  ).record;
  await rule(set.id);
  const context = await ok("creative_context_resolve", {
    projectId: project.id,
  });
  expect(context.rules).toHaveLength(1);
  expect((await ok("creative_context_resolve", {})).rules).toHaveLength(0);
  expect(
    (
      await call("workspace_request_save", {
        message: "wrong project",
        creativeContextId: context.id,
      })
    ).status,
  ).toBe(409);
  const request = await ok("workspace_request_save", {
    message: "scoped",
    projectId: project.id,
    creativeContextId: context.id,
  });
  const resumed = await ok("workspace_request_save", {
    requestId: request.requestId,
    requestVersion: request.requestVersion,
    message: "继续",
  });
  expect(resumed.creativeContextId).toBe(context.id);
  expect(
    (await call("creative_context_resolve", { projectId: "absent" })).status,
  ).toBe(404);
  expect(
    (
      await call("rule_set_save", {
        name: "bad",
        scope: { kind: "project", id: "absent" },
        source,
        idempotencyKey: "missing-project",
      })
    ).status,
  ).toBe(404);
  const current = await ok("memory_get", { id: set.id });
  const responses = await Promise.all(
    ["a", "b"].map((idempotencyKey) =>
      call("rule_set_save", {
        id: set.id,
        expectedVersion: current.version,
        name: idempotencyKey,
        source,
        idempotencyKey,
      }),
    ),
  );
  expect(responses.map((x) => x.status).sort()).toEqual([200, 409]);
  const latest = await ok("memory_get", { id: set.id });
  expect(
    (
      await call("rule_set_save", {
        id: set.id,
        expectedVersion: latest.version,
        scope: { kind: "account" },
        source,
        idempotencyKey: "move",
      })
    ).status,
  ).toBe(400);
  await ok("memory_archive", {
    id: set.id,
    expectedVersion: latest.version,
    idempotencyKey: "archive-set",
  });
  expect(
    (await ok("creative_context_resolve", { projectId: project.id })).rules,
  ).toHaveLength(0);
});
