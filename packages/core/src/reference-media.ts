import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, type Context } from "../../contracts/src/index.js";
import type { Service } from "./index.js";
import { media, probeSchema } from "../../render/src/media.js";
import { sha256 } from "../../storage/src/index.js";
const execute = promisify(execFile);

export async function extractReferenceMedia(
  service: Service,
  c: Context,
  assetId: string,
  selections: {
    sourceShotId: string;
    frameTimeMs: number;
    motionRange?: { startMs: number; endMs: number };
  }[],
) {
  await service.scoped(c, "write", async () => {});
  const source = await service.get(c, "asset", assetId);
  if (
    source.kind !== "video" ||
    !Number.isSafeInteger(source.metadata?.durationMs) ||
    source.metadata.durationMs <= 0 ||
    source.bytes > 100 * 1024 * 1024 ||
    !selections.length ||
    selections.length > 12
  )
    throw new AppError(
      "INVALID_MEDIA",
      "Extract at most 12 shots from a probed video up to 100 MiB",
    );
  for (const s of selections) {
    if (
      !Number.isSafeInteger(s.frameTimeMs) ||
      s.frameTimeMs < 0 ||
      s.frameTimeMs >= source.metadata.durationMs ||
      (s.motionRange &&
        (s.motionRange.startMs < 0 ||
          s.motionRange.endMs > source.metadata.durationMs ||
          s.motionRange.endMs <= s.motionRange.startMs ||
          s.motionRange.endMs - s.motionRange.startMs > 15000))
    )
      throw new AppError(
        "INVALID_INTERVAL",
        "Frame or motion reference exceeds its source interval (motion maximum 15 seconds)",
      );
  }
  const dir = await mkdtemp(join(tmpdir(), "rikoko-reference-"));
  try {
    const path = join(dir, "source");
    const bytes = await service.storage.read(source.storageKey);
    if (sha256(bytes) !== source.sha256 || bytes.byteLength !== source.bytes)
      throw new AppError("SOURCE_MISMATCH", "Source bytes changed");
    await writeFile(path, bytes, { mode: 0o600 });
    const results = [];
    for (let i = 0; i < selections.length; i++) {
      const s = selections[i];
      const common = { sourceAssetId: source.id, sourceSha256: source.sha256 };
      const run = async (clip: boolean) => {
        const output = join(dir, `${i}.${clip ? "mp4" : "png"}`);
        const scale =
          "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
        try {
          await execute(
            "ffmpeg",
            [
              "-nostdin",
              "-hide_banner",
              "-loglevel",
              "error",
              "-y",
              "-ss",
              String((clip ? s.motionRange!.startMs : s.frameTimeMs) / 1000),
              "-i",
              path,
              ...(clip
                ? [
                    "-t",
                    String(
                      (s.motionRange!.endMs - s.motionRange!.startMs) / 1000,
                    ),
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a?",
                    "-vf",
                    scale,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-crf",
                    "18",
                    "-c:a",
                    "aac",
                    "-movflags",
                    "+faststart",
                  ]
                : ["-map", "0:v:0", "-frames:v", "1", "-vf", scale]),
              output,
            ],
            { timeout: 45000, maxBuffer: 1024 * 1024 },
          );
        } catch {
          throw new AppError(
            "MEDIA_FAILED",
            "Reference extraction failed or timed out; no paid generation was started",
          );
        }
        const metadata = probeSchema.parse(
          (await media({ command: "probe", path: output })).metadata,
        );
        const asset = await service.registerAsset(
          c.accountId,
          await readFile(output),
          {
            name: `${s.sourceShotId}-${clip ? "motion.mp4" : "frame.png"}`,
            kind: clip ? "video" : "image",
            mime: clip ? "video/mp4" : "image/png",
            metadata,
            provenance: {
              ...common,
              evidence: "local-real",
              source: "reference-extraction",
              license: source.provenance?.license ?? "user-controlled",
              ...(clip
                ? { requestedRange: s.motionRange }
                : { requestedTimeMs: s.frameTimeMs }),
            },
          },
        );
        return {
          ...common,
          assetId: asset.id,
          ...(clip
            ? { requestedRange: s.motionRange }
            : { requestedTimeMs: s.frameTimeMs }),
        };
      };
      results.push({
        sourceShotId: s.sourceShotId,
        frame: await run(false),
        ...(s.motionRange ? { motion: await run(true) } : {}),
      });
    }
    return results;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
