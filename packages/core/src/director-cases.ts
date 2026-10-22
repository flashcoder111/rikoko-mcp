import { z } from "zod";
import { AppError, idSchema, type Context } from "../../contracts/src/index.js";
import { fingerprint, type Service } from "./index.js";
import { directorKitSchema } from "./director-kits.js";

export const directorCaseSchema = z
  .object({
    jobId: idSchema,
    assetId: idSchema.optional(),
    reviewId: idSchema.optional(),
    lesson: z.string().trim().min(1).max(2000),
    nextChange: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

/** Account-owned trial evidence, never a kit promotion or a new generation. */
export async function recordDirectorCase(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const data = directorCaseSchema.parse(raw);
  return service.scoped(c, "write", async (tx) => {
    const job = await tx.get(data.jobId, c.accountId, "job");
    if (!job)
      throw new AppError("NOT_FOUND", "Generation job is unavailable", 404);
    if (!["completed", "failed"].includes(job.status))
      throw new AppError(
        "DIRECTOR_CASE_PENDING",
        "Read the existing job until it completes or fails; do not submit again",
      );
    const preparationId = job.preparedRequestId ?? job.input?.preparedRequestId;
    const prep = preparationId
      ? await tx.get(preparationId, c.accountId, "generation-preparation")
      : undefined;
    if (!prep?.prompt?.direction?.directorKit || prep.prompt.overridden)
      throw new AppError(
        "DIRECTOR_CASE_UNBOUND",
        "Only an exact, prepared kit request can be attributed to a director kit",
      );
    const kit = directorKitSchema.parse(prep.prompt.direction.directorKit);
    if (!job.input || fingerprint(job.input) !== prep.inputHash)
      throw new AppError(
        "DIRECTOR_CASE_UNBOUND",
        "Job inputs do not match the frozen preparation",
      );
    if (data.reviewId && !data.assetId)
      throw new AppError(
        "DIRECTOR_CASE_REVIEW_MISMATCH",
        "Select the exact generated asset reviewed",
      );
    const asset = data.assetId
      ? await tx.get(data.assetId, c.accountId, "asset")
      : undefined;
    if (data.assetId && (!asset || !(job.outputs ?? []).includes(asset.id)))
      throw new AppError(
        "DIRECTOR_CASE_ASSET_MISMATCH",
        "Select an owned output of this generation; edited excerpts need separate provenance",
      );
    const review = data.reviewId
      ? await tx.get(data.reviewId, c.accountId, "media-review")
      : undefined;
    if (
      data.reviewId &&
      (!review ||
        review.assetId !== asset?.id ||
        review.sourceSha256 !== asset?.sha256 ||
        review.revisionId)
    )
      throw new AppError(
        "DIRECTOR_CASE_REVIEW_MISMATCH",
        "Use a source-media review of these exact output bytes, not a composition review",
      );
    const id = `director-case-${fingerprint([c.accountId, job.id, data.assetId ?? null, data.reviewId ?? null, data.lesson, data.nextChange ?? null])}`;
    const existing = await tx.get(id, c.accountId, "director-case");
    if (existing) return existing;
    const record = {
      id,
      type: "director-case",
      accountId: c.accountId,
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
      ...data,
      kit,
      preparationId: prep.id,
      preparationHash: prep.requestHash,
      templateVersion: prep.prompt.templateVersion,
      compilerVersion: prep.prompt.compilerVersion,
      prompt: prep.prompt.text,
      direction: prep.prompt.direction,
      model: prep.input.model,
      modelProfileVersion: prep.modelProfileVersion,
      parameters:
        prep.providerRequest?.parameters ?? prep.input.parameters ?? {},
      references: (prep.references ?? []).map(
        (ref: { assetId: string; sha256: string; role: string }) => ({
          assetId: ref.assetId,
          sha256: ref.sha256,
          role: ref.role,
        }),
      ),
      jobStatus: job.status,
      outcome:
        job.status === "failed"
          ? "technical_failure"
          : review?.decision === "accepted"
            ? "reviewer_accepted"
            : review?.decision === "needs_changes"
              ? "needs_changes"
              : "unreviewed",
      assetSha256: asset?.sha256,
      review: review
        ? {
            id: review.id,
            decision: review.decision,
            sourceSha256: review.sourceSha256,
            reviewer: review.reviewer,
            checks: review.checks,
            range: review.range,
            actionRanges: review.actionRanges,
            qualityChecks: review.qualityChecks,
            notes: review.notes,
          }
        : null,
      elapsedMs:
        job.finishedAt &&
        Number.isFinite(Date.parse(job.finishedAt)) &&
        Number.isFinite(Date.parse(job.createdAt))
          ? Math.max(0, Date.parse(job.finishedAt) - Date.parse(job.createdAt))
          : null,
      chargedCents: job.chargedCents ?? null,
      currency: job.currency ?? null,
      testing: job.testing === true,
      evidenceBoundary:
        "Snapshot of this exact attempt and its selected reviewer judgment. Not independent quality verification, model training, publication, or promotion to a proven template. Count unique job IDs within matching model/configuration cohorts; retain failed and unreviewed attempts.",
    };
    await tx.put(record);
    return record;
  });
}
