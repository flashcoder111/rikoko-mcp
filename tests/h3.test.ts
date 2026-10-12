import { expect, it } from "vitest";
import { FalProvider } from "../packages/providers/src/index.js";
import { h3Models } from "../packages/providers/src/h3.js";
it("locks H3 generation to a reviewed five-second price profile and the official endpoint", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const provider = new FalProvider(
    h3Models,
    "test-only-key",
    true,
    async (url, options) => {
      calls.push({
        url: String(url),
        body: JSON.parse(options!.body as string),
      });
      return Response.json({
        request_id: "h3-test",
        status_url: "https://queue.fal.run/minimax/h3/requests/h3-test/status",
        response_url: "https://queue.fal.run/minimax/h3/requests/h3-test",
        cancel_url: "https://queue.fal.run/minimax/h3/requests/h3-test/cancel",
      });
    },
  );
  for (const profile of h3Models) {
    const input = {
      kind: "generate" as const,
      model: profile.id,
      prompt: "An original cinematic basketball shot",
      parameters: {},
    };
    expect(provider.estimate(input).maxCents).toBe(30);
    await provider.submit(input);
    expect(calls.at(-1)).toMatchObject({
      url: "https://queue.fal.run/minimax/h3/text-to-video",
      body: {
        duration: 5,
        resolution: "768P",
        aspect_ratio: profile.parameters.aspect_ratio,
        enable_safety_checker: true,
      },
    });
    expect(() =>
      provider.validate({ ...input, parameters: { duration: 15 } }),
    ).toThrow();
  }
  expect(new FalProvider(h3Models).describe().every((m) => !m.available)).toBe(
    true,
  );
});
