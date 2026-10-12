import { openRuntime } from "../../server/src/runtime.js";
import { Worker } from "./worker.js";
import { startQueue } from "../../../packages/db/src/queue.js";
if (!process.env.DATABASE_URL)
  throw new Error(
    "Standalone worker requires DATABASE_URL; local embedded mode runs its worker inside the server.",
  );
const runtime = await openRuntime();
const worker = new Worker(runtime.service);
const stopQueue = await startQueue(process.env.DATABASE_URL, runtime.db, () =>
  worker.tick(),
);
const running = worker.loop();
async function shutdown() {
  worker.stop();
  await stopQueue();
  await running;
  await runtime.db.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
