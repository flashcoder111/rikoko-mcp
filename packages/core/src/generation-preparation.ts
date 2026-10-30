import { tracedPreparation } from "./generation-trace.js";
import { guideCapabilities } from "../../guidance/src/reader.js";
import {
  bindVideoWorkflow,
  validateVideoWorkflow,
  videoRequestLinkSchema,
} from "./video-workflow.js";
import { validateRemakeEvidence } from "./reference-handoff.js";
import { assertVideoPolicy } from "../../providers/src/video-policy.js";
import {
  assertMethodMode,
  assertMethodSource,
  assertMethodSegment,
} from "./production-method.js";
import { assertDirectorAudio } from "./director-kits.js";
import {
  promptReferenceSyntax,
  referenceToken,
} from "../../providers/src/prompt-reference.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  idSchema,
  operationSchema,
  type Context,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import { fixedGenerationParameters } from "../../providers/src/index.js";
import { validateGenerationAssets } from "../../providers/src/generation-input.js";
import { checkGenerationTarget } from "../../providers/src/generation-target.js";
import { compilePrompt, promptInputSchema } from "./production-prompts.js";
import {
  productionPlanSchema,
  productionShotDirection,
  validateProductionPlan,
} from "./production-plan.js";
import { validateStoryboardInput } from "./storyboard-state.js";
import { assertShotReferenceChoice } from "./shot-reference-choice.js";
import { assertPreviousEndAnchor } from "./production-continuity.js";
import {
  validateProductionLink,
  bindPlanProduction,
} from "./production-scope.js";
import { fingerprint, type Service } from "./index.js";

export const preparationProtocol = "rikoko-prepared-generation-v1";
// Bump when the provider request construction/binding contract changes.
const adapterContractVersion = "generation-payload-v3-face-policy";
export const generationPrepareSchema = z
  .object({
    input: operationSchema,
    request: videoRequestLinkSchema.optional(),
    direction: promptInputSchema.optional(),
    plan: z
      .object({
        planId: idSchema,
        expectedVersion: z.number().int().positive(),
        shotId: idSchema,
        stage: z.enum(["video", "first_frame", "last_frame"]).optional(),
      })
      .strict()
      .optional(),
    promptOverride: z
      .object({ reason: z.string().trim().min(1).max(1500) })
      .strict()
      .optional(),
  })
  .strict();
type Generate = Extract<Operation, { kind: "generate" }>;
function fail(code: string, message: string): never {
  throw new AppError(code, message, 409);
}
function modelVersion(service: Service, input: Generate) {
  // Includes the effective profile and registry connection version, but no credentials or URLs are returned.
  return fingerprint({
    profile: service.provider.validate(input),
    routing: service.provider.estimate(input).priceVersion,
    adapterContractVersion,
  });
}
export async function generationReferenceSnapshots(
  tx: Transaction,
  accountId: string,
  input: Generate,
) {
  const assets: Entity[] = [];
  for (const ref of input.references ?? []) {
    const asset = await tx.get(ref.assetId, accountId, "asset");
    if (!asset)
      fail("NOT_FOUND", "Reference asset is unavailable in this account");
    if (!asset.storageKey || !asset.sha256)
      fail(
        "INVALID_MEDIA",
        "Prepare references from uploaded assets with verified storage and content hashes",
      );
    assets.push(asset);
  }
  return {
    assets,
    references: assets.map((a, i) => ({
      ...input.references![i],
      sha256: a.sha256,
      bytes: a.bytes,
      kind: a.kind,
      mime: a.mime,
      metadata: a.metadata,
      storageIdentityHash: fingerprint(a.storageKey),
    })),
  };
}
export function preparationRecordHash(
  record: Entity | Record<string, unknown>,
) {
  const {
    protocol,
    input,
    prompt,
    plan,
    references,
    modelProfileVersion,
    providerRequest,
    expectedOutput,
    scopeHash,
    referenceState,
    parentPreparation,
    cloud,
    remakeEvidence,
    workflow,
    guideVersion,
  } = record;
  return fingerprint({
    protocol,
    input,
    prompt,
    plan,
    references,
    modelProfileVersion,
    providerRequest,
    expectedOutput,
    scopeHash,
    referenceState,
    parentPreparation,
    cloud,
    remakeEvidence,
    workflow,
    ...(guideVersion !== undefined ? { guideVersion } : {}),
  });
}

