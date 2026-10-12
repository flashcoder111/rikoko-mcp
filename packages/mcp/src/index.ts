import { McpServer } from "@modelcontextprotocol/server";
import { ZodError } from "zod";
import { AppError } from "../../contracts/src/index.js";
import { tools, type ToolName } from "./tools.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { cardUri, registerResultCard } from "./card.js";
import { z } from "zod";
import { idSchema } from "../../contracts/src/index.js";
import type { HostClient } from "./host-connection.js";
import { HostFiles, importFileSchema } from "./host-files.js";
import { resultText, type ConversationResult } from "./presentation.js";
export function createMcpServer(
  invoke: (name: ToolName, input: unknown) => Promise<unknown>,
  options: {
    client?: HostClient;
    files?: HostFiles;
    resourceOrigin?: string;
  } = {},
) {
  const server = new McpServer(
    { name: "video-workbench", version: "0.1.0" },
    {
      instructions:
        "You are the creative agent. Use capabilities first. Create and edit in THIS host conversation; never require the standalone web chat. Use native attachment paths when returned: Codex can render local media with Markdown image syntax; Hermes can use MEDIA paths in the current conversation. Never choose a different recipient. workspace_commit creates a composition or applies edits and queues a real render; workspace_snapshot resumes the same project after studio edits. Pass current baseRevisionId and a stable idempotencyKey. Offer its workspace link for visual editing, never require it for ordinary tasks. The calling agent can author validated compositions and edits itself; workspace_plan is optional. Call workspace_result for progress and completed media directly in the conversation. Its short-lived media URLs work without an API key in the player and can be refreshed by calling again. For paid operations quote first and obtain user agreement to that price before job_submit, then use workspace_result for delivery. Never resubmit to poll progress. Ordinary asset URLs require authentication. Precomputed/model fixtures are not live AI evidence. Paid jobs never silently switch models.",
    },
  );
  registerResultCard(server, options.resourceOrigin);
  server.registerPrompt(
    "hypit_create",
    {
      description:
        "Create media here using the current host agent; the visual editor is optional.",
      argsSchema: z.object({ request: z.string() }),
    },
    ({ request }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `${request}\nUse Hypit MCP in this conversation. Read capabilities, prepare a composition or a quoted generation, then deliver media with workspace_result. Do not require the web chat.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "hypit_resume",
    {
      description:
        "Continue the same project after editing in the studio or another host.",
      argsSchema: z.object({
        projectId: idSchema,
        request: z.string().optional(),
      }),
    },
    ({ projectId, request }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Continue Hypit project ${projectId}. Read workspace_snapshot first; use its latest head revision rather than an earlier conversation version. ${request ?? "Show the current result in this conversation."}`,
          },
        },
      ],
    }),
  );
  for (const [name, tool] of Object.entries(tools)) {
    if (
      options.client &&
      ["key_create", "key_revoke", "key_rotate"].includes(name)
    )
      continue;
    registerAppTool(
      server,
      name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        _meta: ["workspace_commit", "workspace_result"].includes(name)
          ? { ui: { resourceUri: cardUri } }
          : {},
        annotations: {
          readOnlyHint: [
            "asset_waveform",
            "capabilities",
            "records_list",
            "record_get",
            "usage_get",
            "transcript_select",
            "workspace_snapshot",
          ].includes(name),
          destructiveHint: [
            "key_revoke",
            "key_rotate",
            "job_cancel",
            "preview_revoke",
            "delivery_revoke",
          ].includes(name),
          openWorldHint: ["job_submit", "asset_import_url"].includes(name),
        },
      } as any,
      async (args: unknown) => {
        try {
          let output = await invoke(name as ToolName, args);
          if (name === "workspace_result" && options.files) {
            const result = output as ConversationResult;
            if (result.status === "completed" && result.media?.length) {
              try {
                output = {
                  ...result,
                  media: await options.files.materialize(
                    result.jobId,
                    result.media,
                  ),
                };
              } catch {
                output = {
                  ...result,
                  deliveryWarning:
                    "Local attachment export failed. The media URLs remain available; use workspace_export to retry.",
                };
              }
            }
          }
          const media =
            name === "workspace_result"
              ? ((
                  output as {
                    media?: { url: string; name: string; mimeType: string }[];
                  }
                ).media ?? [])
              : [];
          return {
            content: [
              {
                type: "text" as const,
                text:
                  name === "workspace_result"
                    ? resultText(output as ConversationResult, options.client)
                    : JSON.stringify(output),
              },
              ...media.map((file) => ({
                type: "resource_link" as const,
                uri: file.url,
                name: file.name,
                mimeType: file.mimeType,
              })),
            ],
            structuredContent: { result: output } as any,
          };
        } catch (error) {
          const message =
            error instanceof AppError
              ? `${error.code}: ${error.message}`
              : error instanceof ZodError
                ? "INVALID_INPUT: " +
                  error.issues.map((i) => i.message).join("; ")
                : "INTERNAL: Request failed";
          return {
            content: [{ type: "text" as const, text: message }],
            isError: true,
          };
        }
      },
    );
  }
  if (options.files) {
    const files = options.files;
    server.registerTool(
      "asset_import_file",
      {
        description:
          "Import a user-selected media attachment from this host's configured import directories. Requires the user's media rights confirmation. Never use it to read credentials or arbitrary files. Remote HTTP servers do not expose this tool.",
        inputSchema: importFileSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const result = await files.importFile(input);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: { result } as any,
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  e instanceof AppError
                    ? `${e.code}: ${e.message}`
                    : "IMPORT_FAILED: Cannot read or import this media file.",
              },
            ],
          };
        }
      },
    );
    server.registerTool(
      "workspace_export",
      {
        description:
          "Retry saving a completed job's files as native attachments on this host. Returns local paths for inline playback in Codex, Hermes media attachments or Claude file handling. Never starts a new render or purchase.",
        inputSchema: z.object({ jobId: idSchema }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async ({ jobId }) => {
        try {
          const result = (await invoke("workspace_result", {
            jobId,
          })) as ConversationResult;
          const output = {
            ...result,
            media: await files.materialize(jobId, result.media ?? []),
          };
          return {
            content: [
              { type: "text", text: resultText(output, options.client) },
            ],
            structuredContent: { result: output },
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  e instanceof AppError
                    ? `${e.code}: ${e.message}`
                    : "EXPORT_FAILED: Cannot save media to the host's export directory.",
              },
            ],
          };
        }
      },
    );
  }
  return server;
}
