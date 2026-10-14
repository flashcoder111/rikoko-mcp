import { AppError, type Operation } from "../../contracts/src/index.js";
import {
  generationPayload,
  type ResolvedReference,
} from "./generation-input.js";
import {
  FalProvider,
  SubmissionUnknown,
  type Model,
  type Ticket,
  type ProviderResult,
} from "./index.js";

/** Official model predictions: https://replicate.com/docs/reference/http/ */
export class ReplicateProvider extends FalProvider {
  constructor(
    models: Model[],
    private token?: string,
    enabled = false,
    private transport: typeof fetch = fetch,
  ) {
    super(models, token, enabled);
  }
  private call(url: string, method = "GET", body?: unknown) {
    const parsed = new URL(url);
    if (
      parsed.origin !== "https://api.replicate.com" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !/^\/v1\/(predictions\/[a-zA-Z0-9_-]+(?:\/cancel)?|models\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\/predictions)$/.test(
        parsed.pathname,
      )
    )
      throw new AppError(
        "INVALID_PROVIDER_RESPONSE",
        "Untrusted prediction URL",
      );
    return this.transport(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  override referenceDelivery(): "signed_url" {
    return "signed_url";
  }
  override async submit(
    input: Operation,
    assetUrl?: string,
    references?: ResolvedReference[],
  ): Promise<Ticket> {
    const m = this.validate(input);
    if (
      !["image", "video", "audio"].includes(m.kind) ||
      !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(m.endpoint)
    )
      throw new AppError(
        "INVALID_PROVIDER_CONFIG",
        "Replicate requires an official owner/model media endpoint",
      );
    const prompt =
      input.kind === "generate"
        ? input.prompt
        : input.kind === "tts"
          ? input.text
          : "";
    let response: Response;
    try {
      response = await this.call(
        `https://api.replicate.com/v1/models/${m.endpoint}/predictions`,
        "POST",
        {
          input: {
            ...m.parameters,
            ...generationPayload(m, input, references),
            [m.promptField ?? (input.kind === "tts" ? "text" : "prompt")]:
              prompt,
            ...(assetUrl ? { [m.assetField ?? "image"]: assetUrl } : {}),
          },
        },
      );
    } catch {
      throw new SubmissionUnknown();
    }
    if (!response.ok) {
      if (response.status >= 500) throw new SubmissionUnknown();
      throw new AppError(
        "PROVIDER_REJECTED",
        `Provider rejected submission (${response.status})`,
        502,
      );
    }
    try {
      const result = (await response.json()) as { id: string };
      if (typeof result.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(result.id))
        throw Error();
      const url = `https://api.replicate.com/v1/predictions/${result.id}`;
      return {
        requestId: result.id,
        statusUrl: url,
        resultUrl: url,
        cancelUrl: `${url}/cancel`,
      };
    } catch {
      throw new SubmissionUnknown();
    }
  }
  override async poll(ticket: Ticket) {
    const response = await this.call(ticket.statusUrl);
    if (!response.ok)
      throw new AppError(
        "PROVIDER_POLL_FAILED",
        "Prediction status unavailable",
        502,
      );
    const result = (await response.json()) as {
      status: string;
      error?: unknown;
    };
    return result.error || ["failed", "canceled"].includes(result.status)
      ? "failed"
      : result.status === "succeeded"
        ? "completed"
        : "pending";
  }
  override async cancel(ticket: Ticket) {
    const response = await this.call(ticket.cancelUrl, "POST");
    return { accepted: response.ok, refunded: false };
  }
  override async collect(
    ticket: Ticket,
    input: Operation,
  ): Promise<ProviderResult> {
    const m = this.validate(input);
    const response = await this.call(ticket.resultUrl);
    if (!response.ok)
      throw new AppError(
        "PROVIDER_RESULT_FAILED",
        "Prediction result unavailable",
        502,
      );
    const result = (await response.json()) as {
      status: string;
      output: unknown;
      error?: unknown;
    };
    const url = Array.isArray(result.output) ? result.output[0] : result.output;
    if (
      result.status !== "succeeded" ||
      result.error ||
      typeof url !== "string" ||
      !["image", "video", "audio"].includes(m.kind)
    )
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Expected a completed media URL",
      );
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Expected a public HTTPS result",
      );
    return {
      url,
      kind: m.kind as "image" | "video" | "audio",
      costCents: null,
    };
  }
}
