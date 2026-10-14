import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type z } from "zod";
import { timingSchema } from "../../contracts/src/reference-analysis.js";

const execute = promisify(execFile);
/** Visual discontinuities are measured candidates, not semantic shot boundaries. */
export async function referenceTiming(
  path: string,
  durationMs: number,
  signal?: AbortSignal,
): Promise<z.infer<typeof timingSchema>> {
  const base = { method: "ffmpeg-scene-difference" as const, threshold: 0.3 };
  try {
    const { stderr } = await execute(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-i",
        path,
        "-an",
        "-vf",
        "scale=320:-2,select='gt(scene,0.3)',showinfo",
        "-fps_mode",
        "vfr",
        "-f",
        "null",
        "-",
      ],
      { timeout: 45000, maxBuffer: 2 * 1024 * 1024, signal },
    );
    const cutTimesMs = [
      ...new Set(
        [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) =>
          Math.round(Number(m[1]) * 1000),
        ),
      ),
    ]
      .filter((t) => t > 0 && t < durationMs)
      .sort((a, b) => a - b);
    if (cutTimesMs.length > 2000) throw Error("Too many cuts");
    return { ...base, status: "measured", cutTimesMs };
  } catch {
    return {
      ...base,
      status: "unavailable",
      cutTimesMs: [],
      reason:
        "Local cut detection failed or timed out; model timestamps remain estimates.",
    };
  }
}
