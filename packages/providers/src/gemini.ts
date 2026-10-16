import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  type Entity,
  type Operation,
} from "../../contracts/src/index.js";
import {
  REFERENCE_ANALYSIS_VERSION,
  referenceContentSchema,
} from "../../contracts/src/reference-analysis.js";
import {
  SubmissionUnknown,
  type MediaProvider,
  type Model,
  type PreparedMedia,
  type ProviderResult,
  type Ticket,
  type ReferenceSettings,
} from "./index.js";

import {
  referenceInstructions,
  referenceOutputSchema,
} from "./reference-policy.js";
const origin = "https://generativelanguage.googleapis.com";
export const geminiProfileSchema = z
  .object({
    fps: z.number().min(0.1).max(30).default(2),
    maxDurationMs: z.number().int().min(100).max(600000).default(60000),
    maxOutputTokens: z.number().int().min(1024).max(32768).default(8192),
    maxBytes: z.number().int().min(1).max(104857600).default(104857600),
  })
  .strict();
const fileSchema = z.object({
  name: z.string().regex(/^files\/[a-zA-Z0-9_-]+$/),
  uri: z.string(),
  mimeType: z.string(),
  state: z.enum(["ACTIVE", "PROCESSING", "FAILED"]),
});
const requestId = z.string().regex(/^[a-zA-Z0-9_.~-]{1,1000}$/);

