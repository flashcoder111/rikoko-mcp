import { AppError, type Entity } from "../../contracts/src/index.js";
import {
  REFERENCE_ANALYSIS_VERSION,
  referenceContentSchema,
  referenceReportSchema,
  type ReferenceOperation,
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
