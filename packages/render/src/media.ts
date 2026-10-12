import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { AppError } from "../../contracts/src/index.js";
export const probeSchema = z.object({
  kind: z.enum(["image", "video", "audio"]),
  fps: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  hasAudio: z.boolean(),
  codec: z.string(),
  sampleRate: z.number().nullable(),
});
export async function media(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  const root = process.env.WORKBENCH_ROOT ?? process.cwd();
  const venv = resolve(root, "python/.venv/bin/python");
  const python =
    process.env.MEDIA_PYTHON ?? (existsSync(venv) ? venv : "python3");
  return new Promise((accept, reject) => {
    if (signal?.aborted) {
      reject(new AppError("CANCELLED", "Media execution cancelled"));
      return;
    }
    const child = spawn(python, [resolve(root, "python/media_core/cli.py")], {
      cwd: root,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let out = "",
      err = "";
    let stopped = false;
    const stop = () => {
      stopped = true;
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {}
    };
    const timeout = setTimeout(stop, 600000);
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (v) => {
      out += v;
      if (out.length > 5_000_000) stop();
    });
    child.stderr.on("data", (v) => {
      err = (err + v).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", stop);
      if (stopped) {
        reject(
          new AppError(
            signal?.aborted ? "CANCELLED" : "MEDIA_TIMEOUT",
            "Media execution stopped",
          ),
        );
        return;
      }
      try {
        const r = JSON.parse(out);
        if (code || r.error)
          throw new AppError(
            r.code ?? "MEDIA_FAILED",
            String(r.error ?? "Media failed"),
          );
        if (r.schemaVersion !== 1)
          throw Error("Invalid media contract version");
        accept(r);
      } catch (e) {
        reject(
          e instanceof AppError
            ? e
            : new AppError(
                "MEDIA_FAILED",
                "Invalid response from media process; check Python dependencies",
              ),
        );
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}
