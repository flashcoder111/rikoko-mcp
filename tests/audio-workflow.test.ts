import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage, sha256 } from "../packages/storage/src/index.js";
import { completeUpload } from "../packages/core/src/assets.js";
import { audioModels } from "../packages/providers/src/audio.js";
import { FalProvider } from "../packages/providers/src/index.js";
import { Worker } from "../apps/worker/src/worker.js";
import { callTool } from "../packages/mcp/src/tools.js";
import {
  compositionSchema,
  type Context,
  type Entity,
} from "../packages/contracts/src/index.js";
import { applyEdits } from "../packages/core/src/editing.js";

const downloads = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("../packages/storage/src/download.js", () => ({
  downloadPublic: async (url: string) => downloads.get(url)!,
}));
let root: string,
  dir: string,
  db: Database,
  service: Service,
  context: Context,
  source: Entity;
let audioBytes: Buffer, posts: any[];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rikoko-audio-"));
  const path = join(root, "reference.wav");
  await promisify(execFile)("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=32000:duration=12",
    path,
  ]);
  audioBytes = await readFile(path);
  downloads.set("https://fal.media/audio.wav", audioBytes);
});
beforeEach(async () => {
  dir = await mkdtemp(join(root, "case-"));
  db = await Database.open();
  posts = [];
  const provider = new FalProvider(
    audioModels.map((m) => ({
      ...m,
      hardBoundConfirmed: true,
      maxCostCents: 10,
      priceVersion: "fixture",
    })),
    "fixture",
    true,
    async (_url, init) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return Response.json({
          request_id: "audio",
          status_url: "https://queue.fal.run/status",
          response_url: "https://queue.fal.run/result",
          cancel_url: "https://queue.fal.run/cancel",
        });
      }
      return String(_url).endsWith("/status")
        ? Response.json({ status: "COMPLETED" })
        : Response.json({
            custom_voice_id: "cloned_voice_123",
            audio: { url: "https://fal.media/audio.wav" },
          });
    },
  );
  service = new Service(db, new LocalStorage(dir), provider);
  context = await service.authenticate(
    (await service.createAccount("Audio workflow", 100)).key,
  );
  const intent = await service.createUpload(context, {
    name: "reference.wav",
    bytes: audioBytes.length,
    sha256: sha256(audioBytes),
    source: "synthetic-test-tone-not-speech",
    license: "original",
    rightsConfirmed: true,
  });
  source = await completeUpload(service, context, intent.id, audioBytes);
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

it("removes local synthesis and publishes native-audio preservation and the default speech model", async () => {
  const caps = await callTool(service, context, "capabilities", {});
  expect(caps.speech.localSynthesis).toBeUndefined();
  expect(caps.speech.defaultSynthesisModel).toBe("elevenlabs-voice");
  expect(caps.speech.nativeVideoAudio).toBe("preserve-when-present");
  expect(caps.speech.cloning[0].id).toBe("minimax-voice-clone");
  expect(caps.audio.music[0].id).toBe("elevenlabs-music-30s");
  expect(caps.audio.soundEffects[0].id).toBe("elevenlabs-sound-5s");
  await expect(
    service.quote(context, { kind: "tts", text: "test", engine: "local" }),
  ).rejects.toThrow();
  expect(posts).toHaveLength(0);
});

