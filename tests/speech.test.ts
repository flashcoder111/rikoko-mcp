import { expect, it } from "vitest";
import {
  operationSchema,
  isPaidOperation,
} from "../packages/contracts/src/index.js";
import { FalVideoProvider } from "../packages/providers/src/fal-video.js";
import { scribeTranscript } from "../packages/providers/src/speech.js";

const tts = {
  id: "voice",
  endpoint: "fal-ai/minimax/speech-2.8-hd",
  kind: "audio" as const,
  category: "speech" as const,
  maxCostCents: 1,
  priceVersion: "v1",
  hardBoundConfirmed: true,
  parameters: {
    voice_setting: { voice_id: "Wise_Woman", speed: 1 },
    output_format: "url",
  },
};
const stt = {
  ...tts,
  id: "scribe",
  endpoint: "fal-ai/elevenlabs/speech-to-text/scribe-v2",
  kind: "transcript" as const,
  parameters: { diarize: true, tag_audio_events: false },
};
const ticket = {
  requestId: "r",
  statusUrl: "https://queue.fal.run/status",
  resultUrl: "https://queue.fal.run/result",
  cancelUrl: "https://queue.fal.run/cancel",
};

it("routes cloud transcription explicitly while retaining local default", () => {
  const x = operationSchema.parse({
    kind: "transcribe",
    assetId: "a",
    engine: "fal",
    model: "scribe",
    language: "zh",
  });
  expect(isPaidOperation(x)).toBe(true);
  expect(
    isPaidOperation(
      operationSchema.parse({ kind: "transcribe", assetId: "a" }),
    ),
  ).toBe(false);
});
it("sends MiniMax text, explicit language and voice without losing configured settings", async () => {
  let payload: any;
  const p = new FalVideoProvider([tts], "test", true, async (_, init) => {
    payload = JSON.parse(String(init?.body));
    return Response.json({
      request_id: "r",
      status_url: ticket.statusUrl,
      response_url: ticket.resultUrl,
      cancel_url: ticket.cancelUrl,
    });
  });
  await p.submit(
    operationSchema.parse({
      kind: "tts",
      engine: "fal",
      model: "voice",
      language: "zh",
      voice: "Wise_Woman",
      text: "温暖日常",
    }),
  );
  expect(payload).toMatchObject({
    prompt: "温暖日常",
    language_boost: "Chinese",
    voice_setting: { voice_id: "Wise_Woman", speed: 1 },
    output_format: "url",
  });
  expect(payload.text).toBeUndefined();
});
it("converts only actual Scribe words and speaker timestamps, without inventing spacing timings", async () => {
  const p = new FalVideoProvider([stt], "test", true, async () =>
    Response.json({
      text: "你好 世界",
      language_code: "zho",
      words: [
        {
          text: "你好",
          start: 0.1,
          end: 0.6,
          type: "word",
          speaker_id: "speaker_0",
        },
        { text: " ", type: "spacing" },
        { text: "世界", start: 0.8, end: 1.2, type: "word" },
      ],
    }),
  );
  const result = await p.collect(
    ticket,
    operationSchema.parse({
      kind: "transcribe",
      engine: "fal",
      model: "scribe",
      assetId: "a",
      language: "zh",
    }),
  );
  expect(result.kind).toBe("transcript");
  expect("data" in result && (result.data as any).words).toEqual([
    { id: "w0", text: "你好", startMs: 100, endMs: 600, speaker: "speaker_0" },
    { id: "w1", text: "世界", startMs: 800, endMs: 1200 },
  ]);
});
it("binds measured transcript duration and rejects invented or out-of-source timings", async () => {
  const { bindTranscript } =
    await import("../packages/providers/src/speech.js");
  const source: any = {
    id: "a",
    sha256: "hash",
    metadata: { durationMs: 2000 },
  };
  const value = {
    schemaVersion: 1,
    language: "zh",
    durationMs: 1200,
    words: [{ id: "w0", text: "你好", startMs: 100, endMs: 1200 }],
    evidence: "provider-live",
  };
  expect(bindTranscript(value, source).durationMs).toBe(2000);
  expect(() =>
    bindTranscript(
      { ...value, words: [{ ...value.words[0], endMs: 2200 }] },
      source,
    ),
  ).toThrow();
});

it.each(
  [
    [{ text: "你好", type: "word", start: 0 }],
    [{ text: "你好", type: "word", start: 1, end: 0.5 }],
    [
      { text: "你", type: "word", start: 0, end: 1 },
      { text: "好", type: "word", start: 0.5, end: 2 },
    ],
  ].map((words) => ({ words })),
)("rejects missing, reversed and overlapping word times", ({ words }) => {
  expect(() =>
    scribeTranscript({ language_code: "zho", words }, "zh"),
  ).toThrow();
});
it("validates spoken media before submission and refuses silent video", () => {
  const p = new FalVideoProvider([stt], "test", true);
  const input = operationSchema.parse({
    kind: "transcribe",
    engine: "fal",
    model: "scribe",
    assetId: "a",
    language: "zh",
  });
  expect(() =>
    p.validateSource(input, {
      kind: "video",
      mime: "video/mp4",
      bytes: 100,
      metadata: { durationMs: 2000, hasAudio: false },
    } as any),
  ).toThrow();
  expect(() =>
    p.validateSource(input, {
      kind: "audio",
      mime: "audio/mpeg",
      bytes: 100,
      metadata: { durationMs: 2000, hasAudio: true },
    } as any),
  ).not.toThrow();
});

it("keeps zero-duration Chinese tokens by joining their adjacent timed token without inventing time", () => {
  const t = scribeTranscript(
    {
      language_code: "zho",
      words: [
        { text: "光", type: "word", start: 0.1, end: 0.3, speaker_id: "s" },
        { text: "线", type: "word", start: 0.3, end: 0.3, speaker_id: "s" },
        { text: "。", type: "word", start: 0.3, end: 0.3, speaker_id: "s" },
      ],
    },
    "zh",
  );
  expect(t.words).toEqual([
    { id: "w0", text: "光线。", startMs: 100, endMs: 300, speaker: "s" },
  ]);
});
