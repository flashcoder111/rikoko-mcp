import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const ms = z.number().int().min(0).max(3_600_000);
const text = z.string().min(1).max(2000);
const interval = { startMs: ms, endMs: ms };
const references = { evidenceIds: z.array(id).max(30) };
export const analysisDetailSchema = z.enum(["overview", "shots", "recreate"]);
export type AnalysisDetail = z.infer<typeof analysisDetailSchema>;
export const analysisFocusSchema = z
  .array(
    z.enum(["motion", "camera", "appearance", "text", "audio", "continuity"]),
  )
  .max(6);
export const shotDetailsSchema = z
  .object({
    startState: z.string().min(1).max(800),
    endState: z.string().min(1).max(800),
    spatialRelations: z.string().min(1).max(600),
    lighting: z.string().min(1).max(400),
    actionStages: z
      .array(
        z
          .object({
            description: z.string().min(1).max(400),
            subjectMotion: z.string().min(1).max(300),
            cameraMotion: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(16),
    continuity: z
      .object({
        fromPrevious: z.string().min(1).max(400),
        toNext: z.string().min(1).max(400),
        constraints: z.array(z.string().min(1).max(300)).max(10),
      })
      .strict(),
  })
  .strict();
export const referenceShotSchema = z
  .object({
    id,
    ...interval,
    description: text,
    framing: text,
    cameraMotion: text,
    action: text,
    transition: text,
    ...references,
    visualStyle: text.optional(),
    details: shotDetailsSchema.optional(),
  })
  .strict();
export const referenceOperationSchema = z
  .object({
    kind: z.literal("reference_analyze"),
    assetId: id,
    model: z.string().min(1).max(120),
    purpose: z.enum(["remake", "clip", "inspect"]).default("inspect"),
    detail: analysisDetailSchema.optional(),
    focus: analysisFocusSchema.optional(),
    language: z.string().min(2).max(20).default("zh"),
    question: z.string().min(1).max(2000).optional(),
    range: z
      .object(interval)
      .strict()
      .refine((r) => r.endMs > r.startMs)
      .optional(),
  })
  .strict();
export type ReferenceOperation = z.infer<typeof referenceOperationSchema>;
// This version is part of quotes and cache keys. Prompt/schema changes invalidate old results.
export const REFERENCE_ANALYSIS_VERSION = "reference-v2.5-evidence-intervals";
// Wire capabilities, independent of package and prompt versions. Cloud catalogs
// advertise this contract so clients can reject incompatible deployments early.
export const referenceAnalysisProtocol = {
  version: 1,
  reportSchemaVersion: 2,
  details: analysisDetailSchema.options,
  focus: analysisFocusSchema.element.options,
} as const;
export const referenceContentSchema = z
  .object({
    summary: z.string().min(1).max(5000),
    shots: z.array(referenceShotSchema).min(1).max(100),
    narrativeBeats: z
      .array(
        z
          .object({
            id,
            ...interval,
            role: text,
            description: text,
            ...references,
          })
          .strict(),
      )
      .max(100),
    events: z
      .array(
        z
          .object({
            id,
            ...interval,
            type: z.enum(["action", "text", "transition", "sound", "other"]),
            description: text,
            ...references,
          })
          .strict(),
      )
      .max(200),
    visualStyle: z.object({ description: text, ...references }).strict(),
    speech: z
      .array(
        z.object({ ...interval, text, speaker: text, ...references }).strict(),
      )
      .max(200),
    audio: z.object({ description: text, ...references }).strict(),
    evidence: z
      .array(
        z
          .object({
            id,
            ...interval,
            modality: z.enum(["visual", "audio", "audiovisual"]),
            observation: text,
            confidence: z.enum(["low", "medium", "high"]),
          })
          .strict(),
      )
      .min(1)
      .max(300),
    unknowns: z
      .array(
        z
          .object({
            ...interval,
            question: text,
            reason: text,
            suggestedFps: z.number().min(0.1).max(30),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type ReferenceContent = z.infer<typeof referenceContentSchema>;
export const timingSchema = z
  .object({
    status: z.enum(["measured", "unavailable"]),
    method: z.literal("ffmpeg-scene-difference"),
    threshold: z.number().min(0).max(1),
    cutTimesMs: z.array(ms).max(2000),
    reason: z.string().max(300).optional(),
  })
  .strict();
export const hostObservationSchema = z
  .object({
    host: z.literal("codex"),
    imagesViewed: z.literal(true),
    continuous: z.literal(false),
    audioReviewed: z.literal(false),
    timeBasis: z.literal("requested"),
    inspectionIds: z.array(id).min(1).max(100),
    frames: z
      .array(
        z
          .object({
            assetId: id,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            requestedTimeMs: ms,
          })
          .strict(),
      )
      .min(1)
      .max(1200),
    maxSampleGapMs: ms,
    limitations: z.array(text).min(1).max(10),
  })
  .strict();
export const referenceReportSchema = referenceContentSchema
  .extend({
    schemaVersion: z.literal(2),
    hostObservation: hostObservationSchema.optional(),
    analysis: z
      .object({
        detail: analysisDetailSchema,
        focus: analysisFocusSchema,
        method: z.enum(["whole_video", "focused_range", "segmented"]),
        parts: z
          .array(
            z
              .object({
                analysisAssetId: id,
                clipAssetId: id,
                sourceStartMs: ms,
                sourceEndMs: ms,
                clipDurationMs: ms.positive(),
                timeMapping: z.literal("offset-trim-codec-padding"),
                boundary: z
                  .enum(["start", "cut_candidate", "window"])
                  .optional(),
                summary: referenceContentSchema.shape.summary.optional(),
                audio: referenceContentSchema.shape.audio.optional(),
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict()
      .optional(),
    source: z
      .object({
        assetId: id,
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        durationMs: ms.positive(),
        hasAudio: z.boolean(),
        timebase: z.literal("source_ms"),
      })
      .strict(),
    coverage: z
      .object({
        ...interval,
        fps: z.number().positive().max(30).nullable(),
        mode: z.enum([
          "static_video_and_audio",
          "provider_controlled",
          "host_sampled_frames",
        ]),
        rangeControl: z.enum(["api", "prompt"]).optional(),
        submittedRange: z.object(interval).strict().optional(),
        timing: z.literal("model_estimated"),
        gaps: z.array(z.object(interval).strict()).max(101),
      })
      .strict(),
    provenance: z
      .object({
        provider: text,
        model: text,
        endpoint: text,
        upstreamModel: text.optional(),
        requestId: text,
        jobId: id,
        analysisVersion: text,
        priceVersion: text,
        analyzedAt: z.string().datetime(),
        evidence: z.enum([
          "provider-live",
          "provider-live-assembled",
          "host-sampled",
        ]),
      })
      .strict(),
    measurements: timingSchema,
  })
  .strict()
  .superRefine((r, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (r.provenance.evidence === "host-sampled") {
      if (
        !r.hostObservation ||
        r.provenance.provider !== "host" ||
        r.provenance.model !== "codex" ||
        r.provenance.upstreamModel !== "host_codex" ||
        r.coverage.mode !== "host_sampled_frames" ||
        r.coverage.fps !== null
      )
        fail(
          "Host observations require distinct provenance and sampled-frame coverage",
        );
      if (
        r.speech.length ||
        r.audio.evidenceIds.length ||
        r.evidence.some((e) => e.modality !== "visual") ||
        r.events.some((e) => e.type === "sound")
      )
        fail("Frame-only host observations cannot establish audio evidence");
    } else if (r.hostObservation || r.coverage.mode === "host_sampled_frames")
      fail("Provider analysis cannot claim host inspection provenance");
    const { startMs, endMs } = r.coverage;
    if (endMs <= startMs || endMs > r.source.durationMs)
      fail("Coverage exceeds source");
    if (r.coverage.mode === "provider_controlled" && r.coverage.fps !== null)
      fail("Provider-controlled sampling has unknown FPS");
    if (
      r.coverage.submittedRange &&
      (r.coverage.submittedRange.startMs < 0 ||
        r.coverage.submittedRange.endMs > r.source.durationMs ||
        r.coverage.submittedRange.endMs <= r.coverage.submittedRange.startMs)
    )
      fail("Invalid submitted source interval");
    const allTimed = [
      ...r.shots,
      ...r.events,
      ...r.narrativeBeats,
      ...r.speech,
      ...r.evidence,
      ...r.unknowns,
      ...r.coverage.gaps,
    ];
    for (const item of allTimed)
      if (
        item.startMs < startMs ||
        item.endMs > endMs ||
        item.endMs <= item.startMs
      )
        fail("Invalid source interval");
    if (
      !r.source.hasAudio &&
      (r.speech.length ||
        r.evidence.some((e) => e.modality !== "visual") ||
        r.audio.evidenceIds.length)
    )
      fail("Silent source cannot support speech or audio evidence");
    const ids = new Set<string>();
    for (const item of [
      ...r.shots,
      ...r.events,
      ...r.narrativeBeats,
      ...r.evidence,
    ]) {
      if (ids.has(item.id)) fail("Duplicate reference ID");
      ids.add(item.id);
    }
    let end = startMs;
    for (const shot of r.shots) {
      if (shot.startMs < end || shot.endMs <= shot.startMs)
        fail("Shots overlap or have no duration");
      if (r.analysis?.detail === "recreate" && !shot.details)
        fail("Recreate analysis requires complete shot details");
      if (!shot.evidenceIds.length) fail("Shot requires evidence");
      end = shot.endMs;
    }
    const evidence = new Map(r.evidence.map((e) => [e.id, e]));
    for (const item of [
      ...r.shots,
      ...r.events,
      ...r.narrativeBeats,
      ...r.speech,
      r.visualStyle,
      r.audio,
    ]) {
      for (const evidenceId of item.evidenceIds) {
        const e = evidence.get(evidenceId);
        if (!e) fail("Unknown evidence ID");
        else if (
          "startMs" in item &&
          (e.endMs <= item.startMs || e.startMs >= item.endMs)
        )
          fail("Evidence does not support this interval");
      }
    }
    if (
      r.measurements.cutTimesMs.some(
        (t, i, all) =>
          t <= 0 || t >= r.source.durationMs || (i > 0 && t <= all[i - 1]),
      )
    )
      fail("Invalid measured cut times");
  });
export type ReferenceReport = z.infer<typeof referenceReportSchema>;
