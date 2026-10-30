import { AppError, type Entity } from "../../contracts/src/index.js";
import {
  REFERENCE_ANALYSIS_VERSION,
  referenceContentSchema,
  referenceReportSchema,
  type ReferenceOperation,
  type ReferenceReport,
} from "../../contracts/src/reference-analysis.js";
import type { Model, ReferenceSettings } from "../../providers/src/index.js";

export function bindReferenceReport(
  data: unknown,
  input: ReferenceOperation,
  source: Entity,
  job: Entity,
  model: Model,
  settings?: ReferenceSettings,
) {
  try {
    if (!settings) throw Error("Missing reference analysis profile");
    const content = referenceContentSchema.parse(data);
    // Models sometimes cite the neighboring shot as continuity context. A
    // boundary touch cannot support this interval. Drop only redundant exact
    // boundary citations when an actual overlapping citation remains; never
    // invent evidence, alter times, or excuse unknown/distant references.
    // Parsing clones the input, so the worker's analysisRawReport stays intact.
    const evidence = new Map(content.evidence.map((e) => [e.id, e]));
    for (const item of [
      ...content.shots,
      ...content.events,
      ...content.narrativeBeats,
      ...content.speech,
    ]) {
      if (
        !item.evidenceIds.some((id) => {
          const e = evidence.get(id);
          return e && e.startMs < item.endMs && e.endMs > item.startMs;
        })
      )
        continue;
      item.evidenceIds = item.evidenceIds.filter((id) => {
        const e = evidence.get(id);
        return !e || (e.endMs !== item.startMs && e.startMs !== item.endMs);
      });
    }
    const startMs = input.range?.startMs ?? 0,
      endMs = input.range?.endMs ?? source.metadata.durationMs;
    const gaps: { startMs: number; endMs: number }[] = [];
    let end = startMs;
    for (const shot of content.shots) {
      if (shot.startMs > end) gaps.push({ startMs: end, endMs: shot.startMs });
      end = shot.endMs;
    }
    if (end < endMs) gaps.push({ startMs: end, endMs });
    return referenceReportSchema.parse({
      ...content,
      schemaVersion: 2,
      analysis: {
        detail: input.detail ?? "shots",
        focus: input.focus ?? [],
        method: input.range ? "focused_range" : "whole_video",
      },
      source: {
        assetId: source.id,
        sha256: source.sha256,
        durationMs: source.metadata.durationMs,
        hasAudio: source.metadata.hasAudio === true,
        timebase: "source_ms",
      },
      coverage: {
        startMs,
        endMs,
        fps: settings.fps,
        mode: settings.mode,
        rangeControl: settings.rangeControl,
        submittedRange:
          settings.rangeControl === "prompt"
            ? { startMs: 0, endMs: source.metadata.durationMs }
            : { startMs, endMs },
        timing: "model_estimated",
        gaps,
      },
      provenance: {
        provider: job.ticket.connectionId ?? "gemini",
        model: input.model,
        endpoint: model.endpoint,
        upstreamModel: settings.upstreamModel,
        requestId: job.ticket.requestId,
        jobId: job.id,
        analysisVersion: REFERENCE_ANALYSIS_VERSION,
        priceVersion: job.priceVersion,
        analyzedAt: new Date().toISOString(),
        evidence: "provider-live",
      },
      measurements: job.referenceTiming,
    });
  } catch {
    throw new AppError(
      "PROVIDER_RESULT_INVALID",
      "Analysis has invalid source times, shot order or evidence references",
    );
  }
}

/** Map the same media's measured endpoint between FFprobe builds. */
export function normalizeAnalysisDuration(
  report: ReferenceReport,
  localAssetId: string,
  localDurationMs: number,
  explicitRange = false,
) {
  const remoteDurationMs = report.source.durationMs;
  const fullEndpoint = (value: number) =>
    value === remoteDurationMs ? localDurationMs : value;
  const endpoint = (value: number) =>
    explicitRange ? value : fullEndpoint(value);
  const interval = <T extends { startMs: number; endMs: number }>(item: T) => ({
    ...item,
    startMs: endpoint(item.startMs),
    endMs: endpoint(item.endMs),
  });
  const mapped = {
    ...report,
    source: {
      ...report.source,
      assetId: localAssetId,
      durationMs: localDurationMs,
    },
    coverage: {
      ...interval(report.coverage),
      submittedRange: report.coverage.submittedRange
        ? report.coverage.rangeControl === "prompt"
          ? {
              ...report.coverage.submittedRange,
              endMs: fullEndpoint(report.coverage.submittedRange.endMs),
            }
          : interval(report.coverage.submittedRange)
        : undefined,
      gaps: report.coverage.gaps.map(interval),
    },
    shots: report.shots.map(interval),
    events: report.events.map(interval),
    narrativeBeats: report.narrativeBeats.map(interval),
    speech: report.speech.map(interval),
    evidence: report.evidence.map(interval),
    unknowns: report.unknowns.map(interval),
  };
  const result = referenceReportSchema.safeParse(mapped);
  if (!result.success)
    throw new AppError(
      "SOURCE_MISMATCH",
      "Analysis intervals cannot be safely mapped to the local source duration",
      409,
    );
  return result.data;
}
