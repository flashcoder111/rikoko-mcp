import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";
import {
  compositionSchema,
  type Context,
  type Entity,
} from "../packages/contracts/src/index.js";
import { starterTemplates } from "../packages/templates/src/starters.js";
import { templateSchema } from "../packages/templates/src/schema.js";
import { applyEdits } from "../packages/core/src/editing.js";
import { srt } from "../packages/render/src/index.js";
import { alignTemplateSpeech } from "../packages/templates/src/speech.js";
import { transcriptSchema } from "../packages/contracts/src/index.js";
import { sceneCaptionInterval } from "../packages/contracts/src/captions.js";
import { bindSceneAssets } from "../packages/templates/src/local-library.js";
import { TemplateClient } from "../packages/cloud-client/src/templates.js";
import { fingerprint } from "../packages/core/src/index.js";

let dir: string, db: Database, service: Service, context: Context, key: string;
let app: ReturnType<typeof createApp>;
let source: Entity, transcript: Entity;
const words = [
  { id: "w0", text: "新品", startMs: 300, endMs: 900 },
  { id: "w1", text: "上市。", startMs: 900, endMs: 1400 },
  { id: "w2", text: "轻巧", startMs: 2100, endMs: 2600 },
  { id: "w3", text: "便携。", startMs: 2600, endMs: 3200 },
  { id: "w4", text: "了解", startMs: 4100, endMs: 4500 },
  { id: "w5", text: "详情。", startMs: 4500, endMs: 5200 },
];
const parameters = { text1: "新品上市", text2: "轻巧便携", text3: "了解详情" };
async function call(name: string, input: unknown = {}, token = key) {
  const response = await app.request(`http://localhost/api/tools/${name}`, {
    method: "POST",
    headers: {
      Host: "localhost",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return { status: response.status, ...((await response.json()) as any) };
}
function request(extra: Record<string, unknown> = {}) {
  return {
    id: "rikoko-starter-product",
    version: 1,
    parameters,
    speech: { assetId: source.id, transcriptAssetId: transcript.id },
    ...extra,
  };
}
async function saveTranscript(
  overrides: Record<string, unknown> = {},
  metadata = { sourceAssetId: source.id },
) {
  return service.registerAsset(
    context.accountId,
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        language: "zh",
        durationMs: 6000,
        words,
        evidence: "precomputed",
        ...overrides,
      }),
    ),
    {
      name: "transcript.json",
      kind: "transcript",
      mime: "application/json",
      metadata,
      provenance: { source: "test-fixture", sourceSha256: source.sha256 },
    },
  );
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rikoko-template-speech-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  key = (await service.createAccount("Speech templates", 0)).key;
  context = await service.authenticate(key);
  app = createApp(service);
  source = await service.registerAsset(
    context.accountId,
    Buffer.from("speech-fixture"),
    {
      name: "voice.wav",
      kind: "audio",
      mime: "audio/wav",
      metadata: { durationMs: 6000, hasAudio: true },
      provenance: { source: "test-fixture" },
    },
  );
  transcript = await saveTranscript();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("optional speech timing in templates", () => {
  it("offers speech on narration templates while ordinary preparation stays silent and free", async () => {
    const catalog = (await call("template_list")).result.templates;
    for (const id of ["product", "tutorial", "list", "software", "testimonial"])
      expect(
        catalog.find((t: any) => t.id === `rikoko-starter-${id}`).speech?.mode,
      ).toBe("optional");
    expect(
      catalog.find((t: any) => t.id === "rikoko-starter-before-after").speech,
    ).toBeUndefined();
    const submit = vi.spyOn(service.provider, "submit");
    const network = vi.spyOn(globalThis, "fetch");
    const result = await call("template_prepare", {
      id: "rikoko-starter-product",
      version: 1,
      parameters,
    });
    expect(result.status).toBe(200);
    expect(
      result.result.composition.scenes.map((s: any) => s.durationMs),
    ).toEqual([3000, 3000, 3000]);
    expect(
      result.result.composition.scenes.every(
        (s: any) => !s.words && !s.audioAssetId,
      ),
    ).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it("uses the real recording to time sentences, scene changes and exported subtitles", async () => {
    const submit = vi.spyOn(service.provider, "submit");
    const prepared = await call("template_prepare", request());
    expect(prepared.status).toBe(200);
    const composition = prepared.result.composition;
    expect(composition.scenes.map((s: any) => s.durationMs)).toEqual([
      2100, 2000, 1900,
    ]);
    expect(composition.scenes.map((s: any) => s.audioSourceStartMs)).toEqual([
      0, 2100, 4100,
    ]);
    expect(
      composition.scenes.every(
        (s: any) => s.audioAssetId === source.id && s.volume === 1,
      ),
    ).toBe(true);
    expect(composition.scenes[1].words).toEqual([
      { ...words[2], startMs: 0, endMs: 500 },
      { ...words[3], startMs: 500, endMs: 1100 },
    ]);
    expect(composition.scenes[0].speechAlignment).toEqual({
      sourceAssetId: source.id,
      transcriptAssetId: transcript.id,
    });
    expect(srt(composition)).toBe(
      "1\n00:00:00,300 --> 00:00:01,400\n新品上市\n\n2\n00:00:02,100 --> 00:00:03,200\n轻巧便携\n\n3\n00:00:04,100 --> 00:00:05,200\n了解详情\n",
    );
    const committed = await call("workspace_commit", {
      action: { type: "create", composition },
      message: "按实际口播编排",
      idempotencyKey: "spoken-template",
    });
    expect(committed.status).toBe(200);
    expect((await call("records_list", { type: "job" })).result).toHaveLength(
      1,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([{ text2: "另一段文案" }, { text2: "" }, { text1: "上市新品" }])(
    "rejects mismatched copy without importing artwork or inventing timings: %j",
    async (changed) => {
      const result = await call(
        "template_prepare",
        request({ parameters: { ...parameters, ...changed } }),
      );
      expect(result.status).toBe(400);
      expect(result.error.code).toBe("SPEECH_TEXT_MISMATCH");
      expect(
        (await call("records_list", { type: "asset" })).result,
      ).toHaveLength(2);
    },
  );

  it("does not split a Chinese timing group across two scene boundaries", async () => {
    transcript = await saveTranscript({
      words: [
        {
          id: "group",
          text: "新品上市轻巧便携了解详情",
          startMs: 300,
          endMs: 5200,
        },
      ],
    });
    const result = await call("template_prepare", request());
    expect(result.status).toBe(400);
    expect(result.error.code).toBe("SPEECH_BOUNDARY_UNAVAILABLE");
  });

  it("keeps identical transcript text separately bound to different recordings", async () => {
    const otherSource = await service.registerAsset(
      context.accountId,
      Buffer.from("another-voice-with-same-words"),
      {
        name: "another.wav",
        kind: "audio",
        mime: "audio/wav",
        metadata: { durationMs: 6000, hasAudio: true },
        provenance: {},
      },
    );
    const bound = await service.registerAsset(
      context.accountId,
      await service.storage.read(transcript.storageKey),
      {
        name: "another-transcript.json",
        kind: "transcript",
        mime: "application/json",
        metadata: { sourceAssetId: otherSource.id },
        provenance: {
          source: "precomputed-fixture",
          sourceSha256: otherSource.sha256,
        },
      },
    );
    expect(bound.id).not.toBe(transcript.id);
    expect(
      (
        await call(
          "template_prepare",
          request({
            speech: { assetId: otherSource.id, transcriptAssetId: bound.id },
          }),
        )
      ).status,
    ).toBe(200);
  });

  it("rejects unrelated, unbound and foreign transcripts before importing artwork", async () => {
    const unbound = await saveTranscript(
      { evidence: "local-real" },
      {} as { sourceAssetId: string },
    );
    const unboundResult = await call(
      "template_prepare",
      request({
        speech: { assetId: source.id, transcriptAssetId: unbound.id },
      }),
    );
    expect(unboundResult.status).toBe(409);
    expect(unboundResult.error.code).toBe("SOURCE_MISMATCH");
    const otherSource = await service.registerAsset(
      context.accountId,
      Buffer.from("different-recording"),
      {
        name: "other.wav",
        kind: "audio",
        mime: "audio/wav",
        metadata: { durationMs: 6000, hasAudio: true },
        provenance: {},
      },
    );
    expect(
      (
        await call(
          "template_prepare",
          request({
            speech: {
              assetId: otherSource.id,
              transcriptAssetId: transcript.id,
            },
          }),
        )
      ).status,
    ).toBe(409);
    const otherKey = (await service.createAccount("Other", 0)).key;
    expect((await call("template_prepare", request(), otherKey)).status).toBe(
      404,
    );
    const reader = (
      await service.issueKey(context, {
        name: "Reader",
        scopes: ["read"],
        budgetCents: 0,
      })
    ).key;
    expect((await call("template_prepare", request(), reader)).status).toBe(
      403,
    );
  });

  it("requires explicit template support, audible source and measured duration", async () => {
    const unsupported = await call(
      "template_prepare",
      request({ id: "rikoko-starter-before-after" }),
    );
    expect(unsupported.status).toBe(400);
    expect(unsupported.error.code).toBe("SPEECH_NOT_SUPPORTED");
    transcript = await saveTranscript({ durationMs: 7000 });
    expect((await call("template_prepare", request())).status).toBe(409);
    await service.scoped(context, "write", (tx) =>
      tx.put({
        ...source,
        metadata: { durationMs: 6000, hasAudio: false },
        kind: "video",
      }),
    );
    expect((await call("template_prepare", request())).status).toBe(400);
  });

  it("does not silently shorten narration to fit an existing video", async () => {
    const video = await service.registerAsset(
      context.accountId,
      Buffer.from("short-video"),
      {
        name: "short.mp4",
        kind: "video",
        mime: "video/mp4",
        metadata: { durationMs: 1000, hasAudio: false },
        provenance: {},
      },
    );
    const result = await call(
      "template_prepare",
      request({ sceneAssets: { "scene-1": video.id } }),
    );
    expect(result.status).toBe(400);
    expect(result.error.code).toBe("INVALID_INTERVAL");
  });
});

describe("reusable speech rules and invalidation", () => {
  it("keeps fades valid when the existing visual fits speech but is shorter than the template", () => {
    const template = templateSchema.parse({
      schemaVersion: 1,
      id: "bound-fade",
      version: 1,
      title: "Fade",
      speech: { mode: "optional" },
      composition: {
        schemaVersion: 1,
        title: "Fade",
        width: 360,
        height: 640,
        scenes: [
          {
            id: "a",
            text: "One",
            durationMs: 3000,
            volumeEnvelope: [
              { timeMs: 0, gain: 0 },
              { timeMs: 200, gain: 1 },
              { timeMs: 2800, gain: 1 },
              { timeMs: 3000, gain: 0 },
            ],
          },
        ],
      },
    });
    const bound = bindSceneAssets(structuredClone(template.composition), {
      a: {
        id: "shorter-visual",
        accountId: context.accountId,
        type: "asset",
        createdAt: new Date().toISOString(),
        kind: "video",
        metadata: { durationMs: 2200 },
      },
    });
    const spoken = transcriptSchema.parse({
      schemaVersion: 1,
      language: "en",
      durationMs: 2000,
      evidence: "precomputed",
      words: [{ id: "one", text: "One", startMs: 100, endMs: 1500 }],
    });
    const aligned = alignTemplateSpeech(
      template,
      bound,
      spoken,
      source,
      transcript.id,
      {},
    );
    expect(aligned.scenes[0].durationMs).toBe(2000);
    expect(aligned.scenes[0].volumeEnvelope?.at(-1)?.timeMs).toBe(2000);
  });

  it("adapts a template's narration fades to the actual spoken scene duration", () => {
    const template = templateSchema.parse({
      schemaVersion: 1,
      id: "fade",
      version: 1,
      title: "Fade",
      speech: { mode: "optional" },
      composition: {
        schemaVersion: 1,
        title: "Fade",
        width: 360,
        height: 640,
        scenes: [
          {
            id: "a",
            text: "One",
            durationMs: 3000,
            volumeEnvelope: [
              { timeMs: 0, gain: 0 },
              { timeMs: 200, gain: 1 },
              { timeMs: 2800, gain: 1 },
              { timeMs: 3000, gain: 0 },
            ],
          },
        ],
      },
    });
    const spoken = transcriptSchema.parse({
      schemaVersion: 1,
      language: "en",
      durationMs: 2000,
      evidence: "precomputed",
      words: [{ id: "one", text: "One", startMs: 100, endMs: 1500 }],
    });
    const aligned = alignTemplateSpeech(
      template,
      template.composition,
      spoken,
      source,
      transcript.id,
      {},
    );
    expect(aligned.scenes[0].volumeEnvelope).toEqual([
      { timeMs: 0, gain: 0 },
      { timeMs: 133, gain: 1 },
      { timeMs: 1867, gain: 1 },
      { timeMs: 2000, gain: 0 },
    ]);
  });

  it("does not assign punctuation-only tokens to both adjacent sentences", () => {
    const template = templateSchema.parse({
      schemaVersion: 1,
      id: "punctuation",
      version: 1,
      title: "Punctuation",
      speech: { mode: "optional" },
      composition: {
        schemaVersion: 1,
        title: "Punctuation",
        width: 360,
        height: 640,
        scenes: [
          { id: "a", text: "One.", durationMs: 1000 },
          { id: "b", text: "Two.", durationMs: 1000 },
        ],
      },
    });
    const spoken = transcriptSchema.parse({
      schemaVersion: 1,
      language: "en",
      durationMs: 2000,
      evidence: "precomputed",
      words: [
        { id: "first", text: "One", startMs: 100, endMs: 500 },
        { id: "dot", text: ".", startMs: 500, endMs: 550 },
        { id: "second", text: "Two.", startMs: 1000, endMs: 1500 },
      ],
    });
    const aligned = alignTemplateSpeech(
      template,
      template.composition,
      spoken,
      source,
      transcript.id,
      {},
    );
    expect(
      aligned.scenes.map((s) => [s.audioSourceStartMs, s.durationMs]),
    ).toEqual([
      [0, 1000],
      [1000, 1000],
    ]);
    expect(aligned.scenes.reduce((sum, s) => sum + s.durationMs, 0)).toBe(2000);
  });

  it("checks cached default cloud video length after resolving its real asset", async () => {
    const video = await service.registerAsset(
      context.accountId,
      Buffer.from("short-default-video"),
      {
        name: "default.mp4",
        kind: "video",
        mime: "video/mp4",
        metadata: { durationMs: 1000, hasAudio: false },
        provenance: {},
      },
    );
    const template = templateSchema.parse({
      schemaVersion: 1,
      id: "cloud-default-video",
      version: 1,
      title: "Default video",
      speech: { mode: "optional" },
      assets: [
        {
          id: "default-video",
          name: "default.mp4",
          sha256: video.sha256,
          bytes: video.bytes,
          license: "fixture",
        },
      ],
      composition: {
        schemaVersion: 1,
        title: "Default video",
        width: 360,
        height: 640,
        scenes: Object.values(parameters).map((text, i) => ({
          id: `scene-${i + 1}`,
          text,
          durationMs: 1000,
          ...(i === 0 ? { assetId: "default-video" } : {}),
        })),
      },
    });
    const origin = "https://templates.example.com";
    await service.scoped(context, "write", (tx) =>
      tx.put({
        id: `catalog-${fingerprint([context.accountId, origin])}`,
        accountId: context.accountId,
        type: "template-cache",
        createdAt: new Date().toISOString(),
        templates: [{ ...template, hash: fingerprint(template) }],
      }),
    );
    const client = new TemplateClient(service, origin, vi.fn());
    await expect(
      client.prepare(context, {
        id: template.id,
        version: 1,
        speech: { assetId: source.id, transcriptAssetId: transcript.id },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INTERVAL" });
  });

  it("applies keyword rules to a cached cloud template and reuses owned media without network", async () => {
    const definition = templateSchema.parse({
      schemaVersion: 1,
      id: "spoken-cloud",
      version: 1,
      title: "Spoken cloud",
      speech: {
        mode: "optional",
        anchors: [{ eventId: "detail", text: "便携" }],
      },
      composition: {
        schemaVersion: 1,
        title: "Spoken",
        width: 360,
        height: 640,
        language: "zh",
        scenes: Object.values(parameters).map((text, i) => ({
          id: `scene-${i + 1}`,
          text,
          durationMs: 3000,
        })),
        events: [
          {
            id: "detail",
            sceneId: "scene-2",
            kind: "card",
            text: "卖点",
            durationMs: 300,
          },
        ],
      },
    });
    const client = new TemplateClient(
      service,
      "https://templates.example.com",
      vi.fn(async () => {
        throw new Error("Preparation must use cached templates");
      }),
    );
    const snapshot = await client.list(context);
    // Seed the same verified catalog cache used by normal manual sync.
    await service.scoped(context, "write", (tx) =>
      tx.put({
        ...snapshot,
        id: `catalog-${fingerprint([context.accountId, "https://templates.example.com"])}`,
        accountId: context.accountId,
        type: "template-cache",
        createdAt: new Date().toISOString(),
        templates: [{ ...definition, hash: fingerprint(definition) }],
      }),
    );
    const prepared = await client.prepare(context, {
      id: definition.id,
      version: 1,
      speech: { assetId: source.id, transcriptAssetId: transcript.id },
    });
    expect(prepared.composition.events[0]).toMatchObject({
      wordId: "w3",
      sceneId: "scene-2",
    });
    expect(prepared.composition.scenes[1].durationMs).toBe(2000);
  });

  it("requires unambiguous existing keyword occurrences and enough event time", () => {
    const template = templateSchema.parse({
      schemaVersion: 1,
      id: "keyword",
      version: 1,
      title: "Keyword",
      speech: {
        mode: "optional",
        anchors: [{ eventId: "card", text: "hello", occurrence: 2 }],
      },
      composition: {
        schemaVersion: 1,
        title: "Keyword",
        width: 360,
        height: 640,
        scenes: [{ id: "a", text: "Hello hello", durationMs: 2000 }],
        events: [
          {
            id: "card",
            sceneId: "a",
            kind: "card",
            text: "Card",
            durationMs: 200,
          },
        ],
      },
    });
    const spoken = transcriptSchema.parse({
      schemaVersion: 1,
      language: "en",
      durationMs: 2000,
      evidence: "precomputed",
      words: [
        { id: "first", text: "Hello", startMs: 100, endMs: 500 },
        { id: "second", text: "hello", startMs: 1200, endMs: 1700 },
      ],
    });
    const result = alignTemplateSpeech(
      template,
      template.composition,
      spoken,
      source,
      transcript.id,
      {},
    );
    expect(result.events[0].wordId).toBe("second");
    template.speech!.anchors[0].text = "missing";
    expect(() =>
      alignTemplateSpeech(
        template,
        template.composition,
        spoken,
        source,
        transcript.id,
        {},
      ),
    ).toThrow(/关键词/);
    template.speech!.anchors[0].text = "hello";
    template.composition.events[0].durationMs = 1000;
    expect(() =>
      alignTemplateSpeech(
        template,
        template.composition,
        spoken,
        source,
        transcript.id,
        {},
      ),
    ).toThrow(/剩余时间/);
  });

  it("keeps aligned captions correct through trim, speed and silent cuts", async () => {
    const prepared = await call("template_prepare", request());
    const original = prepared.result.composition;
    const faster = applyEdits(original, [
      { type: "scene_speed", sceneId: "scene-1", speed: 2 },
    ]);
    expect(sceneCaptionInterval(faster.scenes[0])).toEqual({
      startMs: 150,
      endMs: 700,
    });
    const silent = applyEdits(original, [
      { type: "trim", sceneId: "scene-1", startMs: 0, endMs: 200 },
    ]);
    expect(silent.scenes[0].text).toBe("");
    expect(silent.scenes[0].speechAlignment).toBeUndefined();
    const trim = applyEdits(original, [
      { type: "trim", sceneId: "scene-1", startMs: 900, endMs: 2100 },
    ]);
    expect(trim.scenes[0].text).toBe("上市。");
    expect(sceneCaptionInterval(trim.scenes[0])).toEqual({
      startMs: 0,
      endMs: 500,
    });
    const changed = applyEdits(original, [
      {
        type: "scene_audio",
        sceneId: "scene-1",
        audioAssetId: "new",
        volume: 1,
      },
    ]);
    expect(changed.scenes[0].speechAlignment).toBeUndefined();
  });

  it("validates optional keyword anchors against real template events", () => {
    const {
      sourceKind: _,
      parameterLabels: _p,
      sceneLabels: _s,
      coverAssetId: _c,
      preparation: _pr,
      searchTerms: _st,
      isNew: _n,
      ...definition
    } = starterTemplates[0];
    const raw = {
      ...definition,
      speech: {
        mode: "optional",
        anchors: [{ eventId: "feature", text: "{{text2}}" }],
      },
      composition: {
        ...definition.composition,
        events: [
          {
            id: "feature",
            sceneId: "scene-2",
            kind: "card",
            text: "卖点",
            offsetMs: 0,
            durationMs: 500,
          },
        ],
      },
    };
    expect(templateSchema.safeParse(raw).success).toBe(true);
    expect(
      templateSchema.safeParse({
        ...raw,
        speech: {
          ...raw.speech,
          anchors: [{ eventId: "missing", text: "关键词" }],
        },
      }).success,
    ).toBe(false);
    expect(
      templateSchema.safeParse({
        ...raw,
        speech: {
          ...raw.speech,
          anchors: [{ eventId: "feature", text: "{{unknown}}" }],
        },
      }).success,
    ).toBe(false);
  });

  it("invalidates old words and dependent events on replacement, retaining unrelated overlays", () => {
    const base = compositionSchema.parse({
      schemaVersion: 1,
      title: "Speech",
      width: 360,
      height: 640,
      scenes: [
        {
          id: "a",
          assetId: "picture",
          audioAssetId: "old",
          durationMs: 2000,
          text: "Hello",
          words: [{ id: "w", text: "Hello", startMs: 300, endMs: 900 }],
        },
      ],
      events: [
        {
          id: "spoken",
          sceneId: "a",
          wordId: "w",
          kind: "text",
          text: "Hello",
          durationMs: 500,
        },
        {
          id: "fixed",
          sceneId: "a",
          kind: "card",
          text: "Logo",
          durationMs: 500,
        },
      ],
    });
    const changed = applyEdits(base, [
      { type: "scene_audio", sceneId: "a", audioAssetId: "new", volume: 1 },
    ]);
    expect(changed.scenes[0].words).toBeUndefined();
    expect(changed.events.map((e) => e.id)).toEqual(["fixed"]);
    expect(changed.scenes[0].assetId).toBe("picture");
    expect(base.scenes[0].words).toHaveLength(1);
    expect(
      applyEdits(base, [{ type: "scene_audio", sceneId: "a", volume: 0.5 }])
        .scenes[0].words,
    ).toEqual(base.scenes[0].words);
  });
});
