import { expect, it } from "vitest";
import { FalProvider } from "../packages/providers/src/index.js";
const model = {
  id: "test",
  endpoint: "fal-ai/test",
  kind: "image" as const,
  maxCostCents: 5,
  priceVersion: "v1",
  hardBoundConfirmed: true,
  parameters: { num_images: 1 },
};
const input = {
  kind: "generate" as const,
  model: "test",
  prompt: "Orbit",
  parameters: {},
};
const ticket = {
  requestId: "123",
  statusUrl: "https://queue.fal.run/fal-ai/test/requests/123/status",
  resultUrl: "https://queue.fal.run/fal-ai/test/requests/123",
  cancelUrl: "https://queue.fal.run/fal-ai/test/requests/123/cancel",
};
it("treats COMPLETED with an upstream error as failed", async () => {
  const p = new FalProvider([model], "fake", true, async () =>
    Response.json({ status: "COMPLETED", error: "generation failed" }),
  );
  expect(await p.poll(ticket)).toBe("failed");
});
it("submits one fixed-parameter request, polls, collects and reports cancellation without promising refund", async () => {
  const calls: any[] = [];
  const provider = new FalProvider(
    [model],
    "fake",
    true,
    async (url, options) => {
      calls.push({ url, options });
      if (String(url).endsWith("/status"))
        return Response.json({ status: "COMPLETED" });
      if (String(url).endsWith("/cancel"))
        return Response.json({ status: "CANCELLATION_REQUESTED" });
      if (options?.method === "POST")
        return Response.json({
          request_id: "123",
          status_url: ticket.statusUrl,
          response_url: ticket.resultUrl,
          cancel_url: ticket.cancelUrl,
        });
      return Response.json({
        images: [{ url: "https://media.fal.media/test.png" }],
      });
    },
  );
  expect(await provider.submit(input)).toEqual(ticket);
  expect(await provider.poll(ticket)).toBe("completed");
  expect(await provider.collect(ticket, input)).toEqual({
    url: "https://media.fal.media/test.png",
    kind: "image",
    costCents: null,
  });
  expect(await provider.cancel(ticket)).toEqual({
    accepted: true,
    refunded: false,
  });
  expect(calls.filter((c) => c.options.method === "POST")).toHaveLength(1);
  expect(JSON.parse(calls[0].options.body)).toEqual({
    num_images: 1,
    prompt: "Orbit",
  });
  expect(provider.describe()[0].available).toBe(true);
});
it.each(["FAILED", "IN_QUEUE", "IN_PROGRESS"])(
  "handles provider state %s",
  async (status) => {
    const p = new FalProvider([model], "fake", true, async () =>
      Response.json({ status }),
    );
    expect(await p.poll(ticket)).toBe(
      status === "FAILED" ? "failed" : "pending",
    );
  },
);
it("rejects untrusted URLs before sending credentials and malformed accepted responses remain unknown", async () => {
  const p = new FalProvider([model], "fake", true, async () =>
    Response.json({
      request_id: "x",
      status_url: "https://evil.test",
      response_url: ticket.resultUrl,
      cancel_url: ticket.cancelUrl,
    }),
  );
  await expect(p.submit(input)).rejects.toMatchObject({
    code: "SUBMISSION_UNKNOWN",
  });
  await expect(
    p.poll({ ...ticket, statusUrl: "http://queue.fal.run/anything" }),
  ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
});
it.each([500, 503])("keeps HTTP %d submission ambiguity", async (status) => {
  const p = new FalProvider(
    [model],
    "fake",
    true,
    async () => new Response("{}", { status }),
  );
  await expect(p.submit(input)).rejects.toMatchObject({
    code: "SUBMISSION_UNKNOWN",
  });
});
it("validates provider configuration and result errors", async () => {
  for (const m of [
    { ...model, endpoint: "../bad" },
    { ...model, maxCostCents: -1 },
  ]) {
    const p = new FalProvider([m], "fake", true);
    expect(() => p.estimate(input)).toThrow();
  }
  const p = new FalProvider([model], "fake", true, async () =>
    Response.json({}),
  );
  expect(() =>
    p.validate({
      kind: "tts",
      engine: "fal",
      model: "test",
      language: "en",
      text: "hello",
      voice: "default",
    }),
  ).toThrow();
  await expect(p.collect(ticket, input)).rejects.toMatchObject({
    code: "PROVIDER_RESULT_INVALID",
  });
  const error = new FalProvider(
    [model],
    "fake",
    true,
    async () => new Response("{}", { status: 503 }),
  );
  await expect(error.poll(ticket)).rejects.toMatchObject({
    code: "PROVIDER_POLL_FAILED",
  });
  await expect(error.collect(ticket, input)).rejects.toMatchObject({
    code: "PROVIDER_RESULT_FAILED",
  });
  expect(await error.cancel(ticket)).toEqual({
    accepted: false,
    refunded: false,
  });
  const audio = new FalProvider(
    [{ ...model, kind: "audio" }],
    "fake",
    true,
    async () =>
      Response.json({
        request_id: "123",
        status_url: ticket.statusUrl,
        response_url: ticket.resultUrl,
        cancel_url: ticket.cancelUrl,
      }),
  );
  await expect(
    audio.submit({
      kind: "tts",
      engine: "fal",
      model: "test",
      language: "en",
      voice: "default",
      text: "hello",
    }),
  ).resolves.toEqual(ticket);
});

it("validates structured reference analysis and translated text from configured models", async () => {
  const analysis = {
    schemaVersion: 1,
    summary: "A visible bottle",
    observations: [
      { startMs: 0, endMs: 1000, observation: "Product on a table" },
    ],
  };
  const reference = new FalProvider(
    [{ ...model, kind: "analysis", responseField: "output" }],
    "fake",
    true,
    async (_url, options) =>
      options?.method === "POST"
        ? Response.json({
            request_id: "123",
            status_url: ticket.statusUrl,
            response_url: ticket.resultUrl,
            cancel_url: ticket.cancelUrl,
          })
        : Response.json({ output: JSON.stringify(analysis) }),
  );
  const op = { kind: "analyze" as const, assetId: "owned", model: "test" };
  await expect(reference.submit(op)).rejects.toMatchObject({
    code: "CAPABILITY_UNAVAILABLE",
  });
  await expect(
    reference.submit(
      op,
      "https://owned-bucket.example.com/short-lived-reference",
    ),
  ).resolves.toEqual(ticket);
  expect(await reference.collect(ticket, op)).toEqual({
    kind: "analysis",
    data: analysis,
    costCents: null,
  });
  const translation = new FalProvider(
    [{ ...model, kind: "translation" }],
    "fake",
    true,
    async () =>
      Response.json({
        output: { schemaVersion: 1, language: "zh", text: "保持轻盈" },
      }),
  );
  expect(
    (
      await translation.collect(ticket, {
        kind: "translate",
        model: "test",
        text: "Stay light",
        language: "zh",
      })
    ).kind,
  ).toBe("translation");
  await expect(
    translation.collect(ticket, {
      kind: "translate",
      model: "test",
      text: "Stay light",
      language: "fr",
    }),
  ).rejects.toMatchObject({ code: "PROVIDER_RESULT_INVALID" });
  const invalid = new FalProvider(
    [{ ...model, kind: "analysis" }],
    "fake",
    true,
    async () => Response.json({ output: "not-json" }),
  );
  await expect(invalid.collect(ticket, op)).rejects.toMatchObject({
    code: "PROVIDER_RESULT_INVALID",
  });
  expect(() => reference.validate(input)).toThrow();
});
