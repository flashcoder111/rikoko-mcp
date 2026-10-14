import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";
import { starterTemplates } from "../packages/templates/src/starters.js";
import {
  rankTemplates,
  relevantAssets,
} from "../packages/templates/src/matching.js";

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
beforeEach(async () => {
  vi.stubEnv("ENABLE_CREATIVE_AGENT", "false");
  dir = await mkdtemp(join(tmpdir(), "rikoko-auto-template-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  key = (await service.createAccount("Auto templates", 0)).key;
  app = createApp(service);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
const brief = "帮我做一条15秒的咖啡店新品宣传视频，主打生椰拿铁，温暖一点";
it("turns a text-only brief into one automatically adapted composition without reference uploads or paid generation", async () => {
  const paid = vi.spyOn(service.provider, "submit");
  const network = vi.spyOn(globalThis, "fetch");
  const matching = await call("template_match", { brief });
  expect(matching.status).toBe(200);
  expect(matching.result.candidates[0].template.id).toBe(
    "rikoko-starter-store",
  );
  expect((await call("records_list", { type: "asset" })).result).toHaveLength(
    0,
  );
  const planned = await call("workspace_plan", { message: brief });
  expect(planned.status).toBe(200);
  expect(planned.result.autoApply).toBe(true);
  expect(planned.result.action.type).toBe("create");
  expect(planned.result.reuse).toMatchObject({
    templateId: "rikoko-starter-store",
    generationRequests: 0,
  });
  const composition = planned.result.action.composition;
  expect(
    composition.scenes.reduce((s: number, c: any) => s + c.durationMs, 0),
  ).toBe(15000);
  expect(composition.scenes.map((s: any) => s.text).join(" ")).toContain(
    "生椰拿铁",
  );
  expect(composition.scenes.map((s: any) => s.text).join(" ")).not.toContain(
    "新的一杯",
  );
  expect(composition.scenes.every((s: any) => s.assetId)).toBe(true);
  const repeated = await call("workspace_plan", {
    message: `${brief}，不要生成新图片`,
  });
  expect(repeated.result.autoApply).toBe(true);
  expect(repeated.result.action).toEqual(planned.result.action);
  expect((await call("records_list", { type: "asset" })).result).toHaveLength(
    1,
  );
  expect((await call("records_list", { type: "project" })).result).toHaveLength(
    0,
  );
  const command = {
    action: planned.result.action,
    message: brief,
    idempotencyKey: "auto-template",
  };
  const created = await call("workspace_commit", command);
  expect(created.status).toBe(200);
  expect((await call("workspace_commit", command)).result).toEqual(
    created.result,
  );
  expect((await call("records_list", { type: "job" })).result).toHaveLength(1);
  expect(paid).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it("uses relevant owned images automatically but never another account's or unrelated favorite assets", async () => {
  const c = await service.authenticate(key);
  const item = (
    await call("asset_import_starter", { id: "starter-coffee-corner" })
  ).result;
  await service.scoped(c, "write", (tx) =>
    tx.put({
      ...item,
      name: "生椰拿铁照片",
      provenance: { source: "conversation-upload" },
      library: { category: "商品", tags: ["咖啡店", "拿铁"], favorite: true },
    }),
  );
  const other = (await service.createAccount("Other", 0)).key;
  expect(
    (await call("template_match", { brief }, other)).result.assets,
  ).toHaveLength(0);
  const plan = (await call("workspace_plan", { message: brief })).result;
  expect(
    plan.action.composition.scenes.every((s: any) => s.assetId === item.id),
  ).toBe(true);
  expect((await call("records_list", { type: "asset" })).result).toHaveLength(
    1,
  );
  expect(
    relevantAssets(brief, [
      {
        ...item,
        name: "汽车",
        library: { category: "商品", favorite: true, tags: ["轿车"] },
      },
    ]),
  ).toHaveLength(0);
});
it("preserves literal scripts, requested format, and existing shots on subsequent edits", async () => {
  const request =
    "咖啡店宣传，6秒横屏。脚本：制作一杯咖啡；温暖，就是今天；新品视频上线";
  const plan = (await call("workspace_plan", { message: request })).result;
  expect(plan.action.composition.width).toBe(1280);
  expect(plan.action.composition.scenes.map((s: any) => s.text)).toEqual([
    "制作一杯咖啡",
    "温暖，就是今天",
    "新品视频上线",
  ]);
  const created = (
    await call("workspace_commit", {
      action: plan.action,
      message: request,
      idempotencyKey: "literal-script",
    })
  ).result;
  const edit = (
    await call("workspace_plan", {
      projectId: created.projectId,
      message: "第一个镜头字幕改成：新品到店",
    })
  ).result;
  expect(edit.action).toMatchObject({
    type: "edit",
    edits: [{ type: "caption", text: "新品到店" }],
  });
  expect(edit.reuse).toBeUndefined();
});
it("respects opting out and does not pretend graphic templates supply testimonials or generated footage", async () => {
  expect(
    (await call("template_match", { brief: "不要模板，咖啡店广告" })).result
      .candidates,
  ).toHaveLength(0);
  const noTemplate = (
    await call("workspace_plan", { message: "不用模板。脚本：你好；世界" })
  ).result;
  expect(noTemplate.reuse).toBeUndefined();
  expect(
    noTemplate.action.composition.scenes.every((s: any) => !s.assetId),
  ).toBe(true);
  expect(
    (await call("workspace_plan", { message: "做一个咖啡店真人口播视频" }))
      .result.action,
  ).toBeUndefined();
  expect(
    (await call("workspace_plan", { message: "做一个客户评价视频" })).result
      .action,
  ).toBeUndefined();
  expect(rankTemplates("做一条未知宇宙大片", starterTemplates)).toHaveLength(0);
});
function mockModel(template: unknown) {
  vi.stubEnv("ENABLE_CREATIVE_AGENT", "true");
  vi.stubEnv("CREATIVE_AGENT_URL", "http://127.0.0.1:8080/v1/chat/completions");
  vi.stubEnv("CREATIVE_AGENT_MODEL", "mocked-only");
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ message: "自动编排", template }),
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it("lets the configured Agent select and write a template using the library context, without a user selection step", async () => {
  const fetcher = mockModel({
    id: "rikoko-starter-store",
    version: 1,
    parameters: { text1: "咖啡店上新", text2: "生椰拿铁", text3: "到店尝尝" },
    durationMs: 15000,
  });
  const result = await call("workspace_plan", { message: brief });
  expect(result.status).toBe(200);
  expect(result.result.autoApply).toBe(true);
  expect(result.result.engine).toBe("configured-model");
  const request = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(
    JSON.parse(request.messages[1].content).templates.some(
      (t: any) => t.id === "rikoko-starter-store",
    ),
  ).toBe(true);
  expect(request.messages[0].content).toContain(
    "Do NOT ask the user to choose a template",
  );
  expect(result.result.action.composition.scenes[1].text).toBe("生椰拿铁");
});
it.each([
  { id: "made-up", version: 1, parameters: {} },
  {
    id: "rikoko-starter-store",
    version: 1,
    parameters: { text1: "a", text2: "b", text3: "c" },
    sceneAssets: { "scene-1": "foreign" },
  },
  {
    id: "rikoko-starter-store",
    version: 1,
    parameters: { text1: "missing-rest" },
  },
])(
  "rejects an invalid model selection before importing media",
  async (template) => {
    mockModel(template);
    expect((await call("workspace_plan", { message: brief })).status).toBe(502);
    expect((await call("records_list", { type: "asset" })).result).toHaveLength(
      0,
    );
  },
);
it("keeps plan-only requests reviewable and read-only keys cannot import template media", async () => {
  const proposal = await call("workspace_plan", {
    message: "先只给方案，咖啡店新品短片，主打生椰拿铁",
  });
  expect(proposal.status).toBe(200);
  expect(proposal.result.autoApply).toBe(false);
  expect((await call("records_list", { type: "job" })).result).toHaveLength(0);
  const context = await service.authenticate(key);
  const reader = (
    await service.issueKey(context, {
      name: "read only",
      scopes: ["read"],
      budgetCents: 0,
    })
  ).key;
  expect((await call("template_match", { brief }, reader)).status).toBe(200);
  expect(
    (await call("workspace_plan", { message: brief }, reader)).status,
  ).toBe(403);
});
it.each(["文案是：", "文案为：", "字幕内容为："])(
  "keeps explicit %s copy separate from production instructions",
  async (label) => {
    const planned = await call("workspace_plan", {
      message: `制作一个介绍原创香氛的竖屏短片，${label}温暖木香，日常陪伴。`,
    });
    expect(
      planned.result.action.composition.scenes
        .map((s: any) => s.text)
        .filter(Boolean),
    ).toEqual(["温暖木香，日常陪伴。"]);
  },
);
