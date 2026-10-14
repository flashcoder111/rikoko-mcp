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
  expiresAt?: string;
  textContent?: { title: string; screenText: string[]; source: string };
};
export function resultText(
  result: ConversationResult,
  client: HostClient = "generic",
  includeAttachments = true,
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
  for (const file of includeAttachments && result.status === "completed"
    ? (result.media ?? [])
    : []) {
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
  if (result.status === "completed" && result.textContent) {
    lines.push(`Title: ${result.textContent.title}`);
    if (result.textContent.screenText.length)
      lines.push(
        `Screen text (not a speech transcript):\n${result.textContent.screenText.join("\n")}`,
      );
  }
  if (result.status === "completed" && result.expiresAt)
    lines.push(
      `Media links expire at ${result.expiresAt}; query workspace_result again to refresh without rerendering.`,
    );
  lines.push(
    "Keep all requests and follow-up edits in this host's original conversation. When completed, deliver the video using the host's native attachment support or the returned media links, include relevant text/subtitle content and the optional workspace link. Draft publishing copy only from known user facts and actual content. Never claim to have watched the result without inspecting it. Do not open a browser, MCP App, popup or separate chat automatically. If attachment display is unavailable, provide the returned download/workspace link. workspace_export saves files without rerendering.",
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
export function conversationResult(output: unknown) {
  const { conversation: _conversation, ...result } = output as Record<
    string,
    unknown
  >;
  if (result.links && typeof result.links === "object") {
    const { conversation: _chat, ...links } = result.links as Record<
      string,
      unknown
    >;
    result.links = links;
  }
  if (Array.isArray(result.media))
    result.outputs = (result.media as DeliveredMedia[]).map(
      ({ assetId, name, mimeType }) => ({ assetId, name, mimeType }),
    );
  return result;
}

export function mediaResources(result: ConversationResult) {
  return result.status === "completed"
    ? (result.media ?? []).map((file) => ({
        type: "resource_link" as const,
        uri: file.url,
        name: file.name,
        mimeType: file.mimeType,
      }))
    : [];
}
