import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  type Operation,
  type Entity,
  generationInputSchema,
} from "../../contracts/src/index.js";
import type { ResolvedReference } from "./generation-input.js";
import { cloudOrigin } from "../../cloud-client/src/http.js";
import {
  FalProvider,
  type Model,
  type MediaProvider,
  type Ticket,
  type PreparedMedia,
  type ReferenceSource,
} from "./index.js";
import { FalVideoProvider } from "./fal-video.js";
import { GeminiProvider } from "./gemini.js";
import { ReplicateProvider } from "./replicate.js";
import { allowedParametersSchema } from "./generation-parameters.js";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const envName = z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/);
const originSchema = z.string().refine((s) => {
  try {
    cloudOrigin(s);
    return true;
  } catch {
    return false;
  }
}, "Expected HTTPS origin");
const templatesSchema = z
  .union([z.literal(false), z.object({ url: originSchema }).strict()])
  .optional();
export const modelSchema = z
  .object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(300).optional(),
    endpoint: z
      .string()
      .regex(/^[a-zA-Z0-9_./-]+$/)
      .refine((s) => !s.includes("..")),
    kind: z.enum([
      "image",
      "video",
      "audio",
      "analysis",
      "translation",
      "transcript",
    ]),
    category: z.enum(["speech", "music", "sound"]).optional(),
    maxCostCents: z.number().int().positive().max(1000000),
    creditPriceCents: z.number().int().positive().max(1000000).optional(),
    priceVersion: z.string().min(1).max(200),
    hardBoundConfirmed: z.boolean(),
    maxPromptLength: z.number().int().positive().max(20000).optional(),
    minPromptLength: z.number().int().positive().max(5000).optional(),
    parameters: z.record(z.string(), z.json()),
    allowedParameters: allowedParametersSchema.optional(),
    promptField: z.string().regex(/^\w+$/).optional(),
    assetField: z.string().regex(/^\w+$/).optional(),
    responseField: z.string().regex(/^\w+$/).optional(),
    requiresVoiceProfile: z.boolean().optional(),
    generationInput: generationInputSchema.optional(),
  })
  .strict()
  .superRefine((model, ctx) => {
    const profile = model.generationInput;
    if (!profile) return;
    if (
      (profile.mode === "image_edit"
        ? "image"
        : profile.mode === "voice_clone"
          ? "audio"
          : "video") !== model.kind
    )
      ctx.addIssue({
        code: "custom",
        path: ["generationInput", "mode"],
        message: "Reference mode must match output kind",
      });
    if (
      profile.bindings.some(
        (b) =>
          b.field === (model.promptField ?? "prompt") ||
          Object.hasOwn(model.parameters, b.field),
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["generationInput", "bindings"],
        message: "Reference fields cannot override prompts or fixed parameters",
      });
  });
const connectionSchema = z
  .object({
    id: identifier,
    adapter: z.enum(["fal", "fal-video", "replicate", "gemini"]),
    keyEnv: envName,
    enabled: z.boolean().default(false),
    models: z.array(modelSchema).min(1).max(100),
  })
  .strict();
