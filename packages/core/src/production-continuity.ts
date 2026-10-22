import { AppError, type Entity } from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import type { ProductionPlan } from "./production-plan.js";

/** A previous_end claim must identify a server-extracted frame of the actual preceding footage. */
export async function assertPreviousEndAnchor(
  tx: Transaction,
  accountId: string,
  plan: ProductionPlan,
  shotId: string,
  projectId?: string,
) {
  const shot = plan.shots.find((s) => s.id === shotId);
  const anchor = shot?.process?.stateAnchor;
  if (anchor?.mode !== "previous_end") return;
  const frame = anchor.assetId
    ? await tx.get(anchor.assetId, accountId, "asset")
    : undefined;
  const p = frame?.provenance;
  const source = p?.sourceAssetId
    ? await tx.get(p.sourceAssetId, accountId, "asset")
    : undefined;
  const inspections = await tx.list(accountId, "media-inspection");
  const extracted = inspections.some(
    (i) =>
      i.assetId === source?.id &&
      i.sourceSha256 === source?.sha256 &&
      i.frames?.some(
        (f: Entity) =>
          f.assetId === frame?.id &&
          f.sha256 === frame?.sha256 &&
          f.requestedTimeMs === p?.requestedTimeMs,
      ),
  );
  if (
    !frame ||
    p?.source !== "media-inspect" ||
    source?.kind !== "video" ||
    p.sourceSha256 !== source.sha256 ||
    !Number.isFinite(p.requestedTimeMs) ||
    !extracted
  )
    throw new AppError(
      "CONTINUITY_FRAME_REQUIRED",
      "Use a frame returned by media_inspect from the preceding shot's actual video. A reimported PNG or a written previous_end claim does not prove its source. Inspect the intended edit endpoint, review that image, then bind its returned assetId in the plan.",
      409,
    );
  const jobs = await tx.list(accountId, "job");
  const assignments = await tx.list(accountId, "production-asset-assignment");
  const ownedByPreviousShot =
    jobs.some(
      (j) =>
        j.status === "completed" &&
        j.outputs?.includes(source.id) &&
        j.input?.production?.projectId === projectId &&
        j.input.production.shotId === anchor.previousShotId,
    ) ||
    assignments.some(
      (a) =>
        a.projectId === projectId &&
        a.shotId === anchor.previousShotId &&
        a.assetId === source.id &&
        a.sourceSha256 === source.sha256,
    );
  if (!ownedByPreviousShot)
    throw new AppError(
      "CONTINUITY_SOURCE_MISMATCH",
      "The extracted frame must come from completed or assigned footage of this project's preceding shot. Assign an edited excerpt to that shot before continuing from it.",
      409,
    );
}

export function continuityCutIssue(
  frame: Entity | null | undefined,
  source: Entity | null | undefined,
  previous: {
    assetId?: string;
    sourceStartMs?: number;
    durationMs: number;
    speed?: number;
  },
) {
  const p = frame?.provenance;
  if (
    !source ||
    p?.source !== "media-inspect" ||
    p.sourceAssetId !== previous.assetId ||
    p.sourceSha256 !== source.sha256
  )
    return "The next shot's first frame does not come from the preceding scene's selected source. Extract and bind a frame of that actual source, or author a time jump.";
  const endMs =
    (previous.sourceStartMs ?? 0) + previous.durationMs * (previous.speed ?? 1);
  const tolerance = Math.min(
    100,
    Math.max(1, Math.ceil(1000 / (source.metadata?.fps || 25))),
  );
  if (
    !Number.isFinite(p.requestedTimeMs) ||
    p.requestedTimeMs < endMs - tolerance ||
    p.requestedTimeMs >= endMs
  )
    return "The next shot was generated from a frame outside the preceding scene's retained endpoint. Match the source interval to the bound frame or regenerate only with explicit authorization. Full-clip tails cannot certify trimmed-cut continuity.";
  return undefined;
}
