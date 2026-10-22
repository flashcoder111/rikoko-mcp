import { expect, it } from "vitest";
import {
  planGuidance,
  snapshotGuidance,
  preparedGuidance,
} from "../packages/core/src/director-guidance.js";
it("keeps creative choices optional and copies only actual validation blockers", () => {
  const issue = {
    code: "INVALID_REFERENCE",
    shotId: "shot",
    message: "missing",
  };
  expect(planGuidance([issue]).blockers).toEqual([issue]);
  expect(planGuidance([]).blockers).toEqual([]);
  expect(planGuidance([]).decisions[0].kind).toBe("creative_choice");
});
it("existing edits do not demand analysis or new generation; unknown outcomes are not replayed", () => {
  const g = snapshotGuidance({ id: "p" }, { id: "r" }, [
    { id: "j", revisionId: "r", status: "submitting" },
  ]);
  expect(g.suggestions.map((s) => s.tool)).not.toContain("job_submit");
  expect(g.guideTopics).toEqual(["media-operations"]);
  expect(g.basedOn.revisionId).toBe("r");
  expect(preparedGuidance({ readyForSubmission: false }).suggestions).toEqual(
    [],
  );
});

it("historical snapshots request the head before edits", () => {
  const g = snapshotGuidance(
    { id: "p" },
    { id: "old" },
    [{ id: "job", revisionId: "new" }],
    { id: "new" },
  );
  expect(g.basedOn).toMatchObject({
    inspectedRevisionId: "old",
    headRevisionId: "new",
    revisionId: "new",
    jobIds: ["job"],
  });
  expect(g.suggestions.some((s) => s.tool === "workspace_commit")).toBe(false);
});
