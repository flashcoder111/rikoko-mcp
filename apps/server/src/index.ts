import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { openRuntime } from "./runtime.js";
import { createApp } from "./app.js";
import { Worker } from "../../worker/src/worker.js";
// Bind before opening PGlite: only one concurrent managed launcher can proceed.
let app: ReturnType<typeof createApp> | undefined;
let runtime: Awaited<ReturnType<typeof openRuntime>> | undefined;
let worker: Worker | undefined;
let running: Promise<void> | undefined;
const server = serve({
  fetch: (request) =>
    app ? app.fetch(request) : new Response("Starting", { status: 503 }),
  hostname: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4310),
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  worker?.stop();
  server.close();
  await running;
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
    `Video Workbench: http://${process.env.HOST ?? "127.0.0.1"}:${(server.address() as { port: number }).port}`,
  );
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
} catch (error) {
  console.error(
    "Video Workbench startup failed:",
    (error as NodeJS.ErrnoException).code ?? "CONFIGURATION_ERROR",
  );
  server.close();
  await runtime?.db.close();
  process.exitCode = 1;
}
