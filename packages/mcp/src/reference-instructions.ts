export const referenceAnalysisInstructions =
  "Video analysis precision is user intent, not a promise of frame accuracy. Interpret 概览/quick summary as detail=overview, 逐镜头/shot breakdown as detail=shots (default), and 复刻/仿拍/remake or analysis for later generation as detail=recreate. An explicit detail selection wins over inferred purpose. Accept natural-language focus on motion, camera, appearance, text, audio and continuity; no new slash commands are required. Persist the requested detail/focus with the ongoing workspace request when one exists. " +
  "Use reference_analysis_plan for complete-shot or recreate work, then reference_analysis_prepare through every nextOffset. This prepares actual bounded clips and returns exact reference_analyze inputs. For a brief overview, one reference_analyze call with detail=overview is sufficient when the model limits permit. A prepared clip is already a unit of the plan: quote it directly, never recursively plan it. For a request to deepen a particular shot, retrieve its original-source range and make a focused plan with detail=recreate; keep the original report. " +
  "The plan's estimatedCalls exposes the full scope. Quote all intended tasks, summarize their total quoted charge and obtain one agreement for that bounded set before job_submit. Reuse completed inputs and stable idempotency keys. Never exceed an agreed call/cost scope or silently switch model/provider. Missing or failed parts remain visible and use their original jobs for recovery. After all parts finish, call reference_analysis_merge with every report ID. Cut candidates and long-shot window boundaries are not verified edits; don't present window fragments as a verified shot count. " +
  "Read full paginated shots and structured details before authoring generation prompts: initial/final state, spatial relations, lighting, ordered actionStages and continuity. Use neighboring shot states as continuity context, not as extra actions to generate inside the current shot. Do not turn a chat overview into the production prompt. Recreate detail must not collapse to a single action verb or a word-count target. Static content may need no action stages. Avoid inventing unseen preparation, contact or outcomes. If full details exceed the generation prompt limit, author bounded separate image/video prompts from the stored record; never silently truncate stages. FPS remains provider controlled on the fal video route; segmented clips do not prove increased sampling FPS. ";

export const referenceDetailProfiles = [
  {
    id: "overview",
    name: "概览",
    purpose: "Content, narrative and style summary",
    completeShotInventory: false,
  },
  {
    id: "shots",
    name: "逐镜头",
    purpose: "Enumerate separate editing shots including short inserts",
    completeShotInventory: "requested-not-guaranteed",
  },
  {
    id: "recreate",
    name: "复刻",
    purpose:
      "Full shot states, action stages, spatial relations and continuity for generation",
    completeShotInventory: "requested-not-guaranteed",
  },
] as const;