/** Persist the exact logical operation. Does not upload, quote, reserve or call a model. */
async function prepareGenerationImpl(
  service: Service,
  c: Context,
  raw: unknown,
  declaredAssets?: Entity[],
) {
  const data = generationPrepareSchema.parse(raw);
  if (data.input.kind !== "generate")
    fail("INVALID_INPUT", "Prepare accepts generate operations only");
  if (data.input.storyboard && !data.plan)
    fail(
      "PRODUCTION_PLAN_REQUIRED",
      "Storyboard observations require a saved target plan before generation",
    );
  if (data.input.preparedRequestId)
    fail(
      "PREPARED_REQUEST_IMMUTABLE",
      "Prepare a fresh operation without an existing preparedRequestId",
    );
  return service.scoped(c, "write", async (tx) => {
    let input = await bindPlanProduction(
      tx,
      c.accountId,
      data.input as Generate,
      data.plan,
    );
    const scope = await validateProductionLink(tx, c.accountId, input, false);
    if (
      scope &&
      (!data.plan ||
        data.plan.planId !== scope.scope.planId ||
        data.plan.expectedVersion !== scope.scope.planVersion ||
        data.plan.shotId !== input.production!.shotId)
    )
      fail(
        "PRODUCTION_PLAN_REQUIRED",
        "Bind this generation to the scope's exact plan version and shot",
      );
    let plan: Record<string, unknown> | undefined;
    let sourceEdit = false;
    let remakeEvidence;
    if (data.plan) {
      const saved = await tx.get(
        data.plan.planId,
        c.accountId,
        "production-plan",
      );
      if (!saved || saved.version !== data.plan.expectedVersion)
        fail("PLAN_CONFLICT", "Read the current plan and use its version");
      const parsed = productionPlanSchema.parse(saved.plan);
      sourceEdit = parsed.method?.kind === "source_edit";
      if (parsed.method?.source && !declaredAssets) {
        const source = await tx.get(
          parsed.method.source.assetId,
          c.accountId,
          "asset",
        );
        assertMethodSource(parsed, source);
      }
      assertMethodMode(
        parsed,
        data.direction?.mode ?? input.mode,
        data.plan.stage ?? "video",
      );
      if (!validateProductionPlan(parsed).valid)
        fail(
          "INVALID_PRODUCTION_PLAN",
          "Correct the current target plan before generation",
        );
      remakeEvidence = await validateRemakeEvidence(
        service,
        tx,
        c.accountId,
        parsed,
        saved.hostRemakeEvidence,
      );
      const shot = parsed.shots.find((s) => s.id === data.plan!.shotId);
      if (!shot) fail("INVALID_SHOT", "Choose a shot from this plan");
      if ((data.plan.stage ?? "video") === "video") {
        const assets =
          declaredAssets ??
          (await Promise.all(
            (input.references ?? []).map((r) =>
              tx.get(r.assetId, c.accountId, "asset"),
            ),
          ));
        assertMethodSegment(
          parsed,
          shot.id,
          assets.filter((a): a is Entity => !!a),
        );
      }
      if ((data.plan.stage ?? "video") === "video")
        assertShotReferenceChoice(shot, input.mode ?? data.direction?.mode);
      if (!declaredAssets && (data.plan.stage ?? "video") === "video")
        await assertPreviousEndAnchor(
          tx,
          c.accountId,
          parsed,
          shot.id,
          input.production?.projectId,
        );
      const expectedDirection = productionShotDirection(
        parsed,
        shot,
        data.plan.stage,
        remakeEvidence?.report,
      );
      if (
        !data.direction ||
        fingerprint(
          Object.fromEntries(
            Object.keys(expectedDirection).map((key) => [
              key,
              (data.direction as any)[key],
            ]),
          ),
        ) !== fingerprint(expectedDirection)
      )
        fail(
          "PLAN_DIRECTION_MISMATCH",
          "Use production_shot_prompts.video.direction for this plan version; revise the plan to change target states or references",
        );
      if (
        input.target &&
        (input.target.width !== parsed.width ||
          input.target.height !== parsed.height)
      )
        fail(
          "PLAN_TARGET_MISMATCH",
          "Generation target must use the saved plan dimensions",
        );
      input = operationSchema.parse({
        ...input,
        target: {
          width: parsed.width,
          height: parsed.height,
          ...input.target,
          ...(shot.durationMs &&
          service.provider.validate(input).kind === "video"
            ? {
                minDurationMs: Math.max(
                  shot.durationMs,
                  input.target?.minDurationMs ?? 0,
                ),
              }
            : {}),
        },
      }) as Generate;
      plan = {
        ...data.plan,
        planHash: fingerprint(saved.plan),
        guideVersion: saved.guideVersion ?? null,
        directorIntent: {
          title: parsed.title,
          width: parsed.width,
          height: parsed.height,
          treatment: parsed.treatment,
          ...(parsed.knowledge ? { knowledge: parsed.knowledge } : {}),
          creativeChoices: parsed.creativeChoices,
          shots: [shot],
        },
      };
    }
    const model = service.provider.validate(input);
    assertDirectorAudio(data.direction?.directorKit, {
      ...model.parameters,
      ...input.parameters,
    });
    const syntax = promptReferenceSyntax(model);
    const compiled = data.direction
      ? compilePrompt(data.direction, syntax)
      : undefined;
    if (
      (remakeEvidence || sourceEdit) &&
      (!compiled || compiled.prompt !== input.prompt)
    )
      fail(
        "REMAKE_PROMPT_OVERRIDE",
        "Revise the target plan and compile again; a remake prompt must preserve the compiled direction",
      );
    if (
      data.plan?.stage &&
      model.kind !== (data.plan.stage === "video" ? "video" : "image")
    )
      fail(
        "PLAN_STAGE_MISMATCH",
        "First/last frame preparation needs an image model; video preparation needs a video model",
      );
    if (compiled && data.direction) {
      const actualMode =
        input.mode ??
        (model.kind === "image"
          ? "text_to_image"
          : model.kind === "video"
            ? "text_to_video"
            : "unsupported");
      const requestedMode = ["motion_transfer", "camera_transfer"].includes(
        data.direction.mode,
      )
        ? "reference_to_video"
        : data.direction.mode;
      if (actualMode !== requestedMode)
        fail(
          "PROMPT_MODE_MISMATCH",
          "Prompt mode must match the actual model interface",
        );
      if (
        fingerprint(
          compiled.bindings.map(({ assetId, role }) => ({ assetId, role })),
        ) !== fingerprint(input.references ?? [])
      )
        fail(
          "PROMPT_REFERENCE_MISMATCH",
          "Use the preview's exact reference roles and order",
        );
      if (compiled.warnings.length)
        fail(
          "ACTION_REFERENCE_MISMATCH",
          "The declared action reference conflicts with the target action; update the plan/reference responsibility",
        );
    }
    const defaults: Record<string, unknown> = {};
    for (const key of Object.keys(model.allowedParameters ?? {}))
      if (Object.hasOwn(model.parameters, key))
        defaults[key] = model.parameters[key];
    const preparedRequestId = randomUUID();
    input = operationSchema.parse({
      ...input,
      parameters: { ...defaults, ...input.parameters },
      preparedRequestId,
    }) as Generate;
    const { assets, references } = declaredAssets
      ? {
          assets: declaredAssets,
          references: declaredAssets.map((a, i) => ({
            ...input.references![i],
            sha256: a.sha256,
            bytes: a.bytes,
            kind: a.kind,
            mime: a.mime,
            metadata: a.metadata,
          })),
        }
      : await generationReferenceSnapshots(tx, c.accountId, input);
    validateGenerationAssets(model, input, assets);
    assertVideoPolicy(model, input, assets);
    const expectedOutput = checkGenerationTarget(model, input, assets);
    await validateStoryboardInput(tx, c.accountId, input, expectedOutput);
    const providerBindings = (input.references ?? []).map((ref, inputIndex) => {
      const binding = model.generationInput!.bindings.find((b) =>
        b.roles.includes(ref.role),
      )!;
      return {
        ...ref,
        inputIndex,
        field: binding.field,
        array: binding.array,
        index: binding.array
          ? input
              .references!.slice(0, inputIndex)
              .filter((r) => binding.roles.includes(r.role)).length
          : null,
        token: compiled?.bindings[inputIndex]?.token,
      };
    });
    // Reference labels follow the selected model's field/array order and syntax.
    if (compiled) {
      for (const kind of ["image", "video"] as const) {
        const actualOrder = (model.generationInput?.bindings ?? [])
          .filter((b) => b.kind === kind)
          .flatMap((b) => providerBindings.filter((r) => r.field === b.field));
        if (
          actualOrder.some(
            (r, i) => r.token !== referenceToken(syntax, r.role, i + 1),
          )
        )
          fail(
            "PROMPT_BINDING_MISMATCH",
            "Reorder direction.references and input.references to match the model's field/array order before previewing again",
          );
      }
    }
    const prompt = {
      templateVersion: compiled?.templateVersion ?? "manual-v1",
      compilerVersion: compiled?.compilerVersion ?? "manual-v1",
      baseText: compiled?.prompt ?? null,
      direction: data.direction ?? null,
      text: input.prompt,
      overridden: !compiled || compiled.prompt !== input.prompt,
      overrideReason: data.promptOverride?.reason ?? null,
    };
    const workflow = await bindVideoWorkflow(
      service,
      tx,
      c,
      { ...data, input },
      model.kind,
      declaredAssets,
    );
    const record = {
      id: preparedRequestId,
      type: "generation-preparation",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      protocol: preparationProtocol,
      guideVersion: (await guideCapabilities()).version,
      workflow,
      referenceState: declaredAssets ? "declared" : "bound",
      scopeHash: scope?.hash,
      remakeEvidence,
      input,
      inputHash: fingerprint(input),
      prompt,
      plan,
      references,
      modelProfileVersion: modelVersion(service, input),
      expectedOutput,
      providerRequest: {
        model: model.id,
        kind: model.kind,
        mode: input.mode ?? null,
        promptField: model.promptField ?? "prompt",
        prompt: input.prompt,
        parameters: {
          ...fixedGenerationParameters(model),
          ...input.parameters,
        },
        // Private provider settings are bound by digest; never expose arbitrary configuration values.
        privateParametersHash: fingerprint(model.parameters),
        referenceBindings: providerBindings,
        adapterContractVersion,
        transportValues: "resolved_at_execution",
        parameterVisibility: "public_output_controls",
      },
    };
    const requestHash = preparationRecordHash(record);
    await tx.put({ ...record, requestHash });
    return {
      ...record,
      preparedRequestId,
      requestHash,
      generated: false,
      readyForSubmission: !declaredAssets,
    };
  });
}

