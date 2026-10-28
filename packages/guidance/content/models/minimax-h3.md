# MiniMax H3: speech, action and reference writing

Read the exact profile and mode first. This entry covers the configured H3 text/frame profiles and H3 Max text/frame/reference profiles in catalog scope. H3, fal's H3 Max and the official MiniMax route are distinct deployments; common family guidance does not establish identical behavior. Preserve the selected provider, model, audio settings and prepared input.

## Separate model guidance from API input

MiniMax publishes a structured rewrite guide for its H3 system. The base guide organizes a visual/audio timeline, environment sound and music; it uses stable speaker IDs, exact dialogue inside `<d>` and camera movement described by action. Frames should lead into an observable transition. [MiniMax base guide, file revision 5d9b308](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md).

The reference guide separates subject definitions, task summary, retention decisions, the timeline and two sound sections. It distinguishes content identity from picture anchors, video structure and audio reference, keeping labels stable. [MiniMax reference guide, file revision 5d9b308](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md).

These are rewrite-output conventions. They are not new rikoko JSON fields or a reason to inject an entire internal representation into `action`. The current compiler uses ordinary descriptive references and kit dialogue. Adopt the meaning in the supported plan fields. Do not change prompt expansion or reference serialization merely because an online sample uses another pipeline.

## Speech-first construction

Choose exact words, the visible speaker, addressee, delivery and one motivated action. Read `rikoko_guide {topic:"craft/presenter-performance"}` for performance choices. Use `talking-head-v1.dialogue` as the single adopted script; the kit emits the speaking instruction. Its native-audio requirement still applies. A profile's family name does not prove that all speech controls are exposed.

Original plain-language example, for a product whose side button genuinely opens its lid:

> A presenter at an eye-level medium close-up holds the product below her chin. She looks into the lens, indicates the side button, and says in clear, conversational Mandarin: “按一下这里，就能打开。” She presses once, lets the lid reach its stop, then returns her gaze to the lens. Keep her face and the opening mechanism visible. Quiet room ambience; no music competing with speech.

Put that exact line in the kit dialogue and the remaining behavior in the shot direction; do not duplicate the speech in both places. If speech and operation cannot fit, use a separate demonstration passage with the same approved audio where the edit supports it. This is an authored sample, not a tested duration or lip-sync guarantee.

For understanding the official base rewrite notation, a short authored fragment is:

```text
integrated_multimodal_description: [Shot 1] A presenter (S1) faces the lens and says calmly: <d>[Chinese] 看这里。</d> She points to the hinge.
overall_soundscape: Quiet room, a soft sleeve rustle.
non_diegetic_music: None.
```

This fragment illustrates the official convention, not a turnkey rikoko request. Keep delivery instructions outside the quoted words. Internal rewrite syntax, endpoint prose and plan schema have different jobs.

## Reference identity is not the starting frame

The fal H3 Max reference API names references `Image 1`, `Video 1`, `Audio 1` in their respective lists and separately accepts first/last-frame inputs. Prompt expansion is an API setting; its documentation describes `disabled`, `balanced` and `quality`. rikoko's configured profiles/adapters currently use `disabled`; reading this guide does not change that. [fal H3 Max reference API](https://fal.ai/models/minimax/h3-max/reference-to-video/api).

Use the actual compiler's descriptive labels. For a reference image of a presenter, another of a product and a source video, make three separate decisions: whose appearance to use, which product properties to keep, and which movement/interaction from the video to transfer. Do not inherit the old person's appearance through a motion description. The current profile may not bind every modality in the public API, particularly audio; a written voice description does not transmit a voice sample.

Authored reference-direction example:

> Image 1 supplies the presenter's appearance. Image 2 supplies the stand's shape and hinge. Video 1 supplies only the deliberate opening rhythm. The presenter sits at a desk facing the viewer. Keep the stand below her face; show the support arm opening while its base stays on the desk. After the hand releases it, hold the stable open stand and the presenter's quiet reaction.

This requires those actual inputs and the corresponding reference mode. A first-frame-only request cannot receive the missing motion video through words. For frame modes, describe movement from the supplied opening toward the supplied ending; do not describe a new opening that contradicts the first frame.

## Check the selected take

Observe speech, mouth movement, action timing and the final sound mix together where possible. Keep findings separate: correct words, recognizable speaker, intended delivery, intelligible mechanism and stable product. Frames cannot pass pronunciation or synchronized speech. Diagnose whether a failure came from the authored decision, missing/mismatched input, or the generated result; do not label a read guide or transmitted reference as success.

Sources reviewed 2026-10-27. Evidence: official model documentation, provider API contracts and authored adaptations. No new rikoko generation trials or equivalence claim between H3 variants.
