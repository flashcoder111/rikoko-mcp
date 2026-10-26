import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AppError, idSchema, type Context } from "../../contracts/src/index.js";
import { sha256 } from "../../storage/src/index.js";
import { media, probeSchema } from "../../render/src/media.js";
import { fingerprint, type Service } from "./index.js";

const execute = promisify(execFile);
export const mediaCropSchema = z
  .object({
    assetId: idSchema,
    rect: z
      .object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().min(16).max(6000),
        height: z.number().int().min(16).max(6000),
      })
      .strict(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
let active = 0;

/** Local deterministic pixels only. Cropping neither removes all background nor certifies identity. */
export async function cropMedia(service: Service, c: Context, raw: unknown) {
  const input = mediaCropSchema.parse(raw);
  await service.scoped(c, "write", async () => {});
  const source = await service.get(c, "asset", input.assetId);
  const { x, y, width, height } = input.rect;
  const sw = source.metadata?.width,
    sh = source.metadata?.height;
  if (
    source.kind !== "image" ||
    !["image/png", "image/jpeg", "image/webp"].includes(source.mime) ||
    source.bytes > 30 * 1024 * 1024 ||
    !Number.isSafeInteger(sw) ||
    !Number.isSafeInteger(sh) ||
    sw <= 0 ||
    sh <= 0 ||
    sw * sh > 36000000
  )
    throw new AppError(
      "INVALID_MEDIA",
      "Crop a probed PNG/JPEG/WebP image up to 30 MiB and 36 megapixels",
    );
  if (x + width > sw || y + height > sh || (width === sw && height === sh))
    throw new AppError(
      "INVALID_CROP",
      "Use a smaller rectangle fully inside the inspected image",
    );
  const bytes = await service.storage.read(source.storageKey);
  if (sha256(bytes) !== source.sha256 || bytes.byteLength !== source.bytes)
    throw new AppError("SOURCE_MISMATCH", "Source bytes changed");
  const derivationId = `crop-${fingerprint([source.id, source.sha256, input.rect, 1])}`;
  const cached = await service.scoped(c, "read", (tx) =>
    tx.get(derivationId, c.accountId, "media-derivation"),
  );
  const result = (asset: any) => ({
    assetId: asset.id,
    sha256: asset.sha256,
    metadata: asset.metadata,
    sourceAssetId: source.id,
    sourceSha256: source.sha256,
    rect: input.rect,
    derivationId,
    visualAcceptance: "unreviewed",
    instruction:
      "Inspect this output before using it. Only pixels outside the rectangle were removed; background inside it remains.",
  });
  if (cached) {
    const asset = await service.get(c, "asset", cached.assetId);
    if (
      asset.sha256 !== cached.sha256 ||
      asset.metadata?.width !== width ||
      asset.metadata?.height !== height ||
      sha256(await service.storage.read(asset.storageKey)) !== cached.sha256
    )
      throw new AppError("SOURCE_MISMATCH", "Prepared crop bytes changed");
    return result(asset);
  }
  if (active >= 2)
    throw new AppError("MEDIA_BUSY", "Two media crops are running", 429);
  active++;
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "rikoko-crop-"));
    const path = join(dir, "source"),
      output = join(dir, "crop.png");
    await writeFile(path, bytes, { mode: 0o600 });
    await execute(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        path,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        `format=rgba,crop=${width}:${height}:${x}:${y}:exact=1`,
        output,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    const cropped = await readFile(output);
    if (cropped.byteLength > 30 * 1024 * 1024)
      throw new AppError("MEDIA_TOO_LARGE", "Crop output exceeds 30 MiB");
    const metadata = probeSchema.parse(
      (
        await media(
          { command: "probe", path: output },
          AbortSignal.timeout(15000),
        )
      ).metadata,
    );
    if (metadata.width !== width || metadata.height !== height)
      throw new AppError(
        "INVALID_CROP",
        "Decoded crop dimensions differ from the requested rectangle",
      );
    const asset = await service.registerAsset(c.accountId, cropped, {
      name: "prepared-reference.png",
      kind: "image",
      mime: "image/png",
      metadata,
      provenance: {
        source: "image-crop",
        sourceAssetId: source.id,
        sourceSha256: source.sha256,
        rect: input.rect,
        reason: input.reason,
      },
    });
    await service.scoped(c, "write", (tx) =>
      tx.put({
        id: derivationId,
        type: "media-derivation",
        accountId: c.accountId,
        createdAt: new Date().toISOString(),
        operation: "crop",
        assetId: asset.id,
        sha256: asset.sha256,
        sourceAssetId: source.id,
        sourceSha256: source.sha256,
        rect: input.rect,
        reason: input.reason,
      }),
    );
    return result(asset);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "MEDIA_FAILED",
      "Image cropping failed; no generation was submitted",
    );
  } finally {
    active--;
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
