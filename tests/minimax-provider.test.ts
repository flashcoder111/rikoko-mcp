import { describe, expect, it, vi } from "vitest";
import { MiniMaxProvider } from "../packages/providers/src/minimax.js";
import {
  SubmissionUnknown,
  type Model,
} from "../packages/providers/src/index.js";
import type { Operation } from "../packages/contracts/src/index.js";

const model: Model = {
  id: "minimax-test",
  kind: "video",
  endpoint: "minimax/h3-max/text-to-video",
  maxCostCents: 3000,
  hardBoundConfirmed: true,
  priceVersion: "official-v1",
  parameters: {
    duration: 5,
    resolution: "768P",
    aspect_ratio: "16:9",
    prompt_expansion_mode: "disabled",
  },
  allowedParameters: { duration: { type: "integer", min: 5, max: 15 } },
};
const input = {
  kind: "generate",
  model: model.id,
  prompt: "A cup on a table",
} as Operation;
const ticket = {
  connectionId: "minimax-official-v2",
  connectionVersion: "https://api.minimax.cn",
  requestId: "123",
  statusUrl: "https://api.minimax.cn/v2/query/video_generation/123",
  resultUrl: "https://api.minimax.cn/v2/query/video_generation/123",
  cancelUrl: "https://api.minimax.cn/v2/video_generation/123",
};
describe("official MiniMax H3", () => {
  it("uses official CN auth and translates output controls without fal fields", async () => {
    const fetcher = vi.fn(async () => Response.json({ task_id: "123" }));
    const provider = new MiniMaxProvider([model], "test-secret", true, fetcher);
    expect(await provider.submit(input)).toEqual(ticket);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.minimax.cn/v2/video_generation");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-secret" });
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "MiniMax-H3-Max",
      content: [{ type: "text", text: "A cup on a table" }],
      duration: 5,
      resolution: "768P",
      ratio: "16:9",
      extra: { prompt_expansion_mode: "disabled" },
    });
  });
  it.each([408, 500, 503])(
    "treats uncertain HTTP %s as non-retryable submission",
    async (status) => {
      const provider = new MiniMaxProvider(
        [model],
        "key",
        true,
        async () => new Response("", { status }),
      );
      await expect(provider.submit(input)).rejects.toBeInstanceOf(
        SubmissionUnknown,
      );
    },
  );
  it("does not retry after transport loss or malformed success", async () => {
    for (const fetcher of [
      vi.fn(async () => {
        throw Error("network");
      }),
      vi.fn(async () => Response.json({})),
    ]) {
      await expect(
        new MiniMaxProvider([model], "key", true, fetcher).submit(input),
      ).rejects.toBeInstanceOf(SubmissionUnknown);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects invalid duration and disabled/missing credentials before network", async () => {
    const fetcher = vi.fn();
    for (const provider of [
      new MiniMaxProvider([model], undefined, true, fetcher),
      new MiniMaxProvider([model], "key", false, fetcher),
    ])
      await expect(provider.submit(input)).rejects.toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
      });
    await expect(
      new MiniMaxProvider([model], "key", true, fetcher).submit({
        ...input,
        parameters: { duration: 4 },
      } as Operation),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects untrusted region and altered tickets without sending credentials", async () => {
    const fetcher = vi.fn();
    expect(
      () =>
        new MiniMaxProvider(
          [model],
          "key",
          true,
          fetcher,
          "https://evil.example",
        ),
    ).toThrow();
    const provider = new MiniMaxProvider([model], "key", true, fetcher);
    await expect(
      provider.poll({ ...ticket, statusUrl: "https://evil.example/123" }),
    ).rejects.toThrow();
    await expect(
      provider.cancel({ ...ticket, requestId: "../123" }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("collects completed video without claiming CNY usage is USD cost", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        task: {
          id: "123",
          model: "MiniMax-H3-Max",
          status: "succeeded",
          content: { url: "https://cdn.example/video.mp4" },
        },
      }),
    );
    const provider = new MiniMaxProvider([model], "key", true, fetcher);
    expect(await provider.poll(ticket)).toBe("completed");
    expect(await provider.collect(ticket, input)).toEqual({
      kind: "video",
      url: "https://cdn.example/video.mp4",
      costCents: null,
    });
    expect(await provider.cancel(ticket)).toEqual({
      accepted: true,
      refunded: false,
    });
    expect(
      (fetcher.mock.calls[2] as unknown as [string, RequestInit])[1].method,
    ).toBe("DELETE");
  });
  it("maps bound images and motion to multimodal reference content", async () => {
    const refs = [
      { assetId: "photo", role: "character" as const },
      { assetId: "motion", role: "motion" as const },
    ];
    const profile: Model = {
      ...model,
      endpoint: "minimax/h3-max/reference-to-video",
      generationInput: {
        mode: "reference_to_video",
        outputDurationMs: 5000,
        maxTotalBytes: 40000000,
        bindings: [
          {
            field: "reference_image_urls",
            roles: ["character"],
            kind: "image",
            array: true,
            min: 1,
            max: 4,
            maxBytes: 10000000,
          },
          {
            field: "reference_video_urls",
            roles: ["motion"],
            kind: "video",
            array: true,
            min: 1,
            max: 1,
            maxBytes: 20000000,
          },
        ],
      },
    };
    const op = {
      ...input,
      mode: "reference_to_video",
      references: refs,
      videoPolicy: {
        faces: "absent",
        reason: "Synthetic object test",
        references: refs.map((r) => ({
          assetId: r.assetId,
          sha256: "a".repeat(64),
          faces: "absent",
          reason: "Synthetic object",
        })),
      },
    } as Operation;
    const fetcher = vi.fn(async () => Response.json({ task_id: "123" }));
    const provider = new MiniMaxProvider([profile], "key", true, fetcher);
    await provider.submit(
      op,
      undefined,
      refs.map((r) => ({ ...r, url: `https://r2.example/${r.assetId}` })),
    );
    const body = JSON.parse(
      (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(body.content.slice(1)).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://r2.example/photo" },
        role: "reference_image",
      },
      {
        type: "video_url",
        video_url: { url: "https://r2.example/motion" },
        role: "reference_video",
      },
    ]);
    await expect(
      provider.submit(
        op,
        undefined,
        refs
          .slice()
          .reverse()
          .map((r) => ({ ...r, url: `https://r2.example/${r.assetId}` })),
      ),
    ).rejects.toThrow();
  });
});
