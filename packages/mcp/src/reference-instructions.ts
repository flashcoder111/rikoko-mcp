export const referenceAnalysisInstructions =
  "Support /rikoko analysis [overview|shots|recreate|auto] using reference_analysis_settings. Chinese aliases are 概览, 逐镜头, 复刻, 自动. No argument reads the current setting; auto resets the saved preference. Explain that the setting applies to future analysis across this account. Command-only turns never plan, upload, quote, analyze, render or buy; just read/save the setting and acknowledge it. Invalid choices must show valid options without modifying the setting. The studio uses /analysis with the same settings tool. " +
  "Video analysis precision is user intent, not a promise of frame accuracy. An explicit per-task precision request wins over the saved account preference; a saved preference wins over inferred defaults. Read reference_analysis_settings before choosing the workflow. When auto, use shots for ordinary analysis and recreate for remake or later generation. If no per-task precision was requested, omit detail on plan/analyze so the server resolves the stored preference; prepared tasks already have resolved detail and must retain it. Interpret explicit 概览/quick summary as overview, 逐镜头/shot breakdown as shots, and 复刻精度 as recreate. Accept natural-language focus on motion, camera, appearance, text, audio and continuity. Persist per-task detail/focus with the ongoing workspace request when one exists. " +
  "Use reference_analysis_plan for complete-shot or recreate work, then reference_analysis_prepare through every nextOffset. This prepares actual bounded clips and returns exact reference_analyze inputs. For a brief overview, one reference_analyze call with detail=overview is sufficient when the model limits permit. A prepared clip is already a unit of the plan: quote it directly, never recursively plan it. For a request to deepen a particular shot, retrieve its original-source range and make a focused plan with detail=recreate; keep the original report. " +
  "The plan's estimatedCalls exposes the full scope. Quote all intended tasks, summarize their total quoted charge and obtain one agreement for that bounded set before job_submit. Reuse completed inputs and stable idempotency keys. Never exceed an agreed call/cost scope or silently switch model/provider. Missing or failed parts remain visible and use their original jobs for recovery. After all parts finish, call reference_analysis_merge with every report ID. Cut candidates and long-shot window boundaries are not verified edits; don't present window fragments as a verified shot count. " +
  "If analysis fails, preserve prepared clips and pause dependent remake generation. ANALYSIS_PROTOCOL_MISMATCH requires a compatible official cloud deployment; INVALID_INPUT requires checking the rejected contract, not guessing model failure. Do not repeatedly retry unchanged inputs, remove detail/focus, or replace semantic analysis with motion references. A downloaded or prepared clip is not a successful analysis. Resume the existing plan after repair and read the completed reports before generating. " +
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
