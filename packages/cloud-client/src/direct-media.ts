import { AppError } from "../../contracts/src/index.js";

/** Signed storage URLs never receive the account's API token or arbitrary headers. */
export function directStorageUrl(raw: unknown): string {
  try {
    if (typeof raw !== "string" || raw.length > 16384) throw Error();
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) ||
      !url.searchParams.get("X-Amz-Signature")
    )
      throw Error();
    return url.toString();
  } catch {
    throw new AppError(
      "CLOUD_RESPONSE_INVALID",
      "Untrusted direct storage URL",
      502,
    );
  }
}
export async function directReferenceUpload(
  fetcher: typeof fetch,
  intent: { url: unknown; method?: unknown; headers?: unknown },
  bytes: Uint8Array,
  mime: string,
) {
  const url = directStorageUrl(intent.url);
  const headers = new Headers(intent.headers as HeadersInit);
  if (
    intent.method !== "PUT" ||
    headers.get("Content-Type") !== mime ||
    headers.get("If-None-Match") !== "*" ||
    [...headers.keys()].some(
      (key) => !["content-type", "if-none-match"].includes(key),
    )
  )
    throw new AppError(
      "CLOUD_RESPONSE_INVALID",
      "Invalid direct upload authorization",
      502,
    );
  const response = await fetcher(url, {
    method: "PUT",
    headers: { "Content-Type": mime, "If-None-Match": "*" },
    body: new Uint8Array(bytes),
    redirect: "error",
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new AppError("UPLOAD_FAILED", "Direct R2 upload failed", 502);
  await response.arrayBuffer();
}
