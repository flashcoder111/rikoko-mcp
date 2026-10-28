import { videoRequestSnapshotSchema } from "./video-workflow.js";
import { sourceRelationIssues } from "./source-timeline.js";
import {
  remakeEvidenceSchema,
  validateRemakeEvidence,
} from "./reference-handoff.js";
import { remapVideoPolicy } from "../../contracts/src/video-policy.js";
import { assertVideoPolicy } from "../../providers/src/video-policy.js";
import { z } from "zod";
import {
  AppError,
  idSchema,
  operationSchema,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import { fingerprint, type Service } from "./index.js";
import {
  generationPrepareSchema,
  preparationRecordHash,
  prepareGeneration,
  validatePreparedGeneration,
} from "./generation-preparation.js";
import {
  productionPlanSchema,
  validateProductionPlan,
} from "./production-plan.js";
import { productionRequirementsSchema } from "./production-scope.js";
import { validateGenerationAssets } from "../../providers/src/generation-input.js";
import { checkGenerationTarget } from "../../providers/src/generation-target.js";
import { assertProductionQualityRetained } from "./production-editing.js";

export const cloudPreparationProtocol = "rikoko-cloud-preparation-v2";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const metadataSchema = z
  .object({
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    durationMs: z.number().int().positive().optional(),
    hasAudio: z.boolean().optional(),
    container: z.string().max(30).optional(),
  })
  .strict();
export const declaredReferenceSchema = z
  .object({
    id: idSchema,
    sha256: digest,
    bytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    kind: z.enum(["image", "video", "audio"]),
    mime: z.string().max(100),
    metadata: metadataSchema,
  })
  .strict();
/** Only properties used by generation validation cross the wire. No storage keys or access URLs. */
export function referenceDeclaration(asset: Entity) {
  const metadata = Object.fromEntries(
    Object.entries(asset.metadata ?? {}).filter(
      ([key, value]) =>
        value != null &&
        Object.hasOwn(metadataSchema.shape, key) &&
        (asset.kind !== "image" || ["width", "height"].includes(key)),
    ),
  );
  return declaredReferenceSchema.parse({
    id: asset.id,
    sha256: asset.sha256,
    bytes: asset.bytes,
    kind: asset.kind,
    mime: asset.mime,
    metadata,
  });
}
export const cloudPrepareSchema = z
  .object({
    protocol: z.literal(cloudPreparationProtocol),
    request: generationPrepareSchema,
    references: z.array(declaredReferenceSchema).max(12),
  })
  .strict();
export async function prepareCloudGeneration(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const data = cloudPrepareSchema.parse(raw);
  if (data.request.input.kind !== "generate" || data.request.input.storyboard)
    throw new AppError(
      "INVALID_INPUT",
      "Cloud preparations require generation; storyboard validation belongs to the host workspace",
    );
  const refs = data.request.input.references ?? [];
  if (
    refs.length !== data.references.length ||
    refs.some((r, i) => r.assetId !== data.references[i].id)
  )
    throw new AppError(
      "PROMPT_REFERENCE_MISMATCH",
      "Declared references must match the request order",
    );
  return prepareGeneration(
    service,
    c,
    data.request,
    data.references.map((a) => ({
      ...a,
      type: "asset",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
    })),
  );
}
export const cloudBindSchema = z
  .object({
    requestHash: digest,
    references: z
      .array(z.object({ sourceAssetId: idSchema, assetId: idSchema }).strict())
      .max(12),
  })
  .strict();
export async function bindCloudPreparation(
  service: Service,
  c: Context,
  id: string,
  raw: unknown,
): Promise<Entity> {
  const data = cloudBindSchema.parse(raw);
  return service.scoped(c, "write", async (tx) => {
    const saved = await tx.get(id, c.accountId, "generation-preparation");
    if (
      !saved ||
      saved.requestHash !== data.requestHash ||
      saved.referenceState !== "declared"
    )
      throw new AppError(
        "PREPARED_REQUEST_MISMATCH",
        "Use the owned cloud draft and its request hash",
        409,
      );
    await validatePreparedGeneration(service, tx, c.accountId, saved.input, {
      allowDeclared: true,
    });
    if (data.references.length !== saved.references.length)
      throw new AppError(
        "PROMPT_REFERENCE_MISMATCH",
        "Supply every reference in its prepared order",
      );
    const assets: Entity[] = [];
    for (let i = 0; i < data.references.length; i++) {
      const mapping = data.references[i],
        declared = saved.references[i];
      const asset = await tx.get(mapping.assetId, c.accountId, "asset");
      if (
        mapping.sourceAssetId !== declared.assetId ||
        !asset?.storageKey ||
        fingerprint({
          ...referenceDeclaration(asset),
          id: declared.assetId,
        }) !==
          fingerprint({
            id: declared.assetId,
            sha256: declared.sha256,
            bytes: declared.bytes,
            kind: declared.kind,
            mime: declared.mime,
            metadata: declared.metadata,
          })
      )
        throw new AppError(
          "PREPARED_REFERENCE_CHANGED",
          "Uploaded bytes or probed metadata do not match the preview; inspect and prepare again",
          409,
        );
      assets.push(asset);
    }
    // Deterministic derivative ID makes retries recover the same immutable binding.
    const preparedRequestId = `bound-${fingerprint([id, data])}`;
    const existing = await tx.get(
      preparedRequestId,
      c.accountId,
      "generation-preparation",
    );
    if (existing) {
      await validatePreparedGeneration(
        service,
        tx,
        c.accountId,
        existing.input,
      );
      return {
        ...existing,
        preparedRequestId,
        readyForSubmission: true,
        generated: false,
      };
    }
    const input = operationSchema.parse({
      ...saved.input,
      ...(saved.input.videoPolicy
        ? {
            videoPolicy: remapVideoPolicy(
              saved.input.videoPolicy,
              data.references,
            ),
          }
        : {}),
      preparedRequestId,
      ...(saved.input.references
        ? {
            references: saved.input.references.map((r: any, i: number) => ({
              ...r,
              assetId: assets[i].id,
            })),
          }
        : {}),
    });
    if (input.kind !== "generate")
      throw new AppError("INVALID_INPUT", "Expected generation");
    const model = service.provider.validate(input);
    validateGenerationAssets(model, input, assets);
    assertVideoPolicy(model, input, assets);
    const record = {
      ...saved,
      id: preparedRequestId,
      createdAt: new Date().toISOString(),
      referenceState: "bound",
      input,
      inputHash: fingerprint(input),
      parentPreparation: { id: saved.id, requestHash: saved.requestHash },
      references: assets.map((a, i) => ({
        ...input.references![i],
        sha256: a.sha256,
        bytes: a.bytes,
        kind: a.kind,
        mime: a.mime,
        metadata: a.metadata,
        storageIdentityHash: fingerprint(a.storageKey),
      })),
      providerRequest: {
        ...saved.providerRequest,
        referenceBindings: saved.providerRequest.referenceBindings.map(
          (r: any, i: number) => ({ ...r, assetId: assets[i].id }),
        ),
      },
      expectedOutput: checkGenerationTarget(model, input, assets),
    };
    const result = { ...record, requestHash: preparationRecordHash(record) };
    await tx.put(result);
    return {
      ...result,
      preparedRequestId,
      readyForSubmission: true,
      generated: false,
    };
  });
}
const contextBase = {
  protocol: z.literal(cloudPreparationProtocol),
  clientId: digest,
  localId: idSchema,
  version: z.number().int().positive(),
};
export const productionContextSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...contextBase,
      kind: z.literal("request"),
      request: videoRequestSnapshotSchema,
    })
    .strict(),
  z
    .object({
      ...contextBase,
      kind: z.literal("plan"),
      plan: productionPlanSchema,
      remakeEvidence: remakeEvidenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...contextBase,
      kind: z.literal("scope"),
      scope: z
        .object({
          version: z.number().int().positive(),
          planId: idSchema,
          planVersion: z.number().int().positive(),
          requirements: productionRequirementsSchema,
        })
        .strict(),
    })
    .strict(),
]);
/** Monotonic mirrors let the remote worker detect host plan/scope changes before spending. */
export async function syncCloudProductionContext(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const data = productionContextSchema.parse(raw);
  return service.scoped(c, "write", async (tx) => {
    const id = `context-${fingerprint([c.accountId, data.clientId, data.kind, data.localId])}`;
    const type =
      data.kind === "request"
        ? "workspace-request"
        : data.kind === "plan"
          ? "production-plan"
          : "project";
    const old = await tx.get(id, c.accountId, type);
    const content =
      data.kind === "request"
        ? data.request
        : data.kind === "plan"
          ? data.remakeEvidence
            ? { plan: data.plan, remakeEvidence: data.remakeEvidence }
            : data.plan
          : data.scope;
    if (data.kind === "request") {
      if (
        data.request.version !== data.version ||
        (old?.hostRequest &&
          old.hostRequest.assets.some(
            (a: any) =>
              !data.request.assets.some(
                (b) =>
                  b.assetId === a.assetId &&
                  b.sha256 === a.sha256 &&
                  b.kind === a.kind,
              ),
          ))
      )
        throw new AppError(
          "REQUEST_ASSET_CHANGED",
          "A mirrored request cannot remove or replace its original attachments",
          409,
        );
    }
    if (data.kind === "plan") {
      if (!old || old.sourceRelationContract === 1) {
        const issues = sourceRelationIssues(
          data.plan,
          data.remakeEvidence?.report,
        );
        if (issues.length)
          throw new AppError(
            "SOURCE_RELATION_DECISION_REQUIRED",
            issues.map((issue) => issue.message).join("\n"),
            409,
          );
      }
      if (old?.plan.treatment && !data.plan.treatment)
        throw new AppError(
          "TREATMENT_REQUIRED",
          "Retain or explicitly revise the mirrored treatment",
          409,
        );
      assertProductionQualityRetained(old?.plan, data.plan);
      if (!!data.plan.remake !== !!data.remakeEvidence)
        throw new AppError(
          "REMAKE_EVIDENCE_REQUIRED",
          "A remake cloud mirror requires host-validated evidence",
          409,
        );
      if (data.plan.remake)
        await validateRemakeEvidence(
          service,
          tx,
          c.accountId,
          data.plan,
          data.remakeEvidence,
        );
      if (old?.plan.remake && !data.plan.remake)
        throw new AppError(
          "REMAKE_REQUIREMENTS_REQUIRED",
          "Do not remove a mirrored remake contract",
          409,
        );
    }
    const acknowledgement =
      data.kind === "plan" && data.remakeEvidence
        ? {
            remakeEvidenceHash: fingerprint(data.remakeEvidence),
            evidenceBoundary: "host_verified_snapshot",
          }
        : {};
    const contentHash = fingerprint(content);
    if (
      old &&
      (old.version > data.version ||
        (old.version === data.version && old.contentHash !== contentHash))
    )
      throw new AppError(
        "PRODUCTION_CONTEXT_CONFLICT",
        "Cloud context version is newer or has different content; restore the current host context before continuing",
        409,
      );
    if (data.kind === "plan" && !validateProductionPlan(data.plan).valid)
      throw new AppError(
        "INVALID_PRODUCTION_PLAN",
        "Cloud target plan is discontinuous",
      );
    if (data.kind === "scope") {
      const plan = await tx.get(
        data.scope.planId,
        c.accountId,
        "production-plan",
      );
      if (
        data.scope.version !== data.version ||
        !plan ||
        plan.version !== data.scope.planVersion
      )
        throw new AppError(
          "PLAN_CONFLICT",
          "Synchronize the current plan before the scope",
          409,
        );
      if (old?.productionScope) {
        const previousPlan = await tx.get(
          old.productionScope.planId,
          c.accountId,
          "production-plan",
        );
        if (!previousPlan)
          throw new AppError(
            "PRODUCTION_CONTEXT_CONFLICT",
            "Restore the previously bound cloud plan before changing scope",
            409,
          );
        assertProductionQualityRetained(previousPlan.plan, plan.plan);
      }
    }
    if (old?.version === data.version)
      return { id, version: old.version, contentHash, ...acknowledgement };
    await tx.put({
      id,
      type,
      accountId: c.accountId,
      createdAt: old?.createdAt ?? new Date().toISOString(),
      version: data.version,
      contentHash,
      ...(data.kind === "request"
        ? { hostRequest: data.request }
        : data.kind === "plan"
          ? {
              plan: data.plan,
              planHash: fingerprint(data.plan),
              ...(!old || old.sourceRelationContract === 1
                ? { sourceRelationContract: 1 }
                : {}),
              ...(data.remakeEvidence
                ? { hostRemakeEvidence: data.remakeEvidence }
                : {}),
            }
          : { productionScope: data.scope }),
    });
    return { id, version: data.version, contentHash, ...acknowledgement };
  });
}
