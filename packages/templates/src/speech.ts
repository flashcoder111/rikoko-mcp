import {
  AppError,
  compositionSchema,
  transcriptSchema,
  type Composition,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import type { Service } from "../../core/src/index.js";
import type { Template } from "./schema.js";

// Match spoken text, never derive timings from character counts. The punctuation
// and spacing may differ between the displayed copy and the ASR transcript.
const normalized = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
type Transcript = ReturnType<typeof transcriptSchema.parse>;

export function alignTemplateSpeech(
  template: Template,
  composition: Composition,
  transcript: Transcript,
  source: Entity,
  transcriptAssetId: string,
  parameters: Record<string, string>,
) {
  if (!template.speech)
    throw new AppError(
      "SPEECH_NOT_SUPPORTED",
      "此模板按画面节奏编排，请选择支持口播的模板。",
    );
  const scripts = composition.scenes.map((s) => normalized(s.text));
  if (
    scripts.some((s) => !s) ||
    scripts.join("") !==
      normalized(transcript.words.map((w) => w.text).join(""))
  )
    throw new AppError(
      "SPEECH_TEXT_MISMATCH",
      "模板分句与实际口播不一致，请使用实际转写文字或提供对应的新配音。",
    );
  let character = 0;
  const spans = transcript.words
    .filter((w) => normalized(w.text).length > 0)
    .map((w) => {
      const start = character;
      character += normalized(w.text).length;
      return { start, end: character, word: w };
    });
  const next = structuredClone(composition);
  next.language = transcript.language;
  character = 0;
  for (const [index, scene] of next.scenes.entries()) {
    const start = character;
    character += scripts[index].length;
    if (spans.some((s) => s.start < character && s.end > character))
      throw new AppError(
        "SPEECH_BOUNDARY_UNAVAILABLE",
        "分句落在同一个中文词组时间内，请调整分句或提供更细的真实对齐结果。",
      );
    const selected = spans
      .filter((s) => s.start >= start && s.end <= character)
      .map((s) => s.word);
    const sourceStart = index === 0 ? 0 : selected[0].startMs;
    const following = spans.find(
      (s) => s.start === character && s.end > character,
    );
    const sourceEnd = following?.word.startMs ?? transcript.durationMs;
    // Visual binding can already have shortened the draft; envelope points still
    // belong to the original template's timeline.
    const originalDuration =
      template.composition.scenes.find((s) => s.id === scene.id)?.durationMs ??
      scene.durationMs;
    scene.durationMs = sourceEnd - sourceStart;
    if (scene.durationMs < 100)
      throw new AppError(
        "INVALID_INTERVAL",
        "口播分句不足 0.1 秒，请合并相邻语句。",
      );
    if (scene.volumeEnvelope?.length)
      scene.volumeEnvelope = [
        ...new Map(
          scene.volumeEnvelope.map((point) => [
            Math.round((point.timeMs * scene.durationMs) / originalDuration),
            point.gain,
          ]),
        ).entries(),
      ].map(([timeMs, gain]) => ({ timeMs, gain }));
    scene.audioAssetId = source.id;
    scene.audioSourceStartMs = sourceStart;
    scene.speed = 1;
    scene.volume = 1;
    scene.words = selected.map((w) => ({
      ...w,
      startMs: w.startMs - sourceStart,
      endMs: w.endMs - sourceStart,
    }));
    scene.speechAlignment = { sourceAssetId: source.id, transcriptAssetId };
  }
  const anchored = new Set(template.speech.anchors.map((a) => a.eventId));
  // A fixed-time overlay in a speech template needs an explicit anchor rather
  // than being silently stretched or moved after its scene duration changes.
  for (const event of next.events) {
    const scene = next.scenes.find((s) => s.id === event.sceneId)!;
    const rule = template.speech.anchors.find((a) => a.eventId === event.id);
    if (event.wordId && !rule)
      throw new AppError(
        "SPEECH_ANCHOR_REQUIRED",
        "替换口播时，请用关键词规则重新绑定模板中的词事件。",
      );
    if (rule) {
      const phrase = normalized(
        rule.text.replace(
          /\{\{([^{}]+)\}\}/g,
          (_, key: string) =>
            parameters[key] ?? template.parameters[key].default,
        ),
      );
      const text = scene.words!.map((w) => normalized(w.text)).join("");
      let at = -1;
      for (let i = 0; i < rule.occurrence; i++) {
        at = text.indexOf(phrase, at + 1);
        if (at < 0 || !phrase)
          throw new AppError(
            "SPEECH_ANCHOR_NOT_FOUND",
            "口播中找不到模板事件对应的关键词。",
          );
      }
      let end = 0;
      const word = scene.words!.find((w) => {
        end += normalized(w.text).length;
        return end > at;
      })!;
      event.wordId = word.id;
    }
    const start =
      (scene.words?.find((w) => w.id === event.wordId)?.startMs ?? 0) +
      event.offsetMs;
    if (start + event.durationMs > scene.durationMs)
      throw new AppError(
        "INVALID_INTERVAL",
        anchored.has(event.id)
          ? "关键词后剩余时间不足以播放此事件，请调整事件长度。"
          : "口播改变了镜头长度，请为叠加内容设置关键词规则或调整时间。",
      );
  }
  return compositionSchema.parse(next);
}

export async function prepareTemplateSpeech(
  service: Service,
  c: Context,
  template: Template,
  composition: Composition,
  input: { assetId: string; transcriptAssetId: string } | undefined,
  parameters: Record<string, string>,
) {
  if (!input) return composition;
  if (!template.speech)
    throw new AppError("SPEECH_NOT_SUPPORTED", "此模板尚未声明口播对齐支持。");
  const source = await service.get(c, "asset", input.assetId);
  const asset = await service.get(c, "asset", input.transcriptAssetId);
  if (
    !["audio", "video"].includes(source.kind) ||
    !source.metadata?.hasAudio ||
    !Number.isSafeInteger(source.metadata.durationMs) ||
    source.metadata.durationMs <= 0
  )
    throw new AppError(
      "INVALID_MEDIA",
      "口播需要已测量时长且包含音轨的音频或视频。",
    );
  if (asset.kind !== "transcript" || asset.bytes > 2 * 1024 * 1024)
    throw new AppError("INVALID_TRANSCRIPT", "请选择对应口播的转写素材。");
  if (
    asset.metadata?.sourceAssetId !== source.id ||
    (asset.provenance?.sourceSha256 &&
      asset.provenance.sourceSha256 !== source.sha256)
  )
    throw new AppError(
      "SOURCE_MISMATCH",
      "转写未绑定此口播素材，请先转写对应的最终音频。",
      409,
    );
  const bytes = await service.storage.read(asset.storageKey);
  if (bytes.byteLength > 2 * 1024 * 1024)
    throw new AppError("INVALID_TRANSCRIPT", "转写素材过大。");
  const transcript = transcriptSchema.parse(
    JSON.parse(Buffer.from(bytes).toString("utf8")),
  );
  if (transcript.durationMs !== source.metadata.durationMs)
    throw new AppError(
      "SOURCE_MISMATCH",
      "转写时长与口播源素材不一致，请重新转写。",
      409,
    );
  return alignTemplateSpeech(
    template,
    composition,
    transcript,
    source,
    asset.id,
    parameters,
  );
}

export function validateSpeechVisuals(
  composition: Composition,
  bindings: Record<string, Entity>,
) {
  for (const scene of composition.scenes) {
    const asset = bindings[scene.id];
    if (
      scene.speechAlignment &&
      asset?.kind === "video" &&
      (!Number.isSafeInteger(asset.metadata?.durationMs) ||
        scene.sourceStartMs + scene.durationMs * (scene.speed ?? 1) >
          asset.metadata.durationMs)
    )
      throw new AppError(
        "INVALID_INTERVAL",
        "已有画面短于口播分句，请补足画面或调整分句，不能截断口播。",
      );
  }
}
