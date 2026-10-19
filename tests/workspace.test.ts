import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  title: "同一份作品",
  width: 360,
  height: 640,
  language: "zh",
  scenes: [
    { id: "one", durationMs: 3000, text: "第一句", color: "#173b42" },
    { id: "two", durationMs: 3000, text: "第二句", color: "#403148" },
    { id: "three", durationMs: 2000, text: "结尾", color: "#233956" },
  ],
};
async function call(name: string, input: unknown, apiKey = key) {
  const response = await app.request(`http://localhost/api/tools/${name}`, {
    method: "POST",
    headers: {
      Host: "localhost",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return { status: response.status, ...((await response.json()) as any) };
}
async function create() {
  const response = await call("workspace_commit", {
    action: { type: "create", composition },
    message: "创建短片",
    origin: "chat",
    idempotencyKey: "first",
  });
  expect(response.status).toBe(200);
  return response.result;
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dual-mode-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  key = (await service.createAccount("Workspace", 0)).key;
  app = createApp(service);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("one project across chat, studio and MCP", () => {
  it("creates once, edits in studio, resumes from the latest version and restores without losing history", async () => {
    const first = await create();
    const edited = await call("workspace_commit", {
      projectId: first.projectId,
      baseRevisionId: first.revisionId,
      action: {
        type: "edit",
        edits: [
          { type: "delete", sceneId: "three" },
          { type: "caption", sceneId: "two", text: "工作台改好的字幕" },
        ],
      },
      message: "删掉结尾并修改字幕",
      origin: "studio",
      idempotencyKey: "edit",
    });
    expect(edited.status).toBe(200);
    const state = (
      await call("workspace_snapshot", { projectId: first.projectId })
    ).result;
    expect(state.revision.id).toBe(edited.result.revisionId);
    expect(state.revision.composition.scenes).toHaveLength(2);
    expect(state.messages.map((m: any) => m.origin)).toEqual([
      "chat",
      "studio",
    ]);
    expect(state.revisions).toHaveLength(2);
    expect(state.links.workspace).toContain(first.projectId);
    expect(state.links.conversation).toContain(first.projectId);
    const original = (
      await call("record_get", { type: "revision", id: first.revisionId })
    ).result;
    expect(original.composition.scenes).toHaveLength(3);
    const restored = await call("workspace_commit", {
      projectId: first.projectId,
      baseRevisionId: state.revision.id,
      action: { type: "restore", revisionId: first.revisionId },
      message: "恢复第一版",
      origin: "chat",
      idempotencyKey: "restore",
    });
    expect(restored.status).toBe(200);
    expect(restored.result.revisionId).not.toBe(first.revisionId);
    expect(
      (await call("workspace_snapshot", { projectId: first.projectId })).result
        .revision.composition,
    ).toEqual(original.composition);
  });
  it("rejects stale edits and concurrent updates without overwriting another surface", async () => {
    const first = await create();
    const edit = (idempotencyKey: string) =>
      call("workspace_commit", {
        projectId: first.projectId,
        baseRevisionId: first.revisionId,
        action: { type: "edit", edits: [{ type: "delete", sceneId: "three" }] },
        message: "删除结尾",
        origin: "studio",
        idempotencyKey,
      });
    const results = await Promise.all([edit("a"), edit("b")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.error.code).toBe(
      "REVISION_CONFLICT",
    );
    expect(
      (await call("workspace_snapshot", { projectId: first.projectId })).result
        .revisions,
    ).toHaveLength(2);
  });
  it("retries the same command without another project, revision or render", async () => {
    const [first, second] = await Promise.all([create(), create()]);
    expect(second).toEqual(first);
    expect(
      (await call("records_list", { type: "project" })).result,
    ).toHaveLength(1);
    expect((await call("records_list", { type: "job" })).result).toHaveLength(
      1,
    );
    expect(
      (await call("workspace_snapshot", { projectId: first.projectId })).result
        .messages,
    ).toHaveLength(1);
    const changed = await call("workspace_commit", {
      action: {
        type: "create",
        composition: { ...composition, title: "Different" },
      },
      message: "创建短片",
      origin: "chat",
      idempotencyKey: "first",
    });
    expect(changed.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
  it("opening a workspace only reads state and does not create a job", async () => {
    const first = await create();
    await call("workspace_snapshot", { projectId: first.projectId });
    await call("workspace_snapshot", {
      projectId: first.projectId,
      revisionId: first.revisionId,
    });
    expect((await call("records_list", { type: "job" })).result).toHaveLength(
      1,
    );
  });
  it("imports legacy project history and rejects cross-project versions and incomplete edits", async () => {
    const c = await service.authenticate(key);
    const legacy = await service.createProject(c, { title: "Legacy" });
    expect(
      (await call("workspace_snapshot", { projectId: legacy.id })).result
        .revision,
    ).toBeNull();
    const old = await service.addRevision(c, legacy.id, composition);
    const first = await create();
    expect(
      (
        await call("workspace_snapshot", {
          projectId: legacy.id,
          revisionId: first.revisionId,
        })
      ).status,
    ).toBe(404);
    const input = {
      projectId: legacy.id,
      baseRevisionId: old.id,
      message: "legacy edit",
      idempotencyKey: "legacy",
    };
    expect(
      (
        await call("workspace_commit", {
          ...input,
          action: { type: "restore", revisionId: first.revisionId },
        })
      ).status,
    ).toBe(404);
    const changed = await call("workspace_commit", {
      ...input,
      action: {
        type: "edit",
        edits: [{ type: "caption", sceneId: "one", text: "Updated" }],
      },
    });
    expect(changed.status).toBe(200);
    expect(
      (await call("workspace_snapshot", { projectId: legacy.id })).result
        .revision.version,
    ).toBe(2);
    await expect(
      service.addRevision(c, legacy.id, composition),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(
      (
        await call("workspace_commit", {
          action: { type: "create", composition },
          projectId: legacy.id,
          message: "wrong",
          idempotencyKey: "wrong",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("workspace_commit", {
          action: { type: "edit", edits: [{ type: "style", fontSize: 32 }] },
          message: "missing",
          idempotencyKey: "missing",
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("workspace_plan", { revisionId: old.id, message: "wrong" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("workspace_plan", {
          projectId: legacy.id,
          selectedSceneId: "absent",
          message: "wrong",
        })
      ).status,
    ).toBe(400);
  });
  it("legacy revision and feedback edits advance the shared head and reject stale changes", async () => {
    const first = await create(),
      c = await service.authenticate(key);
    const revised = await service.revise(c, first.revisionId, {
      type: "style",
      style: { fontSize: 32 },
    });
    expect(
      (await call("workspace_snapshot", { projectId: first.projectId })).result
        .headRevisionId,
    ).toBe(revised.id);
    await expect(
      service.revise(c, first.revisionId, {
        type: "style",
        style: { fontSize: 36 },
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(
      service.feedback(c, first.revisionId, {
        text: "stale",
        patch: { type: "style", style: { fontSize: 36 } },
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const feedback = await service.feedback(c, revised.id, {
      text: "larger",
      patch: { type: "style", style: { fontSize: 36 } },
    });
    expect(
      (await call("workspace_snapshot", { projectId: first.projectId })).result
        .headRevisionId,
    ).toBe(feedback.revision!.id);
  });
  it("preserves original speech when replacing a trimmed source with a photo and validates media types", async () => {
    const c = await service.authenticate(key);
    const asset = async (
      name: string,
      kind: string,
      metadata: Record<string, unknown>,
    ) =>
      service.registerAsset(c.accountId, new TextEncoder().encode(name), {
        name,
        kind,
        mime: kind === "audio" ? "audio/wav" : "video/mp4",
        metadata,
        provenance: { evidence: "contract-mock" },
      });
    const video = await asset("source", "video", {
        durationMs: 10000,
        hasAudio: true,
      }),
      photo = await asset("photo", "image", {}),
      audio = await asset("voice", "audio", { durationMs: 1000 });
    const source = (
      await call("workspace_commit", {
        message: "source",
        idempotencyKey: "source",
        action: {
          type: "create",
          composition: {
            ...composition,
            scenes: [
              {
                id: "one",
                durationMs: 2000,
                sourceStartMs: 1000,
                assetId: video.id,
              },
            ],
          },
        },
      })
    ).result;
    const edit = (edits: unknown[], idempotencyKey: string) =>
      call("workspace_commit", {
        projectId: source.projectId,
        baseRevisionId: source.revisionId,
        message: "replace",
        idempotencyKey,
        action: { type: "edit", edits },
      });
    expect(
      (
        await edit(
          [{ type: "visual", sceneId: "one", assetId: audio.id }],
          "audio-picture",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await edit(
          [{ type: "music", assetId: photo.id, gain: 0.2 }],
          "photo-music",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await edit(
          [
            {
              type: "scene_audio",
              sceneId: "one",
              audioAssetId: photo.id,
              volume: 1,
            },
          ],
          "photo-voice",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await edit(
          [{ type: "visual", sceneId: "one", assetId: photo.id }],
          "replace",
        )
      ).status,
    ).toBe(200);
    const state = (
      await call("workspace_snapshot", { projectId: source.projectId })
    ).result;
    expect(state.revision.composition.scenes[0]).toMatchObject({
      assetId: photo.id,
      audioAssetId: video.id,
      audioSourceStartMs: 1000,
    });
    const invalid = {
      ...composition,
      scenes: [
        { id: "one", durationMs: 2000, sourceStartMs: 9500, assetId: video.id },
      ],
    };
    expect(
      (
        await call("workspace_commit", {
          message: "too long",
          idempotencyKey: "too-long",
          action: { type: "create", composition: invalid },
        })
      ).status,
    ).toBe(400);
  });
  it("keeps tenant, read-only scope and asset ownership boundaries", async () => {
    const first = await create();
    const other = (await service.createAccount("Other", 0)).key;
    expect(
      (await call("workspace_snapshot", { projectId: first.projectId }, other))
        .status,
    ).toBe(404);
    const readonly = await service.issueKey(await service.authenticate(key), {
      name: "Read",
      scopes: ["read"],
      budgetCents: 0,
    });
    expect(
      (
        await call(
          "workspace_snapshot",
          { projectId: first.projectId },
          readonly.key,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          "workspace_commit",
          {
            action: { type: "create", composition },
            message: "create",
            origin: "chat",
            idempotencyKey: "readonly",
          },
          readonly.key,
        )
      ).status,
    ).toBe(403);
    const foreign = await service.registerAsset(
      (await service.authenticate(other)).accountId,
      new Uint8Array([1]),
      {
        name: "private.png",
        kind: "image",
        mime: "image/png",
        metadata: {},
        provenance: { evidence: "contract-mock" },
      },
    );
    expect(
      (
        await call("workspace_commit", {
          projectId: first.projectId,
          baseRevisionId: first.revisionId,
          message: "replace",
          origin: "agent",
          idempotencyKey: "foreign",
          action: {
            type: "edit",
            edits: [{ type: "visual", sceneId: "one", assetId: foreign.id }],
          },
        })
      ).status,
    ).toBe(404);
  });
  it("plans explicit edits against the selected version and asks for clarification for unsupported intent", async () => {
    const first = await create();
    const planned = await call("workspace_plan", {
      projectId: first.projectId,
      message: "删除最后一个镜头",
    });
    expect(planned.status).toBe(200);
    expect(planned.result.baseRevisionId).toBe(first.revisionId);
    expect(planned.result.action.edits).toEqual([
      { type: "delete", sceneId: "three" },
    ]);
    const unknown = await call("workspace_plan", {
      projectId: first.projectId,
      message: "把这座山变成银河，保留所有人物的脸",
    });
    expect(unknown.result.action).toBeUndefined();
    expect(unknown.result.message).toBeTruthy();
    expect((await call("records_list", { type: "job" })).result).toHaveLength(
      1,
    );
  });
});

describe("browser sessions", () => {
  it("supports an explicitly configured HTTPS proxy origin and expires logout sessions", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://video.example.test");
    const proxied = createApp(service, {
      allowedHosts: ["video.example.test"],
    });
    const url = "http://video.example.test/auth/session";
    const login = await proxied.request(url, {
      method: "POST",
      headers: {
        Host: "video.example.test",
        Origin: "https://video.example.test",
        Authorization: `Bearer ${key}`,
      },
    });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("Secure");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const headers = {
      Host: "video.example.test",
      Cookie: cookie,
      Origin: "https://video.example.test",
    };
    expect((await proxied.request(url, { headers })).status).toBe(200);
    expect(
      (await proxied.request(url, { method: "DELETE", headers })).status,
    ).toBe(200);
    expect((await proxied.request(url, { headers })).status).toBe(401);
    expect(
      await (
        await proxied.request(url, { headers: { Host: "video.example.test" } })
      ).json(),
    ).toEqual({ connected: false });
  });
  it("connects once with an HttpOnly session, checks origin and honors revoked keys", async () => {
    const login = await app.request("http://localhost/auth/session", {
      method: "POST",
      headers: {
        Host: "localhost",
        Origin: "http://localhost",
        Authorization: `Bearer ${key}`,
      },
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const sessionCookie = cookie.split(";")[0];
    const request = (origin?: string) =>
      app.request("http://localhost/api/tools/usage_get", {
        method: "POST",
        headers: {
          Host: "localhost",
          Cookie: sessionCookie,
          "Content-Type": "application/json",
          ...(origin ? { Origin: origin } : {}),
        },
        body: "{}",
      });
    expect((await request("http://localhost")).status).toBe(200);
    expect((await request()).status).toBe(403);
    const principal = await service.authenticate(key);
    await service.revokeKey(principal, principal.keyId);
    expect((await request("http://localhost")).status).toBe(401);
  });
});

it("delivers only a completed job's media through expiring, revocable links with byte ranges", async () => {
  const first = await create();
  const pending = await call("workspace_result", {
    jobId: first.jobId,
    purpose: "preview",
  });
  expect(pending.status).toBe(200);
  expect(pending.result.status).toBe("queued");
  const principal = await service.authenticate(key);
  const asset = await service.registerAsset(
    principal.accountId,
    new Uint8Array([1, 2, 3, 4, 5]),
    {
      name: "result.mp4",
      kind: "video",
      mime: "video/mp4",
      metadata: { durationMs: 6000 },
      provenance: { evidence: "contract-mock" },
    },
  );
  await db.transaction(async (tx) => {
    const job = await tx.get(first.jobId);
    await tx.put({ ...job!, status: "completed", outputs: [asset.id] });
  });
  const result = (
    await call("workspace_result", { jobId: first.jobId, purpose: "preview" })
  ).result;
  expect(result.media[0].mimeType).toBe("video/mp4");
  const path = new URL(result.media[0].url).pathname;
  const media = await app.request(`http://localhost${path}`, {
    headers: { Host: "localhost", Range: "bytes=1-3" },
  });
  expect(media.status).toBe(206);
  expect(media.headers.get("content-range")).toBe("bytes 1-3/5");
  expect([...new Uint8Array(await media.arrayBuffer())]).toEqual([2, 3, 4]);
  const wrong = await app.request(
    `http://localhost${path.replace(asset.id, "another-asset")}`,
    { headers: { Host: "localhost" } },
  );
  expect(wrong.status).toBe(404);
  expect(
    (await call("delivery_revoke", { grantId: result.grantId })).status,
  ).toBe(200);
  expect(
    (
      await app.request(`http://localhost${path}`, {
        headers: { Host: "localhost" },
      })
    ).status,
  ).toBe(401);
});
