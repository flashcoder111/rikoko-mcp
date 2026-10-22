import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service, fingerprint } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { connectServices } from "../packages/cloud-client/src/index.js";
import { templateSchema } from "../packages/templates/src/schema.js";
let db: Database, service: Service, dir: string, c: any, other: any;
let revision = 1;
const definition = (version = revision) =>
  templateSchema.parse({
    schemaVersion: 1,
    id: "rikoko-starter-product",
    version,
    title: "Cloud coffee",
    composition: {
      schemaVersion: 1,
      title: "Coffee",
      width: 360,
      height: 640,
      scenes: [{ id: "shot", text: "Official " + version, durationMs: 1000 }],
    },
  });
const call = (name: string, input: any = {}, context = c): Promise<any> =>
  callTool(service, context, name as any, input);
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rikoko-templates-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  c = await service.authenticate((await service.createAccount("owner", 0)).key);
  other = await service.authenticate(
    (await service.createAccount("other", 0)).key,
  );
  revision = 1;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
function cloud() {
  return connectServices(
    service,
    { templateOrigin: "https://templates.example.com" },
    async () =>
      Response.json({
        schemaVersion: 1,
        revision,
        templates: [{ ...definition(), hash: fingerprint(definition()) }],
      }),
  );
}
it("prefers the cloud version of a built-in ID and preserves explicit built-in selection", async () => {
  cloud();
  await call("template_sync");
  expect(
    (await call("template_list")).templates.find(
      (t: any) => t.id === definition().id,
    ).sourceKind,
  ).toBe("cloud");
  expect(
    (await call("template_prepare", { id: definition().id, version: 1 }))
      .composition.scenes[0].text,
  ).toBe("Official 1");
  expect(
    (
      await call("template_prepare", {
        id: definition().id,
        version: 1,
        sourceKind: "builtin",
      })
    ).composition.scenes.length,
  ).toBe(3);
});
it("forks privately, retrieves by brief and never overwrites a personal fork during official updates", async () => {
  cloud();
  await call("template_sync");
  const p = await call("template_prepare", { id: definition().id, version: 1 });
  const saved = await call("template_save", {
    preparationId: p.preparationId,
    title: "Moonlight coffee ritual",
    description: "Moonlight coffee campaign",
    idempotencyKey: "save",
  });
  expect(saved.sourceKind).toBe("personal");
  expect(saved.upstream.version).toBe(1);
  revision = 2;
  await call("template_sync");
  const library = await call("template_list");
  const own = library.templates.find((t: any) => t.id === saved.id);
  expect(own.version).toBe(1);
  expect(own.composition.scenes[0].text).toBe("Official 1");
  expect(own.updateAvailable.version).toBe(2);
  expect(
    (
      await call("template_match", {
        brief: "Moonlight coffee ritual",
        limit: 5,
      })
    ).candidates.some((x: any) => x.template.id === saved.id),
  ).toBe(true);
  expect(
    (await call("template_list", {}, other)).templates.some(
      (t: any) => t.id === saved.id,
    ),
  ).toBe(false);
  await expect(
    call("template_prepare", { id: saved.id, version: 1 }, other),
  ).rejects.toThrow();
  const restored = await call("template_prepare", {
    id: definition().id,
    version: 1,
    sourceKind: "cloud",
  });
  expect(restored.composition.scenes[0].text).toBe("Official 1");
});
it("persists server-owned provenance through workspace commit and saves the edited revision", async () => {
  cloud();
  await call("template_sync");
  const p = await call("template_prepare", { id: definition().id, version: 1 });
  const composition = structuredClone(p.composition);
  composition.scenes[0].text = "My coffee copy";
  const committed = await call("workspace_commit", {
    templatePreparationId: p.preparationId,
    action: { type: "create", composition },
    message: "create",
    idempotencyKey: "commit",
  });
  const snap = await call("workspace_snapshot", {
    projectId: committed.projectId,
  });
  expect(snap.revision.templateSource.version).toBe(1);
  const saved = await call("template_save", {
    revisionId: snap.revision.id,
    title: "My coffee",
    idempotencyKey: "saved-revision",
  });
  expect(saved.composition.scenes[0].text).toBe("My coffee copy");
  expect(saved.upstream.version).toBe(1);
  await expect(
    call(
      "workspace_commit",
      {
        templatePreparationId: p.preparationId,
        action: { type: "create", composition },
        message: "forged",
        idempotencyKey: "foreign",
      },
      other,
    ),
  ).rejects.toThrow();
});
it("uses immutable personal versions, optimistic concurrency and idempotent saves", async () => {
  const input = {
    composition: definition().composition,
    title: "Personal coffee",
    idempotencyKey: "create",
  };
  const first = await call("template_save", input);
  expect((await call("template_save", input)).id).toBe(first.id);
  await expect(
    call("template_save", { ...input, title: "Changed" }),
  ).rejects.toThrow();
  const next = await call("template_save", {
    ...input,
    title: "Revised",
    id: first.id,
    expectedVersion: 1,
    idempotencyKey: "edit",
  });
  expect(next.version).toBe(2);
  await expect(
    call("template_save", {
      ...input,
      id: first.id,
      expectedVersion: 1,
      idempotencyKey: "stale",
    }),
  ).rejects.toThrow();
  expect(
    (await call("template_prepare", { id: first.id, version: 1 }))
      .templateSource.version,
  ).toBe(1);
  await expect(
    call(
      "template_save",
      { ...input, id: first.id, expectedVersion: 2, idempotencyKey: "foreign" },
      other,
    ),
  ).rejects.toThrow();
});
it("saves and retrieves personal prompt treatments, renders variables without generating", async () => {
  const saved = await call("template_save", {
    title: "Moonlight product closeup",
    prompt: {
      mode: "video",
      text: "Keep the moonlight. {{shot}}",
      parameters: { shot: { default: "", maxLength: 1000 } },
    },
    idempotencyKey: "prompt",
  });
  expect(
    (
      await call("template_match", {
        brief: "Moonlight product closeup",
        limit: 5,
      })
    ).promptCandidates.some((x: any) => x.template.id === saved.id),
  ).toBe(true);
  const prepared = await call("template_prompt_prepare", {
    id: saved.id,
    version: 1,
    parameters: { shot: "Hold the cup still." },
  });
  expect(prepared.text).toBe("Keep the moonlight. Hold the cup still.");
  expect(prepared.generationRequests).toBe(0);
  expect(await service.list(c, "job")).toHaveLength(0);
});
it("rejects changed official bytes for an existing version without damaging the cache", async () => {
  let changed = false;
  connectServices(
    service,
    { templateOrigin: "https://templates.example.com" },
    async () => {
      const t = definition();
      if (changed) t.title = "tampered version";
      return Response.json({
        schemaVersion: 1,
        revision: changed ? 2 : 1,
        templates: [{ ...t, hash: fingerprint(t) }],
      });
    },
  );
  await call("template_sync");
  changed = true;
  await expect(call("template_sync")).rejects.toThrow("已发布版本不可改写");
  expect(
    (await call("template_list")).templates.find(
      (t: any) => t.sourceKind === "cloud",
    ).title,
  ).toBe("Cloud coffee");
});
it("rejects another account assets and read-only writes", async () => {
  const asset = await service.registerAsset(
    other.accountId,
    Buffer.from("private"),
    {
      name: "private.png",
      kind: "image",
      mime: "image/png",
      metadata: { kind: "image", width: 360, height: 640 },
      provenance: { source: "test" },
    },
  );
  const composition = definition().composition;
  composition.scenes[0].assetId = asset.id;
  await expect(
    call("template_save", { title: "bad", composition, idempotencyKey: "bad" }),
  ).rejects.toThrow("不属于当前账户");
  const read = await service.authenticate(
    (
      await service.issueKey(c, {
        name: "reader",
        scopes: ["read"],
        budgetCents: 0,
      })
    ).key,
  );
  await expect(
    call(
      "template_save",
      {
        title: "bad",
        composition: definition().composition,
        idempotencyKey: "readonly",
      },
      read,
    ),
  ).rejects.toThrow();
});
it("distributes prompt templates through the official catalog and protects personal wording", async () => {
  const { promptTemplateSchema } =
    await import("../packages/templates/src/prompt-schema.js");
  connectServices(
    service,
    { templateOrigin: "https://templates.example.com" },
    async () => {
      const t = promptTemplateSchema.parse({
        kind: "prompt",
        schemaVersion: 1,
        id: "coffee-prompt",
        version: revision,
        title: "Coffee moonlight prompt",
        mode: "video",
        text: `Version ${revision}: {{shot}}`,
        parameters: { shot: { default: "Cup", maxLength: 100 } },
      });
      return Response.json({
        schemaVersion: 1,
        revision,
        templates: [],
        promptTemplates: [{ ...t, hash: fingerprint(t) }],
      });
    },
  );
  await call("template_sync");
  const p = await call("template_prompt_prepare", {
    id: "coffee-prompt",
    version: 1,
    parameters: { shot: "Hold still" },
  });
  const own = await call("template_save", {
    preparationId: p.preparationId,
    title: "Personal coffee prompt",
    idempotencyKey: "fork-prompt",
  });
  revision = 2;
  await call("template_sync");
  expect(
    (await call("template_prompt_prepare", { id: own.id, version: 1 })).text,
  ).toContain("Version 1");
  expect(
    (await call("template_list")).promptTemplates.find(
      (t: any) => t.id === own.id,
    ).updateAvailable.version,
  ).toBe(2);
  expect(
    (await call("template_prompt_prepare", { id: "coffee-prompt", version: 2 }))
      .text,
  ).toContain("Version 2");
});
it("publishes, rolls back and unpublishes immutable prompt versions in the cloud catalog", async () => {
  const { Catalog } = await import("../packages/templates/src/catalog.js");
  const catalog = new Catalog(db);
  await catalog.initialize();
  const input = {
    kind: "prompt",
    schemaVersion: 1,
    id: "official-prompt",
    version: 1,
    title: "Official",
    mode: "video",
    text: "Keep {{shot}}",
    parameters: { shot: { default: "still", maxLength: 100 } },
  };
  await catalog.save(input);
  await catalog.publish(input.id, 1);
  expect((await catalog.list()).promptTemplates[0].version).toBe(1);
  await expect(catalog.save(input)).rejects.toThrow("版本已存在");
  await catalog.save({ ...input, version: 2, text: "New {{shot}}" });
  await catalog.publish(input.id, 2);
  await catalog.publish(input.id, 1);
  expect((await catalog.list()).promptTemplates[0].version).toBe(1);
  await catalog.unpublish(input.id);
  expect((await catalog.list()).promptTemplates).toHaveLength(0);
});
it("renders built-in prompt kits and refuses wrong modes or undeclared variables", async () => {
  const list = await call("template_list");
  const t = list.promptTemplates.find((t: any) => t.sourceKind === "builtin");
  expect(t).toBeTruthy();
  const p = await call("template_prompt_prepare", {
    id: t.id,
    version: 1,
    sourceKind: "builtin",
    parameters: { shot: "A blue cup" },
  });
  expect(p.text).toContain("A blue cup");
  await expect(
    call("template_prompt_prepare", {
      id: t.id,
      version: 1,
      parameters: { unknown: "x" },
    }),
  ).rejects.toThrow();
  await expect(
    call("template_save", {
      title: "Bad",
      prompt: { mode: "video", text: "{{unknown}}" },
      idempotencyKey: "invalid-prompt",
    }),
  ).rejects.toThrow();
});

