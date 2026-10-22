import { prepareTemplate } from "../../templates/src/prepare.js";
import { snapshotGuidance } from "./director-guidance.js";
import { randomUUID } from "node:crypto";
import {
  readCreativeContext,
  validateCreativeComposition,
  checkCreativeReferences,
} from "./creative-context.js";
import {
  AppError,
  compositionSchema,
  type Composition,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import { Service, fingerprint } from "./index.js";
import { applyEdits } from "./editing.js";
import {
  commitSchema,
  planSchema,
  type Proposal,
} from "./workspace-contracts.js";
import { planRequest, plannerConfigured } from "./workspace-planner.js";
import { publicBaseUrl } from "./urls.js";
import { templateLibrary } from "../../templates/src/library.js";
import {
  templateContext,
  validateTemplateDecision,
  adaptTemplateComposition,
} from "../../templates/src/planning.js";
import { prepareStarter } from "../../templates/src/local-library.js";
import { cloudConnection } from "../../cloud-client/src/index.js";
import { avoidsTemplates } from "../../templates/src/matching.js";
import {
  readRequest,
  workspaceRequestGet,
  workspaceRequestSave,
} from "./workspace-request.js";

function fail(code: string, message: string, status = 400): never {
  throw new AppError(code, message, status);
}
const make = (
  accountId: string,
  type: string,
  data: Record<string, unknown>,
): Entity => ({
  id: randomUUID(),
  accountId,
  type,
  createdAt: new Date().toISOString(),
  ...data,
});
async function own(tx: Transaction, c: Context, type: string, id: string) {
  return (
    (await tx.get(id, c.accountId, type)) ??
    fail("NOT_FOUND", "找不到作品或素材。", 404)
  );
}
export function workspaceLinks(projectId: string, revisionId?: string) {
  const query = new URLSearchParams({
    project: projectId,
    ...(revisionId ? { revision: revisionId } : {}),
  });
  const base = publicBaseUrl();
  return {
    workspace: `${base}/workspace?${query}`,
    conversation: `${base}/?${new URLSearchParams({ project: projectId })}`,
  };
}
async function head(tx: Transaction, c: Context, project: Entity) {
  if (project.headRevisionId)
    return own(tx, c, "revision", project.headRevisionId);
  return (
    (await tx.list(c.accountId, "revision")).find(
      (r) => r.projectId === project.id,
    ) ?? null
  );
}
async function validateMedia(
  tx: Transaction,
  c: Context,
  composition: Composition,
) {
  for (const scene of composition.scenes) {
    if (scene.assetId) {
      const asset = await own(tx, c, "asset", scene.assetId);
      if (!["image", "video"].includes(asset.kind))
        fail("INVALID_MEDIA", "画面需要图片或视频素材。");
      if (
        asset.kind === "video" &&
        scene.sourceStartMs + scene.durationMs * (scene.speed ?? 1) >
          asset.metadata.durationMs + 100
      )
        fail("INVALID_INTERVAL", "镜头超出视频长度，请调整裁剪范围。");
    }
    if (scene.audioAssetId) {
      const asset = await own(tx, c, "asset", scene.audioAssetId);
      if (
        asset.kind !== "audio" &&
        !(asset.kind === "video" && asset.metadata.hasAudio)
      )
        fail("INVALID_MEDIA", "声音素材中没有音轨。");
      if ((scene.audioSourceStartMs ?? 0) >= asset.metadata.durationMs)
        fail("INVALID_INTERVAL", "声音起点超出素材长度。");
    }
  }
  for (const event of composition.events)
    if (event.assetId) {
      const asset = await own(tx, c, "asset", event.assetId);
      if (event.kind === "sound") {
        if (asset.kind !== "audio" || !asset.metadata.hasAudio)
          fail("INVALID_MEDIA", "音效需要带音轨的音频素材。");
        if (
          (event.audioSourceStartMs ?? 0) + event.durationMs >
          asset.metadata.durationMs + 100
        )
          fail("INVALID_INTERVAL", "音效播放范围超出素材长度。");
      } else if (!["image", "video"].includes(asset.kind))
        fail("INVALID_MEDIA", "叠加画面需要图片或视频。");
    }
  if (composition.audio?.assetId) {
    const asset = await own(tx, c, "asset", composition.audio.assetId);
    if (
      asset.kind !== "audio" &&
      !(asset.kind === "video" && asset.metadata.hasAudio)
    )
      fail("INVALID_MEDIA", "背景音乐素材中没有音轨。");
  }
}

export async function workspaceSnapshot(
  service: Service,
  c: Context,
  projectId: string,
  revisionId?: string,
) {
  return service.scoped(c, "read", async (tx) => {
    const project = await own(tx, c, "project", projectId);
    const latest = await head(tx, c, project);
    const revision = revisionId
      ? await own(tx, c, "revision", revisionId)
      : latest;
    if (revision && revision.projectId !== projectId)
      fail("NOT_FOUND", "此版本不属于该作品。", 404);
    const revisions = (await tx.list(c.accountId, "revision"))
      .filter((r) => r.projectId === projectId)
      .sort(
        (a, b) =>
          (b.version ?? 0) - (a.version ?? 0) ||
          b.createdAt.localeCompare(a.createdAt),
      );
    const revisionIds = new Set(revisions.map((r) => r.id));
    const jobs = (await tx.list(c.accountId, "job")).filter((j) =>
      revisionIds.has(j.revisionId),
    );
    const messages = (await tx.list(c.accountId, "workspace-command"))
      .filter((m) => m.projectId === projectId)
      .sort((a, b) => a.version - b.version)
      .map((m) => ({
        id: m.id,
        projectId,
        revisionId: m.revisionId,
        version: m.version,
        text: m.message,
        summary: m.summary,
        origin: m.origin,
        createdAt: m.createdAt,
        jobId: m.jobId,
      }));
    return {
      project,
      revision,
      headRevisionId: latest?.id ?? null,
      guidance: snapshotGuidance(project, revision, jobs, latest),
      revisions,
      jobs,
      messages,
      links: workspaceLinks(projectId, revision?.id),
    };
  });
}

export async function workspaceCommit(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = commitSchema.parse(raw);
  const commandId = fingerprint({
    accountId: c.accountId,
    workspaceCommand: input.idempotencyKey,
  });
  const hash = fingerprint(input);
  const command = await service.scoped(c, "write", async (tx) => {
    const previous = await tx.get(commandId, c.accountId, "workspace-command");
    if (previous) {
      if (previous.inputHash !== hash)
        fail(
          "IDEMPOTENCY_CONFLICT",
          "同一请求标识对应了不同内容，请重新提交。",
          409,
        );
      return previous;
    }
    const request = input.requestId
      ? await readRequest(tx, c, input.requestId, input.requestVersion)
      : undefined;
    if (request) {
      if (input.requestVersion === undefined)
        fail("INVALID_INPUT", "提交请求时需要当前 requestVersion。");
      if (request.status !== "ready")
        fail(
          "REQUEST_NOT_READY",
          "请先补齐必需素材；已经提交的请求请查询结果。",
          409,
        );
      if ((request.projectId ?? undefined) !== input.projectId)
        fail("INVALID_INPUT", "创作请求与作品不匹配。");
    }
    const preparationId =
      input.templatePreparationId ?? request?.proposal?.templatePreparationId;
    const templatePreparation = preparationId
      ? await tx.get(preparationId, c.accountId, "template-preparation")
      : null;
    if (
      preparationId &&
      (!templatePreparation?.composition || input.action.type !== "create")
    )
      fail("INVALID_INPUT", "模板准备记录不存在或不能用于此操作。");
    let project: Entity,
      composition: Composition,
      restoredContext: Entity | undefined,
      parent: Entity | null = null;
    if (input.action.type === "create") {
      if (input.baseRevisionId)
        fail("INVALID_EDIT", "新作品无需传入已有作品或版本。");
      composition = input.action.composition;
      if (input.projectId) {
        project = await own(tx, c, "project", input.projectId);
        if (!project.productionScope || (await head(tx, c, project)))
          fail(
            "INVALID_EDIT",
            "Only an empty production-plan project accepts an initial composition.",
          );
        project = { ...project, workspaceManaged: true };
      } else
        project = make(c.accountId, "project", {
          title: composition.title,
          brief: input.message,
          workspaceManaged: true,
        });
    } else {
      if (!input.projectId || !input.baseRevisionId)
        fail(
          "INVALID_EDIT",
          "编辑需要作品和基础版本，请先读取 workspace_snapshot。",
        );
      project = await own(tx, c, "project", input.projectId);
      parent = await head(tx, c, project);
      if (!parent || parent.id !== input.baseRevisionId)
        fail(
          "REVISION_CONFLICT",
          "作品已在另一个入口更新。请加载最新版本后重新应用修改。",
          409,
        );
      if (input.action.type === "restore") {
        const restored = await own(tx, c, "revision", input.action.revisionId);
        if (restored.projectId !== project.id)
          fail("NOT_FOUND", "不能恢复其他作品的版本。", 404);
        composition = compositionSchema.parse(restored.composition);
        restoredContext = restored.creativeContext;
      } else {
        // Preserve original video audio when a visual is replaced by an image.
        let current = compositionSchema.parse(parent.composition);
        for (const edit of input.action.edits) {
          if (edit.type === "visual" && edit.preserveAudio) {
            current = structuredClone(current);
            const scene = current.scenes.find((s) => s.id === edit.sceneId);
            if (scene?.assetId && !scene.audioAssetId) {
              const source = await own(tx, c, "asset", scene.assetId);
              if (source.kind === "video" && source.metadata.hasAudio) {
                scene.audioAssetId = source.id;
                scene.audioSourceStartMs = scene.sourceStartMs;
              }
            }
          }
          current = applyEdits(current, [edit]);
        }
        composition = current;
      }
    }
    await validateMedia(tx, c, composition);
    const creativeContextId =
      input.creativeContextId ?? request?.creativeContextId;
    const creativeContext = creativeContextId
      ? await readCreativeContext(tx, c, creativeContextId, input.projectId)
      : input.action.type === "restore"
        ? restoredContext
        : parent?.creativeContext;
    if (creativeContextId && creativeContext)
      await checkCreativeReferences(tx, c, creativeContext);
    const creativeRuleChecks = creativeContext
      ? validateCreativeComposition(creativeContext, composition)
      : undefined;
    const version =
      Number(
        project.version ??
          (await tx.list(c.accountId, "revision")).filter(
            (r) => r.projectId === project.id,
          ).length,
      ) + 1;
    const revision = make(c.accountId, "revision", {
      projectId: project.id,
      parentId: parent?.id ?? null,
      ...(templatePreparation?.templateSource || parent?.templateSource
        ? {
            templateSource:
              templatePreparation?.templateSource ?? parent?.templateSource,
          }
        : {}),
      composition,
      changes: [input.action],
      ...(creativeContext ? { creativeContext, creativeRuleChecks } : {}),
      origin: input.origin,
      version,
    });
    await tx.put({
      ...project,
      headRevisionId: revision.id,
      version,
      workspaceManaged: true,
      updatedAt: revision.createdAt,
    });
    await tx.put(revision);
    if (request)
      await tx.put({
        ...request,
        status: "submitted",
        projectId: project.id,
        revisionId: revision.id,
      });
    return tx.put({
      ...make(c.accountId, "workspace-command", {}),
      id: commandId,
      inputHash: hash,
      projectId: project.id,
      revisionId: revision.id,
      version,
      message: input.message,
      origin: input.origin,
      summary:
        input.action.type === "create"
          ? "已建立作品并提交预览任务。"
          : input.action.type === "restore"
            ? "已从历史版本恢复，保留全部版本记录。"
            : `已保存 ${input.action.edits.length} 项修改并提交预览任务。`,
    });
  });
  // The revision is durable before rendering. A lost response/restart can safely
  // re-enter here; the stable job key prevents duplicate renders or purchases.
  const revision = await service.get(c, "revision", command.revisionId);
  const operation = {
    kind: "render",
    revisionId: revision.id,
    composition: revision.composition,
  };
  const quote = await service.quote(c, operation);
  const job = await service.submit(c, {
    quoteId: quote.id,
    input: operation,
    idempotencyKey: `workspace:${commandId}`,
  });
  await service.scoped(c, "write", (tx) =>
    tx.put({ ...command, jobId: job.id }),
  );
  if (input.requestId)
    await service.scoped(c, "write", async (tx) => {
      const request = await readRequest(tx, c, input.requestId!);
      await tx.put({ ...request, jobId: job.id });
    });
  return {
    projectId: command.projectId,
    revisionId: command.revisionId,
    jobId: job.id,
    commandId,
    message: command.summary,
    status: job.status,
    ...workspaceLinks(command.projectId, command.revisionId),
  };
}

export async function workspacePlan(
  service: Service,
  c: Context,
  raw: unknown,
): Promise<Proposal> {
  const submitted = planSchema.parse(raw);
  await service.scoped(c, "write", async () => undefined);
  const previous = submitted.requestId
    ? await workspaceRequestGet(service, c, submitted.requestId)
    : undefined;
  if (
    previous &&
    (submitted.requestVersion !== previous.requestVersion ||
      previous.status === "submitted")
  )
    fail(
      "REQUEST_CONFLICT",
      "请读取当前创作请求后继续；已提交的请求请查询结果。",
      409,
    );
  if (!previous && !submitted.message)
    fail("INVALID_INPUT", "请先描述创作要求，再补充素材。");
  // Keep original intent and all follow-ups even when the next turn is attachment-only.
  const input = {
    ...submitted,
    creativeContextId:
      submitted.creativeContextId ?? previous?.creativeContextId,
    projectId: submitted.projectId ?? previous?.projectId,
    revisionId: submitted.revisionId ?? previous?.revisionId,
    selectedSceneId: submitted.selectedSceneId ?? previous?.selectedSceneId,
    message: [
      ...(previous?.turns.map((turn) => turn.message) ?? []),
      submitted.message,
    ]
      .filter(Boolean)
      .join("\n"),
    assetIds: [
      ...new Set([...(previous?.assetIds ?? []), ...submitted.assetIds]),
    ],
  };
  if (input.assetIds.length > 14)
    fail("INVALID_INPUT", "一次创作最多使用 14 份素材。");
  if (previous?.projectId && input.projectId !== previous.projectId)
    fail("INVALID_INPUT", "不能把待补充请求转移到其他作品。");
  const proposal = await prepareWorkspacePlan(service, c, input, previous);
  let missingInputs =
    proposal.missingInputs ??
    (proposal.action
      ? []
      : [
          {
            id: "clarification",
            kind: "text" as const,
            required: true,
            prompt: proposal.message.slice(0, 1000),
            purpose: "确认可执行的创作要求",
          },
        ]);
  // A local template match cannot silently discard questions saved by the host agent.
  // Only a single unambiguous media slot can be fulfilled automatically here.
  if (previous && proposal.engine !== "configured-model") {
    const incoming = await Promise.all(
      submitted.assetIds
        .filter((id) => !previous.assetIds.includes(id))
        .map((id) => service.get(c, "asset", id)),
    );
    const unresolved = previous.missingInputs.filter((item) => {
      if (!item.required) return false;
      if (item.kind === "text")
        return !submitted.message.trim() || !proposal.action;
      const sameKind = previous.missingInputs.filter(
        (other) => other.required && other.kind === item.kind,
      );
      return (
        sameKind.length !== 1 ||
        !incoming.some(
          (asset) =>
            asset.kind === item.kind ||
            (item.kind === "image" && asset.kind === "video") ||
            (item.kind === "audio" &&
              asset.kind === "video" &&
              asset.metadata?.hasAudio),
        )
      );
    });
    missingInputs = [
      ...new Map(
        [...missingInputs, ...unresolved].map((item) => [item.id, item]),
      ).values(),
    ];
  }
  const waiting = missingInputs.some((item) => item.required);
  const safeProposal: Proposal = {
    ...proposal,
    ...(waiting && proposal.action
      ? { message: "已保留创作要求。请补充以下必需素材后继续。" }
      : {}),
    missingInputs,
    status: waiting ? "waiting_input" : "ready",
    ...(waiting ? { action: undefined, autoApply: false } : {}),
  };
  const saved = await workspaceRequestSave(
    service,
    c,
    {
      ...submitted,
      creativeContextId: input.creativeContextId,
      projectId: input.projectId,
      revisionId: input.revisionId,
      selectedSceneId: input.selectedSceneId,
      missingInputs,
    },
    safeProposal,
  );
  return {
    ...safeProposal,
    creativeContextId: saved.creativeContextId,
    requestId: saved.requestId,
    requestVersion: saved.requestVersion,
  };
}

async function prepareWorkspacePlan(
  service: Service,
  c: Context,
  input: import("./workspace-contracts.js").PlanInput,
  previous?: import("./workspace-contracts.js").CreationRequest,
): Promise<Proposal> {
  const creativeContext = input.creativeContextId
    ? await service.scoped(c, "read", (tx) =>
        readCreativeContext(tx, c, input.creativeContextId!, input.projectId),
      )
    : undefined;
  if (
    creativeContext &&
    (creativeContext.conflicts.length ||
      creativeContext.missingInputs.length ||
      creativeContext.unresolved.some(
        (rule: Entity) => rule.strength === "required",
      ))
  ) {
    return {
      engine: "local-commands",
      message: "请先处理创作规范中的冲突、未知条件或缺失参考，再重新解析。",
      missingInputs: [
        {
          id: "creative-context",
          kind: "text",
          required: true,
          prompt: "请读取 creative_context_resolve 的冲突与缺口并解决。",
          purpose: "采用可执行的创作规范",
        },
      ],
    };
  }
  const state = input.projectId
    ? await workspaceSnapshot(service, c, input.projectId, input.revisionId)
    : undefined;
  if (!input.projectId && (input.revisionId || input.selectedSceneId))
    fail("INVALID_INPUT", "请先选择作品。");
  if (
    state?.revision &&
    input.selectedSceneId &&
    !state.revision.composition.scenes.some(
      (s: { id: string }) => s.id === input.selectedSceneId,
    )
  )
    fail("INVALID_EDIT", "所选镜头不属于当前版本。");
  const assets = await Promise.all(
    input.assetIds.map((id) => service.get(c, "asset", id)),
  );
  // Also authenticate empty-attachment planning; it must never become an open model proxy.
  await service.scoped(
    c,
    plannerConfigured() ? "write" : "read",
    async () => undefined,
  );
  const library =
    !state?.revision && !avoidsTemplates(input.message)
      ? templateContext(
          input.message,
          (await templateLibrary(service, c)).templates,
          await service.list(c, "asset"),
          assets,
        )
      : undefined;
  const planned = await planRequest(
    input,
    state?.revision ?? undefined,
    assets,
    library,
    previous,
    creativeContext,
  );
  if (planned.missingInputs?.some((item) => item.required))
    return { ...planned, action: undefined, autoApply: false };
  if (planned.template && library) {
    const selected = validateTemplateDecision(planned.template, library);
    const {
      durationMs: _duration,
      format: _format,
      ...selection
    } = planned.template;
    const prepared = await prepareTemplate(service, c, {
      ...selection,
      sourceKind: selected.sourceKind,
    });
    const composition = adaptTemplateComposition(
      prepared.composition,
      planned.template,
      library.assets,
    );
    const assetIds = [
      ...new Set(
        composition.scenes.flatMap((s) => (s.assetId ? [s.assetId] : [])),
      ),
    ];
    const illustrated =
      selected.sourceKind === "builtin" && prepared.reuse.bundledScenes > 0;
    return {
      engine: planned.engine,
      templatePreparationId: prepared.preparationId,
      message: `已自动采用「${selected.title}」的结构并填入文案，复用 ${assetIds.length} 份画面素材。${illustrated ? "未提供的画面使用内置图形插画。" : ""}本次只进行本地合成，没有生成新图片或视频。`,
      action: { type: "create", composition },
      autoApply:
        !/(?:先|只|仅).{0,6}(?:方案|建议|计划|看看)|(?:不要|别|暂不).{0,4}(?:渲染|合成|出片)/.test(
          input.message,
        ),
      reuse: {
        templateId: selected.id,
        templateTitle: selected.title,
        assetIds,
        generationRequests: 0,
      },
    } satisfies Proposal;
  }
  const { template: _template, ...proposal } = planned;
  return {
    ...proposal,
    ...(state
      ? { projectId: state.project.id, baseRevisionId: state.revision?.id }
      : {}),
  };
}
