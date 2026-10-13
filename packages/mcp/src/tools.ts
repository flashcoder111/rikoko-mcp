import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  compositionSchema,
  operationSchema,
  revisionPatchSchema,
  eventBindingsSchema,
  idSchema,
  transcriptSchema,
  referenceAnalysisSchema,
  type Context,
} from "../../contracts/src/index.js";
import { Service } from "../../core/src/index.js";
import { serviceMode } from "../../core/src/service-info.js";
import { AppError } from "../../contracts/src/index.js";
import { cloudConnection } from "../../cloud-client/src/index.js";
import { applyTemplateSchema } from "../../templates/src/schema.js";
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
} from "../../core/src/workspace-contracts.js";
import { plannerConfigured } from "../../core/src/workspace-planner.js";
import { revokeDelivery, workspaceResult } from "../../core/src/delivery.js";
import {
  planRecipe,
  recipeSchema,
  selectTranscript,
} from "../../recipes/src/index.js";
export const tools = {
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
      "Read the locally cached cloud templates. Does not contact the cloud or auto-update.",
    schema: z.object({}),
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
      "Read job status, output asset IDs and the optional workspace link. Reply in the original Agent conversation with a brief status and only the workspace link; never open an MCP App, browser or separate chat. Requires write scope for result access. Does not start rendering or paid generation. Use workspace_export only for explicitly requested file downloads or attachments. Set PUBLIC_BASE_URL for remote/mobile workspace access.",
    schema: z.object({ jobId: idSchema }),
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
      "Plan a natural-language request with optional attachment IDs and selected scene. Returns a proposal only. Local explicit commands are free; a server-configured creative model may be used if enabled. Unsupported requests return clarification, never fake completion. An external agent can instead supply its own validated action to workspace_commit.",
    schema: planSchema,
  },
  workspace_commit: {
    description:
      "Create a video, apply structured edits, or restore a version, then queue a real local render. Chat and studio share this endpoint. Always pass a stable idempotencyKey; editing requires projectId and the current baseRevisionId. On REVISION_CONFLICT read workspace_snapshot and re-plan. Existing media is reused; this tool does not buy new generated footage. Returns project/revision/job IDs and a workspace link. Call workspace_result for progress. Keep the user in the original Agent conversation and offer only the workspace link; do not open a window or embed a player.",
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
      type: z.enum(["project", "asset", "revision", "job", "feedback", "plan"]),
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
  switch (name) {
    case "asset_waveform":
      return assetWaveform(service, c, data);
    case "generation_usage": {
      const gateway = cloudConnection(service)?.gateway;
      if (gateway)
        return {
          ...(await gateway.usage(c)),
          billingSource: "credits",
          mode: "official",
        };
      if (serviceMode(service) === "official")
        throw new AppError("CLOUD_NOT_CONFIGURED", "官方套餐尚未连接", 409);
      return { ...(await service.usage(c)), mode: "custom" };
    }
    case "template_list":
      return (
        cloudConnection(service)?.templates?.list(c) ?? {
          templates: [],
          syncedAt: null,
          configured: false,
        }
      );
    case "template_sync":
    case "template_apply": {
      const connection = cloudConnection(service);
      if (!connection?.templates)
        throw new AppError(
          "CLOUD_NOT_CONFIGURED",
          "尚未配置模板源，请配置 TEMPLATE_API_URL 或 config.templates.url 后手动更新；无需开通付费 API",
          409,
        );
      return name === "template_sync"
        ? connection.templates.sync(c)
        : connection.templates.apply(c, data);
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
        generation: {
          mode: gateway ? "official" : (serviceMode(service) ?? "custom"),
          billingSource: gateway ? "credits" : service.billingSource,
          error: providerError,
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
          conversationPlanner: plannerConfigured()
            ? "configured-model"
            : "local-commands",
          modelPlanningMayIncurCost: plannerConfigured(),
          delivery: "mcp-app-and-expiring-media-links",
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
      if (data.input.kind === "generate" && cloudConnection(service)?.gateway)
        return cloudConnection(service)!.gateway!.quote(c, data.input);
      return service.quote(c, data.input);
    case "job_submit":
      if (data.input.kind === "generate" && cloudConnection(service)?.gateway)
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
