import type { ReferenceReport } from "../../contracts/src/reference-analysis.js";

/** Source observations are evidence, never default target-generation instructions. */
export function referenceShotPrompts(
  report: ReferenceReport,
  shot: ReferenceReport["shots"][number],
  brief: string,
  legend: string,
  overrides: { imagePrompt?: string; videoPrompt?: string } = {},
) {
  const index = report.shots.findIndex((s) => s.id === shot.id);
  return {
    readyForGeneration: false,
    sourceObservation: {
      ...shot,
      visualStyle: shot.visualStyle ?? report.visualStyle?.description,
      previousEndState: report.shots[index - 1]?.details?.endState,
      nextStartState: report.shots[index + 1]?.details?.startState,
    },
    targetBrief: brief,
    referenceLegend: legend,
    authoredDrafts: overrides,
    instruction:
      "Source observations only. Author and save a target plan, then use production_shot_prompts and generation_prepare. Bind the prepared operation to this storyboard before quotation.",
  };
}
