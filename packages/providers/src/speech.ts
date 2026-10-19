import { z } from "zod";
import {
  AppError,
  transcriptSchema,
  type Entity,
} from "../../contracts/src/index.js";

export function speechLanguageCode(language: string) {
  const code = language.split("-")[0].toLowerCase();
  if (!/^[a-z]{2}$/.test(code))
    throw new AppError(
      "UNSUPPORTED_LANGUAGE",
      "Speech language must use an ISO 639-1 code",
    );
  return code;
}

export const speechLanguage = (
  language: string,
  task: "tts" | "transcribe",
) => {
  const languages: Record<string, [string, string]> = {
    zh: ["Chinese", "zho"],
    "zh-CN": ["Chinese", "zho"],
    en: ["English", "eng"],
    "en-US": ["English", "eng"],
    "en-GB": ["English", "eng"],
    ja: ["Japanese", "jpn"],
    ko: ["Korean", "kor"],
    es: ["Spanish", "spa"],
    fr: ["French", "fra"],
    de: ["German", "deu"],
  };
  const value = languages[language];
  if (!value)
    throw new AppError(
      "UNSUPPORTED_LANGUAGE",
      "Select an explicitly supported speech language",
    );
  return value[task === "tts" ? 0 : 1];
};
export function scribeTranscript(raw: unknown, language: string) {
  const result = z
    .object({
      language_code: z.string(),
      words: z
        .array(
          z.object({
            text: z.string(),
            type: z.string(),
            start: z.number().finite().nonnegative().optional(),
            end: z.number().finite().nonnegative().optional(),
            speaker_id: z.string().nullable().optional(),
          }),
        )
        .max(20000),
    })
    .parse(raw);
  if (result.language_code !== speechLanguage(language, "transcribe"))
    throw new AppError(
      "PROVIDER_RESULT_INVALID",
      "Transcription language mismatch",
    );
  const tokens = result.words
    .filter((w) => w.type === "word")
    .map((w, i) => {
      if (w.start === undefined || w.end === undefined)
        throw new AppError(
          "PROVIDER_RESULT_INVALID",
          "Speech word lacks real timestamps",
        );
      return {
        id: `w${i}`,
        text: w.text,
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
        ...(w.speaker_id ? { speaker: w.speaker_id } : {}),
      };
    });
  const words: typeof tokens = [];
  for (const token of tokens) {
    const previous = words.at(-1);
    if (token.startMs === token.endMs) {
      if (
        !previous ||
        previous.endMs !== token.startMs ||
        previous.speaker !== token.speaker
      )
        throw new AppError(
          "PROVIDER_RESULT_INVALID",
          "Untimed token has no adjacent timed speech group",
        );
      const joiner =
        /^(zh|ja|ko)/.test(language) || /^\p{P}+$/u.test(token.text) ? "" : " ";
      previous.text += joiner + token.text;
    } else words.push({ ...token, id: `w${words.length}` });
  }
  return transcriptSchema.parse({
    schemaVersion: 1,
    language,
    durationMs: Math.max(0, ...words.map((w) => w.endMs)),
    words,
    evidence: "provider-live",
  });
}
export function bindTranscript(raw: unknown, source: Entity) {
  if (
    !Number.isSafeInteger(source.metadata?.durationMs) ||
    source.metadata.durationMs <= 0
  )
    throw new AppError(
      "INVALID_MEDIA",
      "Transcription needs measured source duration",
    );
  const transcript = transcriptSchema.parse(raw);
  return transcriptSchema.parse({
    ...transcript,
    durationMs: source.metadata.durationMs,
  });
}
