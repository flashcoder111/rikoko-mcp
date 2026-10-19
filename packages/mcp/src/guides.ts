import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { HostClient } from "./host-connection.js";

// Fixed topics only: this tool cannot read caller-supplied paths or URLs.
export const guideTopics = [
  "overview",
  "host-codex",
  "host-claude",
  "host-hermes",
  "analysis-preflight",
  "video-direction",
  "directing-examples",
  "image-direction",
  "process-broll",
  "visual-review",
  "commands",
  "media-operations",
] as const;
const guideSchema = z
  .object({
    topic: z.enum(guideTopics).default("overview"),
  })
  .strict();
const skillRoot = new URL("../../../skills/rikoko/", import.meta.url);

export function hostGuideInstructions(client: HostClient = "generic") {
  const adapter = client === "generic" ? undefined : `host-${client}`;
  return (
    "Use rikoko_guide for the bundled production playbooks when local skill files are unavailable or stale. Read overview and only the relevant topics; guide reads never upload, quote or generate. " +
    (adapter
      ? `This connection is configured as ${client}; read topic=${adapter}. `
      : "This connection does not identify the host; select host-codex, host-claude or host-hermes only from the actual session context. ") +
    "A host label does not establish image visibility, filesystem access or native delivery. Preserve media_inspect image blocks when forwarding tool results; text metadata or an auxiliary caption is not direct visual inspection. Claude Desktop can read guides through this tool without a local skill. Use the actual host's invocation syntax; never take over its global /model command. "
  );
}

export function registerGuideTool(
  server: McpServer,
  client: HostClient = "generic",
) {
  server.registerTool(
    "rikoko_guide",
    {
      description:
        "Read rikoko's bundled instructions without local file access. Start with overview and the current host adapter; use directing-examples/video-direction before generation and visual-review before acceptance. Other topics cover images, physical processes, commands and media edits. Read-only; no backend calls, settings changes or paid work.",
      inputSchema: guideSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ topic }) => {
      try {
        const path =
          topic === "overview" ? "SKILL.md" : `references/${topic}.md`;
        const markdown = await readFile(new URL(path, skillRoot), "utf8");
        if (!markdown.trim()) throw Error("Empty guide");
        return {
          content: [{ type: "text" as const, text: markdown }],
          structuredContent: {
            result: {
              topic,
              markdown,
              configuredHost: client,
              sha256: createHash("sha256").update(markdown).digest("hex"),
              availableTopics: guideTopics,
            },
          },
        };
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: "GUIDE_UNAVAILABLE: The bundled guide is missing or unreadable. Repair/update this rikoko runtime and reconnect, or read the matching installed skill reference. Do not infer unsupported capabilities or bypass preparation/review gates.",
            },
          ],
          isError: true,
        };
      }
    },
  );
}
