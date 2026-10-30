import { sha256 } from "../../storage/src/index.js";
import { z } from "zod";
import {
  AppError,
  idSchema,
  type Entity,
  type Context,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import { fingerprint, type Service } from "./index.js";
import { referenceEvidence } from "./reference-handoff.js";
import { referenceReportSchema } from "../../contracts/src/reference-analysis.js";
import { normalizeAnalysisDuration } from "./reference-report.js";

export const videoRequestLinkSchema = z
  .object({ requestId: idSchema, expectedVersion: z.number().int().positive() })
  .strict();
export const videoRequestSnapshotSchema = z
  .object({
    requestId: idSchema,
    version: z.number().int().positive(),
    originalMessage: z.string().min(1).max(5000),
    turns: z
      .array(
        z
          .object({
            message: z.string().max(5000),
            assetIds: z.array(idSchema).max(14),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    assets: z
      .array(
        z
          .object({
            assetId: idSchema,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            kind: z.enum(["image", "video", "audio"]),
          })
          .strict(),
      )
      .max(14),
  })
  .strict();
function stop(code: string, message: string, stage: string): never {
  throw new AppError(code, message, 409, { stage });
}
export async function videoRequestSnapshot(
  tx: Transaction,
  accountId: string,
  link: z.infer<typeof videoRequestLinkSchema>,
) {
  const request = await tx.get(link.requestId, accountId, "workspace-request");
  if (!request || request.version !== link.expectedVersion)
    stop(
      "REQUEST_CONFLICT",
      "Bind the current original request before preparing video",
      "request",
    );
  if (request.hostRequest)
    return videoRequestSnapshotSchema.parse(request.hostRequest);
  const assets = [];
  for (const assetId of request.assetIds) {
    const asset = await tx.get(assetId, accountId, "asset");
    if (!asset?.sha256)
      stop(
        "REQUEST_ASSET_CHANGED",
        "Original attachment is unavailable",
        "request",
      );
    assets.push({ assetId, sha256: asset.sha256, kind: asset.kind });
  }
  return videoRequestSnapshotSchema.parse({
    requestId: request.id,
    version: request.version,
    originalMessage: request.originalMessage,
    turns: request.turns,
    assets,
  });
}

/** Both direct and cloud routes call this before selecting/uploading generation references. */
export async function bindVideoWorkflow(
  service: Service,
  tx: Transaction,
  c: Context,
  data: any,
  kind: string,
  references?: Entity[],
) {
  if (kind !== "video") return undefined;
  const plan = data.plan
    ? await tx.get(data.plan.planId, c.accountId, "production-plan")
    : undefined;
  const link = data.request ?? plan?.videoRequestLink ?? plan?.requestBinding;
  if (!link) return undefined;
  const request = await videoRequestSnapshot(tx, c.accountId, link);
  const sources = request.assets.filter((a) => a.kind === "video");
  // Source presence comes from the stored request, never from an agent's chosen genre or mode.
  let analysis: any;
  if (
    !sources.length &&
    (plan?.plan.remake ||
      plan?.plan.method?.source ||
      (data.input.references ?? []).some((r: any) =>
        ["motion", "source_video"].includes(r.role),
      ))
  )
    stop(
      "VIDEO_SOURCE_MISMATCH",
      "Include the source video in the original request; changing the request must not hide the source",
      "request",
    );
  if (sources.length && plan?.plan.remake) {
    if (plan.version !== data.plan.expectedVersion)
      stop("PLAN_CONFLICT", "Read the current production plan", "planning");
    if (plan.hostRemakeEvidence) {
      const evidence = plan.hostRemakeEvidence;
      if (!evidence.report)
        stop(
          "VIDEO_ANALYSIS_REQUIRED",
          "Synchronize the original analysis report, not only an analysis label",
          "analysis",
        );
      analysis = {
        binding: evidence,
        report: referenceReportSchema.parse(evidence.report),
      };
      if (
        analysis.report.source.assetId !== evidence.sourceAssetId ||
        analysis.report.source.sha256 !== evidence.sourceSha256 ||
        sha256(Buffer.from(JSON.stringify(analysis.report))) !==
          evidence.analysisSha256
      )
        stop(
          "ANALYSIS_PROVENANCE_REQUIRED",
          "Analysis report content and source must match their bound hashes",
          "analysis",
        );
      // An official execution must have actual completed analysis jobs, not a host assertion.
      for (const report of [
        analysis.report,
        ...(evidence.componentReports ?? []),
      ]) {
        if (report.provenance.evidence === "host-sampled") {
          const registered = await referenceEvidence(
            service,
            tx,
            c.accountId,
            evidence.analysisAssetId,
          );
          if (fingerprint(registered.report) !== fingerprint(report))
            stop(
              "ANALYSIS_PROVENANCE_REQUIRED",
              "Use the registered host report on this execution account",
              "analysis",
            );
          continue;
        }
        if (report.provenance.evidence === "provider-live-assembled") continue;
        const job = await tx.get(report.provenance.jobId, c.accountId, "job");
        let verifiedAnalysis;
        if (job?.analysis && job.input?.kind === "reference_analyze") {
          const original = referenceReportSchema.safeParse(job.analysis);
          if (
            original.success &&
            Math.abs(
              original.data.source.durationMs - report.source.durationMs,
            ) <= 1
          ) {
            try {
              verifiedAnalysis = normalizeAnalysisDuration(
                original.data,
                report.source.assetId,
                report.source.durationMs,
                Boolean(job.input.range),
              );
            } catch {
              // Malformed or unrepresentable intervals cannot establish provenance.
            }
          }
        }
        if (
          !job ||
          job.status !== "completed" ||
          job.input?.kind !== "reference_analyze" ||
          !verifiedAnalysis ||
          fingerprint(verifiedAnalysis) !== fingerprint(report)
        )
          stop(
            "ANALYSIS_PROVENANCE_REQUIRED",
            "Run original-video analysis through this cloud account; host-authored reports cannot replace completed analysis jobs",
            "analysis",
          );
      }
      if (
        analysis.report.provenance.evidence === "provider-live-assembled" &&
        (!analysis.report.analysis?.parts?.length ||
          analysis.report.analysis.parts.length !==
            evidence.componentReports?.length ||
          analysis.report.analysis.parts.some(
            (p: any, i: number) =>
              evidence.componentReports[i]?.source.assetId !== p.clipAssetId,
          ))
      )
        stop(
          "ANALYSIS_PROVENANCE_REQUIRED",
          "Merged analysis requires all component reports",
          "analysis",
        );
    } else {
      const verified = await referenceEvidence(
        service,
        tx,
        c.accountId,
        plan.plan.remake.analysisAssetId,
      );
      analysis = { binding: verified.binding, report: verified.report };
    }
    if (
      sources.length !== 1 ||
      sources[0].sha256 !== analysis.binding.sourceSha256 ||
      sources[0].assetId !== analysis.binding.sourceAssetId
    )
      stop(
        "VIDEO_SOURCE_MISMATCH",
        "Bind analysis to the original video in this request; split multiple source videos into individually analyzed tasks",
        "analysis",
      );
    const refs: Entity[] =
      references ??
      (await Promise.all(
        (data.input.references ?? []).map((r: any) =>
          tx.get(r.assetId, c.accountId, "asset"),
        ),
      ));
    const source = sources[0];
    if (plan.hostRemakeEvidence) {
      const verifiedExcerpts = await tx.list(c.accountId, "source-excerpt");
      for (let i = 0; i < (data.input.references ?? []).length; i++) {
        const ref = data.input.references[i],
          asset = refs[i];
        if (
          ["motion", "source_video"].includes(ref.role) &&
          asset?.kind === "video" &&
          asset.sha256 !== source.sha256
        ) {
          const declared = (analysis.binding.sourceExcerpts ?? []).find(
            (e: any) =>
              e.assetId === ref.assetId &&
              e.sha256 === asset.sha256 &&
              e.sourceSha256 === source.sha256,
          );
          if (
            !declared ||
            !verifiedExcerpts.some(
              (e) =>
                e.sha256 === declared.sha256 &&
                e.sourceSha256 === source.sha256 &&
                e.startMs === declared.startMs &&
                e.endMs === declared.endMs,
            )
          )
            stop(
              "SOURCE_EXCERPT_PROVENANCE_REQUIRED",
              "Cloud execution requires a cloud-verified source excerpt or the original video; a host-declared clip origin is insufficient",
              "reference_delivery",
            );
        }
      }
    }
    const shot = plan.plan.shots.find((s: any) => s.id === data.plan.shotId);
    if (!shot?.sourceShotIds?.length)
      stop(
        "SOURCE_SHOT_BINDING_REQUIRED",
        "Bind this generated shot to the analyzed source shots",
        "planning",
      );
    const selected = analysis.report.shots.filter((s: any) =>
      shot.sourceShotIds.includes(s.id),
    );
    if (selected.length !== shot.sourceShotIds.length)
      stop(
        "SOURCE_SHOT_BINDING_REQUIRED",
        "Every source shot must exist in the bound analysis",
        "planning",
      );
    const segment = plan.plan.method?.segments?.find(
      (s: any) => s.shotId === shot.id,
    );
    const ranges = selected.map((s: any) => ({
      start: segment ? Math.max(s.startMs, segment.sourceStartMs) : s.startMs,
      end: segment
        ? Math.min(s.endMs, segment.sourceStartMs + segment.durationMs)
        : s.endMs,
    }));
    const delivered = (data.input.references ?? []).some(
      (r: any, i: number) =>
        ["motion", "source_video"].includes(r.role) &&
        refs[i]?.kind === "video" &&
        (refs[i]?.sha256 === source.sha256 ||
          (analysis.binding.sourceExcerpts ?? []).some(
            (e: any) =>
              e.assetId === r.assetId &&
              e.sha256 === refs[i]?.sha256 &&
              e.sourceSha256 === source.sha256 &&
              e.endMs > e.startMs &&
              ranges.every(
                (range: any) =>
                  range.end > range.start &&
                  e.startMs <= range.start &&
                  e.endMs >= range.end,
              ),
          )),
    );
    if (!delivered)
      stop(
        "SOURCE_VIDEO_REFERENCE_REQUIRED",
        "Pass the original source video as motion/source_video to a compatible video-reference model. Stills, analysis_only and reconstruction text do not preserve source movement",
        "reference_delivery",
      );
  }
  return {
    protocol: "rikoko-video-workflow-v1",
    requestLink: {
      requestId: link.requestId,
      expectedVersion: link.expectedVersion,
    },
    request,
    ...(analysis
      ? {
          analysis,
          plan: { id: plan!.id, version: plan!.version, content: plan!.plan },
        }
      : {}),
    stages: [
      "request",
      ...(analysis ? ["analysis", "planning"] : []),
      "prompt",
      "reference_delivery",
    ],
  };
}

export async function validateVideoWorkflow(
  service: Service,
  tx: Transaction,
  accountId: string,
  record: Entity,
) {
  if (record.providerRequest?.kind !== "video") return;
  if (!record.workflow) return;
  const current = await videoRequestSnapshot(
    tx,
    accountId,
    record.workflow.requestLink,
  );
  if (fingerprint(current) !== fingerprint(record.workflow.request))
    stop(
      "REQUEST_CONFLICT",
      "Original request changed; prepare the updated request",
      "request",
    );
  if (record.workflow.analysis) {
    const refs = record.references ?? [];
    const sha = record.workflow.analysis.binding.sourceSha256;
    if (
      !refs.some(
        (r: any) =>
          r.kind === "video" &&
          ["motion", "source_video"].includes(r.role) &&
          (r.sha256 === sha ||
            (record.workflow.analysis.binding.sourceExcerpts ?? []).some(
              (e: any) => e.sha256 === r.sha256 && e.sourceSha256 === sha,
            )),
      )
    )
      stop(
        "SOURCE_VIDEO_REFERENCE_REQUIRED",
        "The immutable provider request lost its original video",
        "reference_delivery",
      );
  }
}
