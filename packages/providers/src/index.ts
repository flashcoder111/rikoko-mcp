import { createHash } from "node:crypto";
import {
  AppError,
  referenceAnalysisSchema,
  translationSchema,
  type Operation,
  type Entity,
} from "../../contracts/src/index.js";
import type { GenerationInput } from "../../contracts/src/generation.js";
import {
  generationPayload,
  validateGenerationInput,
  type ResolvedReference,
} from "./generation-input.js";
export type Model = {
  id: string;
  name?: string;
  description?: string;
  category?: "speech" | "music" | "sound";
  endpoint: string;
  kind: "image" | "video" | "audio" | "analysis" | "translation";
  maxCostCents: number;
  creditPriceCents?: number;
  priceVersion: string;
  hardBoundConfirmed: boolean;
  parameters: Record<string, unknown>;
  promptField?: string;
  assetField?: string;
  responseField?: string;
  generationInput?: GenerationInput;
};
export type Ticket = {
  connectionId?: string;
  connectionVersion?: string;
  requestId: string;
  statusUrl: string;
  resultUrl: string;
  cancelUrl: string;
};
export type ProviderUsage = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number;
  cost?: number;
};
export type ReferenceSettings = {
  fps: number | null;
  mode: "static_video_and_audio" | "provider_controlled";
  rangeControl: "api" | "prompt";
  upstreamModel: string;
};
export type ProviderResult =
  | {
      kind: "analysis" | "translation";
      data: unknown;
      costCents: null;
      usage?: ProviderUsage;
    }
  | {
      url: string;
      kind: "image" | "video" | "audio";
      costCents: number | null;
    };
