import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { resolveTimeline } from "../packages/render/src/index.js";
import { compositionSchema } from "../packages/contracts/src/index.js";

export const composition = {
  schemaVersion: 1 as const,
  title: "Orbit bottle",
  width: 360,
  height: 640,
  fps: 24,
  language: "en",
  scenes: [
    {
      id: "opening",
      durationMs: 1000,
      color: "#173b42",
      text: "Meet Orbit",
      words: [
        { id: "w1", text: "Meet", startMs: 0, endMs: 400 },
        { id: "w2", text: "Orbit", startMs: 400, endMs: 900 },
      ],
    },
    {
      id: "detail",
      durationMs: 1000,
      color: "#4b394f",
      text: "Made for your day",
    },
  ],
  events: [
    {
      id: "card",
      sceneId: "opening",
      wordId: "w2",
      offsetMs: 0,
      durationMs: 300,
      text: "Orbit",
      kind: "card",
    },
  ],
  captionStyle: { fontSize: 24, color: "#ffffff", background: "#151a22" },
  audio: { toneHz: 220, gain: 0.08 },
};
let dir: string, db: Database, service: Service, context: any;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "video-test-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  const bootstrap = await service.createAccount("Test", 1000);
  context = await service.authenticate(bootstrap.key);
});
afterEach(async () => {
  await db?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("authorization, budgets and durable jobs", () => {
  it("stores key digests and enforces scopes, revocation and tenant ownership", async () => {
    const other = await service.createAccount("Other", 100);
    const project = await service.createProject(context, { title: "Private" });
    await expect(
      service.get(await service.authenticate(other.key), "project", project.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const key = await service.issueKey(context, {
      name: "read only",
      scopes: ["read"],
      budgetCents: 10,
    });
    const read = await service.authenticate(key.key);
    await expect(
      service.createProject(read, { title: "No" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await service.revokeKey(context, key.id);
    await expect(service.authenticate(key.key)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("concurrent identical submissions create exactly one job and conflicting inputs fail", async () => {
    const input = { kind: "render", composition };
    const quote = await service.quote(context, input);
    const jobs = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.submit(context, {
          quoteId: quote.id,
          idempotencyKey: "same",
          input,
        }),
      ),
    );
    expect(new Set(jobs.map((j) => j.id)).size).toBe(1);
    const different = {
      kind: "render",
      composition: { ...composition, title: "Different" },
    };
    const q2 = await service.quote(context, different);
    await expect(
      service.submit(context, {
        quoteId: q2.id,
        idempotencyKey: "same",
        input: different,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await service.usage(context)).reservedCents).toBe(0);
  });
  it("binds a quote to its input and rejects unavailable paid models without submitting", async () => {
    const input = { kind: "render", composition };
    const q = await service.quote(context, input);
    await expect(
      service.submit(context, {
        quoteId: q.id,
        idempotencyKey: "tamper",
        input: { ...input, composition: { ...composition, title: "Tampered" } },
      }),
    ).rejects.toMatchObject({ code: "QUOTE_MISMATCH" });
    await expect(
      service.quote(context, {
        kind: "generate",
        model: "unknown",
        prompt: "bottle",
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });
  it("cancels a queued task and does not resurrect it on repeated requests", async () => {
    const input = { kind: "render", composition };
    const q = await service.quote(context, input);
    const job = await service.submit(context, {
      quoteId: q.id,
      idempotencyKey: "cancel",
      input,
    });
    expect((await service.cancel(context, job.id)).status).toBe("cancelled");
    expect(
      (
        await service.submit(context, {
          quoteId: q.id,
          idempotencyKey: "cancel",
          input,
        })
      ).id,
    ).toBe(job.id);
    expect(await service.claim("test-worker")).toBeNull();
  });
  it("persists jobs across a database restart", async () => {
    await db.close();
    db = await Database.open(join(dir, "db"));
    service = new Service(db, new LocalStorage(join(dir, "files")));
    const user = await service.createAccount("Persistent", 0);
    context = await service.authenticate(user.key);
    const input = { kind: "render", composition };
    const q = await service.quote(context, input);
    const job = await service.submit(context, {
      quoteId: q.id,
      idempotencyKey: "persist",
      input,
    });
    await db.close();
    db = await Database.open(join(dir, "db"));
    service = new Service(db, new LocalStorage(join(dir, "files")));
    expect(
      (await service.get(await service.authenticate(user.key), "job", job.id))
        .status,
    ).toBe("queued");
  });
});

describe("immutable revisions and semantic timing", () => {
  it("replaces one scene, preserves others and keeps prior revisions unchanged", async () => {
    const project = await service.createProject(context, { title: "Orbit" });
    const first = await service.addRevision(context, project.id, composition);
    const next = await service.revise(context, first.id, {
      type: "scene",
      sceneId: "detail",
      changes: { text: "New second scene" },
    });
    expect(next.composition.scenes[0]).toEqual(first.composition.scenes[0]);
    expect(next.parentId).toBe(first.id);
    expect(
      (await service.get(context, "revision", first.id)).composition.scenes[1]
        .text,
    ).toBe("Made for your day");
  });
  it("moves word-bound events and downstream scenes when narration grows", () => {
    const parsed = compositionSchema.parse(composition);
    const old = resolveTimeline(parsed);
    const longer = structuredClone(parsed);
    longer.scenes[0]!.durationMs = 2000;
    longer.scenes[0]!.words![1]!.startMs = 1200;
    longer.scenes[0]!.words![1]!.endMs = 1800;
    const next = resolveTimeline(longer);
    expect(next.scenes[1]!.startMs - old.scenes[1]!.startMs).toBe(1000);
    expect(next.events[0]!.startMs - old.events[0]!.startMs).toBe(800);
  });
  it("makes independent variants and refuses stale voice audio after script edits", async () => {
    const p = await service.createProject(context, { title: "Variants" });
    const base = await service.addRevision(context, p.id, composition);
    const variants = await service.variants(context, base.id, [
      {
        label: "A",
        text: "First hook",
        eventBindings: [{ eventId: "card", offsetMs: 0 }],
      },
      {
        label: "B",
        text: "Second hook",
        eventBindings: [{ eventId: "card", offsetMs: 0 }],
      },
    ]);
    expect(variants[0].id).not.toBe(variants[1].id);
    const revised = await service.revise(context, variants[0].id, {
      type: "scene",
      sceneId: "opening",
      changes: { text: "Only A" },
    });
    expect(revised.composition.scenes[0].text).toBe("Only A");
    expect(
      (await service.get(context, "revision", variants[1].id)).composition
        .scenes[0].text,
    ).toBe("Second hook");
  });
});

it("never silently drops a word-bound graphic when the script loses its anchor", async () => {
  const p = await service.createProject(context, { title: "Anchors" });
  const r = await service.addRevision(context, p.id, composition);
  await expect(
    service.revise(context, r.id, {
      type: "scene",
      sceneId: "opening",
      changes: { text: "A different line" },
    }),
  ).rejects.toMatchObject({ code: "ALIGNMENT_REQUIRED" });
});

it("preserves color, framing, source offset and volume on a text-only patch", async () => {
  const p = await service.createProject(context, { title: "Patch" });
  const r = await service.addRevision(context, p.id, {
    ...composition,
    events: [],
    scenes: [
      {
        id: "one",
        durationMs: 1000,
        text: "Before",
        color: "#654321",
        sourceStartMs: 500,
        fit: "cover",
        volume: 0.3,
      },
    ],
  });
  const next = await service.revise(context, r.id, {
    type: "scene",
    sceneId: "one",
    changes: { text: "After" },
  });
  expect(next.composition.scenes[0]).toMatchObject({
    color: "#654321",
    sourceStartMs: 500,
    fit: "cover",
    volume: 0.3,
  });
});

it("creates a voiced language revision with explicit new event bindings without mutating its source", async () => {
  const p = await service.createProject(context, { title: "Languages" });
  const base = await service.addRevision(context, p.id, composition);
  const audio = await service.registerAsset(
    context.accountId,
    new Uint8Array([4, 5, 6]),
    {
      name: "voice.wav",
      kind: "audio",
      mime: "audio/wav",
      metadata: { durationMs: 1500 },
      provenance: { evidence: "contract-mock" },
    },
  );
  const localized = await service.revise(context, base.id, {
    type: "language",
    language: "zh",
    eventBindings: [{ eventId: "card", offsetMs: 200 }],
    scenes: [
      {
        sceneId: "opening",
        text: "认识奥比特",
        audioAssetId: audio.id,
        durationMs: 1500,
      },
      {
        sceneId: "detail",
        text: "开启新的一天",
        audioAssetId: audio.id,
        durationMs: 1500,
      },
    ],
  });
  expect(localized.composition.language).toBe("zh");
  expect(localized.composition.events[0].wordId).toBeUndefined();
  expect(localized.composition.events[0].offsetMs).toBe(200);
  expect(
    (await service.get(context, "revision", base.id)).composition.language,
  ).toBe("en");
});
