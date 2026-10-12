import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Service, fingerprint } from "../../../packages/core/src/index.js";
import { mimeFor } from "../../../packages/core/src/assets.js";
import {
  AppError,
  isPaidOperation,
  compositionSchema,
  transcriptSchema,
  type Entity,
  type Operation,
} from "../../../packages/contracts/src/index.js";
import { media, probeSchema } from "../../../packages/render/src/media.js";
import { editMap } from "../../../packages/render/src/index.js";
import { downloadPublic } from "../../../packages/storage/src/download.js";
import { SubmissionUnknown } from "../../../packages/providers/src/index.js";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class Worker {
  private id = randomUUID();
  private stopped = false;
  constructor(private service: Service) {}
  stop() {
    this.stopped = true;
  }
  async loop() {
    while (!this.stopped) {
      const did = await this.tick().catch((e) => {
        console.error(
          "Worker error",
          e instanceof AppError ? e.code : "INTERNAL",
        );
        return false;
      });
      if (!did) await delay(750);
    }
  }
  async tick() {
    let job = await this.service.claim(this.id);
    if (!job) return false;
    const input = job.input as Operation;
    const lease = job.leaseToken;
    const abort = new AbortController();
    const work = await mkdtemp(join(tmpdir(), "video-media-"));
    let busy = false;
    const heartbeat = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        job = await this.service.checkpoint(job!.id, lease, {});
        if (job.cancelRequested) abort.abort();
      } catch {
        abort.abort();
      } finally {
        busy = false;
      }
    }, 1000);
    const checkpoint = async (changes: Record<string, unknown>) => {
      job = await this.service.checkpoint(job!.id, lease, changes);
      if (job.cancelRequested) abort.abort();
    };
    try {
      if (job.cancelRequested && !job.ticket)
        throw new AppError("CANCELLED", "Job cancelled");
      const paid = isPaidOperation(input);
      if (paid) {
        if (!job.ticket) {
          if (this.service.estimate(input).priceVersion !== job.priceVersion)
            throw new AppError(
              "PRICE_CHANGED",
              "Provider profile changed after reservation; request a new quote.",
            );
          let assetUrl: string | undefined;
          if (input.kind === "analyze") {
            const source = await this.service.db.transaction((tx) =>
              tx.get(input.assetId, job!.accountId, "asset"),
            );
            if (!source || !this.service.storage.providerUrl)
              throw new AppError(
                "CAPABILITY_UNAVAILABLE",
                "Configure S3-compatible storage for private provider reference access",
                409,
              );
            assetUrl = await this.service.storage.providerUrl(
              source.storageKey,
            );
          }
          await checkpoint({
            phase: "submitting",
            steps: [
              {
                id: "provider",
                state: "submitting",
                inputHash: fingerprint(input),
                attempt: job.attempts,
                startedAt: new Date().toISOString(),
              },
            ],
          });
          const ticket = await this.service.provider.submit(input, assetUrl);
          await checkpoint({
            ticket,
            phase: "provider_wait",
            steps: [
              {
                id: "provider",
                state: "submitted",
                requestId: ticket.requestId,
                inputHash: job.inputHash,
              },
            ],
          });
        }
        if (job.cancelRequested) {
          const cancellation = await this.service.provider.cancel(job.ticket);
          await this.service.finish(
            job.id,
            lease,
            { status: "cancelled", providerCancellation: cancellation },
            null,
          );
          return true;
        }
        const status = await this.service.provider.poll(job.ticket);
        if (status === "pending") {
          await checkpoint({ status: "queued", phase: "provider_wait" });
          await delay(1000);
          return true;
        }
        if (status === "failed")
          throw new AppError("PROVIDER_FAILED", "Provider reported failure");
        if (!job.outputs.length) {
          const result = await this.service.provider.collect(job.ticket, input);
          if ("data" in result) {
            if (input.kind === "analyze") {
              const source = await this.service.db.transaction((tx) =>
                tx.get(input.assetId, job!.accountId, "asset"),
              );
              const analysis = result.data as {
                observations: { endMs: number }[];
              };
              if (
                analysis.observations.some(
                  (o) => o.endMs > source!.metadata.durationMs,
                )
              )
                throw new AppError(
                  "PROVIDER_RESULT_INVALID",
                  "Observation exceeds reference duration",
                );
            }
            const asset = await this.service.registerAsset(
              job.accountId,
              Buffer.from(JSON.stringify(result.data)),
              {
                name: `${result.kind}.json`,
                kind: result.kind,
                mime: "application/json",
                metadata: {},
                provenance: {
                  source: job.ticket.connectionId ?? "fal",
                  model: "model" in input ? input.model : null,
                  requestId: job.ticket.requestId,
                  evidence: "provider-live",
                  license: "provider-model-terms",
                },
                jobId: job.id,
              },
            );
            await checkpoint({
              outputs: [asset.id],
              phase: "collected",
              analysis: result.data,
              collectedProviderCostCents: result.costCents,
            });
          } else {
            const bytes = await downloadPublic(result.url);
            const path = join(work, "provider-result");
            await writeFile(path, bytes);
            const metadata = probeSchema.parse(
              (await media({ command: "probe", path }, abort.signal)).metadata,
            );
            if (metadata.kind !== result.kind)
              throw new AppError(
                "PROVIDER_RESULT_INVALID",
                "Unexpected provider media kind",
              );
            const asset = await this.service.registerAsset(
              job.accountId,
              bytes,
              {
                name: `${result.kind}-${job.id}`,
                kind: result.kind,
                mime: mimeFor(metadata),
                metadata,
                provenance: {
                  source: job.ticket.connectionId ?? "fal",
                  model: "model" in input ? input.model : null,
                  requestId: job.ticket.requestId,
                  evidence: "provider-live",
                  license: "provider-model-terms",
                  costStatus: "pending_reconciliation",
                },
                jobId: job.id,
              },
            );
            await checkpoint({
              outputs: [asset.id],
              phase: "collected",
              collectedProviderCostCents: result.costCents,
            });
          }
        }
        await this.service.finish(
          job.id,
          lease,
          {
            status: "completed",
            evidence: "provider-live",
            steps: [
              {
                id: "provider",
                state: "completed",
                requestId: job.ticket.requestId,
                outputs: job.outputs,
              },
            ],
          },
          job.collectedProviderCostCents ?? null,
        );
        return true;
      }
      await checkpoint({
        phase: "local",
        steps: [
          {
            id: input.kind,
            state: "running",
            inputHash: job.inputHash,
            attempt: job.attempts,
            adapterVersion: "media-v1",
          },
        ],
      });
      const outputs = await this.executeLocal(job, work, abort.signal);
      if (abort.signal.aborted)
        throw new AppError("CANCELLED", "Job cancelled");
      await this.service.finish(
        job.id,
        lease,
        {
          status: "completed",
          outputs: outputs.ids,
          ...outputs.extra,
          evidence: "local-real",
          steps: [
            {
              id: input.kind,
              state: "completed",
              inputHash: job.inputHash,
              outputs: outputs.ids,
              adapterVersion: "media-v1",
            },
          ],
        },
        0,
      );
    } catch (error) {
      const e =
        error instanceof AppError
          ? error
          : new AppError(
              "EXECUTION_FAILED",
              "Execution failed; check adapter configuration",
            );
      const paid = isPaidOperation(input);
      const unknown =
        e instanceof SubmissionUnknown ||
        (job.phase === "submitting" && e.code !== "PROVIDER_REJECTED");
      const pending = paid && (unknown || !!job.ticket);
      try {
        await this.service.finish(
          job.id,
          lease,
          {
            status: unknown
              ? "submission_unknown"
              : e.code === "CANCELLED"
                ? "cancelled"
                : e.code === "CAPABILITY_UNAVAILABLE"
                  ? "blocked_external"
                  : "failed",
            error: { code: e.code, message: e.message },
            steps: [
              ...(job.steps ?? []),
              { id: "failure", state: "failed", error: e.code },
            ],
          },
          pending ? null : 0,
        );
      } catch {
        /* A successor with a new lease owns finalization. */
      }
    } finally {
      clearInterval(heartbeat);
      await rm(work, { recursive: true, force: true });
    }
    return true;
  }
  private async stage(job: Entity, assetId: string, work: string) {
    const asset = await this.service.db.transaction((tx) =>
      tx.get(assetId, job.accountId, "asset"),
    );
    if (!asset) throw new AppError("NOT_FOUND", "Source asset not found", 404);
    const path = join(work, asset.id);
    await writeFile(path, await this.service.storage.read(asset.storageKey));
    return { asset, path };
  }
  private async executeLocal(
    job: Entity,
    work: string,
    signal: AbortSignal,
  ): Promise<{ ids: string[]; extra?: Record<string, unknown> }> {
    const input = job.input as Operation;
    const assets: Record<string, string> = {};
    const provenance = {
      source: "local-executor",
      evidence: "local-real",
      license: "user-controlled",
      jobId: job.id,
    };
    if (input.kind === "tts") {
      const result = await media(
        { command: "tts", ...input, workDir: work },
        signal,
      );
      const metadata = probeSchema.parse(
        (await media({ command: "probe", path: result.output }, signal))
          .metadata,
      );
      const a = await this.service.registerAsset(
        job.accountId,
        await readFile(result.output),
        {
          name: "voice.wav",
          kind: "audio",
          mime: "audio/wav",
          metadata,
          provenance: {
            ...provenance,
            textHash: fingerprint(input.text),
            language: input.language,
            voice: result.voice,
          },
          jobId: job.id,
        },
      );
      return { ids: [a.id] };
    }
    if (input.kind === "transcribe") {
      const source = await this.stage(job, input.assetId, work);
      const result = transcriptSchema.parse(
        await media(
          {
            command: "transcribe",
            path: source.path,
            language: input.language,
          },
          signal,
        ),
      );
      const a = await this.service.registerAsset(
        job.accountId,
        Buffer.from(JSON.stringify(result)),
        {
          name: "transcript.json",
          kind: "transcript",
          mime: "application/json",
          metadata: { durationMs: result.durationMs },
          provenance,
          jobId: job.id,
        },
      );
      return { ids: [a.id], extra: { transcript: result } };
    }
    if (input.kind === "analyze") {
      const source = await this.stage(job, input.assetId, work);
      const result = {
        schemaVersion: 1,
        assetId: source.asset.id,
        technical: source.asset.metadata,
        observations: input.observations ?? [],
        observationEvidence: input.observations
          ? "precomputed"
          : "not_available",
        recommendation:
          "Provide time-stamped observations or connect a vision analysis provider before claiming semantic understanding.",
      };
      const a = await this.service.registerAsset(
        job.accountId,
        Buffer.from(JSON.stringify(result)),
        {
          name: "reference-analysis.json",
          kind: "analysis",
          mime: "application/json",
          metadata: {},
          provenance: {
            ...provenance,
            evidence: input.observations ? "precomputed" : "local-real",
          },
          jobId: job.id,
        },
      );
      return { ids: [a.id], extra: { analysis: result } };
    }
    let composition: any;
    let mapping: unknown;
    if (input.kind === "render") composition = input.composition;
    else if (input.kind === "trim") {
      await this.stage(job, input.assetId, work);
      composition = {
        schemaVersion: 1,
        title: "Extracted clip",
        width: input.width,
        height: input.height,
        scenes: input.segments.map((s, i) => ({
          id: `segment${i}`,
          assetId: input.assetId,
          sourceStartMs: s.startMs,
          durationMs: s.endMs - s.startMs,
          fit: "contain",
          text: "",
        })),
      };
      mapping = editMap(input.segments);
    } else if (input.kind === "captions") {
      const source = await this.stage(job, input.assetId, work);
      const metadata = source.asset.metadata;
      const groups: { text: string; startMs: number; endMs: number }[] = [];
      for (const word of input.transcript.words) {
        const last = groups.at(-1);
        if (
          last &&
          word.startMs - last.endMs < 500 &&
          word.endMs - last.startMs < 4000 &&
          (last.text + word.text).length < 65
        ) {
          last.text +=
            (input.transcript.language.startsWith("zh") ? "" : " ") + word.text;
          last.endMs = word.endMs;
        } else
          groups.push({
            text: word.text,
            startMs: word.startMs,
            endMs: word.endMs,
          });
      }
      composition = {
        schemaVersion: 1,
        title: "Captioned video",
        width: Math.min(1920, metadata.width),
        height: Math.min(1920, metadata.height),
        scenes: [
          {
            id: "original",
            assetId: input.assetId,
            sourceStartMs: 0,
            durationMs: metadata.durationMs,
            text: "",
          },
        ],
        events: groups.map((g, i) => ({
          id: `caption${i}`,
          sceneId: "original",
          offsetMs: g.startMs,
          durationMs: g.endMs - g.startMs,
          kind: "text",
          text: g.text,
        })),
        captionStyle: {
          fontSize: input.style?.fontSize ?? 28,
          color: input.style?.color ?? "#ffffff",
          background: "#151a22",
        },
      };
    } else throw new AppError("UNSUPPORTED", "Unsupported operation");
    composition = compositionSchema.parse(composition);
    const refs = new Set<string>(
      [
        ...composition.scenes.flatMap((s: any) => [s.assetId, s.audioAssetId]),
        ...composition.events.map((e: any) => e.assetId),
        composition.audio?.assetId,
      ].filter(Boolean),
    );
    for (const ref of refs)
      assets[ref] = (await this.stage(job, ref, work)).path;
    const result = await media(
      {
        command: "render",
        composition,
        assets,
        workDir: work,
        ...(input.kind === "captions"
          ? { preserveAudio: assets[input.assetId] }
          : {}),
      },
      signal,
    );
    if (input.kind === "captions") {
      const { stamp } = await import("../../../packages/render/src/index.js");
      const entries = composition.events
        .map(
          (e: any, i: number) =>
            `${i + 1}\n${stamp(e.offsetMs)} --> ${stamp(e.offsetMs + e.durationMs)}\n${e.text}\n`,
        )
        .join("\n");
      await writeFile(result.subtitles, entries);
    }
    const metadata = probeSchema.parse(result.metadata);
    const ids = [];
    for (const [path, name, kind, mime, meta] of [
      [result.output, "video.mp4", "video", "video/mp4", metadata],
      [result.subtitles, "captions.srt", "subtitle", "text/plain", {}],
      [result.preview, "preview.png", "image", "image/png", {}],
    ] as const) {
      const asset = await this.service.registerAsset(
        job.accountId,
        await readFile(path),
        { name, kind, mime, metadata: meta, provenance, jobId: job.id },
      );
      ids.push(asset.id);
    }
    return {
      ids,
      extra: {
        durationMs: metadata.durationMs,
        timeline: result.timeline,
        ...(mapping ? { editMap: mapping } : {}),
      },
    };
  }
}
