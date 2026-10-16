import { z } from "zod";
import { referenceDetailProfiles } from "./reference-instructions.js";
import { analysisCommand } from "../../core/src/analysis-commands.js";
import {
  memoryTools,
  callMemoryTool,
  type MemoryToolName,
} from "./memory-tools.js";
import { storyboardTools, callStoryboardTool } from "./storyboard-tools.js";
import { randomUUID } from "node:crypto";
import {
  compositionSchema,
  operationSchema,
  revisionPatchSchema,
  eventBindingsSchema,
  idSchema,
  transcriptSchema,
  isOfficialOperation,
  referenceAnalysisSchema,
  type Context,
} from "../../contracts/src/index.js";
import { Service } from "../../core/src/index.js";
import { serviceMode } from "../../core/src/service-info.js";
import { AppError } from "../../contracts/src/index.js";
import { cloudConnection } from "../../cloud-client/src/index.js";
import { applyTemplateSchema } from "../../templates/src/schema.js";
import {
  starterAssets,
  starterTemplates,
} from "../../templates/src/starters.js";
import {
  importStarter,
  organizeAsset,
  organizeAssetSchema,
  prepareStarter,
} from "../../templates/src/local-library.js";
import {
  assetCategories,
  matchesAsset,
} from "../../core/src/library-metadata.js";
import { importUrl } from "../../core/src/assets.js";
import { assetWaveform, waveformInput } from "../../core/src/waveform.js";
import {
  workspaceCommit,
  workspacePlan,
  workspaceSnapshot,
} from "../../core/src/workspace.js";
import {
  commitSchema,
  planSchema,
  requestSaveSchema,
} from "../../core/src/workspace-contracts.js";
import {
  workspaceRequestGet,
  workspaceRequestSave,
} from "../../core/src/workspace-request.js";
import { plannerConfigured } from "../../core/src/workspace-planner.js";
import { templateLibrary } from "../../templates/src/library.js";
import { rankTemplates, relevantAssets } from "../../templates/src/matching.js";
import { revokeDelivery, workspaceResult } from "../../core/src/delivery.js";
import {
  planRecipe,
  recipeSchema,
  selectTranscript,
} from "../../recipes/src/index.js";
import {
  referenceTools,
  callReferenceTool,
  adaptReference,
} from "./reference-tools.js";
export const tools = {
  ...memoryTools,
  ...referenceTools,
  ...storyboardTools,
  asset_waveform: {
    description:
      "Read peak-amplitude waveform for an owned audio/video source interval (milliseconds). Free local FFmpeg analysis; read scope, no render or paid model. Up to 10 minutes and 1024 bins per request. These are source times, before scene speed or volume edits.",
    schema: waveformInput,
  },
  generation_usage: {
    description:
      "Read the active generation billing source. Official credits and self-configured provider spending are separate; never switches payment sources.",
    schema: z.object({}),
  },
  template_list: {
    description:
      "Read ready-to-use built-in templates and cached cloud templates FIRST when creating a video. No network or generation. Templates reuse existing artwork; inspect scene slots and parameters before proposing new paid imagery.",
    schema: z.object({}),
  },
  template_prepare: {
    description:
      "Prepare a template with text parameters and optional sceneAssets mapping scene IDs to owned image/video asset IDs. Imports only needed reusable media; returns composition and reuse counts without creating a project, rendering or generating. Then pass composition to workspace_commit with a stable idempotencyKey. Missing template media is downloaded, never bought. Keep accepted assets when making changes.",
    schema: applyTemplateSchema,
  },
  template_match: {
    description:
      "Retrieve suitable template structures and reusable owned assets for a user's text brief, including when no reference video is supplied. Read-only; never downloads, renders or generates. These are internal candidates for YOU to select and adapt automatically, not choices to send to the user. Inspect the fit; use template_prepare then workspace_commit. If none fit, plan custom shots or quote only missing media. Use template_list for the full catalog when semantic fit requires broader judgment.",
    schema: z
      .object({
        brief: z.string().trim().min(1).max(5000),
        limit: z.number().int().min(1).max(5).default(3),
      })
      .strict(),
  },
  asset_starters: {
    description:
      "List original bundled illustrations available offline. Read-only. Use asset_import_starter to reuse a chosen item; no model calls.",
    schema: z.object({}),
  },
  asset_search: {
    description:
      "Find reusable owned media by name/tags, purpose category, kind and favorite status before buying generation. Returns existing assets only; no external search, render or model call.",
    schema: z
      .object({
        query: z.string().max(100).default(""),
        category: z.enum(assetCategories).optional(),
        kind: z.enum(["image", "video", "audio"]).optional(),
        favorites: z.boolean().default(false),
      })
      .strict(),
  },
  asset_import_starter: {
    description:
      "Import a bundled illustration into this account's reusable media library. Identical media is reused, no generation or charges.",
    schema: z.object({ id: idSchema }).strict(),
  },
  asset_organize: {
    description:
      "Rename an owned asset and save its purpose category, tags and favorite flag without altering its media or generating anything. Read the current library metadata before updating it.",
    schema: organizeAssetSchema,
  },
  template_sync: {
    description:
      "Manually refresh the cloud template catalog when the user requests an update. Does not generate or charge.",
    schema: z.object({}),
  },
  template_apply: {
    description:
      "Create a local project from a cached, pinned template version. Downloads only required assets. Does not purchase generation.",
    schema: applyTemplateSchema,
  },
  cloud_usage: {
    description:
      "Read cloud generation balance and reservations; separate from free local rendering.",
    schema: z.object({}),
  },
  workspace_result: {
    description:
      "Read real job status. Completed results include video/subtitle/image delivery links, current screen text and a workspace link. Deliver the video and relevant content in the original conversation. Configured Codex/Hermes hosts also save native attachments; delivery=links skips local downloads. Never open a browser or separate chat automatically. Requires write scope for media access; never starts rendering or generation. Set PUBLIC_BASE_URL for remote/mobile access; expired links can be refreshed by querying this tool again.",
    schema: z.object({
      jobId: idSchema,
      delivery: z.enum(["auto", "links"]).default("auto"),
    }),
  },
  workspace_request_save: {
    description:
      "Persist a creative request before asking for genuinely missing material. Save the user's original message, existing assetIds and concrete missingInputs (kind, prompt, purpose, required). No model, generation or render. Continue using requestId and current requestVersion; attachments accumulate, omitted missingInputs are preserved. After checking supplied material, explicitly replace missingInputs with the remaining gaps (empty array when satisfied). User-provided identity/product facts must not be invented. Pass requestId/requestVersion to workspace_commit after all required gaps are resolved.",
    schema: requestSaveSchema,
  },
  workspace_request_get: {
    description:
      "Resume a saved creative request, including original intent, follow-up turns, collected asset IDs, outstanding questions and submitted job. Read before accepting follow-up attachments, updating a request or recovering a lost response. Scoped to the current account; no model, render or generation.",
    schema: z.object({ requestId: idSchema }),
  },
  delivery_revoke: {
    description:
      "Revoke a media delivery permission returned by workspace_result. Does not delete the result.",
    schema: z.object({ grantId: idSchema }),
  },
  workspace_snapshot: {
    description:
      "Read the shared project, current version, messages, render jobs and links. Use before editing or resuming from studio. Opening this view never generates or bills. URLs use PUBLIC_BASE_URL or the local service origin; workspace links still require the user's account connection.",
    schema: z.object({ projectId: idSchema, revisionId: idSchema.optional() }),
  },
  workspace_plan: {
    description:
      "Plan and persist a natural-language request with optional attachment IDs and selected scene. Continue with requestId/requestVersion; attachment-only turns are supported and original intent is retained. Returns structured missingInputs when blocked; pass requestId/requestVersion when committing a ready plan. New requests automatically consult templates and relevant owned assets, even without a reference video. May import selected reusable template media; does not create projects, render or buy media generation. Returns one adapted proposal, never a user-facing template selection task. Local matching is deterministic; an enabled creative model can select and write the plan. Commit an authorized create action directly; clarify only genuine gaps. Existing edits preserve the current composition. A calling Agent can instead use template_match and author template_prepare/commit itself.",
    schema: planSchema,
  },
  workspace_commit: {
    description:
      "Create a video, apply structured edits, or restore a version, then queue a real local render. Chat and studio share this endpoint. Always pass a stable idempotencyKey; editing requires projectId and the current baseRevisionId. On REVISION_CONFLICT read workspace_snapshot and re-plan. Existing media is reused; this tool does not buy new generated footage. Returns project/revision/job IDs and a workspace link. Call workspace_result for progress. Keep the user in the original Agent conversation. Deliver completed video and content using workspace_result; do not open a window automatically.",
    schema: commitSchema,
  },
  capabilities: {
    description:
      "List installed and configured capabilities with evidence boundaries. Paid models are opt-in.",
    schema: z.object({}),
  },
  project_create: {
    description:
      "Create a project for related immutable composition revisions.",
    schema: z.object({
      title: z.string().min(1).max(160),
      brief: z.string().max(5000).optional(),
    }),
  },
  records_list: {
    description: "List your projects, assets, revisions, jobs or feedback.",
    schema: z.object({
      type: z.enum([
        "project",
        "asset",
        "revision",
        "job",
        "feedback",
        "plan",
        "storyboard",
        "analysis-plan",
      ]),
    }),
  },
  record_get: {
    description: "Read an owned record by stable ID.",
    schema: z.object({
      type: z.enum([
        "project",
        "asset",
        "revision",
        "job",
        "feedback",
        "plan",
        "quote",
        "storyboard",
        "analysis-plan",
      ]),
      id: idSchema,
    }),
  },
  plan_create: {
    description:
      "Plan reference remix, from-scratch or rawcut using original templates. Supplied observations are precomputed, not AI analysis.",
    schema: z.object({ projectId: idSchema, recipe: recipeSchema }),
  },
  revision_create: {
    description:
      "Store a validated immutable composition; media references must belong to your account.",
    schema: z.object({ projectId: idSchema, composition: compositionSchema }),
  },
  revision_revise: {
    description:
      "Create a child revision with scene, caption style, format or fully voiced language edits. Reuses untouched assets.",
    schema: z.object({ revisionId: idSchema, patch: revisionPatchSchema }),
  },
  revision_variants: {
    description:
      "Make independent opening variants from one revision. Language versions require revision_revise with new scene audio.",
    schema: z.object({
      revisionId: idSchema,
      variants: z
        .array(
          z.object({
            label: z.string(),
            text: z.string(),
            audioAssetId: idSchema.optional(),
            durationMs: z.number().optional(),
            eventBindings: eventBindingsSchema.optional(),
          }),
        )
        .min(1)
        .max(12),
    }),
  },
  feedback_add: {
    description:
      "Attach feedback to a scene, word or time. Optional structured patch immediately produces a new revision.",
    schema: z.object({
      revisionId: idSchema,
      text: z.string().min(1).max(2000),
      sceneId: idSchema.optional(),
      wordId: idSchema.optional(),
      atMs: z.number().nonnegative().optional(),
      patch: revisionPatchSchema.optional(),
    }),
  },
  transcript_get: {
    description:
      "Read an owned completed transcript with actual word timestamps and speaker labels. Use its words for captions or explicit transcript selection; never invent timings.",
    schema: z.object({ assetId: idSchema }),
  },
  transcript_select: {
    description:
      "Select words, speaker or literal query from a transcript, returning source intervals. This is explicit selection, not semantic AI ranking.",
    schema: z.object({
      transcript: transcriptSchema,
      wordIds: z.array(idSchema).optional(),
      speaker: z.string().optional(),
      query: z.string().optional(),
    }),
  },
  upload_create: {
    description:
      "Create an upload intent; PUT bytes to returned URL with the same Bearer key. Never pass local paths to the remote server.",
    schema: z.object({
      name: z.string(),
      bytes: z.number().int().positive(),
      sha256: z.string(),
      source: z.string(),
      license: z.string(),
      rightsConfirmed: z.literal(true),
    }),
  },
  asset_import_url: {
    description:
      "Import public HTTP(S) media after SSRF checks and media validation. Requires confirmation of rights.",
    schema: z.object({
      url: z.url(),
      name: z.string().max(120),
      license: z.string().max(100),
      rightsConfirmed: z.literal(true),
    }),
  },
  quote_create: {
    description:
      "Validate operation and produce a five-minute server-owned quote. No work or paid request begins.",
    schema: z.object({ input: operationSchema }),
  },
  job_submit: {
    description:
      "Reserve the quote budget and queue a durable job. Reuse idempotencyKey for retry; disconnect does not cancel.",
    schema: z.object({
      quoteId: idSchema,
      idempotencyKey: z.string().min(1).max(128),
      input: operationSchema,
    }),
  },
  job_resume: {
    description:
      "Resume querying or collecting a known provider request after a transient failure, without a new purchase. Unknown submissions cannot use this operation.",
    schema: z.object({ jobId: idSchema }),
  },
  job_cancel: {
    description:
      "Request cancellation. Local processes terminate; upstream cancellation does not imply a refund.",
    schema: z.object({ jobId: idSchema }),
  },
  job_reconcile: {
    description:
      "Administrator-only settlement against verified provider usage; records explanation and cost without resubmitting.",
    schema: z.object({
      jobId: idSchema,
      costCents: z.number().int().nonnegative(),
      note: z.string().min(5),
      outcome: z.enum(["completed", "failed", "cancelled"]),
      providerRequestId: z.string().optional(),
    }),
  },
  usage_get: {
    description:
      "Read available balance, reserved funds and ledger (integer cents).",
    schema: z.object({}),
  },
  key_create: {
    description:
      "Administrator only: issue a scoped key with a lifetime budget; secret is returned once.",
    schema: z.object({
      name: z.string(),
      scopes: z.array(z.enum(["read", "write", "admin"])),
      budgetCents: z.number().int().nonnegative(),
    }),
  },
  key_revoke: {
    description: "Administrator only: revoke a key immediately.",
    schema: z.object({ keyId: idSchema }),
  },
  key_rotate: {
    description:
      "Administrator only: rotate a secret while preserving its ID and budget accounting.",
    schema: z.object({ keyId: idSchema }),
  },
  preview_share: {
    description:
      "Create a revocable, one-hour preview permission for one revision.",
    schema: z.object({ revisionId: idSchema }),
  },
  preview_revoke: {
    description: "Revoke a previously issued preview permission.",
    schema: z.object({ shareId: idSchema }),
  },
} as const;
export type ToolName = keyof typeof tools;
export async function callTool(
  service: Service,
  c: Context,
  name: ToolName,
  raw: unknown,
): Promise<any> {
  const data: any = tools[name].schema.parse(raw);
  if (Object.hasOwn(memoryTools, name))
    return callMemoryTool(service, c, name as MemoryToolName, data);
  if (
    (data.jobId?.startsWith("cloud-") ||
      (data.type === "job" && data.id?.startsWith("cloud-"))) &&
    !cloudConnection(service)?.gateway
  )
    throw new AppError(
      "CLOUD_NOT_CONFIGURED",
      "请恢复任务原有的官方套餐连接后查询；不会改用其他付费来源",
      409,
    );
  if (Object.hasOwn(storyboardTools, name))
    return callStoryboardTool(
      service,
      c,
      name as keyof typeof storyboardTools,
      raw,
    );
  if (Object.hasOwn(referenceTools, name))
    return callReferenceTool(
      service,
      c,
      name as keyof typeof referenceTools,
      raw,
    );
  switch (name) {
    case "asset_waveform":
      return assetWaveform(service, c, data);
    case "generation_usage": {
      const gateway = cloudConnection(service)?.gateway;
      if (gateway)
        return {
          ...(await gateway.usage(c)),
          mode: "official",
        };
      if (serviceMode(service) === "official")
        throw new AppError("CLOUD_NOT_CONFIGURED", "官方套餐尚未连接", 409);
      return { ...(await service.usage(c)), mode: "custom" };
    }
    case "asset_starters":
      await service.scoped(c, "read", async () => {});
      return starterAssets;
    case "asset_search":
      return (await service.list(c, "asset")).filter(
        (a) =>
          ["image", "video", "audio"].includes(a.kind) &&
          (!data.kind || a.kind === data.kind) &&
          matchesAsset(a, data.query, data.category, data.favorites),
      );
    case "asset_import_starter":
      return importStarter(service, c, data.id);
    case "asset_organize":
      return organizeAsset(service, c, data);
    case "template_list":
      return templateLibrary(service, c);
    case "template_match": {
      const catalog = await templateLibrary(service, c);
      return {
        candidates: rankTemplates(data.brief, catalog.templates).slice(
          0,
          data.limit,
        ),
        assets: relevantAssets(data.brief, await service.list(c, "asset")),
        generationRequests: 0,
      };
    }
    case "template_prepare": {
      if (starterTemplates.some((t) => t.id === data.id))
        return prepareStarter(service, c, data);
      const client = cloudConnection(service)?.templates;
      if (!client)
        throw new AppError(
          "CLOUD_NOT_CONFIGURED",
          "这个云端模板尚未缓存，请先配置模板源并更新",
          409,
        );
      return client.prepare(c, data);
    }
    case "template_sync":
    case "template_apply": {
      if (
        name === "template_apply" &&
        starterTemplates.some((t) => t.id === data.id)
      ) {
        const prepared = await prepareStarter(service, c, data);
        const project = await service.createProject(c, {
          title: prepared.composition.title,
        });
        const revision = await service.addRevision(
          c,
          project.id,
          prepared.composition,
        );
        return { project, revision };
      }
      const connection = cloudConnection(service);
      if (!connection?.templates)
        throw new AppError(
          "CLOUD_NOT_CONFIGURED",
          "尚未配置模板源，请配置 TEMPLATE_API_URL 或 config.templates.url 后手动更新；无需开通付费 API",
          409,
        );
      if (name === "template_sync") {
        await connection.templates.sync(c);
        return callTool(service, c, "template_list", {});
      }
      return connection.templates.apply(c, data);
    }
    case "cloud_usage": {
      const gateway = cloudConnection(service)?.gateway;
      if (!gateway)
        throw new AppError("CLOUD_NOT_CONFIGURED", "请配置云端用户 Key", 409);
      return gateway.usage(c);
    }
    case "workspace_result":
      if (data.jobId.startsWith("cloud-") && cloudConnection(service)?.gateway)
        await cloudConnection(service)!.gateway!.get(c, data.jobId);
      return workspaceResult(service, c, data.jobId);
    case "delivery_revoke":
      return revokeDelivery(service, c, data.grantId);
    case "workspace_snapshot":
      return workspaceSnapshot(service, c, data.projectId, data.revisionId);
    case "workspace_request_get":
      return workspaceRequestGet(service, c, data.requestId);
    case "workspace_request_save":
      return workspaceRequestSave(service, c, data);
    case "workspace_plan":
      return workspacePlan(service, c, data);
    case "workspace_commit":
      return workspaceCommit(service, c, data);
    case "capabilities": {
      await service.scoped(c, "read", async () => {});
      const gateway = cloudConnection(service)?.gateway;
      let providerError: string | null = null;
      const providers = gateway
        ? await gateway.models(c).catch(() => {
            providerError = "官方模型目录暂时无法读取，请稍后刷新。";
            return [];
          })
        : service.provider.describe();
      return {
        creativeMemory: {
          storage: "local-database",
          tools: Object.keys(memoryTools),
          schemaVersion: 1,
          automaticCloudSync: false,
          paidGeneration: false,
          dataFields: {
            brand: ["description", "referenceAssetIds"],
            series: ["description", "brandId"],
            character: [
              "aliases",
              "description",
              "referenceAssetIds",
              "brandId",
              "seriesId",
            ],
            "character-look": [
              "characterId",
              "description",
              "referenceAssetIds",
            ],
            "voice-profile": [
              "provider",
              "voiceId",
              "characterId",
              "description",
            ],
          },
        },
        commands: { agentEntry: "/rikoko", items: [analysisCommand] },
        referenceAnalysis: {
          command: analysisCommand,
          settingsTool: "reference_analysis_settings",
          defaultsApplyWhen: "settings.detail=auto",
          defaultDetail: "shots",
          remakeDefaultDetail: "recreate",
          detailProfiles: referenceDetailProfiles,
          segmentedWorkflow: [
            "reference_analysis_plan",
            "reference_analysis_prepare",
            "reference_analyze",
            "reference_analysis_merge",
          ],
          localClipPreparation: true,
          samplingControl: "provider-profile-only",
          independentOfHostModel: true,
          models: providers.filter(
            (m: { kind: string }) => m.kind === "analysis",
          ),
          tools: Object.keys(referenceTools),
          schemaVersion: 2,
          nativeVideo: "gemini",
          officialGateway: gateway
            ? providerError
              ? "unavailable"
              : "available"
            : "not_configured",
          estimatesRequireReview: true,
        },
        generation: {
          storyboardTools: Object.keys(storyboardTools),
          referenceWorkflow: "image_edit_then_review_then_video",
          officialReferences: gateway
            ? providerError
              ? "unavailable"
              : "available"
            : "not_configured",
          mode: gateway ? "official" : (serviceMode(service) ?? "custom"),
          billingSource: gateway
            ? (providers[0]?.billingSource ?? "credits")
            : service.billingSource,
          error: providerError,
        },
        speech: {
          synthesis: providers.filter(
            (m: { kind: string; category?: string }) =>
              m.kind === "audio" && m.category === "speech",
          ),
          transcription: providers.filter(
            (m: { kind: string }) => m.kind === "transcript",
          ),
          cloudEngine: "fal",
          localSynthesis: {
            engine: "local",
            macOS: { zh: "Tingting", en: "Samantha" },
            linux: "espeak-ng",
            availability: "runtime-dependent",
          },
          localTranscription: {
            engine: "local",
            adapter: "WhisperX",
            availability: "requires-local-weights",
          },
          automaticFallback: false,
        },
        workspace: {
          modes: ["conversation", "studio"],
          defaultMode: "conversation",
          sharedVersions: true,
          optimisticConcurrency: true,
          edits: [
            "caption",
            "scene_fit",
            "delete",
            "move",
            "split",
            "trim",
            "delete_words",
            "visual",
            "scene_audio",
            "scene_speed",
            "audio_fade",
            "audio_envelope",
            "insert",
            "style",
            "music",
            "format",
            "restore",
          ],
          resumableRequests: true,
          resultDelivery: "media-and-content",
          conversationPlanner: plannerConfigured()
            ? "configured-model"
            : "local-commands",
          modelPlanningMayIncurCost: plannerConfigured(),
          delivery: "native-conversation-and-expiring-media-links",
        },
        local: [
          "render",
          "asset_waveform",
          "scene_speed",
          "audio_fade",
          "audio_envelope",
          "trim",
          "captions",
          "templates",
          "immutable-revisions",
          "variants",
          "upload",
          "preview",
        ],
        optional: [
          {
            id: "transcribe",
            requires: "WhisperX environment and local weights",
            status: "not_verified",
          },
          {
            id: "tts",
            requires: "installed system voice or espeak-ng",
            status: "runtime-dependent",
          },
        ],
        providers,
        cloud: {
          configured: !!cloudConnection(service),
          templates: !!cloudConnection(service)?.templates,
          generation: !!cloudConnection(service)?.gateway,
          templateSync: "manual",
          localMedia: true,
        },
        limits: {
          maxUploadBytes: 104857600,
          maxCompositionMs: 600000,
          maxInputMs: 3600000,
        },
        notImplemented: [
          "OAuth",
          "automatic face tracking",
          "social publishing",
        ],
      };
    }
    case "project_create":
      return service.createProject(c, data);
    case "records_list":
      return service.list(c, data.type);
    case "record_get":
      if (
        data.type === "job" &&
        data.id.startsWith("cloud-") &&
        cloudConnection(service)?.gateway
      )
        return cloudConnection(service)!.gateway!.get(c, data.id);
      return service.get(c, data.type, data.id);
    case "plan_create": {
      await service.get(c, "project", data.projectId);
      let analysisEvidence: string | undefined;
      if (data.recipe.analysisAssetId) {
        const asset = await service.get(
          c,
          "asset",
          data.recipe.analysisAssetId,
        );
        if (asset.kind !== "analysis")
          throw new Error("Expected analysis asset");
        const storedAnalysis = JSON.parse(
          Buffer.from(await service.storage.read(asset.storageKey)).toString(),
        );
        if (storedAnalysis.schemaVersion === 2) {
          if (
            data.recipe.referenceAssetId &&
            storedAnalysis.source?.assetId !== data.recipe.referenceAssetId
          )
            throw new AppError(
              "SOURCE_MISMATCH",
              "Analysis belongs to another reference",
            );
          if (data.recipe.scenes?.length)
            throw new AppError(
              "USE_REFERENCE_ADAPT",
              "Use reference_adapt replacements with sourceShotId for analyzed references",
            );
          return adaptReference(service, c, {
            analysisAssetId: data.recipe.analysisAssetId,
            projectId: data.projectId,
            title: data.recipe.title,
            width: data.recipe.width,
            height: data.recipe.height,
            language: data.recipe.language,
          });
        }
        if (
          storedAnalysis.assetId &&
          data.recipe.referenceAssetId &&
          storedAnalysis.assetId !== data.recipe.referenceAssetId
        )
          throw new Error("Analysis belongs to a different reference asset");
        const analysis = referenceAnalysisSchema.parse({
          schemaVersion: storedAnalysis.schemaVersion,
          summary:
            storedAnalysis.summary ??
            "User-provided reference observations; not automatic semantic analysis.",
          observations: storedAnalysis.observations,
        });
        data.recipe.observations = analysis.observations;
        analysisEvidence = asset.provenance.evidence;
      }
      const plan = planRecipe(data.recipe);
      if (analysisEvidence) plan.analysisEvidence = analysisEvidence;
      if (plan.referenceAssetId)
        await service.get(c, "asset", plan.referenceAssetId);
      const revision = await service.addRevision(
        c,
        data.projectId,
        plan.composition,
      );
      return service.db.transaction((tx) =>
        tx.put({
          id: randomUUID(),
          accountId: c.accountId,
          type: "plan",
          createdAt: new Date().toISOString(),
          projectId: data.projectId,
          revisionId: revision.id,
          ...plan,
        }),
      );
    }
    case "revision_create":
      return service.addRevision(c, data.projectId, data.composition);
    case "revision_revise":
      return service.revise(c, data.revisionId, data.patch);
    case "revision_variants":
      return service.variants(c, data.revisionId, data.variants);
    case "feedback_add":
      return service.feedback(c, data.revisionId, data);
    case "transcript_get": {
      const asset = await service.get(c, "asset", data.assetId);
      if (asset.kind !== "transcript" || asset.bytes > 2 * 1024 * 1024)
        throw new AppError(
          "INVALID_TRANSCRIPT",
          "Select an owned transcript asset",
        );
      return transcriptSchema.parse(
        JSON.parse(
          Buffer.from(await service.storage.read(asset.storageKey)).toString(),
        ),
      );
    }
    case "transcript_select":
      return selectTranscript(data.transcript.words, data);
    case "upload_create": {
      const intent = await service.createUpload(c, data);
      return {
        ...intent,
        uploadUrl: `/api/uploads/${intent.id}`,
        method: "PUT",
      };
    }
    case "asset_import_url":
      return importUrl(service, c, data);
    case "quote_create":
      if (
        isOfficialOperation(operationSchema.parse(data.input)) &&
        cloudConnection(service)?.gateway
      )
        return cloudConnection(service)!.gateway!.quote(c, data.input);
      return service.quote(c, data.input);
    case "job_submit":
      if (
        isOfficialOperation(operationSchema.parse(data.input)) &&
        cloudConnection(service)?.gateway
      )
        return cloudConnection(service)!.gateway!.submit(c, data);
      return service.submit(c, data);
    case "job_resume":
      if (data.jobId.startsWith("cloud-") && cloudConnection(service)?.gateway)
        return cloudConnection(service)!.gateway!.action(
          c,
          data.jobId,
          "resume",
        );
      return service.resume(c, data.jobId);
    case "job_cancel":
      if (data.jobId.startsWith("cloud-") && cloudConnection(service)?.gateway)
        return cloudConnection(service)!.gateway!.action(
          c,
          data.jobId,
          "cancel",
        );
      return service.cancel(c, data.jobId);
    case "job_reconcile":
      if (data.jobId.startsWith("cloud-") && cloudConnection(service)?.gateway)
        return cloudConnection(service)!.gateway!.action(
          c,
          data.jobId,
          "reconcile",
          data,
        );
      return service.reconcile(c, data.jobId, data);
    case "usage_get":
      return service.usage(c);
    case "key_create":
      return service.issueKey(c, data);
    case "key_revoke":
      return service.revokeKey(c, data.keyId);
    case "key_rotate":
      return service.rotateKey(c, data.keyId);
    case "preview_share": {
      const s = await service.createShare(c, data.revisionId);
      return { ...s, url: `/preview#${s.token}` };
    }
    case "preview_revoke":
      return service.revokeShare(c, data.shareId);
  }
}
