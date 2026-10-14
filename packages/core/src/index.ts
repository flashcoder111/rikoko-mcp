import { randomUUID, randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { Database, Transaction } from "../../db/src/index.js";
import {
  AppError,
  compositionSchema,
  operationSchema,
  isPaidOperation,
  revisionPatchSchema,
  eventBindingsSchema,
  type Composition,
  type Context,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";
import { FalProvider, type MediaProvider } from "../../providers/src/index.js";
import { sha256, type Storage } from "../../storage/src/index.js";
import { validateGenerationAssets } from "../../providers/src/generation-input.js";
import { validateStoryboardInput } from "./storyboard-state.js";
export const fingerprint = (v: unknown): string =>
  createHash("sha256").update(canonical(v)).digest("hex");
function canonical(v: any): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .filter((k) => v[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
const id = () => randomUUID();
const now = () => new Date().toISOString();
const entity = (
  accountId: string,
  type: string,
  data: Record<string, unknown>,
): Entity => ({ id: id(), accountId, type, createdAt: now(), ...data });
const ensure = (ok: unknown, code: string, message: string, status = 400) => {
  if (!ok) throw new AppError(code, message, status);
};
export class Service {
  constructor(
    public db: Database,
    public storage: Storage,
    public provider: MediaProvider = new FalProvider(),
    public billingSource: "credits" | "external" = "credits",
  ) {}
  /** All workspace and session operations recheck revocation inside their transaction. */
  async scoped<T>(
    c: Context,
    scope: "read" | "write",
    fn: (tx: Transaction) => Promise<T>,
  ) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c, scope);
      return fn(tx);
    });
  }
  async browserSession(c: Context) {
    const token = randomBytes(32).toString("base64url");
    await this.scoped(c, "read", (tx) =>
      tx.put({
        id: sha256(token),
        accountId: c.accountId,
        type: "browser-session",
        createdAt: now(),
        keyId: c.keyId,
        expiresAt: Date.now() + 86_400_000,
      }),
    );
    return token;
  }
  async sessionPrincipal(token: string): Promise<Context> {
    return this.db.transaction(async (tx) => {
      const session = await tx.get(sha256(token), undefined, "browser-session");
      ensure(
        session && session.expiresAt > Date.now(),
        "UNAUTHORIZED",
        "连接已过期，请重新连接。",
        401,
      );
      const c = {
        accountId: session!.accountId,
        keyId: session!.keyId,
        scopes: [],
        budgetCents: 0,
      };
      const key = await this.authorize(tx, c, "read");
      return {
        ...c,
        scopes: key.scopes,
        budgetCents: Number(key.budget_cents),
      };
    });
  }
  async revokeSession(token: string) {
    await this.db.transaction((tx) =>
      tx.query("DELETE FROM entities WHERE id=$1 AND type='browser-session'", [
        sha256(token),
      ]),
    );
  }
  private async authorize(tx: Transaction, c: Context, scope = "write") {
    const rows = (
      await tx.query(
        "SELECT * FROM api_keys WHERE id=$1 AND account_id=$2 AND revoked=false",
        [c.keyId, c.accountId],
      )
    ).rows;
    const k = rows[0];
    ensure(k, "UNAUTHORIZED", "Key is invalid or revoked", 401);
    ensure(
      k.scopes.includes(scope) || k.scopes.includes("admin"),
      "FORBIDDEN",
      `Required scope: ${scope}`,
      403,
    );
    return k;
  }
  async authenticate(key: string): Promise<Context> {
    ensure(
      key && key.length < 200,
      "UNAUTHORIZED",
      "Bearer API key required",
      401,
    );
    return this.db.transaction(async (tx) => {
      const k = (
        await tx.query(
          "SELECT * FROM api_keys WHERE digest=$1 AND revoked=false",
          [sha256(key)],
        )
      ).rows[0];
      ensure(k, "UNAUTHORIZED", "Key is invalid or revoked", 401);
      return {
        accountId: k.account_id,
        keyId: k.id,
        scopes: k.scopes,
        budgetCents: Number(k.budget_cents),
      };
    });
  }
  async createAccount(name: string, balanceCents: number) {
    ensure(
      Number.isSafeInteger(balanceCents) && balanceCents >= 0,
      "INVALID_AMOUNT",
      "Balance must be integer cents",
    );
    return this.db.transaction(async (tx) => {
      const accountId = id();
      await tx.query(
        "INSERT INTO accounts(id,name,balance_cents) VALUES($1,$2,$3)",
        [accountId, name, balanceCents],
      );
      const key = await this.newKey(
        tx,
        accountId,
        "Initial administrator",
        ["read", "write", "admin"],
        Number.MAX_SAFE_INTEGER,
      );
      return { accountId, ...key };
    });
  }
  private async newKey(
    tx: Transaction,
    accountId: string,
    name: string,
    scopes: string[],
    budgetCents: number,
  ) {
    const key = "vw_" + randomBytes(32).toString("base64url");
    const keyId = id();
    await tx.query(
      "INSERT INTO api_keys(id,account_id,digest,name,scopes,budget_cents) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
      [
        keyId,
        accountId,
        sha256(key),
        name,
        JSON.stringify(scopes),
        budgetCents,
      ],
    );
    return { id: keyId, key };
  }
  async issueKey(c: Context, input: unknown) {
    const data = z
      .object({
        name: z.string().min(1).max(80),
        scopes: z.array(z.enum(["read", "write", "admin"])).min(1),
        budgetCents: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
      })
      .parse(input);
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c, "admin");
      return this.newKey(
        tx,
        c.accountId,
        data.name,
        data.scopes,
        data.budgetCents,
      );
    });
  }
  async revokeKey(c: Context, keyId: string) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c, "admin");
      await tx.query(
        "UPDATE api_keys SET revoked=true WHERE id=$1 AND account_id=$2",
        [keyId, c.accountId],
      );
      return { revoked: true };
    });
  }
  async rotateKey(c: Context, keyId: string) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c, "admin");
      const k = (
        await tx.query(
          "SELECT * FROM api_keys WHERE id=$1 AND account_id=$2 AND revoked=false",
          [keyId, c.accountId],
        )
      ).rows[0];
      ensure(k, "NOT_FOUND", "Key not found", 404);
      const secret = "vw_" + randomBytes(32).toString("base64url");
      await tx.query("UPDATE api_keys SET digest=$1 WHERE id=$2", [
        sha256(secret),
        keyId,
      ]);
      return { id: keyId, key: secret };
    });
  }
  async get(c: Context, type: string, entityId: string) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c, "read");
      return this.owned(tx, c, type, entityId);
    });
  }
  private async owned(
    tx: Transaction,
    c: Pick<Context, "accountId">,
    type: string,
    entityId: string,
  ): Promise<Entity> {
    const value = await tx.get(entityId, c.accountId, type);
    ensure(value, "NOT_FOUND", `${type} not found`, 404);
    return value!;
  }
  async list(c: Context, type: string) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c, "read");
      return tx.list(c.accountId, type);
    });
  }
  async createProject(c: Context, input: unknown) {
    const data = z
      .object({
        title: z.string().min(1).max(160),
        brief: z.string().max(5000).default(""),
      })
      .parse(input);
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      return tx.put(entity(c.accountId, "project", data));
    });
  }
  private async checkAssets(
    tx: Transaction,
    c: Context,
    composition: Composition,
  ) {
    const refs = new Set(
      [
        ...composition.scenes.flatMap((s) => [s.assetId, s.audioAssetId]),
        ...composition.events.map((e) => e.assetId),
        composition.audio?.assetId,
      ].filter(Boolean) as string[],
    );
    for (const ref of refs) await this.owned(tx, c, "asset", ref);
  }
  async addRevision(c: Context, projectId: string, input: unknown) {
    const composition = compositionSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      const project = await this.owned(tx, c, "project", projectId);
      ensure(
        !project.workspaceManaged,
        "REVISION_CONFLICT",
        "Use workspace_commit with the current baseRevisionId for this project",
        409,
      );
      await this.checkAssets(tx, c, composition);
      const revision = await tx.put(
        entity(c.accountId, "revision", {
          projectId,
          parentId: null,
          composition,
          changes: [{ type: "initial" }],
        }),
      );
      await tx.put({ ...project, headRevisionId: revision.id });
      return revision;
    });
  }
  private patchComposition(base: Composition, raw: unknown) {
    const p = revisionPatchSchema.parse(raw);
    const next = structuredClone(base);
    if (p.type === "scene") {
      const scene = next.scenes.find((s) => s.id === p.sceneId);
      ensure(scene, "INVALID_SCENE", "Scene not found");
      if (p.changes.text !== undefined && p.changes.text !== scene!.text) {
        if (!p.changes.words) delete scene!.words;
        if (!p.changes.audioAssetId) delete scene!.audioAssetId;
      }
      Object.assign(scene!, p.changes);
    }
    if (p.type === "style") next.captionStyle = p.style;
    if (p.type === "format") {
      next.width = p.width;
      next.height = p.height;
    }
    if (p.type === "language") {
      ensure(
        p.scenes.length === next.scenes.length &&
          new Set(p.scenes.map((s) => s.sceneId)).size === next.scenes.length,
        "INCOMPLETE_LOCALIZATION",
        "Every scene requires translated text and new voice audio",
      );
      next.language = p.language;
      for (const s of next.scenes) {
        const translated = p.scenes.find((t) => t.sceneId === s.id);
        ensure(translated, "INCOMPLETE_LOCALIZATION", "Missing scene");
        Object.assign(s, {
          text: translated!.text,
          audioAssetId: translated!.audioAssetId,
          durationMs: translated!.durationMs,
          words: translated!.words,
        });
      }
    }
    if (p.type === "scene" || p.type === "language") {
      for (const binding of p.eventBindings ?? []) {
        const event = next.events.find((e) => e.id === binding.eventId);
        ensure(event, "INVALID_EVENT", "Event does not exist");
        if (p.type === "scene")
          ensure(
            event!.sceneId === p.sceneId,
            "INVALID_EVENT",
            "Binding must belong to the edited scene",
          );
        event!.wordId = binding.wordId;
        event!.offsetMs = binding.offsetMs;
      }
      for (const event of next.events)
        if (event.wordId)
          ensure(
            next.scenes
              .find((s) => s.id === event.sceneId)
              ?.words?.some((w) => w.id === event.wordId),
            "ALIGNMENT_REQUIRED",
            "Provide new word timings or explicit eventBindings for affected graphics.",
          );
    }
    return compositionSchema.parse(next);
  }
  async revise(c: Context, revisionId: string, patch: unknown) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      const base = await this.owned(tx, c, "revision", revisionId);
      const project = await this.owned(tx, c, "project", base.projectId);
      ensure(
        !project.workspaceManaged || project.headRevisionId === base.id,
        "REVISION_CONFLICT",
        "作品已有新版本，请先刷新。",
        409,
      );
      const composition = this.patchComposition(base.composition, patch);
      await this.checkAssets(tx, c, composition);
      const version = Number(project.version ?? 0) + 1;
      const revision = await tx.put(
        entity(c.accountId, "revision", {
          projectId: base.projectId,
          parentId: base.id,
          ...(base.templateSource
            ? { templateSource: base.templateSource }
            : {}),
          composition,
          changes: [revisionPatchSchema.parse(patch)],
          version,
        }),
      );
      await tx.put({ ...project, headRevisionId: revision.id, version });
      return revision;
    });
  }
  async variants(c: Context, revisionId: string, input: unknown) {
    const variants = z
      .array(
        z.object({
          label: z.string().max(80),
          text: z.string().min(1).max(1000),
          language: z.string().optional(),
          audioAssetId: z.string().optional(),
          durationMs: z.number().optional(),
          eventBindings: eventBindingsSchema.optional(),
        }),
      )
      .min(1)
      .max(12)
      .parse(input);
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      const base = await this.owned(tx, c, "revision", revisionId);
      const result = [];
      for (const v of variants) {
        ensure(
          !v.language || v.language === base.composition.language,
          "INCOMPLETE_LOCALIZATION",
          "Use language revision with every translated scene and audio",
        );
        const composition = this.patchComposition(base.composition, {
          type: "scene",
          sceneId: base.composition.scenes[0].id,
          eventBindings: v.eventBindings,
          changes: {
            text: v.text,
            ...(v.audioAssetId ? { audioAssetId: v.audioAssetId } : {}),
            ...(v.durationMs ? { durationMs: v.durationMs } : {}),
          },
        });
        await this.checkAssets(tx, c, composition);
        result.push(
          await tx.put(
            entity(c.accountId, "revision", {
              projectId: base.projectId,
              parentId: base.id,
              ...(base.templateSource
                ? { templateSource: base.templateSource }
                : {}),
              label: v.label,
              composition,
              changes: [{ type: "variant", label: v.label }],
            }),
          ),
        );
      }
      return result;
    });
  }
  async feedback(c: Context, revisionId: string, input: unknown) {
    const data = z
      .object({
        text: z.string().min(1).max(2000),
        sceneId: z.string().optional(),
        wordId: z.string().optional(),
        atMs: z.number().int().nonnegative().optional(),
        patch: revisionPatchSchema.optional(),
      })
      .parse(input);
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      const base = await this.owned(tx, c, "revision", revisionId);
      if (data.sceneId)
        ensure(
          base.composition.scenes.some((s: any) => s.id === data.sceneId),
          "INVALID_SCENE",
          "Feedback scene missing",
        );
      let revision: Entity | undefined;
      if (data.patch) {
        const project = await this.owned(tx, c, "project", base.projectId);
        ensure(
          !project.workspaceManaged || project.headRevisionId === base.id,
          "REVISION_CONFLICT",
          "作品已有新版本，请先刷新。",
          409,
        );
        const composition = this.patchComposition(base.composition, data.patch);
        await this.checkAssets(tx, c, composition);
        const version = Number(project.version ?? 0) + 1;
        revision = await tx.put(
          entity(c.accountId, "revision", {
            projectId: base.projectId,
            parentId: base.id,
            ...(base.templateSource
              ? { templateSource: base.templateSource }
              : {}),
            composition,
            changes: [data.patch],
            version,
          }),
        );
        await tx.put({ ...project, headRevisionId: revision.id, version });
      }
      const f = await tx.put(
        entity(c.accountId, "feedback", {
          revisionId,
          ...data,
          status: revision ? "applied" : "open",
          resultRevisionId: revision?.id ?? null,
        }),
      );
      return { feedback: f, revision };
    });
  }
  private async validateOperation(
    tx: Transaction,
    c: Context,
    input: Operation,
  ) {
    if (input.kind === "generate") {
      const assets = [];
      for (const ref of input.references ?? [])
        assets.push(await this.owned(tx, c, "asset", ref.assetId));
      if (input.references?.length) {
        validateGenerationAssets(this.provider.validate(input), input, assets);
        if (
          !this.storage.providerUrl &&
          this.provider.referenceDelivery?.(input) === "signed_url"
        )
          throw new AppError(
            "CAPABILITY_UNAVAILABLE",
            "This reference provider requires controlled signed storage URLs",
          );
      }
      await validateStoryboardInput(tx, c.accountId, input);
    }
    if (input.kind === "render") {
      await this.checkAssets(tx, c, input.composition);
      if (input.revisionId) {
        const rev = await this.owned(tx, c, "revision", input.revisionId);
        ensure(
          fingerprint(rev.composition) === fingerprint(input.composition),
          "REVISION_MISMATCH",
          "Render must match the immutable revision",
        );
      }
    } else if ("assetId" in input) {
      const asset = await this.owned(tx, c, "asset", input.assetId);
      if (input.kind === "reference_analyze") {
        ensure(
          asset.kind === "video",
          "INVALID_MEDIA",
          "Reference analysis requires video",
        );
        ensure(
          Number.isSafeInteger(asset.metadata?.durationMs) &&
            asset.metadata.durationMs > 0,
          "INVALID_MEDIA",
          "Source duration is unknown",
        );
        if (input.range)
          ensure(
            input.range.endMs <= asset.metadata.durationMs,
            "INVALID_INTERVAL",
            "Analysis interval exceeds source",
          );
        this.provider.validateSource?.(input, asset);
      }
      if (input.kind === "trim") {
        ensure(asset.kind === "video", "INVALID_MEDIA", "Trim requires video");
        for (const s of input.segments)
          ensure(
            s.endMs <= asset.metadata.durationMs,
            "INVALID_INTERVAL",
            "Segment outside source",
          );
      }
      if (input.kind === "captions")
        ensure(
          input.transcript.durationMs <= asset.metadata.durationMs + 100,
          "INVALID_TRANSCRIPT",
          "Transcript exceeds source duration",
        );
    }
  }
  estimate(input: Operation) {
    if (isPaidOperation(input)) {
      const price = this.provider.estimate(input);
      const fixedChargeCents =
        this.billingSource === "credits"
          ? this.provider.validate(input).creditPriceCents
          : undefined;
      return {
        ...price,
        providerMaxCostCents: price.maxCents,
        maxCents: fixedChargeCents ?? price.maxCents,
        fixedChargeCents,
      };
    }
    return {
      maxCents: 0,
      priceVersion: "local-free-v1",
      fixedChargeCents: undefined,
      providerMaxCostCents: 0,
    };
  }
  async quote(c: Context, raw: unknown) {
    const input = operationSchema.parse(raw);
    const price = this.estimate(input);
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      await this.validateOperation(tx, c, input);
      return tx.put(
        entity(c.accountId, "quote", {
          inputHash: fingerprint(input),
          referenceAssets: await this.referenceSnapshots(
            tx,
            c.accountId,
            input,
          ),
          ...price,
          billingSource: this.billingSource,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          evidence: price.maxCents ? "provider-live" : "local-real",
        }),
      );
    });
  }
  async submit(c: Context, raw: unknown) {
    const data = z
      .object({
        quoteId: z.string(),
        idempotencyKey: z.string().min(1).max(128),
        input: operationSchema,
      })
      .parse(raw);
    const hash = fingerprint(data.input);
    return this.db.transaction(async (tx) => {
      const key = await this.authorize(tx, c);
      const previous = (
        await tx.query(
          "SELECT * FROM job_dedup WHERE account_id=$1 AND idempotency_key=$2",
          [c.accountId, data.idempotencyKey],
        )
      ).rows[0];
      if (previous) {
        ensure(
          previous.fingerprint === hash,
          "IDEMPOTENCY_CONFLICT",
          "Same idempotency key has different input",
          409,
        );
        return this.owned(tx, c, "job", previous.job_id);
      }
      const q = await this.owned(tx, c, "quote", data.quoteId);
      ensure(
        q.inputHash === hash,
        "QUOTE_MISMATCH",
        "Quote input changed",
        409,
      );
      ensure(
        Date.parse(q.expiresAt) > Date.now(),
        "QUOTE_EXPIRED",
        "Request a new quote",
        409,
      );
      const price = this.estimate(data.input);
      ensure(
        q.priceVersion === price.priceVersion &&
          q.maxCents === price.maxCents &&
          (q.billingSource ?? "credits") === this.billingSource,
        "PRICE_CHANGED",
        "Request a new quote",
        409,
      );
      await this.validateOperation(tx, c, data.input);
      const referenceAssets = await this.referenceSnapshots(
        tx,
        c.accountId,
        data.input,
      );
      if (
        q.referenceAssets &&
        fingerprint(q.referenceAssets) !== fingerprint(referenceAssets)
      )
        throw new AppError(
          "REFERENCE_CHANGED",
          "Reference assets changed after quotation",
          409,
        );
      const account = (
        await tx.query("SELECT * FROM accounts WHERE id=$1", [c.accountId])
      ).rows[0];
      ensure(
        this.billingSource === "external" ||
          Number(account.balance_cents) - Number(account.reserved_cents) >=
            q.maxCents,
        "INSUFFICIENT_BALANCE",
        "Insufficient available balance",
        402,
      );
      ensure(
        Number(key.spent_cents) + Number(key.reserved_cents) + q.maxCents <=
          Number(key.budget_cents),
        "KEY_BUDGET_EXCEEDED",
        "Key budget exceeded",
        402,
      );
      const job = entity(c.accountId, "job", {
        input: data.input,
        referenceAssets,
        billingSource: this.billingSource,
        inputHash: hash,
        status: "queued",
        keyId: c.keyId,
        quoteId: q.id,
        reservedCents: q.maxCents,
        fixedChargeCents: q.fixedChargeCents,
        providerMaxCostCents: q.providerMaxCostCents ?? q.maxCents,
        providerActualCostCents: 0,
        providerCostStatus: "not_incurred",
        chargedCents: null,
        billingStatus: "reserved",
        priceVersion: q.priceVersion,
        actualCostCents: 0,
        costStatus: "not_incurred",
        steps: [],
        attempts: 0,
        cancelRequested: false,
        outputs: [],
        revisionId:
          data.input.kind === "render" ? (data.input.revisionId ?? null) : null,
      });
      await tx.put(job);
      await tx.query("INSERT INTO job_dedup VALUES($1,$2,$3,$4)", [
        c.accountId,
        data.idempotencyKey,
        hash,
        job.id,
      ]);
      if (this.billingSource !== "external")
        await tx.query(
          "UPDATE accounts SET reserved_cents=reserved_cents+$1 WHERE id=$2",
          [q.maxCents, c.accountId],
        );
      await tx.query(
        "UPDATE api_keys SET reserved_cents=reserved_cents+$1 WHERE id=$2",
        [q.maxCents, c.keyId],
      );
      await tx.query(
        "INSERT INTO ledger(id,account_id,job_id,kind,amount_cents) VALUES($1,$2,$3,$4,$5)",
        [id(), c.accountId, job.id, "reserve", q.maxCents],
      );
      await tx.query("INSERT INTO outbox(job_id) VALUES($1)", [job.id]);
      return job;
    });
  }
  private async referenceSnapshots(
    tx: Transaction,
    accountId: string,
    input: Operation,
  ) {
    const snapshots = [];
    if (input.kind === "generate")
      for (const ref of input.references ?? []) {
        const asset = await tx.get(ref.assetId, accountId, "asset");
        if (!asset) throw new AppError("NOT_FOUND", "Reference not found", 404);
        snapshots.push({ ...ref, sha256: asset.sha256, bytes: asset.bytes });
      }
    return snapshots;
  }
  private async settle(
    tx: Transaction,
    job: Entity,
    cents: number,
    status: string,
  ) {
    ensure(
      Number.isSafeInteger(cents) && cents >= 0 && cents <= job.reservedCents,
      "COST_BOUND_EXCEEDED",
      "Settlement exceeds reservation",
    );
    if (job.settled) return;
    if (job.billingSource !== "external")
      await tx.query(
        "UPDATE accounts SET reserved_cents=reserved_cents-$1,balance_cents=balance_cents-$2 WHERE id=$3",
        [job.reservedCents, cents, job.accountId],
      );
    await tx.query(
      "UPDATE api_keys SET reserved_cents=reserved_cents-$1,spent_cents=spent_cents+$2 WHERE id=$3",
      [job.reservedCents, cents, job.keyId],
    );
    for (const [kind, amount] of [
      ["settle", cents],
      ["release", job.reservedCents - cents],
    ] as const)
      await tx.query(
        "INSERT INTO ledger(id,account_id,job_id,kind,amount_cents) VALUES($1,$2,$3,$4,$5)",
        [id(), job.accountId, job.id, kind, amount],
      );
    job.settled = true;
    job.chargedCents = cents;
    job.billingStatus = status;
    // Compatibility for older clients: this field has always represented account spending.
    job.actualCostCents = cents;
    job.costStatus = status;
  }
  async cancel(c: Context, jobId: string) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      const j = await this.owned(tx, c, "job", jobId);
      if (["completed", "failed", "cancelled"].includes(j.status)) return j;
      j.cancelRequested = true;
      if (j.status === "queued" && !j.ticket && j.phase !== "submitting") {
        j.status = "cancelled";
        this.recordProviderCost(j, 0);
        await this.settle(tx, j, 0, "confirmed");
      }
      return tx.put(j);
    });
  }
  async resume(c: Context, jobId: string) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      const job = await this.owned(tx, c, "job", jobId);
      ensure(
        job.status === "failed" && job.ticket && !job.settled,
        "INVALID_STATE",
        "Only a failed task with a known provider request and retained reservation can resume. Unknown submissions require reconciliation.",
      );
      job.status = "queued";
      job.error = null;
      job.cancelRequested = false;
      job.phase = "provider_wait";
      job.nextRunAt = new Date(0).toISOString();
      return tx.put(job);
    });
  }
  async claim(workerId: string, kinds?: string[]): Promise<Entity | null> {
    return this.db.transaction(async (tx) => {
      const jobs = (
        await tx.query(
          "SELECT data FROM entities WHERE type='job' AND NOT (data ? 'remoteJobId') AND (data->>'status'='queued' OR (data->>'status'='running' AND (data->>'leaseUntil')::timestamptz < now())) AND (data->>'nextRunAt' IS NULL OR (data->>'nextRunAt')::timestamptz <= now())" +
            (kinds ? " AND data->'input'->>'kind'=ANY($1::text[])" : "") +
            " ORDER BY data->>'createdAt' LIMIT 1",
          kinds ? [kinds] : [],
        )
      ).rows;
      const j = jobs[0]?.data as Entity | undefined;
      if (!j) return null;
      if (j.phase === "submitting" && !j.ticket) {
        j.status = "submission_unknown";
        j.costStatus = "pending_reconciliation";
        j.billingStatus = "pending_reconciliation";
        this.recordProviderCost(j, null);
        await tx.put(j);
        return null;
      }
      j.status = "running";
      j.workerId = workerId;
      j.leaseToken = id();
      j.leaseUntil = new Date(Date.now() + 30000).toISOString();
      j.attempts++;
      return tx.put(j);
    });
  }
  async checkpoint(
    jobId: string,
    leaseToken: string,
    changes: Record<string, unknown>,
  ) {
    return this.db.transaction(async (tx) => {
      const j = await tx.get(jobId);
      ensure(
        j &&
          j.type === "job" &&
          j.leaseToken === leaseToken &&
          j.status === "running",
        "LEASE_LOST",
        "Job ownership changed",
        409,
      );
      Object.assign(j!, changes, {
        leaseUntil: new Date(Date.now() + 30000).toISOString(),
      });
      return tx.put(j!);
    });
  }
  async finish(
    jobId: string,
    leaseToken: string,
    changes: Record<string, unknown>,
    cost: number | null = 0,
  ) {
    return this.db.transaction(async (tx) => {
      const j = await tx.get(jobId);
      ensure(
        j?.leaseToken === leaseToken && j.status === "running",
        "LEASE_LOST",
        "Job ownership changed",
        409,
      );
      Object.assign(j!, changes, { finishedAt: now() });
      this.recordProviderCost(j!, cost);
      const charge = this.customerCharge(j!, cost);
      if (charge !== null) await this.settle(tx, j!, charge, "confirmed");
      else {
        j!.costStatus = "pending_reconciliation";
        j!.billingStatus = "pending_reconciliation";
      }
      return tx.put(j!);
    });
  }
  private recordProviderCost(job: Entity, cost: number | null) {
    ensure(
      cost === null || (Number.isSafeInteger(cost) && cost >= 0),
      "INVALID_COST",
      "Supplier cost must be a nonnegative integer or unknown",
    );
    job.providerActualCostCents = cost;
    job.providerCostStatus =
      cost === null ? "pending_reconciliation" : "confirmed";
    job.providerCostOverrunCents =
      cost === null
        ? null
        : Math.max(0, cost - (job.providerMaxCostCents ?? job.reservedCents));
  }
  private customerCharge(
    job: Entity,
    providerCost: number | null,
  ): number | null {
    if (
      job.fixedChargeCents !== undefined &&
      job.billingSource !== "external"
    ) {
      if (job.status === "completed") return job.fixedChargeCents;
      // An accepted or unknown request retains its reservation until its outcome is resolved.
      return providerCost === null ? null : 0;
    }
    return providerCost;
  }
  async reconcileProviderCost(c: Context, jobId: string, input: unknown) {
    const data = z
      .object({
        costCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        note: z.string().min(5).max(1000),
        providerRequestId: z.string().max(200).optional(),
      })
      .strict()
      .parse(input);
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c, "admin");
      const job = await this.owned(tx, c, "job", jobId);
      ensure(
        job.settled &&
          ["completed", "failed", "cancelled"].includes(job.status),
        "INVALID_STATE",
        "Resolve the task and customer charge before reconciling supplier cost",
      );
      if (job.providerCostStatus === "confirmed") {
        ensure(
          job.providerActualCostCents === data.costCents,
          "RECONCILIATION_CONFLICT",
          "Supplier cost is already confirmed",
          409,
        );
        return job;
      }
      ensure(
        job.providerCostStatus === "pending_reconciliation",
        "INVALID_STATE",
        "Job does not require supplier reconciliation",
      );
      this.recordProviderCost(job, data.costCents);
      job.providerReconciliation = { ...data, at: now(), keyId: c.keyId };
      return tx.put(job);
    });
  }
  async reconcile(c: Context, jobId: string, input: unknown) {
    const data = z
      .object({
        costCents: z.number().int().nonnegative(),
        note: z.string().min(5).max(1000),
        outcome: z.enum(["completed", "failed", "cancelled"]),
        providerRequestId: z.string().optional(),
      })
      .parse(input);
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c, "admin");
      const j = await this.owned(tx, c, "job", jobId);
      ensure(
        j.costStatus === "pending_reconciliation",
        "INVALID_STATE",
        "Job does not require reconciliation",
      );
      if (data.outcome === "completed")
        ensure(
          j.outputs.length,
          "INVALID_STATE",
          "Cannot mark complete without collected outputs",
        );
      j.status = data.outcome;
      this.recordProviderCost(j, data.costCents);
      await this.settle(
        tx,
        j,
        this.customerCharge(j, data.costCents)!,
        "confirmed",
      );
      j.reconciliation = { ...data, at: now() };
      return tx.put(j);
    });
  }
  async usage(c: Context) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c, "read");
      const a = (
        await tx.query("SELECT * FROM accounts WHERE id=$1", [c.accountId])
      ).rows[0];
      const entries = (
        await tx.query(
          "SELECT job_id,kind,amount_cents,created_at FROM ledger WHERE account_id=$1 ORDER BY created_at DESC",
          [c.accountId],
        )
      ).rows;
      const charges = (await tx.list(c.accountId, "job"))
        .filter(
          (job) =>
            job.input &&
            isPaidOperation(job.input) &&
            job.executionTarget !== "cloud",
        )
        .slice(0, 100)
        .map((job) => ({
          jobId: job.id,
          model: job.input.model,
          createdAt: job.createdAt,
          status: job.status,
          reservedCents: job.settled ? 0 : job.reservedCents,
          chargedCents:
            job.chargedCents ?? (job.settled ? job.actualCostCents : null),
          billingStatus: job.billingStatus ?? job.costStatus,
          billingSource: job.billingSource ?? "credits",
        }));
      return {
        currency: "USD" as const,
        charges,
        billingSource: this.billingSource,
        balanceCents: Number(a.balance_cents),
        reservedCents: Number(a.reserved_cents),
        availableCents: Number(a.balance_cents) - Number(a.reserved_cents),
        ledger: entries,
      };
    });
  }
  async registerAsset(
    accountId: string,
    data: Uint8Array,
    info: {
      name: string;
      kind: string;
      mime: string;
      metadata: Record<string, unknown>;
      provenance: Record<string, unknown>;
      jobId?: string;
    },
  ) {
    const hash = sha256(data);
    const existing = await this.db.transaction(async (tx) =>
      (await tx.list(accountId, "asset")).find((a) => a.sha256 === hash),
    );
    if (existing) return existing;
    const assetId = id();
    const storageKey = `${accountId}/${assetId}`;
    await this.storage.put(storageKey, data);
    const asset = {
      ...entity(accountId, "asset", {
        ...info,
        sha256: hash,
        bytes: data.byteLength,
        storageKey,
        expiresAt: null,
      }),
      id: assetId,
    };
    return this.db.transaction((tx) => tx.put(asset));
  }
  async createUpload(c: Context, raw: unknown) {
    const info = z
      .object({
        name: z.string().min(1).max(120),
        bytes: z
          .number()
          .int()
          .positive()
          .max(100 * 1024 * 1024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        source: z.string().min(1).max(1000),
        license: z.string().min(1).max(100),
        rightsConfirmed: z.literal(true),
      })
      .parse(raw);
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      const intent = entity(c.accountId, "upload", {
        ...info,
        status: "pending",
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      });
      return tx.put(intent);
    });
  }
  async createShare(c: Context, revisionId: string) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      await this.owned(tx, c, "revision", revisionId);
      const token = randomBytes(32).toString("base64url");
      const share = await tx.put(
        entity(c.accountId, "share", {
          revisionId,
          digest: sha256(token),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          revoked: false,
        }),
      );
      return { id: share.id, token, expiresAt: share.expiresAt };
    });
  }
  async revokeShare(c: Context, shareId: string) {
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, c);
      const s = await this.owned(tx, c, "share", shareId);
      s.revoked = true;
      return tx.put(s);
    });
  }
  async resolveShare(token: string) {
    return this.db.transaction(async (tx) => {
      const s = (
        await tx.query(
          "SELECT data FROM entities WHERE type='share' AND data->>'digest'=$1",
          [sha256(token)],
        )
      ).rows[0]?.data;
      ensure(
        s && !s.revoked && Date.parse(s.expiresAt) > Date.now(),
        "UNAUTHORIZED",
        "Preview link expired or revoked",
        401,
      );
      const revision = await this.owned(
        tx,
        { accountId: s.accountId },
        "revision",
        s.revisionId,
      );
      const jobs = await tx.list(s.accountId, "job");
      return {
        revision,
        jobs: jobs.filter(
          (j) => j.revisionId === revision.id && j.status === "completed",
        ),
        share: s,
      };
    });
  }
}
