import { z } from "zod";
import {
  AppError,
  idSchema,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import { fingerprint, type Service } from "./index.js";

export const handoffSchema = z
  .object({
    projectId: idSchema,
    revisionId: idSchema,
    selectedSceneId: idSchema.optional(),
    assetIds: z.array(idSchema).max(14).default([]),
    message: z.string().trim().min(1).max(5000),
    idempotencyKey: z.string().min(1).max(100),
  })
  .strict();

/** Persist context only. Opening Hermes never invokes a model or submits a job. */
export async function workspaceHandoffPrepare(
  service: Service,
  c: Context,
  raw: unknown,
) {
  const input = handoffSchema.parse(raw);
  const requestId = fingerprint({
    accountId: c.accountId,
    handoff: input.idempotencyKey,
  });
  const inputHash = fingerprint(input);
  return service.scoped(c, "write", async (tx) => {
    const previous = await tx.get(requestId, c.accountId, "workspace-request");
    if (previous && previous.handoffInputHash !== inputHash)
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        "这次交接内容已变化，请重新准备。",
        409,
      );
    const project = await tx.get(input.projectId, c.accountId, "project");
    const revision = await tx.get(input.revisionId, c.accountId, "revision");
    if (!project || revision?.projectId !== project.id)
      throw new AppError("NOT_FOUND", "找不到作品或对应版本。", 404);
    if (project.headRevisionId !== revision.id)
      throw new AppError(
        "REVISION_CONFLICT",
        "作品已更新，请载入最新版本后再交给 Hermes。",
        409,
      );
    if (
      input.selectedSceneId &&
      !revision.composition.scenes.some(
        (scene: { id: string }) => scene.id === input.selectedSceneId,
      )
    )
      throw new AppError(
        "INVALID_EDIT",
        "选中的镜头已不存在，请重新选择。",
        409,
      );
    for (const id of input.assetIds) {
      const asset = await tx.get(id, c.accountId, "asset");
      if (!asset || !["image", "video", "audio"].includes(asset.kind))
        throw new AppError(
          "INVALID_MEDIA",
          "只能交接当前工作空间中的图片、视频或音频素材。",
        );
    }
    if (!previous) {
      const request: Entity = {
        id: requestId,
        accountId: c.accountId,
        type: "workspace-request",
        createdAt: new Date().toISOString(),
        version: 1,
        originalMessage: input.message,
        turns: [{ message: input.message, assetIds: input.assetIds }],
        projectId: project.id,
        revisionId: revision.id,
        selectedSceneId: input.selectedSceneId,
        assetIds: [...new Set(input.assetIds)],
        missingInputs: [],
        status: "ready",
        handoffInputHash: inputHash,
      };
      await tx.put(request);
    }
    const params = new URLSearchParams({
      request: requestId,
      project: project.id,
    });
    const prompt = [
      "/rikoko 继续工作台中的修改。",
      `先调用 workspace_request_get，requestId=${requestId}，读取用户要求、素材和选中镜头。`,
      `再调用 workspace_snapshot，projectId=${project.id}，读取最新版本；不要沿用聊天里的旧版本。`,
      "如果请求已经 submitted，读取现有任务结果，不重复提交。若版本已变化，核对修改是否仍适用，不能覆盖较新的修改。",
      "改文案、换现有音乐使用 workspace_commit 编辑并合成，复用现有画面。只有用户明确要求新画面或新配音时才准备对应生成，直接提交生成，无需单独确认报价。",
      "若当前 rikoko 连接找不到该请求，请检查工作空间连接，不要猜测作品或另建副本。完成后返回同一作品的工作台链接。",
    ].join("\n");
    return {
      requestId,
      projectId: project.id,
      revisionId: revision.id,
      prompt,
      hermesUrl: `hermes://rikoko-handoff?${params}`,
      status: "prepared" as const,
    };
  });
}
