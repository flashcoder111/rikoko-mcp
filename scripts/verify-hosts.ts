import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  hostLaunch,
  type ClientName,
} from "../packages/mcp/src/host-config.js";
import { hostCredential } from "../packages/mcp/src/host-connection.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = "http://127.0.0.1:4310";
const identity = createHash("sha256")
  .update(`${root}\n${base}`)
  .digest("hex")
  .slice(0, 12);
const output = join(root, "artifacts/host-integration");
await mkdir(output, { recursive: true });
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (p): p is [string, string] => typeof p[1] === "string",
  ),
);
const report: Record<string, unknown> = {
  paidGeneration: false,
  evidence:
    "Real MCP stdio processes against the running local renderer. Client profiles are protocol tests, not a claim that each vendor GUI was tested.",
};
const handles: Client[] = [];
async function connect(client: ClientName) {
  const launch = hostLaunch({
    client,
    root,
    node: process.execPath,
    keychainService: `ai.rikoko.mcp.${identity}.${client}`,
  });
  const test = new Client({
    name: `${client}-protocol-acceptance`,
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    ...launch,
    env: {
      ...env,
      ...launch.env,
      ...(client === "hermes"
        ? {
            VIDEOWORKBENCH_API_KEY: await hostCredential({
              VIDEOWORKBENCH_KEYCHAIN_SERVICE: `ai.rikoko.mcp.${identity}.codex`,
            }),
          }
        : {}),
    },
    stderr: "pipe",
  });
  handles.push(test);
  await test.connect(transport);
  const tools = await test.listTools();
  for (const name of [
    "workspace_commit",
    "workspace_snapshot",
    "workspace_result",
    "asset_import_file",
    "workspace_export",
  ])
    if (!tools.tools.some((t) => t.name === name))
      throw Error(`${client} missing ${name}`);
  if (tools.tools.some((t) => t.name === "key_create"))
    throw Error("Administrator tools exposed");
  const prompts = await test.listPrompts();
  if (prompts.prompts.length !== 2) throw Error("Missing host prompts");
  if (
    test.getServerCapabilities()?.resources ||
    tools.tools.some(
      (tool) => !!tool._meta?.ui || !!tool._meta?.["ui/resourceUri"],
    )
  )
    throw Error("Unexpected embedded MCP UI");
  report[client] = {
    connected: true,
    toolCount: tools.tools.length,
    prompts: prompts.prompts.map((p) => p.name),
    interaction: "native-conversation-workspace-link",
    card: false,
  };
  return test;
}
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError)
    throw Error(`${name}: ${JSON.stringify(response.content)}`);
  if (["workspace_commit", "workspace_result"].includes(name)) {
    const output = (response.structuredContent as { result: any }).result;
    if (
      response.content.length !== 1 ||
      response.content[0].type !== "text" ||
      !output.workspace ||
      output.media ||
      output.conversation
    )
      throw Error("Expected a plain workspace-link reply");
  }
  return (response.structuredContent as { result: any }).result;
}
try {
  const codex = await connect("codex");
  const claude = await connect("claude-desktop");
  const hermes = await connect("hermes");
  const claudeCode = await connect("claude-code");
  await call(claudeCode, "capabilities", {});
  const receiptPath = join(output, "fixture.json");
  let fixture:
    { projectId: string; jobId: string; revisionId: string } | undefined;
  try {
    fixture = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch {
    /* first run */
  }
  if (!fixture) {
    const asset = await call(codex, "asset_import_file", {
      path: join(root, "artifacts/ui-replica/minimax-h3-official-sample.mp4"),
      name: "H3 official sample · host integration",
      license: "Official fal public sample, local integration test only",
      rightsConfirmed: true,
    });
    fixture = await call(codex, "workspace_commit", {
      message: "Codex/Hermes/Claude 对话接入验收（官方样片，本地剪辑）",
      origin: "agent",
      idempotencyKey: "host-integration-create-v1",
      action: {
        type: "create",
        composition: {
          schemaVersion: 1,
          title: "三端对话接入验收",
          width: 768,
          height: 432,
          language: "zh",
          scenes: [
            {
              id: "host-clip",
              assetId: asset.id,
              durationMs: 3000,
              sourceStartMs: 0,
              text: "CREATED IN THE CONVERSATION",
            },
          ],
        },
      },
    });
    await writeFile(receiptPath, JSON.stringify(fixture, null, 2));
  }
  const projectId = fixture!.projectId;
  const before = await call(claude, "workspace_snapshot", { projectId });
  let edited = fixture!;
  if (
    before.revision.composition.scenes[0].text !==
    "EDITED THROUGH THE SAME MCP PROJECT"
  ) {
    edited = await call(claude, "workspace_commit", {
      projectId,
      baseRevisionId: before.headRevisionId,
      origin: "agent",
      message: "Claude profile edits the same project",
      idempotencyKey: "host-integration-edit-v1",
      action: {
        type: "edit",
        edits: [
          {
            type: "caption",
            sceneId: "host-clip",
            text: "EDITED THROUGH THE SAME MCP PROJECT",
          },
        ],
      },
    });
  } else {
    edited = {
      ...fixture!,
      revisionId: before.headRevisionId,
      jobId: before.jobs.find(
        (j: any) => j.revisionId === before.headRevisionId,
      ).id,
    };
  }
  const resumed = await call(hermes, "workspace_snapshot", { projectId });
  if (resumed.headRevisionId !== edited.revisionId)
    throw Error("Cross-host revision mismatch");
  let delivered: any;
  for (let i = 0; i < 60; i++) {
    const job = await call(codex, "record_get", {
      type: "job",
      id: edited.jobId,
    });
    if (job.status === "completed") {
      delivered = await call(codex, "workspace_result", {
        jobId: edited.jobId,
      });
      break;
    }
    if (!["queued", "running"].includes(job.status))
      throw Error(`Render ${job.status}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!delivered) throw Error("Render timed out");
  const hermesResult = await call(hermes, "workspace_result", {
    jobId: edited.jobId,
  });
  const claudeResult = await call(claude, "workspace_result", {
    jobId: edited.jobId,
  });
  const downloads = [];
  for (const client of [codex, hermes, claude])
    downloads.push(
      await call(client, "workspace_export", { jobId: edited.jobId }),
    );
  for (const result of downloads) {
    const video = result.media.find((m: any) => m.mimeType === "video/mp4");
    if (!video?.localPath || !(await readFile(video.localPath)).length)
      throw Error("Native video missing");
  }
  report.workflow = {
    projectId,
    revisionId: edited.revisionId,
    jobId: edited.jobId,
    status: "completed",
    workspaceLinks: [delivered, hermesResult, claudeResult].map(
      (r) => r.workspace,
    ),
    explicitExport: true,
    paths: downloads.map(
      (result) =>
        result.media.find((m: any) => m.mimeType === "video/mp4").localPath,
    ),
    sharedVersion: true,
  };
  await writeFile(
    join(output, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const client of handles) await client.close();
}
