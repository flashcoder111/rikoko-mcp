import type { HostClient } from "./host-connection.js";
import type { DeliveredMedia } from "./host-files.js";

export type ConversationResult = {
  jobId: string;
  projectId?: string;
  revisionId?: string;
  title?: string;
  status?: string;
  workspace?: string;
  error?: string;
  deliveryWarning?: string;
  media?: DeliveredMedia[];
};
export function resultText(
  result: ConversationResult,
  client: HostClient = "generic",
) {
  const lines = [
    `${result.title ?? "Hypit media"} — ${result.status ?? "queued"}`,
    `jobId: ${result.jobId}`,
    ...(result.projectId
      ? [
          `projectId: ${result.projectId}`,
          `revisionId: ${result.revisionId ?? ""}`,
        ]
      : []),
    ...(result.error ? [`Error: ${result.error}`] : []),
    ...(result.deliveryWarning
      ? [`Attachment warning: ${result.deliveryWarning}`]
      : []),
  ];
  for (const file of result.media ?? []) {
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
    "Keep the user in this conversation. Use the host's media/attachment renderer; do not require the web chat.",
  );
  if (result.projectId)
    lines.push(
      `Before further edits, call workspace_snapshot with projectId ${result.projectId} to read the latest studio changes. Then workspace_commit with its current baseRevisionId.`,
    );
  if (result.workspace)
    lines.push(`Optional visual editor: ${result.workspace}`);
  if (["queued", "running"].includes(result.status ?? ""))
    lines.push(
      "Call workspace_result again for progress; do not submit another generation.",
    );
  return lines.join("\n");
}
