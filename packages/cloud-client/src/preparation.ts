import { tracedPreparation } from "../../core/src/generation-trace.js";
import {
  bindVideoWorkflow,
  videoRequestSnapshot,
} from "../../core/src/video-workflow.js";
import { validateRemakeEvidence } from "../../core/src/reference-handoff.js";
import { remapVideoPolicy } from "../../contracts/src/video-policy.js";
import {
  assertMethodMode,
  assertMethodSource,
} from "../../core/src/production-method.js";
import { randomUUID } from "node:crypto";
import { assertCriticalImageReviews } from "../../core/src/critical-image-review.js";
import { assertPreviousEndAnchor } from "../../core/src/production-continuity.js";
import { assertEditorialSeparation } from "../../core/src/production-plan.js";
import { assertShotReferenceChoice } from "../../core/src/shot-reference-choice.js";
import type { ProductionPlan } from "../../core/src/production-plan.js";
import {
  AppError,
  operationSchema,
  type Context,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import { fingerprint, type Service } from "../../core/src/index.js";
import {
  cloudPreparationProtocol,
  referenceDeclaration,
} from "../../core/src/cloud-preparation.js";
import {
  generationPrepareSchema,
  generationReferenceSnapshots,
  preparationProtocol,
  preparationRecordHash,
  validatePreparedGeneration,
} from "../../core/src/generation-preparation.js";
import {
  validateProductionLink,
  bindPlanProduction,
} from "../../core/src/production-scope.js";
import { validateStoryboardInput } from "../../core/src/storyboard-state.js";

type Request = (path: string, body?: unknown) => Promise<any>;
function invalid(message: string): never {
  throw new AppError("CLOUD_RESPONSE_INVALID", message, 502);
}
function verifyRecord(record: any) {
  if (
    !record ||
    record.protocol !== preparationProtocol ||
    record.id !== record.input?.preparedRequestId ||
    record.inputHash !== fingerprint(record.input) ||
    record.requestHash !== preparationRecordHash(record) ||
    record.prompt?.text !== record.input.prompt ||
    record.providerRequest?.prompt !== record.input.prompt
  )
    invalid("Cloud preparation does not satisfy the frozen request contract");
  operationSchema.parse(record.input);
}
export class PreparationClient {
  private connection: string;
  constructor(
    private service: Service,
    private origin: string,
    key: string,
    private request: Request,
  ) {
    this.connection = fingerprint([origin, key]);
  }
  async supported(c: Context) {
    await this.service.scoped(c, "read", async () => {});
    try {
      return (
        (await this.request("/v1/generation-protocol")).protocol ===
        cloudPreparationProtocol
      );
    } catch {
      return false;
    }
  }
  async require(c: Context) {
    if (!(await this.supported(c)))
      throw new AppError(
        "PREPARATION_PROTOCOL_UNSUPPORTED",
        "Reconnect a cloud runtime supporting rikoko-cloud-preparation-v2. Keep preparedRequestId; do not bypass preparation.",
        409,
      );
  }
  async sync(
    tx: Transaction,
    c: Context,
    kind: "plan" | "scope" | "request",
    record: Entity,
  ): Promise<string> {
    const links = (await tx.list(c.accountId, "cloud-production-link")).filter(
      (l) => l.localId === record.id && l.kind === kind,
    );
    if (links.some((l) => l.connection !== this.connection))
      throw new AppError(
        "PRODUCTION_SYNC_REQUIRED",
        "Reconnect the original cloud account before changing its bound dependencies",
        409,
      );
    const clientId = fingerprint([c.accountId, this.connection]);
    let scope;
    if (kind === "scope") {
      const plan = await tx.get(
        record.productionScope.planId,
        c.accountId,
        "production-plan",
      );
      if (!plan)
        throw new AppError("PLAN_CONFLICT", "Formal plan is unavailable", 409);
      const planId = await this.sync(tx, c, "plan", plan);
      scope = { ...record.productionScope, planId };
    }
    const version =
      kind !== "scope" ? record.version : record.productionScope.version;
    const remakeEvidence =
      kind === "plan"
        ? await validateRemakeEvidence(
            this.service,
            tx,
            c.accountId,
            record.plan,
          )
        : undefined;
    // Conversation-facing rationale stays on the host. Execution constraints,
    // references, method and shots remain intact in the cloud contract.
    const executionPlan = record.plan ?? {};
    const requestSnapshot =
      kind === "request"
        ? await videoRequestSnapshot(tx, c.accountId, {
            requestId: record.id,
            expectedVersion: record.version,
          })
        : undefined;
    const content =
      kind === "request"
        ? requestSnapshot
        : kind === "plan"
          ? remakeEvidence
            ? { plan: executionPlan, remakeEvidence }
            : executionPlan
          : scope;
    const result = await this.request("/v1/production-context", {
      protocol: cloudPreparationProtocol,
      clientId,
      localId: record.id,
      kind,
      version,
      ...(kind === "request"
        ? { request: requestSnapshot }
        : kind === "plan"
          ? {
              plan: executionPlan,
              ...(remakeEvidence ? { remakeEvidence } : {}),
            }
          : { scope: content }),
    });
    const id = `context-${fingerprint(["link", c.accountId, clientId, kind, record.id])}`;
    if (
      typeof result.id !== "string" ||
      result.version !== version ||
      result.contentHash !== fingerprint(content) ||
      (remakeEvidence &&
        result.remakeEvidenceHash !== fingerprint(remakeEvidence))
    )
      invalid("Cloud context acknowledgement differs from the host version");
    await tx.put({
      id,
      type: "cloud-production-link",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      kind,
      localId: record.id,
      remoteId: result.id,
      connection: this.connection,
      version,
    });
    return result.id;
  }
  async prepare(c: Context, raw: unknown) {
    return tracedPreparation(this.service, c, raw, () =>
      this.prepareImpl(c, raw),
    );
  }
  private async prepareImpl(c: Context, raw: unknown) {
    const data = generationPrepareSchema.parse(raw);
    if (data.input.kind !== "generate" || data.input.preparedRequestId)
      throw new AppError("INVALID_INPUT", "Prepare a fresh generation request");
    if (data.input.storyboard && !data.plan)
      throw new AppError(
        "PRODUCTION_PLAN_REQUIRED",
        "Prepare storyboard generation against a saved target plan",
        409,
      );
    await this.require(c);
    return this.service.scoped(c, "write", async (tx) => {
      const input = await bindPlanProduction(
        tx,
        c.accountId,
        data.input as Extract<Operation, { kind: "generate" }>,
        data.plan,
      );
      const scope = await validateProductionLink(tx, c.accountId, input, false);
      await validateStoryboardInput(tx, c.accountId, input);
      const snapshots = await generationReferenceSnapshots(
        tx,
        c.accountId,
        input,
      );
      await assertCriticalImageReviews(tx, c.accountId, input);

      let localPlan: Entity | null | undefined, remotePlan, remakeEvidence;
      if (data.plan) {
        localPlan = await tx.get(
          data.plan.planId,
          c.accountId,
          "production-plan",
        );
        if (!localPlan || localPlan.version !== data.plan.expectedVersion)
          throw new AppError(
            "PLAN_CONFLICT",
            "Read the current plan version",
            409,
          );
        assertMethodMode(
          localPlan.plan,
          data.direction?.mode ?? input.mode,
          data.plan.stage ?? "video",
        );
        if (localPlan.plan.method?.source)
          assertMethodSource(
            localPlan.plan,
            await tx.get(
              localPlan.plan.method.source.assetId,
              c.accountId,
              "asset",
            ),
          );
        if ((data.plan.stage ?? "video") === "video") {
          const shot = (localPlan.plan as ProductionPlan).shots.find(
            (s) => s.id === data.plan!.shotId,
          );
          if (!shot)
            throw new AppError("INVALID_SHOT", "Choose a shot from this plan");
          assertShotReferenceChoice(shot, input.mode ?? data.direction?.mode);
          assertEditorialSeparation(
            localPlan.plan,
            data.plan.shotId,
            input.prompt,
          );
          await assertPreviousEndAnchor(
            tx,
            c.accountId,
            localPlan.plan,
            data.plan.shotId,
            input.production?.projectId,
          );
        }
        remakeEvidence = await validateRemakeEvidence(
          this.service,
          tx,
          c.accountId,
          localPlan.plan,
        );
      }
      const models = await this.request("/v1/generation-models");
      const model = Array.isArray(models)
        ? models.find((m: any) => m.id === input.model)
        : undefined;
      if (!model || !["image", "video", "audio"].includes(model.kind))
        throw new AppError(
          "CAPABILITY_UNAVAILABLE",
          "Unknown generation model",
        );
      const workflow = await bindVideoWorkflow(
        this.service,
        tx,
        c,
        data,
        model.kind,
      );
      if (localPlan)
        remotePlan = {
          ...data.plan,
          planId: await this.sync(tx, c, "plan", localPlan),
        };
      const remoteInput = { ...input };
      delete remoteInput.storyboard;
      if (scope)
        remoteInput.production = {
          ...input.production!,
          projectId: await this.sync(tx, c, "scope", scope.project),
        };
      const remoteRequest = workflow
        ? {
            requestId: await this.sync(
              tx,
              c,
              "request",
              (await tx.get(
                workflow.requestLink.requestId,
                c.accountId,
                "workspace-request",
              ))!,
            ),
            expectedVersion: workflow.requestLink.expectedVersion,
          }
        : undefined;
      const remote = await this.request("/v1/generation-preparations", {
        protocol: cloudPreparationProtocol,
        request: {
          ...data,
          input: remoteInput,
          ...(remoteRequest ? { request: remoteRequest } : {}),
          ...(remotePlan ? { plan: remotePlan } : {}),
        },
        references: snapshots.assets.map(referenceDeclaration),
      });
      verifyRecord(remote);
      if (
        fingerprint(remote.workflow?.request ?? null) !==
        fingerprint(workflow?.request ?? null)
      )
        invalid("Cloud changed or removed the original request snapshot");
      if (
        fingerprint(remote.remakeEvidence ?? null) !==
        fingerprint(remakeEvidence ?? null)
      )
        invalid("Cloud preparation lost the host-validated remake evidence");
      if (
        remote.referenceState !== "declared" ||
        remote.input.model !== input.model ||
        remote.input.prompt !== input.prompt ||
        remote.input.mode !== input.mode ||
        fingerprint(remote.input.videoPolicy ?? null) !==
          fingerprint(input.videoPolicy ?? null) ||
        fingerprint(remote.input.references ?? []) !==
          fingerprint(input.references ?? []) ||
        fingerprint(remote.input.production ?? null) !==
          fingerprint(remoteInput.production ?? null) ||
        Object.entries(input.parameters ?? {}).some(
          ([k, v]) =>
            fingerprint(remote.input.parameters?.[k] ?? null) !==
            fingerprint(v),
        )
      )
        invalid(
          "Cloud preparation changed the requested model, wording, references or controls",
        );
      const id = randomUUID();
      const localInput = operationSchema.parse({
        ...remote.input,
        preparedRequestId: id,
        ...(input.production ? { production: input.production } : {}),
        ...(input.storyboard ? { storyboard: input.storyboard } : {}),
      });
      const record = {
        ...remote,
        id,
        type: "generation-preparation",
        accountId: c.accountId,
        createdAt: new Date().toISOString(),
        input: localInput,
        workflow,
        inputHash: fingerprint(localInput),
        plan: localPlan
          ? { ...data.plan, planHash: fingerprint(localPlan.plan) }
          : undefined,
        scopeHash: scope?.hash,
        referenceState: "bound",
        references: snapshots.references,
        cloud: {
          origin: this.origin,
          connection: this.connection,
          draft: remote,
        },
      };
      // Transport-only reply fields must not become persisted state.
      delete record.preparedRequestId;
      delete record.readyForSubmission;
      delete record.generated;
      record.requestHash = preparationRecordHash(record);
      await tx.put(record);
      return {
        ...record,
        preparedRequestId: id,
        generated: false,
        readyForSubmission: true,
        submissionRequiresQuote: true,
      };
    });
  }
  async validate(c: Context, input: Operation) {
    return this.service.scoped(c, "write", async (tx) => {
      const record = await validatePreparedGeneration(
        this.service,
        tx,
        c.accountId,
        input,
        { cloudClient: true },
      );
      if (
        record &&
        (!record.cloud || record.cloud.connection !== this.connection)
      )
        throw new AppError(
          "PREPARATION_ROUTE_MISMATCH",
          "Use the original cloud connection or prepare again",
          409,
        );
      return record;
    });
  }
  async bind(
    c: Context,
    input: Operation,
    upload: (asset: Entity) => Promise<string>,
  ) {
    await this.require(c);
    const record = await this.validate(c, input);
    if (!record) return undefined;
    const draft = record.cloud.draft;
    const mappings: { sourceAssetId: string; assetId: string }[] = [];
    for (const ref of record.references)
      mappings.push({
        sourceAssetId: ref.assetId,
        assetId: await upload(await this.service.get(c, "asset", ref.assetId)),
      });
    await this.validate(c, input);
    const bound = await this.request(
      `/v1/generation-preparations/${encodeURIComponent(draft.id)}/bind`,
      { requestHash: draft.requestHash, references: mappings },
    );
    verifyRecord(bound);
    const expected = {
      ...draft.input,
      ...(draft.input.videoPolicy
        ? { videoPolicy: remapVideoPolicy(draft.input.videoPolicy, mappings) }
        : {}),
      preparedRequestId: bound.id,
      ...(draft.input.references
        ? {
            references: draft.input.references.map((r: any, i: number) => ({
              ...r,
              assetId: mappings[i].assetId,
            })),
          }
        : {}),
    };
    if (
      bound.referenceState !== "bound" ||
      bound.parentPreparation?.requestHash !== draft.requestHash ||
      bound.parentPreparation?.id !== draft.id ||
      fingerprint(bound.input) !== fingerprint(expected) ||
      fingerprint(bound.prompt) !== fingerprint(draft.prompt) ||
      bound.modelProfileVersion !== draft.modelProfileVersion ||
      bound.scopeHash !== draft.scopeHash ||
      fingerprint(bound.remakeEvidence ?? null) !==
        fingerprint(draft.remakeEvidence ?? null)
    )
      invalid("Cloud binding changed the prepared request");
    return { record, bound };
  }
  verifyQuote(remote: any, prepared: Entity) {
    if (
      remote.preparedRequestId !== prepared.id ||
      remote.preparedRequestHash !== prepared.requestHash ||
      remote.templateVersion !== prepared.prompt.templateVersion ||
      remote.inputHash !== prepared.inputHash
    )
      invalid("Cloud quote is not bound to the prepared request");
  }
}
