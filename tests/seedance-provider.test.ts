import { describe, expect, it, vi } from "vitest";
import {
  SeedanceProvider,
  SEEDANCE_ORIGIN,
} from "../packages/providers/src/seedance.js";
import {
  SubmissionUnknown,
  type Model,
} from "../packages/providers/src/index.js";
import { seedanceMiniModels } from "../packages/providers/src/seedance-mini.js";
import type { Operation } from "../packages/contracts/src/index.js";

const model = { ...seedanceMiniModels[0], hardBoundConfirmed: true };
const input: Extract<Operation, { kind: "generate" }> = {
  kind: "generate",
  parameters: {},
  model: model.id,
  prompt: "A ceramic cup rotates",
  videoPolicy: { faces: "absent", reason: "Object only", references: [] },
};
const url = `${SEEDANCE_ORIGIN}/api/v3/contents/generations/tasks/cgt-test_123`;
const ticket = {
  connectionId: "seedance-official-v3",
  connectionVersion: SEEDANCE_ORIGIN,
  requestId: "cgt-test_123",
  statusUrl: url,
  resultUrl: url,
  cancelUrl: url,
};
const result = (status = "succeeded") => ({
  id: ticket.requestId,
  model: "doubao-seedance-2-0-mini-260615",
  status,
  content: { video_url: "https://cdn.example/video.mp4" },
  usage: { completion_tokens: 123456 },
});

