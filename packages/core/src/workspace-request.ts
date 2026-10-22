import { randomUUID } from "node:crypto";
import {
  validateUserRequirements,
  intentNotice,
  type UserRequirement,
} from "./production-intent.js";
import { readCreativeContext } from "./creative-context.js";
import {
  AppError,
  type Context,
  type Entity,
} from "../../contracts/src/index.js";
import type { Transaction } from "../../db/src/index.js";
import { Service } from "./index.js";
import {
  requestSaveSchema,
  type CreationRequest,
  type Proposal,
} from "./workspace-contracts.js";

export function requestView(record: Entity): CreationRequest {
  const {
    id,
    version,
    originalMessage,
    turns,
    assetIds,
    missingInputs,
    status,
    projectId,
    revisionId,
    selectedSceneId,
    jobId,
    proposal,
  } = record;
  return {
    userRequirements: record.userRequirements,
    communication: intentNotice(record.userRequirements ?? []),
    creativeContextId: record.creativeContextId,
    requestId: id,
    requestVersion: version,
    originalMessage,
    turns,
    assetIds,
    missingInputs,
    status,
    projectId,
    revisionId,
    selectedSceneId,
    jobId,
    proposal,
  };
}

export async function readRequest(
  tx: Transaction,
  c: Context,
  id: string,
  version?: number,
) {
  const record = await tx.get(id, c.accountId, "workspace-request");
  if (!record) throw new AppError("NOT_FOUND", "找不到这次创作请求。", 404);
  if (version !== undefined && record.version !== version)
    throw new AppError(
      "REQUEST_CONFLICT",
      "创作请求已更新，请读取 workspace_request_get 后继续。",
      409,
    );
  return record;
}

export async function workspaceRequestGet(
  service: Service,
  c: Context,
  requestId: string,
) {
  return service.scoped(c, "read", async (tx) =>
    requestView(await readRequest(tx, c, requestId)),
  );
}

/** Persist the agent's concrete questions; this never runs a model or submits a job. */
export async function workspaceRequestSave(
  service: Service,
  c: Context,
  raw: unknown,
  proposal?: Proposal,
) {
  const input = requestSaveSchema.parse(raw);
  return service.scoped(c, "write", async (tx) => {
    if (input.requestId && input.requestVersion === undefined)
      throw new AppError(
        "INVALID_INPUT",
        "继续请求时需要当前 requestVersion。",
      );
    const previous = input.requestId
      ? await readRequest(tx, c, input.requestId, input.requestVersion)
      : undefined;
    if (previous?.status === "submitted")
      throw new AppError(
        "REQUEST_SUBMITTED",
        "此请求已经提交，请读取结果或开始新的修改请求。",
        409,
      );
    if (!previous && !input.message)
      throw new AppError("INVALID_INPUT", "请先描述创作要求，再补充素材。");
    const projectId = input.projectId ?? previous?.projectId;
    const creativeContextId =
      input.creativeContextId ?? previous?.creativeContextId;
    if (creativeContextId)
      await readCreativeContext(tx, c, creativeContextId, projectId);
    const revisionId = input.revisionId ?? previous?.revisionId;
    if (
      previous?.projectId &&
      input.projectId &&
      input.projectId !== previous.projectId
    )
      throw new AppError("INVALID_INPUT", "不能把待补充请求转移到其他作品。");
    if (projectId && !(await tx.get(projectId, c.accountId, "project")))
      throw new AppError("NOT_FOUND", "找不到作品。", 404);
    if (revisionId) {
      const revision = await tx.get(revisionId, c.accountId, "revision");
      if (!projectId || revision?.projectId !== projectId)
        throw new AppError("NOT_FOUND", "此版本不属于该作品。", 404);
    }
    const assetIds = [
      ...new Set<string>([...(previous?.assetIds ?? []), ...input.assetIds]),
    ];
    if (assetIds.length > 14)
      throw new AppError("INVALID_INPUT", "一次创作最多使用 14 份素材。");
    for (const id of assetIds) {
      const asset = await tx.get(id, c.accountId, "asset");
      if (!asset || !["image", "video", "audio"].includes(asset.kind))
        throw new AppError(
          "INVALID_MEDIA",
          "请提供当前工作空间中的图片、视频或音频素材。",
        );
    }
    const missingInputs = input.missingInputs ?? previous?.missingInputs ?? [];
    if (
      new Set(missingInputs.map((item: { id: string }) => item.id)).size !==
      missingInputs.length
    )
      throw new AppError("INVALID_INPUT", "待补充项的 id 不能重复。");
    const waiting = missingInputs.some(
      (item: { required: boolean }) => item.required,
    );
    const turns = [
      ...(previous?.turns ?? []),
      { message: input.message, assetIds: input.assetIds },
    ];
    if (turns.length > 30)
      throw new AppError(
        "INVALID_INPUT",
        "这次请求的补充轮次过多，请整理要求后开始新的请求。",
      );
    const priorRequirements: UserRequirement[] =
      previous?.userRequirements ??
      (previous?.turns ?? []).flatMap(
        (turn: { message: string }, index: number) =>
          turn.message.trim()
            ? [
                {
                  id: `turn-${index}`,
                  text: turn.message,
                  sourceTurn: index,
                  sourceQuote: turn.message,
                  preserve: [],
                },
              ]
            : [],
      );
    const userRequirements: UserRequirement[] = input.userRequirements ?? [
      ...priorRequirements,
      ...(input.message
        ? [
            {
              id: `turn-${turns.length - 1}`,
              text: input.message,
              sourceTurn: turns.length - 1,
              sourceQuote: input.message,
              preserve: [],
            },
          ]
        : []),
    ];
    validateUserRequirements(userRequirements, turns);
    // An attachment-only or agent-only update cannot silently rewrite settled requirements.
    if (
      previous &&
      !input.message &&
      input.userRequirements &&
      JSON.stringify(userRequirements) !== JSON.stringify(priorRequirements)
    )
      throw new AppError(
        "USER_REQUIREMENT_CHANGE_REQUIRED",
        "Changing user requirements needs the user's actual new instruction; keep creative decisions in the plan.",
        409,
      );
    const record: Entity = {
      ...(previous ?? {
        id: randomUUID(),
        accountId: c.accountId,
        type: "workspace-request",
        createdAt: new Date().toISOString(),
      }),
      version: (previous?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      originalMessage: previous?.originalMessage ?? input.message,
      userRequirements,
      creativeContextId,
      turns,
      assetIds,
      missingInputs,
      projectId,
      revisionId,
      selectedSceneId: input.selectedSceneId ?? previous?.selectedSceneId,
      status: waiting ? "waiting_input" : "ready",
      // A changed request invalidates its old plan; only the planner may replace it.
      proposal: proposal
        ? {
            ...proposal,
            ...(waiting ? { action: undefined, autoApply: false } : {}),
          }
        : undefined,
    };
    await tx.put(record);
    return requestView(record);
  });
}
