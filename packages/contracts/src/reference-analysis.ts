import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const ms = z.number().int().min(0).max(3_600_000);
const text = z.string().min(1).max(2000);
const interval = { startMs: ms, endMs: ms };
const references = { evidenceIds: z.array(id).max(30) };
export const referenceOperationSchema = z
  .object({
    kind: z.literal("reference_analyze"),
    assetId: id,
    model: z.string().min(1).max(120),
    purpose: z.enum(["remake", "clip", "inspect"]).default("remake"),
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
export const REFERENCE_ANALYSIS_VERSION = "reference-v2.1";
export const referenceContentSchema = z
  .object({
    summary: z.string().min(1).max(5000),
    shots: z
      .array(
        z
          .object({
            id,
            ...interval,
            description: text,
            framing: text,
            cameraMotion: text,
            action: text,
            transition: text,
            ...references,
          })
          .strict(),
      )
      .min(1)
      .max(100),
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
export const referenceReportSchema = referenceContentSchema
  .extend({
    schemaVersion: z.literal(2),
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
        fps: z.number().positive().max(30),
        mode: z.literal("static_video_and_audio"),
        timing: z.literal("model_estimated"),
        gaps: z.array(z.object(interval).strict()).max(101),
      })
      .strict(),
    provenance: z
      .object({
        provider: text,
        model: text,
        endpoint: text,
        requestId: text,
        jobId: id,
        analysisVersion: text,
        priceVersion: text,
        analyzedAt: z.string().datetime(),
        evidence: z.literal("provider-live"),
      })
      .strict(),
    measurements: timingSchema,
  })
  .strict()
  .superRefine((r, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const { startMs, endMs } = r.coverage;
    if (endMs <= startMs || endMs > r.source.durationMs)
      fail("Coverage exceeds source");
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
      if (shot.startMs < end || shot.endMs - shot.startMs < 100)
        fail("Shots overlap or are shorter than 100ms");
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
