import { validateRemakeEvidence } from "./reference-handoff.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  idSchema,
  type Context,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import { fingerprint, type Service } from "./index.js";
import {
  assertEditingAssets,
  assertProductionQualityRetained,
} from "./production-editing.js";

export const productionRequirementsSchema = z
  .object({
    requiredChecks: z
      .array(z.enum(["actionComplete", "framing", "continuity", "noArtifacts"]))
      .min(1)
      .max(4)
      .default(["actionComplete", "framing", "continuity", "noArtifacts"]),
    allowedAssetUses: z
      .array(z.enum(["prepared_generation", "external"]))
      .min(1)
      .max(2)
      .default(["prepared_generation"]),
  })
  .strict();
export const productionScopeSaveSchema = z
  .object({
    projectId: idSchema,
    planId: idSchema,
    expectedPlanVersion: z.number().int().positive(),
    expectedScopeVersion: z.number().int().nonnegative(),
    requirements: productionRequirementsSchema.default({
      requiredChecks: [
        "actionComplete",
        "framing",
        "continuity",
        "noArtifacts",
      ],
      allowedAssetUses: ["prepared_generation"],
    }),
  })
  .strict();
export const productionAssetAssignSchema = z
  .object({
    projectId: idSchema,
    expectedScopeVersion: z.number().int().positive(),
    shotId: idSchema,
    assetId: idSchema,
    use: z.enum(["prepared_generation", "external"]),
    notes: z.string().trim().min(1).max(2000),
  })
  .strict();
