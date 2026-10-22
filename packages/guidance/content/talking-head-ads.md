# Talking-head advertisements

Default workflow: one quick check of critical images, no source-video or final AI review gate, and no automatic quality regeneration. Review criteria below guide planning and optional user-requested evaluation. Deliver technically valid output directly; preserve unreviewed cases honestly. See delivery policy (`rikoko_guide {topic:"visual-review"}`).
Use when a visible presenter delivers the advertising argument. Words, delivery and their correspondence to visible speech are core material. A silent face with unrelated voiceover does not establish a talking-head performance.

## Copy, performance and proof

Choose a specific opening thought, concise explanation, supporting evidence and approved CTA. Use claims/offers/experience supported by the brief. An expert-like delivery does not authorize invented credentials. Store exact adopted dialogue in each shot's `talking-head-v1` selection; avoid a conflicting full script in the action text.

Select `friendly-explainer` for conversational explanation, `calm-expert` for measured assurance, or `energetic-hook` for focused curiosity. Direct what the speaker means and reacts to. A revealing expression and one motivated gesture often work better than choreography for every word. Use product footage or screen evidence when it makes the claim understandable.

## Build the performance

Establish identity, clothing, framing and setting with `creator-image-v1/creator-room` or `product-in-hand`. Independent edited passages can reuse the same anchor; avoid unnecessary tail-frame dependency chains. Recurring voice identity requires actual supported voice inputs; a written description alone does not lock a voice.

Check the chosen model's dialogue/audio controls. Talking-head tasks involve faces: prohibit all Seedance variants, recommend compatible MiniMax, offer Kling and obtain or reuse the user’s explicit selection through video_model_resolve. Retain unresolved requirements if none fits. `talking-head-v1` requires enabled native audio; preparation checks `generate_audio=true`. Sound support alone does not guarantee spoken words or lip sync. Never silently substitute independent TTS for a requested visible spoken performance.

Size requests for the actual words, pauses and interaction within the model's supported duration. Split at meaningful thoughts where needed, not every line. Planned speaking time is an estimate. For requested captions, obtain real transcription/alignment from the selected output; do not invent word timestamps from a planned duration.

## Composition and optional review

Keep exact captions and graphics in the edit. B-roll can show proof while adopted speech continues. Preserve intelligibility under a shared music bed when music serves the piece. End with readable product/brand and CTA plus an intentional sound ending.

Only for an explicitly requested evaluation, review words, pronunciation, mouth/sound synchronization, voice consistency, identity, gesture, claim/proof correspondence and reading time by watching and listening to the relevant actual mix. Frame checks cannot pass speech criteria.

If wrong words are reported, explain the finding and repair only within an explicit repair instruction or allowance; changing captions cannot repair an incorrect audible claim. Layout changes should reuse a good take. Save actual attempts and failures through director cases (`rikoko_guide {topic:"director-kits"}`); one good take remains one sample.
