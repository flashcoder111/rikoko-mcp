import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ sql: [] as string[], released: 0, ended: 0 }));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      async query(sql: string) {
        mock.sql.push(sql);
        return { rows: [] };
      }
      async connect() {
        return {
          query: async (sql: string) => {
            mock.sql.push(sql);
            return { rows: [{ value: 42 }] };
          },
          release: () => {
            mock.released++;
          },
        };
      }
      async end() {
        mock.ended++;
      }
    },
  },
}));
import { Database } from "../packages/db/src/index.js";
it("holds a transaction lock, commits success and rolls back failure on the PG connector", async () => {
  const db = await Database.open(undefined, "postgresql://contract-mock");
  const result = await db.transaction(
    async (tx) => (await tx.query("SELECT 42")).rows[0].value,
  );
  expect(result).toBe(42);
  await expect(
    db.transaction(async () => {
      throw Error("failure");
    }),
  ).rejects.toThrow("failure");
  expect(mock.sql).toContain("COMMIT");
  expect(mock.sql).toContain("ROLLBACK");
  expect(mock.sql).toContain("SELECT pg_advisory_xact_lock(7420891)");
  expect(mock.released).toBe(2);
  await db.close();
  expect(mock.ended).toBe(1);
});
