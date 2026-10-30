import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SeeApiProvider,
  SEEAPI_CONNECTION,
  SEEAPI_ORIGIN,
} from "../packages/providers/src/seeapi.js";
import {
  SubmissionUnknown,
  type Model,
} from "../packages/providers/src/index.js";
import { validateGenerationAssets } from "../packages/providers/src/generation-input.js";
import type { Operation, Entity } from "../packages/contracts/src/index.js";

const model: Model = {
  id: "seeapi-seedance-mini",
  kind: "video",
  endpoint: "seeapi/seedance-2-mini/text-to-video",
  maxCostCents: 5000,
  priceVersion: "test",
  hardBoundConfirmed: true,
  parameters: {
    duration: 5,
    resolution: "720p",
    aspect_ratio: "16:9",
    generate_audio: true,
  },
  allowedParameters: { duration: { type: "integer", min: 4, max: 15 } },
};
const input: Extract<Operation, { kind: "generate" }> = {
  kind: "generate",
  model: model.id,
  parameters: {},
  prompt: "A ceramic cup rotates",
  videoPolicy: { faces: "absent", reason: "Objects only", references: [] },
};
const url = `${SEEAPI_ORIGIN}/v1/generations/task_123`;
const ticket = {
  connectionId: SEEAPI_CONNECTION,
  connectionVersion: SEEAPI_ORIGIN,
  requestId: "task_123",
  statusUrl: url,
  resultUrl: url,
  cancelUrl: "",
};
function result(status = "processing", endpoint = "text-to-video") {
  return {
    generation: {
      id: ticket.requestId,
      model: "seedance-2-mini",
      endpoint,
      provider: "seeapi",
      status,
      consumed_credits: 100,
      result: {
        assets: [
          { type: "image", url: "https://cdn.example/poster.jpg" },
          { type: "video", url: "https://cdn.example/video.mp4" },
        ],
      },
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("SeeAPI Seedance Mini", () => {
  it("uses documented fields, server auth, and stable per-job idempotency", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(result(), { status: 202 }),
    );
    const provider = new SeeApiProvider([model], "test-secret", true, fetcher);
    expect(
      await provider.submit(input, undefined, undefined, undefined, {
        idempotencyKey: "job_123",
      }),
    ).toEqual(ticket);
    const [target, request] = fetcher.mock.calls[0];
    expect(target).toBe(SEEAPI_ORIGIN + "/v1/generations");
    expect(request).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer test-secret",
        "Idempotency-Key": "rikoko-job_123",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(request!.body as string)).toEqual({
      model: "seedance-2-mini",
      endpoint: "text-to-video",
      provider: "seeapi",
      input: {
        prompt: input.prompt,
        duration_seconds: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
        generate_audio: true,
        web_search: false,
        nsfw_checker: true,
      },
    });
    expect(JSON.stringify(provider.describe())).not.toContain("test-secret");
  });
  it("replays the identical body and key once after response loss", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(Error("private transport"))
      .mockResolvedValueOnce(Response.json(result()));
    const provider = new SeeApiProvider([model], "key", true, fetcher);
    expect(
      await provider.submit(input, undefined, undefined, undefined, {
        idempotencyKey: "job",
      }),
    ).toEqual(ticket);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]!.body).toBe(fetcher.mock.calls[1][1]!.body);
    expect(fetcher.mock.calls[0][1]!.headers).toEqual(
      fetcher.mock.calls[1][1]!.headers,
    );
  });
  it.each([401, 402, 403, 429])(
    "does not retry definitive rejection %s or leak response bodies",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response("private details", { status }),
      );
      await expect(
        new SeeApiProvider([model], "key", true, fetcher).submit(input),
      ).rejects.toMatchObject({
        code: "PROVIDER_REJECTED",
        message: `SeeAPI rejected submission (${status})`,
      });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it.each([409, 302, 503])(
    "retains ambiguous submission %s without fresh idempotency",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response(null, { status }),
      );
      await expect(
        new SeeApiProvider([model], "key", true, fetcher).submit(
          input,
          undefined,
          undefined,
          undefined,
          { idempotencyKey: "job" },
        ),
      ).rejects.toMatchObject({
        code: "SUBMISSION_UNKNOWN",
        message: expect.stringContaining("rikoko-job"),
      });
      expect(fetcher).toHaveBeenCalledTimes(status === 503 ? 2 : 1);
    },
  );
  it("retains uncertainty when a retry is rejected", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(Error())
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(
      new SeeApiProvider([model], "key", true, fetcher).submit(input),
    ).rejects.toBeInstanceOf(SubmissionUnknown);
  });
  it("does not retry before a submission Retry-After cooldown", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 503, headers: { "Retry-After": "60" } }),
    );
    await expect(
      new SeeApiProvider([model], "key", true, fetcher).submit(input),
    ).rejects.toBeInstanceOf(SubmissionUnknown);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(["model", "endpoint", "provider", "id"])(
    "rejects malformed accepted task %s without exposing it",
    async (field) => {
      const value = result();
      Object.assign(value.generation, { [field]: "unexpected/private" });
      await expect(
        new SeeApiProvider([model], "key", true, async () =>
          Response.json(value),
        ).submit(input),
      ).rejects.toBeInstanceOf(SubmissionUnknown);
    },
  );
  it("rejects unsupported or missing settings before the network", async () => {
    const fetcher = vi.fn();
    for (const provider of [
      new SeeApiProvider([model], undefined, true, fetcher),
      new SeeApiProvider([model], "key", false, fetcher),
    ])
      await expect(provider.submit(input)).rejects.toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
      });
    const provider = new SeeApiProvider([model], "key", true, fetcher);
    for (const faces of ["present", "unknown"] as const)
      expect(() => provider.validate({ ...input, videoPolicy: { ...input.videoPolicy!, faces } })).not.toThrow();
    for (const parameters of [
      { duration: 16 },
      { duration: -1 },
      { generate_audio: false },
      { provider: "byteplus" },
    ] as Record<string, string | number | boolean>[])
      await expect(
        provider.submit({ ...input, parameters }),
      ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
    await expect(
      provider.submit({ ...input, prompt: "hi" }),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("maps reference roles and first/last frames to the documented fields", async () => {
    for (const frames of [false, true]) {
      const roles = frames
        ? (["first_frame", "last_frame"] as const)
        : (["product", "motion"] as const);
      const refs = roles.map((role, i) => ({
        role,
        assetId: `ref${i}`,
        url: `https://media.example/${i}`,
      }));
      const profile: Model = {
        ...model,
        endpoint: `seeapi/seedance-2-mini/${frames ? "image" : "reference"}-to-video`,
        generationInput: {
          mode: frames ? "first_last_frame" : "reference_to_video",
          maxTotalBytes: 1000,
          outputDurationMs: 5000,
          bindings: roles.map((role) => ({
            field: role,
            roles: [role],
            kind: role === "motion" ? "video" : "image",
            array: !frames,
            min: 1,
            max: 1,
            maxBytes: 1000,
          })),
        },
      };
      const op = {
        ...input,
        mode: profile.generationInput!.mode,
        references: refs.map(({ url: _url, ...ref }) => ref),
        videoPolicy: {
          ...input.videoPolicy!,
          references: refs.map((r) => ({
            assetId: r.assetId,
            sha256: "a".repeat(64),
            faces: "absent" as const,
            reason: "Object",
          })),
        },
      };
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json(
          result(
            "processing",
            frames ? "image-to-video" : "reference-to-video",
          ),
        ),
      );
      const provider = new SeeApiProvider([profile], "key", true, fetcher);
      await provider.submit(op, undefined, refs);
      expect(
        JSON.parse(fetcher.mock.calls[0][1]!.body as string).input,
      ).toMatchObject(
        frames
          ? { first_frame_image: refs[0].url, last_frame_image: refs[1].url }
          : { reference_images: [refs[0].url], reference_video: [refs[1].url] },
      );
      await expect(
        provider.submit(op, undefined, [...refs].reverse()),
      ).rejects.toThrow();
      await expect(
        provider.submit(
          op,
          undefined,
          refs.map((r) => ({ ...r, url: "http://unsafe.example/ref" })),
        ),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it.each(["failed", "canceled", "refunded", "expired", "succeeded"])(
    "handles terminal state %s",
    async (status) => {
      expect(
        await new SeeApiProvider([model], "key", true, async () =>
          Response.json(result(status)),
        ).poll(ticket),
      ).toBe(status === "succeeded" ? "completed" : "failed");
    },
  );
  it("backs off processing and honors Retry-After while preserving the task", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
      )
      .mockResolvedValueOnce(Response.json(result("succeeded")));
    const provider = new SeeApiProvider([model], "key", true, fetcher);
    expect(await provider.poll(ticket)).toBe("pending");
    await vi.advanceTimersByTimeAsync(30000);
    expect(await provider.poll(ticket)).toBe("pending");
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(31000);
    expect(await provider.poll(ticket)).toBe("completed");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("times out waiting without making a new submission", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(result()));
    const provider = new SeeApiProvider([model], "key", true, fetcher);
    await provider.poll(ticket);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    await expect(provider.poll(ticket)).rejects.toMatchObject({
      code: "PROVIDER_POLL_TIMEOUT",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects forged tickets and mismatched status responses", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        ...result(),
        generation: { ...result().generation, id: "other" },
      }),
    );
    const provider = new SeeApiProvider([model], "key", true, fetcher);
    await expect(
      provider.poll({ ...ticket, statusUrl: "https://evil.example/" }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(provider.poll(ticket)).rejects.toMatchObject({
      code: "PROVIDER_RESULT_INVALID",
    });
  });
  it("selects video after inspecting the asset list and never converts credits to dollars", async () => {
    const provider = new SeeApiProvider([model], "key", false, async () =>
      Response.json(result("succeeded")),
    );
    expect(await provider.collect(ticket, input)).toEqual({
      kind: "video",
      url: "https://cdn.example/video.mp4",
      costCents: null,
    });
    await expect(
      provider.collect(ticket, { ...input, model: "other" }),
    ).rejects.toThrow();
  });
  it("rejects ambiguous multi-video output and unsafe URLs", async () => {
    for (const assets of [
      [{ type: "video", url: "http://bad.example/v.mp4" }],
      [
        ...result().generation.result.assets,
        { type: "video", url: "https://cdn.example/other.mp4" },
      ],
    ]) {
      const value = result("succeeded");
      value.generation.result.assets = assets;
      await expect(
        new SeeApiProvider([model], "key", true, async () =>
          Response.json(value),
        ).collect(ticket, input),
      ).rejects.toThrow();
    }
  });
  it("never invents cancellation or refund support", async () => {
    const fetcher = vi.fn();
    expect(
      await new SeeApiProvider([model], "key", true, fetcher).cancel(ticket),
    ).toEqual({ accepted: false, refunded: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("validates measured pixel/ratio/frame-rate bounds before generation", () => {
    const profile: Model = {
      ...model,
      generationInput: {
        mode: "reference_to_video",
        maxTotalBytes: 1000,
        outputDurationMs: 5000,
        bindings: [
          {
            field: "reference_video",
            roles: ["motion"],
            kind: "video",
            array: true,
            min: 1,
            max: 1,
            maxBytes: 1000,
            minPixels: 409600,
            maxPixels: 927408,
            minAspectRatio: 0.4,
            maxAspectRatio: 2.5,
            minFps: 24,
            maxFps: 60,
          },
        ],
      },
    };
    const op = {
      ...input,
      mode: "reference_to_video" as const,
      references: [{ assetId: "r", role: "motion" as const }],
    };
    const asset: Entity = {
      id: "r",
      type: "asset",
      accountId: "owner",
      createdAt: "now",
      kind: "video",
      mime: "video/mp4",
      bytes: 100,
      metadata: { width: 1280, height: 720, fps: 30, durationMs: 5000 },
    };
    expect(() => validateGenerationAssets(profile, op, [asset])).not.toThrow();
    for (const metadata of [
      { ...asset.metadata, fps: 23 },
      { ...asset.metadata, fps: undefined },
      { ...asset.metadata, width: 640, height: 480 },
      { ...asset.metadata, width: 1500, height: 500 },
    ])
      expect(() =>
        validateGenerationAssets(profile, op, [{ ...asset, metadata }]),
      ).toThrow();
  });
});
