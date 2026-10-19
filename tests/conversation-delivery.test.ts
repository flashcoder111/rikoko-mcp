import { expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMcpServer } from "../packages/mcp/src/index.js";
import type { HostFiles } from "../packages/mcp/src/host-files.js";

it("retains completed media on download failure, respects links-only and never exports unfinished jobs", async () => {
  let status = "completed";
  const media = [
    {
      assetId: "video",
      name: "video.mp4",
      mimeType: "video/mp4",
      url: "https://media.example.test/video",
    },
  ];
  const invoke = vi.fn(async (_name: string, input: any) => ({
    purpose: input.purpose ?? "final",
    quality: {
      finalReady: true,
      status: "unreviewed",
      reviewAccepted: false,
      issues: [],
    },
    jobId: "job",
    status,
    media: status === "completed" ? media : [],
  }));
  const materialize = vi.fn().mockRejectedValue(new Error("disk full"));
  const server = createMcpServer(invoke, {
    client: "codex",
    files: { materialize } as unknown as HostFiles,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "delivery-test", version: "1" });
  try {
    await Promise.all([server.connect(a), client.connect(b)]);
    const links = await client.callTool({
      name: "workspace_result",
      arguments: { jobId: "job", delivery: "links", purpose: "final" },
    });
    expect(links.isError).not.toBe(true);
    expect(materialize).not.toHaveBeenCalled();
    expect(links.content[1].type).toBe("resource_link");
    const preview = await client.callTool({
      name: "workspace_result",
      arguments: { jobId: "job", purpose: "preview" },
    });
    expect(preview.content).toHaveLength(1);
    expect(materialize).not.toHaveBeenCalled();
    const fallback = await client.callTool({
      name: "workspace_result",
      arguments: { jobId: "job" },
    });
    expect(fallback.isError).not.toBe(true);
    expect((fallback.structuredContent as any).result).toMatchObject({
      status: "completed",
      media,
      deliveryWarning: expect.stringContaining("do not regenerate"),
    });
    expect(materialize).toHaveBeenCalledOnce();
    for (status of ["queued", "running", "failed", "cancelled"]) {
      const pending = await client.callTool({
        name: "workspace_result",
        arguments: { jobId: "job" },
      });
      expect(pending.content).toHaveLength(1);
      expect(materialize).toHaveBeenCalledOnce();
      const exported = await client.callTool({
        name: "workspace_export",
        arguments: { jobId: "job" },
      });
      expect(exported.isError).toBe(true);
      expect(JSON.stringify(exported.content)).toContain("RESULT_NOT_READY");
    }
    expect(
      invoke.mock.calls.every((call) => call[0] === "workspace_result"),
    ).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
