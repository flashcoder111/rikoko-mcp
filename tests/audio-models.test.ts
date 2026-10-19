import { expect, it } from "vitest";
import {
  operationSchema,
  compositionSchema,
  isPaidOperation,
} from "../packages/contracts/src/index.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { defaultGenerationModel } from "../packages/core/src/commands.js";

const ticket = {
  requestId: "audio",
  statusUrl: "https://queue.fal.run/status",
  resultUrl: "https://queue.fal.run/result",
  cancelUrl: "https://queue.fal.run/cancel",
};
const profiles = async () =>
  (await import("../packages/providers/src/audio.js")).audioModels;

it("uses paid Eleven v3 by default and rejects local synthesis", () => {
  const input = operationSchema.parse({ kind: "tts", text: "新的配音" });
  expect(input).toMatchObject({ engine: "fal", model: "elevenlabs-voice" });
  expect(isPaidOperation(input)).toBe(true);
  expect(
    operationSchema.safeParse({ kind: "tts", text: "test", engine: "local" })
      .success,
  ).toBe(false);
});

it("keeps new audio profiles disabled until their costs and credentials are confirmed", async () => {
  const models = await profiles();
  expect(models.map((m) => m.category)).toContain("music");
  expect(models.map((m) => m.category)).toContain("sound");
  expect(
    new FalProvider(models, "fixture", true)
      .describe()
      .every((m) => !m.available),
  ).toBe(true);
  const available = new FalProvider(
    models.map((m) => ({ ...m, hardBoundConfirmed: true })),
    "fixture",
    true,
  ).describe();
  expect(
    defaultGenerationModel(available.filter((m) => m.category === "speech"))
      ?.id,
  ).toBe("elevenlabs-voice");
});

it("submits Eleven v3 text, requested voice and normalized language without losing fixed settings", async () => {
  const models = (await profiles()).map((m) => ({
    ...m,
    hardBoundConfirmed: true,
  }));
  let body: any;
  const provider = new FalProvider(models, "fixture", true, async (_, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({
      request_id: "audio",
      status_url: ticket.statusUrl,
      response_url: ticket.resultUrl,
      cancel_url: ticket.cancelUrl,
    });
  });
  await provider.submit(
    operationSchema.parse({
      kind: "tts",
      text: "新的配音",
      voice: "Aria",
      language: "zh-CN",
    }),
  );
  expect(body).toMatchObject({
    text: "新的配音",
    voice: "Aria",
    language_code: "zh",
    stability: 0.5,
  });
  expect(body.prompt).toBeUndefined();
});

it("binds clone audio to an owned reference and retains the reusable provider voice identifier", async () => {
  const models = (await profiles()).map((m) => ({
    ...m,
    hardBoundConfirmed: true,
  }));
  let body: any;
  const provider = new FalProvider(models, "fixture", true, async (_, init) => {
    if (init?.method === "POST") {
      body = JSON.parse(String(init.body));
      return Response.json({
        request_id: "audio",
        status_url: ticket.statusUrl,
        response_url: ticket.resultUrl,
        cancel_url: ticket.cancelUrl,
      });
    }
    return Response.json({
      custom_voice_id: "cloned_voice_123",
      audio: { url: "https://fal.media/preview.mp3" },
    });
  });
  const input = operationSchema.parse({
    kind: "generate",
    model: "minimax-voice-clone",
    mode: "voice_clone",
    prompt: "这是克隆音色试听。",
    references: [{ assetId: "voice", role: "voice" }],
  });
  await provider.submit(input, undefined, [
    { assetId: "voice", role: "voice", url: "data:audio/wav;base64,AAAA" },
  ]);
  expect(body).toMatchObject({
    audio_url: "data:audio/wav;base64,AAAA",
    text: "这是克隆音色试听。",
    model: "speech-02-hd",
  });
  expect(await provider.collect(ticket, input)).toMatchObject({
    kind: "audio",
    voiceClone: {
      voiceId: "cloned_voice_123",
      provider: "minimax",
      reuseModel: "minimax-cloned-speech",
    },
  });
  expect(() =>
    provider.validate(
      operationSchema.parse({ ...input, references: undefined }),
    ),
  ).toThrow();
});

