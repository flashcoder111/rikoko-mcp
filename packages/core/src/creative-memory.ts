import { randomUUID } from "node:crypto";
import {
  AppError,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import { Service, fingerprint } from "./index.js";
import {
  memorySaveSchema,
  memoryDataSchemas,
  memoryGetSchema,
  memoryPageSchema,
  memoryHistorySchema,
  memoryChangeSchema,
  ruleSetSaveSchema,
  ruleUpsertSchema,
  type RuleDefinition,
  type MemoryScope,
} from "./creative-memory-contracts.js";

export const memoryTypes = [
  "brand",
  "series",
  "character",
  "character-look",
  "voice-profile",
  "rule-set",
  "creative-rule",
];
export function memoryError(
  code: string,
  message: string,
  status = 409,
): never {
  throw new AppError(code, message, status);
}
export function memoryView(record: Entity): Entity {
  const { accountId: _owner, ...rest } = record;
  return rest as Entity;
}
export async function ownedMemory(
  tx: Transaction,
  c: Context,
  id: string,
  kind?: string,
) {
  const record = await tx.get(id, c.accountId, kind);
  if (!record || !memoryTypes.includes(record.type))
    memoryError("NOT_FOUND", "找不到此本地档案或规则。", 404);
  return record;
}
export async function activeMemory(
  tx: Transaction,
  c: Context,
  id: string,
  kind: string,
) {
  const record = await ownedMemory(tx, c, id, kind);
  if (record.status !== "active")
    memoryError("MEMORY_INACTIVE", "此档案未生效或已停用。");
  return record;
}
function checkVersion(record: Entity, expected?: number) {
  if (expected !== record.version)
    memoryError(
      "MEMORY_CONFLICT",
      "档案已更新，请重新读取并使用当前 expectedVersion。",
    );
}
async function persist(tx: Transaction, record: Entity) {
  await tx.put(record);
  await tx.put({
    id: randomUUID(),
    accountId: record.accountId,
    type: "memory-history",
    createdAt: record.updatedAt,
    ownerId: record.id,
    version: record.version,
    record,
  });
}
function fresh(c: Context, type: string): Entity {
  return {
    id: randomUUID(),
    accountId: c.accountId,
    type,
    schemaVersion: 1,
    version: 0,
    createdAt: new Date().toISOString(),
  };
}
async function mutate<T extends object>(
  service: Service,
  c: Context,
  name: string,
  input: { idempotencyKey: string },
  fn: (tx: Transaction) => Promise<T>,
) {
  return service.scoped(c, "write", async (tx) => {
    const id = fingerprint({
      accountId: c.accountId,
      memoryMutation: name,
      key: input.idempotencyKey,
    });
    const hash = fingerprint(input);
    const previous = await tx.get(id, c.accountId, "memory-mutation");
    if (previous) {
      if (previous.inputHash !== hash)
        memoryError("IDEMPOTENCY_CONFLICT", "此幂等键已用于不同的修改。");
      return previous.result as T;
    }
    const result = await fn(tx);
    const linked = result as { record?: Entity; deletedId?: string };
    await tx.put({
      id,
      accountId: c.accountId,
      type: "memory-mutation",
      createdAt: new Date().toISOString(),
      ownerId: linked.record?.id ?? linked.deletedId,
      inputHash: hash,
      result,
    });
    return result;
  });
}
async function validateSource(
  tx: Transaction,
  c: Context,
  source: { kind: string; requestId?: string },
  status: string,
) {
  if (source.kind === "agent_inference" && status === "active")
    memoryError(
      "INVALID_INPUT",
      "推测只能保存为草稿，明确用户要求后才能生效。",
      400,
    );
  if (
    source.requestId &&
    !(await tx.get(source.requestId, c.accountId, "workspace-request"))
  )
    memoryError("NOT_FOUND", "来源请求不属于当前账户。", 404);
}
export async function validateScope(
  tx: Transaction,
  c: Context,
  scope: MemoryScope,
) {
  if (scope.kind === "account") return;
  if (scope.kind === "project") {
    if (!(await tx.get(scope.id, c.accountId, "project")))
      memoryError("NOT_FOUND", "找不到范围内的作品。", 404);
  } else await activeMemory(tx, c, scope.id, scope.kind);
}
async function validateData(
  tx: Transaction,
  c: Context,
  kind: keyof typeof memoryDataSchemas,
  data: Record<string, unknown>,
) {
  for (const [field, type] of [
    ["brandId", "brand"],
    ["seriesId", "series"],
    ["characterId", "character"],
  ] as const) {
    if (typeof data[field] === "string")
      await activeMemory(tx, c, data[field], type);
  }
  if (data.brandId && data.seriesId) {
    const series = await ownedMemory(tx, c, String(data.seriesId), "series");
    if (series.data.brandId && series.data.brandId !== data.brandId)
      memoryError("INVALID_INPUT", "系列与品牌不匹配。", 400);
  }
  for (const id of (data.referenceAssetIds ?? []) as string[]) {
    const asset = await tx.get(id, c.accountId, "asset");
    if (!asset) memoryError("NOT_FOUND", "参考素材不属于当前账户。", 404);
    if (asset.kind !== "image")
      memoryError("INVALID_MEDIA", `${kind} 的外观参考需要图片。`, 400);
  }
}
export async function memorySave(service: Service, c: Context, raw: unknown) {
  const input = memorySaveSchema.parse(raw);
  return mutate(service, c, "memory_save", input, async (tx) => {
    const previous = input.id
      ? await ownedMemory(tx, c, input.id, input.kind)
      : undefined;
    if (previous) checkVersion(previous, input.expectedVersion);
    else if (input.expectedVersion !== undefined)
      memoryError("INVALID_INPUT", "新档案不接受 expectedVersion。", 400);
    const name = input.name ?? previous?.name;
    if (!name) memoryError("INVALID_INPUT", "新档案需要名称。", 400);
    const patched = { ...previous?.data, ...input.data };
    for (const field of Object.keys(patched))
      if (patched[field] === null) delete patched[field];
    const data = memoryDataSchemas[input.kind].parse(patched);
    await validateData(tx, c, input.kind, data);
    const status =
      input.status ??
      previous?.status ??
      (input.source.kind === "user_instruction" ? "active" : "draft");
    await validateSource(tx, c, input.source, status);
    const record = {
      ...(previous ?? fresh(c, input.kind)),
      name,
      data,
      status,
      source: input.source,
      version: (previous?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    await persist(tx, record);
    return {
      action: previous ? "updated" : "added",
      record: memoryView(record),
    };
  });
}
export async function ruleSetSave(service: Service, c: Context, raw: unknown) {
  const input = ruleSetSaveSchema.parse(raw);
  return mutate(service, c, "rule_set_save", input, async (tx) => {
    const previous = input.id
      ? await ownedMemory(tx, c, input.id, "rule-set")
      : undefined;
    if (previous) checkVersion(previous, input.expectedVersion);
    else if (input.expectedVersion !== undefined)
      memoryError("INVALID_INPUT", "新规范集不接受 expectedVersion。", 400);
    const name = input.name ?? previous?.name;
    if (!name) memoryError("INVALID_INPUT", "规范集需要名称。", 400);
    const scope = input.scope ?? previous?.scope ?? { kind: "account" };
    if (previous && fingerprint(scope) !== fingerprint(previous.scope))
      memoryError(
        "INVALID_INPUT",
        "已有规范集不能迁移范围，请新建规范集。",
        400,
      );
    await validateScope(tx, c, scope);
    const status =
      input.status ??
      previous?.status ??
      (input.source.kind === "user_instruction" ? "active" : "draft");
    await validateSource(tx, c, input.source, status);
    const record = {
      ...(previous ?? fresh(c, "rule-set")),
      name,
      scope,
      status,
      source: input.source,
      version: (previous?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    await persist(tx, record);
    return {
      action: previous ? "updated" : "added",
      record: memoryView(record),
    };
  });
}
export function conditionsOverlap(
  a: Record<string, string>,
  b: Record<string, string>,
) {
  return Object.keys(a).every((key) => !b[key] || b[key] === a[key]);
}
export function definitionsConflict(a: RuleDefinition, b: RuleDefinition) {
  if (
    a.target !== b.target ||
    a.operator === "guidance" ||
    b.operator === "guidance"
  )
    return false;
  if (typeof a.value !== "number" || typeof b.value !== "number")
    return a.value !== b.value;
  const interval = (v: RuleDefinition) => [
    v.operator === "lte" ? -Infinity : Number(v.value),
    v.operator === "gte" ? Infinity : Number(v.value),
  ];
  const [al, ah] = interval(a),
    [bl, bh] = interval(b);
  return Math.max(al, bl) > Math.min(ah, bh);
}
export function ruleVerification(definition: RuleDefinition) {
  if (
    [
      "output.aspectRatio",
      "output.durationMs",
      "editing.shotDurationMs",
      "output.language",
    ].includes(definition.target)
  )
    return "deterministic";
  return definition.target === "audio.voiceProfile"
    ? "audio_review"
    : "visual_review";
}
export async function localRules(tx: Transaction, c: Context, setId?: string) {
  const result = await tx.query(
    "SELECT data FROM entities WHERE account_id=$1 AND type='creative-rule'" +
      (setId ? " AND data->>'ruleSetId'=$2" : "") +
      " ORDER BY id LIMIT 1001",
    [c.accountId, ...(setId ? [setId] : [])],
  );
  if (result.rows.length > 1000)
    memoryError(
      "MEMORY_LIMIT",
      "规则数量超过单次解析上限，请缩小规则库后重试。",
    );
  return result.rows.map((row) => row.data as Entity);
}
async function bumpSet(tx: Transaction, c: Context, setId: string) {
  const set = await ownedMemory(tx, c, setId, "rule-set");
  await persist(tx, {
    ...set,
    version: set.version + 1,
    updatedAt: new Date().toISOString(),
  });
}
export async function ruleUpsert(service: Service, c: Context, raw: unknown) {
  const input = ruleUpsertSchema.parse(raw);
  return mutate(service, c, "rule_upsert", input, async (tx) => {
    const previous = input.id
      ? await ownedMemory(tx, c, input.id, "creative-rule")
      : undefined;
    if (previous) checkVersion(previous, input.expectedVersion);
    else if (input.expectedVersion !== undefined)
      memoryError("INVALID_INPUT", "新规则不接受 expectedVersion。", 400);
    if (previous && input.ruleSetId && input.ruleSetId !== previous.ruleSetId)
      memoryError("INVALID_INPUT", "规则不能迁移规范集。", 400);
    const ruleSetId = input.ruleSetId ?? previous?.ruleSetId;
    const definition = input.definition ?? previous?.definition;
    if (!ruleSetId || !definition)
      memoryError("INVALID_INPUT", "新规则需要 ruleSetId 和 definition。", 400);
    const set = await ownedMemory(tx, c, ruleSetId, "rule-set");
    await validateScope(tx, c, set.scope);
    if (definition.target === "character.identity")
      await activeMemory(tx, c, definition.value, "character");
    if (definition.target === "audio.voiceProfile")
      await activeMemory(tx, c, definition.value, "voice-profile");
    const status =
      input.status ??
      previous?.status ??
      (input.source.kind === "user_instruction" ? "active" : "draft");
    await validateSource(tx, c, input.source, status);
    const value = {
      ruleSetId,
      definition,
      when: input.when ?? previous?.when ?? {},
      strength: input.strength ?? previous?.strength ?? "required",
      status,
    };
    const existing = await localRules(tx, c, ruleSetId);
    for (const other of existing) {
      if (other.id === previous?.id) continue;
      const identity = {
        ruleSetId: other.ruleSetId,
        definition: other.definition,
        when: other.when,
        strength: other.strength,
        status: other.status,
      };
      if (fingerprint(identity) === fingerprint(value)) {
        if (previous)
          memoryError(
            "RULE_DUPLICATE",
            `规则与 ${other.id} 重复，请停用多余规则。`,
          );
        return { action: "unchanged", record: memoryView(other) };
      }
      if (
        status === "active" &&
        other.status === "active" &&
        value.strength === "required" &&
        other.strength === "required" &&
        conditionsOverlap(value.when, other.when) &&
        definitionsConflict(definition, other.definition)
      )
        memoryError(
          "RULE_CONFLICT",
          `与规则 ${other.id} 冲突，请明确修改该规则或调整生效条件。`,
        );
    }
    const record = {
      ...(previous ?? fresh(c, "creative-rule")),
      ...value,
      scope: set.scope,
      source: input.source,
      verification: ruleVerification(definition),
      version: (previous?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    await persist(tx, record);
    await bumpSet(tx, c, ruleSetId);
    return {
      action: previous ? "updated" : "added",
      record: memoryView(record),
    };
  });
}
export async function memoryGet(service: Service, c: Context, raw: unknown) {
  const input = memoryGetSchema.parse(raw);
  return service.scoped(c, "read", async (tx) =>
    memoryView(await ownedMemory(tx, c, input.id)),
  );
}
export async function memorySearch(service: Service, c: Context, raw: unknown) {
  const input = memoryPageSchema.parse(raw);
  return service.scoped(c, "read", async (tx) => {
    if (input.ruleSetId) await ownedMemory(tx, c, input.ruleSetId, "rule-set");
    const rows = await tx.query(
      "SELECT data FROM entities WHERE account_id=$1 AND type=ANY($2::text[]) AND data->>'status'=$3 AND ($4::text IS NULL OR data->>'ruleSetId'=$4) AND ($5='' OR strpos(lower(coalesce(data->>'name','') || ' ' || coalesce(data->'data'->>'aliases','') || ' ' || coalesce(data->'data'->>'description','') || ' ' || coalesce(data->'definition'->>'target','')),lower($5))>0) ORDER BY data->>'updatedAt' DESC,id LIMIT $6 OFFSET $7",
      [
        c.accountId,
        input.kind ? [input.kind] : memoryTypes,
        input.status,
        input.ruleSetId ?? null,
        input.query,
        input.limit + 1,
        input.offset,
      ],
    );
    return {
      items: rows.rows.slice(0, input.limit).map((row) => memoryView(row.data)),
      nextOffset:
        rows.rows.length > input.limit ? input.offset + input.limit : null,
    };
  });
}
export async function memoryHistory(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = memoryHistorySchema.parse(raw);
  return service.scoped(c, "read", async (tx) => {
    await ownedMemory(tx, c, input.id);
    const rows = await tx.query(
      "SELECT data FROM entities WHERE account_id=$1 AND type='memory-history' AND data->>'ownerId'=$2 ORDER BY (data->>'version')::integer DESC LIMIT $3 OFFSET $4",
      [c.accountId, input.id, input.limit + 1, input.offset],
    );
    return {
      items: rows.rows
        .slice(0, input.limit)
        .map((row) => memoryView(row.data.record)),
      nextOffset:
        rows.rows.length > input.limit ? input.offset + input.limit : null,
    };
  });
}
export async function memoryChange(
  service: Service,
  c: Context,
  raw: unknown,
  remove: boolean,
) {
  const input = memoryChangeSchema.parse(raw);
  return mutate(
    service,
    c,
    remove ? "memory_delete" : "memory_archive",
    input,
    async (tx) => {
      const record = await ownedMemory(tx, c, input.id);
      checkVersion(record, input.expectedVersion);
      if (!remove) {
        const next = {
          ...record,
          status: "archived",
          version: record.version + 1,
          updatedAt: new Date().toISOString(),
        };
        await persist(tx, next);
        if (record.type === "creative-rule")
          await bumpSet(tx, c, record.ruleSetId);
        return { action: "archived", record: memoryView(next) };
      }
      // Deleting a collection with members would silently orphan editable records.
      const dependencies = await tx.query(
        "SELECT id FROM entities WHERE account_id=$1 AND type=ANY($2::text[]) AND (data->>'ruleSetId'=$3 OR data->'scope'->>'id'=$3 OR data->'data'->>'characterId'=$3 OR data->'data'->>'brandId'=$3 OR data->'data'->>'seriesId'=$3 OR (data->'definition'->>'target'=ANY($4::text[]) AND data->'definition'->>'value'=$3)) LIMIT 1",
        [
          c.accountId,
          memoryTypes,
          record.id,
          ["character.identity", "audio.voiceProfile"],
        ],
      );
      if (dependencies.rows.length)
        memoryError(
          "MEMORY_IN_USE",
          "其他档案或规则仍引用此记录，请先修改引用或停用此记录。",
        );
      await tx.query(
        "DELETE FROM entities WHERE account_id=$1 AND (id=$2 OR (type=ANY($3::text[]) AND data->>'ownerId'=$2))",
        [c.accountId, record.id, ["memory-history", "memory-mutation"]],
      );
      if (record.type === "creative-rule")
        await bumpSet(tx, c, record.ruleSetId);
      return {
        action: "deleted",
        deletedId: record.id,
        retained: [
          "independent_assets",
          "frozen_creative_contexts",
          "project_revisions",
        ],
      };
    },
  );
}
