import type { HostClient } from "./host-connection.js";
import { usageText, type TaskUsage } from "../../core/src/task-usage.js";
import type { DeliveredMedia } from "./host-files.js";

export type ConversationResult = {
  usage?: TaskUsage;
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
  quality?: {
    status: string;
    finalReady: boolean;
    reviewAccepted?: boolean;
    issues: unknown[];
  };
  mediaAcceptance?: {
    status: string;
    finalReady: boolean;
    reviewAccepted?: boolean;
    media: unknown[];
    issues: unknown[];
  };
  purpose?: string;
};
export function canDeliverResult(result: ConversationResult) {
  if (result.status !== "completed" || result.purpose !== "final") return false;
  if (result.quality) return result.quality.finalReady === true;
  if (result.mediaAcceptance?.media.length)
    return result.mediaAcceptance.finalReady === true;
  // Audio/text have no visual contract. Older visual responses without readiness stay previews.
  return !(result.media ?? []).some((f) => /^(video|image)\//.test(f.mimeType));
}
export function resultText(
  result: ConversationResult,
  client: HostClient = "generic",
  includeAttachments = true,
) {
  const deliverable = canDeliverResult(result);
  const lines = [
    `${result.title ?? "rikoko media"} — ${result.status ?? "queued"}`,
    `jobId: ${result.jobId}`,
    ...(result.usage
      ? [
          usageText(result.usage),
          "Usage scope: listed jobs only. For the task total, call task_usage with ALL task job IDs including analysis and authorized retries; a free render does not mean the video production was free. Include actual charges in the final reply without delaying delivery for unsettled charges.",
        ]
      : []),
    ...(!deliverable && result.status === "completed"
      ? [
          "Preview — request workspace_result purpose=final for delivery. No final AI review is required; do not start a review or regeneration loop.",
        ]
      : []),
    ...(result.quality
      ? [
          `Optional visual review: ${result.quality.status}; technical delivery ready=${result.quality.finalReady}. Delivery purpose: ${result.purpose ?? "preview"}.`,
          `Validation: ${JSON.stringify(result.quality)}`,
        ]
      : []),
    ...(result.mediaAcceptance
      ? [`Media acceptance: ${JSON.stringify(result.mediaAcceptance)}`]
      : []),
    ...((result.quality && result.quality.reviewAccepted !== true) ||
    (result.mediaAcceptance && result.mediaAcceptance.reviewAccepted !== true)
      ? [
          "Evidence boundary: technical checks only. Do not claim the pictured objects, action, continuity or a reported visual defect are correct/fixed. Brightness, edge counts and white-pixel counts are not semantic visual checks. Deliver with the actual review status; no automatic regeneration.",
        ]
      : []),
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
    if (file.localPath && deliverable) {
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
  if (deliverable)
    lines.push(
      "Keep all requests and follow-up edits in this host's original conversation. When completed, deliver directly without a final AI review or automatic quality regeneration. Unreviewed does not mean accepted. Deliver the video using the host's native attachment support or the returned media links, include relevant text/subtitle content and always include the returned workspace URL as a clickable Markdown link so the user can open the browser workspace and edit the video. Keep this link alongside native attachments and in links-only replies. Use the exact returned URL; never invent a localhost address or append credentials. Draft publishing copy only from known user facts and actual content. Never claim to have watched the result without inspecting it. Do not open a browser, MCP App, popup or separate chat automatically. If attachment display is unavailable, provide the returned download/workspace link. workspace_export saves files without rerendering.",
    );
  if (result.projectId)
    lines.push(
      `Before further edits, call workspace_snapshot with projectId ${result.projectId} to read the latest studio changes. Then workspace_commit with its current baseRevisionId.`,
    );
  if (result.workspace)
    lines.push(
      "Include this clickable workspace link so the user can continue editing; do not open it automatically:",
      `[Open workspace](<${result.workspace}>)`,
    );
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
  return canDeliverResult(result)
    ? (result.media ?? []).map((file) => ({
        type: "resource_link" as const,
        uri: file.url,
        name: file.name,
        mimeType: file.mimeType,
      }))
    : [];
}
