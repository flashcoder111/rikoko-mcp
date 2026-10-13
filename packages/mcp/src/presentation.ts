import type { HostClient } from "./host-connection.js";
import type { DeliveredMedia } from "./host-files.js";

export type ConversationResult = {
  jobId: string;
  projectId?: string;
  revisionId?: string;
  title?: string;
  status?: string;
  message?: string;
  workspace?: string;
  error?: string;
  deliveryWarning?: string;
  media?: DeliveredMedia[];
};
export function resultText(
  result: ConversationResult,
  client: HostClient = "generic",
  includeAttachments = false,
) {
  const lines = [
    `${result.title ?? "rikoko media"} — ${result.status ?? "queued"}`,
    `jobId: ${result.jobId}`,
    ...(result.projectId
      ? [
          `projectId: ${result.projectId}`,
          `revisionId: ${result.revisionId ?? ""}`,
        ]
      : []),
    ...(result.error ? [`Error: ${result.error}`] : []),
    ...(result.message ? [result.message] : []),
    ...(result.deliveryWarning
      ? [`Attachment warning: ${result.deliveryWarning}`]
      : []),
  ];
  for (const file of includeAttachments ? (result.media ?? []) : []) {
    lines.push(`${file.name} (${file.mimeType}): ${file.url}`);
    if (file.localPath) {
      lines.push(`Local attachment: ${file.localPath}`);
      if (client === "codex" && /^(video|image|audio)\//.test(file.mimeType))
        lines.push(
          `Display in this conversation: ![${file.mimeType.split("/")[0]}](<${file.localPath}>)`,
        );
      if (client === "hermes") lines.push(`MEDIA:${file.localPath}`);
    }
  }
  lines.push(
    "Keep all requests and follow-up edits in this host's original conversation. Reply with a brief status and only the workspace link by default. Do not open a browser, MCP App, popup, embedded player or separate chat. The user opens the workspace link when they want visual editing. Use workspace_export only if the user explicitly asks for downloadable files or attachments.",
  );
  if (result.projectId)
    lines.push(
      `Before further edits, call workspace_snapshot with projectId ${result.projectId} to read the latest studio changes. Then workspace_commit with its current baseRevisionId.`,
    );
  if (result.workspace) lines.push(`[打开工作台](<${result.workspace}>)`);
  if (["queued", "running"].includes(result.status ?? ""))
    lines.push(
      "Call workspace_result again for progress; do not submit another generation.",
    );
  return lines.join("\n");
}

/** Present workspace tools as plain conversation data, never as a second chat or media UI. */
export function linkOnlyResult(output: unknown) {
  const {
    conversation: _conversation,
    media,
    grantId: _grantId,
    expiresAt: _expiresAt,
    deliveryWarning: _deliveryWarning,
    ...result
  } = output as Record<string, unknown>;
  if (result.links && typeof result.links === "object") {
    const { conversation: _chat, ...links } = result.links as Record<
      string,
      unknown
    >;
    result.links = links;
  }
  if (Array.isArray(media))
    result.outputs = (media as DeliveredMedia[]).map(
      ({ assetId, name, mimeType }) => ({ assetId, name, mimeType }),
    );
  return result;
}
