import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  AppError,
  compositionSchema,
  idSchema,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import { fingerprint, type Service } from "../../core/src/index.js";
import { templateSchema, type Template } from "./schema.js";
import { promptContentSchema, promptTemplateSchema } from "./prompt-schema.js";
export const saveTemplateSchema = z
  .object({
    id: idSchema.optional(),
    expectedVersion: z.number().int().positive().optional(),
    idempotencyKey: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(2000).default(""),
    category: z.string().max(60).default("个人模板"),
    searchTerms: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    revisionId: idSchema.optional(),
    preparationId: idSchema.optional(),
    composition: compositionSchema.optional(),
    parameters: templateSchema.shape.parameters.optional(),
    prompt: promptContentSchema.optional(),
  })
  .strict()
  .refine(
    (p) =>
      [p.revisionId, p.preparationId, p.composition, p.prompt].filter(Boolean)
        .length === 1,
    "Supply exactly one revisionId, preparationId, composition or prompt",
  );
export async function personalTemplates(service: Service, c: Context) {
  return service.scoped(c, "read", (tx) =>
    tx.list(c.accountId, "personal-template"),
  );
}
export async function personalVersion(
  service: Service,
  c: Context,
  id: string,
  version: number,
) {
  return service.scoped(c, "read", async (tx) => {
    const row = await tx.get(
      `ptv-${fingerprint([c.accountId, id, version])}`,
      c.accountId,
      "personal-template-version",
    );
    if (!row) throw new AppError("NOT_FOUND", "个人模板版本不存在", 404);
    return row.template;
  });
}
export async function saveTemplate(service: Service, c: Context, raw: unknown) {
  const p = saveTemplateSchema.parse(raw),
    inputHash = fingerprint(p),
    mutationId = `pts-${fingerprint([c.accountId, p.idempotencyKey])}`;
  return service.scoped(c, "write", async (tx) => {
    const prior = await tx.get(mutationId, c.accountId, "template-save");
    if (prior) {
      if (prior.inputHash !== inputHash)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "此保存标识已用于不同内容",
          409,
        );
      return prior.result;
    }
    const current = p.id
      ? await tx.get(p.id, c.accountId, "personal-template")
      : null;
    if (p.id && !current)
      throw new AppError("NOT_FOUND", "个人模板不存在", 404);
    if (
      current
        ? p.expectedVersion !== current.template.version
        : p.expectedVersion !== undefined
    )
      throw new AppError(
        "VERSION_CONFLICT",
        "请读取当前个人模板版本后再修改",
        409,
      );
    const source = p.revisionId
      ? await tx.get(p.revisionId, c.accountId, "revision")
      : p.preparationId
        ? await tx.get(p.preparationId, c.accountId, "template-preparation")
        : null;
    if ((p.revisionId || p.preparationId) && !source)
      throw new AppError("NOT_FOUND", "模板来源不存在", 404);
    const id = current?.id ?? `personal-${randomUUID()}`,
      version = (current?.template.version ?? 0) + 1;
    const metadata = {
      schemaVersion: 1 as const,
      id,
      version,
      title: p.title,
      description: p.description,
      category: p.category,
      searchTerms: p.searchTerms,
    };
    let definition;
    const prompt = p.prompt ?? source?.promptTemplate;
    if (prompt) {
      const parameters = Object.fromEntries(
        Object.entries(prompt.parameters ?? {}).map(([key, value]) => [
          key,
          {
            ...(value as { default: string; maxLength: number }),
            default:
              source?.templateSource?.parameters?.[key] ??
              (value as { default: string }).default,
          },
        ]),
      );
      definition = promptTemplateSchema.parse({
        ...prompt,
        parameters,
        ...metadata,
        kind: "prompt",
      });
    } else {
      const composition = compositionSchema.parse(
        p.composition ?? source?.composition,
      );
      const refs = [
        ...new Set(
          [
            ...composition.scenes.flatMap((s) => [
              s.assetId,
              s.audioAssetId,
              s.speechAlignment?.sourceAssetId,
              s.speechAlignment?.transcriptAssetId,
            ]),
            ...composition.events.map((e) => e.assetId),
            composition.audio?.assetId,
          ].filter((id): id is string => !!id),
        ),
      ];
      const assets: Template["assets"] = [];
      for (const assetId of refs) {
        const a = await tx.get(assetId, c.accountId, "asset");
        if (!a) throw new AppError("NOT_FOUND", "模板素材不属于当前账户", 404);
        assets.push({
          id: a.id,
          sha256: a.sha256,
          bytes: a.bytes,
          name: a.name,
          license: a.provenance?.license ?? "private-owned",
        });
      }
      definition = templateSchema.parse({
        ...metadata,
        composition,
        assets,
        parameters: p.parameters ?? {},
      });
    }
    if (
      current &&
      (current.template.kind === "prompt") !==
        ("kind" in definition && definition.kind === "prompt")
    )
      throw new AppError("INVALID_INPUT", "个人模板不能更改类型");
    const upstream =
      source?.templateSource?.source === "personal"
        ? (current?.template.upstream ??
          source.templateSource.upstream ??
          source.templateSource)
        : (source?.templateSource ?? current?.template.upstream);
    const template = {
      ...definition,
      hash: fingerprint(definition),
      sourceKind: "personal",
      ...(upstream ? { upstream } : {}),
    };
    const now = new Date().toISOString();
    await tx.put({
      id: `ptv-${fingerprint([c.accountId, id, version])}`,
      type: "personal-template-version",
      accountId: c.accountId,
      createdAt: now,
      template,
    });
    await tx.put({
      id,
      type: "personal-template",
      accountId: c.accountId,
      createdAt: current?.createdAt ?? now,
      template,
    });
    await tx.put({
      id: mutationId,
      type: "template-save",
      accountId: c.accountId,
      createdAt: now,
      inputHash,
      result: template,
    });
    return template;
  });
}
export async function rememberPreparation<
  T extends { templateSource: unknown },
>(service: Service, c: Context, prepared: T) {
  const id = `tp-${fingerprint([c.accountId, prepared])}`;
  await service.scoped(c, "write", async (tx) => {
    if (!(await tx.get(id, c.accountId, "template-preparation")))
      await tx.put({
        id,
        type: "template-preparation",
        accountId: c.accountId,
        createdAt: new Date().toISOString(),
        ...prepared,
      });
  });
  return { ...prepared, preparationId: id };
}
