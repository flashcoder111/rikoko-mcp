import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile } from "node:fs/promises";
import type { Entity } from "../../contracts/src/index.js";
export type Query = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: any[] }>;
export class Transaction {
  constructor(public query: Query) {}
  async get(
    id: string,
    accountId?: string,
    type?: string,
  ): Promise<Entity | null> {
    const r = await this.query(
      "SELECT data FROM entities WHERE id=$1" +
        (accountId ? " AND account_id=$2" : "") +
        (type ? ` AND type=$${accountId ? 3 : 2}` : ""),
      [id, ...(accountId ? [accountId] : []), ...(type ? [type] : [])],
    );
    return r.rows[0]?.data ?? null;
  }
  async put(value: Entity) {
    await this.query(
      "INSERT INTO entities(id,account_id,type,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",
      [value.id, value.accountId, value.type, JSON.stringify(value)],
    );
    return value;
  }
  async list(accountId: string, type: string) {
    return (
      await this.query(
        "SELECT data FROM entities WHERE account_id=$1 AND type=$2 ORDER BY data->>'createdAt' DESC",
        [accountId, type],
      )
    ).rows.map((r) => r.data) as Entity[];
  }
}
export class Database {
  private constructor(
    private local?: PGlite,
    private pool?: pg.Pool,
  ) {}
  static async open(path?: string, url?: string) {
    const db = url
      ? new Database(undefined, new pg.Pool({ connectionString: url, max: 10 }))
      : new Database(new PGlite(path));
    const sql = await readFile(
      new URL("../migrations/001_core.sql", import.meta.url),
      "utf8",
    );
    if (db.local) await db.local.exec(sql);
    else await db.pool!.query(sql);
    return db;
  }
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    if (this.local)
      return this.local.transaction((tx) =>
        fn(new Transaction((s, p) => tx.query(s, p))),
      );
    const client = await this.pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(7420891)");
      const result = await fn(new Transaction((s, p) => client.query(s, p)));
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async close() {
    if (this.local) await this.local.close();
    else await this.pool!.end();
  }
}
