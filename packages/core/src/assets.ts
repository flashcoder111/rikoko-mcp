import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, type Context } from "../../contracts/src/index.js";
import { Service, fingerprint } from "./index.js";
import {
  isTikTokUrl,
  normalizeTikTokUrl,
  urlImportSchema,
} from "../../contracts/src/asset-import.js";
import {
  downloadTikTok,
  type DownloadPhase,
} from "../../storage/src/tiktok.js";
import type { Operation } from "../../contracts/src/index.js";
import { media, probeSchema } from "../../render/src/media.js";
import { sha256 } from "../../storage/src/index.js";
import { downloadPublic } from "../../storage/src/download.js";
export function mimeFor(metadata: {
  kind: string;
  codec: string;
  container?: string;
}) {
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
  return metadata.container === "webm"
    ? "video/webm"
    : metadata.container === "mov"
      ? "video/quicktime"
      : metadata.container === "other"
        ? "application/octet-stream"
        : "video/mp4";
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
  input: {
    url: string;
    name: string;
    license?: string;
    rightsConfirmed?: true;
    idempotencyKey?: string;
  },
) {
  if (!c.scopes.includes("write") && !c.scopes.includes("admin"))
    throw new AppError("FORBIDDEN", "Write scope required", 403);
  const data = urlImportSchema.parse(input);
  if (isTikTokUrl(data.url)) {
    let url: string;
    try {
      url = normalizeTikTokUrl(data.url);
    } catch {
      throw new AppError(
        "UNSUPPORTED_VIDEO_URL",
        "请提供一个 TikTok 短视频或分享链接，主页、直播和图集暂不支持。",
      );
    }
    const operation = {
      kind: "import_video" as const,
      url,
      name: data.name,
      license: data.license,
      rightsConfirmed: data.rightsConfirmed,
    };
    const hash = fingerprint(operation);
    const previous = await service.scoped(
      c,
      "write",
      async (tx) =>
        (await tx.list(c.accountId, "job"))
          .filter((job) => job.inputHash === hash)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    );
    if (!service.localVideoDownloads)
      throw new AppError(
        "CAPABILITY_UNAVAILABLE",
        "TikTok 下载需要用户本机的 rikoko 服务和本地素材库。",
        409,
      );
    if (
      !data.idempotencyKey &&
      previous &&
      ["queued", "running", "completed"].includes(previous.status)
    )
      return previous;
    const quote = await service.quote(c, operation);
    return service.submit(c, {
      quoteId: quote.id,
      input: operation,
      idempotencyKey:
        data.idempotencyKey ??
        `tiktok:${hash}${previous ? `:${previous.id}` : ""}`,
    });
  }
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

export async function importTikTokVideo(
  service: Service,
  accountId: string,
  input: Extract<Operation, { kind: "import_video" }>,
  work: string,
  jobId: string,
  signal: AbortSignal,
  onPhase: (phase: DownloadPhase) => Promise<void>,
) {
  if (!service.localVideoDownloads)
    throw new AppError(
      "CAPABILITY_UNAVAILABLE",
      "TikTok 下载需要用户本机的 rikoko 服务和本地素材库。",
      409,
    );
  const result = await downloadTikTok(input.url, work, { signal, onPhase });
  const metadata = probeSchema.parse(
    (await media({ command: "probe", path: result.path }, signal)).metadata,
  );
  if (metadata.kind !== "video" || metadata.durationMs <= 0)
    throw new AppError("INVALID_MEDIA", "下载结果不是有效的视频。");
  if (signal.aborted) throw new AppError("CANCELLED", "下载已取消。");
  const asset = await service.registerAsset(
    accountId,
    await readFile(result.path),
    {
      name: input.name,
      kind: "video",
      mime: mimeFor(metadata),
      metadata,
      jobId,
      provenance: {
        source: input.url,
        platform: "tiktok",
        videoId: result.videoId,
        downloaderVersion: result.downloaderVersion,
        license: input.license,
        rightsConfirmed: input.rightsConfirmed,
        evidence: "local-download",
      },
    },
  );
  return asset;
}