export class SubmissionUnknown extends AppError {
  constructor() {
    super(
      "SUBMISSION_UNKNOWN",
      "Provider may have accepted this request; manual reconciliation is required. Do not resubmit.",
      409,
    );
  }
}
export class FalProvider {
  constructor(
    public models: Model[] = [],
    protected key?: string,
    private enabled = false,
    protected fetcher: typeof fetch = fetch,
    private options: { testing?: boolean } = {},
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
      ...(m.generationInput
        ? {
            generationInput: {
              mode: m.generationInput.mode,
              outputDurationMs: m.generationInput.outputDurationMs,
              maxTotalBytes: m.generationInput.maxTotalBytes,
              references: m.generationInput.bindings.map(
                ({ field: _field, ...binding }) => binding,
              ),
            },
          }
        : {}),
      available:
        !!this.key &&
        this.enabled &&
        (m.hardBoundConfirmed || !!this.options.testing),
    }));
  }
  validate(input: Operation) {
    const modelId =
      ["generate", "tts", "analyze", "translate"].includes(input.kind) &&
      "model" in input
        ? input.model
        : undefined;
    const m = this.models.find((m) => m.id === modelId);
    if (
      !m ||
      !this.enabled ||
      !this.key ||
      (!m.hardBoundConfirmed && !this.options.testing)
    )
      throw new AppError(
        "CAPABILITY_UNAVAILABLE",
        "Model is not configured with credentials, paid enablement and a confirmed cost bound",
        409,
      );
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(m.endpoint) ||
      m.endpoint.includes("..") ||
      !Number.isSafeInteger(m.maxCostCents) ||
      (this.options.testing ? m.maxCostCents < 0 : m.maxCostCents <= 0) ||
      (m.creditPriceCents !== undefined &&
        (!Number.isSafeInteger(m.creditPriceCents) || m.creditPriceCents <= 0))
    )
      throw new AppError(
        "INVALID_PROVIDER_CONFIG",
        "Invalid endpoint or cost bound",
      );
    if (input.kind === "tts" && m.kind !== "audio")
      throw new AppError("INVALID_MODEL", "TTS requires an audio model");
    if (input.kind === "generate" && Object.keys(input.parameters).length)
      throw new AppError(
        "INVALID_MODEL_INPUT",
        "Model parameters are fixed by the server cost profile",
      );
    if (
      (input.kind === "analyze" && m.kind !== "analysis") ||
      (input.kind === "translate" && m.kind !== "translation") ||
      (input.kind === "generate" &&
        ["analysis", "translation"].includes(m.kind))
    )
      throw new AppError(
        "INVALID_MODEL",
        "Model capability does not match operation",
      );
    validateGenerationInput(m, input);
    return m;
  }
  estimate(input: Operation) {
    const m = this.validate(input);
    const profile = {
      ...m,
      parameters: Object.fromEntries(
        Object.entries(m.parameters).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
    const digest = createHash("sha256")
      .update(JSON.stringify(profile))
      .digest("hex");
    return {
      maxCents: m.maxCostCents,
      priceVersion: `${m.priceVersion}:${digest}`,
    };
  }
  private safeUrl(url: string) {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.hostname !== "queue.fal.run" ||
      u.port ||
      u.username ||
      u.password
    )
      throw new AppError("INVALID_PROVIDER_RESPONSE", "Untrusted provider URL");
    return u.toString();
  }
  protected async request(url: string, method = "GET", body?: unknown) {
    return this.fetcher(this.safeUrl(url), {
      method,
      headers: {
        Authorization: `Key ${this.key}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
  }
  referenceDelivery(_input: Operation): "data_uri" | "signed_url" {
    return "data_uri";
  }
  async submit(
    input: Operation,
    assetUrl?: string,
    references?: ResolvedReference[],
  ): Promise<Ticket> {
    const m = this.validate(input);
    const prompt =
      input.kind === "tts"
        ? input.text
        : input.kind === "generate"
          ? input.prompt
          : "";
    if (input.kind === "analyze" && !assetUrl)
      throw new AppError(
        "CAPABILITY_UNAVAILABLE",
        "Reference analysis requires controlled cloud storage access",
        409,
      );
    const requestPrompt =
      input.kind === "analyze"
        ? "Analyze this reference video. Return only JSON with schemaVersion:1, summary, and observations:[{startMs,endMs,observation}]. Use source timestamps and distinguish visible evidence from guesses."
        : input.kind === "translate"
          ? `Translate to ${input.language}. Preserve product names, numbers and claims. Return only JSON with schemaVersion:1, language:"${input.language}", text. Input: ${input.text}`
          : prompt;
    return this.submitPayload(m, {
      ...m.parameters,
      ...generationPayload(m, input, references),
      [m.promptField ?? (input.kind === "tts" ? "text" : "prompt")]:
        requestPrompt,
      ...(assetUrl ? { [m.assetField ?? "video_url"]: assetUrl } : {}),
    });
  }
  protected async submitPayload(
    m: Model,
    payload: Record<string, unknown>,
  ): Promise<Ticket> {
    let r: Response;
    try {
      r = await this.request(
        `https://queue.fal.run/${m.endpoint}`,
        "POST",
        payload,
      );
    } catch {
      throw new SubmissionUnknown();
    }
    if (!r.ok) {
      if (r.status >= 500 || r.status === 408) throw new SubmissionUnknown();
      throw new AppError(
        "PROVIDER_REJECTED",
        `Provider rejected submission (${r.status})`,
        502,
      );
    }
    let j: any;
    try {
      j = await r.json();
      if (!j.request_id || !j.status_url || !j.response_url || !j.cancel_url)
        throw Error();
      return {
        requestId: String(j.request_id),
        statusUrl: this.safeUrl(j.status_url),
        resultUrl: this.safeUrl(j.response_url),
        cancelUrl: this.safeUrl(j.cancel_url),
      };
    } catch {
      throw new SubmissionUnknown();
    }
  }
  async poll(ticket: Ticket) {
    const r = await this.request(ticket.statusUrl);
    if (!r.ok)
      throw new AppError(
        "PROVIDER_POLL_FAILED",
        `Provider status unavailable (${r.status})`,
        502,
      );
    const j = (await r.json()) as any;
    return j.error
      ? "failed"
      : j.status === "COMPLETED"
        ? "completed"
        : j.status === "FAILED"
          ? "failed"
          : "pending";
  }
  async cancel(ticket: Ticket) {
    const r = await this.request(ticket.cancelUrl, "PUT");
    return { accepted: r.ok, refunded: false };
  }
  async collect(ticket: Ticket, input: Operation): Promise<ProviderResult> {
    const m = this.validate(input);
    const r = await this.request(ticket.resultUrl);
    if (!r.ok)
      throw new AppError("PROVIDER_RESULT_FAILED", "Result not available", 502);
    const j = (await r.json()) as any;
    if (m.kind === "analysis" || m.kind === "translation") {
      const value = j[m.responseField ?? "output"];
      let parsed: unknown;
      try {
        parsed = typeof value === "string" ? JSON.parse(value) : value;
        parsed =
          m.kind === "analysis"
            ? referenceAnalysisSchema.parse(parsed)
            : translationSchema.parse(parsed);
      } catch {
        throw new AppError(
          "PROVIDER_RESULT_INVALID",
          "Structured provider output failed the v1 schema",
        );
      }
      if (
        input.kind === "translate" &&
        (parsed as { language: string }).language !== input.language
      )
        throw new AppError(
          "PROVIDER_RESULT_INVALID",
          "Translation language mismatch",
        );
      return { kind: m.kind, data: parsed, costCents: null };
    }
    const url =
      j.video?.url ??
      j.images?.[0]?.url ??
      j.image?.url ??
      j.audio?.url ??
      j.audio_url;
    if (typeof url !== "string")
      throw new AppError("PROVIDER_RESULT_INVALID", "Missing result media URL");
    return { url, kind: m.kind, costCents: null };
  }
}
export type PreparedMedia = {
  name: string;
  uri: string;
  mime: string;
  ready: boolean;
  connectionId?: string;
  connectionVersion?: string;
};
export type MediaProvider = Pick<
  FalProvider,
  | "models"
  | "describe"
  | "validate"
  | "estimate"
  | "submit"
  | "poll"
  | "cancel"
  | "collect"
> & {
  referenceDelivery?(input: Operation): "data_uri" | "signed_url";
  validateSource?(input: Operation, asset: Entity): void;
  analysisSettings?(input: Operation): ReferenceSettings;
  prepare?(
    input: Operation,
    bytes?: Uint8Array,
    mime?: string,
    previous?: PreparedMedia,
  ): Promise<PreparedMedia>;
};
