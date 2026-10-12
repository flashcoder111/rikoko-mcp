import { randomBytes } from "node:crypto";
import { AppError, type Context } from "../../contracts/src/index.js";
import { sha256 } from "../../storage/src/index.js";
import { Service } from "./index.js";
import { workspaceLinks } from "./workspace.js";
import { publicBaseUrl } from "./urls.js";
export async function workspaceResult(
  service: Service,
  c: Context,
  jobId: string,
) {
  const job = await service.get(c, "job", jobId);
  const revision = job.revisionId
    ? await service.get(c, "revision", job.revisionId)
    : undefined;
  const result = {
    jobId,
    projectId: revision?.projectId,
    revisionId: revision?.id,
    title: revision?.composition.title ?? "媒体结果",
    status: job.status,
    phase: job.phase,
    error: job.error?.message,
    steps: job.steps,
    ...(revision ? workspaceLinks(revision.projectId, revision.id) : {}),
    media: [] as {
      url: string;
      mimeType: string;
      name: string;
      assetId: string;
    }[],
  };
  if (job.status !== "completed" || !job.outputs.length) return result;
  const token = randomBytes(32).toString("base64url"),
    grantId = sha256(token),
    expiresAt = Date.now() + 3600_000;
  const base = publicBaseUrl();
  const assets = await service.scoped(c, "write", async (tx) => {
    const assets = await Promise.all(
      (job.outputs as string[]).map((id) => tx.get(id, c.accountId, "asset")),
    );
    if (assets.some((asset) => !asset))
      throw new AppError("NOT_FOUND", "Result media missing", 404);
    await tx.put({
      id: grantId,
      accountId: c.accountId,
      type: "media-grant",
      createdAt: new Date().toISOString(),
      keyId: c.keyId,
      jobId,
      assetIds: job.outputs,
      expiresAt,
    });
    return assets;
  });
  result.media = assets.map((asset) => ({
    assetId: asset!.id,
    name: asset!.name,
    mimeType: asset!.mime,
    url: `${base}/delivery/${token}/${asset!.id}`,
  }));
  return { ...result, expiresAt: new Date(expiresAt).toISOString(), grantId };
}
export async function revokeDelivery(
  service: Service,
  c: Context,
  grantId: string,
) {
  return service.scoped(c, "write", async (tx) => {
    const grant = await tx.get(grantId, c.accountId, "media-grant");
    if (!grant)
      throw new AppError("NOT_FOUND", "Delivery permission not found", 404);
    await tx.put({ ...grant, expiresAt: 0 });
    return { revoked: true };
  });
}
export async function deliveryAsset(
  service: Service,
  token: string,
  assetId: string,
) {
  const grant = await service.db.transaction((tx) =>
    tx.get(sha256(token), undefined, "media-grant"),
  );
  if (!grant || grant.expiresAt <= Date.now())
    throw new AppError(
      "UNAUTHORIZED",
      "Media link has expired or was revoked",
      401,
    );
  if (!grant.assetIds.includes(assetId))
    throw new AppError("NOT_FOUND", "Media is not part of this result", 404);
  return service.get(
    {
      accountId: grant.accountId,
      keyId: grant.keyId,
      scopes: [],
      budgetCents: 0,
    },
    "asset",
    assetId,
  );
}

/** Single byte ranges support native video players without exposing workspace keys. */
export function mediaResponse(
  bytes: Uint8Array,
  mime: string,
  filename: string,
  range?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="${filename}"`,
  };
  if (!range)
    return new Response(bytes as BodyInit, {
      headers: { ...headers, "Content-Length": String(bytes.length) },
    });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = match?.[1] ? Number(match[1]) : 0;
  let end = match?.[2] ? Number(match[2]) : bytes.length - 1;
  if (match && !match[1] && match[2]) {
    start = Math.max(0, bytes.length - Number(match[2]));
    end = bytes.length - 1;
  }
  if (
    !match ||
    (!match[1] && !match[2]) ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= bytes.length ||
    start > end
  )
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${bytes.length}` },
    });
  end = Math.min(end, bytes.length - 1);
  return new Response(bytes.slice(start, end + 1) as BodyInit, {
    status: 206,
    headers: {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
      "Content-Length": String(end - start + 1),
    },
  });
}
