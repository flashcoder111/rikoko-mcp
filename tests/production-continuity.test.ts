import { expect, it } from "vitest";
import {
  assertPreviousEndAnchor,
  continuityCutIssue,
} from "../packages/core/src/production-continuity.js";
const source: any = {
  id: "video",
  kind: "video",
  sha256: "source-sha",
  metadata: { fps: 24 },
};
const frame: any = {
  id: "frame",
  sha256: "frame-sha",
  provenance: {
    source: "media-inspect",
    sourceAssetId: "video",
    sourceSha256: "source-sha",
    requestedTimeMs: 2960,
  },
};
const scene = {
  assetId: "video",
  durationMs: 3000,
  sourceStartMs: 0,
  speed: 1,
};
it("accepts the retained endpoint but rejects a discarded full-clip tail", () => {
  expect(continuityCutIssue(frame, source, scene)).toBeUndefined();
  expect(
    continuityCutIssue(
      { ...frame, provenance: { ...frame.provenance, requestedTimeMs: 4360 } },
      source,
      scene,
    ),
  ).toContain("retained endpoint");
  expect(
    continuityCutIssue(frame, source, { ...scene, durationMs: 2000 }),
  ).toContain("retained endpoint");
});
it("accounts for source offsets and playback speed, and rejects a different source", () => {
  expect(
    continuityCutIssue(frame, source, {
      ...scene,
      sourceStartMs: 1000,
      durationMs: 1000,
      speed: 2,
    }),
  ).toBeUndefined();
  expect(
    continuityCutIssue(frame, source, { ...scene, assetId: "different" }),
  ).toContain("selected source");
  expect(
    continuityCutIssue(
      { ...frame, provenance: { ...frame.provenance, requestedTimeMs: 3000 } },
      source,
      scene,
    ),
  ).toContain("retained endpoint");
});
function fixture() {
  const records: any[] = [
    source,
    structuredClone(frame),
    {
      id: "inspection",
      type: "media-inspection",
      assetId: "video",
      sourceSha256: "source-sha",
      frames: [
        { assetId: "frame", sha256: "frame-sha", requestedTimeMs: 2960 },
      ],
    },
    {
      id: "job",
      type: "job",
      status: "completed",
      outputs: ["video"],
      input: { production: { projectId: "project", shotId: "previous" } },
    },
  ];
  const tx: any = {
    get: async (id: string) => records.find((r) => r.id === id),
    list: async (_account: string, type: string) =>
      records.filter((r) => r.type === type),
  };
  const plan: any = {
    shots: [
      {
        id: "next",
        process: {
          stateAnchor: {
            mode: "previous_end",
            assetId: "frame",
            previousShotId: "previous",
          },
        },
      },
    ],
  };
  return { records, tx, plan };
}
it("requires server inspection provenance, not a handwritten previous_end claim", async () => {
  const { records, tx, plan } = fixture();
  await expect(
    assertPreviousEndAnchor(tx, "account", plan, "next", "project"),
  ).resolves.toBeUndefined();
  records.find((r) => r.id === "frame").provenance.source = "file-import";
  await expect(
    assertPreviousEndAnchor(tx, "account", plan, "next", "project"),
  ).rejects.toMatchObject({ code: "CONTINUITY_FRAME_REQUIRED" });
});
it("requires the actual preceding shot, even for a genuine extracted frame", async () => {
  const { tx, plan } = fixture();
  await expect(
    assertPreviousEndAnchor(tx, "account", plan, "next", "other-project"),
  ).rejects.toMatchObject({ code: "CONTINUITY_SOURCE_MISMATCH" });
});
