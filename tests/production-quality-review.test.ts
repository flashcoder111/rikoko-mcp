import { describe, expect, it } from "vitest";
import {
  productionReviewObligations,
  productionQualityAccepted,
  validateProductionQualityReview,
} from "../packages/core/src/production-quality-review.js";

const plan: any = {
  process: { version: 1, objects: [{ id: "lid", label: "Lid" }] },
  shots: [
    {
      id: "close",
      durationMs: 2000,
      process: {
        operations: [
          { id: "lower", timing: { hold: { startMs: 1600, endMs: 2000 } } },
        ],
      },
    },
    { id: "hero", durationMs: 2000, process: { operations: [] } },
  ],
  editing: {
    version: 1,
    audio: {
      mode: "shared_track",
      ending: "resolve",
      syncPoints: [{ shotId: "close", offsetMs: 1000, beatId: "b" }],
    },
    ending: { shotIds: ["hero"], minHoldMs: 1500, productVisible: true },
  },
};
const composition: any = {
  scenes: [
    { id: "a", productionShotId: "close", durationMs: 2000 },
    { id: "b", productionShotId: "hero", durationMs: 2000 },
  ],
};
const samples = Array.from({ length: 41 }, (_, i) => i * 100);
function checks(shotId?: string): any[] {
  return productionReviewObligations(plan, shotId).map((obligation) => ({
    obligationId: obligation.id,
    status: "pass",
    reason: "Observed the stated condition in the actual asset",
    method: obligation.kind === "audio" ? "host_listening" : "frames",
    range:
      obligation.shotId === "close"
        ? { startMs: 0, endMs: obligation.operationId ? 1600 : 2000 }
        : obligation.shotId === "hero" || obligation.id.startsWith("ending:")
          ? { startMs: shotId ? 0 : 2000, endMs: shotId ? 2000 : 4000 }
          : { startMs: 0, endMs: 4000 },
    ...(obligation.operationId ? { holdMs: 400 } : {}),
  }));
}
function validate(qualityChecks = checks(), extra = {}) {
  return validateProductionQualityReview({
    plan,
    qualityChecks,
    samples,
    frameMs: 100,
    range: { startMs: 0, endMs: 4000 },
    composition,
    decision: "accepted",
    ...extra,
  });
}
describe("production quality obligations", () => {
  it("derives every operation, state, audio and advertising obligation", () => {
    expect(productionReviewObligations(plan).map((o) => o.id)).toEqual([
      "process:close:state",
      "process:close:operation:lower",
      "process:hero:state",
      "audio:continuity",
      "audio:ending",
      "audio:sync:0",
      "ending:readability",
      "ending:product",
    ]);
    expect(productionReviewObligations(plan, "close").map((o) => o.id)).toEqual(
      ["process:close:state", "process:close:operation:lower"],
    );
  });
  it("accepts complete observed checks without claiming automated semantic judgment", () => {
    expect(() => validate()).not.toThrow();
  });
  it("cannot accept only the final shot or an unknown process result", () => {
    expect(() =>
      validate(
        checks().filter((c) => !c.obligationId.startsWith("process:close")),
      ),
    ).toThrow(/quality/i);
    const unknown = checks();
    unknown[0].status = "unknown";
    expect(() => validate(unknown)).toThrow(/quality/i);
  });
  it("rejects duplicate or invented obligation IDs", () => {
    expect(() => validate([...checks(), checks()[0]])).toThrow(/quality/i);
    expect(() =>
      validate([...checks(), { ...checks()[0], obligationId: "made-up" }]),
    ).toThrow(/quality/i);
  });
  it("requires dense before/contact/completion evidence and a settled hold for each operation", () => {
    expect(() =>
      validate(checks(), { samples: [0, 1000, 1900, 2000, 3000, 3900] }),
    ).toThrow(/coverage/i);
    const truncated = checks();
    truncated[1].holdMs = 0;
    expect(() => validate(truncated)).toThrow(/hold/i);
  });
  it("cannot move every action sample into its settled hold", () => {
    const hidden = checks("close");
    hidden[1].range = { startMs: 1599, endMs: 1600 };
    const source = {
      shotId: "close",
      composition: undefined,
      range: { startMs: 0, endMs: 2000 },
    };
    expect(() =>
      validate(hidden, {
        ...source,
        samples: [0, 1000, 1600, 1700, 1800, 1900],
      }),
    ).toThrow(/coverage/i);
    expect(() =>
      validate(hidden, {
        ...source,
        samples: [0, 1000, 1599, 1600, 1700, 1800, 1900],
      }),
    ).toThrow(/coverage/i);
  });
  it("allows a rejected operation to identify a single observed defect frame", () => {
    const defect = checks()[1];
    defect.status = "fail";
    defect.range = { startMs: 1000, endMs: 1001 };
    defect.holdMs = 0;
    expect(() =>
      validate([defect], { decision: "needs_changes", samples: [1000] }),
    ).not.toThrow();
  });
  it("rejects observations assigned to a different shot", () => {
    const wrong = checks();
    wrong[0].range = { startMs: 2000, endMs: 4000 };
    expect(() => validate(wrong)).toThrow(/shot/i);
  });
  it("requires listening and does not treat frames or energy analysis as musical acceptance", () => {
    for (const method of ["frames", "audio_analysis"]) {
      const wrong = checks();
      wrong.find((c) => c.obligationId === "audio:continuity").method = method;
      expect(() => validate(wrong)).toThrow(/listen/i);
    }
  });
  it("requires actual ending hold coverage", () => {
    const short = checks();
    short.find((c) => c.obligationId === "ending:readability").range = {
      startMs: 3000,
      endMs: 4000,
    };
    expect(() => validate(short)).toThrow(/hold/i);
  });
  it("permits unknown findings without manufacturing evidence", () => {
    expect(() => validate([], { decision: "unreviewed" })).not.toThrow();
  });
  it("requires exact scope and shot binding for source acceptance", () => {
    const review: any = {
      decision: "accepted",
      qualityChecks: checks("close"),
      productionScopeHash: "scope",
      production: { shotId: "close" },
    };
    expect(productionQualityAccepted(review, plan, "scope", "close")).toBe(
      true,
    );
    expect(productionQualityAccepted(review, plan, "changed", "close")).toBe(
      false,
    );
    expect(productionQualityAccepted(review, plan, "scope", "hero")).toBe(
      false,
    );
    expect(
      productionQualityAccepted(
        { ...review, qualityChecks: [] },
        plan,
        "scope",
        "close",
      ),
    ).toBe(false);
  });
  it("preserves legacy acceptance when no enhanced contract exists", () => {
    expect(productionReviewObligations({ shots: [] } as any)).toEqual([]);
    expect(
      productionQualityAccepted(
        undefined,
        { shots: [] } as any,
        "scope",
        "shot",
      ),
    ).toBe(true);
  });
});
