import { z } from "zod";
import { Service, fingerprint } from "../../core/src/index.js";
import { AppError, type Context } from "../../contracts/src/index.js";
import {
  templateSchema,
  applyTemplateSchema,
  instantiate,
} from "../../templates/src/schema.js";
import { cloudOrigin, cloudRequest } from "./http.js";
import { downloadPublic } from "../../storage/src/download.js";
import { sha256 } from "../../storage/src/index.js";
import { completeUpload } from "../../core/src/assets.js";
import {
  validateSceneAssets,
  bindSceneAssets,
} from "../../templates/src/local-library.js";
import {
  prepareTemplateSpeech,
  validateSpeechVisuals,
} from "../../templates/src/speech.js";
const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  templates: z
    .array(templateSchema.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/) }))
    .max(1000),
});
export class TemplateClient {
  private pending = new Map<string, Promise<unknown>>();
  constructor(
    private service: Service,
    private origin: string,
    private fetcher: typeof fetch = fetch,
  ) {
    cloudOrigin(origin);
  }
  private cacheId(c: Context) {
    return `catalog-${fingerprint([c.accountId, this.origin])}`;
  }
  async list(c: Context) {
    return this.service.scoped(
      c,
      "read",
      async (tx) =>
        (await tx.get(this.cacheId(c), c.accountId, "template-cache")) ?? {
          schemaVersion: 1,
          revision: 0,
          templates: [],
          syncedAt: null,
          source: this.origin,
          etag: undefined,
          createdAt: undefined,
        },
    );
  }
  async sync(c: Context) {
    await this.service.scoped(c, "write", async () => {});
    const id = this.cacheId(c),
      pending = this.pending.get(id);
    if (pending) return pending;
    const run = this.performSync(c).finally(() => this.pending.delete(id));
    this.pending.set(id, run);
    return run;
  }
  private async performSync(c: Context) {
    const old = await this.list(c);
    const { response, data } = await cloudRequest(
      this.origin,
      "/v1/catalog",
      this.fetcher,
      { etag: old.etag },
    );
    const snapshot = data === null ? old : snapshotSchema.parse(data);
    for (const item of snapshot.templates) {
      const { hash, ...definition } = item;
      if (fingerprint(templateSchema.parse(definition)) !== hash)
        throw new AppError("TEMPLATE_HASH_MISMATCH", "模板校验失败", 502);
    }
    return this.service.scoped(c, "write", async (tx) =>
      tx.put({
        id: this.cacheId(c),
        type: "template-cache",
        accountId: c.accountId,
        createdAt: old.createdAt ?? new Date().toISOString(),
        schemaVersion: 1,
        revision: snapshot.revision,
        templates: snapshot.templates,
        source: this.origin,
        etag: response.headers.get("etag") ?? old.etag,
        syncedAt: new Date().toISOString(),
      }),
    );
  }
  async prepare(c: Context, raw: unknown) {
    await this.service.scoped(c, "write", async () => {});
    const p = applyTemplateSchema.parse(raw),
      snapshot = await this.list(c);
    const entry = snapshot.templates.find(
      (t: any) => t.id === p.id && t.version === p.version,
    );
    if (!entry)
      throw new AppError(
        "TEMPLATE_NOT_CACHED",
        "请手动更新模板后选择可用版本",
        409,
      );
    const { hash: _hash, ...definition } = entry;
    const template = templateSchema.parse(definition),
      mapping: Record<string, string> = {};
    const bindings = await validateSceneAssets(
      this.service,
      c,
      template.composition.scenes.map((s) => s.id),
      p.sceneAssets,
    );
    const draft = await prepareTemplateSpeech(
      this.service,
      c,
      template,
      bindSceneAssets(
        instantiate(
          template,
          p.parameters,
          Object.fromEntries(template.assets.map((a) => [a.id, a.id])),
        ),
        bindings,
      ),
      p.speech,
      p.parameters,
    );
    validateSpeechVisuals(draft, bindings);
    const needed = new Set([
      ...draft.scenes.flatMap((s) => [s.assetId, s.audioAssetId]),
      ...draft.events.map((e) => e.assetId),
      draft.audio?.assetId,
    ]);
    for (const a of template.assets) {
      if (!needed.has(a.id)) {
        mapping[a.id] = a.id;
        continue;
      }
      let asset = (await this.service.list(c, "asset")).find(
        (x) => x.sha256 === a.sha256,
      );
      if (!asset) {
        const { data } = await cloudRequest(
          this.origin,
          `/v1/templates/${p.id}/versions/${p.version}/assets/${a.id}`,
          this.fetcher,
        );
        const bytes = await downloadPublic(z.url().parse(data.url));
        if (bytes.byteLength !== a.bytes || sha256(bytes) !== a.sha256)
          throw new AppError("ASSET_HASH_MISMATCH", "模板素材校验失败", 502);
        const intent = await this.service.createUpload(c, {
          name: a.name,
          bytes: a.bytes,
          sha256: a.sha256,
          source: "cloud-template",
          license: a.license,
          rightsConfirmed: true,
        });
        asset = await completeUpload(this.service, c, intent.id, bytes);
      }
      mapping[a.id] = asset.id;
    }
    const composition = await prepareTemplateSpeech(
      this.service,
      c,
      template,
      bindSceneAssets(instantiate(template, p.parameters, mapping), bindings),
      p.speech,
      p.parameters,
    );
    const resolvedVisuals = { ...bindings };
    for (const scene of composition.scenes)
      if (scene.speechAlignment && scene.assetId && !resolvedVisuals[scene.id])
        resolvedVisuals[scene.id] = await this.service.get(
          c,
          "asset",
          scene.assetId,
        );
    validateSpeechVisuals(composition, resolvedVisuals);
    return {
      composition,
      templateSource: {
        id: template.id,
        version: template.version,
        hash: entry.hash,
        source: this.origin,
        parameters: p.parameters,
        snapshot: template,
      },
      reuse: {
        existingScenes: Object.keys(bindings).length,
        bundledScenes: composition.scenes.length - Object.keys(bindings).length,
        generationRequests: 0,
      },
    };
  }
  async apply(c: Context, raw: unknown) {
    const { composition, templateSource } = await this.prepare(c, raw);
    const project = await this.service.createProject(c, {
      title: composition.title,
    });
    let revision = await this.service.addRevision(c, project.id, composition);
    revision = await this.service.scoped(c, "write", (tx) =>
      tx.put({
        ...revision,
        templateSource,
      }),
    );
    return { project, revision };
  }
}
