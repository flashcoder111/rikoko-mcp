import { directStorageUrl } from "./direct-media.js";
import { publicErrorSchema } from "../../contracts/src/error-contract.js";
import { AppError } from "../../contracts/src/index.js";
export function cloudOrigin(value: string) {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
    )
  )
    throw new Error(
      "Cloud URL must be an HTTPS origin (loopback HTTP allowed for development)",
    );
  return u.origin;
}
export async function cloudRequest(
  base: string,
  path: string,
  fetcher: typeof fetch,
  options: {
    key?: string;
    body?: unknown;
    etag?: string;
    bytes?: Uint8Array;
    binary?: boolean;
  } = {},
) {
  const response = await fetcher(cloudOrigin(base) + path, {
    method: options.bytes ? "PUT" : options.body === undefined ? "GET" : "POST",
    redirect: "error",
    signal: AbortSignal.timeout(
      options.bytes || options.binary ? 120000 : 30000,
    ),
    headers: {
      ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
      ...(options.etag ? { "If-None-Match": options.etag } : {}),
      "Content-Type": options.bytes
        ? "application/octet-stream"
        : "application/json",
    },
    body: options.bytes
      ? new Uint8Array(options.bytes)
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
  });
  if (response.status === 304) return { response, data: null };
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (reader) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > (options.binary && response.ok ? 100 : 8) * 1024 * 1024)
        throw new AppError("CLOUD_RESPONSE_TOO_LARGE", "云端响应超出限制", 502);
      chunks.push(next.value);
    }
  } finally {
    await reader?.cancel();
  }
  if (options.binary && response.ok) {
    if (
      size <= 32768 &&
      response.headers.get("content-type")?.includes("application/json")
    ) {
      let metadata: any;
      try {
        metadata = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw new AppError(
          "CLOUD_RESPONSE_INVALID",
          "Invalid result metadata",
          502,
        );
      }
      if (metadata?.delivery === "r2") {
        const url = directStorageUrl(metadata.url);
        const stored = await fetcher(url, {
          redirect: "error",
          signal: AbortSignal.timeout(180000),
        });
        if (
          !stored.ok ||
          !stored.headers.get("content-type")?.startsWith("video/")
        )
          throw new AppError("RESULT_UNAVAILABLE", "R2 video unavailable", 502);
        const body = stored.body?.getReader(),
          parts: Uint8Array[] = [];
        let count = 0;
        try {
          while (body) {
            const part = await body.read();
            if (part.done) break;
            count += part.value.byteLength;
            if (count > 100 * 1024 * 1024)
              throw new AppError(
                "CLOUD_RESPONSE_TOO_LARGE",
                "R2 video exceeds size limit",
                502,
              );
            parts.push(part.value);
          }
        } finally {
          await body?.cancel();
        }
        if (!count)
          throw new AppError("RESULT_UNAVAILABLE", "R2 video is empty", 502);
        return { response: stored, data: new Uint8Array(Buffer.concat(parts)) };
      }
    }
    return { response, data: new Uint8Array(Buffer.concat(chunks)) };
  }
  let data: any;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new AppError("CLOUD_RESPONSE_INVALID", "云端响应无效", 502);
  }
  if (!response.ok)
    throw new AppError(
      data.error?.code ?? "CLOUD_ERROR",
      data.error?.message ?? "云端请求失败",
      response.status,
      publicErrorSchema.shape.details.safeParse(data.error?.details).data,
    );
  return { response, data };
}
