import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { createApp } from "../apps/server/src/app.js";

let db: Database, service: Service, dir: string, key: string;
let app: ReturnType<typeof createApp>;
const composition = {
  schemaVersion: 1,
  title: "产品短片",
  width: 360,
  height: 640,
  scenes: [{ id: "one", durationMs: 3000, text: "已确认的文案" }],
};
const photoGap = {
  id: "product",
  kind: "image",
  prompt: "请回复产品照片",
  purpose: "开头产品特写",
  required: true,
};
async function call(name: string, input: unknown, token = key) {
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
async function asset(kind = "image", token = key) {
  const context = await service.authenticate(token);
  return service.registerAsset(
    context.accountId,
    Buffer.from("contract-only"),
    {
      name: `product.${kind === "image" ? "png" : "mp3"}`,
      kind,
      mime: kind === "image" ? "image/png" : "audio/mpeg",
      metadata: { durationMs: 5000 },
      provenance: { evidence: "contract-only" },
    },
  );
}
beforeEach(async () => {
  vi.stubEnv("ENABLE_CREATIVE_AGENT", "false");
  dir = await mkdtemp(join(tmpdir(), "rikoko-request-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  key = (await service.createAccount("Request tests", 0)).key;
  app = createApp(service);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

it("resumes the same request after an attachment-only reply and submits exactly one project/job", async () => {
  const first = await call("workspace_plan", {
    message: "制作这款产品的 15 秒竖屏短片，不用模板",
  });
  expect(first.status).toBe(200);
  expect(first.result).toMatchObject({
    status: "waiting_input",
    missingInputs: [{ id: "product", required: true }],
  });
  expect(first.result.action).toBeUndefined();
  const { requestId, requestVersion } = first.result;
  expect((await call("records_list", { type: "job" })).result).toHaveLength(0);
  expect(
    (
      await call("workspace_commit", {
        requestId,
        requestVersion,
        action: { type: "create", composition },
        message: "premature",
        idempotencyKey: "premature",
      })
    ).error.code,
  ).toBe("REQUEST_NOT_READY");
  // A new application instance recovers persisted intent, not in-memory chat history.
  app = createApp(new Service(db, new LocalStorage(dir)));
  const image = await asset();
  const next = await call("workspace_plan", {
    requestId,
    requestVersion,
    assetIds: [image.id],
  });
  expect(next.status).toBe(200);
  expect(next.result).toMatchObject({
    requestId,
    requestVersion: 2,
    status: "ready",
    missingInputs: [],
  });
  expect(next.result.action.composition.scenes[0]).toMatchObject({
    assetId: image.id,
    durationMs: 15000,
  });
  const saved = (await call("workspace_request_get", { requestId })).result;
  expect(saved.originalMessage).toBe("制作这款产品的 15 秒竖屏短片，不用模板");
  expect(saved.turns).toHaveLength(2);
  expect(saved.assetIds).toEqual([image.id]);
  const input = {
    requestId,
    requestVersion: 2,
    action: next.result.action,
    message: saved.originalMessage,
    idempotencyKey: "resume",
  };
  const committed = await call("workspace_commit", input);
  expect(committed.status).toBe(200);
  expect((await call("workspace_commit", input)).result).toEqual(
    committed.result,
  );
  expect(
    (await call("workspace_request_get", { requestId })).result,
  ).toMatchObject({ status: "submitted", jobId: committed.result.jobId });
  expect(
    (await call("workspace_commit", { ...input, idempotencyKey: "duplicate" }))
      .error.code,
  ).toBe("REQUEST_NOT_READY");
  expect((await call("records_list", { type: "job" })).result).toHaveLength(1);
});

it("persists host-authored questions, keeps omitted gaps and rejects stale concurrent updates", async () => {
  const first = (
    await call("workspace_request_save", {
      message: "产品广告",
      missingInputs: [photoGap],
    })
  ).result;
  const audio = await asset("audio");
  const update = {
    requestId: first.requestId,
    requestVersion: first.requestVersion,
    assetIds: [audio.id],
  };
  const results = await Promise.all([
    call("workspace_request_save", update),
    call("workspace_request_save", update),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const saved = (
    await call("workspace_request_get", { requestId: first.requestId })
  ).result;
  expect(saved.status).toBe("waiting_input");
  expect(saved.missingInputs).toEqual([photoGap]);
  expect(saved.assetIds).toEqual([audio.id]);
  expect(
    (await call("workspace_request_save", { requestId: first.requestId }))
      .status,
  ).toBe(400);
});

it("does not clear a required photo merely because a different attachment arrived", async () => {
  const first = (
    await call("workspace_request_save", {
      message: "咖啡店新品短片",
      missingInputs: [photoGap],
    })
  ).result;
  const audio = await asset("audio");
  const planned = (
    await call("workspace_plan", {
      requestId: first.requestId,
      requestVersion: 1,
      assetIds: [audio.id],
    })
  ).result;
  expect(planned.status).toBe("waiting_input");
  expect(planned.action).toBeUndefined();
  expect(planned.autoApply).toBe(false);
  expect(planned.missingInputs).toContainEqual(photoGap);
});

it("keeps optional inputs non-blocking and rejects foreign requests/assets and read-only writes", async () => {
  const first = (
    await call("workspace_request_save", {
      message: "文字短片",
      missingInputs: [{ ...photoGap, required: false }],
    })
  ).result;
  expect(first.status).toBe("ready");
  const other = (await service.createAccount("Other", 0)).key;
  expect(
    (await call("workspace_request_get", { requestId: first.requestId }, other))
      .status,
  ).toBe(404);
  expect(
    (
      await call(
        "workspace_request_save",
        { requestId: first.requestId, requestVersion: 1, missingInputs: [] },
        other,
      )
    ).status,
  ).toBe(404);
  const foreign = await asset("image", other);
  expect(
    (
      await call("workspace_request_save", {
        message: "bad",
        assetIds: [foreign.id],
      })
    ).status,
  ).toBe(400);
  const context = await service.authenticate(key);
  const reader = (
    await service.issueKey(context, {
      name: "reader",
      scopes: ["read"],
      budgetCents: 0,
    })
  ).key;
  expect(
    (await call("workspace_request_save", { message: "bad" }, reader)).status,
  ).toBe(403);
  expect(
    (await call("workspace_plan", { message: "脚本：你好" }, reader)).status,
  ).toBe(403);
});

it("gives the configured planner previous questions and blocks an action returned alongside required gaps", async () => {
  const first = (
    await call("workspace_request_save", {
      message: "为我的商品制作竖屏广告",
      missingInputs: [photoGap],
    })
  ).result;
  vi.stubEnv("ENABLE_CREATIVE_AGENT", "true");
  vi.stubEnv(
    "CREATIVE_AGENT_URL",
    "https://model.example.test/v1/chat/completions",
  );
  vi.stubEnv("CREATIVE_AGENT_MODEL", "contract-only");
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                message: "还缺产品照片",
                missingInputs: [photoGap],
                action: { type: "create", composition },
              }),
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await call("workspace_plan", {
    requestId: first.requestId,
    requestVersion: 1,
    message: "字幕使用白色",
  });
  expect(result.status).toBe(200);
  expect(result.result.action).toBeUndefined();
  expect(result.result.status).toBe("waiting_input");
  const context = JSON.parse(
    JSON.parse(fetcher.mock.calls[0][1].body).messages[1].content,
  );
  expect(context.conversation.originalMessage).toBe("为我的商品制作竖屏广告");
  expect(context.conversation.missingInputs).toEqual([photoGap]);
  expect(context.request).toContain("字幕使用白色");
});

it("exposes content only after completion and refreshed media links do not create jobs", async () => {
  const created = (
    await call("workspace_commit", {
      action: { type: "create", composition },
      message: "create",
      idempotencyKey: "delivery",
    })
  ).result;
  const pending = (await call("workspace_result", { jobId: created.jobId }))
    .result;
  expect(pending.media).toEqual([]);
  expect(pending.textContent).toBeUndefined();
  const image = await asset();
  await db.transaction(async (tx) => {
    const job = await tx.get(created.jobId);
    await tx.put({ ...job!, status: "completed", outputs: [image.id] });
  });
  const result = (await call("workspace_result", { jobId: created.jobId }))
    .result;
  expect(result.textContent).toMatchObject({
    title: "产品短片",
    screenText: ["已确认的文案"],
    source: "composition-screen-text",
  });
  const renewed = (await call("workspace_result", { jobId: created.jobId }))
    .result;
  expect(renewed.media[0].url).not.toBe(result.media[0].url);
  expect((await call("records_list", { type: "job" })).result).toHaveLength(1);
});
