import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { openRuntime } from "../apps/server/src/runtime.js";
import { Worker } from "../apps/worker/src/worker.js";
import {
  compositionSchema,
  type Entity,
} from "../packages/contracts/src/index.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { fingerprint } from "../packages/core/src/index.js";
const runtime = await openRuntime();
const { service } = runtime;
const secret = (
  await readFile(join(runtime.dataDir, "local-admin.key"), "utf8")
).trim();
const c = await service.authenticate(secret);
const worker = new Worker(service);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve("artifacts/acceptance", runId);
await mkdir(join(out, "outputs"), { recursive: true });
const results: any[] = [];
let hasFailure = false;
async function runJob(input: unknown, label: string) {
  const quote = await service.quote(c, input);
  const job = await service.submit(c, {
    quoteId: quote.id,
    idempotencyKey: randomUUID(),
    input,
  });
  for (let i = 0; i < 200; i++) {
    await worker.tick();
    const current = await service.get(c, "job", job.id);
    if (current.status === "completed") {
      for (const assetId of current.outputs) {
        const asset = await service.get(c, "asset", assetId);
        await writeFile(
          join(out, "outputs", `${label}-${asset.name}`),
          await service.storage.read(asset.storageKey),
        );
      }
      await writeFile(
        join(out, `${label}-job.json`),
        JSON.stringify(current, null, 2),
      );
      return current;
    }
    if (
      [
        "failed",
        "blocked_external",
        "submission_unknown",
        "cancelled",
      ].includes(current.status)
    )
      throw Error(`${current.status}: ${current.error?.message}`);
  }
  throw Error("Job did not complete");
}
async function render(rev: Entity, label: string) {
  return runJob(
    { kind: "render", revisionId: rev.id, composition: rev.composition },
    label,
  );
}
async function check(caseId: string, fn: () => Promise<any>, note: string) {
  try {
    const data = await fn();
    results.push({
      case_id: caseId,
      criterion_id: "local-code-path",
      mandatory: true,
      status: "PASS",
      evidence_level: "local-real",
      note,
      ...data,
    });
    console.log(`${caseId}: PASS — ${note}`);
    return data;
  } catch (e) {
    hasFailure = true;
    results.push({
      case_id: caseId,
      status: "FAIL",
      failure_reason: e instanceof Error ? e.message : String(e),
    });
    console.error(`${caseId}: FAIL`);
  }
}
try {
  const project = await service.createProject(c, {
    title: "Orbit · 本地验收样片",
    brief: "Original geometric product fiction. No paid requests.",
  });
  const base = await service.addRevision(
    c,
    project.id,
    compositionSchema.parse({
      schemaVersion: 1,
      title: "Orbit · small things, better days",
      width: 360,
      height: 640,
      fps: 24,
      language: "en",
      scenes: [
        {
          id: "hook",
          durationMs: 2000,
          text: "Meet Orbit. Bring a little calm.",
          color: "#173b42",
          words: [
            { id: "meet", text: "Meet", startMs: 100, endMs: 500 },
            { id: "orbit", text: "Orbit", startMs: 650, endMs: 1100 },
          ],
        },
        {
          id: "detail",
          durationMs: 2000,
          text: "A lighter start to every day.",
          color: "#4b394f",
        },
        {
          id: "cta",
          durationMs: 2000,
          text: "Make room for your next story.",
          color: "#263c59",
        },
      ],
      events: [
        {
          id: "product-card",
          sceneId: "hook",
          wordId: "orbit",
          offsetMs: 0,
          durationMs: 800,
          kind: "card",
          text: "ORBIT / YOUR DAILY COMPANION",
        },
      ],
      audio: { toneHz: 220, gain: 0.08 },
    }),
  );
  const first = await check(
    "E00",
    async () => {
      const job = await render(base, "E00");
      return {
        revisionId: base.id,
        assetId: job.outputs[0],
        output_paths: ["outputs/E00-video.mp4", "outputs/E00-captions.srt"],
        input_hashes: [fingerprint(base.composition)],
      };
    },
    "Real local graphics, captions, tone and MP4; no AI inference",
  );
  if (!first) throw Error("E00 is required for subsequent examples");
  await check(
    "E01",
    async () => {
      const plan = await callTool(service, c, "plan_create", {
        projectId: project.id,
        recipe: {
          mode: "reference-remix",
          title: "Orbit travel edition",
          referenceAssetId: first.assetId,
          observations: [
            {
              startMs: 0,
              endMs: 2000,
              observation: "Precomputed: title followed by product card",
            },
          ],
          product: {
            name: "Orbit Travel",
            description: "A fictional travel bottle. Pack light.",
            cta: "Find your own route",
          },
        },
      });
      const rev = await service.get(c, "revision", plan.revisionId);
      await render(rev, "E01");
      return {
        revisionId: rev.id,
        analysis_evidence: "precomputed",
        provider_request_ids: [],
      };
    },
    "Reference/plan/revision/render chain; semantic reference analysis is precomputed",
  );
  await check(
    "E02",
    async () => {
      const plan = await callTool(service, c, "plan_create", {
        projectId: project.id,
        recipe: {
          mode: "from-scratch",
          title: "A fresh start",
          product: {
            name: "Orbit",
            description: "A fictional bottle for everyday adventures.",
            cta: "Make it yours",
          },
        },
      });
      await render(await service.get(c, "revision", plan.revisionId), "E02");
      return { revisionId: plan.revisionId };
    },
    "From brief to original template composition; no new AI image/video claim",
  );
  await check(
    "E03",
    async () => {
      const job = await runJob(
        {
          kind: "trim",
          assetId: first.assetId,
          segments: [
            { startMs: 0, endMs: 1000 },
            { startMs: 4000, endMs: 5000 },
          ],
          width: 360,
          height: 640,
        },
        "E03",
      );
      return {
        editMap: job.editMap,
        selection_evidence: "explicit-time-selection",
      };
    },
    "Real independent clipping with source map and contain framing",
  );
  await check(
    "E04",
    async () => {
      await runJob(
        {
          kind: "captions",
          assetId: first.assetId,
          transcript: {
            schemaVersion: 1,
            language: "en",
            durationMs: 6000,
            words: [
              {
                id: "one",
                text: "Corrected brand: Orbit",
                startMs: 200,
                endMs: 1800,
              },
              {
                id: "two",
                text: "Precomputed transcript",
                startMs: 2300,
                endMs: 4000,
              },
            ],
            evidence: "precomputed",
          },
        },
        "E04",
      );
      return { transcript_evidence: "precomputed" };
    },
    "Real caption burn with original audio stream reuse; ASR not run",
  );
  await check(
    "E05",
    async () => {
      const en = await runJob(
        {
          kind: "tts",
          text: "Meet Orbit. A lighter start to every day.",
          language: "en",
          voice: "default",
          engine: "local",
        },
        "E05-en",
      );
      const zh = await runJob(
        {
          kind: "tts",
          text: "你好，欢迎来到视频工作台。让想法成为下一条视频。",
          language: "zh",
          voice: "default",
          engine: "local",
        },
        "E05-zh",
      );
      return {
        assetIds: [en.outputs[0], zh.outputs[0]],
        engine: "system-tts",
        listening_review: "NOT_RUN",
      };
    },
    "Actual English and Chinese installed system voices",
  );
  await check(
    "E06",
    async () => {
      const scene = await service.revise(c, base.id, {
        type: "scene",
        sceneId: "detail",
        changes: {
          text: "Changed only the second scene.",
          assetId: first.assetId,
          sourceStartMs: 0,
        },
      });
      await render(scene, "E06-scene");
      const style = await service.revise(c, scene.id, {
        type: "style",
        style: { fontSize: 28, color: "#ffd66b", background: "#151a22" },
      });
      await render(style, "E06-style");
      const tts = await runJob(
        {
          kind: "tts",
          text: "Meet Orbit. Bring a little calm to every new adventure, every day.",
          language: "en",
          voice: "default",
          engine: "local",
        },
        "E06-voice",
      );
      const voice = await service.get(c, "asset", tts.outputs[0]);
      const durationMs = Math.max(2500, Math.ceil(voice.metadata.durationMs));
      const revision = await service.revise(c, style.id, {
        type: "scene",
        sceneId: "hook",
        changes: {
          text: "Meet Orbit. Bring a little calm to every new adventure, every day.",
          audioAssetId: voice.id,
          durationMs,
          words: [
            { id: "meet", text: "Meet", startMs: 100, endMs: 400 },
            { id: "orbit", text: "Orbit", startMs: 1500, endMs: 2100 },
          ],
        },
      });
      await render(revision, "E06-voice-revision");
      await writeFile(
        join(out, "outputs", "E06-revision-diff.json"),
        JSON.stringify(
          {
            before: base,
            after: revision,
            alignmentEvidence: "precomputed-anchors",
            unchangedSceneHash: fingerprint(base.composition.scenes[2]),
          },
          null,
          2,
        ),
      );
      return {
        revisionId: revision.id,
        alignment_evidence: "precomputed",
        unchanged_scene_hash: fingerprint(base.composition.scenes[2]),
      };
    },
    "Real single-scene/style/voice changes, immutable versions and shifted word-bound card",
  );
  await check(
    "E07",
    async () => {
      const variants = await service.variants(c, base.id, [
        {
          label: "Morning",
          text: "Make mornings a little lighter.",
          eventBindings: [{ eventId: "product-card", offsetMs: 0 }],
        },
        {
          label: "Travel",
          text: "Pack less. Explore more.",
          eventBindings: [{ eventId: "product-card", offsetMs: 0 }],
        },
        {
          label: "Everyday",
          text: "Your everyday companion.",
          eventBindings: [{ eventId: "product-card", offsetMs: 0 }],
        },
      ]);
      for (let i = 0; i < variants.length; i++)
        await render(variants[i], `E07-hook${i + 1}`);
      const translations = [
        "认识 Orbit，让每一天保持轻盈。",
        "轻巧随行，陪你开启新的旅程。",
        "把好状态带在身边。",
      ];
      const scenes = [];
      for (let i = 0; i < 3; i++) {
        const voice = await runJob(
          {
            kind: "tts",
            text: translations[i],
            language: "zh",
            voice: "default",
            engine: "local",
          },
          `E07-zh-voice${i + 1}`,
        );
        const a = await service.get(c, "asset", voice.outputs[0]);
        scenes.push({
          sceneId: base.composition.scenes[i].id,
          text: translations[i],
          audioAssetId: a.id,
          durationMs: Math.max(1000, a.metadata.durationMs),
        });
      }
      const localized = await service.revise(c, base.id, {
        type: "language",
        eventBindings: [{ eventId: "product-card", offsetMs: 0 }],
        language: "zh",
        scenes,
      });
      await render(localized, "E07-zh");
      return {
        variantIds: variants.map((v) => v.id),
        languageRevisionId: localized.id,
        translation_evidence: "precomputed",
        voice_evidence: "local-real",
      };
    },
    "Three distinct openings and a manually translated, newly voiced Chinese version",
  );
  await writeFile(
    join(out, "service.json"),
    JSON.stringify(await service.usage(c), null, 2),
  );
  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify(
      {
        runId,
        implementationVersion: "0.1.0",
        node: process.version,
        platform: process.platform,
        providerRequests: 0,
        actualPaidCostCents: 0,
        authorizedPaidBudgetCents: 0,
        inputOrigin: "original geometric fixtures + precomputed script/timing",
        git: "not-initialized",
      },
      null,
      2,
    ),
  );
} finally {
  await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2));
  await writeFile(
    join(out, "review.md"),
    "# Review status\nAutomated decode/probe checks executed. Human listening, ASR quality, face tracking, paid providers and real third-party clients remain NOT_RUN. Supplied word anchors and translations are precomputed.\n",
  );
  await writeFile(
    join(out, "report.md"),
    `# Local implementation evidence\n\nRun: ${runId}\n\n${results.map((r) => `- ${r.case_id}: ${r.status} — ${r.note ?? r.failure_reason}`).join("\n")}\n\nThese are local implementation subchecks, not final G0–G6 or full E01–E07 product acceptance. No paid request was made.\n`,
  );
  await writeFile(resolve("artifacts/acceptance/latest.txt"), out + "\n");
  await runtime.db.close();
  console.log(`Evidence: ${out}`);
  if (hasFailure) process.exitCode = 1;
}
