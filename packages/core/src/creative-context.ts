import {
  type Composition,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import { Service, fingerprint } from "./index.js";
import {
  resolveContextSchema,
  type ResolveContextInput,
  type MemoryScope,
  type RuleDefinition,
} from "./creative-memory-contracts.js";
import {
  activeMemory,
  definitionsConflict,
  localRules,
  memoryError,
  memoryView,
} from "./creative-memory.js";

function applies(scope: MemoryScope, input: ResolveContextInput) {
  return (
    scope.kind === "account" ||
    (scope.kind === "character"
      ? input.characterIds.includes(scope.id)
      : input[`${scope.kind}Id` as "brandId" | "seriesId" | "projectId"] ===
        scope.id)
  );
}
const ranks = { account: 0, brand: 1, series: 2, character: 3, project: 4 };

export async function resolveCreativeContext(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = resolveContextSchema.parse(raw);
  return service.scoped(c, "write", async (tx) => {
    if (
      input.projectId &&
      !(await tx.get(input.projectId, c.accountId, "project"))
    )
      memoryError("NOT_FOUND", "找不到作品。", 404);
    if (input.seriesId) {
      const series = await activeMemory(tx, c, input.seriesId, "series");
      if (series.data.brandId) {
        if (input.brandId && input.brandId !== series.data.brandId)
          memoryError("INVALID_INPUT", "品牌与系列不匹配。", 400);
        input.brandId = series.data.brandId;
      }
    }
    if (input.brandId) await activeMemory(tx, c, input.brandId, "brand");
    const setsResult = await tx.query(
      "SELECT data FROM entities WHERE account_id=$1 AND type='rule-set' AND data->>'status'='active' ORDER BY id LIMIT 1001",
      [c.accountId],
    );
    if (setsResult.rows.length > 1000)
      memoryError("MEMORY_LIMIT", "规范集超过单次解析上限。");
    const sets = new Map<string, Entity>(
      setsResult.rows.map((row) => [row.data.id, row.data]),
    );
    const candidates: Entity[] = [],
      unresolved: Entity[] = [];
    for (const rule of await localRules(tx, c)) {
      const set = sets.get(rule.ruleSetId);
      if (rule.status !== "active" || !set || !applies(set.scope, input))
        continue;
      const conditions = Object.entries(rule.when) as [
        "taskKind" | "language",
        string,
      ][];
      if (
        conditions.some(
          ([key, value]) => input[key] !== undefined && input[key] !== value,
        )
      )
        continue;
      if (conditions.some(([key]) => input[key] === undefined)) {
        unresolved.push(memoryView(rule));
        continue;
      }
      candidates.push(memoryView(rule));
    }
    const rules: Entity[] = [],
      overridden: { ruleId: string; byRuleId: string }[] = [];
    const conflicts: { ruleIds: string[]; target: string; reason: string }[] =
      [];
    candidates.sort(
      (a, b) =>
        Number(b.strength === "required") - Number(a.strength === "required") ||
        ranks[b.scope.kind as keyof typeof ranks] -
          ranks[a.scope.kind as keyof typeof ranks] ||
        a.id.localeCompare(b.id),
    );
    for (const rule of candidates) {
      const clashes = rules.filter((other) =>
        definitionsConflict(rule.definition, other.definition),
      );
      const winner = clashes.find(
        (other) =>
          rule.strength === "preferred" &&
          (other.strength === "required" ||
            ranks[other.scope.kind as keyof typeof ranks] >
              ranks[rule.scope.kind as keyof typeof ranks]),
      );
      if (winner) {
        overridden.push({ ruleId: rule.id, byRuleId: winner.id });
        continue;
      }
      for (const other of clashes)
        conflicts.push({
          ruleIds: [other.id, rule.id],
          target: rule.definition.target,
          reason: "适用规则的要求互相矛盾，请明确修改或停用。",
        });
      rules.push(rule);
    }
    const characters: Entity[] = [],
      looks: Entity[] = [],
      voices: Entity[] = [];
    const references: {
      assetId: string;
      role: "character";
      characterId: string;
      lookId?: string;
    }[] = [];
    const missingInputs: {
      id: string;
      kind: string;
      required: boolean;
      prompt: string;
      purpose: string;
    }[] = [];
    const selected = new Set(input.characterIds);
    for (const rule of rules) {
      if (rule.definition.target === "character.identity") {
        if (input.characterIds.length && !selected.has(rule.definition.value)) {
          if (rule.strength === "required")
            conflicts.push({
              ruleIds: [rule.id],
              target: "character.identity",
              reason: "当前选择的人物与硬性规则不一致。",
            });
          else
            overridden.push({
              ruleId: rule.id,
              byRuleId: "current-character-selection",
            });
        } else selected.add(rule.definition.value);
      }
      if (rule.definition.target === "audio.voiceProfile") {
        const voice = await tx.get(
          rule.definition.value,
          c.accountId,
          "voice-profile",
        );
        if (voice?.status === "active") voices.push(memoryView(voice));
        else
          missingInputs.push({
            id: rule.definition.value,
            kind: "text",
            required: true,
            prompt: "请更新失效的声音档案引用。",
            purpose: "恢复可用声音设置",
          });
      }
    }
    for (const id of selected) {
      const record = await tx.get(id, c.accountId, "character");
      if (!record || record.status !== "active") {
        if (input.characterIds.includes(id))
          await activeMemory(tx, c, id, "character");
        missingInputs.push({
          id,
          kind: "text",
          required: true,
          prompt: "请更新失效的人物档案引用。",
          purpose: "选择可用人物",
        });
        continue;
      }
      if (
        (record.data.brandId && record.data.brandId !== input.brandId) ||
        (record.data.seriesId && record.data.seriesId !== input.seriesId)
      )
        memoryError(
          "MEMORY_SCOPE_MISMATCH",
          "人物限定的品牌或系列与当前任务不一致。",
        );
      characters.push(memoryView(record));
    }
    for (const id of input.lookIds) {
      const look = await activeMemory(tx, c, id, "character-look");
      if (
        !characters.some((character) => character.id === look.data.characterId)
      )
        memoryError("INVALID_INPUT", "造型必须属于本次已选人物。", 400);
      if (
        looks.some((other) => other.data.characterId === look.data.characterId)
      )
        memoryError("INVALID_INPUT", "本次上下文每个人物只选择一个造型。", 400);
      looks.push(memoryView(look));
    }
    for (const character of characters) {
      const look = looks.find((item) => item.data.characterId === character.id);
      const assets = new Set<string>([
        ...character.data.referenceAssetIds,
        ...(look?.data.referenceAssetIds ?? []),
      ]);
      if (!assets.size)
        missingInputs.push({
          id: character.id,
          kind: "image",
          required: true,
          prompt: `请提供「${character.name}」的人物参考图。`,
          purpose: "保持人物外观",
        });
      for (const assetId of assets) {
        const asset = await tx.get(assetId, c.accountId, "asset");
        if (!asset || asset.kind !== "image") {
          missingInputs.push({
            id: assetId,
            kind: "image",
            required: true,
            prompt: "人物参考图已失效，请重新选择素材。",
            purpose: "恢复人物参考",
          });
        } else
          references.push({
            assetId,
            role: "character",
            characterId: character.id,
            ...(look?.data.referenceAssetIds.includes(assetId)
              ? { lookId: look.id }
              : {}),
          });
      }
    }
    const effective = rules.filter(
      (rule) => !overridden.some((item) => item.ruleId === rule.id),
    );
    const data = {
      input,
      rules: effective,
      ruleSets: [...new Set(effective.map((rule) => rule.ruleSetId))].map(
        (id) => memoryView(sets.get(id)!),
      ),
      characters,
      looks,
      voices,
      references,
      conflicts,
      unresolved,
      overridden,
      missingInputs,
      reviewRequired: effective
        .filter((rule) => rule.verification !== "deterministic")
        .map((rule) => ({
          ruleId: rule.id,
          verification: rule.verification,
          status: "unverified",
        })),
    };
    // Content-addressed snapshots make retries cheap; later mutations never replace this snapshot.
    const id = fingerprint({ accountId: c.accountId, creativeContext: data });
    const previous = await tx.get(id, c.accountId, "creative-context");
    if (previous) return memoryView(previous);
    const record: Entity = {
      id,
      accountId: c.accountId,
      type: "creative-context",
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      ...data,
    };
    await tx.put(record);
    return memoryView(record);
  });
}

export async function readCreativeContext(
  tx: Transaction,
  c: Context,
  id: string,
  projectId?: string,
) {
  const context = await tx.get(id, c.accountId, "creative-context");
  if (!context)
    memoryError("NOT_FOUND", "找不到创作规范快照，请重新解析。", 404);
  if (context.input.projectId && context.input.projectId !== projectId)
    memoryError("MEMORY_SCOPE_MISMATCH", "规范快照属于其他作品。");
  return memoryView(context);
}

/** New use rechecks references; existing revision snapshots remain historical evidence. */
export async function checkCreativeReferences(
  tx: Transaction,
  c: Context,
  context: Entity,
) {
  for (const character of context.characters as Entity[])
    await activeMemory(tx, c, character.id, "character");
  for (const look of context.looks as Entity[])
    await activeMemory(tx, c, look.id, "character-look");
  for (const voice of context.voices as Entity[])
    await activeMemory(tx, c, voice.id, "voice-profile");
  for (const reference of context.references as { assetId: string }[]) {
    const asset = await tx.get(reference.assetId, c.accountId, "asset");
    if (!asset || asset.kind !== "image")
      memoryError(
        "CREATIVE_CONTEXT_BLOCKED",
        "快照中的人物参考已失效，请重新解析。",
      );
  }
}

/** Checks only deterministic composition constraints, never claims visual identity review. */
export function validateCreativeComposition(
  context: Entity,
  composition: Composition,
) {
  if (
    context.conflicts.length ||
    context.missingInputs.some(
      (item: { required: boolean }) => item.required,
    ) ||
    context.unresolved.some((rule: Entity) => rule.strength === "required")
  )
    memoryError(
      "CREATIVE_CONTEXT_BLOCKED",
      "规范存在冲突、缺失素材或未知条件，请重新解析后提交。",
    );
  const checks: { ruleId: string; status: string }[] = [];
  for (const rule of context.rules as Entity[]) {
    const definition = rule.definition as RuleDefinition;
    let matches: boolean | undefined;
    const compare = (value: number) =>
      definition.operator === "lte"
        ? value <= Number(definition.value)
        : definition.operator === "gte"
          ? value >= Number(definition.value)
          : value === definition.value;
    switch (definition.target) {
      case "output.aspectRatio": {
        const [width, height] = definition.value.split(":").map(Number);
        matches = composition.width * height === composition.height * width;
        break;
      }
      case "output.durationMs":
        matches = compare(
          composition.scenes.reduce((sum, scene) => sum + scene.durationMs, 0),
        );
        break;
      case "editing.shotDurationMs":
        matches = composition.scenes.every((scene) =>
          compare(scene.durationMs),
        );
        break;
      case "output.language":
        matches = composition.language === definition.value;
        break;
    }
    if (matches === false && rule.strength === "required")
      memoryError(
        "RULE_VIOLATION",
        `作品不符合规则 ${rule.id}：${definition.target} ${definition.operator} ${definition.value}`,
      );
    checks.push({
      ruleId: rule.id,
      status:
        matches === undefined
          ? "unverified"
          : matches
            ? "passed"
            : "preference_not_applied",
    });
  }
  return checks;
}