/** Independent native-video analysis; never uses the host agent's model or key. */
export class GeminiProvider implements MediaProvider {
  constructor(
    public models: Model[],
    private key?: string,
    private enabled = false,
    private fetcher: typeof fetch = fetch,
  ) {}
  describe() {
    return this.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      description: m.description ?? "",
      kind: m.kind,
      category: m.category,
      maxCostCents: m.maxCostCents,
      creditPriceCents: m.creditPriceCents,
      priceVersion: m.priceVersion,
      available:
        !!this.key &&
        this.enabled &&
        m.hardBoundConfirmed &&
        m.kind === "analysis" &&
        geminiProfileSchema.safeParse(m.parameters).success,
    }));
  }
  validate(input: Operation) {
    const m = this.models.find((m) => "model" in input && m.id === input.model);
    if (!m || !this.key || !this.enabled || !m.hardBoundConfirmed)
      throw new AppError(
        "CAPABILITY_UNAVAILABLE",
        "Configure a separate Gemini analysis model, credentials, enablement and verified cost bound",
        409,
      );
    if (input.kind !== "reference_analyze" || m.kind !== "analysis")
      throw new AppError(
        "INVALID_MODEL",
        "Gemini adapter accepts reference_analyze only",
      );
    if (
      !/^gemini-[a-zA-Z0-9.-]+$/.test(m.endpoint) ||
      !Number.isSafeInteger(m.maxCostCents) ||
      m.maxCostCents <= 0 ||
      !geminiProfileSchema.safeParse(m.parameters).success
    )
      throw new AppError(
        "INVALID_PROVIDER_CONFIG",
        "Invalid Gemini model or bounded analysis profile",
      );
    return m;
  }
  validateSource(input: Operation, asset: Entity) {
    const p = geminiProfileSchema.parse(this.validate(input).parameters);
    if (input.kind !== "reference_analyze") return;
    const duration = asset.metadata?.durationMs;
    if (
      asset.kind !== "video" ||
      !/^video\/(mp4|mpeg|quicktime|webm|x-msvideo|x-flv|x-ms-wmv|3gpp)$/.test(
        asset.mime,
      ) ||
      !Number.isSafeInteger(duration) ||
      duration <= 0
    )
      throw new AppError(
        "INVALID_MEDIA",
        "Analysis requires probed video with a known duration",
      );
    // Bound the entire uploaded video even for focused inspection; no unpriced long-file processing.
    if (duration > p.maxDurationMs || asset.bytes > p.maxBytes)
      throw new AppError(
        "ANALYSIS_LIMIT",
        "Video exceeds this model's configured duration or byte limit; trim it or choose a separately quoted profile",
      );
    if (input.range && input.range.endMs > duration)
      throw new AppError(
        "INVALID_INTERVAL",
        "Analysis interval exceeds source duration",
      );
  }
  analysisSettings(input: Operation): ReferenceSettings {
    const model = this.validate(input);
    return {
      fps: geminiProfileSchema.parse(model.parameters).fps,
      mode: "static_video_and_audio",
      rangeControl: "api",
      upstreamModel: model.endpoint,
    };
  }
  estimate(input: Operation) {
    const m = this.validate(input);
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          ...m,
          parameters: geminiProfileSchema.parse(m.parameters),
          analysisVersion: REFERENCE_ANALYSIS_VERSION,
        }),
      )
      .digest("hex");
    return {
      maxCents: m.maxCostCents,
      priceVersion: `${m.priceVersion}:${digest}`,
    };
  }
  private safeUrl(raw: string, prefix: string) {
    const url = new URL(raw);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.hash ||
      !url.pathname.startsWith(prefix)
    )
      throw new AppError("INVALID_PROVIDER_RESPONSE", "Untrusted Gemini URL");
    return url.toString();
  }
  private async request(
    url: string,
    init: RequestInit = {},
    prefix = "/v1beta/",
  ) {
    try {
      return await this.fetcher(this.safeUrl(url, prefix), {
        ...init,
        headers: { "x-goog-api-key": this.key!, ...init.headers },
        redirect: "error",
        signal: AbortSignal.timeout(45000),
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        "PROVIDER_NETWORK_ERROR",
        "Gemini request could not be completed",
        502,
      );
    }
  }
  private async json(response: Response) {
    if (!response.ok)
      throw new AppError(
        "PROVIDER_REQUEST_FAILED",
        `Gemini request failed (${response.status})`,
        502,
      );
    // Bound parsed output and do not persist upstream error bodies or access-bearing URLs.
    const reader = response.body?.getReader();
    if (!reader)
      throw new AppError("PROVIDER_RESULT_INVALID", "Missing Gemini response");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 2 * 1024 * 1024) throw Error("size");
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString()) as Record<
        string,
        any
      >;
    } catch {
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Malformed or oversized Gemini response",
      );
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  async prepare(
    input: Operation,
    bytes?: Uint8Array,
    mime?: string,
    previous?: PreparedMedia,
  ): Promise<PreparedMedia> {
    const profile = geminiProfileSchema.parse(this.validate(input).parameters);
    let raw: unknown;
    if (previous) {
      if (!/^files\/[a-zA-Z0-9_-]+$/.test(previous.name))
        throw new AppError("INVALID_PROVIDER_RESPONSE", "Invalid file handle");
      raw = await this.json(
        await this.request(`${origin}/v1beta/${previous.name}`),
      );
    } else {
      if (
        !bytes?.byteLength ||
        bytes.byteLength > profile.maxBytes ||
        !mime?.startsWith("video/")
      )
        throw new AppError(
          "INVALID_MEDIA",
          "Missing or oversized source video",
        );
      const begin = await this.request(
        `${origin}/upload/v1beta/files`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
            "X-Goog-Upload-Header-Content-Type": mime,
          },
          body: JSON.stringify({ file: { display_name: "rikoko-reference" } }),
        },
        "/upload/",
      );
      if (!begin.ok)
        throw new AppError(
          "PROVIDER_UPLOAD_FAILED",
          `Gemini upload start failed (${begin.status})`,
          502,
        );
      const uploadUrl = begin.headers.get("x-goog-upload-url");
      if (!uploadUrl)
        throw new AppError(
          "INVALID_PROVIDER_RESPONSE",
          "Missing upload session",
        );
      raw = (
        await this.json(
          await this.request(
            uploadUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": mime,
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
              },
              body: Buffer.from(bytes),
            },
            "/upload/",
          ),
        )
      ).file;
    }
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Invalid Gemini file metadata",
      );
    const file = parsed.data;
    const uri = this.safeUrl(file.uri, "/v1beta/files/");
    if (uri !== `${origin}/v1beta/${file.name}`)
      throw new AppError("INVALID_PROVIDER_RESPONSE", "File identity mismatch");
    if (file.state === "FAILED")
      throw new AppError(
        "PROVIDER_UPLOAD_FAILED",
        "Gemini could not process the video",
      );
    return {
      name: file.name,
      uri,
      mime: file.mimeType,
      ready: file.state === "ACTIVE",
    };
  }
  async submit(input: Operation, fileUri?: string): Promise<Ticket> {
    const model = this.validate(input);
    if (input.kind !== "reference_analyze" || !fileUri)
      throw new AppError("PROVIDER_REJECTED", "Prepared video is required");
    const uri = this.safeUrl(fileUri, "/v1beta/files/");
    const p = geminiProfileSchema.parse(model.parameters);
    const instructions = referenceInstructions(input);
    let response: Response;
    try {
      response = await this.request(`${origin}/v1beta/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.endpoint,
          background: true,
          store: true,
          input: [
            {
              type: "video",
              uri,
              processing: {
                type: "static",
                fps: p.fps,
                ...(input.range
                  ? {
                      start_offset: input.range.startMs / 1000,
                      end_offset: input.range.endMs / 1000,
                    }
                  : {}),
              },
            },
            { type: "text", text: instructions },
          ],
          generation_config: {
            max_output_tokens: p.maxOutputTokens,
            thinking_level: "low",
          },
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: z.toJSONSchema(referenceOutputSchema(input)),
          },
        }),
      });
    } catch {
      throw new SubmissionUnknown();
    }
    if (!response.ok) {
      if (response.status >= 500 || response.status === 408)
        throw new SubmissionUnknown();
      throw new AppError(
        "PROVIDER_REJECTED",
        `Gemini rejected analysis (${response.status})`,
        502,
      );
    }
    try {
      const id = requestId.parse((await this.json(response)).id);
      const url = `${origin}/v1beta/interactions/${id}`;
      return {
        requestId: id,
        statusUrl: url,
        resultUrl: url,
        cancelUrl: `${url}/cancel`,
      };
    } catch {
      throw new SubmissionUnknown();
    }
  }
  private ticketUrl(ticket: Ticket) {
    const parsed = requestId.safeParse(ticket.requestId);
    if (!parsed.success)
      throw new AppError("INVALID_PROVIDER_RESPONSE", "Invalid interaction ID");
    return `${origin}/v1beta/interactions/${parsed.data}`;
  }
  async poll(ticket: Ticket) {
    const data = await this.json(await this.request(this.ticketUrl(ticket)));
    if (data.status === "completed") return "completed";
    if (["in_progress", "queued"].includes(data.status)) return "pending";
    return "failed";
  }
  async cancel(ticket: Ticket) {
    const response = await this.request(`${this.ticketUrl(ticket)}/cancel`, {
      method: "POST",
    });
    return { accepted: response.ok, refunded: false };
  }
  async collect(ticket: Ticket, input: Operation): Promise<ProviderResult> {
    this.validate(input);
    const data = await this.json(await this.request(this.ticketUrl(ticket)));
    try {
      if (data.status !== "completed" || data.id !== ticket.requestId)
        throw Error();
      const output = (
        data.steps as {
          type: string;
          content?: { type: string; text?: string }[];
        }[]
      )
        .filter((s) => s.type === "model_output")
        .flatMap((s) => s.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
      return {
        kind: "analysis",
        data: referenceContentSchema.parse(JSON.parse(output)),
        costCents: null,
      };
    } catch {
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Gemini output failed the reference analysis schema",
      );
    }
  }
}