it("preserves chosen prompt values when saving a prepared prompt", async () => {
  const t = (await call("template_list")).promptTemplates[0];
  const p = await call("template_prompt_prepare", {
    id: t.id,
    version: t.version,
    sourceKind: t.sourceKind,
    parameters: { shot: "Keep my blue cup" },
  });
  const saved = await call("template_save", {
    preparationId: p.preparationId,
    title: "My blue cup",
    idempotencyKey: "blue",
  });
  expect(
    (await call("template_prompt_prepare", { id: saved.id, version: 1 })).text,
  ).toContain("Keep my blue cup");
});
it("automatically reuses an explicitly named personal composition in workspace planning", async () => {
  const saved = await call("template_save", {
    title: "Moonlight Ritual",
    composition: definition().composition,
    idempotencyKey: "named",
  });
  const plan = await call("workspace_plan", {
    message: "使用 Moonlight Ritual 模板制作视频",
  });
  expect(plan.proposal?.reuse?.templateId ?? plan.reuse?.templateId).toBe(
    saved.id,
  );
});
it("accepts prompt slot values up to the declared 4000-character limit", async () => {
  const saved = await call("template_save", {
    title: "Long prompt",
    prompt: {
      mode: "video",
      text: "{{shot}}",
      parameters: { shot: { default: "", maxLength: 4000 } },
    },
    idempotencyKey: "long",
  });
  expect(
    (
      await call("template_prompt_prepare", {
        id: saved.id,
        version: 1,
        parameters: { shot: "x".repeat(1500) },
      })
    ).text,
  ).toHaveLength(1500);
});
