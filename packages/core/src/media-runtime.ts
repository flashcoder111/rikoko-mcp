import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaFailure, type MediaStage } from "./media-diagnostics.js";
const execute = promisify(execFile);

// Packet PTS avoids treating an audio tail (or a nominal final frame duration)
// as a video frame. This is a seek bound, not proof of decoded frame timing.
export async function lastInspectionVideoTime(
  source: string,
  signal: AbortSignal,
) {
  const { stdout } = await execute(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time:format=start_time",
      "-of",
      "json",
      source,
    ],
    { timeout: 10000, maxBuffer: 16 * 1024 * 1024, signal },
  );
  const data = JSON.parse(stdout);
  const start = Number(data.format?.start_time ?? 0);
  let last = -Infinity;
  for (const packet of data.packets ?? []) {
    const pts = Number(packet.pts_time);
    if (Number.isFinite(pts)) last = Math.max(last, pts);
  }
  if (!Number.isFinite(last) || !Number.isFinite(start) || last < start)
    throw new Error("No usable video timestamps");
  return Math.floor((last - start) * 1000);
}

export async function extractInspectionFrame(
  source: string,
  output: string,
  signal: AbortSignal,
  timeMs?: number,
) {
  await execute(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...(timeMs === undefined ? [] : ["-ss", String(timeMs / 1000)]),
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      source,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      "scale=640:640:force_original_aspect_ratio=decrease",
      output,
    ],
    { timeout: 20000, maxBuffer: 1024 * 1024, signal },
  );
}

export async function inspectionGray(source: string, signal: AbortSignal) {
  const result = await execute(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      source,
      "-vf",
      "scale=64:64,format=gray",
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 10000, maxBuffer: 1024 * 1024, signal },
  );
  if (result.stdout.length !== 64 * 64)
    throw new Error("Incomplete grayscale frame");
  return result.stdout;
}

// Runs on the backend, not the agent's shell. No uploads, asset registration,
// model calls or user files; verifies the same extraction path as media_inspect.
let pendingCheck: ReturnType<typeof runRuntimeCheck> | undefined;
export function mediaRuntimeCheck() {
  // Concurrent authorized diagnostic requests share only this synthetic check,
  // so they cannot fan out into an unbounded number of FFmpeg processes.
  pendingCheck ??= runRuntimeCheck().finally(() => {
    pendingCheck = undefined;
  });
  return pendingCheck;
}

async function runRuntimeCheck() {
  let dir: string | undefined;
  let stage: MediaStage = "temp_directory";
  try {
    dir = await mkdtemp(join(tmpdir(), "rikoko-media-check-"));
    const source = join(dir, "source");
    const frame = join(dir, "frame.png");
    stage = "source_write";
    await writeFile(
      source,
      Buffer.concat([
        Buffer.from("P6\n16 16\n255\n"),
        Buffer.alloc(16 * 16 * 3, 100),
      ]),
      { mode: 0o600 },
    );
    const signal = AbortSignal.timeout(35000);
    stage = "extract_frame";
    await extractInspectionFrame(source, frame, signal);
    stage = "read_frame";
    const bytes = await readFile(frame);
    if (
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw Error("Invalid PNG");
    stage = "gray_frame";
    await inspectionGray(frame, signal);
    return {
      ready: true,
      checks: [
        "temporary_file_io",
        "ffmpeg_extract_scale_png",
        "ffmpeg_gray_decode",
      ],
      boundary:
        "Synthetic image check on this backend only; does not verify user media codecs, asset storage, host pixel visibility or delivery.",
      paidTestExecuted: false,
    };
  } catch (error) {
    throw mediaFailure(error, stage);
  } finally {
    if (dir)
      await rm(dir, { recursive: true, force: true }).catch(() => {
        console.error("rikoko media runtime check: temporary cleanup failed");
      });
  }
}
