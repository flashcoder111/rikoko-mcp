import { randomUUID } from "node:crypto";
import { Service, fingerprint } from "../../core/src/index.js";
import { sha256 } from "../../storage/src/index.js";
import { validateStoryboardInput } from "../../core/src/storyboard-state.js";
import { completeUpload, importUrl } from "../../core/src/assets.js";
import {
  AppError,
  operationSchema,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import { cloudOrigin, cloudRequest } from "./http.js";
export class GatewayClient {
  private uploads = new Map<string, Promise<string>>();
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
    const referenceAssets = await this.references(c, input);
    const remoteInput = { ...input };
    if (input.references?.length) {
      remoteInput.references = [];
      for (let i = 0; i < input.references.length; i++)
        remoteInput.references.push({
          ...input.references[i],
          assetId: await this.upload(c, referenceAssets[i]),
        });
    }
    // Storyboards and visual review remain local; the cloud receives only the validated generation operation.
    delete remoteInput.storyboard;
    await this.references(c, input, referenceAssets);
    const remote = await this.request("/v1/quotes", { input: remoteInput });
    return this.service.scoped(c, "write", (tx) =>
      tx.put({
        ...remote,
        id: randomUUID(),
        accountId: c.accountId,
        type: "quote",
        remoteQuoteId: remote.id,
        remoteInput,
        referenceAssets,
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
    await this.references(c, input, q.referenceAssets ?? []);
    const remote = await this.request("/v1/generations", {
      ...p,
      input: q.remoteInput ?? input,
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
  private async references(
    c: Context,
    input: ReturnType<typeof operationSchema.parse>,
    expected?: Entity[],
  ) {
    return this.service.scoped(c, "write", async (tx) => {
      await validateStoryboardInput(tx, c.accountId, input);
      const assets: Entity[] = [];
      if (input.kind !== "generate") return assets;
      for (const ref of input.references ?? []) {
        const asset = await tx.get(ref.assetId, c.accountId, "asset");
        if (!asset) throw new AppError("NOT_FOUND", "Reference not found", 404);
        if (
          !asset.storageKey ||
          !Number.isSafeInteger(asset.bytes) ||
          asset.bytes <= 0 ||
          asset.bytes > 100 * 1024 * 1024
        )
          throw new AppError(
            "INVALID_MEDIA",
            "Reference must be an uploaded local media asset",
          );
        assets.push({
          id: asset.id,
          type: "asset",
          accountId: c.accountId,
          createdAt: asset.createdAt,
          sha256: asset.sha256,
          bytes: asset.bytes,
          storageKey: asset.storageKey,
          name: asset.name,
          license: asset.provenance?.license ?? "user-provided",
        });
      }
      if (expected && fingerprint(assets) !== fingerprint(expected))
        throw new AppError(
          "REFERENCE_CHANGED",
          "References changed after quoting; request a new quote",
          409,
        );
      return assets;
    });
  }
  private async upload(c: Context, asset: Entity): Promise<string> {
    const id = `cloud-ref-${fingerprint([c.accountId, this.origin, sha256(this.key), asset.id, asset.sha256, asset.bytes])}`;
    const cached = await this.service.scoped(c, "read", (tx) =>
      tx.get(id, c.accountId, "cloud-reference"),
    );
    if (cached) return cached.remoteAssetId;
    let pending = this.uploads.get(id);
    if (!pending) {
      pending = (async () => {
        const bytes = await this.service.storage.read(asset.storageKey);
        if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256)
          throw new AppError(
            "REFERENCE_CHANGED",
            "Reference bytes do not match local metadata",
            409,
          );
        const intent = await this.request("/v1/reference-uploads", {
          name: asset.name.slice(0, 120),
          bytes: asset.bytes,
          sha256: asset.sha256,
          source: "rikoko-reference",
          license: asset.license,
          rightsConfirmed: true,
        });
        if (
          typeof intent.id !== "string" ||
          !/^[A-Za-z0-9_-]+$/.test(intent.id)
        )
          throw new AppError(
            "CLOUD_RESPONSE_INVALID",
            "Invalid reference upload response",
            502,
          );
        const { data: remote } = await cloudRequest(
          this.origin,
          `/v1/reference-uploads/${intent.id}`,
          this.fetcher,
          { key: this.key, bytes },
        );
        if (
          typeof remote.id !== "string" ||
          !/^[A-Za-z0-9_-]+$/.test(remote.id) ||
          remote.sha256 !== asset.sha256 ||
          remote.bytes !== asset.bytes
        )
          throw new AppError(
            "CLOUD_RESPONSE_INVALID",
            "Cloud reference integrity verification failed",
            502,
          );
        await this.service.scoped(c, "write", (tx) =>
          tx.put({
            id,
            accountId: c.accountId,
            type: "cloud-reference",
            createdAt: new Date().toISOString(),
            remoteAssetId: remote.id,
          }),
        );
        return remote.id;
      })().finally(() => this.uploads.delete(id));
      this.uploads.set(id, pending);
    }
    return pending;
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
      (remote.result?.downloadPath || remote.result?.url) &&
      !outputs.length &&
      (c.scopes.includes("write") || c.scopes.includes("admin"))
    ) {
      let pending = this.imports.get(id);
      if (!pending) {
        pending = (async () => {
          const name = `generated-${remote.result.kind}-${local.remoteJobId}`;
          if (remote.result.downloadPath) {
            // Derive the path from the owned job; never forward credentials to a returned URL.
            const path = `/v1/generations/${encodeURIComponent(local.remoteJobId)}/result`;
            const { data: bytes } = await cloudRequest(
              this.origin,
              path,
              this.fetcher,
              {
                key: this.key,
                binary: true,
              },
            );
            const intent = await this.service.createUpload(c, {
              name,
              bytes: bytes.byteLength,
              sha256: sha256(bytes),
              source: `official-generation:${local.remoteJobId}`,
              license: "provider-model-terms",
              rightsConfirmed: true,
            });
            return completeUpload(this.service, c, intent.id, bytes);
          }
          return importUrl(this.service, c, {
            url: remote.result.url,
            name,
            license: "provider-model-terms",
            rightsConfirmed: true,
          });
        })().finally(() => this.imports.delete(id));
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
