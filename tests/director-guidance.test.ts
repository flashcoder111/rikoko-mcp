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

it("returns verified actionable knowledge and does not reopen a saved treatment", async () => {
  const { directorGuidance } =
    await import("../packages/core/src/director-guidance.js");
  const { directorResponsibility } =
    await import("../packages/guidance/src/director.js");
  const { productionPlanSchema } =
    await import("../packages/core/src/production-plan.js");
  const plan = productionPlanSchema.parse({
    title: "A quiet reaction",
    width: 720,
    height: 1280,
    treatment: {
      intent: "Let the audience notice a changed relationship",
      referenceInterpretation: "The listener's pause changes the meaning",
      approach: "Stay on the listener after the question",
      successCriteria: ["The reaction remains visible before the cut"],
    },
    shots: [
      { id: "reaction", initialState: {}, action: "Pause", endState: {} },
    ],
  });
  const guide = await directorGuidance("plan", {
    plan,
    basedOn: { planVersion: 1 },
  });
  expect(guide.responsibility).toBe(directorResponsibility);
  expect(guide.treatment).toEqual(plan.treatment);
  expect(guide.content.map((g) => g.key)).not.toContain("intent");
  expect(guide.blockers).toEqual([]);
  expect(guide.content[0].text).toContain("preservation requirements");
  expect(
    (await directorGuidance("plan", { plan, basedOn: { planVersion: 1 } }))
      .decisionKey,
  ).toBe(guide.decisionKey);
  expect(
    (await directorGuidance("plan", { plan, basedOn: { planVersion: 2 } }))
      .decisionKey,
  ).not.toBe(guide.decisionKey);
  const resumed = await directorGuidance("resume", {
    plan,
    guideVersion: "older-guide",
  });
  expect(resumed.knowledgeChanged).toBe(true);
  expect(resumed.content).toEqual([]);
  expect(resumed.treatment).toEqual(plan.treatment);
});
