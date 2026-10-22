import { z } from "zod";
import {
  AppError,
  idSchema,
  type Composition,
  type Entity,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
const ms = z.number().int().min(0).max(600000);
const reason = z.string().trim().min(1).max(1000);
export const productionEditingSchema = z
  .object({
    version: z.literal(1),
    audio: z
      .object({
        mode: z.enum(["shared_track", "native", "silent"]),
        assetId: idSchema.optional(),
        sourceSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        gain: z.number().min(0).max(1).default(0.2),
        allowNativeAudio: z.boolean().default(false),
        ending: z.enum(["resolve", "fade_out", "intentional_cut", "silent"]),
        endingReason: reason,
        beatPoints: z
          .array(
            z
              .object({
                id: idSchema,
                timeMs: ms,
                kind: z.enum(["beat", "accent", "phrase"]),
                provenance: z.enum(["manual", "measured"]),
                evidence: reason,
              })
              .strict(),
          )
          .max(300)
          .default([]),
        syncPoints: z
          .array(
            z
              .object({
                shotId: idSchema,
                offsetMs: ms,
                beatId: idSchema,
                toleranceMs: z.number().int().min(0).max(500).default(100),
                description: reason,
              })
              .strict(),
          )
          .max(100)
          .default([]),
      })
      .strict()
      .optional(),
    ending: z
      .object({
        shotIds: z.array(idSchema).min(1).max(10),
        strategy: z.enum(["product_brand", "brand_card", "other"]),
        productVisible: z.boolean(),
        brandText: z.string().trim().min(1).max(200).optional(),
        minHoldMs: z.number().int().min(100).max(10000),
        cta: z.string().trim().min(1).max(200).optional(),
        reason,
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((x) => x.audio || x.ending, "Declare audio and/or ending intent");
export type ProductionEditing = z.infer<typeof productionEditingSchema>;
type EditingPlan = {
  shots: { id: string; durationMs?: number; visualKind?: string }[];
  editing?: ProductionEditing;
};
export type EditingIssue = { code: string; shotId: string; message: string };
export type EditingCutIssue = {
  code: string;
  sceneId?: string;
  severity: "error" | "warning";
  message: string;
};

/** Quality contracts may be revised, but cannot disappear during plan updates or scope rebinding. */
export function assertProductionQualityRetained(
  before: { process?: unknown; editing?: ProductionEditing } | undefined,
  after: { process?: unknown; editing?: ProductionEditing },
) {
  if (
    (before?.process && !after.process) ||
    (before?.editing?.audio && !after.editing?.audio) ||
    (before?.editing?.ending && !after.editing?.ending)
  )
    throw new AppError(
      "PRODUCTION_QUALITY_REQUIRED",
      "Revise the process, audio or ending intent explicitly; do not remove an active production quality contract",
      409,
    );
}

/** Host-owned soundtrack is a final-edit dependency, never an automatic provider upload. */
export async function assertEditingAssets(
  tx: Transaction,
  accountId: string,
  plan: EditingPlan,
) {
  const audio = plan.editing?.audio;
  if (audio?.mode !== "shared_track") return;
  const source = audio.assetId
    ? await tx.get(audio.assetId, accountId, "asset")
    : undefined;
  if (
    !source ||
    !["audio", "video"].includes(source.kind) ||
    !source.metadata?.hasAudio ||
    !Number.isSafeInteger(source.metadata.durationMs) ||
    source.metadata.durationMs <= 0
  )
    throw new AppError(
      "AUDIO_SOURCE_REQUIRED",
      "Bind an owned audible track with a measured duration",
    );
  if (source.sha256 !== audio.sourceSha256)
    throw new AppError(
      "AUDIO_SOURCE_CHANGED",
      "Audio bytes differ from the cue map; read the current asset and rebuild the cues",
      409,
    );
  if (
    audio.beatPoints.some((point) => point.timeMs >= source.metadata.durationMs)
  )
    throw new AppError(
      "BEAT_OUTSIDE_AUDIO",
      "Cue times must fit the exact soundtrack source",
    );
}

/** Only checks declared timing and intent; beat annotations are host evidence, not automatic beat detection. */
export function validateProductionEditing(plan: EditingPlan): EditingIssue[] {
  const editing = plan.editing;
  if (!editing) return [];
  const issues: EditingIssue[] = [];
  const add = (code: string, message: string, shotId = "") =>
    issues.push({ code, message, shotId });
  const audio = editing.audio;
  if (audio) {
    if (
      audio.mode === "shared_track" &&
      (!audio.assetId || !audio.sourceSha256 || audio.gain <= 0)
    )
      add(
        "AUDIO_SOURCE_REQUIRED",
        "Bind the shared track to owned audio bytes and a nonzero mix gain",
      );
    if (
      audio.mode !== "shared_track" &&
      (audio.assetId ||
        audio.sourceSha256 ||
        audio.beatPoints.length ||
        audio.syncPoints.length)
    )
      add(
        "AUDIO_POLICY_CONFLICT",
        "Beat maps and shared assets require shared_track; native or silent cannot borrow unbound beats",
      );
    if (
      audio.mode === "silent" &&
      (audio.allowNativeAudio || audio.gain !== 0 || audio.ending !== "silent")
    )
      add(
        "AUDIO_POLICY_CONFLICT",
        "Intentional silence requires zero gain, no native audio and a silent ending",
      );
    if (audio.mode === "native" && !audio.allowNativeAudio)
      add(
        "AUDIO_POLICY_CONFLICT",
        "Native audio requires allowNativeAudio=true",
      );
    const beatIds = new Set<string>();
    let lastTime = -1;
    for (const beat of audio.beatPoints) {
      if (beatIds.has(beat.id))
        add("DUPLICATE_BEAT", "Beat IDs must be unique");
      if (beat.timeMs <= lastTime)
        add(
          "BEAT_ORDER_INVALID",
          "List distinct audio anchors in ascending source time",
        );
      beatIds.add(beat.id);
      lastTime = beat.timeMs;
    }
    const syncIds = new Set<string>();
    for (const point of audio.syncPoints) {
      const key = `${point.shotId}:${point.offsetMs}`;
      if (syncIds.has(key))
        add(
          "DUPLICATE_SYNC_POINT",
          "Use one declared audio anchor per target instant",
          point.shotId,
        );
      syncIds.add(key);
      const shot = plan.shots.find((s) => s.id === point.shotId);
      if (!shot)
        add(
          "SYNC_SHOT_INVALID",
          "Sync point references an unknown target shot",
          point.shotId,
        );
      else if (
        shot.durationMs === undefined ||
        point.offsetMs >= shot.durationMs
      )
        add(
          "SYNC_POINT_OUTSIDE_SHOT",
          "Supply a duration containing the shot-relative action or cut anchor",
          point.shotId,
        );
      if (!beatIds.has(point.beatId))
        add(
          "SYNC_BEAT_INVALID",
          "Sync point references an unknown audio anchor",
          point.shotId,
        );
    }
  }
  const ending = editing.ending;
  if (ending) {
    if (new Set(ending.shotIds).size !== ending.shotIds.length)
      add("ENDING_SHOT_DUPLICATE", "Ending shot IDs must be unique");
    const suffix = plan.shots.slice(-ending.shotIds.length);
    if (suffix.map((s) => s.id).join("|") !== ending.shotIds.join("|"))
      add(
        "ENDING_NOT_FINAL",
        "Ending shots must be the ordered final shots in the plan",
      );
    if (
      suffix.some((s) => s.durationMs === undefined) ||
      suffix.reduce((n, s) => n + (s.durationMs ?? 0), 0) < ending.minHoldMs
    )
      add(
        "ENDING_HOLD_TOO_SHORT",
        "Budget enough duration for the declared product/brand reading hold",
      );
    if (
      ending.strategy === "product_brand" &&
      (!ending.productVisible || !ending.brandText)
    )
      add(
        "ENDING_INTENT_INCOMPLETE",
        "A product_brand ending needs both product visibility and brand text",
      );
    if (
      ending.productVisible &&
      suffix.every((s) => s.visualKind === "graphic")
    )
      add(
        "ENDING_PRODUCT_REQUIRED",
        "A graphic-only ending cannot promise visible product media",
      );
  }
  return issues;
}

export function editingShotDirection(
  plan: EditingPlan,
  shotId: string,
  concise = false,
): string | undefined {
  const e = plan.editing;
  if (!e) return undefined;
  const lines: string[] = [];
  if (e.audio?.mode === "shared_track")
    lines.push(
      concise
        ? `Do not generate background music.${e.audio.allowNativeAudio ? " Preserve only planned speech and physical sounds." : ""}`
        : `Do not generate background music. The shared score is added in editing.${e.audio.allowNativeAudio ? " Preserve only planned speech and physical sounds for the mix." : " Generated clip audio will be muted in editing."}`,
    );
  if (e.audio?.mode === "silent")
    lines.push(
      "This production is intentionally silent; no music, speech or sound effects.",
    );
  if (e.audio?.mode === "native")
    lines.push(
      `Use native sound intentionally and maintain continuity at cuts. Sound ending: ${e.audio.ending}.`,
    );
  if (e.ending?.shotIds.includes(shotId))
    lines.push(
      `${e.ending.productVisible ? "Keep the finished product visible and stable." : "Use the planned closing visual."} Hold the completed state for at least ${e.ending.minHoldMs} ms. Reserve clean space for text composited later; generate no lettering, titles or captions. No extra process actions during the hold.`,
    );
  return lines.join("\n") || undefined;
}

export function editingTimeline(composition: Composition) {
  let timeMs = 0;
  return composition.scenes.map((scene) => {
    const item = {
      sceneId: scene.id,
      shotId: scene.productionShotId,
      startMs: timeMs,
      endMs: timeMs + scene.durationMs,
    };
    timeMs = item.endMs;
    return item;
  });
}

/** Validates the cut being delivered, not just desired generation lengths. */
export function validateEditingComposition(
  plan: EditingPlan,
  composition: Composition,
  assets: Map<string, Entity>,
): EditingCutIssue[] {
  const e = plan.editing;
  if (!e) return [];
  const issues: EditingCutIssue[] = [];
  const add = (code: string, message: string, sceneId?: string) =>
    issues.push({ code, message, sceneId, severity: "error" });
  const timeline = editingTimeline(composition);
  const total = timeline.at(-1)?.endMs ?? 0;
  const audio = e.audio;
  if (audio) {
    if (audio.mode === "shared_track") {
      const source = assets.get(audio.assetId!);
      if (
        !source ||
        !["audio", "video"].includes(source.kind) ||
        !source.metadata?.hasAudio
      )
        add(
          "AUDIO_SOURCE_REQUIRED",
          "Use the owned audible source bound to this plan",
        );
      else {
        if (source.sha256 !== audio.sourceSha256)
          add(
            "AUDIO_SOURCE_CHANGED",
            "The beat map belongs to different audio bytes; reanalyse and rebind the plan",
          );
        if (source.metadata.durationMs < total)
          add(
            "AUDIO_TRACK_TOO_SHORT",
            "The shared track must cover the entire cut; prepare an intentional complete track rather than silently looping it",
          );
        if (
          audio.beatPoints.some((b) => b.timeMs >= source.metadata.durationMs)
        )
          add(
            "BEAT_OUTSIDE_AUDIO",
            "An audio anchor exceeds the bound source duration",
          );
      }
      if (
        composition.audio?.assetId !== audio.assetId ||
        composition.audio?.gain !== audio.gain ||
        composition.audio?.toneHz !== undefined
      )
        add(
          "AUDIO_TRACK_MISMATCH",
          "Apply the exact planned shared track and gain; changing it invalidates timing evidence",
        );
      for (const point of audio.syncPoints) {
        const ranges = timeline.filter((s) => s.shotId === point.shotId);
        const beat = audio.beatPoints.find((b) => b.id === point.beatId);
        if (!ranges.length || !beat) {
          add("MUSIC_SYNC_MISMATCH", "Missing mapped shot or audio anchor");
          continue;
        }
        if (ranges.some((r, i) => i > 0 && ranges[i - 1].endMs !== r.startMs)) {
          add(
            "SYNC_SHOT_FRAGMENTED",
            "An event offset cannot address noncontiguous occurrences of a shot",
            ranges[0].sceneId,
          );
          continue;
        }
        const eventMs = ranges[0].startMs + point.offsetMs;
        if (
          eventMs >= ranges.at(-1)!.endMs ||
          Math.abs(eventMs - beat.timeMs) > point.toleranceMs
        )
          add(
            "MUSIC_SYNC_MISMATCH",
            `${point.description}: target ${eventMs} ms, source anchor ${beat.timeMs} ms, allowed drift ${point.toleranceMs} ms`,
            ranges[0].sceneId,
          );
      }
    } else if (
      (composition.audio?.gain ?? 0) > 0 &&
      (composition.audio?.assetId || composition.audio?.toneHz)
    ) {
      add(
        audio.mode === "silent"
          ? "AUDIO_SILENCE_REQUIRED"
          : "AUDIO_TRACK_MISMATCH",
        "The composition adds an unplanned global audio layer",
      );
    }
    if (
      audio.mode === "silent" ||
      (audio.mode === "shared_track" && !audio.allowNativeAudio)
    ) {
      for (const scene of composition.scenes) {
        const source = assets.get(scene.audioAssetId ?? scene.assetId ?? "");
        if (
          scene.volume > 0 &&
          (scene.audioAssetId || source?.metadata?.hasAudio) &&
          (!scene.volumeEnvelope?.length ||
            scene.volumeEnvelope.some((p) => p.gain > 0))
        )
          add(
            "UNPLANNED_NATIVE_AUDIO",
            "Mute the independent scene audio or explicitly plan and review its mix",
            scene.id,
          );
      }
    }
    if (audio.mode === "silent")
      for (const event of composition.events) {
        if (event.kind === "sound" && (event.gain ?? 1) > 0)
          add(
            "UNPLANNED_SOUND_EVENT",
            "Remove the sound event from this intentionally silent production",
            event.sceneId,
          );
      }
  }
  const ending = e.ending;
  if (ending) {
    const selected = timeline.filter((s) =>
      ending.shotIds.includes(s.shotId ?? ""),
    );
    const shotOrder = selected
      .map((s) => s.shotId)
      .filter((s, i, a) => i === 0 || s !== a[i - 1]);
    if (
      !selected.length ||
      selected.at(-1)!.endMs !== total ||
      selected.some((s, i) => i > 0 && selected[i - 1].endMs !== s.startMs) ||
      shotOrder.join("|") !== ending.shotIds.join("|")
    )
      add(
        "ENDING_NOT_FINAL",
        "The declared ending must remain the ordered final portion of the rendered cut",
      );
    if (
      selected.reduce((n, s) => n + s.endMs - s.startMs, 0) < ending.minHoldMs
    )
      add(
        "ENDING_HOLD_TOO_SHORT",
        "The final edit shortened the planned product/brand reading hold",
      );
    if (ending.productVisible) {
      const productDuration = composition.scenes
        .filter(
          (s) =>
            ending.shotIds.includes(s.productionShotId ?? "") &&
            s.assetId &&
            ["image", "video"].includes(assets.get(s.assetId)?.kind),
        )
        .reduce((n, s) => n + s.durationMs, 0);
      if (productDuration < ending.minHoldMs)
        add(
          "ENDING_PRODUCT_REQUIRED",
          "Provide product media for the full requested hold, then visually verify it; graphic text alone is insufficient",
        );
    }
  }
  return issues;
}
