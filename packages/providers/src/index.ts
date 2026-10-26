import { createHash } from "node:crypto";
import { videoModelFamily } from "../../contracts/src/video-policy.js";
import { assertVideoPolicy } from "./video-policy.js";
import { promptReferenceSyntax } from "./prompt-reference.js";
import {
  AppError,
  referenceAnalysisSchema,
  translationSchema,
  voiceCloneSchema,
  type Operation,
  type Entity,
} from "../../contracts/src/index.js";
import type { GenerationInput } from "../../contracts/src/generation.js";
import {
  generationPayload,
  validateGenerationInput,
  type ResolvedReference,
} from "./generation-input.js";
import { speechLanguage, speechLanguageCode } from "./speech.js";
import {
  resolveGenerationParameters,
  type AllowedParameters,
} from "./generation-parameters.js";
export type Model = {
  id: string;
  name?: string;
  description?: string;
  category?: "speech" | "music" | "sound";
  endpoint: string;
  kind: "image" | "video" | "audio" | "analysis" | "translation" | "transcript";
  maxCostCents: number;
  creditPriceCents?: number;
  priceVersion: string;
  hardBoundConfirmed: boolean;
  maxPromptLength?: number;
  minPromptLength?: number;
  parameters: Record<string, unknown>;
  allowedParameters?: AllowedParameters;
  promptField?: string;
  assetField?: string;
  responseField?: string;
  requiresVoiceProfile?: boolean;
  generationInput?: GenerationInput;
};
/** Public generation specifications only; never publish arbitrary provider parameters. */
export function fixedGenerationParameters(model: Model) {
  const result: Record<string, string | number | boolean> = {};
  const imageSize = model.parameters.image_size;
  if (imageSize && typeof imageSize === "object" && !Array.isArray(imageSize)) {
    const { width, height } = imageSize as Record<string, unknown>;
    if (
      typeof width === "number" &&
      typeof height === "number" &&
      Number.isSafeInteger(width) &&
      Number.isSafeInteger(height) &&
      width > 0 &&
      height > 0
    ) {
      result.width = width;
      result.height = height;
    }
  }
  if (typeof model.parameters.keep_audio === "boolean")
    result.keep_audio = model.parameters.keep_audio;
  for (const key of ["generate_audio", "force_instrumental"])
    if (typeof model.parameters[key] === "boolean")
      result[key] = model.parameters[key];
  for (const key of ["music_length_ms", "duration_seconds"])
    if (typeof model.parameters[key] === "number")
      result[key] = model.parameters[key];
  for (const key of ["duration", "width", "height"]) {
    const value = model.parameters[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0)
      result[key] = value;
    else if (
      key === "duration" &&
      typeof value === "string" &&
      /^\d+(?:\.\d+)?$/.test(value)
    )
      result[key] = value;
  }
  const aspect = model.parameters.aspect_ratio;
  if (typeof aspect === "string" && /^(?:\d{1,4}:\d{1,4}|auto)$/.test(aspect))
    result.aspect_ratio = aspect;
  const resolution = model.parameters.resolution;
  if (
    typeof resolution === "string" &&
    /^\d{1,4}(?:\.\d+)?[kKpP]$/.test(resolution)
  )
    result.resolution = resolution;
  return result;
}
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
export type ReferenceSource = { durationMs: number; hasAudio: boolean };
/** Stable job identity; transports must not derive idempotency from prompt text. */
export type SubmissionContext = { idempotencyKey: string };
export type ReferenceSettings = {
  fps: number | null;
  mode: "static_video_and_audio" | "provider_controlled";
  rangeControl: "api" | "prompt";
  upstreamModel: string;
};
export type ProviderResult =
  | {
      kind: "analysis" | "translation" | "transcript";
      data: unknown;
      costCents: null;
      usage?: ProviderUsage;
    }
  | {
      url: string;
      kind: "image" | "video" | "audio";
      costCents: number | null;
      voiceClone?: import("zod").z.infer<typeof voiceCloneSchema>;
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
    protected options: { testing?: boolean; directMediaHost?: string } = {},
  ) {}
  describe() {
    return this.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      description: m.description ?? "",
      kind: m.kind,
      ...(m.kind === "video" ? { videoFamily: videoModelFamily(m) } : {}),
      category: m.category,
      ...(m.requiresVoiceProfile ? { requiresVoiceProfile: true } : {}),
      maxCostCents: m.maxCostCents,
      creditPriceCents: m.creditPriceCents,
      priceVersion: m.priceVersion,
      ...(m.maxPromptLength ? { maxPromptLength: m.maxPromptLength } : {}),
      ...(m.minPromptLength ? { minPromptLength: m.minPromptLength } : {}),
      ...(m.allowedParameters
        ? { allowedParameters: m.allowedParameters }
        : {}),
      ...(["image", "video", "audio"].includes(m.kind)
        ? { fixedParameters: fixedGenerationParameters(m) }
        : {}),
      ...(m.generationInput
        ? {
            generationInput: {
              mode: m.generationInput.mode,
              referenceSyntax: promptReferenceSyntax(m),
              outputDurationMs: m.generationInput.outputDurationMs,
              outputDurationSource: m.generationInput.outputDurationSource,
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
      ["generate", "tts", "transcribe", "analyze", "translate"].includes(
        input.kind,
      ) && "model" in input
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
    if (input.kind === "transcribe" && m.kind !== "transcript")
      throw new AppError(
        "INVALID_MODEL",
        "Transcription requires a transcript model",
      );
    if (m.kind === "transcript" && input.kind !== "transcribe")
      throw new AppError(
        "INVALID_MODEL",
        "Use transcribe for speech recognition",
      );
    if (input.kind === "tts" && m.kind !== "audio")
      throw new AppError("INVALID_MODEL", "TTS requires an audio model");
    if (
      input.kind === "tts" &&
      (m.category === "music" || m.category === "sound" || m.generationInput)
    )
      throw new AppError(
        "INVALID_MODEL",
        "TTS requires a speech synthesis profile",
      );
    if (
      input.kind === "tts" &&
      m.requiresVoiceProfile &&
      (!input.voiceAssetId || input.voice === "default")
    )
      throw new AppError(
        "INVALID_MODEL_INPUT",
        "Cloned speech requires its owned voice asset and voice ID",
      );
    if (m.requiresVoiceProfile && input.kind !== "tts")
      throw new AppError(
        "INVALID_MODEL_INPUT",
        "Use tts with the owned cloned voice profile",
      );
    if (
      input.kind === "generate" &&
      m.minPromptLength &&
      input.prompt.length < m.minPromptLength
    )
      throw new AppError(
        "INVALID_MODEL_INPUT",
        `Prompt requires at least ${m.minPromptLength} characters for this model`,
      );
    if (
      input.kind === "generate" &&
      m.maxPromptLength &&
      input.prompt.length > m.maxPromptLength
    )
      throw new AppError(
        "INVALID_MODEL_INPUT",
        `Prompt exceeds this model's ${m.maxPromptLength}-character limit`,
      );
    if (input.kind === "generate")
      resolveGenerationParameters(m, input.parameters);
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
    assertVideoPolicy(m, input);
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
    _source?: ReferenceSource,
    _context?: SubmissionContext,
  ): Promise<Ticket> {
    const m = this.validate(input);
    if (
      input.kind === "tts" &&
      ["fal-ai/minimax/speech-2.8-hd", "fal-ai/minimax/speech-02-hd"].includes(
        m.endpoint,
      )
    )
      return this.submitPayload(m, {
        ...m.parameters,
        [m.endpoint === "fal-ai/minimax/speech-02-hd" ? "text" : "prompt"]:
          input.text,
        language_boost: speechLanguage(input.language, "tts"),
        output_format: "url",
        voice_setting: {
          ...((m.parameters.voice_setting as Record<string, unknown>) ?? {}),
          ...(input.voice !== "default" ? { voice_id: input.voice } : {}),
        },
      });
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
      ...resolveGenerationParameters(
        m,
        input.kind === "generate" ? input.parameters : {},
      ),
      ...generationPayload(m, input, references),
      ...(input.kind === "tts" &&
      m.endpoint === "fal-ai/elevenlabs/tts/eleven-v3"
        ? {
            language_code: speechLanguageCode(input.language),
            ...(input.voice !== "default" ? { voice: input.voice } : {}),
          }
        : {}),
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
    if (m.kind === "transcript")
      throw new AppError(
        "INVALID_PROVIDER_CONFIG",
        "Transcription requires a speech adapter",
      );
    const voiceClone =
      m.endpoint === "fal-ai/minimax/voice-clone"
        ? voiceCloneSchema.parse({
            voiceId: j.custom_voice_id,
            provider: "minimax",
            reuseModel: "minimax-cloned-speech",
            activationRequiredWithinDays: 7,
          })
        : undefined;
    return {
      url,
      kind: m.kind,
      costCents: null,
      ...(voiceClone ? { voiceClone } : {}),
    };
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
  prepareRemote?(
    input: Operation,
    uri: string,
    mime: string,
  ): Promise<PreparedMedia>;
  prepare?(
    input: Operation,
    bytes?: Uint8Array,
    mime?: string,
    previous?: PreparedMedia,
  ): Promise<PreparedMedia>;
};
