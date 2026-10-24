import { expect, it } from "vitest";
import { cloudRequest } from "../packages/cloud-client/src/http.js";
it("preserves public generation trace IDs without forwarding arbitrary upstream details", async () => {
  await expect(
    cloudRequest(
      "https://cloud.example",
      "/v1/generation-preparations",
      async () =>
        Response.json(
          {
            error: {
              code: "VIDEO_ANALYSIS_REQUIRED",
              message: "Analyze first",
              details: {
                stage: "analysis",
                generationTraceId: "trace-1",
                privateCredential: "must-not-escape",
              },
            },
          },
          { status: 409 },
        ),
      { key: "fixture", body: {} },
    ),
  ).rejects.toMatchObject({
    code: "VIDEO_ANALYSIS_REQUIRED",
    details: { stage: "analysis", generationTraceId: "trace-1" },
  });
});
