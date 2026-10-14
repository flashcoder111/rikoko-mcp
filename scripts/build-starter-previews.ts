import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { Worker } from "../apps/worker/src/worker.js";
import { callTool } from "../packages/mcp/src/tools.js";
import { starterTemplates } from "../packages/templates/src/starters.js";

// Only an isolated zero-balance workspace and local renders; never uses process provider config.
const dir = await mkdtemp(join(tmpdir(), "rikoko-starter-previews-"));
const db = await Database.open();
const service = new Service(db, new LocalStorage(dir));
const c = await service.authenticate(
  (await service.createAccount("Starter previews", 0)).key,
);
const worker = new Worker(service);
const output = new URL(
  "../packages/templates/src/bundled/previews/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
try {
  const templates = process.argv.includes("--new")
    ? starterTemplates.filter((template) => template.isNew)
    : starterTemplates;
  for (const template of templates) {
    const prepared = await callTool(service, c, "template_prepare", {
      id: template.id,
      version: template.version,
    });
    const created = await callTool(service, c, "workspace_commit", {
      action: { type: "create", composition: prepared.composition },
      message: "原创模板示例",
      idempotencyKey: template.id,
    });
    let job = await service.get(c, "job", created.jobId);
    for (let i = 0; i < 10 && ["queued", "running"].includes(job.status); i++) {
      await worker.tick();
      job = await service.get(c, "job", created.jobId);
    }
    if (job.status !== "completed")
      throw Error(`${template.id}: ${job.status} ${job.error?.message ?? ""}`);
    const asset = await service.get(c, "asset", job.outputs[0]);
    await writeFile(
      new URL(`${template.id}.mp4`, output),
      await service.storage.read(asset.storageKey),
    );
    console.log(
      `${template.title}: ${asset.metadata.durationMs} ms, ${asset.metadata.width} × ${asset.metadata.height}`,
    );
  }
} finally {
  await db.close();
  await rm(dir, { recursive: true, force: true });
}
