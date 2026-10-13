// Local development fixture from fal's public H3 example; not a new model generation.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const key = (await readFile(".data/local-admin.key", "utf8")).trim();
async function tool(name: string, input: unknown) {
  const response = await fetch(`http://127.0.0.1:4310/api/tools/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw Error(JSON.stringify(body.error));
  return body.result;
}
const all = await tool("records_list", { type: "asset" });
let asset = all.find(
  (a: any) => a.name === "MiniMax H3 · fal official sample.mp4",
);
if (!asset) {
  const bytes = await readFile(
    "artifacts/ui-replica/minimax-h3-official-sample.mp4",
  );
  const intent = await tool("upload_create", {
    name: "MiniMax H3 · fal official sample.mp4",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source: "https://fal.ai/models/minimax/h3/text-to-video",
    license: "fal public example; local development reference only",
    rightsConfirmed: true,
  });
  const response = await fetch(
    new URL(intent.uploadUrl, "http://127.0.0.1:4310"),
    { method: "PUT", headers: { Authorization: `Bearer ${key}` }, body: bytes },
  );
  const body = await response.json();
  if (!response.ok) throw Error(JSON.stringify(body.error));
  asset = body.result;
}
const composition = {
  schemaVersion: 1,
  title: "MiniMax H3 · Cinematic Duel",
  width: 768,
  height: 432,
  fps: 24,
  language: "en",
  scenes: [
    {
      id: "h3-intro",
      assetId: asset.id,
      durationMs: 2000,
      sourceStartMs: 0,
      text: "",
      color: "#121214",
      fit: "contain",
      volume: 1,
    },
    {
      id: "h3-action",
      assetId: asset.id,
      durationMs: 2000,
      sourceStartMs: 2000,
      text: "",
      color: "#121214",
      fit: "contain",
      volume: 1,
    },
    {
      id: "h3-finale",
      assetId: asset.id,
      durationMs: 1000,
      sourceStartMs: 4000,
      text: "",
      color: "#121214",
      fit: "contain",
      volume: 1,
    },
  ],
  events: [],
  captionStyle: { fontSize: 28, color: "#ffffff", background: "#151a22" },
};
const result = await tool("workspace_commit", {
  action: { type: "create", composition },
  message:
    "使用 fal 官方 MiniMax H3 样片验证分割、字幕、配乐与导出。此素材是官方示例，本轮未购买生成。",
  origin: "studio",
  idempotencyKey: "h3-ui-fixture-2026-10-11",
});
await writeFile(
  "artifacts/ui-replica/h3-fixture.json",
  JSON.stringify(
    {
      source: "https://fal.ai/models/minimax/h3/text-to-video",
      evidence: "official-sample-not-new-generation",
      assetId: asset.id,
      ...result,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    assetId: asset.id,
    projectId: result.projectId,
    revisionId: result.revisionId,
    jobId: result.jobId,
  }),
);
