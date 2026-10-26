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
} from "./index.js";

export const MINIMAX_CN_ORIGIN = "https://api.minimax.cn";
export const MINIMAX_GLOBAL_ORIGIN = "https://api.minimax.io";
export const isMiniMaxH3 = (m: Model) =>
  m.kind === "video" &&
  /^minimax\/h3-max\/(text-to-video|image-to-video|reference-to-video)$/.test(
    m.endpoint,
  );

/** Official H3 V2 API. Profile endpoints retain compatible rikoko model identities. */
export class MiniMaxProvider extends FalProvider {
  constructor(
    models: Model[],
    key?: string,
    enabled = false,
    private transport: typeof fetch = fetch,
    private origin = MINIMAX_CN_ORIGIN,
  ) {
    super(models, key, enabled);
    if (![MINIMAX_CN_ORIGIN, MINIMAX_GLOBAL_ORIGIN].includes(origin))
      throw new AppError(
        "INVALID_PROVIDER_CONFIG",
        "Unsupported MiniMax API region",
      );
  }
  override validate(input: Operation) {
    const m = super.validate(input);
    if (input.kind !== "generate" || !isMiniMaxH3(m))
      throw new AppError(
        "INVALID_PROVIDER_CONFIG",
        "MiniMax requires an H3 Max video profile",
      );
    const p = resolveGenerationParameters(m, input.parameters);
    if (
      !Number.isInteger(p.duration) ||
      Number(p.duration) < 5 ||
      Number(p.duration) > 15 ||
      !["480P", "768P"].includes(String(p.resolution)) ||
      !["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(
        String(p.aspect_ratio),
      ) ||
      (!m.generationInput && p.aspect_ratio === "adaptive") ||
      p.prompt_expansion_mode !== "disabled"
    )
      throw new AppError(
        "INVALID_MODEL_INPUT",
        "Unsupported official MiniMax H3 Max parameters",
      );
    return m;
  }
  override referenceDelivery(): "signed_url" {
    return "signed_url";
  }
  private call(path: string, method = "GET", body?: unknown) {
    return this.transport(this.origin + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  private ticketPath(ticket: Ticket, cancel = false) {
    if (!/^\d{1,80}$/.test(ticket.requestId))
      throw new AppError(
        "INVALID_PROVIDER_RESPONSE",
        "Invalid MiniMax task identity",
      );
    const query = `${this.origin}/v2/query/video_generation/${ticket.requestId}`;
    const deletion = `${this.origin}/v2/video_generation/${ticket.requestId}`;
    if (
      ticket.connectionId !== "minimax-official-v2" ||
      ticket.connectionVersion !== this.origin ||
      ticket.statusUrl !== query ||
      ticket.resultUrl !== query ||
      ticket.cancelUrl !== deletion
    )
      throw new AppError(
        "INVALID_PROVIDER_RESPONSE",
        "Untrusted MiniMax task ticket",
      );
    return (cancel ? deletion : query).slice(this.origin.length);
  }
  override async submit(
    input: Operation,
    _assetUrl?: string,
    references?: ResolvedReference[],
  ): Promise<Ticket> {
    const m = this.validate(input);
    if (input.kind !== "generate")
      throw new AppError("INVALID_MODEL_INPUT", "Expected video generation");
    generationPayload(m, input, references); // Verify ordered, bound reference identities and URL shapes.
    const p = resolveGenerationParameters(m, input.parameters);
    const content: Record<string, unknown>[] = [
      { type: "text", text: input.prompt },
    ];
    for (const reference of references ?? []) {
      if (!reference.url.startsWith("https://"))
        throw new AppError(
          "INVALID_MEDIA",
          "MiniMax references require controlled HTTPS delivery",
        );
      const binding = m.generationInput!.bindings.find((b) =>
        b.roles.includes(reference.role),
      )!;
      const type = `${binding.kind}_url`;
      const role = ["first_frame", "last_frame"].includes(reference.role)
        ? reference.role
        : `reference_${binding.kind}`;
      content.push({ type, [type]: { url: reference.url }, role });
    }
    let response: Response;
    try {
      response = await this.call("/v2/video_generation", "POST", {
        model: "MiniMax-H3-Max",
        content,
        duration: p.duration,
        resolution: p.resolution,
        ratio:
          m.generationInput?.mode === "image_to_video" ||
          m.generationInput?.mode === "first_last_frame"
            ? "adaptive"
            : p.aspect_ratio,
        extra: { prompt_expansion_mode: "disabled" },
      });
    } catch {
      throw new SubmissionUnknown();
    }
    if (!response.ok) {
      if (response.status >= 500 || response.status === 408)
        throw new SubmissionUnknown();
      throw new AppError(
        "PROVIDER_REJECTED",
        `MiniMax rejected submission (${response.status})`,
        502,
      );
    }
    try {
      const value = (await response.json()) as { task_id?: unknown };
      if (
        typeof value.task_id !== "string" ||
        !/^\d{1,80}$/.test(value.task_id)
      )
        throw Error();
      const url = `${this.origin}/v2/query/video_generation/${value.task_id}`;
      return {
        connectionId: "minimax-official-v2",
        connectionVersion: this.origin,
        requestId: value.task_id,
        statusUrl: url,
        resultUrl: url,
        cancelUrl: `${this.origin}/v2/video_generation/${value.task_id}`,
      };
    } catch {
      throw new SubmissionUnknown();
    }
  }
  private async task(ticket: Ticket) {
    const response = await this.call(this.ticketPath(ticket));
    if (!response.ok)
      throw new AppError(
        "PROVIDER_POLL_FAILED",
        `MiniMax status unavailable (${response.status})`,
        502,
      );
    const value = (await response.json()) as {
      task?: {
        id?: string;
        model?: string;
        status?: string;
        content?: { url?: string };
      };
    };
    const task = value.task;
    if (
      !task ||
      task.id !== ticket.requestId ||
      task.model !== "MiniMax-H3-Max" ||
      !["queued", "running", "succeeded", "failed", "cancelled"].includes(
        task.status ?? "",
      )
    )
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Invalid MiniMax task response",
        502,
      );
    return task;
  }
  override async poll(ticket: Ticket) {
    const task = await this.task(ticket);
    return task.status === "succeeded"
      ? "completed"
      : ["failed", "cancelled"].includes(task.status!)
        ? "failed"
        : "pending";
  }
  override async collect(
    ticket: Ticket,
    input: Operation,
  ): Promise<ProviderResult> {
    this.validate(input);
    const task = await this.task(ticket);
    let url: URL;
    try {
      url = new URL(task.content?.url ?? "");
    } catch {
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "MiniMax result URL missing",
      );
    }
    if (
      task.status !== "succeeded" ||
      url.protocol !== "https:" ||
      url.username ||
      url.password
    )
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "MiniMax completed HTTPS result required",
      );
    // Official CN usage is denominated in CNY. Do not misreport it as USD cents.
    return { kind: "video", url: url.toString(), costCents: null };
  }
  override async cancel(ticket: Ticket) {
    const response = await this.call(this.ticketPath(ticket, true), "DELETE");
    return { accepted: response.ok, refunded: false };
  }
}
