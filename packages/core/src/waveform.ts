import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AppError, idSchema, type Context } from "../../contracts/src/index.js";
import { media } from "../../render/src/media.js";
import type { Service } from "./index.js";

export const waveformInput = z
  .object({
    assetId: idSchema,
    startMs: z.number().int().min(0).max(3_600_000).default(0),
    durationMs: z.number().int().min(100).max(600_000).default(60_000),
    bins: z.number().int().min(16).max(1024).default(256),
  })
  .strict();
const resultSchema = z.object({
  schemaVersion: z.literal(1),
  startMs: z.number(),
  durationMs: z.number(),
  peaks: z.array(z.number().min(0).max(1)).max(1024),
  evidence: z.literal("local-real"),
});
type Result = z.infer<typeof resultSchema>;
const caches = new WeakMap<Service, Map<string, Result>>();
let active = 0;

export async function assetWaveform(
  service: Service,
  context: Context,
  raw: unknown,
): Promise<Result> {
  const input = waveformInput.parse(raw);
  // Authorize every request, including cache hits; no paths accepted from callers.
  const asset = await service.get(context, "asset", input.assetId);
  if (!asset.metadata?.hasAudio || input.startMs >= asset.metadata.durationMs)
    throw new AppError(
      "INVALID_MEDIA",
      "素材没有音轨，或波形起点超出素材长度。",
    );
  let cache = caches.get(service);
  if (!cache) {
    cache = new Map();
    caches.set(service, cache);
  }
  const key = JSON.stringify([context.accountId, asset.sha256, input]);
  const cached = cache.get(key);
  if (cached) return cached;
  if (active >= 2)
    throw new AppError("MEDIA_BUSY", "波形正在处理中，请稍后重试。", 429);
  active++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "workbench-wave-"));
    const path = join(directory, "source");
    await writeFile(path, await service.storage.read(asset.storageKey), {
      mode: 0o600,
    });
    const result = resultSchema.parse(
      await media(
        { command: "waveform", path, ...input },
        AbortSignal.timeout(65_000),
      ),
    );
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    return result;
  } finally {
    active--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
