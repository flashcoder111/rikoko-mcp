import { serve } from "@hono/node-server";
import { resolve, dirname } from "node:path";
import { assertUpgradeAccess } from "../../../packages/bootstrap/src/upgrade.js";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { openRuntime } from "./runtime.js";
import { createApp } from "./app.js";
import { Worker } from "../../worker/src/worker.js";
// Bind before opening PGlite: only one concurrent managed launcher can proceed.
await assertUpgradeAccess(
  dirname(resolve(process.env.DATA_DIR ?? ".data")),
  process.env.RIKOKO_UPGRADE_TOKEN,
);
let app: ReturnType<typeof createApp> | undefined;
let runtime: Awaited<ReturnType<typeof openRuntime>> | undefined;
let worker: Worker | undefined;
let running: Promise<void> | undefined;
const server = serve({
  fetch: (request) => {
    if (
      process.env.RIKOKO_UPGRADE_VERIFY === "1" &&
      new URL(request.url).pathname !== "/health" &&
      request.headers.get("x-rikoko-upgrade-token") !==
        process.env.RIKOKO_UPGRADE_TOKEN
    )
      return new Response("Upgrade verification in progress", { status: 503 });
    return app ? app.fetch(request) : new Response("Starting", { status: 503 });
  },
  hostname: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4310),
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  worker?.stop();
  const closed = new Promise<void>((done) => server.close(() => done()));
  await Promise.all([running, closed]);
  await runtime?.db.close();
  const pidFile = process.env.VIDEOWORKBENCH_PID_FILE;
  if (
    pidFile &&
    (await readFile(pidFile, "utf8").catch(() => "")).trim() ===
      String(process.pid)
  )
    await unlink(pidFile).catch(() => {});
  process.exit(0);
}
try {
  await new Promise<void>((yes, no) => {
    server.once("listening", yes);
    server.once("error", no);
  });
  runtime = await openRuntime();
  if (process.env.VIDEOWORKBENCH_PID_FILE)
    await writeFile(
      process.env.VIDEOWORKBENCH_PID_FILE,
      String(process.pid) + "\n",
      { mode: 0o600 },
    );
  app = createApp(runtime.service, {
    studioDir: resolve("apps/studio/dist"),
    allowedHosts: (
      process.env.ALLOWED_HOSTS ?? "localhost,127.0.0.1,[::1]"
    ).split(","),
    instanceId: process.env.VIDEOWORKBENCH_INSTANCE_ID,
  });
  worker = process.env.DATABASE_URL ? undefined : new Worker(runtime.service);
  running = worker?.loop();
  console.error(
    `rikoko: http://${process.env.HOST ?? "127.0.0.1"}:${(server.address() as { port: number }).port}`,
  );
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
} catch (error) {
  console.error(
    "rikoko startup failed:",
    (error as NodeJS.ErrnoException).code ?? "CONFIGURATION_ERROR",
  );
  server.close();
  await runtime?.db.close();
  process.exitCode = 1;
}
