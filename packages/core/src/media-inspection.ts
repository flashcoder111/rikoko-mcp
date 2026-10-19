import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, idSchema, type Context } from "../../contracts/src/index.js";
import { sha256 } from "../../storage/src/index.js";
import type { Service } from "./index.js";
const execute = promisify(execFile);
let active = 0;
export const inspectSchema = z
  .object({
    assetId: idSchema,
    startMs: z.number().int().min(0).default(0),
    endMs: z.number().int().positive().optional(),
    count: z.number().int().min(1).max(12).optional(),
    timesMs: z.array(z.number().int().min(0)).min(1).max(12).optional(),
    layout: z.enum(["frames", "grid"]).default("frames"),
    claimedStatic: z.boolean().default(false),
  })
  .strict()
  .refine(
    (input) => !(input.timesMs && input.count !== undefined),
    "Use timesMs for event samples or count for uniform samples, not both",
  )
  .refine(
    (input) =>
      !input.timesMs ||
      input.timesMs.every((t, i, values) => i === 0 || t > values[i - 1]),
    "timesMs must contain unique timestamps in ascending order",
  );
export async function inspectMedia(service: Service, c: Context, raw: unknown) {
  const input = inspectSchema.parse(raw);
  await service.scoped(c, "write", async () => {});
  const asset = await service.get(c, "asset", input.assetId);
  if (
    !["image", "video"].includes(asset.kind) ||
    asset.bytes > 100 * 1024 * 1024
  )
    throw new AppError(
      "INVALID_MEDIA",
      "Inspect an owned image/video up to 100 MiB",
    );
  const endMs =
    input.endMs ?? (asset.kind === "video" ? asset.metadata?.durationMs : 1);
  if (
    !Number.isSafeInteger(endMs) ||
    endMs <= input.startMs ||
    (asset.kind === "video" && endMs > asset.metadata?.durationMs) ||
    (asset.kind === "image" && (input.startMs !== 0 || endMs !== 1))
  )
    throw new AppError(
      "INVALID_INTERVAL",
      "Inspection range must be within the probed media",
    );
  if (
    input.timesMs &&
    (asset.kind !== "video" ||
      input.timesMs.some((time) => time < input.startMs || time >= endMs))
  )
    throw new AppError(
      "INVALID_INTERVAL",
      "Requested event timestamps must lie inside the inspected video range",
    );
  const count =
    asset.kind === "image" ? 1 : (input.timesMs?.length ?? input.count ?? 3);
  if (input.claimedStatic && (asset.kind !== "video" || count < 3))
    throw new AppError(
      "INVALID_INPUT",
      "Static cross-check requires at least three video samples",
    );
  if (active >= 2)
    throw new AppError(
      "MEDIA_BUSY",
      "Two inspections are running; retry this inspection later",
      429,
    );
  active++;
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "rikoko-inspect-"));
    const path = join(dir, "source");
    const bytes = await service.storage.read(asset.storageKey);
    if (sha256(bytes) !== asset.sha256 || bytes.byteLength !== asset.bytes)
      throw new AppError("SOURCE_MISMATCH", "Source bytes changed");
    await writeFile(path, bytes, { mode: 0o600 });
    const frames: {
      assetId: string;
      sourceTimeMs: number;
      requestedTimeMs: number;
      timeBasis: "requested";
      sha256: string;
      image: { data: string; mimeType: string };
    }[] = [];
    const gray: Buffer[] = [];
    // Endpoints are requested source positions, not claims of frame-exact model timing.
    const last = Math.max(
      input.startMs,
      endMs -
        Math.min(
          100,
          Math.max(1, Math.round(1000 / (asset.metadata?.fps || 25))),
        ),
    );
    const signal = AbortSignal.timeout(55000);
    for (let i = 0; i < count; i++) {
      const timeMs =
        input.timesMs?.[i] ??
        (count === 1
          ? input.startMs
          : Math.round(
              input.startMs + ((last - input.startMs) * i) / (count - 1),
            ));
      const output = join(dir, `frame-${i}.png`);
      const args = [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...(asset.kind === "video" ? ["-ss", String(timeMs / 1000)] : []),
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        path,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
      ];
      await execute(
        "ffmpeg",
        [
          ...args,
          "-vf",
          "scale=640:640:force_original_aspect_ratio=decrease",
          output,
        ],
        { timeout: 20000, maxBuffer: 1024 * 1024, signal },
      );
      const frameBytes = await readFile(output);
      if (frameBytes.length > 2 * 1024 * 1024)
        throw new AppError(
          "MEDIA_TOO_LARGE",
          "Inspection image exceeds output limit",
        );
      const frame = await service.registerAsset(c.accountId, frameBytes, {
        name: `inspect-${asset.id}-${timeMs}.png`,
        kind: "image",
        mime: "image/png",
        metadata: {
          kind: "image",
          width: frameBytes.readUInt32BE(16),
          height: frameBytes.readUInt32BE(20),
          durationMs: 0,
          fps: 0,
          hasAudio: false,
          codec: "png",
          sampleRate: null,
        },
        provenance: {
          evidence: "local-real",
          source: "media-inspect",
          sourceAssetId: asset.id,
          sourceSha256: asset.sha256,
          requestedTimeMs: timeMs,
        },
      });
      frames.push({
        assetId: frame.id,
        sourceTimeMs: timeMs,
        requestedTimeMs: timeMs,
        timeBasis: "requested" as const,
        sha256: frame.sha256,
        image: { data: frameBytes.toString("base64"), mimeType: "image/png" },
      });
      const rawFrame = await execute(
        "ffmpeg",
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          output,
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
      gray.push(rawFrame.stdout);
    }
    const differences = gray
      .slice(1)
      .map(
        (b, i) =>
          b.reduce((sum, v, j) => sum + Math.abs(v - gray[i][j]), 0) /
          b.length /
          255,
      );
    const maxDifference = Math.max(0, ...differences);
    const changedFractions = gray
      .slice(1)
      .map(
        (b, i) =>
          b.reduce(
            (sum, value, j) =>
              sum + (Math.abs(value - gray[i][j]) >= 12 ? 1 : 0),
            0,
          ) / b.length,
      );
    const maxChangedFraction = Math.max(0, ...changedFractions);
    const warnings =
      input.claimedStatic && (maxDifference > 0.03 || maxChangedFraction > 0.03)
        ? [
            {
              code: "STATIC_CLAIM_CONTRADICTED",
              message:
                "Sampled frames visibly differ. The host must inspect the images before accepting the static claim.",
            },
          ]
        : [];
    const samplingBoundaries = [
      input.startMs,
      ...frames.map((frame) => frame.requestedTimeMs),
      endMs,
    ];
    const record = {
      schemaVersion: 2,
      id: randomUUID(),
      type: "media-inspection",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      assetId: asset.id,
      sourceSha256: asset.sha256,
      range: { startMs: input.startMs, endMs },
      frames: frames.map(({ image: _image, ...f }) => f),
      sampling: {
        strategy: input.timesMs ? "timestamps" : "uniform",
        continuous: false,
        timeBasis: "requested",
        // sourceTimeMs remains a compatibility alias, not a decoded-frame PTS.
        requestedTimesMs: frames.map((frame) => frame.requestedTimeMs),
        maxSampleGapMs: Math.max(
          0,
          ...samplingBoundaries
            .slice(1)
            .map((time, i) => time - samplingBoundaries[i]),
        ),
      },
      sampleDifference: {
        max: maxDifference,
        values: differences,
        threshold: 0.03,
        changedFractions,
        maxChangedFraction,
        pixelDeltaThreshold: 12,
        changedFractionThreshold: 0.03,
      },
      warnings,
    };
    await service.scoped(c, "write", (tx) => tx.put(record));
    let grid: { data: string; mimeType: string } | undefined;
    if (input.layout === "grid") {
      const output = join(dir, "grid.png");
      await execute(
        "ffmpeg",
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-framerate",
          "1",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          join(dir, "frame-%d.png"),
          "-vf",
          `scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2,tile=${Math.min(3, count)}x${Math.ceil(count / 3)}:nb_frames=${count}`,
          "-frames:v",
          "1",
          output,
        ],
        { timeout: 15000, maxBuffer: 1024 * 1024, signal },
      );
      grid = {
        data: (await readFile(output)).toString("base64"),
        mimeType: "image/png",
      };
    }
    return {
      ...record,
      frames: frames.map(({ image, ...f }) => ({
        ...f,
        ...(grid ? {} : { image }),
      })),
      ...(grid ? { grid } : {}),
      evidenceBoundary:
        "Sampled local pixels, ordered left-to-right then top-to-bottom. sourceTimeMs/requestedTimeMs are requested seek positions, not verified decoded-frame timestamps. Unsampled intervals remain unobserved. Small frame differences do not prove a whole interval is static. The host performs visual judgment.",
      guidance: [
        "Inspect the supplied pixels before recording a review; unknown is valid when this host cannot see them.",
        "For action completion, inspect each critical action interval with sample gaps at most 250 ms using timesMs or bounded count requests. Sample coverage does not establish semantic correctness.",
      ],
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "MEDIA_FAILED",
      "Local inspection failed or timed out; use fewer samples or a smaller source",
    );
  } finally {
    active--;
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
