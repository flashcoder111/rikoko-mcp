import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";

let db: Database, service: Service, dir: string, key: string;
let app: ReturnType<typeof createApp>;
const source = { kind: "user_instruction", text: "以后按此规范制作" };
const composition = {
  schemaVersion: 1, title: "规范测试", width: 360, height: 640,
  scenes: [{ id: "one", durationMs: 3000, text: "你好" }],
};
async function call(name: string, input: unknown, token = key) {
  const response = await app.request(`http://localhost/api/tools/${name}`, {
    method: "POST", headers: { Host: "localhost", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return { status: response.status, ...await response.json() as any };
}
async function ok(name: string, input: unknown, token = key) {
  const response = await call(name, input, token);
  expect(response, JSON.stringify(response)).toMatchObject({ status: 200 });
  return response.result;
}
async function ruleSet() {
  return (await ok("rule_set_save", { name: "口播规范", scope: { kind: "account" }, source, idempotencyKey: "set" })).record;
}
async function rule(setId: string, idempotencyKey = "rule") {
  return ok("rule_upsert", { ruleSetId: setId, definition: { target: "output.aspectRatio", operator: "eq", value: "9:16" }, source, idempotencyKey });
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rikoko-memory-"));
  db = await Database.open(join(dir, "db"));
  service = new Service(db, new LocalStorage(join(dir, "assets")));
  key = (await service.createAccount("Memory", 0)).key;
  app = createApp(service);
});
afterEach(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });

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
  expect((await ok("records_list", { type: "job" }))).toEqual([]);
});

it("patches individual rules with optimistic versions, detects conflicts and retains history", async () => {
  const set = await ruleSet();
  const first = (await rule(set.id)).record;
  const conflict = await call("rule_upsert", { ruleSetId: set.id, definition: { target: "output.aspectRatio", operator: "eq", value: "16:9" }, source, idempotencyKey: "conflict" });
  expect(conflict).toMatchObject({ status: 409, error: { code: "RULE_CONFLICT" } });
  const updated = await ok("rule_upsert", { id: first.id, expectedVersion: 1, definition: { target: "output.aspectRatio", operator: "eq", value: "16:9" }, source, idempotencyKey: "update" });
  expect(updated.record).toMatchObject({ id: first.id, version: 2, ruleSetId: set.id });
  expect((await call("rule_upsert", { id: first.id, expectedVersion: 1, strength: "preferred", source, idempotencyKey: "stale" })).status).toBe(409);
  const history = await ok("memory_history", { id: first.id });
  expect(history.items.map((x: any) => x.version)).toEqual([2, 1]);
  expect(history.items[1].definition.value).toBe("9:16");
  expect((await call("rule_upsert", { ruleSetId: set.id, definition: { target: "__proto__.x", operator: "eq", value: true }, source, idempotencyKey: "invalid" })).status).toBe(400);
});

it("keeps drafts and unresolved conditions out of effective rules and isolates accounts", async () => {
  const set = await ruleSet();
  await ok("rule_upsert", { ruleSetId: set.id, definition: { target: "visual.mood", operator: "guidance", value: "温暖" }, status: "draft", source: { kind: "agent_inference", text: "可能喜欢" }, idempotencyKey: "draft" });
  const conditional = await ok("rule_upsert", { ruleSetId: set.id, definition: { target: "output.durationMs", operator: "lte", value: 15000 }, when: { taskKind: "talking_head" }, source, idempotencyKey: "conditional" });
  expect((await ok("creative_context_resolve", {})).unresolved).toHaveLength(1);
  expect((await ok("creative_context_resolve", { taskKind: "talking_head" })).rules).toHaveLength(1);
  expect((await ok("creative_context_resolve", { taskKind: "ad" })).rules).toHaveLength(0);
  const other = (await service.createAccount("Other", 0)).key;
  expect((await ok("memory_search", {}, other)).items).toEqual([]);
  expect((await call("memory_get", { id: set.id }, other)).status).toBe(404);
  expect((await call("rule_upsert", { id: conditional.record.id, expectedVersion: 1, strength: "preferred", source, idempotencyKey: "steal" }, other)).status).toBe(404);
  await ok("memory_archive", { id: conditional.record.id, expectedVersion: 1, idempotencyKey: "archive" });
  expect((await ok("creative_context_resolve", { taskKind: "talking_head" })).rules).toEqual([]);
});

