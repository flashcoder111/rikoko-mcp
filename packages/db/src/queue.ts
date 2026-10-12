import { PgBoss } from "pg-boss";
import { Database } from "./index.js";
/** Transactional outbox: a crash between send and mark causes a harmless duplicate wakeup. */
export async function startQueue(
  url: string,
  db: Database,
  tick: () => Promise<boolean>,
) {
  const boss = new PgBoss({ connectionString: url });
  boss.on("error", () => console.error("Queue error"));
  await boss.start();
  await boss.createQueue("video-jobs");
  await boss.work("video-jobs", { localConcurrency: 1 }, async () => {
    await tick();
  });
  let flushing = false;
  const timer = setInterval(async () => {
    if (flushing) return;
    flushing = true;
    try {
      const rows = await db.transaction((tx) =>
        tx.query("SELECT job_id FROM outbox WHERE dispatched=false LIMIT 50"),
      );
      for (const row of rows.rows) {
        await boss.send(
          "video-jobs",
          { jobId: row.job_id },
          { singletonKey: row.job_id, retryLimit: 3 },
        );
        await db.transaction((tx) =>
          tx.query("UPDATE outbox SET dispatched=true WHERE job_id=$1", [
            row.job_id,
          ]),
        );
      }
    } catch {
      console.error("Outbox dispatch will retry");
    } finally {
      flushing = false;
    }
  }, 1000);
  return async () => {
    clearInterval(timer);
    await boss.stop();
  };
}
