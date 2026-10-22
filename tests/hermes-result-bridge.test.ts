import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMcpServer } from "../packages/mcp/src/index.js";
import { AppError } from "../packages/contracts/src/index.js";

// Opt-in against an operator-selected installed Hermes revision, without importing
// Hermes configuration, starting its agent, contacting providers or touching chats.
// Only the adapter's actual rendering functions are executed. Image cache I/O is
// and text-cleaning/truncation helpers are substituted; native image visibility/
// delivery still needs a real host acceptance run.
const source = process.env.HERMES_MCP_HANDLERS;
const render = String.raw`
import ast, json, logging, sys
from types import SimpleNamespace
from typing import Optional
names = {"_error_result_text", "_render_content_blocks", "_capped_structured_content", "_content_dual_emits_structured", "_render_call_tool_result"}
with open(sys.argv[1]) as f:
    tree = ast.parse(f.read())
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
assert {n.name for n in functions} == names, "Hermes adapter contract changed"
def mcp_field(obj, snake, camel=None, default=None):
    return getattr(obj, snake, getattr(obj, camel, default) if camel else default)
def tool_error(message):
    return json.dumps({"error": message})
strip_unicode_tags = _truncate_mcp_text_result = _sanitize_error = lambda text: text
_strip_reserved_meta_keys = lambda meta: meta
_cache_mcp_image_block = lambda block: "MEDIA:/synthetic/inspection.png" if block.type == "image" else ""
_cache_mcp_audio_block = lambda block: ""
_render_mcp_resource_block = lambda block, server: ""
_render_mcp_dropped_block_notice = lambda block, kind: "unsupported"
_MCP_HARD_RESULT_CAP_CHARS = 1000000
logger = logging.getLogger("test")
exec(compile(ast.Module(body=functions, type_ignores=[]), sys.argv[1], "exec"))
raw = json.loads(sys.argv[2])
raw["content"] = [SimpleNamespace(**block) for block in raw.get("content", [])]
print(_render_call_tool_result(SimpleNamespace(**raw), "rikoko"))
`;

it.skipIf(!source)(
  "keeps machine metadata and recovery usable through the installed Hermes result renderer",
  async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    let fail = false;
    const server = createMcpServer(
      async () => {
        if (fail)
          throw new AppError(
            "MEDIA_DEPENDENCY_MISSING",
            "FFmpeg is unavailable",
            500,
            { stage: "extract_frame", reason: "ffmpeg_not_found" },
          );
        return {
          id: "inspection",
          frames: [
            {
              assetId: "frame",
              requestedTimeMs: 0,
              image: { mimeType: "image/png", data: "fixture" },
            },
          ],
        };
      },
      { client: "hermes" },
    );
    await server.connect(b);
    const client = new Client({ name: "hermes-bridge-check", version: "1" });
    await client.connect(a);
    try {
      const response: any = await client.callTool({
        name: "media_inspect",
        arguments: { assetId: "asset" },
      });
      const { stdout } = await promisify(execFile)("python3", [
        "-c",
        render,
        source!,
        JSON.stringify(response),
      ]);
      const outer = JSON.parse(stdout);
      expect(outer.result).toContain("MEDIA:");
      expect(() => JSON.parse(outer.result)).toThrow();
      expect(outer.structuredContent.result).toEqual(
        response.structuredContent.result,
      );
      expect(outer.structuredContent.result.frames[0].image).toBeUndefined();
      fail = true;
      const failure: any = await client.callTool({
        name: "media_inspect",
        arguments: { assetId: "asset" },
      });
      const converted = await promisify(execFile)("python3", [
        "-c",
        render,
        source!,
        JSON.stringify(failure),
      ]);
      const error = JSON.parse(JSON.parse(converted.stdout).error).error;
      expect(error).toEqual(failure.structuredContent.error);
      expect(error.recovery.retrySameInput).toBe(false);
      expect(error.details.stage).toBe("extract_frame");
    } finally {
      await client.close();
      await server.close();
    }
  },
);
