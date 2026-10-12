import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, type Context } from "../../contracts/src/index.js";
import { Service } from "./index.js";
import { media, probeSchema } from "../../render/src/media.js";
import { sha256 } from "../../storage/src/index.js";
import { downloadPublic } from "../../storage/src/download.js";
export function mimeFor(metadata: { kind: string; codec: string }) {
  if (metadata.kind === "image")
    return metadata.codec === "mjpeg"
      ? "image/jpeg"
      : metadata.codec === "webp"
        ? "image/webp"
        : "image/png";
  if (metadata.kind === "audio")
    return metadata.codec === "mp3"
      ? "audio/mpeg"
      : metadata.codec === "aac"
        ? "audio/mp4"
        : "audio/wav";
  return "video/mp4";
}
export async function completeUpload(
  service: Service,
  c: Context,
  uploadId: string,
  bytes: Uint8Array,
) {
  const intent = await service.get(c, "upload", uploadId);
  if (intent.status === "complete")
    return service.get(c, "asset", intent.assetId);
  if (!c.scopes.includes("write") && !c.scopes.includes("admin"))
    throw new AppError("FORBIDDEN", "Write scope required", 403);
  if (Date.parse(intent.expiresAt) < Date.now())
    throw new AppError("UPLOAD_EXPIRED", "Upload intent expired");
  if (bytes.byteLength !== intent.bytes || sha256(bytes) !== intent.sha256)
    throw new AppError("UPLOAD_MISMATCH", "Upload length or SHA256 mismatch");
  const dir = await mkdtemp(join(tmpdir(), "video-upload-"));
  try {
    const path = join(dir, "input");
    await writeFile(path, bytes);
    const metadata = probeSchema.parse(
      (await media({ command: "probe", path })).metadata,
    );
    const asset = await service.registerAsset(c.accountId, bytes, {
      name: intent.name,
      kind: metadata.kind,
      mime: mimeFor(metadata),
      metadata,
      provenance: {
        source: intent.source,
        license: intent.license,
        rightsConfirmed: true,
        evidence: "user-upload",
      },
    });
    await service.db.transaction(async (tx) => {
      const current = await tx.get(uploadId, c.accountId, "upload");
      if (!current) throw new AppError("NOT_FOUND", "Upload not found", 404);
      await tx.put({ ...current, status: "complete", assetId: asset.id });
    });
    return asset;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function importUrl(
  service: Service,
  c: Context,
  input: { url: string; name: string; license: string; rightsConfirmed: true },
) {
  if (!c.scopes.includes("write") && !c.scopes.includes("admin"))
    throw new AppError("FORBIDDEN", "Write scope required", 403);
  const bytes = await downloadPublic(input.url);
  const intent = await service.createUpload(c, {
    name: input.name,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    source: input.url,
    license: input.license,
    rightsConfirmed: input.rightsConfirmed,
  });
  return completeUpload(service, c, intent.id, bytes);
}
