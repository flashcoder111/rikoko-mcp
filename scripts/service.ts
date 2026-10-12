import { resolve } from "node:path";
import {
  ensureBackend,
  stopBackend,
} from "../packages/bootstrap/src/managed.ts";
const [action = "start", input = process.env.VIDEOWORKBENCH_MANAGED_CONFIG] =
  process.argv.slice(2);
if (!input || !["start", "restart", "stop"].includes(action))
  throw Error(
    "Usage: pnpm service <start|restart|stop> /absolute/path/installation.json",
  );
const file = resolve(input);
if (action === "stop" || action === "restart") await stopBackend(file);
if (action !== "stop")
  console.log(`Video Workbench: ${(await ensureBackend(file)).url}`);
