import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { AppError, type Operation } from "../../contracts/src/index.js";
import {
  generationPayload,
  type ResolvedReference,
} from "./generation-input.js";
import { resolveGenerationParameters } from "./generation-parameters.js";
import {
  FalProvider,
  SubmissionUnknown,
  type Model,
  type Ticket,
  type ProviderResult,
  type ReferenceSource,
  type SubmissionContext,
} from "./index.js";

export const SEEAPI_ORIGIN = "https://api.seeapi.com";
export const SEEAPI_CONNECTION = "seeapi-seedance-v1";
const taskPath = "/v1/generations";
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/);
const endpointSchema = z.enum([
  "text-to-video",
  "image-to-video",
  "reference-to-video",
]);
const taskSchema = z.object({
  generation: z.object({
    id: idSchema,
    model: z.literal("seedance-2-mini"),
    endpoint: endpointSchema,
    provider: z.literal("seeapi"),
    status: z.enum([
      "processing",
      "succeeded",
      "failed",
      "canceled",
      "refunded",
      "expired",
    ]),
    result: z
      .object({
        assets: z.array(
          z.object({
            type: z.enum(["image", "video", "audio"]),
            url: z.string(),
            mime_type: z.string().optional(),
          }),
        ),
      })
      .optional(),
    consumed_credits: z.number().nonnegative().optional(),
  }),
});

/** Explicit SeeAPI profiles, never reinterpret Ark/fal model identifiers. */
export function seeapiEndpoint(model: Model) {
  if (model.kind !== "video") return;
  const match =
    /^seeapi\/seedance-2-mini\/(text-to-video|image-to-video|reference-to-video)$/.exec(
      model.endpoint,
    );
  return match ? endpointSchema.parse(match[1]) : undefined;
}

function httpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port
    )
      return url.toString();
  } catch {
    /* Return a redacted error below. */
  }
  throw new AppError("INVALID_MEDIA", "SeeAPI requires an HTTPS media URL");
}

type PollState = { started: number; next: number; attempts: number };
/** SeeAPI Mini uses documented REST, server credentials and the existing job ledger. */
export class SeeApiProvider extends FalProvider {
  private polling = new Map<string, PollState>();
  constructor(
    models: Model[],
    key?: string,
    enabled = false,
    private transport: typeof fetch = fetch,
  ) {
    super(models, key, enabled);
  }

  override validate(input: Operation) {
    const model = super.validate(input);
    const endpoint = seeapiEndpoint(model);
    if (input.kind !== "generate" || !endpoint)
      throw new AppError(
        "INVALID_PROVIDER_CONFIG",
        "Unsupported SeeAPI profile",
      );
    const p = resolveGenerationParameters(model, input.parameters);
    const mode = model.generationInput?.mode;
    if (
      input.prompt.length < 3 ||
      input.prompt.length > 20000 ||
      !Number.isInteger(p.duration) ||
      Number(p.duration) < 4 ||
      Number(p.duration) > 15 ||
      !["480p", "720p"].includes(String(p.resolution)) ||
      ![
        "auto",
        "adaptive",
        "16:9",
        "4:3",
        "1:1",
        "3:4",
        "9:16",
        "21:9",
      ].includes(String(p.aspect_ratio)) ||
      typeof p.generate_audio !== "boolean" ||
      (endpoint === "text-to-video" && mode !== undefined) ||
      (endpoint === "reference-to-video" && mode !== "reference_to_video") ||
      (endpoint === "image-to-video" &&
        mode !== "image_to_video" &&
        mode !== "first_last_frame")
    )
      throw new AppError(
        "INVALID_MODEL_INPUT",
        "Unsupported SeeAPI Seedance Mini inputs",
      );
    return model;
  }
  override referenceDelivery(): "signed_url" {
    return "signed_url";
  }