const schema = z.discriminatedUnion("mode", [
  z
    .object({
      schemaVersion: z.literal(1),
      mode: z.literal("official"),
      templates: templatesSchema,
      official: z
        .object({
          url: z.string().refine((s) => {
            try {
              cloudOrigin(s);
              return true;
            } catch {
              return false;
            }
          }, "Expected HTTPS origin"),
          keyEnv: envName,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      mode: z.literal("custom"),
      templates: templatesSchema,
      providers: z.array(connectionSchema).max(20),
    })
    .strict(),
]);
export type ModelConfig = z.infer<typeof schema>;
export function parseModelConfig(raw: unknown): ModelConfig {
  const config = schema.parse(raw);
  if (config.mode === "custom") {
    const ids = new Set<string>(),
      models = new Set<string>();
    for (const connection of config.providers) {
      if (ids.has(connection.id))
        throw new AppError(
          "INVALID_PROVIDER_CONFIG",
          "Duplicate connection id",
        );
      ids.add(connection.id);
      for (const model of connection.models) {
        if (models.has(model.id))
          throw new AppError("INVALID_PROVIDER_CONFIG", "Duplicate model id");
        models.add(model.id);
      }
    }
  }
  return config;
}
export async function loadModelConfig(path: string) {
  return parseModelConfig(JSON.parse(await readFile(path, "utf8")));
}
export class ProviderRegistry implements MediaProvider {
  constructor(
    private connections: {
      id: string;
      version: string;
      provider: MediaProvider;
    }[],
  ) {}
  get models(): Model[] {
    return this.connections.flatMap((c) => c.provider.models);
  }
  describe() {
    return this.connections.flatMap((c) => c.provider.describe());
  }
  private forInput(input: Operation) {
    const connection = this.connections.find((c) =>
      c.provider.models.some((m) => "model" in input && m.id === input.model),
    );
    if (!connection)
      throw new AppError(
        "CAPABILITY_UNAVAILABLE",
        "The model is not configured or is unavailable",
        409,
      );
    return connection;
  }
  private forTicket(ticket: Ticket) {
    const connection = this.connections.find(
      (c) => c.id === ticket.connectionId,
    );
    if (!connection || connection.version !== ticket.connectionVersion)
      throw new AppError(
        "PROVIDER_CONFIG_CHANGED",
        "The job's model connection has changed. Restore the original configuration before checking its status; no new purchase will be made.",
        409,
      );
    return connection;
  }
  validate(input: Operation) {
    return this.forInput(input).provider.validate(input);
  }
  analysisSettings(input: Operation) {
    const provider = this.forInput(input).provider;
    if (!provider.analysisSettings)
      throw new AppError(
        "CAPABILITY_UNAVAILABLE",
        "Provider has no reference analysis profile",
        409,
      );
    return provider.analysisSettings(input);
  }
  validateSource(input: Operation, asset: Entity) {
    this.forInput(input).provider.validateSource?.(input, asset);
  }
  async prepare(
    input: Operation,
    bytes?: Uint8Array,
    mime?: string,
    previous?: PreparedMedia,
  ) {
    const c = this.forInput(input);
    if (
      previous &&
      (previous.connectionId !== c.id ||
        previous.connectionVersion !== c.version)
    )
      throw new AppError(
        "PROVIDER_CONFIG_CHANGED",
        "Analysis upload belongs to a different connection",
        409,
      );
    if (!c.provider.prepare)
      throw new AppError(
        "CAPABILITY_UNAVAILABLE",
        "This provider does not accept native reference video",
        409,
      );
    return {
      ...(await c.provider.prepare(input, bytes, mime, previous)),
      connectionId: c.id,
      connectionVersion: c.version,
    };
  }
  estimate(input: Operation) {
    const c = this.forInput(input),
      price = c.provider.estimate(input);
    return { ...price, priceVersion: `${price.priceVersion}:${c.version}` };
  }
  referenceDelivery(input: Operation) {
    return (
      this.forInput(input).provider.referenceDelivery?.(input) ?? "signed_url"
    );
  }
  async submit(
    input: Operation,
    assetUrl?: string,
    references?: ResolvedReference[],
    source?: ReferenceSource,
  ) {
    const c = this.forInput(input);
    return {
      ...(await c.provider.submit(input, assetUrl, references, source)),
      connectionId: c.id,
      connectionVersion: c.version,
    };
  }
  async poll(ticket: Ticket) {
    return this.forTicket(ticket).provider.poll(ticket);
  }
  async cancel(ticket: Ticket) {
    return this.forTicket(ticket).provider.cancel(ticket);
  }
  async collect(ticket: Ticket, input: Operation) {
    const c = this.forTicket(ticket);
    if (this.forInput(input) !== c)
      throw new AppError(
        "PROVIDER_CONFIG_CHANGED",
        "Model connection mismatch",
        409,
      );
    return c.provider.collect(ticket, input);
  }
}
export function buildProviders(
  config: ModelConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
) {
  return new ProviderRegistry(
    config.mode === "official"
      ? []
      : config.providers.map((c) => {
          const key = env[c.keyEnv];
          const version = createHash("sha256")
            .update(JSON.stringify(c))
            .update(key ?? "")
            .digest("hex");
          return {
            id: c.id,
            version,
            provider:
              c.adapter === "fal-video"
                ? new FalVideoProvider(c.models, key, c.enabled, fetcher)
                : c.adapter === "gemini"
                  ? new GeminiProvider(c.models, key, c.enabled, fetcher)
                  : c.adapter === "fal"
                    ? new FalProvider(c.models, key, c.enabled, fetcher)
                    : new ReplicateProvider(c.models, key, c.enabled, fetcher),
          };
        }),
  );
}
