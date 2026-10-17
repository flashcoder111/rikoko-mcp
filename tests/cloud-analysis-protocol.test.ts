import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { GatewayClient } from "../packages/cloud-client/src/gateway.js";
import { referenceOperationSchema } from "../packages/contracts/src/reference-analysis.js";

const protocol = {
  version: 1,
  reportSchemaVersion: 2,
  details: ["overview", "shots", "recreate"],
  focus: ["motion", "camera", "appearance", "text", "audio", "continuity"],
};
let db: Database, dir: string, service: Service, context: any, source: any;
beforeEach(async () => {
  db = await Database.open();
  dir = await mkdtemp(join(tmpdir(), "analysis-protocol-"));
  service = new Service(db, new LocalStorage(dir));
  context = await service.authenticate(
    (await service.createAccount("test", 0)).key,
  );
  source = await service.registerAsset(
    context.accountId,
    Buffer.from("video"),
    {
      name: "burger-reference",
      kind: "video",
      mime: "video/mp4",
      metadata: { durationMs: 3700, hasAudio: true },
      provenance: {},
    },
  );
});
afterEach(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
const input = () => ({
  kind: "reference_analyze",
  assetId: source.id,
  model: "gemini-reference",
  purpose: "remake",
  detail: "recreate",
  focus: ["motion", "camera", "continuity", "appearance"],
  language: "en",
});
function connection(advertised: unknown = protocol, available = true) {
  const paths: string[] = [];
  const operations: any[] = [];
  const fetcher = vi.fn(async (url: any, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path === "/v1/generation-models")
      return Response.json([
        {
          id: "gemini-reference",
          kind: "analysis",
          available,
          referenceAnalysis: advertised,
        },
        { id: "video", kind: "video", available: true },
      ]);
    if (path === "/v1/reference-uploads")
      return Response.json({ id: "upload" });
    if (path === "/v1/reference-uploads/upload")
      return Response.json({
        id: "remote-source",
        sha256: source.sha256,
        bytes: source.bytes,
      });
    if (path === "/v1/quotes") {
      const operation = JSON.parse(init!.body as string).input;
      operations.push(operation);
      // The deployed 0.1.12 schema rejects precisely these new fields.
      if (
        !advertised &&
        !referenceOperationSchema
          .omit({ detail: true, focus: true })
          .safeParse(operation).success
      )
        return Response.json(
          {
            error: { code: "INVALID_INPUT", message: "请求内容不符合接口要求" },
          },
          { status: 400 },
        );
      return Response.json({ id: "remote-quote", maxCents: 0 });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  return {
    gateway: new GatewayClient(
      service,
      "https://official.example",
      "test",
      fetcher,
    ),
    paths,
    operations,
  };
}

it("identifies the deployed legacy schema before uploading or requesting a quote", async () => {
  const { gateway, paths } = connection(null);
  await expect(gateway.quote(context, input())).rejects.toMatchObject({
    code: "ANALYSIS_PROTOCOL_MISMATCH",
    status: 409,
  });
  expect(paths).toEqual(["/v1/generation-models"]);
  expect(await service.list(context, "quote")).toHaveLength(0);
});

it("does not advertise an old analysis protocol as available or disable unrelated video models", async () => {
  const { gateway } = connection(null);
  expect(await gateway.models(context)).toMatchObject([
    {
      id: "gemini-reference",
      available: false,
      unavailableReason: "ANALYSIS_PROTOCOL_MISMATCH",
    },
    { id: "video", available: true },
  ]);
});

it.each([
  { ...protocol, version: 99 },
  { ...protocol, details: ["overview", "shots"] },
  { ...protocol, focus: ["motion"] },
])(
  "rejects incompatible advertised analysis capabilities without downgrading the request: %j",
  async (capabilities) => {
    const { gateway, paths } = connection(capabilities);
    await expect(gateway.quote(context, input())).rejects.toMatchObject({
      code: "ANALYSIS_PROTOCOL_MISMATCH",
    });
    expect(paths).toEqual(["/v1/generation-models"]);
  },
);

it("preserves all recreation fields and binds the uploaded source on a compatible cloud", async () => {
  const { gateway, paths, operations } = connection();
  const quote = await gateway.quote(context, input());
  expect(operations).toEqual([{ ...input(), assetId: "remote-source" }]);
  expect(quote.remoteInput).toEqual(operations[0]);
  expect(paths[0]).toBe("/v1/generation-models");
});

it("keeps unavailable provider configuration distinct from protocol incompatibility", async () => {
  const { gateway, paths } = connection(protocol, false);
  await expect(gateway.quote(context, input())).rejects.toMatchObject({
    code: "CAPABILITY_UNAVAILABLE",
  });
  expect(paths).toEqual(["/v1/generation-models"]);
});
