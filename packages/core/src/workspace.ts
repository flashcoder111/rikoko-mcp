import { randomUUID } from "node:crypto";
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
      if (!["image", "video"].includes(asset.kind))
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
    let project: Entity,
      composition: Composition,
      parent: Entity | null = null;
    if (input.action.type === "create") {
      if (input.projectId || input.baseRevisionId)
        fail("INVALID_EDIT", "新作品无需传入已有作品或版本。");
      composition = input.action.composition;
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
      ...(parent?.templateSource
        ? { templateSource: parent.templateSource }
        : {}),
      composition,
      changes: [input.action],
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
  return {
    projectId: command.projectId,
    revisionId: command.revisionId,
    jobId: job.id,
    commandId,
    message: command.summary,
    ...workspaceLinks(command.projectId, command.revisionId),
  };
}

export async function workspacePlan(
  service: Service,
  c: Context,
  raw: unknown,
): Promise<Proposal> {
  const input = planSchema.parse(raw);
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
  const planned = await planRequest(
    input,
    state?.revision ?? undefined,
    assets,
  );
  return {
    ...planned,
    ...(state
      ? { projectId: state.project.id, baseRevisionId: state.revision?.id }
      : {}),
  };
}