type Sync = (
  tx: Transaction,
  c: Context,
  kind: "plan" | "scope",
  record: Entity,
) => Promise<void>;
const synchronizers = new WeakMap<Service, Sync>();
export function setProductionSynchronizer(service: Service, sync?: Sync) {
  if (sync) synchronizers.set(service, sync);
  else synchronizers.delete(service);
}
export async function syncProductionChange(
  service: Service,
  tx: Transaction,
  c: Context,
  kind: "plan" | "scope",
  record: Entity,
) {
  const links = (await tx.list(c.accountId, "cloud-production-link")).filter(
    (l) => l.localId === record.id && l.kind === kind,
  );
  if (!links.length) return;
  const sync = synchronizers.get(service);
  if (!sync)
    throw new AppError(
      "PRODUCTION_SYNC_REQUIRED",
      "Reconnect the bound cloud gateway before changing a production dependency",
      409,
    );
  await sync(tx, c, kind, record);
}
export async function productionScopeState(
  tx: Transaction,
  accountId: string,
  projectId: string,
) {
  const project = await tx.get(projectId, accountId, "project");
  if (!project) throw new AppError("NOT_FOUND", "Project not found", 404);
  const scope = project.productionScope;
  if (!scope)
    return { project, scope: undefined, plan: undefined, hash: undefined };
  const plan = await tx.get(scope.planId, accountId, "production-plan");
  const hash = fingerprint({
    scope,
    planVersion: plan?.version,
    planHash: plan ? fingerprint(plan.plan) : undefined,
  });
  return { project, scope, plan, hash };
}
export async function validateProductionLink(
  tx: Transaction,
  accountId: string,
  input: Operation,
  requirePrepared = true,
) {
  if (input.kind !== "generate" || !input.production) return undefined;
  const state = await productionScopeState(
    tx,
    accountId,
    input.production.projectId,
  );
  if (
    !state.scope ||
    state.scope.version !== input.production.scopeVersion ||
    !state.plan ||
    state.plan.version !== state.scope.planVersion
  )
    throw new AppError(
      "PRODUCTION_SCOPE_CHANGED",
      "Read the current project scope and rebind the current plan version",
      409,
    );
  if (
    !state.plan.plan.shots.some((s: any) => s.id === input.production!.shotId)
  )
    throw new AppError(
      "INVALID_SHOT",
      "Shot is not in the formal production plan",
    );
  if (requirePrepared && !input.preparedRequestId)
    throw new AppError(
      "PRODUCTION_PREPARATION_REQUIRED",
      "Formal generation requires a prepared request; experiments must be explicitly assigned before formal use",
      409,
    );
  return state;
}
/** Bind a saved plan's default project unless an existing scope was explicitly selected. */
export async function bindPlanProduction(
  tx: Transaction,
  accountId: string,
  input: Extract<Operation, { kind: "generate" }>,
  link?: { planId: string; expectedVersion: number; shotId: string },
) {
  if (!link || input.production) return input;
  const plan = await tx.get(link.planId, accountId, "production-plan");
  if (!plan || plan.version !== link.expectedVersion)
    throw new AppError("PLAN_CONFLICT", "Read the current plan version", 409);
  if (!plan.productionProjectId) return input;
  const state = await productionScopeState(
    tx,
    accountId,
    plan.productionProjectId,
  );
  if (
    !state.scope ||
    state.scope.planId !== plan.id ||
    state.scope.planVersion !== plan.version
  )
    throw new AppError(
      "PRODUCTION_SCOPE_CHANGED",
      "Rebind the plan's production scope",
      409,
    );
  return {
    ...input,
    production: {
      projectId: state.project.id,
      scopeVersion: state.scope.version,
      shotId: link.shotId,
    },
  };
}
export async function saveProductionScope(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = productionScopeSaveSchema.parse(raw);
  return service.scoped(c, "write", async (tx) => {
    const state = await productionScopeState(tx, c.accountId, input.projectId);
    if ((state.scope?.version ?? 0) !== input.expectedScopeVersion)
      throw new AppError(
        "PRODUCTION_SCOPE_CHANGED",
        "Use the current scope version",
        409,
      );
    const plan = await tx.get(input.planId, c.accountId, "production-plan");
    if (!plan || plan.version !== input.expectedPlanVersion)
      throw new AppError(
        "PLAN_CONFLICT",
        "Use the current owned plan version",
        409,
      );
    if (state.plan?.plan.remake && !plan.plan.remake)
      throw new AppError(
        "REMAKE_REQUIREMENTS_REQUIRED",
        "A formal remake project must retain its source-bound contract; revise its requirements with a reason",
        409,
      );
    await validateRemakeEvidence(
      service,
      tx,
      c.accountId,
      plan.plan,
      plan.hostRemakeEvidence,
    );
    assertProductionQualityRetained(state.plan?.plan, plan.plan);
    await assertEditingAssets(tx, c.accountId, plan.plan);
    const scope = {
      version: input.expectedScopeVersion + 1,
      planId: plan.id,
      planVersion: plan.version,
      requirements: input.requirements,
    };
    const project = { ...state.project, productionScope: scope };
    await syncProductionChange(service, tx, c, "scope", project);
    await tx.put(project);
    return { projectId: project.id, productionScope: scope };
  });
}
export async function assignProductionAsset(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = productionAssetAssignSchema.parse(raw);
  return service.scoped(c, "write", async (tx) => {
    const state = await productionScopeState(tx, c.accountId, input.projectId);
    const { scope, plan } = state;
    if (
      !scope ||
      scope.version !== input.expectedScopeVersion ||
      !plan ||
      plan.version !== scope.planVersion
    )
      throw new AppError(
        "PRODUCTION_SCOPE_CHANGED",
        "Use the current production scope and plan",
        409,
      );
    await validateRemakeEvidence(
      service,
      tx,
      c.accountId,
      plan.plan,
      plan.hostRemakeEvidence,
    );
    if (!plan.plan.shots.some((s: any) => s.id === input.shotId))
      throw new AppError("INVALID_SHOT", "Unknown production shot");
    if (!scope.requirements.allowedAssetUses.includes(input.use))
      throw new AppError(
        "PRODUCTION_ASSET_USE_FORBIDDEN",
        "This scope does not allow the requested asset use",
        409,
      );
    const asset = await tx.get(input.assetId, c.accountId, "asset");
    if (!asset || !["image", "video"].includes(asset.kind) || !asset.sha256)
      throw new AppError(
        "INVALID_MEDIA",
        "Use an owned image/video with verified bytes",
      );
    let preparedRequestId: string | undefined;
    if (input.use === "prepared_generation") {
      const job = (await tx.list(c.accountId, "job")).find(
        (j) =>
          j.status === "completed" &&
          j.outputs?.includes(asset.id) &&
          j.input?.production?.projectId === input.projectId &&
          j.input?.production?.shotId === input.shotId &&
          j.input?.production?.scopeVersion === scope.version &&
          j.preparedRequestId,
      );
      const prepared = job
        ? await tx.get(
            job.preparedRequestId,
            c.accountId,
            "generation-preparation",
          )
        : undefined;
      if (!prepared || prepared.scopeHash !== state.hash)
        throw new AppError(
          "PRODUCTION_ORIGIN_REQUIRED",
          "Use a completed generation prepared for this exact project, scope and shot, or explicitly allow external media",
          409,
        );
      preparedRequestId = prepared.id;
    }
    const record = {
      id: randomUUID(),
      type: "production-asset-assignment",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      ...input,
      scopeHash: state.hash,
      sourceSha256: asset.sha256,
      preparedRequestId,
    };
    await tx.put(record);
    return record;
  });
}
export async function inspectProductionScope(
  service: Service,
  tx: Transaction,
  accountId: string,
  revision: Entity,
) {
  const state = await productionScopeState(tx, accountId, revision.projectId);
  const issues: {
    code: string;
    sceneId?: string;
    severity: "error";
    message: string;
  }[] = [];
  if (!state.scope)
    return {
      scopeHash: undefined,
      issues: [],
      remakeRequirements: undefined,
    };
  const { scope, plan } = state;
  const add = (code: string, message: string, sceneId?: string) =>
    issues.push({ code, message, sceneId, severity: "error" });
  if (!plan || plan.version !== scope.planVersion)
    add(
      "PRODUCTION_SCOPE_CHANGED",
      "Rebind the scope to the current plan version",
    );
  if (
    plan &&
    (revision.composition.width !== plan.plan.width ||
      revision.composition.height !== plan.plan.height)
  )
    add(
      "PRODUCTION_TARGET_MISMATCH",
      "Composition dimensions differ from the formal target",
    );
  if (plan) {
    try {
      await validateRemakeEvidence(
        service,
        tx,
        accountId,
        plan.plan,
        plan.hostRemakeEvidence,
      );
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      add(error.code, error.message);
    }
  }
  const assignments = await tx.list(accountId, "production-asset-assignment");
  const seen = new Set<string>();
  for (const scene of revision.composition.scenes) {
    const shotId = scene.productionShotId;
    if (!shotId || !plan?.plan.shots.some((s: any) => s.id === shotId)) {
      add(
        "PRODUCTION_SHOT_UNMAPPED",
        "Map this scene to a target production shot",
        scene.id,
      );
      continue;
    }
    seen.add(shotId);
    if (scene.visualKind === "graphic" && !scene.assetId) {
      if (
        plan!.plan.shots.find((s: any) => s.id === shotId).visualKind !==
        "graphic"
      )
        add(
          "PRODUCTION_VISUAL_KIND_MISMATCH",
          "Only target shots declared graphic may use a generated title/brand card",
          scene.id,
        );
      continue;
    }
    const asset = scene.assetId
      ? await tx.get(scene.assetId, accountId, "asset")
      : undefined;
    const assignment =
      asset &&
      assignments.find(
        (a) =>
          a.projectId === revision.projectId &&
          a.shotId === shotId &&
          a.assetId === asset.id &&
          a.sourceSha256 === asset.sha256 &&
          a.scopeHash === state.hash &&
          scope.requirements.allowedAssetUses.includes(a.use),
      );
    if (!assignment)
      add(
        "PRODUCTION_ASSET_UNASSIGNED",
        "Assign the selected media to this scope and shot; preserve its preparation provenance",
        scene.id,
      );
  }
  for (const shot of plan?.plan.shots ?? [])
    if (!seen.has(shot.id))
      add(
        "PRODUCTION_SHOT_MISSING",
        `Target shot ${shot.id} is absent from the composition`,
      );
  if (plan?.plan.process || plan?.plan.editing) {
    const order = revision.composition.scenes
      .map((s: any) => s.productionShotId)
      .filter(
        (id: string, i: number, ids: string[]) => i === 0 || id !== ids[i - 1],
      );
    if (order.join("|") !== plan.plan.shots.map((s: any) => s.id).join("|"))
      add(
        "PRODUCTION_SHOT_ORDER_MISMATCH",
        "Preserve the declared process/editing order; revise the plan before reordering or repeating target shots",
      );
  }
  return {
    scopeHash: state.hash,
    issues,
    remakeRequirements: plan?.plan.remake?.requirements,
  };
}