it("fixes music and effect durations and rejects arbitrary client parameter overrides", async () => {
  const models = (await profiles()).map((m) => ({
    ...m,
    hardBoundConfirmed: true,
  }));
  const provider = new FalProvider(models, "fixture", true);
  const music = models.find((m) => m.id === "elevenlabs-music-30s")!;
  const sound = models.find((m) => m.id === "elevenlabs-sound-5s")!;
  expect(music.parameters).toMatchObject({
    music_length_ms: 30000,
    force_instrumental: true,
  });
  expect(sound.parameters).toMatchObject({ duration_seconds: 5 });
  expect(() =>
    provider.validate(
      operationSchema.parse({
        kind: "generate",
        model: music.id,
        prompt: "轻快的背景音乐",
        parameters: { music_length_ms: 600000 },
      }),
    ),
  ).toThrow();
});

it("requires a timed audio asset for sound events and rejects sound beyond the scene", () => {
  const composition = {
    schemaVersion: 1,
    title: "Audio mix",
    width: 144,
    height: 256,
    scenes: [{ id: "scene", durationMs: 2000 }],
    events: [
      {
        id: "sfx",
        sceneId: "scene",
        kind: "sound",
        assetId: "sound",
        offsetMs: 500,
        durationMs: 1000,
        gain: 0.5,
      },
    ],
  };
  expect(compositionSchema.safeParse(composition).success).toBe(true);
  expect(
    compositionSchema.safeParse({
      ...composition,
      events: [{ ...composition.events[0], assetId: undefined }],
    }).success,
  ).toBe(false);
  expect(
    compositionSchema.safeParse({
      ...composition,
      events: [{ ...composition.events[0], offsetMs: 1800 }],
    }).success,
  ).toBe(false);
});

it("uses the documented text field for cloned Speech-02 in both fal adapters", async () => {
  const { FalVideoProvider } =
    await import("../packages/providers/src/fal-video.js");
  for (const Provider of [FalProvider, FalVideoProvider]) {
    let body: any;
    const provider = new Provider(
      (await profiles()).map((m) => ({ ...m, hardBoundConfirmed: true })),
      "fixture",
      true,
      async (_, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          request_id: "audio",
          status_url: ticket.statusUrl,
          response_url: ticket.resultUrl,
          cancel_url: ticket.cancelUrl,
        });
      },
    );
    await provider.submit(
      operationSchema.parse({
        kind: "tts",
        model: "minimax-cloned-speech",
        voiceAssetId: "owned-voice",
        voice: "clone_123",
        text: "新的旁白",
        language: "zh",
      }),
    );
    expect(body).toMatchObject({
      text: "新的旁白",
      voice_setting: { voice_id: "clone_123" },
      language_boost: "Chinese",
    });
    expect(body.prompt).toBeUndefined();
  }
});

it.each([
  [
    "elevenlabs-music-30s",
    "prompt",
    { music_length_ms: 30000, force_instrumental: true },
  ],
  ["elevenlabs-sound-5s", "text", { duration_seconds: 5 }],
])(
  "submits %s with its actual prompt field and fixed duration",
  async (model, field, fixed) => {
    let body: any;
    const provider = new FalProvider(
      (await profiles()).map((m) => ({ ...m, hardBoundConfirmed: true })),
      "fixture",
      true,
      async (_, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          request_id: "audio",
          status_url: ticket.statusUrl,
          response_url: ticket.resultUrl,
          cancel_url: ticket.cancelUrl,
        });
      },
    );
    await provider.submit(
      operationSchema.parse({ kind: "generate", model, prompt: "声音描述" }),
    );
    expect(body).toMatchObject({ [String(field)]: "声音描述", ...fixed });
  },
);

it("does not silently replace an unavailable default speech model", () => {
  expect(
    defaultGenerationModel([
      {
        id: "elevenlabs-voice",
        name: "ElevenLabs Eleven v3",
        kind: "audio",
        category: "speech",
        available: false,
      },
      {
        id: "minimax-voice",
        name: "MiniMax Speech",
        kind: "audio",
        category: "speech",
        available: true,
      },
    ]),
  ).toBeUndefined();
});
