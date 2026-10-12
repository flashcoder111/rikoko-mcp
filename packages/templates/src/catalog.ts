import { Database } from "../../db/src/index.js";
import { AppError } from "../../contracts/src/index.js";
import { fingerprint } from "../../core/src/index.js";
import { templateSchema, type Template } from "./schema.js";
export class Catalog {
  constructor(public db: Database) {}
  async initialize() {
    await this.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO accounts(id,name,balance_cents) VALUES('catalog-system','Template publisher',0) ON CONFLICT DO NOTHING",
      );
      await tx.query(
        "CREATE TABLE IF NOT EXISTS cloud_templates(id text PRIMARY KEY, current_version integer, updated_at timestamptz NOT NULL DEFAULT now())",
      );
      await tx.query(
        "CREATE TABLE IF NOT EXISTS cloud_template_versions(template_id text REFERENCES cloud_templates(id), version integer, hash text NOT NULL, definition jsonb NOT NULL, published boolean NOT NULL DEFAULT false, PRIMARY KEY(template_id,version))",
      );
      await tx.query(
        "CREATE TABLE IF NOT EXISTS cloud_template_releases(id bigserial PRIMARY KEY, template_id text NOT NULL, version integer, created_at timestamptz NOT NULL DEFAULT now())",
      );
    });
  }
  async save(raw: unknown) {
    const t = templateSchema.parse(raw),
      hash = fingerprint(t);
    return this.db.transaction(async (tx) => {
      const prior = await tx.query(
        "SELECT hash FROM cloud_template_versions WHERE template_id=$1 AND version=$2",
        [t.id, t.version],
      );
      if (prior.rows.length)
        throw new AppError("VERSION_EXISTS", "版本已存在，请增加版本号", 409);
      await tx.query(
        "INSERT INTO cloud_templates(id) VALUES($1) ON CONFLICT DO NOTHING",
        [t.id],
      );
      await tx.query(
        "INSERT INTO cloud_template_versions(template_id,version,hash,definition) VALUES($1,$2,$3,$4::jsonb)",
        [t.id, t.version, hash, JSON.stringify(t)],
      );
      return { ...t, hash };
    });
  }
  async publish(id: string, version: number) {
    return this.db.transaction(async (tx) => {
      const v = (
        await tx.query(
          "SELECT definition FROM cloud_template_versions WHERE template_id=$1 AND version=$2",
          [id, version],
        )
      ).rows[0];
      if (!v) throw new AppError("NOT_FOUND", "模板版本不存在", 404);
      // Asset records are admitted only by the verified R2 upload completion flow.
      for (const asset of (v.definition as Template).assets) {
        const record = await tx.get(asset.id, undefined, "cloud-asset");
        if (
          !record ||
          !record.ready ||
          record.sha256 !== asset.sha256 ||
          record.bytes !== asset.bytes ||
          record.visibility !== "public"
        )
          throw new AppError(
            "ASSET_NOT_READY",
            "模板素材尚未验证为可公开发布",
            409,
          );
      }
      const current = (
        await tx.query(
          "SELECT current_version FROM cloud_templates WHERE id=$1",
          [id],
        )
      ).rows[0];
      if (current.current_version === version)
        return { id, version, published: true };
      await tx.query(
        "UPDATE cloud_template_versions SET published=true WHERE template_id=$1 AND version=$2",
        [id, version],
      );
      await tx.query(
        "UPDATE cloud_templates SET current_version=$2,updated_at=now() WHERE id=$1",
        [id, version],
      );
      await tx.query(
        "INSERT INTO cloud_template_releases(template_id,version) VALUES($1,$2)",
        [id, version],
      );
      return { id, version, published: true };
    });
  }
  async unpublish(id: string) {
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query(
          "SELECT current_version FROM cloud_templates WHERE id=$1",
          [id],
        )
      ).rows[0];
      if (!row) throw new AppError("NOT_FOUND", "模板不存在", 404);
      if (row.current_version !== null) {
        await tx.query(
          "UPDATE cloud_templates SET current_version=NULL,updated_at=now() WHERE id=$1",
          [id],
        );
        await tx.query(
          "INSERT INTO cloud_template_releases(template_id,version) VALUES($1,NULL)",
          [id],
        );
      }
      return { id, published: false };
    });
  }
  async list(admin = false) {
    return this.db.transaction(async (tx) => {
      const rows = (
        await tx.query(
          admin
            ? "SELECT v.definition,v.hash,v.published,t.current_version FROM cloud_template_versions v JOIN cloud_templates t ON t.id=v.template_id ORDER BY v.template_id,v.version DESC LIMIT 1000"
            : "SELECT v.definition,v.hash FROM cloud_template_versions v JOIN cloud_templates t ON t.id=v.template_id AND t.current_version=v.version ORDER BY v.template_id LIMIT 1000",
        )
      ).rows;
      const revision = Number(
        (
          await tx.query(
            "SELECT COALESCE(MAX(id),0) AS revision FROM cloud_template_releases",
          )
        ).rows[0].revision,
      );
      const templates = rows.map((r) => ({
        ...r.definition,
        hash: r.hash,
        ...(admin
          ? {
              published: r.published,
              current: r.current_version === r.definition.version,
            }
          : {}),
      }));
      return { schemaVersion: 1, revision, templates };
    });
  }
  async get(id: string, version: number) {
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query(
          "SELECT v.definition,v.hash FROM cloud_template_versions v JOIN cloud_templates t ON t.id=v.template_id WHERE v.template_id=$1 AND v.version=$2 AND v.published=true AND t.current_version IS NOT NULL",
          [id, version],
        )
      ).rows[0];
      if (!row) throw new AppError("NOT_FOUND", "模板版本不可用", 404);
      return { ...row.definition, hash: row.hash } as Template & {
        hash: string;
      };
    });
  }
}
