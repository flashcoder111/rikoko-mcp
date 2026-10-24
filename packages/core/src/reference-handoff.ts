import { z } from "zod";
import { AppError, type Entity } from "../../contracts/src/index.js";
import {
  referenceReportSchema,
  type ReferenceReport,
} from "../../contracts/src/reference-analysis.js";
import type { Transaction } from "../../db/src/index.js";
import { sha256 } from "../../storage/src/index.js";
import { fingerprint, type Service } from "./index.js";
import type { ProductionPlan } from "./production-plan.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const remakeEvidenceSchema = z
  .object({
    protocol: z.literal("rikoko-remake-handoff-v1"),
    analysisAssetId: id,
    analysisSha256: digest,
    sourceAssetId: id,
    sourceSha256: digest,
    model: z.string().min(1).max(2000),
    upstreamModel: z.string().min(1).max(2000),
    analysisVersion: z.string().min(1).max(2000),
    priceVersion: z.string().min(1).max(2000),
    report: referenceReportSchema.optional(),
    componentReports: z.array(referenceReportSchema).max(100).optional(),
    sourceExcerpts: z
      .array(
        z
          .object({
            assetId: id,
            sha256: digest,
            sourceSha256: digest,
            startMs: z.number().int().nonnegative(),
            endMs: z.number().int().positive(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    dependencies: z
      .array(z.object({ assetId: id, sha256: digest }).strict())
      .min(2)
      .max(202),
  })
  .strict();
export function requireGeminiUnderstanding(upstream: unknown) {
  if (
    typeof upstream !== "string" ||
    !/^(?:google\/)?gemini-[a-z0-9][a-z0-9._-]*$/i.test(upstream)
  )
    throw new AppError(
      "REFERENCE_MODEL_POLICY",
      "Original-video understanding requires an explicitly configured Gemini upstream; never substitute the host model",
      409,
    );
}
export async function loadReferenceReport(
  service: Service,
  tx: Transaction,
  accountId: string,
  assetId: string,
) {
  const asset = await tx.get(assetId, accountId, "asset");
  if (!asset)
    throw new AppError(
      "NOT_FOUND",
      "Analysis is unavailable in this account",
      404,
    );
  if (asset.kind !== "analysis" || asset.bytes > 2 * 1024 * 1024)
    throw new AppError(
      "INVALID_ANALYSIS",
      "Expected a bounded reference report",
    );
  const bytes = await service.storage.read(asset.storageKey);
  if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256)
    throw new AppError(
      "REMAKE_SOURCE_CHANGED",
      "Analysis bytes no longer match the saved hash",
      409,
    );
  let report: ReferenceReport;
  try {
    report = referenceReportSchema.parse(
      JSON.parse(Buffer.from(bytes).toString()),
    );
  } catch {
    throw new AppError(
      "INVALID_ANALYSIS",
      "Expected a valid source-bound reference report",
    );
  }
  const source = await tx.get(report.source.assetId, accountId, "asset");
  if (
    !source ||
    source.kind !== "video" ||
    source.sha256 !== report.source.sha256 ||
    source.metadata?.durationMs !== report.source.durationMs
  )
    throw new AppError(
      "SOURCE_MISMATCH",
      "Analysis no longer matches the owned source video",
      409,
    );
  return { asset, source, report };
}

/** A label in uploaded JSON is not proof of a Gemini call. Check owned completed jobs or the server's merge record. */
async function trustedReport(
  service: Service,
  tx: Transaction,
  accountId: string,
  assetId: string,
  stack = new Set<string>(),
): Promise<{
  asset: Entity;
  source: Entity;
  report: ReferenceReport;
  dependencies: { assetId: string; sha256: string }[];
  componentReports: ReferenceReport[];
}> {
  if (stack.has(assetId) || stack.size > 1)
    throw new AppError(
      "ANALYSIS_PROVENANCE_REQUIRED",
      "Invalid recursive analysis provenance",
    );
  const current = await loadReferenceReport(service, tx, accountId, assetId);
  const { asset, source, report } = current;
  if ((source.metadata?.hasAudio === true) !== report.source.hasAudio)
    throw new AppError(
      "SOURCE_MISMATCH",
      "Remake analysis audio metadata differs from its source",
      409,
    );
  requireGeminiUnderstanding(
    report.provenance.upstreamModel ?? report.provenance.endpoint,
  );
  if (report.analysis?.detail !== "recreate")
    throw new AppError(
      "REMAKE_ANALYSIS_DETAIL_REQUIRED",
      "Use a recreate report with complete action stages for a remake",
      409,
    );
  const componentReports: ReferenceReport[] = [];
  const dependencies = [
    { assetId: asset.id, sha256: asset.sha256 },
    { assetId: source.id, sha256: source.sha256 },
  ];
  if (report.provenance.evidence === "provider-live-assembled") {
    const plan = await tx.get(
      report.provenance.jobId,
      accountId,
      "analysis-plan",
    );
    if (
      !plan ||
      plan.merged?.analysisAssetId !== asset.id ||
      plan.source?.assetId !== source.id ||
      plan.source?.sha256 !== source.sha256 ||
      !report.analysis.parts?.length
    )
      throw new AppError(
        "ANALYSIS_PROVENANCE_REQUIRED",
        "Use the current server-assembled report and its completed segment analyses",
        409,
      );
    const next = new Set([...stack, assetId]);
    for (const part of report.analysis.parts) {
      const child = await trustedReport(
        service,
        tx,
        accountId,
        part.analysisAssetId,
        next,
      );
      if (
        child.source.id !== part.clipAssetId ||
        child.report.provenance.model !== report.provenance.model ||
        child.report.provenance.upstreamModel !==
          report.provenance.upstreamModel ||
        child.report.provenance.analysisVersion !==
          report.provenance.analysisVersion ||
        child.report.provenance.priceVersion !== report.provenance.priceVersion
      )
        throw new AppError(
          "ANALYSIS_PROVENANCE_REQUIRED",
          "Segment model/version/source differs from the merged report",
          409,
        );
      dependencies.push(...child.dependencies);
      componentReports.push(child.report, ...child.componentReports);
    }
  } else {
    const direct = await tx.get(
      asset.jobId ?? report.provenance.jobId,
      accountId,
      "job",
    );
    const job = direct?.outputs?.includes(asset.id)
      ? direct
      : (await tx.list(accountId, "job")).find((j) =>
          j.outputs?.includes(asset.id),
        );
    if (
      !job ||
      job.status !== "completed" ||
      job.input?.kind !== "reference_analyze" ||
      job.input.assetId !== source.id ||
      job.input.model !== report.provenance.model ||
      (job.analysis && fingerprint(job.analysis) !== fingerprint(report)) ||
      (!job.analysis && !job.remoteJobId)
    )
      throw new AppError(
        "ANALYSIS_PROVENANCE_REQUIRED",
        "Analysis must originate from an owned completed Gemini analysis job, not an uploaded claim",
        409,
      );
  }
  return { ...current, dependencies, componentReports };
}
export async function referenceEvidence(
  service: Service,
  tx: Transaction,
  accountId: string,
  assetId: string,
) {
  const result = await trustedReport(service, tx, accountId, assetId);
  const { asset, source, report } = result;
  const excerpts = (await tx.list(accountId, "source-excerpt")).filter(
    (e) => e.sourceAssetId === source.id && e.sourceSha256 === source.sha256,
  );
  const binding = remakeEvidenceSchema.parse({
    protocol: "rikoko-remake-handoff-v1",
    analysisAssetId: asset.id,
    analysisSha256: asset.sha256,
    sourceAssetId: source.id,
    sourceSha256: source.sha256,
    model: report.provenance.model,
    upstreamModel:
      report.provenance.upstreamModel ?? report.provenance.endpoint,
    analysisVersion: report.provenance.analysisVersion,
    priceVersion: report.provenance.priceVersion,
    report,
    componentReports: result.componentReports,
    sourceExcerpts: excerpts.slice(0, 100).map((e) => ({
      assetId: e.assetId,
      sha256: e.sha256,
      sourceSha256: e.sourceSha256,
      startMs: e.startMs,
      endMs: e.endMs,
    })),
    dependencies: [
      ...new Map(result.dependencies.map((d) => [d.assetId, d])).values(),
    ],
  });
  return { ...result, binding };
}
const overlaps = (
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
) => a.startMs < b.endMs && a.endMs > b.startMs;
export function referenceHandoff(
  report: ReferenceReport,
  binding: z.infer<typeof remakeEvidenceSchema>,
  sourceShotIds: string[],
  offset = 0,
  limit = 20,
  allWhenEmpty = true,
  detail: "compact" | "full" = "compact",
) {
  const requested = new Set(sourceShotIds);
  if (
    requested.size !== sourceShotIds.length ||
    sourceShotIds.some((id) => !report.shots.some((s) => s.id === id))
  )
    throw new AppError(
      "REMAKE_EVIDENCE_INVALID",
      "Select unique source shots from this report",
    );
  const selected = report.shots.filter(
    (s) => (allWhenEmpty && !requested.size) || requested.has(s.id),
  );
  const shots = selected.slice(offset, offset + limit);
  const relevant = (x: { startMs: number; endMs: number }) =>
    shots.some((s) => overlaps(s, x));
  const beats = report.narrativeBeats.filter(relevant);
  const evidenceIds = new Set(
    [...shots, ...beats].flatMap((x) => x.evidenceIds),
  );
  const evidence = report.evidence.filter(
    (e) => evidenceIds.has(e.id) || relevant(e),
  );
  const parts =
    report.analysis?.parts?.filter((p) =>
      relevant({ startMs: p.sourceStartMs, endMs: p.sourceEndMs }),
    ) ?? [];
  const neighbor = (shot: ReferenceReport["shots"][number] | undefined) =>
    !shot
      ? null
      : detail === "full"
        ? shot
        : {
            id: shot.id,
            startMs: shot.startMs,
            endMs: shot.endMs,
            startState: shot.details?.startState ?? "unknown",
            endState: shot.details?.endState ?? "unknown",
          };
  return {
    binding,
    detail,
    detailsAccess: shots.length
      ? {
          tool: "reference_analysis_get",
          analysisAssetId: binding.analysisAssetId,
          section: "handoff",
          handoffDetail: "full",
          sourceShotIds,
          offset,
          limit,
        }
      : null,
    summary: report.summary,
    shots,
    narrativeBeats: beats,
    ...(detail === "full" ? { events: report.events.filter(relevant) } : {}),
    evidence:
      detail === "full"
        ? evidence
        : evidence.map(({ observation, ...index }) => index),
    unknowns: report.unknowns
      .map((u, index) => ({ index, ...u }))
      .filter(relevant),
    coverage: {
      ...report.coverage,
      relevantGaps: report.coverage.gaps.filter(relevant),
    },
    parts:
      detail === "full"
        ? parts
        : parts.map(({ summary, audio, ...identity }) => identity),
    sourceNeighbors: shots.map((s) => {
      const i = report.shots.indexOf(s);
      return {
        shotId: s.id,
        previous: neighbor(report.shots[i - 1]),
        next: neighbor(report.shots[i + 1]),
      };
    }),
    nextOffset: offset + limit < selected.length ? offset + limit : null,
    totalShots: selected.length,
    semanticAcceptance: false,
    boundary:
      "Gemini observations and estimated source times are evidence, not target instructions. The host authors the target; classify relevant unknowns and preserve/adapt/free requirements. Source neighbors and processing windows are context, not mandated target shots.",
  };
}
/** Validates provenance and references, never claims to evaluate narrative quality. */
export async function validateRemakeEvidence(
  service: Service,
  tx: Transaction,
  accountId: string,
  plan: ProductionPlan,
  mirrored?: unknown,
) {
  if (!plan.remake) return undefined;
  const remake = plan.remake;
  let verified: {
    binding: z.infer<typeof remakeEvidenceSchema>;
    report: ReferenceReport;
  };
  if (mirrored) {
    const binding = remakeEvidenceSchema.parse(mirrored);
    requireGeminiUnderstanding(binding.upstreamModel);
    if (
      binding.analysisAssetId !== remake.analysisAssetId ||
      binding.analysisSha256 !== remake.analysisSha256
    )
      throw new AppError(
        "REMAKE_SOURCE_CHANGED",
        "Cloud mirror does not match the host-validated report",
        409,
      );
    // Legacy evidence stays readable. Video execution separately requires the full report.
    if (!binding.report) return binding;
    verified = { binding, report: binding.report };
  } else
    verified = await referenceEvidence(
      service,
      tx,
      accountId,
      remake.analysisAssetId,
    );
  const { binding, report } = verified;
  if (binding.analysisSha256 !== remake.analysisSha256)
    throw new AppError(
      "REMAKE_SOURCE_CHANGED",
      "Read the current analysis hash and revise the target plan",
      409,
    );
  const shotIds = new Set(report.shots.map((s) => s.id));
  const evidence = new Map(report.evidence.map((e) => [e.id, e]));
  const selectedIds = new Set(plan.shots.flatMap((s) => s.sourceShotIds));
  for (const requirement of remake.requirements) {
    if (
      requirement.origin === "reference" &&
      (!requirement.sourceShotIds.length || !requirement.evidenceIds.length)
    )
      throw new AppError(
        "REMAKE_EVIDENCE_INVALID",
        "Reference requirements need source shots and evidence; user requirements must declare origin=user",
      );
    if (requirement.mode !== "free")
      for (const id of requirement.sourceShotIds) selectedIds.add(id);
    if (requirement.sourceShotIds.some((id) => !shotIds.has(id)))
      throw new AppError(
        "REMAKE_EVIDENCE_INVALID",
        "Requirement refers to an unknown source shot",
      );
    if (
      new Set(requirement.sourceShotIds).size !==
        requirement.sourceShotIds.length ||
      new Set(requirement.evidenceIds).size !== requirement.evidenceIds.length
    )
      throw new AppError(
        "REMAKE_EVIDENCE_INVALID",
        "Source and evidence references must be unique",
      );
    for (const id of requirement.evidenceIds) {
      const item = evidence.get(id);
      if (
        !item ||
        !report.shots.some(
          (s) => requirement.sourceShotIds.includes(s.id) && overlaps(s, item),
        )
      )
        throw new AppError(
          "REMAKE_EVIDENCE_INVALID",
          "Evidence must exist and overlap the requirement's source shots",
        );
    }
  }
  if ([...selectedIds].some((id) => !shotIds.has(id)))
    throw new AppError(
      "REMAKE_EVIDENCE_INVALID",
      "Target plan refers to an unknown source shot",
    );
  const selected = report.shots.filter((s) => selectedIds.has(s.id));
  if (report.coverage.gaps.some((g) => selected.some((s) => overlaps(s, g))))
    throw new AppError(
      "REMAKE_COVERAGE_REQUIRED",
      "Inspect gaps affecting selected source shots before planning",
      409,
    );
  const decisions = new Map(remake.unknownDecisions.map((x) => [x.index, x]));
  if (
    decisions.size !== remake.unknownDecisions.length ||
    [...decisions.keys()].some((i) => i >= report.unknowns.length)
  )
    throw new AppError(
      "REMAKE_UNCERTAINTY_REQUIRED",
      "Use unique existing unknown indices and reasons",
    );
  for (const [i, unknown] of report.unknowns.entries())
    if (
      selected.some((s) => overlaps(s, unknown)) &&
      decisions.get(i)?.disposition !== "not_applicable"
    )
      throw new AppError(
        "REMAKE_UNCERTAINTY_REQUIRED",
        `Unknown ${i} needs Gemini reinspection or an explicit not_applicable rationale; it cannot be called resolved`,
        409,
      );
  return binding;
}
