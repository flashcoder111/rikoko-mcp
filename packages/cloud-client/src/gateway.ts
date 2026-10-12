import { randomUUID } from "node:crypto";
import { Service, fingerprint } from "../../core/src/index.js";
import { importUrl } from "../../core/src/assets.js";
import {
  AppError,
  operationSchema,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import { cloudOrigin, cloudRequest } from "./http.js";
export class GatewayClient {
  private imports = new Map<string, Promise<Entity>>();
  constructor(
    private service: Service,
    private origin: string,
    private key: string,
    private fetcher: typeof fetch = fetch,
  ) {
    cloudOrigin(origin);
  }
  private async request(path: string, body?: unknown) {
    return (
      await cloudRequest(this.origin, path, this.fetcher, {
        key: this.key,
        body,
      })
    ).data;
  }
  async models(c: Context) {
    await this.service.scoped(c, "read", async () => {});
    return this.request("/v1/generation-models");
  }
  async usage(c: Context) {
    await this.service.scoped(c, "read", async () => {});
    return this.request("/v1/usage");
  }
  async quote(c: Context, raw: unknown) {
    await this.service.scoped(c, "write", async () => {});
    const input = operationSchema.parse(raw);
    if (input.kind !== "generate")
      throw new AppError(
        "INVALID_CAPABILITY",
        "云端仅支持图片、视频和音频生成",
      );
    const remote = await this.request("/v1/quotes", { input });
    return this.service.scoped(c, "write", (tx) =>
      tx.put({
        ...remote,
        id: randomUUID(),
        accountId: c.accountId,
        type: "quote",
        remoteQuoteId: remote.id,
        cloudOrigin: this.origin,
        inputHash: fingerprint(input),
        createdAt: new Date().toISOString(),
      }),
    );
  }
  async submit(
    c: Context,
    p: { quoteId: string; idempotencyKey: string; input: unknown },
  ) {
    await this.service.scoped(c, "write", async () => {});
    const input = operationSchema.parse(p.input);
    if (input.kind !== "generate")
      throw new AppError(
        "INVALID_CAPABILITY",
        "云端仅支持图片、视频和音频生成",
      );
    const q = await this.service.get(c, "quote", p.quoteId);
    if (q.cloudOrigin !== this.origin || q.inputHash !== fingerprint(input))
      throw new AppError("QUOTE_MISMATCH", "云端报价与请求不一致", 409);
    const id = `cloud-${fingerprint([c.accountId, this.origin, p.idempotencyKey])}`;
    const existing = await this.service.scoped(c, "read", (tx) =>
      tx.get(id, c.accountId, "job"),
    );
    if (existing) {
      if (existing.inputHash !== fingerprint(input))
        throw new AppError("IDEMPOTENCY_CONFLICT", "重复请求内容不同", 409);
      return existing;
    }
    const remote = await this.request("/v1/generations", {
      ...p,
      input,
      quoteId: q.remoteQuoteId,
      idempotencyKey: fingerprint([c.accountId, p.idempotencyKey]),
    });
    return this.service.scoped(c, "write", (tx) =>
      tx.put({
        ...remote,
        id,
        accountId: c.accountId,
        type: "job",
        remoteJobId: remote.id,
        cloudOrigin: this.origin,
        input,
        inputHash: fingerprint(input),
        outputs: [],
        steps: [],
        createdAt: remote.createdAt ?? new Date().toISOString(),
        executionTarget: "cloud",
      }),
    );
  }
  async get(c: Context, id: string) {
    const local = await this.service.get(c, "job", id);
    if (local.cloudOrigin !== this.origin || !local.remoteJobId)
      throw new AppError("CLOUD_SOURCE_CHANGED", "任务来自其他云端配置", 409);
    const remote = await this.request(
      `/v1/generations/${encodeURIComponent(local.remoteJobId)}`,
    );
    let outputs = local.outputs ?? [];
    if (
      remote.status === "completed" &&
      remote.result?.url &&
      !outputs.length &&
      (c.scopes.includes("write") || c.scopes.includes("admin"))
    ) {
      let pending = this.imports.get(id);
      if (!pending) {
        pending = importUrl(this.service, c, {
          url: remote.result.url,
          name: `generated-${remote.result.kind}-${local.remoteJobId}`,
          license: "provider-model-terms",
          rightsConfirmed: true,
        }).finally(() => this.imports.delete(id));
        this.imports.set(id, pending);
      }
      outputs = [(await pending).id];
    }
    const next = {
      ...local,
      ...remote,
      id: local.id,
      accountId: c.accountId,
      type: "job",
      outputs,
      remoteJobId: local.remoteJobId,
    };
    // Account ownership is checked before every remote fetch; no local budget is charged.
    return this.service.scoped(c, "read", async (tx) => {
      const current = await tx.get(id, c.accountId, "job");
      // A concurrent read-only poll must not discard an already imported file.
      if (current?.outputs?.length) next.outputs = current.outputs;
      return tx.put(next);
    });
  }
  async action(
    c: Context,
    id: string,
    action: "cancel" | "resume" | "reconcile",
    body: unknown = {},
  ) {
    await this.service.scoped(c, "write", async () => {});
    const local = await this.service.get(c, "job", id);
    if (local.cloudOrigin !== this.origin || !local.remoteJobId)
      throw new AppError("CLOUD_SOURCE_CHANGED", "任务来自其他云端配置", 409);
    if (action === "reconcile" && !c.scopes.includes("admin"))
      throw new AppError("FORBIDDEN", "Administrator required", 403);
    await this.request(
      `/v1/generations/${encodeURIComponent(local.remoteJobId)}/${action}`,
      body,
    );
    return this.get(c, id);
  }
}