it("clones once, retains the reusable identity, denies foreign access and synthesizes through the compatible profile", async () => {
  const input = {
    kind: "generate",
    model: "minimax-voice-clone",
    mode: "voice_clone",
    prompt: "克隆音色试听",
    references: [{ assetId: source.id, role: "voice" }],
  };
  const quote = await service.quote(context, input);
  expect(posts).toHaveLength(0);
  const job = await service.submit(context, {
    input,
    quoteId: quote.id,
    idempotencyKey: "clone-once",
  });
  const worker = new Worker(service);
  await worker.tick();
  const completed = await service.get(context, "job", job.id);
  expect(completed.status).toBe("completed");
  const clone = await service.get(context, "asset", completed.outputs[0]);
  expect(clone.provenance.voiceClone).toMatchObject({
    voiceId: "cloned_voice_123",
    reuseModel: "minimax-cloned-speech",
  });
  expect(
    (
      await service.submit(context, {
        input,
        quoteId: quote.id,
        idempotencyKey: "clone-once",
      })
    ).id,
  ).toBe(job.id);
  const tts = {
    kind: "tts",
    model: "minimax-cloned-speech",
    text: "修改后的旁白",
    voice: "cloned_voice_123",
    voiceAssetId: clone.id,
    language: "zh",
  };
  await expect(
    service.quote(context, { ...tts, model: "elevenlabs-voice" }),
  ).rejects.toMatchObject({ code: "VOICE_PROFILE_MISMATCH" });
  const foreign = await service.authenticate(
    (await service.createAccount("Other", 100)).key,
  );
  await expect(service.quote(foreign, tts)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const nextQuote = await service.quote(context, tts);
  const next = await service.submit(context, {
    input: tts,
    quoteId: nextQuote.id,
    idempotencyKey: "reuse-clone",
  });
  await worker.tick();
  expect((await service.get(context, "job", next.id)).status).toBe("completed");
  expect(posts).toHaveLength(2);
  expect(posts[0]).toMatchObject({
    text: "克隆音色试听",
    audio_url: expect.stringMatching(/^data:audio\/wav;base64,/),
  });
  expect(posts[1]).toMatchObject({
    text: "修改后的旁白",
    voice_setting: { voice_id: "cloned_voice_123", speed: 1 },
    language_boost: "Chinese",
  });
});

it("adds, trims and removes effects without replacing narration or music", () => {
  const base = compositionSchema.parse({
    schemaVersion: 1,
    title: "Mix",
    width: 144,
    height: 256,
    scenes: [{ id: "a", durationMs: 3000, audioAssetId: "narration" }],
    audio: { assetId: "music", gain: 0.2 },
  });
  const mixed = applyEdits(base, [
    {
      type: "sound",
      sceneId: "a",
      eventId: "sfx",
      assetId: source.id,
      offsetMs: 500,
      durationMs: 2000,
      gain: 0.7,
      audioSourceStartMs: 1000,
    },
  ]);
  expect(mixed.scenes[0].audioAssetId).toBe("narration");
  expect(mixed.audio).toEqual(base.audio);
  const trimmed = applyEdits(mixed, [
    { type: "trim", sceneId: "a", startMs: 1000, endMs: 3000 },
  ]);
  expect(trimmed.events[0]).toMatchObject({
    kind: "sound",
    offsetMs: 0,
    durationMs: 1500,
    audioSourceStartMs: 1500,
  });
  expect(
    applyEdits(mixed, [
      {
        type: "sound",
        sceneId: "a",
        eventId: "sfx",
        assetId: null,
        offsetMs: 0,
        gain: 1,
        audioSourceStartMs: 0,
      },
    ]).events,
  ).toEqual([]);
});

it("rejects invalid sound sources and foreign clone references before purchasing", async () => {
  const input = {
    kind: "generate",
    model: "minimax-voice-clone",
    mode: "voice_clone",
    prompt: "test",
    references: [{ assetId: source.id, role: "voice" }],
  };
  const foreign = await service.authenticate(
    (await service.createAccount("Other", 100)).key,
  );
  await expect(service.quote(foreign, input)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const composition = {
    schemaVersion: 1,
    title: "Sound limit",
    width: 144,
    height: 256,
    scenes: [{ id: "a", durationMs: 3000 }],
    events: [
      {
        id: "sfx",
        sceneId: "a",
        kind: "sound",
        assetId: source.id,
        durationMs: 1000,
        audioSourceStartMs: 12000,
      },
    ],
  };
  await expect(
    service.quote(context, { kind: "render", composition }),
  ).rejects.toMatchObject({ code: "INVALID_INTERVAL" });
  expect(posts).toHaveLength(0);
});