  private call(path: string, body?: string, idempotencyKey?: string) {
    if (!this.key)
      throw new AppError(
        "CAPABILITY_UNAVAILABLE",
        "SeeAPI credentials are missing",
        409,
      );
    return this.transport(SEEAPI_ORIGIN + path, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body,
    });
  }
  private path(ticket: Ticket) {
    const path = `${taskPath}/${ticket.requestId}`;
    const url = SEEAPI_ORIGIN + path;
    if (
      !idSchema.safeParse(ticket.requestId).success ||
      ticket.connectionId !== SEEAPI_CONNECTION ||
      ticket.connectionVersion !== SEEAPI_ORIGIN ||
      ticket.statusUrl !== url ||
      ticket.resultUrl !== url ||
      ticket.cancelUrl !== ""
    )
      throw new AppError(
        "INVALID_PROVIDER_RESPONSE",
        "Untrusted SeeAPI task ticket",
      );
    return path;
  }
  override async submit(
    input: Operation,
    _assetUrl?: string,
    references?: ResolvedReference[],
    _source?: ReferenceSource,
    context?: SubmissionContext,
  ): Promise<Ticket> {
    const model = this.validate(input);
    if (input.kind !== "generate")
      throw new AppError("INVALID_MODEL_INPUT", "Expected video generation");
    // Checks the resolved assets match the authorized input, including order and roles.
    generationPayload(model, input, references);
    const p = resolveGenerationParameters(model, input.parameters);
    const endpoint = seeapiEndpoint(model)!;
    const media: Record<string, string | string[]> = {};
    for (const ref of references ?? []) {
      const binding = model.generationInput!.bindings.find((b) =>
        b.roles.includes(ref.role),
      )!;
      const field =
        ref.role === "first_frame"
          ? "first_frame_image"
          : ref.role === "last_frame"
            ? "last_frame_image"
            : binding.kind === "image"
              ? "reference_images"
              : binding.kind === "video"
                ? "reference_video"
                : "reference_audio";
      const url = httpsUrl(ref.url);
      if (field.endsWith("_image")) media[field] = url;
      else {
        media[field] ??= [];
        (media[field] as string[]).push(url);
      }
    }
    if (endpoint === "image-to-video" && !media.first_frame_image)
      throw new AppError(
        "INVALID_MODEL_INPUT",
        "SeeAPI requires a first frame",
      );
    if (
      media.reference_audio &&
      !media.reference_images &&
      !media.reference_video
    )
      throw new AppError(
        "INVALID_MODEL_INPUT",
        "SeeAPI audio needs an image or video reference",
      );
    const body = JSON.stringify({
      model: "seedance-2-mini",
      endpoint,
      provider: "seeapi",
      input: {
        prompt: input.prompt,
        ...media,
        duration_seconds: p.duration,
        resolution: p.resolution,
        aspect_ratio: p.aspect_ratio === "auto" ? "adaptive" : p.aspect_ratio,
        generate_audio: p.generate_audio,
        nsfw_checker: true,
        ...(endpoint === "text-to-video" ? { web_search: false } : {}),
      },
    });
    const idempotencyKey = `rikoko-${context?.idempotencyKey ?? randomUUID()}`;
    if (!idSchema.safeParse(idempotencyKey).success)
      throw new AppError(
        "INVALID_MODEL_INPUT",
        "Invalid SeeAPI idempotency key",
      );
    const unknown = () => {
      const error = new SubmissionUnknown();
      error.message = `SeeAPI submission outcome unknown; reconcile idempotency key ${idempotencyKey}. Do not create a new job.`;
      return error;
    };
    // Retry only this exact serialized request with the same key; never replay a new body.
    let uncertain = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await this.call(taskPath, body, idempotencyKey);
      } catch {
        uncertain = true;
        if (attempt === 0) {
          await delay(1000);
          continue;
        }
        throw unknown();
      }
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408) {
          uncertain = true;
          // Do not retry ahead of a provider-specified cooldown. The durable job
          // remains unresolved and can be reconciled after that interval.
          if (response.headers.has("Retry-After")) throw unknown();
          if (attempt === 0) {
            await delay(1000);
            continue;
          }
        }
        if (
          uncertain ||
          response.status === 409 ||
          (response.status >= 300 && response.status < 400)
        )
          throw unknown();
        throw new AppError(
          "PROVIDER_REJECTED",
          `SeeAPI rejected submission (${response.status})`,
          502,
        );
      }
      try {
        const task = taskSchema.parse(await response.json()).generation;
        if (![200, 202].includes(response.status) || task.endpoint !== endpoint)
          throw Error();
        const url = `${SEEAPI_ORIGIN}${taskPath}/${task.id}`;
        return {
          connectionId: SEEAPI_CONNECTION,
          connectionVersion: SEEAPI_ORIGIN,
          requestId: task.id,
          statusUrl: url,
          resultUrl: url,
          cancelUrl: "",
        };
      } catch {
        throw unknown();
      }
    }
    throw unknown();
  }
  private async task(ticket: Ticket) {
    const response = await this.call(this.path(ticket));
    if (!response.ok) {
      const error = new AppError(
        "PROVIDER_POLL_FAILED",
        `SeeAPI status unavailable (${response.status})`,
        502,
      );
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const retryAt = Number.isFinite(seconds)
        ? Date.now() + Math.max(0, seconds) * 1000
        : Date.parse(retryAfter ?? "");
      throw Object.assign(error, {
        recoverable:
          response.status === 429 ||
          response.status >= 500 ||
          response.status === 408,
        retryAt,
      });
    }
    const parsed = taskSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.generation.id !== ticket.requestId)
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Invalid SeeAPI task response",
        502,
      );
    return parsed.data.generation;
  }
  override async poll(ticket: Ticket) {
    this.path(ticket);
    const now = Date.now();
    for (const [id, entry] of this.polling)
      if (id !== ticket.requestId && now - entry.started > 60 * 60 * 1000)
        this.polling.delete(id);
    const state = this.polling.get(ticket.requestId) ?? {
      started: now,
      next: 0,
      attempts: 0,
    };
    if (now - state.started >= 30 * 60 * 1000) {
      this.polling.delete(ticket.requestId);
      throw new AppError(
        "PROVIDER_POLL_TIMEOUT",
        "SeeAPI is still unresolved; retain the task ID and reconcile later",
        504,
      );
    }
    if (now < state.next) return "pending" as const;
    let retryAt = 0;
    try {
      const task = await this.task(ticket);
      if (task.status !== "processing") {
        this.polling.delete(ticket.requestId);
        return task.status === "succeeded"
          ? ("completed" as const)
          : ("failed" as const);
      }
    } catch (error) {
      if (
        error instanceof AppError &&
        !(error as AppError & { recoverable?: boolean }).recoverable
      ) {
        this.polling.delete(ticket.requestId);
        throw error;
      }
      retryAt = (error as { retryAt?: number }).retryAt ?? 0;
    }
    state.attempts++;
    state.next = Math.max(
      Number.isFinite(retryAt) ? retryAt : 0,
      now +
        Math.min(60000, 2000 * 2 ** Math.min(state.attempts, 5)) +
        Math.random() * 1000,
    );
    this.polling.set(ticket.requestId, state);
    return "pending" as const;
  }
  override async collect(
    ticket: Ticket,
    input: Operation,
  ): Promise<ProviderResult> {
    const model = this.models.find(
      (m) => "model" in input && m.id === input.model,
    );
    const task = await this.task(ticket);
    const videos =
      task.result?.assets.filter((asset) => asset.type === "video") ?? [];
    if (
      !model ||
      task.endpoint !== seeapiEndpoint(model) ||
      task.status !== "succeeded" ||
      videos.length !== 1
    )
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Matching SeeAPI task and exactly one completed video required",
      );
    // SeeAPI credits depend on the customer's purchase plan, not USD or rikoko credits.
    return { kind: "video", url: httpsUrl(videos[0].url), costCents: null };
  }
  override async cancel(ticket: Ticket) {
    this.path(ticket);
    this.polling.delete(ticket.requestId);
    // No public cancellation API is documented. Stopping local work does not cancel upstream.
    return { accepted: false, refunded: false };
  }
}
