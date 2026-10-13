import { McpServer } from "@modelcontextprotocol/server";
import { ZodError } from "zod";
import { AppError } from "../../contracts/src/index.js";
import { tools, type ToolName } from "./tools.js";
import { z } from "zod";
import { idSchema } from "../../contracts/src/index.js";
import type { HostClient } from "./host-connection.js";
import { HostFiles, importFileSchema } from "./host-files.js";
import {
  linkOnlyResult,
  resultText,
  type ConversationResult,
} from "./presentation.js";
export function createMcpServer(
  invoke: (name: ToolName, input: unknown) => Promise<unknown>,
  options: {
    client?: HostClient;
    files?: HostFiles;
  } = {},
) {
  const server = new McpServer(
    { name: "rikoko", version: "0.1.0" },
    {
      instructions:
        "You are the creative agent. Use capabilities first. Create, discuss and edit in THIS host's original conversation. Never open an MCP App, popup, embedded player, browser or separate web chat automatically. Reply with a brief status and only the returned workspace link by default; the user clicks it when they want visual editing. Do not render or attach media automatically. Call workspace_export only if the user explicitly requests downloadable files or attachments; never choose a different recipient. workspace_commit creates a composition or applies edits and queues a real render; workspace_snapshot resumes the same project after studio edits. Pass current baseRevisionId and a stable idempotencyKey. The calling agent authors validated compositions and edits itself; workspace_plan is optional and no separate web creative model is required. Call workspace_result for job status and asset IDs, and keep the workspace link in the original conversation. For paid operations quote first and obtain user agreement to that price before job_submit. Never resubmit to poll progress. Workspace links require the user's browser session; never append API keys. Precomputed/model fixtures are not live AI evidence. Paid jobs never silently switch models.",
    },
  );
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
            text: `${request}\nUse rikoko MCP in this original conversation. Read capabilities, prepare a composition or a quoted generation, then check workspace_result. Reply with a brief status and only the workspace link. Do not open an MCP App, browser or separate chat, and do not attach media unless explicitly requested.`,
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
            text: `Continue rikoko project ${projectId} in this original conversation. Read workspace_snapshot first; use its latest head revision rather than an earlier conversation version. Reply with a brief status and only the workspace link; never automatically open an MCP App, browser or separate chat. ${request ?? "Show the current status and workspace link."}`,
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
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.schema,
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
          if (
            [
              "workspace_commit",
              "workspace_result",
              "workspace_snapshot",
            ].includes(name)
          )
            output = linkOnlyResult(output);
          return {
            content: [
              {
                type: "text" as const,
                text: ["workspace_commit", "workspace_result"].includes(name)
                  ? resultText(output as ConversationResult, options.client)
                  : JSON.stringify(output),
              },
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
          "Only when the user explicitly requests downloadable files or attachments: save a completed job's files on this host and return local paths. Default conversation replies use only the workspace link. Never starts a new render, purchase or MCP App.",
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
              { type: "text", text: resultText(output, options.client, true) },
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