describe("official Seedance", () => {
  it("submits the pinned model with Ark auth and only official parameters", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ id: ticket.requestId }),
    );
    const provider = new SeedanceProvider(
      [model],
      "test-secret",
      true,
      fetcher,
    );
    expect(await provider.submit(input)).toEqual(ticket);
    const [requestUrl, options] = fetcher.mock.calls[0];
    expect(requestUrl).toBe(
      `${SEEDANCE_ORIGIN}/api/v3/contents/generations/tasks`,
    );
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(JSON.parse(options!.body as string)).toEqual({
      model: "doubao-seedance-2-0-mini-260615",
      content: [{ type: "text", text: input.prompt }],
      duration: 5,
      resolution: "720p",
      ratio: "16:9",
      generate_audio: true,
      watermark: false,
    });
  });
  it.each([408, 500, 503])(
    "does not retry uncertain HTTP %s",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response(null, { status }),
      );
      await expect(
        new SeedanceProvider([model], "key", true, fetcher).submit(input),
      ).rejects.toBeInstanceOf(SubmissionUnknown);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("keeps network loss and malformed success ambiguous, without leaking response details", async () => {
    for (const fetcher of [
      vi.fn(async () => {
        throw Error("secret transport");
      }),
      vi.fn(async () => Response.json({ id: "../bad" })),
    ]) {
      await expect(
        new SeedanceProvider([model], "key", true, fetcher).submit(input),
      ).rejects.toBeInstanceOf(SubmissionUnknown);
      expect(fetcher).toHaveBeenCalledOnce();
    }
    await expect(
      new SeedanceProvider(
        [model],
        "key",
        true,
        async () => new Response("private error", { status: 403 }),
      ).submit(input),
    ).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
      message: "Seedance rejected submission (403)",
    });
  });
  it("accepts unreviewed scenes but rejects missing credentials and unsupported duration", async () => {
    const fetcher = vi.fn();
    for (const provider of [
      new SeedanceProvider([model], undefined, true, fetcher),
      new SeedanceProvider([model], "key", false, fetcher),
    ])
      await expect(provider.submit(input)).rejects.toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
      });
    const provider = new SeedanceProvider([model], "key", true, fetcher);
    for (const faces of ["present", "unknown"] as const)
      expect(() => provider.validate({ ...input, videoPolicy: { ...input.videoPolicy!, faces } })).not.toThrow();
    await expect(
      provider.submit({ ...input, parameters: { duration: "3" } }),
    ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["mini", "2.5"])(
    "maps ordered %s references with the official task type and checks delivery",
    async (version) => {
      const profile = {
        ...seedanceMiniModels[3],
        hardBoundConfirmed: true,
        ...(version === "2.5"
          ? { endpoint: "bytedance/seedance-2.5/us/reference-to-video" }
          : {}),
      };
      const references = [
        { assetId: "cup", role: "product" as const },
        { assetId: "motion", role: "motion" as const },
      ];
      const op: Operation = {
        ...input,
        model: profile.id,
        mode: "reference_to_video",
        references,
        videoPolicy: {
          ...input.videoPolicy!,
          references: references.map((r) => ({
            assetId: r.assetId,
            sha256: "a".repeat(64),
            faces: "absent",
            reason: "Object",
          })),
        },
      };
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json({ id: ticket.requestId }),
      );
      const provider = new SeedanceProvider([profile], "key", true, fetcher);
      const resolved = references.map((r) => ({
        ...r,
        url: `https://media.example/${r.assetId}`,
      }));
      await provider.submit(op, undefined, resolved);
      const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
      expect(body.omni_reference_task_type).toBe(
        version === "2.5" ? "reference" : undefined,
      );
      expect(body.content.slice(1)).toEqual([
        {
          type: "image_url",
          image_url: { url: resolved[0].url },
          role: "reference_image",
        },
        {
          type: "video_url",
          video_url: { url: resolved[1].url },
          role: "reference_video",
        },
      ]);
      await expect(
        provider.submit(op, undefined, [...resolved].reverse()),
      ).rejects.toMatchObject({ code: "INVALID_MODEL_INPUT" });
      await expect(
        provider.submit(op, undefined, [
          { ...resolved[0], url: "data:image/png;base64,YQ==" },
          resolved[1],
        ]),
      ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("uses Seedance 2.5 and adaptive first/last-frame ratio", async () => {
    const profile: Model = {
      ...seedanceMiniModels[2],
      endpoint: "bytedance/seedance-2.5/us/image-to-video",
      hardBoundConfirmed: true,
    };
    const references = [
      { assetId: "first", role: "first_frame" as const },
      { assetId: "last", role: "last_frame" as const },
    ];
    const op: Operation = {
      ...input,
      model: profile.id,
      mode: "first_last_frame",
      references,
      videoPolicy: {
        ...input.videoPolicy!,
        references: references.map((r) => ({
          assetId: r.assetId,
          sha256: "a".repeat(64),
          faces: "absent",
          reason: "Object",
        })),
      },
    };
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ id: ticket.requestId }),
    );
    await new SeedanceProvider([profile], "key", true, fetcher).submit(
      op,
      undefined,
      references.map((r) => ({
        ...r,
        url: `https://media.example/${r.assetId}`,
      })),
    );
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({
      model: "doubao-seedance-2-5-260628",
      ratio: "adaptive",
      content: [
        { type: "text" },
        { role: "first_frame" },
        { role: "last_frame" },
      ],
    });
  });
  it("rejects forged tickets before sending credentials", async () => {
    const fetcher = vi.fn();
    const provider = new SeedanceProvider([model], "key", true, fetcher);
    for (const change of [
      { statusUrl: "https://evil.example" },
      { connectionVersion: "https://evil.example" },
      { requestId: "../123" },
    ])
      await expect(
        provider.poll({ ...ticket, ...change }),
      ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ["queued", "pending"],
    ["running", "pending"],
    ["succeeded", "completed"],
    ["failed", "failed"],
    ["cancelled", "failed"],
    ["expired", "failed"],
  ])("maps %s to %s", async (status, expected) => {
    expect(
      await new SeedanceProvider([model], "key", true, async () =>
        Response.json(result(status)),
      ).poll(ticket),
    ).toBe(expected);
  });
  it("collects accepted work even after paid submissions are disabled without treating CNY as USD", async () => {
    const provider = new SeedanceProvider([model], "key", false, async () =>
      Response.json(result()),
    );
    expect(await provider.collect(ticket, input)).toEqual({
      kind: "video",
      url: "https://cdn.example/video.mp4",
      costCents: null,
    });
    for (const change of [
      { id: "different" },
      { model: "other" },
      { content: { video_url: "http://unsafe.example" } },
    ])
      await expect(
        new SeedanceProvider([model], "key", true, async () =>
          Response.json({ ...result(), ...change }),
        ).collect(ticket, input),
      ).rejects.toThrow();
  });
  it("cancels queued tasks only and confirms the cancelled status", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(result("queued")))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json(result("cancelled")));
    expect(
      await new SeedanceProvider([model], "key", true, fetcher).cancel(ticket),
    ).toEqual({ accepted: true, refunded: false });
    expect(fetcher.mock.calls[1][1]?.method).toBe("DELETE");
    for (const status of ["running", "succeeded", "failed"]) {
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json(result(status)),
      );
      expect(
        await new SeedanceProvider([model], "key", true, fetcher).cancel(
          ticket,
        ),
      ).toEqual({ accepted: false, refunded: false });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
});
