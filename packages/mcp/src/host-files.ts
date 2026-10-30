import { constants } from "node:fs";
import { mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, idSchema } from "../../contracts/src/index.js";
import { sha256 } from "../../storage/src/index.js";
import type { HostConnection } from "./host-connection.js";

const maxBytes = 100 * 1024 * 1024;
const exportMediaSchema = z.object({
  assetId: idSchema,
  url: z.string(),
  name: z.string(),
  mimeType: z.string(),
});
export type DeliveredMedia = z.infer<typeof exportMediaSchema> & {
  localPath?: string;
};
const extension: Record<string, string> = {
  "video/mp4": ".mp4",
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "text/plain": ".txt",
  "application/x-subrip": ".srt",
};
export const importFileSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1).max(160).optional(),
    license: z.string().min(1).max(500).default("user-provided"),
    rightsConfirmed: z.literal(true).optional(),
  })
  .strict();

export async function allowedMediaPath(path: string, roots: string[]) {
  if (!isAbsolute(path))
    throw new AppError("INVALID_INPUT", "Use an absolute media file path.");
  if (roots.some((root) => !isAbsolute(root)))
    throw new AppError(
      "INVALID_INPUT",
      "Configure absolute media import directories in VIDEOWORKBENCH_IMPORT_ROOTS, then reload the host's MCP connection.",
    );
  const actual = await realpath(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    throw new AppError(
      "NOT_FOUND",
      "This media attachment is no longer available at that path. Attach it again or copy it into a configured import directory and retry with its current absolute path.",
      404,
    );
  });
  const permitted = await Promise.all(
    roots.map(async (root) => {
      try {
        return await realpath(root);
      } catch (error) {
        // A host may not have created its attachment directory yet. Do not
        // prevent imports from other roots, or implicitly allow the missing one.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }),
  );
  if (
    !permitted.some((root) => {
      if (root === null) return false;
      const rest = relative(root, actual);
      return (
        rest &&
        !isAbsolute(rest) &&
        rest !== ".." &&
        !rest.startsWith(`..${sep}`)
      );
    })
  )
    throw new AppError(
      "FORBIDDEN",
      "This file is outside the configured media import directories. " +
        `Configured directories: ${JSON.stringify(roots)}. ` +
        "Copy the selected media into an available directory above and retry with that path, or have the operator add its dedicated attachment directory to VIDEOWORKBENCH_IMPORT_ROOTS and reload the host's MCP connection. Do not add the entire home directory or retry the same rejected path unchanged.",
      403,
    );
  if (
    !/\.(mp4|mov|webm|png|jpe?g|webp|wav|mp3|m4a|aac|ogg|flac)$/i.test(actual)
  )
    throw new AppError(
      "INVALID_INPUT",
      "Only supported image, video and audio files can be imported.",
    );
  return actual;
}

export class HostFiles {
  constructor(
    readonly connection: HostConnection,
    readonly outputDir: string,
    readonly importRoots: string[],
  ) {
    if (!isAbsolute(outputDir))
      throw new Error("Export directory must be absolute.");
  }
  async importFile(input: z.infer<typeof importFileSchema>) {
    const data = importFileSchema.parse(input);
    const path = await allowedMediaPath(data.path, this.importRoots);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes)
        throw new AppError(
          "INVALID_INPUT",
          "Media must be a regular file under 100 MiB.",
        );
      const bytes = await file.readFile();
      if (bytes.byteLength > maxBytes)
        throw new AppError("INVALID_INPUT", "Media exceeds 100 MiB.");
      const intent = (await this.connection.invoke("upload_create", {
        name: data.name ?? basename(path),
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        source: "host-attachment",
        license: data.license,
        ...(input.rightsConfirmed ? { rightsConfirmed: true } : {}),
      })) as { id: string };
      const uploadId = idSchema.parse(intent.id);
      const response = await this.connection.request(
        `/api/uploads/${uploadId}`,
        { method: "PUT", body: new Uint8Array(bytes) },
      );
      return ((await response.json()) as { result: unknown }).result;
    } finally {
      await file.close();
    }
  }
  async materialize(jobId: string, input: unknown) {
    idSchema.parse(jobId);
    const media = z.array(exportMediaSchema).max(20).parse(input);
    await mkdir(this.outputDir, { recursive: true, mode: 0o700 });
    const root = await realpath(this.outputDir);
    const delivered: DeliveredMedia[] = [];
    for (const item of media) {
      // A render without captions has a legitimate zero-byte SRT output.
      // Empty binary media must still fail instead of appearing delivered.
      const emptySubtitleAllowed =
        item.mimeType === "application/x-subrip" ||
        (item.mimeType === "text/plain" && /\.srt$/i.test(item.name));
      const suffix =
        item.mimeType === "text/plain" && /\.srt$/i.test(item.name)
          ? ".srt"
          : (extension[item.mimeType] ?? ".bin");
      const path = join(root, `${jobId}-${item.assetId}${suffix}`);
      const tmp = `${path}.${randomUUID()}.tmp`;
      const response = await this.connection.request(
        `/api/assets/${item.assetId}/file`,
      );
      if (Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        throw new AppError(
          "MEDIA_TOO_LARGE",
          "Native attachment exceeds 100 MiB; use its media URL.",
        );
      }
      const handle = await open(tmp, "wx", 0o600);
      try {
        let size = 0;
        if (!response.body && !emptySubtitleAllowed)
          throw Error("Empty media response");
        for await (const chunk of response.body ?? []) {
          size += chunk.byteLength;
          if (size > maxBytes)
            throw new AppError(
              "MEDIA_TOO_LARGE",
              "Native attachment exceeds 100 MiB; use its media URL.",
            );
          await handle.writeFile(chunk);
        }
        if (!size && !emptySubtitleAllowed) throw Error("Empty media response");
        await handle.close();
        await rename(tmp, path);
      } catch (error) {
        await handle.close();
        await rm(tmp, { force: true });
        throw error;
      }
      delivered.push({ ...item, localPath: path });
    }
    return delivered;
  }
}