/** Recheck without recompiling: saved wording stays frozen across template updates. */
export async function validatePreparedGeneration(
  service: Service,
  tx: Transaction,
  accountId: string,
  operation: Operation,
  options: { cloudClient?: boolean; allowDeclared?: boolean } = {},
) {
  const scope = await validateProductionLink(tx, accountId, operation);
  if (
    operation.kind === "generate" &&
    operation.storyboard &&
    !operation.preparedRequestId
  )
    fail(
      "PRODUCTION_PLAN_REQUIRED",
      "Prepare storyboard generation against a saved target plan",
    );
  if (operation.kind !== "generate" || !operation.preparedRequestId)
    return undefined;
  const record = await tx.get(
    operation.preparedRequestId,
    accountId,
    "generation-preparation",
  );
  if (!record)
    fail(
      "PREPARED_REQUEST_NOT_FOUND",
      "Prepare this request in the current account",
    );
  if (
    record.protocol !== preparationProtocol ||
    record.requestHash !== preparationRecordHash(record)
  )
    fail(
      "PREPARED_REQUEST_INVALID",
      "Preparation record is invalid or incompatible; prepare again",
    );
  if (
    record.inputHash !== fingerprint(operation) ||
    record.inputHash !== fingerprint(record.input)
  )
    fail(
      "PREPARED_REQUEST_MISMATCH",
      "Use the exact saved input; changed prompt, parameters or references require a fresh preparation and quote",
    );
  if (operation.storyboard && !record.plan)
    fail(
      "PRODUCTION_PLAN_REQUIRED",
      "Reprepare storyboard generation against a saved target plan",
    );
  if (record.scopeHash !== scope?.hash)
    fail(
      "PRODUCTION_SCOPE_CHANGED",
      "Formal scope changed; prepare its current version",
    );
  if (record.cloud && !options.cloudClient)
    fail(
      "PREPARATION_ROUTE_MISMATCH",
      "This preparation must execute through its original cloud connection",
    );
  if (record.referenceState === "declared" && !options.allowDeclared)
    fail(
      "PREPARATION_REFERENCES_UNBOUND",
      "Bind verified uploaded references before quoting this cloud preparation",
    );
  if (record.plan) {
    const plan = await tx.get(record.plan.planId, accountId, "production-plan");
    if (
      !plan ||
      plan.version !== record.plan.expectedVersion ||
      fingerprint(plan.plan) !== record.plan.planHash
    )
      fail(
        "PREPARED_PLAN_CHANGED",
        "Target plan changed; preview and prepare its current version",
      );
    const evidence = await validateRemakeEvidence(
      service,
      tx,
      accountId,
      productionPlanSchema.parse(plan.plan),
      plan.hostRemakeEvidence,
    );
    if ((record.plan.stage ?? "video") === "video")
    if (
      !record.parentPreparation &&
      record.referenceState !== "declared" &&
      (record.plan.stage ?? "video") === "video"
    )
      await assertPreviousEndAnchor(
        tx,
        accountId,
        plan.plan,
        record.plan.shotId,
        operation.production?.projectId,
      );
    // New unrelated excerpts must not invalidate an already frozen shot.
    // Previously bound excerpts must still exist with exactly the same lineage.
    const comparableEvidence = evidence
      ? {
          ...evidence,
          sourceExcerpts: record.remakeEvidence?.sourceExcerpts?.filter(
            (saved: any) =>
              (evidence.sourceExcerpts ?? []).some(
                (current) => fingerprint(current) === fingerprint(saved),
              ),
          ),
        }
      : evidence;
    if (
      fingerprint(comparableEvidence ?? null) !==
      fingerprint(record.remakeEvidence ?? null)
    )
      fail(
        "REMAKE_SOURCE_CHANGED",
        "Analysis evidence changed; review and prepare the target plan again",
      );
  }
  if (
    !record.cloud &&
    record.modelProfileVersion !== modelVersion(service, operation)
  )
    fail(
      "PREPARED_MODEL_CHANGED",
      "Effective model configuration changed; prepare and quote again",
    );
  if (record.referenceState === "declared" && options.allowDeclared) {
    await validateVideoWorkflow(service, tx, accountId, record);
    return record;
  }
  const current = await generationReferenceSnapshots(tx, accountId, operation);
  if (fingerprint(current.references) !== fingerprint(record.references))
    fail(
      "PREPARED_REFERENCE_CHANGED",
      "Reference bytes or metadata changed; inspect and prepare again",
    );
  if (!record.cloud)
    assertVideoPolicy(
      service.provider.validate(operation),
      operation,
      current.assets,
    );
  if (!record.cloud)
    validateGenerationAssets(
      service.provider.validate(operation),
      operation,
      current.assets,
    );
  await validateVideoWorkflow(service, tx, accountId, record);
  await validateStoryboardInput(
    tx,
    accountId,
    operation,
    record.expectedOutput ?? {},
  );
  return record;
}

export async function prepareGeneration(
  service: Service,
  c: Context,
  raw: unknown,
  declaredAssets?: Entity[],
) {
  return tracedPreparation(service, c, raw, () =>
    prepareGenerationImpl(service, c, raw, declaredAssets),
  );
}
