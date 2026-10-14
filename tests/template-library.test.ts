import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";
import { matchesAsset } from "../packages/core/src/library-metadata.js";

let dir: string, db: Database, service: Service, key: string;
let app: ReturnType<typeof createApp>;
async function call(name: string, input: unknown = {}, token = key) {
  const response = await app.request(`http://localhost/api/tools/${name}`, {
    method: "POST",
    headers: {
      Host: "localhost",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return { status: response.status, ...((await response.json()) as any) };
}
const input = {
  id: "rikoko-starter-product",
  version: 1,
  parameters: { text1: "夏日新品" },
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rikoko-library-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  key = (await service.createAccount("Library", 0)).key;
  app = createApp(service);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

it("discovers nine templates offline without creating media, jobs or projects", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  const catalog = await call("template_list");
  expect(catalog.status).toBe(200);
  expect(catalog.result.templates).toHaveLength(9);
  expect(catalog.result.configured).toBe(false);
  for (const type of ["asset", "project", "job"])
    expect((await call("records_list", { type })).result).toHaveLength(0);
  expect(network).not.toHaveBeenCalled();
});
it("prepares the new stories with distinct scene artwork and reuses it on text-only changes", async () => {
  const paid = vi.spyOn(service.provider, "submit");
  const catalog = (await call("template_list")).result.templates;
  for (const id of ["software", "before-after", "testimonial"]) {
    const template = catalog.find((t: any) => t.id === `rikoko-starter-${id}`);
    expect(template.preparation).toBeTruthy();
    expect(template.isNew).toBe(true);
    const prepared = await call("template_prepare", {
      id: template.id,
      version: 1,
    });
    expect(prepared.status).toBe(200);
    const scenes = prepared.result.composition.scenes;
    expect(new Set(scenes.map((s: any) => s.assetId)).size).toBe(3);
    expect(prepared.result.reuse.generationRequests).toBe(0);
    const edited = await call("template_prepare", {
      id: template.id,
      version: 1,
      parameters: { text2: "换成我的真实内容" },
    });
    expect(edited.result.composition.scenes[1].text).toBe("换成我的真实内容");
    expect(edited.result.composition.scenes.map((s: any) => s.assetId)).toEqual(
      scenes.map((s: any) => s.assetId),
    );
    for (const asset of template.assets) {
      const response = await app.request(
        `http://localhost/api/starter-assets/${asset.id}/file`,
        {
          headers: { Host: "localhost", Authorization: `Bearer ${key}` },
        },
      );
      expect(response.status).toBe(200);
    }
  }
  expect((await call("records_list", { type: "asset" })).result).toHaveLength(
    9,
  );
  expect((await call("records_list", { type: "job" })).result).toHaveLength(0);
  expect(paid).not.toHaveBeenCalled();
});
it("rejects overlong new-template copy before importing artwork", async () => {
  const result = await call("template_prepare", {
    id: "rikoko-starter-software",
    version: 1,
    parameters: { text2: "长".repeat(49) },
  });
  expect(result.status).toBe(400);
  expect((await call("records_list", { type: "asset" })).result).toHaveLength(
    0,
  );
});
it("reuses bundled bytes across repeated preparation and caption edits without buying generation", async () => {
  const paid = vi.spyOn(service.provider, "submit");
  const a = (await call("template_prepare", input)).result;
  const b = (await call("template_prepare", input)).result;
  expect(b.composition).toEqual(a.composition);
  expect(a.reuse.generationRequests).toBe(0);
  expect((await call("records_list", { type: "asset" })).result).toHaveLength(
    1,
  );
  expect((await call("records_list", { type: "job" })).result).toHaveLength(0);
  const command = {
    action: { type: "create", composition: a.composition },
    message: "使用模板",
    idempotencyKey: "template-test",
  };
  const first = (await call("workspace_commit", command)).result;
  const retry = (await call("workspace_commit", command)).result;
  expect(retry).toEqual(first);
  const edited = await call("workspace_commit", {
    projectId: first.projectId,
    baseRevisionId: first.revisionId,
    action: {
      type: "edit",
      edits: [{ type: "caption", sceneId: "scene-1", text: "只改字幕" }],
    },
    message: "修改字幕",
    idempotencyKey: "caption-test",
  });
  expect(edited.status).toBe(200);
  const state = (
    await call("workspace_snapshot", { projectId: first.projectId })
  ).result;
  expect(state.revision.composition.scenes.map((s: any) => s.assetId)).toEqual(
    a.composition.scenes.map((s: any) => s.assetId),
  );
  expect((await call("records_list", { type: "asset" })).result).toHaveLength(
    1,
  );
  expect(
    (await call("records_list", { type: "job" })).result.every(
      (j: any) => j.input.kind === "render",
    ),
  ).toBe(true);
  expect(paid).not.toHaveBeenCalled();
});
it("substitutes selected existing images without importing unused template artwork", async () => {
  const asset = (
    await call("asset_import_starter", { id: "starter-coffee-corner" })
  ).result;
  const prepared = await call("template_prepare", {
    ...input,
    sceneAssets: {
      "scene-1": asset.id,
      "scene-2": asset.id,
      "scene-3": asset.id,
    },
  });
  expect(prepared.status).toBe(200);
  expect(
    prepared.result.composition.scenes.every(
      (s: any) => s.assetId === asset.id,
    ),
  ).toBe(true);
  expect(prepared.result.reuse.existingScenes).toBe(3);
  expect((await call("records_list", { type: "asset" })).result).toHaveLength(
    1,
  );
});
it("rejects unknown slots, invalid text and other accounts' media before importing anything", async () => {
  const otherKey = (await service.createAccount("Other", 0)).key;
  const foreign = (
    await call(
      "asset_import_starter",
      { id: "starter-coffee-corner" },
      otherKey,
    )
  ).result;
  expect(
    (
      await call("template_prepare", {
        ...input,
        sceneAssets: { "scene-1": foreign.id },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await call("template_prepare", {
        ...input,
        sceneAssets: { unknown: foreign.id },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("template_prepare", {
        ...input,
        parameters: { unknown: "bad" },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("template_prepare", {
        ...input,
        parameters: { text1: "x".repeat(101) },
      })
    ).status,
  ).toBe(400);
  expect((await call("records_list", { type: "asset" })).result).toHaveLength(
    0,
  );
  expect((await call("records_list", { type: "project" })).result).toHaveLength(
    0,
  );
});
it("persists purpose, tags and favorites without changing bytes, and rejects foreign organization", async () => {
  const asset = (
    await call("asset_import_starter", { id: "starter-coffee-corner" })
  ).result;
  const library = { category: "商品", tags: ["咖啡", "夏季"], favorite: true };
  const saved = await call("asset_organize", {
    assetId: asset.id,
    name: "门店招牌咖啡",
    library,
  });
  expect(saved.result.library).toEqual(library);
  expect(saved.result.sha256).toBe(asset.sha256);
  expect(matchesAsset(saved.result, "夏季", "商品", true)).toBe(true);
  expect(matchesAsset(saved.result, "夏季", "人物", true)).toBe(false);
  expect(
    (
      await call("asset_search", {
        query: "夏季",
        category: "商品",
        favorites: true,
      })
    ).result.map((a: any) => a.id),
  ).toEqual([asset.id]);
  const again = (
    await call("asset_import_starter", { id: "starter-coffee-corner" })
  ).result;
  expect(again.library).toEqual(library);
  const other = (await service.createAccount("Other", 0)).key;
  expect(
    (await call("asset_search", { query: "夏季" }, other)).result,
  ).toHaveLength(0);
  expect(
    (await call("asset_organize", { assetId: asset.id, library }, other))
      .status,
  ).toBe(404);
});
it("deduplicates concurrent starter imports and keeps read-only keys read-only", async () => {
  const [a, b] = await Promise.all([
    call("asset_import_starter", { id: "starter-coffee-corner" }),
    call("asset_import_starter", { id: "starter-coffee-corner" }),
  ]);
  expect(a.result.id).toBe(b.result.id);
  expect((await call("records_list", { type: "asset" })).result).toHaveLength(
    1,
  );
  const context = await service.authenticate(key);
  const reader = (
    await service.issueKey(context, {
      name: "Reader",
      scopes: ["read"],
      budgetCents: 0,
    })
  ).key;
  expect((await call("template_list", {}, reader)).status).toBe(200);
  expect((await call("template_prepare", input, reader)).status).toBe(403);
  expect(
    (
      await call(
        "asset_import_starter",
        { id: "starter-coffee-corner" },
        reader,
      )
    ).status,
  ).toBe(403);
});
it("protects bundled previews with authentication and rejects unknown paths", async () => {
  expect(
    (
      await app.request(
        "http://localhost/api/starter-assets/starter-coffee-corner/file",
        { headers: { Host: "localhost" } },
      )
    ).status,
  ).toBe(401);
  const response = await app.request(
    "http://localhost/api/starter-assets/starter-coffee-corner/file",
    { headers: { Host: "localhost", Authorization: `Bearer ${key}` } },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await response.arrayBuffer()).slice(0, 8)).toEqual(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(
    (
      await app.request("http://localhost/api/starter-assets/not-a-file/file", {
        headers: { Host: "localhost", Authorization: `Bearer ${key}` },
      })
    ).status,
  ).toBe(404);
});
