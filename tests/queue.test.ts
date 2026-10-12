import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  sent: [] as string[],
  work: undefined as undefined | (() => Promise<void>),
  errors: undefined as undefined | (() => void),
}));
vi.mock("pg-boss", () => ({
  PgBoss: class {
    on(_name: string, fn: () => void) {
      state.errors = fn;
    }
    async start() {}
    async createQueue() {}
    async work(_n: string, _o: unknown, fn: () => Promise<void>) {
      state.work = fn;
    }
    async send(_name: string, data: any) {
      state.sent.push(data.jobId);
      return "id";
    }
    async stop() {}
  },
}));
import { startQueue } from "../packages/db/src/queue.js";
it("delivers the transactional outbox and marks it only after enqueue", async () => {
  vi.useFakeTimers();
  let dispatched = false;
  const db = {
    transaction: async (fn: any) =>
      fn({
        query: async (sql: string) => {
          if (sql.startsWith("SELECT"))
            return { rows: dispatched ? [] : [{ job_id: "job-1" }] };
          dispatched = true;
          return { rows: [] };
        },
      }),
  };
  const tick = vi.fn().mockResolvedValue(true);
  const stop = await startQueue("postgresql://contract-mock", db as any, tick);
  await vi.advanceTimersByTimeAsync(1001);
  expect(state.sent).toEqual(["job-1"]);
  expect(dispatched).toBe(true);
  await state.work!();
  expect(tick).toHaveBeenCalledTimes(1);
  await stop();
  vi.useRealTimers();
});