it("stores characters with owned references and separate looks; missing media is reported", async () => {
  const c = await service.authenticate(key);
  const asset = await service.registerAsset(c.accountId, Buffer.from("fixture"), { name: "portrait.png", kind: "image", mime: "image/png", metadata: {}, provenance: {} });
  const character = (await ok("memory_save", { kind: "character", name: "小林", data: { aliases: ["主持人"], description: "虚构角色", referenceAssetIds: [asset.id] }, source, idempotencyKey: "character" })).record;
  const look = (await ok("memory_save", { kind: "character-look", name: "红衣", data: { characterId: character.id, description: "红色外套", referenceAssetIds: [] }, source, idempotencyKey: "look" })).record;
  expect((await ok("memory_search", { query: "主持人" })).items[0].id).toBe(character.id);
  const resolved = await ok("creative_context_resolve", { characterIds: [character.id], lookIds: [look.id] });
  expect(resolved.characters[0].data.referenceAssetIds).toEqual([asset.id]);
  expect(resolved.references).toEqual([{ assetId: asset.id, role: "character", characterId: character.id }]);
  const other = (await service.createAccount("Other", 0)).key;
  expect((await call("memory_save", { kind: "character", name: "bad", data: { referenceAssetIds: [asset.id] }, source, idempotencyKey: "bad" }, other)).status).toBe(404);
  await db.transaction(tx => tx.query("DELETE FROM entities WHERE id=$1", [asset.id]));
  expect((await ok("creative_context_resolve", { characterIds: [character.id] })).missingInputs).toHaveLength(1);
});

it("pins the resolved context into requests and revisions and blocks deterministic violations", async () => {
  const set = await ruleSet();
  const first = (await rule(set.id)).record;
  const context = await ok("creative_context_resolve", {});
  const request = await ok("workspace_request_save", { message: "按规范制作", creativeContextId: context.id });
  const bad = await call("workspace_commit", { requestId: request.requestId, requestVersion: request.requestVersion, message: "bad", idempotencyKey: "bad-render", action: { type: "create", composition: { ...composition, width: 640, height: 360 } } });
  expect(bad).toMatchObject({ status: 409, error: { code: "RULE_VIOLATION" } });
  const result = await ok("workspace_commit", { requestId: request.requestId, requestVersion: request.requestVersion, message: "good", idempotencyKey: "good-render", action: { type: "create", composition } });
  await ok("rule_upsert", { id: first.id, expectedVersion: 1, definition: { target: "output.aspectRatio", operator: "eq", value: "16:9" }, source, idempotencyKey: "later" });
  const snapshot = await ok("workspace_snapshot", { projectId: result.projectId });
  expect(snapshot.revision.creativeContext.rules[0]).toMatchObject({ version: 1, definition: { value: "9:16" } });
  expect((await ok("creative_context_resolve", {})).rules[0].version).toBe(2);
});

it("deletes local records and history without deleting independent media", async () => {
  const set = await ruleSet();
  const first = (await rule(set.id)).record;
  const deleted = await ok("memory_delete", { id: first.id, expectedVersion: 1, idempotencyKey: "delete" });
  expect(deleted.deletedId).toBe(first.id);
  expect((await call("memory_get", { id: first.id })).status).toBe(404);
  expect((await call("memory_history", { id: first.id })).status).toBe(404);
  expect((await ok("creative_context_resolve", {})).rules).toEqual([]);
});
