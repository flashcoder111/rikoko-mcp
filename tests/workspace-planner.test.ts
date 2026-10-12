import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compositionSchema,
  type Entity,
} from "../packages/contracts/src/index.js";
import {
  planRequest,
  plannerConfigured,
} from "../packages/core/src/workspace-planner.js";
const revision: Entity = {
  id: "r",
  accountId: "a",
  type: "revision",
  createdAt: "now",
  composition: compositionSchema.parse({
    schemaVersion: 1,
    title: "Plan",
    width: 360,
    height: 640,
    language: "zh",
    scenes: [
      {
        id: "one",
        durationMs: 3000,
        text: "你好世界",
        words: [
          { id: "hello", text: "你好", startMs: 0, endMs: 1000 },
          { id: "world", text: "世界", startMs: 1500, endMs: 2500 },
        ],
      },
      { id: "two", durationMs: 3000 },
    ],
    audio: { assetId: "music", gain: 0.5 },
  }),
};
const image: Entity = {
  id: "photo",
  accountId: "a",
  type: "asset",
  createdAt: "now",
  kind: "image",
  name: "image",
  metadata: {},
};
const plan = (
  message: string,
  selectedSceneId?: string,
  assets: Entity[] = [],
) =>
  planRequest(
    { message, selectedSceneId, assetIds: assets.map((a) => a.id) },
    revision,
    assets,
  );
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("local explicit instructions", () => {
  it.each([
    ["删除最后一个镜头", "delete"],
    ["删除第一个镜头", "delete"],
    ["delete scene 2", "delete"],
    ["第二个镜头字幕改成：新字幕", "caption"],
    ["字幕大一点", "style"],
    ["字幕小一点", "style"],
    ["字幕大小改成 32", "style"],
    ["背景音乐小一点", "music"],
    ["关闭背景音乐", "music"],
    ["改成横屏", "format"],
    ["改成竖屏", "format"],
    ["第一个镜头保留 0 到 2 秒", "trim"],
    ["第一个镜头在 1 秒分割", "split"],
    ["第二个镜头移到开头", "move"],
    ["第一个镜头移到结尾", "move"],
    ["第一个镜头静音", "scene_audio"],
  ])(
    "turns %s into a reviewable edit without rendering",
    async (text, type) => {
      const result = await plan(text);
      expect(result.engine).toBe("local-commands");
      expect(result.action?.type).toBe("edit");
      if (result.action?.type === "edit")
        expect(result.action.edits[0].type).toBe(type);
    },
  );
  it("resolves explicit selection and uploaded visual/audio references", async () => {
    expect((await plan("第一个镜头移到结尾")).action).toMatchObject({
      edits: [{ sceneId: "one", toIndex: 1 }],
    });
    expect((await plan("第一个镜头字幕改成：最后一刻")).action).toMatchObject({
      edits: [{ sceneId: "one", text: "最后一刻" }],
    });
    expect((await plan("删除当前镜头", "one")).action).toMatchObject({
      edits: [{ sceneId: "one" }],
    });
    expect(
      (await plan("第一个镜头换成这张图", undefined, [image])).action,
    ).toMatchObject({ edits: [{ type: "visual", assetId: "photo" }] });
    expect(
      (
        await plan("使用这段音乐", undefined, [
          { ...image, id: "music", kind: "audio" },
        ])
      ).action,
    ).toMatchObject({ edits: [{ type: "music", assetId: "music" }] });
    expect((await plan("删除“你好”", "one")).action).toMatchObject({
      edits: [{ type: "delete_words", wordIds: ["hello"] }],
    });
  });
  it("does not partly execute compound instructions or guess missing references", async () => {
    expect((await plan("删除最后一个镜头，字幕大一点")).action).toMatchObject({
      edits: [{ type: "delete" }, { type: "style" }],
    });
    for (const text of [
      "删除最后一个镜头，替我拍一个海滩",
      "删除第九个镜头",
      "删除当前镜头",
      "第一个镜头换成这张图",
      "删除“找不到的句子”",
      "换成音乐",
      "替换人物脸部",
    ])
      expect((await plan(text)).action).toBeUndefined();
  });
  it("makes local script cards and preserves attached source durations without claiming generated footage", async () => {
    const script = await planRequest(
      { message: "制作 6 秒横屏短片。脚本：first;second\nthird", assetIds: [] },
      undefined,
      [],
    );
    expect(script.action?.type).toBe("create");
    expect(script.message).toContain("文字卡片");
    if (script.action?.type === "create")
      expect(script.action.composition.width).toBe(640);
    const video = {
      ...image,
      id: "video",
      kind: "video",
      metadata: { durationMs: 1500 },
    };
    const media = await planRequest(
      { message: "用这些素材制作 9 秒短片", assetIds: [video.id, image.id] },
      undefined,
      [video, image],
    );
    if (media.action?.type !== "create") throw Error("Missing composition");
    expect(media.action.composition.scenes[0]).toMatchObject({
      assetId: "video",
      durationMs: 1500,
    });
    expect(media.action.composition.scenes[1]).toMatchObject({
      assetId: "photo",
      durationMs: 4500,
    });
    expect(
      (
        await planRequest(
          { message: "做一个电影大片", assetIds: [] },
          undefined,
          [],
        )
      ).action,
    ).toBeUndefined();
  });
  it("uses a sole scene as the target but does not infer speech without alignment", async () => {
    const single = {
      ...revision,
      composition: {
        ...revision.composition,
        scenes: [{ ...revision.composition.scenes[0], words: undefined }],
      },
    };
    expect(
      (
        await planRequest(
          { message: "字幕改成：hello", assetIds: [] },
          single,
          [],
        )
      ).action,
    ).toMatchObject({ edits: [{ sceneId: "one", text: "hello" }] });
    expect(
      (await planRequest({ message: "删除“你好”", assetIds: [] }, single, []))
        .action,
    ).toBeUndefined();
  });
});
describe("optional model planner (mocked, no paid requests)", () => {
  function enable(url = "https://model.example.test/chat/completions") {
    vi.stubEnv("ENABLE_CREATIVE_AGENT", "true");
    vi.stubEnv("CREATIVE_AGENT_URL", url);
    vi.stubEnv("CREATIVE_AGENT_MODEL", "test-only");
  }
  it("is disabled by default and validates model output before exposing an actionable proposal", async () => {
    vi.stubEnv("ENABLE_CREATIVE_AGENT", "false");
    expect(plannerConfigured()).toBe(false);
    enable();
    vi.stubEnv("CREATIVE_AGENT_KEY", "test-placeholder");
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  message: "修改字幕",
                  action: {
                    type: "edit",
                    edits: [
                      {
                        type: "caption",
                        sceneId: "one",
                        text: "model proposal",
                      },
                    ],
                  },
                }),
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await plan("请把开头的文字换成 model proposal");
    expect(result.engine).toBe("configured-model");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(
      JSON.parse(fetcher.mock.calls[0][1].body).messages[1].content,
    ).toContain("你好世界");
  });
  it.each([
    "http://remote.example.test/api",
    "https://name:password@model.example.test/api",
  ])("rejects unsafe operator endpoint %s", async (url) => {
    enable(url);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(plan("需要模型理解的指令")).rejects.toMatchObject({
      code: "AGENT_CONFIG",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [new Response("provider error", { status: 500 }), "AGENT_UNAVAILABLE"],
    [new Response("x".repeat(150001)), "AGENT_OUTPUT"],
    [new Response("not json"), "AGENT_OUTPUT"],
    [
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  message: "bad",
                  action: { type: "create", composition: revision.composition },
                }),
              },
            },
          ],
        }),
      ),
      "AGENT_OUTPUT",
    ],
  ])("rejects provider failure or malformed plans", async (response, code) => {
    enable();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(plan("请自动理解这次修改")).rejects.toMatchObject({ code });
  });
  it("supports a local model and clarification without inventing actions", async () => {
    enable("http://127.0.0.1:8080/v1/chat/completions");
    vi.stubEnv("CREATIVE_AGENT_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ message: "请提供视频素材" }),
                },
              },
            ],
          }),
        ),
      ),
    );
    expect(
      (
        await planRequest(
          { message: "做一个产品视频", assetIds: [] },
          undefined,
          [],
        )
      ).action,
    ).toBeUndefined();
  });
});
