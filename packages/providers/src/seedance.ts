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

export const SEEDANCE_ORIGIN = "https://ark.cn-beijing.volces.com";
const taskPath = "/api/v3/contents/generations/tasks";
const taskId = /^[a-zA-Z0-9_-]{1,100}$/;
export function seedanceModelId(model: Model): string | undefined {
  if (model.kind !== "video") return;
  if (
    /^bytedance\/seedance-2\.0\/mini\/(text-to-video|image-to-video|reference-to-video)$/.test(
      model.endpoint,
    )
  )
    return "doubao-seedance-2-0-mini-260615";
  if (
    /^bytedance\/seedance-2\.5\/(?:us\/)?(text-to-video|image-to-video|reference-to-video)$/.test(
      model.endpoint,
    )
  )
    return "doubao-seedance-2-5-260628";
}

/** Official Ark transport. No retries after an ambiguous paid submission. */
export class SeedanceProvider extends FalProvider {
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
    const upstream = seedanceModelId(model);
    if (input.kind !== "generate" || !upstream)
      throw new AppError(
        "INVALID_PROVIDER_CONFIG",
        "Unsupported official Seedance profile",
      );
    const p = resolveGenerationParameters(model, input.parameters);
    const duration = Number(p.duration);
    const mini = upstream.includes("mini");
    if (
      !Number.isInteger(duration) ||
      duration < 4 ||
      duration > (mini ? 15 : 30) ||
      !(mini ? ["480p", "720p"] : ["480p", "720p", "1080p"]).includes(
        String(p.resolution),
      ) ||
      ![
        "auto",
        "adaptive",
        "21:9",
        "16:9",
        "4:3",
        "1:1",
        "3:4",
        "9:16",
      ].includes(String(p.aspect_ratio)) ||
      typeof p.generate_audio !== "boolean" ||
      model.generationInput?.mode === "video_to_video"
    )
      throw new AppError(
        "INVALID_MODEL_INPUT",
        "Unsupported official Seedance generation parameters",
      );
    return model;
  }
  override referenceDelivery(): "signed_url" {
    return "signed_url";
  }
  private call(path: string, method = "GET", body?: unknown) {
    return this.transport(SEEDANCE_ORIGIN + path, {
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
  private path(ticket: Ticket) {
    const path = `${taskPath}/${ticket.requestId}`;
    const url = SEEDANCE_ORIGIN + path;
    if (
      !taskId.test(ticket.requestId) ||
      ticket.connectionId !== "seedance-official-v3" ||
      ticket.connectionVersion !== SEEDANCE_ORIGIN ||
      ticket.statusUrl !== url ||
      ticket.resultUrl !== url ||
      ticket.cancelUrl !== url
    )
      throw new AppError(
        "INVALID_PROVIDER_RESPONSE",
        "Untrusted Seedance task ticket",
      );
    return path;
  }
  override async submit(
    input: Operation,
    _assetUrl?: string,
    references?: ResolvedReference[],
  ): Promise<Ticket> {
    const model = this.validate(input);
    if (input.kind !== "generate")
      throw new AppError("INVALID_MODEL_INPUT", "Expected video generation");
    generationPayload(model, input, references);
    const p = resolveGenerationParameters(model, input.parameters);
    const content: Record<string, unknown>[] = [
      { type: "text", text: input.prompt },
    ];
    for (const reference of references ?? []) {
      if (!reference.url.startsWith("https://"))
        throw new AppError(
          "INVALID_MEDIA",
          "Seedance references require controlled HTTPS delivery",
        );
      const binding = model.generationInput!.bindings.find((b) =>
        b.roles.includes(reference.role),
      )!;
      const type = `${binding.kind}_url`;
      const role = ["first_frame", "last_frame"].includes(reference.role)
        ? reference.role
        : `reference_${binding.kind}`;
      content.push({ type, [type]: { url: reference.url }, role });
    }
    const frames = ["image_to_video", "first_last_frame"].includes(
      model.generationInput?.mode ?? "",
    );
    let response: Response;
    try {
      response = await this.call(taskPath, "POST", {
        model: seedanceModelId(model),
        content,
        duration: Number(p.duration),
        resolution: p.resolution,
        ratio:
          frames || p.aspect_ratio === "auto" ? "adaptive" : p.aspect_ratio,
        generate_audio: p.generate_audio,
        watermark: false,
        ...(seedanceModelId(model) === "doubao-seedance-2-5-260628" &&
        model.generationInput?.mode === "reference_to_video"
          ? { omni_reference_task_type: "reference" }
          : {}),
      });
    } catch {
      throw new SubmissionUnknown();
    }
    if (!response.ok) {
      if (
        response.status >= 500 ||
        response.status === 408 ||
        (response.status >= 300 && response.status < 400)
      )
        throw new SubmissionUnknown();
      throw new AppError(
        "PROVIDER_REJECTED",
        `Seedance rejected submission (${response.status})`,
        502,
      );
    }
    try {
      const value = (await response.json()) as { id?: unknown };
      if (typeof value.id !== "string" || !taskId.test(value.id)) throw Error();
      const url = `${SEEDANCE_ORIGIN}${taskPath}/${value.id}`;
      return {
        connectionId: "seedance-official-v3",
        connectionVersion: SEEDANCE_ORIGIN,
        requestId: value.id,
        statusUrl: url,
        resultUrl: url,
        cancelUrl: url,
      };
    } catch {
      throw new SubmissionUnknown();
    }
  }
  private async task(ticket: Ticket) {
    const response = await this.call(this.path(ticket));
    if (!response.ok)
      throw new AppError(
        "PROVIDER_POLL_FAILED",
        `Seedance status unavailable (${response.status})`,
        502,
      );
    const task = (await response.json()) as {
      id?: string;
      model?: string;
      status?: string;
      content?: { video_url?: string };
    };
    if (
      !task ||
      task.id !== ticket.requestId ||
      ![
        "doubao-seedance-2-0-mini-260615",
        "doubao-seedance-2-5-260628",
      ].includes(task.model ?? "") ||
      ![
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "expired",
      ].includes(task.status ?? "")
    )
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Invalid Seedance task response",
        502,
      );
    return task;
  }
  override async poll(ticket: Ticket) {
    const task = await this.task(ticket);
    return task.status === "succeeded"
      ? "completed"
      : ["failed", "cancelled", "expired"].includes(task.status!)
        ? "failed"
        : "pending";
  }
  override async collect(
    ticket: Ticket,
    input: Operation,
  ): Promise<ProviderResult> {
    // Collection must survive later catalog/paid-enable changes to already accepted work.
    const model = this.models.find(
      (m) => "model" in input && m.id === input.model,
    );
    const task = await this.task(ticket);
    let url: URL;
    try {
      url = new URL(task.content?.video_url ?? "");
    } catch {
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Seedance result URL missing",
      );
    }
    if (
      !model ||
      task.model !== seedanceModelId(model) ||
      task.status !== "succeeded" ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new AppError(
        "PROVIDER_RESULT_INVALID",
        "Matching Seedance task and completed HTTPS result required",
      );
    // Ark bills in CNY; token usage is not a USD-cent settlement.
    return { kind: "video", url: url.toString(), costCents: null };
  }
  override async cancel(ticket: Ticket) {
    // DELETE on completed tasks deletes their record; only cancel queued tasks.
    if ((await this.task(ticket)).status !== "queued")
      return { accepted: false, refunded: false };
    const response = await this.call(this.path(ticket), "DELETE");
    // A task can start between GET and DELETE. Confirm cancellation before reporting success.
    const accepted =
      response.ok && (await this.task(ticket)).status === "cancelled";
    return { accepted, refunded: false };
  }
}
